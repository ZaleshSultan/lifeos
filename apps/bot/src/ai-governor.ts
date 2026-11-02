import { randomUUID } from "node:crypto";
import {
  AI_EXECUTION_FEATURES,
  type AiBudgetLimits,
  type AiBudgetStore,
  type AiExecutionFeature,
  type AiExecutionState,
  type EnvSource,
} from "@lifeos/core";

export type AiGovernorReason =
  | "ai_shutdown"
  | "ai_invalid_execution"
  | "ai_budget_unavailable"
  | "ai_token_budget_exceeded"
  | "ai_cost_budget_exceeded"
  | "ai_pricing_unconfigured"
  | "ai_duplicate_request"
  | "ai_iteration_limit"
  | "ai_profile_inactive"
  | "ai_concurrency_limit"
  | "ai_circuit_open"
  | "ai_timeout"
  | "ai_cancelled"
  | "ai_output_budget_exceeded"
  | "ai_provider_unavailable";
export const AI_PROVIDER_CATEGORIES = [
  "ai_invalid_credentials",
  "ai_quota_exceeded",
  "ai_unsupported_model",
  "ai_invalid_response",
  "ai_timeout",
  "ai_cancelled",
  "ai_unavailable",
] as const;
export type AiProviderCategory = (typeof AI_PROVIDER_CATEGORIES)[number];
export class AiGovernorError extends Error {
  readonly providerCategory?: AiProviderCategory;
  constructor(
    readonly code: AiGovernorReason,
    providerCategory?: AiProviderCategory,
  ) {
    super(code);
    this.name = "AiGovernorError";
    if (providerCategory && AI_PROVIDER_CATEGORIES.includes(providerCategory))
      this.providerCategory = providerCategory;
  }
}
export interface AiGovernorConfig {
  killSwitch: boolean;
  timeoutMs: number;
  maxConcurrent: number;
  maxRequestTokens: number;
  maxOutputTokens: number;
  failureThreshold: number;
  cooldownMs: number;
  inputCostMicrosPer1k: number | null;
  outputCostMicrosPer1k: number | null;
  limits: AiBudgetLimits;
}
export function readAiGovernorConfig(
  source: EnvSource = process.env,
): AiGovernorConfig {
  const number = (key: string, fallback: number, min: number, max: number) => {
    const raw = source[key];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (
      (raw && !/^\d+$/.test(raw)) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      throw new Error("Invalid AI governor setting: " + key);
    return value;
  };
  const optional = (key: string, max = 1_000_000_000_000) =>
    source[key] === undefined || source[key] === ""
      ? null
      : number(key, 1, 1, max);
  const killValue = (source.LIFEOS_AI_KILL_SWITCH ?? "false").toLowerCase();
  if (
    !["true", "false", "1", "0", "yes", "no", "on", "off", ""].includes(
      killValue,
    )
  )
    throw new Error("Invalid AI governor kill switch");
  return {
    killSwitch: ["true", "1", "yes", "on"].includes(
      (source.LIFEOS_AI_KILL_SWITCH ?? "false").toLowerCase(),
    ),
    timeoutMs: number("LIFEOS_AI_EXECUTION_TIMEOUT_MS", 20000, 100, 120000),
    maxConcurrent: number("LIFEOS_AI_EXECUTION_MAX_CONCURRENT", 2, 1, 20),
    maxRequestTokens: number(
      "LIFEOS_AI_MAX_REQUEST_TOKENS",
      100000,
      1,
      1000000,
    ),
    maxOutputTokens: number(
      "LIFEOS_AI_EXECUTION_MAX_OUTPUT_TOKENS",
      8192,
      1,
      8192,
    ),
    failureThreshold: number("LIFEOS_AI_CIRCUIT_FAILURES", 3, 1, 20),
    cooldownMs: number("LIFEOS_AI_CIRCUIT_COOLDOWN_MS", 60000, 100, 3600000),
    inputCostMicrosPer1k: !source.LIFEOS_AI_ESTIMATED_INPUT_MICROS_PER_1K
      ? null
      : number("LIFEOS_AI_ESTIMATED_INPUT_MICROS_PER_1K", 0, 0, 1000000000000),
    outputCostMicrosPer1k: !source.LIFEOS_AI_ESTIMATED_OUTPUT_MICROS_PER_1K
      ? null
      : number("LIFEOS_AI_ESTIMATED_OUTPUT_MICROS_PER_1K", 0, 0, 1000000000000),
    limits: {
      userTokens: number("LIFEOS_AI_USER_DAILY_TOKENS", 200000, 1, 1000000000),
      featureTokens: number(
        "LIFEOS_AI_FEATURE_DAILY_TOKENS",
        100000,
        1,
        1000000000,
      ),
      globalTokens: number(
        "LIFEOS_AI_GLOBAL_DAILY_TOKENS",
        1000000,
        1,
        1000000000,
      ),
      userCostMicros: optional("LIFEOS_AI_USER_DAILY_COST_MICROS"),
      featureCostMicros: optional("LIFEOS_AI_FEATURE_DAILY_COST_MICROS"),
      globalCostMicros: optional("LIFEOS_AI_GLOBAL_DAILY_COST_MICROS"),
      maxIterations: number("LIFEOS_AI_MAX_TASK_ITERATIONS", 3, 1, 20),
    },
  };
}
export interface AiRunOptions {
  userId: string;
  feature: AiExecutionFeature;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  requestId?: string;
  taskId?: string;
  signal?: AbortSignal;
  /** A caller may shorten the shared deadline, never extend it. */
  timeoutMs?: number;
}
export interface AiExecutionReceipt {
  requestId: string;
  reservedTokens: number;
  estimatedCostMicros: number | null;
  reportedTokens: number | null;
  elapsedMs: number;
}
function providerUsage(value: unknown): {
  total: number | null;
  output: number | null;
} {
  if (!value || typeof value !== "object") return { total: null, output: null };
  const v = value as Record<string, unknown>;
  const usage = (v.usageMetadata ?? v.usage) as
    | Record<string, unknown>
    | undefined;
  const valid = (n: unknown): number | null =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 10000000
      ? n
      : null;
  return {
    total: valid(usage?.totalTokenCount ?? usage?.total_tokens),
    output: valid(usage?.candidatesTokenCount ?? usage?.completion_tokens),
  };
}
/** Conservative byte count, an estimate rather than a provider tokenizer. */
export function estimateAiInputTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string")
    throw new AiGovernorError("ai_invalid_execution");
  return Buffer.byteLength(text, "utf8");
}
export class AiGovernor {
  private readonly active = new Map<string, AbortController>();
  private failures = 0;
  private openUntil = 0;
  private killed = false;
  private storeStatus: "untested" | "available" | "unavailable" = "untested";
  constructor(
    private readonly options: {
      store?: AiBudgetStore;
      config: AiGovernorConfig;
      now?: () => number;
    },
  ) {}
  status() {
    return {
      killSwitch: this.killed || this.options.config.killSwitch,
      active: this.active.size,
      maxConcurrent: this.options.config.maxConcurrent,
      circuitOpenUntil:
        this.openUntil > (this.options.now ?? Date.now)()
          ? this.openUntil
          : null,
      budgetStorage: this.options.store ? this.storeStatus : "unavailable",
      durableReservationsConfigured: Boolean(this.options.store),
      automaticRetries: 0,
    };
  }
  shutdown() {
    this.killed = true;
    for (const controller of this.active.values()) controller.abort();
  }
  async run<T>(
    input: AiRunOptions,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ value: T; receipt: AiExecutionReceipt }> {
    const config = this.options.config,
      now = this.options.now ?? Date.now,
      started = now();
    const requestId = input.requestId ?? randomUUID(),
      taskId = input.taskId ?? requestId;
    const validId = (id: string) =>
      typeof id === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(id);
    if (this.killed || config.killSwitch)
      throw new AiGovernorError("ai_shutdown");
    if (
      typeof input.userId !== "string" ||
      !input.userId ||
      input.userId.length > 200 ||
      !AI_EXECUTION_FEATURES.includes(input.feature) ||
      !validId(requestId) ||
      !validId(taskId) ||
      !Number.isSafeInteger(input.estimatedInputTokens) ||
      input.estimatedInputTokens < 0 ||
      !Number.isSafeInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 1 ||
      input.maxOutputTokens > config.maxOutputTokens ||
      (input.timeoutMs !== undefined &&
        (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1))
    )
      throw new AiGovernorError("ai_invalid_execution");
    const reservedTokens = input.estimatedInputTokens + input.maxOutputTokens;
    if (reservedTokens > config.maxRequestTokens)
      throw new AiGovernorError("ai_token_budget_exceeded");
    if (!this.options.store) throw new AiGovernorError("ai_budget_unavailable");
    if (input.signal?.aborted) throw new AiGovernorError("ai_cancelled");
    if (this.openUntil > started) throw new AiGovernorError("ai_circuit_open");
    if (this.active.size >= config.maxConcurrent)
      throw new AiGovernorError("ai_concurrency_limit");
    const activeKey = input.userId + ":" + requestId;
    if (this.active.has(activeKey))
      throw new AiGovernorError("ai_duplicate_request");
    const pricesKnown =
      config.inputCostMicrosPer1k !== null &&
      config.outputCostMicrosPer1k !== null;
    const estimatedCostMicros = pricesKnown
      ? Math.ceil(
          (input.estimatedInputTokens * config.inputCostMicrosPer1k!) / 1000 +
            (input.maxOutputTokens * config.outputCostMicrosPer1k!) / 1000,
        )
      : null;
    if (
      estimatedCostMicros === null &&
      [
        config.limits.userCostMicros,
        config.limits.featureCostMicros,
        config.limits.globalCostMicros,
      ].some((v) => v !== null)
    )
      throw new AiGovernorError("ai_pricing_unconfigured");
    const controller = new AbortController();
    this.active.set(activeKey, controller);
    let providerPending = false;
    let providerCompleted = false;
    let finalized = false;
    let timedOut = false,
      reserved = false,
      reportedTokens: number | null = null,
      state: AiExecutionState = "failed";
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    let rejectAbort: (reason: Error) => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abortListener = () =>
      rejectAbort(
        new AiGovernorError(timedOut ? "ai_timeout" : "ai_cancelled"),
      );
    controller.signal.addEventListener("abort", abortListener, { once: true });
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.min(input.timeoutMs ?? config.timeoutMs, config.timeoutMs),
    );
    try {
      const outcome = await Promise.race([
        this.options.store.reserve(
          {
            userId: input.userId,
            feature: input.feature,
            requestId,
            taskId,
            reservedTokens,
            estimatedCostMicros,
            limits: config.limits,
          },
          controller.signal,
        ),
        aborted,
      ]);
      this.storeStatus = "available";
      if (outcome !== "reserved")
        throw new AiGovernorError(
          outcome === "duplicate"
            ? "ai_duplicate_request"
            : outcome === "iteration_limit"
              ? "ai_iteration_limit"
              : outcome === "profile_inactive"
                ? "ai_profile_inactive"
                : outcome === "cost_budget_exceeded"
                  ? "ai_cost_budget_exceeded"
                  : "ai_token_budget_exceeded",
        );
      reserved = true;
      if (controller.signal.aborted)
        throw new AiGovernorError(timedOut ? "ai_timeout" : "ai_cancelled");
      providerPending = true;
      const providerPromise = Promise.resolve().then(() => {
        if (controller.signal.aborted)
          throw new AiGovernorError(timedOut ? "ai_timeout" : "ai_cancelled");
        return operation(controller.signal);
      });
      void providerPromise.then(
        () => {
          providerPending = false;
          if (finalized) this.active.delete(activeKey);
        },
        () => {
          providerPending = false;
          if (finalized) this.active.delete(activeKey);
        },
      );
      const value = await Promise.race([providerPromise, aborted]);
      providerCompleted = true;
      const usage = providerUsage(value);
      reportedTokens = usage.total;
      if (
        (usage.output !== null && usage.output > input.maxOutputTokens) ||
        (reportedTokens !== null && reportedTokens > reservedTokens)
      )
        throw new AiGovernorError("ai_output_budget_exceeded");
      await Promise.race([
        this.options.store.finish(
          {
            userId: input.userId,
            requestId,
            state: "completed",
            reportedTokens,
          },
          controller.signal,
        ),
        aborted,
      ]);
      state = "completed";
      this.failures = 0;
      return {
        value,
        receipt: {
          requestId,
          reservedTokens,
          estimatedCostMicros,
          reportedTokens,
          elapsedMs: Math.max(0, now() - started),
        },
      };
    } catch (error) {
      const failure =
        error instanceof AiGovernorError
          ? error
          : new AiGovernorError(
              reserved && !providerCompleted
                ? "ai_provider_unavailable"
                : "ai_budget_unavailable",
            );
      if (failure.code === "ai_budget_unavailable")
        this.storeStatus = "unavailable";
      state =
        failure.code === "ai_timeout"
          ? "timed_out"
          : failure.code === "ai_cancelled"
            ? "cancelled"
            : "failed";
      if (
        [
          "ai_provider_unavailable",
          "ai_timeout",
          "ai_output_budget_exceeded",
        ].includes(failure.code)
      ) {
        this.failures++;
        if (this.failures >= config.failureThreshold)
          this.openUntil = now() + config.cooldownMs;
      }
      if (reserved) {
        // Separate bounded receipt attempt after cancellation; never refund reservation.
        const receiptController = new AbortController();
        const receiptTimer = setTimeout(() => receiptController.abort(), 2000);
        void this.options.store
          .finish(
            { userId: input.userId, requestId, state, reportedTokens },
            receiptController.signal,
          )
          .catch(() => {
            this.storeStatus = "unavailable";
          })
          .finally(() => clearTimeout(receiptTimer));
      }
      throw failure;
    } finally {
      clearTimeout(timer);
      if (state !== "completed") controller.abort();
      controller.signal.removeEventListener("abort", abortListener);
      input.signal?.removeEventListener("abort", onAbort);
      finalized = true;
      if (!providerPending) this.active.delete(activeKey);
    }
  }
}
export function createAiGovernor(
  options: {
    store?: AiBudgetStore;
    source?: EnvSource;
    now?: () => number;
  } = {},
): AiGovernor {
  let config: AiGovernorConfig;
  try {
    config = readAiGovernorConfig(options.source);
  } catch {
    config = { ...readAiGovernorConfig({}), killSwitch: true };
  }
  return new AiGovernor({ store: options.store, now: options.now, config });
}

/** Only the existing OpenRouter endpoint, with explicit owner/feature and no redirects. */
export function governedOpenRouterFetch(
  governor: AiGovernor | undefined,
  userId: string,
  feature: AiExecutionFeature = "finance",
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const taskId = randomUUID();
  let iteration = 0;
  return async (input, init) => {
    if (!governor) throw new AiGovernorError("ai_budget_unavailable");
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (
      url !== "https://openrouter.ai/api/v1/chat/completions" ||
      init?.method !== "POST" ||
      typeof init.body !== "string" ||
      Buffer.byteLength(init.body) > 8 * 1024 * 1024
    )
      throw new AiGovernorError("ai_invalid_execution");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init.body);
    } catch {
      throw new AiGovernorError("ai_invalid_execution");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AiGovernorError("ai_invalid_execution");
    const maxOutputTokens = 2048;
    body.max_tokens = maxOutputTokens;
    body.stream = false;
    let images = 0;
    const minimal = JSON.parse(
      JSON.stringify(body, (_key, value: unknown) => {
        if (
          typeof value === "string" &&
          /^data:image\/(?:png|jpeg|webp);base64,/.test(value)
        ) {
          images++;
          return "[consented image]";
        }
        return value;
      }),
    );
    if (images > 1) throw new AiGovernorError("ai_invalid_execution");
    const estimate = estimateAiInputTokens(minimal) + images * 32768;
    const result = await governor.run(
      {
        userId,
        feature,
        taskId,
        requestId: `${taskId}:${++iteration}`,
        estimatedInputTokens: estimate,
        maxOutputTokens,
        signal: init.signal ?? undefined,
      },
      async (signal) => {
        const response = await fetchImpl(url, {
          ...init,
          body: JSON.stringify(body),
          signal,
          redirect: "error",
        });
        if (!response.ok) throw new AiGovernorError("ai_provider_unavailable");
        const reader = response.body?.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        if (!reader) throw new AiGovernorError("ai_provider_unavailable");
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 256 * 1024) {
            await reader.cancel();
            throw new AiGovernorError("ai_output_budget_exceeded");
          }
          chunks.push(part.value);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new AiGovernorError("ai_provider_unavailable");
        }
        // The wrapper returns parsed JSON so usage metering is inspected before forwarding.
        return {
          json,
          text,
          headers: response.headers,
          status: response.status,
          usage: (json as Record<string, unknown>)?.usage,
        };
      },
    );
    return new Response(result.value.text, {
      status: result.value.status,
      headers: result.value.headers,
    });
  };
}
