import type { IncomingMessage, ServerResponse } from "node:http";
import { DateTime } from "luxon";
import { validatePlanSuggestions } from "@lifeos/core";
import { randomUUID } from "node:crypto";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import {
  LifeosAiError,
  type LifeosAiMessage,
  type LifeosAiService,
} from "./lifeos-ai.js";
import {
  loadPlanningData,
  PlanningInputError,
  planningDate,
  redactAiText,
} from "./planning-context.js";
import { AssistantBrain, assistantPrivateRequest } from "./assistant/brain.js";
import { AssistantError } from "./assistant/registry.js";

export function publicAiStatus(
  ai: LifeosAiService,
  assistant?: AssistantBrain,
) {
  const status = ai.status();
  return {
    enabled: status.enabled,
    available: status.available,
    reason: status.reason,
    liveEnabled: false as const,
    ...(assistant?.status().assistantEnabled ? { assistantEnabled: true } : {}),
  };
}

function parseChat(
  body: unknown,
  assistantEnabled = false,
): {
  messages: LifeosAiMessage[];
  date?: unknown;
  requestId?: string;
  confirmationToken?: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new LifeosAiError("ai_invalid_request");
  const input = body as Record<string, unknown>;
  // Reject write/consent flags rather than allowing a prompt to grant tool authority.
  if (
    Object.keys(input).some(
      (key) =>
        !(
          assistantEnabled
            ? ["messages", "date", "requestId", "confirmationToken"]
            : ["messages", "date", "requestId"]
        ).includes(key),
    )
  )
    throw new LifeosAiError("ai_invalid_request");
  if (
    (input.requestId !== undefined &&
      (typeof input.requestId !== "string" ||
        !/^[A-Za-z0-9:_-]{1,100}$/.test(input.requestId))) ||
    (input.confirmationToken !== undefined &&
      (typeof input.confirmationToken !== "string" ||
        input.confirmationToken.length > 8000)) ||
    (input.confirmationToken !== undefined && input.requestId === undefined)
  )
    throw new LifeosAiError("ai_invalid_request");
  if (
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > 12
  )
    throw new LifeosAiError("ai_invalid_request");
  const messages = input.messages.map((m): LifeosAiMessage => {
    if (!m || typeof m !== "object" || Array.isArray(m))
      throw new LifeosAiError("ai_invalid_request");
    const r = m as Record<string, unknown>;
    if (
      Object.keys(r).some((key) => !["role", "text"].includes(key)) ||
      !["user", "assistant"].includes(String(r.role)) ||
      typeof r.text !== "string" ||
      !r.text.trim() ||
      r.text.length > 2000
    )
      throw new LifeosAiError("ai_invalid_request");
    return {
      role: r.role as LifeosAiMessage["role"],
      text: assistantEnabled
        ? r.text.trim()
        : redactAiText(r.text.trim(), 2000),
    };
  });
  if (messages[messages.length - 1].role !== "user")
    throw new LifeosAiError("ai_invalid_request");
  return {
    messages,
    date: input.date,
    requestId: input.requestId as string | undefined,
    confirmationToken: input.confirmationToken as string | undefined,
  };
}

export async function handlePlanningRoute({
  request,
  response,
  url,
  user,
  store,
  ai,
  assistant,
  readJsonBody,
  writeJson,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  user: TelegramUserRecord;
  store: LifeOSStore;
  ai: LifeosAiService;
  assistant?: AssistantBrain;
  readJsonBody: (
    request: IncomingMessage,
    maxBytes?: number,
  ) => Promise<unknown>;
  writeJson: (response: ServerResponse, status: number, body: unknown) => void;
}): Promise<boolean> {
  const path = url.pathname;
  if (
    !["/api/tma/today", "/api/tma/ai/status", "/api/tma/ai/chat"].includes(
      path,
    ) &&
    !path.startsWith("/api/tma/ai/")
  )
    return false;
  response.setHeader("Cache-Control", "no-store");
  const send = (data: unknown) => writeJson(response, 200, { data });
  if (
    path.startsWith("/api/tma/ai/") &&
    !["/api/tma/ai/status", "/api/tma/ai/chat"].includes(path)
  ) {
    writeJson(response, 404, {
      error: "ai_action_not_supported",
      message:
        "AI assistance is read-only. Use the existing task controls to confirm changes.",
    });
    return true;
  }
  if (request.method !== (path === "/api/tma/ai/chat" ? "POST" : "GET")) {
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  try {
    if (path === "/api/tma/ai/status") {
      send(publicAiStatus(ai, assistant));
      return true;
    }
    if (path === "/api/tma/today") {
      const date = planningDate(
        user,
        url.searchParams.get("date") ?? undefined,
        new Date(),
      );
      const { plan, events, reminders, productivity } = await loadPlanningData(
        store,
        user,
        date,
      );
      send({
        plan,
        events,
        reminders,
        productivity,
        ai: publicAiStatus(ai, assistant),
      });
      return true;
    }
    const assistantEnabled = assistant?.status().assistantEnabled ?? false;
    const {
      messages,
      date: requestedDate,
      requestId,
      confirmationToken,
    } = parseChat(await readJsonBody(request, 32_768), assistantEnabled);
    const date = planningDate(user, requestedDate, new Date());
    if (assistantEnabled && assistant) {
      const result = await assistant.handle({
        user,
        text: messages.at(-1)!.text,
        date,
        requestId: requestId ?? randomUUID(),
        confirmationToken,
        source: "tma",
      });
      if (result) {
        if (result.confirmation && !requestId)
          throw new AssistantError("assistant_invalid_request");
        send(result);
        return true;
      }
    }
    const status = ai.status();
    // Disabled AI must not even load user context or construct a provider client.
    if (!status.enabled) throw new LifeosAiError("ai_disabled");
    if (!status.available)
      throw new LifeosAiError(
        status.reason === "ai_unsupported_model"
          ? "ai_unsupported_model"
          : "ai_missing_credentials",
      );
    const data = await loadPlanningData(store, user, date);
    // Tool results and explicit memories are local. They never enter provider history.
    const providerMessages = assistantEnabled
      ? [messages.at(-1)!].map((m) => ({
          ...m,
          text: redactAiText(m.text, 2000),
        }))
      : messages;
    if (
      assistantEnabled &&
      assistantPrivateRequest(providerMessages.at(-1)!.text)
    )
      throw new AssistantError("assistant_sensitive_data");
    const reply = await ai.ask(user.userId, providerMessages, data.aiContext);
    const seen = new Set<string>();
    const validated = [];
    for (const suggestion of reply.suggestions) {
      const day = DateTime.fromISO(suggestion.startsAt, {
        zone: user.timezone,
      }).toISODate();
      const plan = data.aiPlans.find((p) => p.date === day);
      if (
        !plan ||
        seen.has(suggestion.taskId) ||
        Date.parse(suggestion.startsAt) < Date.now()
      )
        throw new LifeosAiError("ai_invalid_response");
      seen.add(suggestion.taskId);
    }
    for (const plan of data.aiPlans) {
      const suggestions = reply.suggestions.filter(
        (s) =>
          DateTime.fromISO(s.startsAt, { zone: user.timezone }).toISODate() ===
          plan.date,
      );
      const result = validatePlanSuggestions(plan, suggestions);
      if (!result.valid) throw new LifeosAiError("ai_invalid_response");
      validated.push(...result.blocks);
    }
    // No store writes, tool calls or persistence are reachable from this route.
    const titles = new Map(data.plan.rankedTasks.map((t) => [t.id, t.title]));
    send({
      ...reply,
      suggestions: validated.map((b) => ({
        ...b,
        title: titles.get(b.taskId) ?? b.title,
      })),
      readOnly: true,
    });
  } catch (error) {
    if (error instanceof AssistantError)
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
      });
    else if (error instanceof LifeosAiError)
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
      });
    else if (error instanceof PlanningInputError)
      writeJson(response, 400, {
        error: "invalid_planning_date",
        message: error.message,
      });
    else if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      "errorCode" in error
    )
      throw error;
    else
      writeJson(response, 503, {
        error: "planning_unavailable",
        message: "Planning data is unavailable. Try again later.",
      });
  }
  return true;
}
