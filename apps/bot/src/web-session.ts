import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebSessionPayload {
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createWebSessionToken(
  userId: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: WebSessionPayload = {
    userId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyWebSessionToken(
  token: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
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
    if (
      typeof payload.userId !== "string" ||
      !payload.userId ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= nowSeconds ||
      payload.issuedAt > nowSeconds + 300 ||
      payload.expiresAt - payload.issuedAt > DEFAULT_TTL_SECONDS
    ) {
      return null;
    }
    return payload as WebSessionPayload;
  } catch {
    return null;
  }
}
