import { randomUUID } from "node:crypto";
import {
  AI_ROUTER_PROVIDERS,
  estimateAiRouterCost,
  parseAiRouterSettings,
  projectAiRouterModel,
  selectAiModelRoute,
  type AiRouterModel,
  type AiRouterTask,
  type AiRouterSettings,
  type AiExecutionFeature,
  type AiRoutingAccounting,
  type AiModelRouteReceipt,
  type AiRouterSettingsSnapshot,
  type AiRouterDecision,
} from "@lifeos/core";
import type { AiRouterSettingsStore } from "@lifeos/db";
import {
  AiGovernor,
  AiGovernorError,
  estimateAiInputTokens,
} from "./ai-governor.js";
import {
  readAiModelRouterConfig,
  type AiModelRouterConfig,
  type RouterModelConfiguration,
  type RouterCredential,
} from "./ai-model-router-config.js";
import {
  callAiRouterProvider,
  normalizeRouterProviderMessages,
  RouterProviderError,
  type RouterProviderMessage,
  type RouterProviderResult,
} from "./ai-model-router-providers.js";

export class AiRouterError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 503,
  ) {
    super(code);
    this.name = "AiRouterError";
  }
}
export interface AiRouterExecutionInput {
  userId: string;
  feature: AiExecutionFeature;
  task: AiRouterTask;
  messages: RouterProviderMessage[];
  maxOutputTokens: number;
  requestId?: string;
  taskId?: string;
  previousModelId?: string;
  signal?: AbortSignal;
}
export class AiModelRouter {
  private readonly unavailableUntil = new Map<string, number>();
  constructor(
    readonly config: AiModelRouterConfig,
    private readonly dependencies: {
      governor?: AiGovernor;
      settings?: AiRouterSettingsStore;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}
  private now() {
    return (this.dependencies.now ?? Date.now)();
  }
  private credentials(
    userId: string,
    row: RouterModelConfiguration,
    feature?: AiExecutionFeature,
  ): RouterCredential[] {
    return row.credentialIds.flatMap((id) => {
      const key = this.config.credentials.find(
        (c) =>
          c.id === id &&
          c.ownerUserId === userId &&
          c.provider === row.model.provider &&
          c.secret &&
          (!feature || c.features.includes(feature)),
      );
      return key ? [key] : [];
    });
  }
  catalog(userId: string, feature?: AiExecutionFeature): AiRouterModel[] {
    return this.config.models.map((row) => {
      const available = this.credentials(userId, row, feature).length > 0;
      const cooling =
        (this.unavailableUntil.get(userId + ":" + row.model.id) ?? 0) >
        this.now();
      return projectAiRouterModel({
        ...row.model,
        metadataVerified:
          row.model.metadataVerified &&
          this.now() >= row.verifiedAtMs &&
          this.now() - row.verifiedAtMs <= 30 * 86400_000,
        configured: available,
        authorized:
          this.config.enabled &&
          available &&
          (row.model.billing !== "api" || this.config.paidRequestsEnabled),
        status: !this.config.enabled
          ? "disabled"
          : row.model.provider === "chatgpt_plan"
            ? "permission_required"
            : available && !cooling
              ? "configured"
              : "disconnected",
        planScopeGranted: false,
        privacy: "external",
      });
    });
  }
  status() {
    return {
      enabled: this.config.enabled,
      available:
        this.config.enabled &&
        this.config.models.some(
          (row) =>
            row.model.metadataVerified &&
            this.config.credentials.some(
              (c) => row.credentialIds.includes(c.id) && c.secret,
            ) &&
            (row.model.billing === "free" || this.config.paidRequestsEnabled),
        ),
      reason: this.config.configurationInvalid
        ? "ai_router_configuration_invalid"
        : !this.config.enabled
          ? "ai_router_disabled"
          : "ai_router_owner_policy_required",
    };
  }
  private async saved(userId: string) {
    if (!this.dependencies.settings)
      throw new AiRouterError("ai_router_storage_unavailable");
    try {
      return await this.dependencies.settings.get(userId);
    } catch {
      throw new AiRouterError("ai_router_storage_unavailable");
    }
  }
  async snapshot(userId: string): Promise<AiRouterSettingsSnapshot> {
    const saved = await this.saved(userId);
    const recentExecutions =
      (await this.dependencies.settings?.getRecent?.(userId)) ?? [];
    return {
      ...saved,
      recentExecutions,
      models: this.catalog(userId),
      providers: AI_ROUTER_PROVIDERS.map((id) => ({
        id,
        status:
          id === "chatgpt_plan"
            ? "permission_required"
            : !this.config.enabled
              ? "disabled"
              : this.config.credentials.some(
                    (c) =>
                      c.provider === id && c.ownerUserId === userId && c.secret,
                  )
                ? "configured_unverified"
                : "not_configured",
        credentialLabels: this.config.credentials
          .filter(
            (c) => c.provider === id && c.ownerUserId === userId && c.secret,
          )
          .map((c) => c.id),
        verified: false,
      })),
      operatorLimits: {
        routerEnabled: this.config.enabled,
        maxRequestCostMicros: this.config.maxRequestCostMicros,
        maxDailyCostMicros: this.config.maxDailyCostMicros,
        paidRequestsEnabled: this.config.paidRequestsEnabled,
        maxOutputTokens: this.config.maxOutputTokens,
      },
      chatgptPlan: {
        status: "prepared",
        identityConnected: false,
        planUsageAuthorized: false,
        usesApiCredits: false,
        manageUsageUrl: "https://chatgpt.com/settings/usage",
      },
    };
  }
  async save(userId: string, value: unknown, expectedRevision: number) {
    const settings = parseAiRouterSettings(value);
    if (!this.dependencies.settings)
      throw new AiRouterError("ai_router_storage_unavailable");
    await this.dependencies.settings.save(userId, settings, expectedRevision);
    return this.snapshot(userId);
  }
  private effective(settings: AiRouterSettings): AiRouterSettings {
    return {
      ...settings,
      spending: {
        ...settings.spending,
        paidCallsAuthorized:
          settings.spending.paidCallsAuthorized &&
          this.config.paidRequestsEnabled,
        maxRequestCostMicros: Math.min(
          settings.spending.maxRequestCostMicros,
          this.config.maxRequestCostMicros,
        ),
        maxDailyCostMicros: Math.min(
          settings.spending.maxDailyCostMicros,
          this.config.maxDailyCostMicros,
        ),
      },
    };
  }
  async preview(
    userId: string,
    task: AiRouterTask,
    estimatedInputTokens: number,
    maxOutputTokens: number,
    previousModelId?: string,
  ): Promise<AiRouterDecision> {
    const { settings } = await this.saved(userId);
    return selectAiModelRoute({
      task,
      settings: this.effective(settings),
      models: this.catalog(userId),
      estimatedInputTokens,
      maxOutputTokens,
      previousModelId,
    });
  }
  async execute(input: AiRouterExecutionInput): Promise<{
    text: string;
    modelRoute: AiModelRouteReceipt;
    usage?: RouterProviderResult["usage"];
  }> {
    if (!this.config.enabled) throw new AiRouterError("ai_router_disabled");
    if (!this.dependencies.governor)
      throw new AiRouterError("ai_budget_unavailable");
    if (input.signal?.aborted) throw new AiRouterError("ai_cancelled", 408);
    if (
      !Number.isSafeInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 1 ||
      input.maxOutputTokens > this.config.maxOutputTokens
    )
      throw new AiRouterError("ai_router_invalid_request", 400);
    if (
      !Array.isArray(input.messages) ||
      !input.messages.length ||
      input.messages.length > 25
    )
      throw new AiRouterError("ai_router_invalid_request", 400);
    const messages = normalizeRouterProviderMessages(input.messages);
    let images = 0;
    const metered = messages.map((message) => ({
      ...message,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => {
              if (part.type === "image_url") {
                images++;
                return {
                  type: "image_url",
                  image_url: { url: "[consented image]" },
                };
              }
              return part;
            }),
    }));
    const estimatedInputTokens =
      estimateAiInputTokens(metered) + images * 80000;
    if (images > 1) throw new AiRouterError("ai_router_invalid_request", 400);
    const saved = await this.saved(input.userId);
    const settings = this.effective(saved.settings);
    const catalog = this.catalog(input.userId, input.feature);
    const task = ["deterministic", "tagging"].includes(input.task.category)
      ? input.task
      : {
          ...input.task,
          requiredCapabilities: [
            ...new Set([
              ...(input.task.requiredCapabilities ?? []),
              "json" as const,
            ]),
          ],
        };
    const decision = selectAiModelRoute({
      task,
      settings,
      models: catalog,
      estimatedInputTokens,
      maxOutputTokens: input.maxOutputTokens,
      previousModelId: input.previousModelId,
    });
    if (decision.kind !== "selected")
      throw new AiRouterError(
        "ai_router_" + decision.reason,
        decision.kind === "deterministic" ? 400 : 503,
      );
    const candidates = decision.candidates.map((c) => ({
      ...this.config.models.find((m) => m.model.id === c.modelId)!,
      model: catalog.find((model) => model.id === c.modelId)!,
    }));
    const primary = candidates[0];
    if (!primary || primary.model.provider === "chatgpt_plan")
      throw new AiRouterError("chatgpt_plan_permission_required");
    const primaryKey = this.credentials(
      input.userId,
      primary,
      input.feature,
    )[0];
    if (!primaryKey)
      throw new AiRouterError("ai_router_owner_credentials_required");
    const atomicOpenRouter =
      primary.model.provider === "openrouter" &&
      candidates.every(
        (m) =>
          m.model.provider === "openrouter" &&
          this.credentials(input.userId, m, input.feature)[0]?.id ===
            primaryKey.id &&
          m.requireZdr === primary.requireZdr &&
          m.sort === primary.sort &&
          JSON.stringify(m.providerOnly) ===
            JSON.stringify(primary.providerOnly),
      );
    const rotateAllowed =
      settings.fallback.enabled &&
      this.credentials(input.userId, primary, input.feature).length > 1;
    const possibleCalls = atomicOpenRouter
      ? rotateAllowed
        ? this.credentials(input.userId, primary, input.feature).length
        : 1
      : candidates.reduce(
          (sum, row) =>
            sum +
            (settings.fallback.enabled
              ? this.credentials(input.userId, row, input.feature).length
              : 1),
          0,
        );
    const attemptsBound = Math.min(
      settings.fallback.enabled ? settings.fallback.maxAttempts : 1,
      possibleCalls,
      3,
    );
    const costs = candidates.map((m) =>
      estimateAiRouterCost(
        m.model,
        estimatedInputTokens,
        input.maxOutputTokens,
      ),
    );
    if (costs.some((v) => v === null))
      throw new AiRouterError("ai_router_pricing_unavailable");
    const atomicPriceBound = estimateAiRouterCost(
      {
        ...primary.model,
        inputCostMicrosPer1k: Math.max(
          ...candidates.map((m) => m.model.inputCostMicrosPer1k ?? 0),
        ),
        outputCostMicrosPer1k: Math.max(
          ...candidates.map((m) => m.model.outputCostMicrosPer1k ?? 0),
        ),
      },
      estimatedInputTokens,
      input.maxOutputTokens,
    );
    if (atomicPriceBound === null)
      throw new AiRouterError("ai_router_pricing_unavailable");
    const estimatedCostMicros =
      (atomicOpenRouter ? atomicPriceBound : Math.max(...(costs as number[]))) *
      attemptsBound;
    if (
      !Number.isSafeInteger(estimatedCostMicros) ||
      estimatedCostMicros > settings.spending.maxRequestCostMicros
    )
      throw new AiRouterError("ai_router_cost_limit", 429);
    const requestId = input.requestId ?? randomUUID();
    const routing: AiRoutingAccounting = {
      version: 1,
      provider: primary.model.provider,
      model: primary.model.model,
      selectedModelId: primary.model.id,
      credentialLabel: primaryKey.id,
      billing: primary.model.billing,
      attempts: 1,
      fallback: decision.fallbackAtSelection,
      inputTokens: null,
      outputTokens: null,
      reportedCostMicros: null,
      costSource: "unknown",
    };
    const started = this.now();
    const result = await this.dependencies.governor.run(
      {
        userId: input.userId,
        feature: input.feature,
        requestId,
        taskId: input.taskId ?? requestId,
        signal: input.signal,
        estimatedInputTokens: estimatedInputTokens * attemptsBound,
        maxOutputTokens: input.maxOutputTokens * attemptsBound,
        estimatedCostMicros,
        maxUserDailyCostMicros: settings.spending.maxDailyCostMicros,
        maxRequestCostMicros: settings.spending.maxRequestCostMicros,
        routing,
      },
      async (signal) => {
        let attempts = 0;
        let last: unknown;
        for (const row of atomicOpenRouter ? [primary] : candidates) {
          const keys = this.credentials(input.userId, row, input.feature);
          for (
            let keyIndex = 0;
            keyIndex < keys.length && attempts < attemptsBound;
            keyIndex++
          ) {
            if (signal.aborted) throw new AiGovernorError("ai_cancelled");
            // Policy revocation stops new outbound attempts; accepted work may still bill.
            const current = await this.saved(input.userId);
            if (signal.aborted) throw new AiGovernorError("ai_cancelled");
            if (current.revision !== saved.revision)
              throw new AiRouterError("ai_router_consent_changed", 403);
            if (
              !this.catalog(input.userId, input.feature).some(
                (model) =>
                  model.id === row.model.id &&
                  model.metadataVerified &&
                  model.authorized &&
                  model.configured,
              )
            )
              throw new AiRouterError("ai_router_model_unavailable");
            const key = keys[keyIndex];
            attempts++;
            Object.assign(routing, {
              provider: row.model.provider,
              model: row.model.model,
              selectedModelId: row.model.id,
              credentialLabel: key.id,
              attempts,
              fallback:
                decision.fallbackAtSelection ||
                row.model.id !== primary.model.id ||
                attempts > 1,
            });
            try {
              const group = atomicOpenRouter
                ? candidates.filter((candidate) =>
                    this.credentials(
                      input.userId,
                      candidate,
                      input.feature,
                    ).some((credential) => credential.id === key.id),
                  )
                : [row];
              const response = await callAiRouterProvider(
                {
                  model: row.model,
                  fallbackModels: group.slice(1).map((m) => m.model),
                  apiKey: key.secret,
                  messages,
                  maxOutputTokens: input.maxOutputTokens,
                  signal,
                  openRouter: {
                    providerOnly: row.providerOnly,
                    sort: row.sort,
                    requireZdr: row.requireZdr,
                  },
                },
                this.dependencies.fetchImpl,
              );
              const actual = group.find(
                (m) => m.model.model === response.servedModel,
              );
              if (!actual)
                throw new AiGovernorError(
                  "ai_provider_unavailable",
                  "ai_invalid_response",
                );
              const observed =
                response.reportedCostMicros ??
                (response.usage
                  ? estimateAiRouterCost(
                      actual.model,
                      response.usage.prompt_tokens,
                      response.usage.completion_tokens,
                    )
                  : null);
              const accounting: AiRoutingAccounting = {
                ...routing,
                billing: actual.model.billing,
                provider: actual.model.provider,
                model: response.servedModel,
                selectedModelId: actual.model.id,
                credentialLabel: key.id,
                attempts,
                fallback:
                  decision.fallbackAtSelection ||
                  actual.model.id !== primary.model.id ||
                  attempts > 1,
                inputTokens: response.usage?.prompt_tokens ?? null,
                outputTokens: response.usage?.completion_tokens ?? null,
                reportedCostMicros: observed,
                costSource:
                  response.reportedCostMicros !== null
                    ? "provider_reported"
                    : observed !== null
                      ? "rate_estimate"
                      : "unknown",
              };
              return {
                ...response,
                routing: accounting,
                usage: attempts === 1 ? response.usage : undefined,
              };
            } catch (error) {
              last = error;
              if (
                !(error instanceof RouterProviderError) ||
                error.ambiguous ||
                signal.aborted
              )
                throw error;
              // Explicitly scoped rotation is for rejected credentials, never quota evasion.
              if (
                error.code === "invalid_credentials" &&
                error.httpStatus === 401 &&
                settings.fallback.enabled &&
                keyIndex + 1 < keys.length
              )
                continue;
              if (error.retryable && decision.fallbackAllowed) {
                this.unavailableUntil.set(
                  input.userId + ":" + row.model.id,
                  this.now() + 60000,
                );
                break;
              }
              throw error;
            }
          }
          if (attempts >= attemptsBound) break;
        }
        throw last ?? new AiGovernorError("ai_provider_unavailable");
      },
    );
    const value = result.value;
    return {
      text: value.text,
      usage: value.usage,
      modelRoute: {
        version: 1,
        requestId,
        modelId: value.routing.selectedModelId,
        provider: value.routing.provider,
        model: value.routing.model,
        billing: value.routing.billing,
        estimatedCostMicros: result.receipt.estimatedCostMicros,
        reportedCostMicros: value.routing.reportedCostMicros,
        costSource: value.routing.costSource,
        ...(value.upstreamProvider
          ? { upstreamProvider: value.upstreamProvider }
          : {}),
        latencyMs: Math.max(0, this.now() - started),
        fallback: value.routing.fallback,
        reason: decision.reason,
        privacy: "external",
      },
    };
  }
}
export function createAiModelRouter(
  dependencies: ConstructorParameters<typeof AiModelRouter>[1],
  source = process.env,
) {
  return new AiModelRouter(readAiModelRouterConfig(source), dependencies);
}
/** Invalid requested routing must pause external work, never restore legacy billing. */
export function routerModeRequested(
  router: AiModelRouter | undefined,
): router is AiModelRouter {
  return Boolean(
    router && (router.config.enabled || router.config.configurationInvalid),
  );
}

/** Bridge an existing finance adapter into the same policy/governor; incoming keys are ignored. */
export function routedOpenRouterFetch(
  router: AiModelRouter,
  userId: string,
  feature: AiExecutionFeature = "finance",
): typeof fetch {
  const taskId = randomUUID();
  let iteration = 0;
  return async (input, init) => {
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
      Buffer.byteLength(init.body) > 1024 * 1024
    )
      throw new AiRouterError("ai_router_invalid_request", 400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      throw new AiRouterError("ai_router_invalid_request", 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new AiRouterError("ai_router_invalid_request", 400);
    const messages = normalizeRouterProviderMessages(
      (parsed as { messages?: unknown }).messages,
    );
    const vision = messages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
    );
    const result = await router.execute({
      userId,
      feature,
      requestId: taskId + ":" + ++iteration,
      taskId,
      signal: init.signal ?? undefined,
      messages,
      maxOutputTokens: 2048,
      task: {
        category: vision ? "nutrition_photo" : "document_extraction",
        dataCategories: ["general", "finance"],
        requiredCapabilities: vision ? ["json", "vision"] : ["json"],
      },
    });
    return new Response(
      JSON.stringify({
        model: result.modelRoute.model,
        choices: [
          {
            message: { role: "assistant", content: result.text },
            finish_reason: "stop",
          },
        ],
        usage: result.usage,
        modelRoute: result.modelRoute,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}
