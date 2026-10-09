import { createHmac, timingSafeEqual } from "node:crypto";

export type WebTokenPurpose = "login" | "session";

export interface WebSessionPayload {
  userId: string;
  issuedAt: number;
  expiresAt: number;
  purpose?: WebTokenPurpose;
}

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_LOGIN_TTL_SECONDS = 5 * 60;
const MAX_LOGIN_TTL_SECONDS = 10 * 60;

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createWebToken(
  userId: string,
  secret: string,
  purpose: WebTokenPurpose,
  ttlSeconds: number,
  nowSeconds: number,
): string {
  const payload: WebSessionPayload = {
    userId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
    purpose,
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

export function createWebSessionToken(
  userId: string,
  secret: string,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return createWebToken(
    userId,
    secret,
    "session",
    ttlSeconds,
    nowSeconds,
  );
}

export function createWebLoginToken(
  userId: string,
  secret: string,
  ttlSeconds = DEFAULT_LOGIN_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return createWebToken(
    userId,
    secret,
    "login",
    ttlSeconds,
    nowSeconds,
  );
}

function verifyWebToken(
  token: string | undefined,
  secret: string | undefined,
  purpose: WebTokenPurpose,
  maxTtlSeconds: number,
  nowSeconds: number,
  allowLegacySession = false,
): WebSessionPayload | null {
  if (!token || !secret) return null;

  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;

  const expected = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  if (!secureEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<WebSessionPayload>;

    const validPurpose =
      payload.purpose === purpose ||
      (allowLegacySession &&
        purpose === "session" &&
        payload.purpose === undefined);

    if (
      typeof payload.userId !== "string" ||
      !payload.userId ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      !validPurpose ||
      payload.expiresAt <= nowSeconds ||
      payload.issuedAt > nowSeconds + 300 ||
      payload.expiresAt - payload.issuedAt > maxTtlSeconds
    ) {
      return null;
    }

    return payload as WebSessionPayload;
  } catch {
    return null;
  }
}

export function verifyWebSessionToken(
  token: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebSessionPayload | null {
  return verifyWebToken(
    token,
    secret,
    "session",
    DEFAULT_SESSION_TTL_SECONDS,
    nowSeconds,
    true,
  );
}

export function verifyWebLoginToken(
  token: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebSessionPayload | null {
  return verifyWebToken(
    token,
    secret,
    "login",
    MAX_LOGIN_TTL_SECONDS,
    nowSeconds,
  );
}
