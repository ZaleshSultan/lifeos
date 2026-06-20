import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, SupabaseConfig } from "./types.js";

export interface CreateLifeOSSupabaseClientOptions {
  useServiceRole?: boolean;
}

export function createLifeOSSupabaseClient(
  config: SupabaseConfig,
  options: CreateLifeOSSupabaseClientOptions = {},
): SupabaseClient<Database> {
  const key = options.useServiceRole
    ? config.serviceRoleKey
    : (config.anonKey ?? config.serviceRoleKey);

  if (!key) {
    throw new Error(
      "Supabase client requires SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient<Database>(config.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
