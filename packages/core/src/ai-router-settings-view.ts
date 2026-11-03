import type {
  AiRouterModel,
  AiRouterProviderId,
  AiRouterSettings,
} from "./ai-model-router.js";

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
}

export interface AiRouterSettingsSnapshot {
  settings: AiRouterSettings;
  revision: number;
  providers: AiRouterProviderStatus[];
  models: AiRouterModel[];
  operatorLimits: {
    routerEnabled?: boolean;
    maxRequestCostMicros: number | null;
    maxDailyCostMicros: number | null;
    paidRequestsEnabled: boolean;
    maxOutputTokens: number;
  };
  chatgptPlan: {
    status: "prepared" | "permission_required" | "disabled";
    identityConnected: boolean;
    planUsageAuthorized: boolean;
    usesApiCredits: false;
    manageUsageUrl: string;
  };
}
