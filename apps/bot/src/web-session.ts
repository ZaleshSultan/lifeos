import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";

export const WEB_LOGIN_TTL_SECONDS = 120;
export const WEB_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface WebLoginPayload {
  purpose: "web_login";
  userId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export function hashWebToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createWebLoginToken(
  userId: string,
  secret: string,
  ttlSeconds = WEB_LOGIN_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    !secret ||
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > WEB_LOGIN_TTL_SECONDS
  ) {
    throw new Error("Invalid web login configuration");
  }
  const payload: WebLoginPayload = {
    purpose: "web_login",
    userId,
    nonce: randomBytes(32).toString("base64url"),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

export function verifyWebLoginToken(
  token: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebLoginPayload | null {
  if (!token || !secret || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    return null;
  const expected = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as WebLoginPayload;
    if (
      !payload ||
      payload.purpose !== "web_login" ||
      typeof payload.userId !== "string" ||
      !payload.userId ||
      typeof payload.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce) ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > nowSeconds ||
      payload.expiresAt <= nowSeconds ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt - payload.issuedAt > WEB_LOGIN_TTL_SECONDS
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

export function createWebSessionToken(): string {
  return `ws1_${randomBytes(32).toString("base64url")}`;
}

export function isWebSessionToken(token: string | undefined): token is string {
  return typeof token === "string" && /^ws1_[A-Za-z0-9_-]{43}$/.test(token);
}

export async function issueWebLoginToken(
  store: LifeOSStore,
  userId: string,
  secret: string,
): Promise<string> {
  const token = createWebLoginToken(userId, secret);
  const payload = verifyWebLoginToken(token, secret)!;
  const issued = await store.issueWebLoginToken({
    userId,
    tokenHash: hashWebToken(token),
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  });
  if (!issued) throw new Error("Web login unavailable");
  return token;
}

export async function exchangeWebLoginToken(
  store: LifeOSStore,
  token: string | undefined,
  secret: string | undefined,
) {
  const payload = verifyWebLoginToken(token, secret);
  if (!payload || !token) return null;
  const sessionToken = createWebSessionToken();
  const expiresAt = await store.exchangeWebLoginToken({
    userId: payload.userId,
    tokenHash: hashWebToken(token),
    sessionHash: hashWebToken(sessionToken),
  });
  return expiresAt ? { token: sessionToken, expiresAt } : null;
}

// This is an identity lookup at the auth boundary, like resolveTelegramUser.
// Resource queries must subsequently use the resolved userId, never caller input.
export async function resolveWebSessionUser(
  store: LifeOSStore,
  token: string | undefined,
): Promise<TelegramUserRecord | null> {
  if (!isWebSessionToken(token)) return null;
  const userId = await store.resolveWebSession(hashWebToken(token));
  if (!userId) return null;
  const user = await store.resolveUserById(userId);
  return user?.status === "active" ? user : null;
}
