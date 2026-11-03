import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_EXECUTION_FEATURES,
  AI_ROUTER_PROVIDERS,
  dailyLifeTimestamp,
  defaultAiRouterSettings,
  isAiRouterModelId,
  parseAiRouterSettings,
  type AiRouterSettings,
  type AiRouterUsageEntry,
  type AiRoutingAccounting,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

export interface AiRouterSavedSettings {
  settings: AiRouterSettings;
  revision: number;
}

export interface AiRouterSettingsStore {
  get(userId: string): Promise<AiRouterSavedSettings>;
  getRecent?(userId: string): Promise<AiRouterUsageEntry[]>;
  save(
    userId: string,
    settings: AiRouterSettings,
    expectedRevision: number,
  ): Promise<AiRouterSavedSettings>;
}

export class AiRouterSettingsConflictError extends Error {
  constructor() {
    super("Router settings changed; reload before saving.");
    this.name = "AiRouterSettingsConflictError";
  }
}

function revision(value: unknown, persisted = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (persisted ? 1 : 0) ||
    value > (persisted ? 2_147_483_647 : 2_147_483_646)
  )
    throw new Error("Invalid router settings revision");
  return value;
}

function saved(value: unknown): AiRouterSavedSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved router settings");
  const row = value as Record<string, unknown>;
  return {
    settings: parseAiRouterSettings(row.settings),
    revision: revision(row.revision, true),
  };
}

function unavailable(error: { message: string } | null) {
  if (!error) return;
  if (error.message === "ai_router_settings_conflict")
    throw new AiRouterSettingsConflictError();
  throw new Error("Router settings storage unavailable");
}

interface UsageClient {
  from(table: "ai_execution_reservations"): {
    select(columns: string): {
      eq(
        column: "user_id",
        value: string,
      ): {
        not(
          column: "routing",
          operator: "is",
          value: null,
        ): {
          order(
            column: "created_at",
            options: { ascending: false },
          ): {
            limit(count: number): PromiseLike<{
              data: unknown;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
}

function cost(value: unknown): number | null {
  if (value === null) return null;
  const parsed =
    typeof value === "string" && /^[0-9]{1,13}$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > 1_000_000_000_000
  )
    throw new Error("Invalid saved router usage");
  return parsed;
}

function usageMetadata(value: unknown): AiRoutingAccounting {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved router usage");
  const v = value as Record<string, unknown>;
  const fields = [
    "version",
    "provider",
    "model",
    "selectedModelId",
    "credentialLabel",
    "billing",
    "attempts",
    "fallback",
    "inputTokens",
    "outputTokens",
    "reportedCostMicros",
    "costSource",
  ];
  if (
    Object.keys(v).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(v, key)) ||
    v.version !== 1 ||
    !AI_ROUTER_PROVIDERS.includes(v.provider as never) ||
    !isAiRouterModelId(v.model) ||
    !isAiRouterModelId(v.selectedModelId) ||
    typeof v.credentialLabel !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v.credentialLabel) ||
    !["api", "free", "chatgpt_plan"].includes(v.billing as string) ||
    (v.provider === "chatgpt_plan") !== (v.billing === "chatgpt_plan") ||
    typeof v.attempts !== "number" ||
    !Number.isInteger(v.attempts) ||
    v.attempts < 1 ||
    v.attempts > 3 ||
    typeof v.fallback !== "boolean" ||
    !["provider_reported", "rate_estimate", "unknown"].includes(
      v.costSource as string,
    )
  )
    throw new Error("Invalid saved router usage");
  const tokens = (n: unknown): number | null => {
    if (n === null) return null;
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n > 10_000_000
    )
      throw new Error("Invalid saved router usage");
    return n;
  };
  // JSONB numeric fields never require the PostgREST bigint string compatibility.
  if (v.reportedCostMicros !== null && typeof v.reportedCostMicros !== "number")
    throw new Error("Invalid saved router usage");
  const reportedCostMicros = cost(v.reportedCostMicros);
  if (
    (v.billing === "chatgpt_plan" &&
      (reportedCostMicros !== null || v.costSource !== "unknown")) ||
    (v.billing === "free" &&
      reportedCostMicros !== null &&
      reportedCostMicros !== 0)
  )
    throw new Error("Invalid saved router usage");
  return {
    version: 1,
    provider: v.provider as AiRoutingAccounting["provider"],
    model: v.model,
    selectedModelId: v.selectedModelId,
    credentialLabel: v.credentialLabel,
    billing: v.billing as AiRoutingAccounting["billing"],
    attempts: v.attempts,
    fallback: v.fallback,
    inputTokens: tokens(v.inputTokens),
    outputTokens: tokens(v.outputTokens),
    reportedCostMicros,
    costSource: v.costSource as AiRoutingAccounting["costSource"],
  };
}

function usageEntry(value: unknown): AiRouterUsageEntry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved router usage");
  const v = value as Record<string, unknown>;
  if (
    !AI_EXECUTION_FEATURES.includes(v.feature as never) ||
    !["reserved", "completed", "failed", "cancelled", "timed_out"].includes(
      v.state as string,
    )
  )
    throw new Error("Invalid saved router usage");
  const routing = usageMetadata(v.routing),
    reportedCostMicros = cost(v.reported_cost_micros),
    estimatedCostMicros = cost(v.estimated_cost_micros);
  if (
    reportedCostMicros !== routing.reportedCostMicros ||
    (routing.billing === "chatgpt_plan" && estimatedCostMicros !== null)
  )
    throw new Error("Invalid saved router usage");
  return {
    feature: v.feature as AiRouterUsageEntry["feature"],
    state: v.state as AiRouterUsageEntry["state"],
    createdAt: dailyLifeTimestamp(v.created_at),
    estimatedCostMicros,
    reportedCostMicros,
    routing,
  };
}

export function createAiRouterSettingsStore(
  client: SupabaseClient<Database>,
): AiRouterSettingsStore {
  return {
    async get(userId) {
      const { data, error } = await client
        .from("ai_router_settings")
        .select("settings,revision")
        .eq("user_id", userId)
        .maybeSingle();
      unavailable(error);
      // Absence is not a saved opt-in and never writes a demonstration row.
      return data
        ? saved(data)
        : { settings: defaultAiRouterSettings(), revision: 0 };
    },
    async getRecent(userId) {
      const { data, error } = await (client as unknown as UsageClient)
        .from("ai_execution_reservations")
        .select(
          "feature,state,created_at,estimated_cost_micros,reported_cost_micros,routing",
        )
        .eq("user_id", userId)
        .not("routing", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      unavailable(error);
      if (!Array.isArray(data) || data.length > 20)
        throw new Error("Invalid saved router usage");
      return data.map(usageEntry);
    },
    async save(userId, settings, expectedRevision) {
      const parsed = parseAiRouterSettings(settings);
      const expected = revision(expectedRevision);
      const { data, error } = await client.rpc("save_ai_router_settings", {
        p_user_id: userId,
        p_settings: parsed as unknown as Json,
        p_expected_revision: expected,
      });
      unavailable(error);
      return saved(data);
    },
  };
}
