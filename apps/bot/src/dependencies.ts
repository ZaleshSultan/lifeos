import {
  createLifeOSSupabaseClient,
  loadSupabaseConfig,
  SupabaseLifeOSStore,
  type LifeOSStore,
} from "@lifeos/db";

export interface BotDependencies {
  supabase?: ReturnType<typeof createLifeOSSupabaseClient>;
  store?: LifeOSStore;
}

export function createBotDependencies(
  source: NodeJS.ProcessEnv = process.env,
): BotDependencies {
  const hasSupabaseConfig = Boolean(
    source.SUPABASE_URL &&
    (source.SUPABASE_ANON_KEY || source.SUPABASE_SERVICE_ROLE_KEY),
  );

  if (!hasSupabaseConfig) {
    return {};
  }

  const config = loadSupabaseConfig(source);
  const supabase = createLifeOSSupabaseClient(config, {
    useServiceRole: Boolean(config.serviceRoleKey),
  });

  return {
    supabase,
    store: new SupabaseLifeOSStore(supabase),
  };
}
