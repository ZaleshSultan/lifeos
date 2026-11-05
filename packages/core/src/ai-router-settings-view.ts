import type {
  AiRouterModel,
  AiRouterProviderId,
  AiRouterSettings,
} from "./ai-model-router.js";
import type {
  AiExecutionFeature,
  AiExecutionState,
  AiRoutingAccounting,
} from "./ai-execution.js";

/** Owner-scoped metadata only, with no user/request IDs or prompt text. */
export interface AiRouterUsageEntry {
  feature: AiExecutionFeature;
  state: AiExecutionState | "reserved";
  createdAt: string;
  estimatedCostMicros: number | null;
  reportedCostMicros: number | null;
  routing: AiRoutingAccounting;
}

/** Safe authenticated projection. Credentials and provider URLs are never fields. */
export interface AiRouterProviderStatus {
  id: AiRouterProviderId;
  status:
    | "not_configured"
    | "configured_unverified"
    | "permission_required"
    | "disabled"
    | "available"
    | "expired";
  credentialLabels: string[];
  verified: boolean;
  freeRouting?: {
    status:
      | "disabled"
      | "not_configured"
      | "metadata_required"
      | "quota_unavailable"
      | "prepared"
      | "cooldown"
      | "review_required";
    localRequestsToday: number | null;
    localDailyLimit: number | null;
    retryAt: string | null;
    providerRemaining: null;
  };
}

export interface AiRouterSettingsSnapshot {
  settings: AiRouterSettings;
  revision: number;
  providers: AiRouterProviderStatus[];
  models: AiRouterModel[];
  recentExecutions?: AiRouterUsageEntry[];
  operatorLimits: {
    routerEnabled?: boolean;
    maxRequestCostMicros: number | null;
    maxDailyCostMicros: number | null;
    paidRequestsEnabled: boolean;
    maxOutputTokens: number;
    freeProfileEnabled?: boolean;
    freeOnly?: boolean;
  };
  chatgptPlan: {
    status: "prepared" | "permission_required" | "disabled";
    identityConnected: boolean;
    planUsageAuthorized: boolean;
    usesApiCredits: false;
    manageUsageUrl: string;
  };
}
