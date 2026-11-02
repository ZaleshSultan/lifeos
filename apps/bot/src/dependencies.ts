import {
  createLifeOSSupabaseClient,
  loadSupabaseConfig,
  SupabaseLifeOSStore,
  type LifeOSStore,
} from "@lifeos/db";
import { telegramIdListEnv } from "./config.js";

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

  // An anon-only client can silently hide profiles behind RLS and make an
  // existing account look unregistered. Production backend reads and writes
  // require the service-role boundary; never fall back to browser credentials.
  const config = loadSupabaseConfig(source, {
    requireServiceRole: source.NODE_ENV === "production",
  });
  const supabase = createLifeOSSupabaseClient(config, {
    useServiceRole: Boolean(config.serviceRoleKey),
  });

  return {
    supabase,
    store: new SupabaseLifeOSStore(supabase, {
      adminTelegramUserIds: telegramIdListEnv(
        source,
        "LIFEOS_ADMIN_TELEGRAM_IDS",
      ),
      encryptionKey:
        source.ENCRYPTION_KEY ??
        source.LIFEOS_ENCRYPTION_KEY ??
        source.LIFEOS_OAUTH_TOKEN_ENCRYPTION_KEY ??
        source.OAUTH_TOKEN_ENCRYPTION_KEY,
      allowPlaintextSecrets:
        (source.LIFEOS_ALLOW_PLAINTEXT_SECRETS === "true" ||
          source.LIFEOS_ALLOW_PLAINTEXT_OAUTH_TOKENS === "true") &&
        source.NODE_ENV !== "production",
    }),
  };
}
