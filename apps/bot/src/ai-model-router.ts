import { randomUUID } from "node:crypto";
import {
  AI_ROUTER_PROVIDERS,
  AI_ROUTER_DATA_CATEGORIES,
  estimateAiRouterCost,
  estimateAiRouterSpeechCost,
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
  type AiRouterProviderStatus,
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
import {
  callCaptureSpeechProvider,
  CAPTURE_SPEECH_MIN_MICROS_PER_MINUTE,
  CAPTURE_SPEECH_MODEL,
} from "./capture-speech-provider.js";
import type { GovernedCaptureSpeechAdapter } from "./telegram/voice.js";
import {
  freeCredentialPermits,
  freeCredentialReady,
  freeModelReason,
  isPublicRouterInput,
  type PublicRouterPrompt,
} from "./ai-model-router-free-policy.js";
import {
  routerJsonSchema,
  type RouterJsonSchemaKey,
} from "./ai-model-router-json.js";

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
  /** Trusted operation deadline; the governor can only shorten its configured maximum. */
  timeoutMs?: number;
  /** A capture owner reviewed this exact saved policy revision. */
  expectedSettingsRevision?: number;
  schemaKey?: RouterJsonSchemaKey;
  /** In-memory proof issued only for a fixed server-owned public probe. */
  publicPrompt?: PublicRouterPrompt;
}
export interface AiRouterSpeechInput {
  userId: string;
  captureId: string;
  requestId: string;
  consentExpiresAt: string;
  expectedSettingsRevision?: number;
  signal?: AbortSignal;
}
export interface AiRouterPreparedSpeech {
  adapter: GovernedCaptureSpeechAdapter;
  authorize: (
    stage: "before_download" | "before_transcription",
  ) => Promise<boolean>;
  policy: {
    settingsRevision: number;
    modelId: string;
    provider: "openai";
    maxRequestCostMicros: number;
  };
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
      const keys = this.credentials(userId, row, feature);
      const available = keys.length > 0;
      const freeReady =
        !this.config.freeProfileEnabled ||
        freeModelReason(row, keys, this.now()) === null;
      const cooling =
        (this.unavailableUntil.get(userId + ":" + row.model.id) ?? 0) >
        this.now();
      return projectAiRouterModel({
        ...row.model,
        metadataVerified:
          row.model.metadataVerified &&
          this.now() >= row.verifiedAtMs &&
          this.now() - row.verifiedAtMs <=
            (this.config.freeProfileEnabled ? 1 : 30) * 86400_000,
        configured: available,
        authorized:
          this.config.enabled &&
          available &&
          freeReady &&
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
            (!this.config.freeProfileEnabled ||
              freeModelReason(
                row,
                this.config.credentials.filter(
                  (key) =>
                    row.credentialIds.includes(key.id) && Boolean(key.secret),
                ),
                this.now(),
              ) === null) &&
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
  private async freeProviderStatus(
    userId: string,
    provider: string,
  ): Promise<AiRouterProviderStatus["freeRouting"]> {
    if (!["gemini", "openrouter"].includes(provider)) return undefined;
    const result: NonNullable<AiRouterProviderStatus["freeRouting"]> = {
      status: "disabled",
      localRequestsToday: null,
      localDailyLimit: null,
      retryAt: null,
      providerRemaining: null,
    };
    if (!this.config.freeProfileEnabled) return result;
    const keys = this.config.credentials.filter(
      (key) =>
        key.ownerUserId === userId && key.provider === provider && key.secret,
    );
    if (!keys.length) return { ...result, status: "not_configured" };
    const ready = keys.filter((key) => freeCredentialReady(key, this.now()));
    if (!ready.length) return { ...result, status: "metadata_required" };
    if (
      !this.config.models.some(
        (row) =>
          row.model.provider === provider &&
          freeModelReason(row, ready, this.now()) === null,
      )
    )
      return { ...result, status: "metadata_required" };
    if (!this.dependencies.governor?.providerQuotaConfigured())
      return { ...result, status: "quota_unavailable" };
    const groups = [
      ...new Map(ready.map((key) => [key.quota!.domain, key])).values(),
    ];
    try {
      const quotas = await Promise.all(
        groups.map((key) =>
          this.dependencies.governor!.providerQuotaStatus({
            userId,
            provider: key.provider as "gemini" | "openrouter",
            quotaDomain: key.quota!.domain,
          }),
        ),
      );
      const retry =
        quotas
          .flatMap((quota) => (quota?.retryAt ? [quota.retryAt] : []))
          .sort()
          .at(-1) ?? null;
      return {
        ...result,
        status: quotas.some((quota) => quota?.reviewRequired)
          ? "review_required"
          : retry
            ? "cooldown"
            : "prepared",
        localRequestsToday: quotas.every((quota) => quota !== null)
          ? quotas.reduce((sum, quota) => sum + quota!.requestsInDay, 0)
          : null,
        localDailyLimit: groups.reduce(
          (sum, key, index) =>
            sum +
            (quotas[index]?.requestsPerDay ?? key.quota!.limits.requestsPerDay),
          0,
        ),
        retryAt: retry,
      };
    } catch {
      return { ...result, status: "quota_unavailable" };
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
      providers: await Promise.all(
        AI_ROUTER_PROVIDERS.map(async (id) => ({
          id,
          status:
            id === "chatgpt_plan"
              ? "permission_required"
              : !this.config.enabled
                ? "disabled"
                : this.config.credentials.some(
                      (c) =>
                        c.provider === id &&
                        c.ownerUserId === userId &&
                        c.secret,
                    )
                  ? "configured_unverified"
                  : "not_configured",
          credentialLabels: this.config.credentials
            .filter(
              (c) => c.provider === id && c.ownerUserId === userId && c.secret,
            )
            .map((c) => c.id),
          verified: false,
          freeRouting: await this.freeProviderStatus(userId, id),
        })),
      ),
      operatorLimits: {
        routerEnabled: this.config.enabled,
        maxRequestCostMicros: this.config.maxRequestCostMicros,
        maxDailyCostMicros: this.config.maxDailyCostMicros,
        paidRequestsEnabled: this.config.paidRequestsEnabled,
        maxOutputTokens: this.config.maxOutputTokens,
        freeProfileEnabled: this.config.freeProfileEnabled === true,
        freeOnly: this.config.freeProfileEnabled === true,
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
    feature?: AiExecutionFeature,
  ): Promise<AiRouterDecision> {
    const { settings } = await this.saved(userId);
    return selectAiModelRoute({
      task,
      settings: this.effective(settings),
      models: this.catalog(userId, feature).map((model) =>
        this.config.freeProfileEnabled && model.provider === "gemini"
          ? { ...model, authorized: false }
          : model,
      ),
      estimatedInputTokens,
      maxOutputTokens,
      previousModelId,
    });
  }
  /** Prepare one native audio call. transcribeCaptureVoice owns the sole durable reservation. */
  async prepareSpeech(
    input: AiRouterSpeechInput,
  ): Promise<AiRouterPreparedSpeech> {
    const expiry = Date.parse(input.consentExpiresAt);
    if (!this.config.enabled) throw new AiRouterError("ai_router_disabled");
    if (!this.dependencies.governor)
      throw new AiRouterError("ai_budget_unavailable");
    if (input.signal?.aborted) throw new AiRouterError("ai_cancelled", 408);
    if (
      typeof input.userId !== "string" ||
      !input.userId ||
      input.userId.length > 200 ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(input.captureId) ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(input.requestId) ||
      !Number.isFinite(expiry) ||
      expiry <= this.now() ||
      expiry > this.now() + 300_000 ||
      (input.expectedSettingsRevision !== undefined &&
        (!Number.isSafeInteger(input.expectedSettingsRevision) ||
          input.expectedSettingsRevision < 0))
    )
      throw new AiRouterError("ai_router_invalid_request", 400);
    const saved = await this.saved(input.userId);
    if (
      input.expectedSettingsRevision !== undefined &&
      input.expectedSettingsRevision !== saved.revision
    )
      throw new AiRouterError("ai_router_consent_changed", 403);
    const settings = this.effective(saved.settings);
    const maxOutputTokens = Math.min(this.config.maxOutputTokens, 8192);
    const select = (settings: AiRouterSettings) =>
      selectAiModelRoute({
        task: {
          category: "voice",
          dataCategories: [...AI_ROUTER_DATA_CATEGORIES],
        },
        settings: this.effective(settings),
        models: this.catalog(input.userId, "classification"),
        estimatedInputTokens: 3000,
        maxOutputTokens,
      });
    const decision = select(settings);
    if (decision.kind !== "selected")
      throw new AiRouterError("ai_router_" + decision.reason);
    const chosen = decision.candidates[0];
    const row = this.config.models.find((m) => m.model.id === chosen?.modelId);
    if (
      !row ||
      row.model.provider !== "openai" ||
      row.model.model !== CAPTURE_SPEECH_MODEL ||
      row.providerOnly.length ||
      !row.model.tiers.includes("voice") ||
      (row.model.audioCostMicrosPerMinute ?? 0) <
        CAPTURE_SPEECH_MIN_MICROS_PER_MINUTE
    )
      throw new AiRouterError("ai_router_audio_transport_unavailable");
    const key = this.credentials(input.userId, row, "classification")[0];
    const cost = estimateAiRouterSpeechCost(row.model);
    if (!key || cost === null)
      throw new AiRouterError("ai_router_pricing_unavailable");
    const keySecret = key.secret;
    const reviewed = JSON.stringify(row);
    const routing: AiRoutingAccounting = {
      version: 1,
      provider: "openai",
      model: row.model.model,
      selectedModelId: row.model.id,
      credentialLabel: key.id,
      billing: "api",
      attempts: 0,
      fallback: false,
      inputTokens: null,
      outputTokens: null,
      reportedCostMicros: null,
      costSource: "unknown",
    };
    const authorize: AiRouterPreparedSpeech["authorize"] = async () => {
      if (
        input.signal?.aborted ||
        this.now() >= expiry ||
        !this.config.enabled ||
        !this.config.paidRequestsEnabled
      )
        return false;
      try {
        const current = await this.saved(input.userId);
        if (
          input.signal?.aborted ||
          current.revision !== saved.revision ||
          this.now() >= expiry
        )
          return false;
        const next = select(current.settings);
        const currentRow = this.config.models.find(
          (v) => v.model.id === row.model.id,
        );
        const currentKey =
          currentRow &&
          this.credentials(input.userId, currentRow, "classification")[0];
        return (
          next.kind === "selected" &&
          next.candidates[0]?.modelId === row.model.id &&
          JSON.stringify(currentRow) === reviewed &&
          currentKey?.id === key.id &&
          currentKey?.secret === keySecret
        );
      } catch {
        return false;
      }
    };
    let dispatched = false;
    return {
      policy: {
        settingsRevision: saved.revision,
        modelId: row.model.id,
        provider: "openai",
        maxRequestCostMicros: cost,
      },
      authorize,
      adapter: {
        available: true,
        audioPricingVerified: true,
        reservation: {
          feature: "classification",
          estimatedInputTokens: 3000,
          maxOutputTokens,
          estimatedCostMicros: cost,
          maxRequestCostMicros: settings.spending.maxRequestCostMicros,
          maxUserDailyCostMicros: settings.spending.maxDailyCostMicros,
          timeoutMs: 20_000,
          routing,
        },
        transcribe: async ({ audio, signal }) => {
          if (!(await authorize("before_transcription")))
            throw new AiRouterError("ai_router_consent_changed", 403);
          if (signal.aborted) throw new AiGovernorError("ai_cancelled");
          if (dispatched) throw new AiGovernorError("ai_duplicate_request");
          dispatched = true;
          routing.attempts = 1;
          return callCaptureSpeechProvider(
            {
              audio,
              signal,
              apiKey: keySecret,
              model: row.model.model,
              audioCostMicrosPerMinute: row.model.audioCostMicrosPerMinute!,
              maxOutputTokens,
              routing,
            },
            this.dependencies.fetchImpl,
          );
        },
      },
    };
  }
  async execute(input: AiRouterExecutionInput): Promise<{
    text: string;
    modelRoute: AiModelRouteReceipt;
    usage?: RouterProviderResult["usage"];
  }> {
    if (!this.config.enabled) throw new AiRouterError("ai_router_disabled");
    if (input.task.category === "voice")
      throw new AiRouterError("ai_router_audio_transport_required", 400);
    if (this.config.freeProfileEnabled && !input.schemaKey)
      throw new AiRouterError("ai_router_trusted_schema_required", 400);
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
      estimateAiInputTokens(metered) +
      images * 80000 +
      (input.schemaKey
        ? estimateAiInputTokens(routerJsonSchema(input.schemaKey))
        : 0);
    if (images > 1) throw new AiRouterError("ai_router_invalid_request", 400);
    const saved = await this.saved(input.userId);
    if (
      input.expectedSettingsRevision !== undefined &&
      (!Number.isSafeInteger(input.expectedSettingsRevision) ||
        input.expectedSettingsRevision < 0 ||
        input.expectedSettingsRevision !== saved.revision)
    )
      throw new AiRouterError("ai_router_consent_changed", 403);
    const settings = this.effective(saved.settings);
    const publicInput = isPublicRouterInput(
      input.publicPrompt,
      messages,
      input.task,
      input.feature,
    );
    const catalog = this.catalog(input.userId, input.feature).map((model) => {
      if (!this.config.freeProfileEnabled) return model;
      const row = this.config.models.find(
        (item) => item.model.id === model.id,
      )!;
      const permitted = this.credentials(input.userId, row, input.feature).some(
        (key) => freeCredentialPermits(key, publicInput, this.now()),
      );
      return { ...model, authorized: model.authorized && permitted };
    });
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
      !this.config.freeProfileEnabled &&
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
        ...(input.timeoutMs !== undefined
          ? { timeoutMs: input.timeoutMs }
          : {}),
      },
      async (signal) => {
        let attempts = 0;
        let last: unknown;
        const quotaBlockedProviders = new Set<string>();
        for (const row of atomicOpenRouter ? [primary] : candidates) {
          if (
            this.config.freeProfileEnabled &&
            quotaBlockedProviders.has(row.model.provider)
          )
            continue;
          const keys = this.credentials(
            input.userId,
            row,
            input.feature,
          ).filter(
            (key) =>
              !this.config.freeProfileEnabled ||
              freeCredentialPermits(key, publicInput, this.now()),
          );
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
            if (this.config.freeProfileEnabled) {
              if (
                !key.quota ||
                !["gemini", "openrouter"].includes(key.provider)
              )
                throw new AiRouterError("ai_router_free_eligibility_required");
              const quota =
                await this.dependencies.governor!.reserveProviderAttempt(
                  {
                    userId: input.userId,
                    requestId,
                    feature: input.feature,
                    attempt: attempts + 1,
                    provider: key.provider as "gemini" | "openrouter",
                    quotaDomain: key.quota.domain,
                    model: row.model.model,
                    reservedTokens:
                      estimatedInputTokens + input.maxOutputTokens,
                    limits: key.quota.limits,
                  },
                  signal,
                );
              if (quota.outcome !== "reserved") {
                if (
                  ["cooldown", "minute_limit", "day_limit"].includes(
                    quota.outcome,
                  )
                ) {
                  quotaBlockedProviders.add(row.model.provider);
                  last = new RouterProviderError(
                    "quota_exceeded",
                    false,
                    false,
                    429,
                    quota.retryAt,
                  );
                  break;
                }
                throw new AiGovernorError(
                  quota.outcome === "duplicate"
                    ? "ai_duplicate_request"
                    : "ai_budget_unavailable",
                );
              }
              // The durable quota claim can wait on another transaction. Recheck
              // consent and this exact key after that wait, before dispatch.
              // An unused quota reservation remains conservative accounting.
              const dispatchPolicy = await this.saved(input.userId);
              if (signal.aborted) throw new AiGovernorError("ai_cancelled");
              if (dispatchPolicy.revision !== saved.revision)
                throw new AiRouterError("ai_router_consent_changed", 403);
              if (
                !freeCredentialPermits(key, publicInput, this.now()) ||
                freeModelReason(row, [key], this.now()) !== null
              )
                throw new AiRouterError("ai_router_model_unavailable");
            }
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
                  ...(input.schemaKey ? { schemaKey: input.schemaKey } : {}),
                  nowMs: this.now(),
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
                this.config.freeProfileEnabled &&
                error instanceof RouterProviderError &&
                error.code === "invalid_response" &&
                error.quotaReviewRequired
              ) {
                await this.dependencies.governor!.cooldownProviderQuota(
                  {
                    userId: input.userId,
                    requestId,
                    provider: key.provider as "gemini" | "openrouter",
                    quotaDomain: key.quota!.domain,
                    retryAt: null,
                    reviewRequired: true,
                  },
                  signal,
                );
                throw error;
              }
              if (
                this.config.freeProfileEnabled &&
                error instanceof RouterProviderError &&
                error.code === "quota_exceeded" &&
                error.httpStatus === 429
              ) {
                await this.dependencies.governor!.cooldownProviderQuota(
                  {
                    userId: input.userId,
                    requestId,
                    provider: key.provider as "gemini" | "openrouter",
                    quotaDomain: key.quota!.domain,
                    retryAt: error.retryAt ?? null,
                    reviewRequired: error.quotaReviewRequired,
                  },
                  signal,
                );
                quotaBlockedProviders.add(row.model.provider);
                if (signal.aborted) throw new AiGovernorError("ai_cancelled");
                if (
                  decision.fallbackAllowed &&
                  settings.fallback.allowProviderChange
                )
                  break;
                throw error;
              }
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
    router &&
    (router.config.enabled ||
      router.config.freeProfileEnabled ||
      router.config.configurationInvalid),
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
