import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
export const HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
interface HealthIngestTokenPayload {
  userId: string;
  telegramUserId: number | null;
  scope: "health_ingest";
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export function signHealthIngestToken(
  user: TelegramUserRecord,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: HealthIngestTokenPayload = {
    userId: user.userId,
    telegramUserId: user.telegramUserId,
    scope: "health_ingest",
    nonce: randomBytes(32).toString("hex"),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS,
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8",
  ).toString("base64url");
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signingInput = `${header}.${encoded}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

export function verifyHealthIngestToken(
  token: string | undefined,
  secret: string | undefined,
): HealthIngestTokenPayload | null {
  if (!token || !secret || token.length > 2048) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  if (
    !/^[A-Za-z0-9_-]{43}$/.test(parts[2]) ||
    !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as { alg?: unknown; typ?: unknown };
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Partial<HealthIngestTokenPayload>;
    if (header.alg !== "HS256" || header.typ !== "JWT") {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);

    if (
      typeof payload.userId !== "string" ||
      !payload.userId ||
      payload.userId.length > 200 ||
      (typeof payload.telegramUserId !== "number" &&
        payload.telegramUserId !== null) ||
      payload.scope !== "health_ingest" ||
      typeof payload.nonce !== "string" ||
      !/^[0-9a-f]{64}$/.test(payload.nonce) ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt <= 0 ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt <= now ||
      payload.issuedAt - now > 30 ||
      payload.expiresAt - payload.issuedAt > HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      telegramUserId: payload.telegramUserId,
      scope: "health_ingest",
      nonce: payload.nonce,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

export function hashHealthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export async function issueHealthCredential(
  store: LifeOSStore,
  user: TelegramUserRecord,
  secret: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const token = signHealthIngestToken(user, secret, now);
  const deviceId = await store.issueHealthIngestCredential({
    userId: user.userId,
    tokenHash: hashHealthToken(token),
    expiresAt: new Date(
      (now + HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS) * 1000,
    ).toISOString(),
  });
  return deviceId
    ? {
        token,
        deviceId,
        tokenType: "Bearer" as const,
        expiresInSeconds: HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS,
      }
    : null;
}
export async function resolveHealthCredential(
  store: LifeOSStore,
  token: string | undefined,
  secret: string | undefined,
): Promise<string | null> {
  const payload = verifyHealthIngestToken(token, secret);
  if (!payload || !token) return null;
  if (
    !(await store.resolveHealthIngestCredential(
      payload.userId,
      hashHealthToken(token),
    ))
  )
    return null;
  const user = await store.resolveUserById(payload.userId);
  return user?.status === "active" ? user.userId : null;
}
