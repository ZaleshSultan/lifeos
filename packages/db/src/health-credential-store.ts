import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";
export interface HealthCredentialStore {
  issueHealthIngestCredential(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<string | null>;
  resolveHealthIngestCredential(
    userId: string,
    tokenHash: string,
  ): Promise<boolean>;
  revokeHealthIngestCredential(userId: string, deviceId: string): Promise<void>;
  listHealthIngestCredentials(
    userId: string,
  ): Promise<
    {
      deviceId: string;
      createdAt: string;
      expiresAt: string;
      revokedAt: string | null;
    }[]
  >;
}
// Database diagnostics may include credential hashes; propagate only fixed errors.
export function healthCredentialStore(
  client: SupabaseClient<Database>,
): HealthCredentialStore {
  return {
    async issueHealthIngestCredential({ userId, tokenHash, expiresAt }) {
      const { data, error } = await client.rpc(
        "issue_health_ingest_credential",
        { p_user_id: userId, p_token_hash: tokenHash, p_expires_at: expiresAt },
      );
      if (error) throw new Error("Health credential storage unavailable");
      return data;
    },
    async resolveHealthIngestCredential(userId, tokenHash) {
      const { data, error } = await client.rpc(
        "resolve_health_ingest_credential",
        { p_user_id: userId, p_token_hash: tokenHash },
      );
      if (error) throw new Error("Health credential storage unavailable");
      return data === true;
    },
    async revokeHealthIngestCredential(userId, deviceId) {
      const { error } = await client.rpc("revoke_health_ingest_credential", {
        p_user_id: userId,
        p_device_id: deviceId,
      });
      if (error) throw new Error("Health credential revocation unavailable");
    },
    async listHealthIngestCredentials(userId) {
      const { data, error } = await client.rpc(
        "list_health_ingest_credentials",
        { p_user_id: userId },
      );
      if (error) throw new Error("Health credential storage unavailable");
      return (data ?? []).map((row) => ({
        deviceId: row.device_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      }));
    },
  };
}
