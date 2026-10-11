import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ASSISTANT_TOOL_NAMES,
  assistantToolPermission,
  containsAssistantCredentials,
  containsAssistantSensitiveData,
  optionalEnv,
  parseAssistantToolCall,
  routeAssistantIntent,
  type AssistantToolOutput,
  type AssistantToolCall,
  type EnvSource,
} from "@lifeos/core";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import {
  AssistantError,
  AssistantToolRegistry,
  type AssistantExecutionContext,
} from "./registry.js";
import {
  executeMemoryOrWriteTool,
  executeProductivityTool,
  mutationSummary,
} from "./tools.js";
import { executeStudyTool } from "./study-tools.js";

export interface AssistantConfig {
  enabled: boolean;
  confirmationSecret?: string;
  allowMemoryDelete: boolean;
  classificationEnabled: boolean;
}
export function readAssistantConfig(
  source: EnvSource = process.env,
): AssistantConfig {
  const flag = (key: string) =>
    ["1", "true", "yes", "on"].includes(
      optionalEnv(source, key, "false")!.toLowerCase(),
    );
  return {
    enabled: flag("LIFEOS_ASSISTANT_ENABLED"),
    confirmationSecret: optionalEnv(
      source,
      "LIFEOS_ASSISTANT_CONFIRMATION_SECRET",
    ),
    allowMemoryDelete: flag("LIFEOS_ASSISTANT_MEMORY_DELETE_ENABLED"),
    classificationEnabled: flag("LIFEOS_ASSISTANT_CLASSIFICATION_ENABLED"),
  };
}
export interface AssistantReply {
  answer: string;
  suggestions: [];
  provider: "lifeos";
  readOnly: boolean;
  tool: {
    name: string;
    permission: ReturnType<typeof assistantToolPermission>;
    status: "completed" | "pending_confirmation";
    summary: string;
  };
  sources: Array<{ name: string; updatedAt: string | null }>;
  confirmation?: { token: string; summary: string };
}
export interface AssistantRequest {
  user: TelegramUserRecord;
  text: string;
  requestId: string;
  source: "telegram" | "tma";
  date?: string;
  confirmationToken?: string;
}
type ReadClassifier = (userId: string, text: string) => Promise<unknown>;

/** Sensitive questions never fall through to a provider or plain-text capture. */
export function assistantPrivateRequest(text: string): boolean {
  return (
    containsAssistantCredentials(text) ||
    containsAssistantSensitiveData(text) ||
    /\b(?:health|medical|medication|diagnosis|insulin|prescription|finance|financial|bank|salary|transactions?|expenses?|balance|budget|payment|receipt|debt|mortgage|account|memory|memories)\b|здоров|лекарств|медицин|диагноз|финанс|банк|зарплат|расход|баланс|бюджет|плат[её]ж|памят/iu.test(
      text,
    )
  );
}

export class AssistantBrain {
  readonly registry: AssistantToolRegistry;
  private readonly active = new Set<string>();
  private readonly usage = new Map<string, { minute: number; count: number }>();
  constructor(
    private readonly options: {
      store: LifeOSStore;
      config: AssistantConfig;
      now?: () => Date;
      classifier?: ReadClassifier;
    },
  ) {
    this.registry = new AssistantToolRegistry();
    for (const tool of ASSISTANT_TOOL_NAMES) {
      this.registry.register(tool, (context, call) => {
        if (call.tool.startsWith("classes.") || call.tool.startsWith("study."))
          return executeStudyTool(
            options.store,
            context.user,
            call,
            context.now,
          );
        if (call.tool.startsWith("productivity."))
          return executeProductivityTool(options.store, context, call);
        return executeMemoryOrWriteTool(options.store, context, call);
      });
    }
  }
  status() {
    return { assistantEnabled: this.options.config.enabled };
  }

  private signature(payload: string, request: AssistantRequest): string {
    return createHmac("sha256", this.options.config.confirmationSecret!)
      .update(
        JSON.stringify([
          request.user.userId,
          request.source,
          request.requestId,
          payload,
        ]),
      )
      .digest("base64url");
  }
  private requestHash(request: AssistantRequest): string {
    return createHash("sha256")
      .update(JSON.stringify([request.text, request.date ?? null]))
      .digest("hex");
  }
  private issue(
    request: AssistantRequest,
    call: AssistantToolCall,
    now: Date,
  ): string {
    if (
      !this.options.config.confirmationSecret ||
      this.options.config.confirmationSecret.length < 32
    )
      throw new AssistantError("assistant_confirmation_unavailable");
    const payload = Buffer.from(
      JSON.stringify({
        iat: now.getTime(),
        exp: now.getTime() + 600_000,
        call,
        hash: this.requestHash(request),
      }),
    ).toString("base64url");
    return `${payload}.${this.signature(payload, request)}`;
  }
  private confirmed(request: AssistantRequest, now: Date): AssistantToolCall {
    try {
      if (
        !this.options.config.confirmationSecret ||
        !request.confirmationToken ||
        request.confirmationToken.length > 8000
      )
        throw new Error();
      const [payload, signature, extra] = request.confirmationToken.split(".");
      if (!payload || !signature || extra) throw new Error();
      const expected = Buffer.from(this.signature(payload, request));
      const provided = Buffer.from(signature);
      if (
        expected.length !== provided.length ||
        !timingSafeEqual(expected, provided)
      )
        throw new Error();
      const value = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      if (
        Object.keys(value).sort().join(",") !== "call,exp,hash,iat" ||
        !Number.isFinite(value.iat) ||
        !Number.isFinite(value.exp) ||
        value.exp <= now.getTime() ||
        value.iat > now.getTime() ||
        value.exp - value.iat !== 600_000 ||
        value.hash !== this.requestHash(request)
      )
        throw new Error();
      const call = parseAssistantToolCall(value.call);
      const original = routeAssistantIntent(request.text, {
        now: new Date(value.iat),
        timezone: request.user.timezone,
        date: request.date,
      });
      if (
        !original ||
        JSON.stringify(original) !== JSON.stringify(call) ||
        assistantToolPermission(call.tool) === "READ"
      )
        throw new Error();
      return call;
    } catch {
      throw new AssistantError("assistant_confirmation_invalid");
    }
  }

  async handle(request: AssistantRequest): Promise<AssistantReply | null> {
    if (!this.options.config.enabled) return null;
    if (request.user.status !== "active" || !request.user.userId)
      throw new AssistantError("assistant_permission_denied");
    if (
      typeof request.text !== "string" ||
      !request.text.trim() ||
      request.text.length > 2000 ||
      !/^[A-Za-z0-9:_-]{1,100}$/.test(request.requestId)
    )
      throw new AssistantError("assistant_invalid_request");
    const now = this.options.now?.() ?? new Date();
    if (containsAssistantCredentials(request.text))
      throw new AssistantError("assistant_sensitive_data");
    let call: AssistantToolCall | null;
    try {
      call = request.confirmationToken
        ? this.confirmed(request, now)
        : routeAssistantIntent(request.text, {
            now,
            timezone: request.user.timezone,
            date: request.date,
          });
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      throw new AssistantError("assistant_invalid_request");
    }
    let origin: "deterministic" | "model" = "deterministic";
    if (!call && assistantPrivateRequest(request.text))
      throw new AssistantError("assistant_sensitive_data");
    const minute = Math.floor(now.getTime() / 60_000);
    if (this.usage.size >= 2000)
      for (const [key, value] of this.usage)
        if (value.minute !== minute) this.usage.delete(key);
    const usage = this.usage.get(request.user.userId);
    if (
      this.active.has(request.user.userId) ||
      this.active.size >= 50 ||
      (usage?.minute === minute && usage.count >= 30) ||
      (!usage && this.usage.size >= 2000)
    )
      throw new AssistantError("assistant_rate_limited");
    this.usage.set(request.user.userId, {
      minute,
      count: usage?.minute === minute ? usage.count + 1 : 1,
    });
    this.active.add(request.user.userId);
    try {
      if (
        !call &&
        this.options.config.classificationEnabled &&
        this.options.classifier
      ) {
        const candidate = await this.options.classifier(
          request.user.userId,
          request.text,
        );
        if (candidate !== null) {
          try {
            call = parseAssistantToolCall(candidate);
          } catch {
            throw new AssistantError("assistant_invalid_request");
          }
          // Model only gets a small list of argument-free public read tools.
          if (
            !MODEL_READ_TOOLS.includes(call.tool) ||
            Object.keys(call.args).length ||
            assistantToolPermission(call.tool) !== "READ"
          )
            throw new AssistantError("assistant_permission_denied");
          origin = "model";
        }
      }
      if (!call) return null;
      if (!this.options.store.assistant)
        throw new AssistantError("assistant_unavailable");
      const permission = assistantToolPermission(call.tool);
      if (
        permission === "SENSITIVE" ||
        (permission === "DESTRUCTIVE" && !this.options.config.allowMemoryDelete)
      )
        throw new AssistantError("assistant_permission_denied");
      if (
        permission !== "READ" &&
        request.source === "tma" &&
        !request.confirmationToken
      ) {
        const summary = mutationSummary(call, request.user.timezone);
        return {
          answer: `Confirm this change / Подтвердите изменение:\n${summary}`,
          suggestions: [],
          provider: "lifeos",
          readOnly: true,
          tool: {
            name: call.tool,
            permission,
            status: "pending_confirmation",
            summary,
          },
          sources: [],
          confirmation: { token: this.issue(request, call, now), summary },
        };
      }
      const context: AssistantExecutionContext = {
        user: request.user,
        source: request.source,
        requestId: request.requestId,
        now,
        origin,
        allowDestructive: this.options.config.allowMemoryDelete,
        ...(permission !== "READ" ? { authorizedWrite: call } : {}),
      };
      const started = Date.now();
      let output: AssistantToolOutput;
      try {
        output = await this.registry.execute(context, call);
      } catch (error) {
        if (permission === "READ") {
          try {
            await this.options.store.assistant.recordRead({
              userId: request.user.userId,
              requestId: `${request.source}:${request.requestId}`,
              source: request.source,
              tool: call.tool,
              status: "failed",
              errorCode: "handler_error",
              durationMs: Date.now() - started,
            });
          } catch {
            /* Preserve the original safe tool error if audit storage is unavailable. */
          }
        }
        throw error;
      }
      if (permission === "READ")
        await this.options.store.assistant.recordRead({
          userId: request.user.userId,
          requestId: `${request.source}:${request.requestId}`,
          source: request.source,
          tool: call.tool,
          status: "succeeded",
          durationMs: Date.now() - started,
        });
      return {
        answer: output.text,
        suggestions: [],
        provider: "lifeos",
        readOnly: permission === "READ",
        tool: {
          name: call.tool,
          permission,
          status: "completed",
          summary:
            permission === "READ"
              ? (output.sources[0]?.name ??
                "Saved LifeOS data / Сохранённые данные LifeOS")
              : "Action processed / Действие обработано",
        },
        sources: output.sources,
      };
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      throw new AssistantError("assistant_unavailable");
    } finally {
      this.active.delete(request.user.userId);
    }
  }
}

export const MODEL_READ_TOOLS = [
  "study.scholarship",
  "classes.today",
  "classes.tomorrow",
  "classes.next",
  "study.deadlines",
  "study.grades",
  "study.changes",
  "productivity.tasks",
  "productivity.reminders",
  "productivity.calendar",
];
