import { optionalEnv, requiredEnv, urlEnv, type EnvSource } from "@lifeos/core";
import type { SupabaseConfig } from "./types.js";

export interface LoadSupabaseConfigOptions {
  requireServiceRole?: boolean;
}

export function loadSupabaseConfig(
  source: EnvSource = process.env,
  options: LoadSupabaseConfigOptions = {},
): SupabaseConfig {
  const url = urlEnv(source, "SUPABASE_URL");
  const anonKey = optionalEnv(source, "SUPABASE_ANON_KEY");
  const serviceRoleKey = options.requireServiceRole
    ? requiredEnv(source, "SUPABASE_SERVICE_ROLE_KEY")
    : optionalEnv(source, "SUPABASE_SERVICE_ROLE_KEY");

  if (!anonKey && !serviceRoleKey) {
    requiredEnv(source, "SUPABASE_ANON_KEY");
  }

  return {
    url,
    anonKey,
    serviceRoleKey,
  };
}
