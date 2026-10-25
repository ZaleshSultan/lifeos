import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

export interface WebSessionStore {
  issueWebLoginToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<boolean>;
  exchangeWebLoginToken(input: {
    userId: string;
    tokenHash: string;
    sessionHash: string;
  }): Promise<string | null>;
  resolveWebSession(sessionHash: string): Promise<string | null>;
  revokeWebSession(userId: string, sessionHash: string): Promise<void>;
}

// Never propagate database diagnostics: constraint errors may include credential hashes.
export function webSessionStore(
  client: SupabaseClient<Database>,
): WebSessionStore {
  return {
    async issueWebLoginToken({ userId, tokenHash, expiresAt }) {
      const { data, error } = await client.rpc("issue_web_login_token", {
        p_user_id: userId,
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      });
      if (error) throw new Error("Web login storage unavailable");
      return data === true;
    },
    async exchangeWebLoginToken({ userId, tokenHash, sessionHash }) {
      const { data, error } = await client.rpc("exchange_web_login_token", {
        p_user_id: userId,
        p_token_hash: tokenHash,
        p_session_hash: sessionHash,
      });
      if (error) throw new Error("Web login exchange unavailable");
      return data;
    },
    async resolveWebSession(sessionHash) {
      const { data, error } = await client.rpc("resolve_web_session", {
        p_session_hash: sessionHash,
      });
      if (error) throw new Error("Web session storage unavailable");
      return data;
    },
    async revokeWebSession(userId, sessionHash) {
      const { error } = await client.rpc("revoke_web_session", {
        p_user_id: userId,
        p_session_hash: sessionHash,
      });
      if (error) throw new Error("Web session revocation unavailable");
    },
  };
}
