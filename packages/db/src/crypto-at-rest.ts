import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION_PREFIX = "enc:v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface CryptoAtRestOptions {
  /**
   * Optional authenticated associated data. Use it to bind ciphertext to a
   * table/column/user/provider context without storing that context in the
   * ciphertext itself.
   */
  aad?: string;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION_PREFIX}:`);
}

export function loadEncryptionKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const raw =
    env.ENCRYPTION_KEY ??
    env.LIFEOS_ENCRYPTION_KEY ??
    env.LIFEOS_OAUTH_TOKEN_ENCRYPTION_KEY ??
    env.OAUTH_TOKEN_ENCRYPTION_KEY;

  if (!raw?.trim()) {
    throw new Error(
      "ENCRYPTION_KEY is required. Generate it with: openssl rand -base64 32",
    );
  }

  return parseEncryptionKey(raw);
}

export function parseEncryptionKey(raw: string | Buffer): Buffer {
  if (Buffer.isBuffer(raw)) {
    assertKey(raw);
    return raw;
  }

  const value = raw.trim();

  if (/^[a-f0-9]{64}$/i.test(value)) {
    const key = Buffer.from(value, "hex");
    assertKey(key);
    return key;
  }

  const base64Key = tryDecodeBase64(value);
  if (base64Key?.length === KEY_BYTES) {
    return base64Key;
  }

  const utf8Key = Buffer.from(value, "utf8");
  if (utf8Key.length === KEY_BYTES) {
    return utf8Key;
  }

  throw new Error(
    "ENCRYPTION_KEY must decode to exactly 32 bytes. Recommended: openssl rand -base64 32",
  );
}

export function encryptSecret(
  plaintext: string | null,
  key: Buffer,
  options: CryptoAtRestOptions = {},
): string | null {
  if (plaintext === null) {
    return null;
  }

  if (isEncryptedSecret(plaintext)) {
    return plaintext;
  }

  assertKey(key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;

  if (options.aad) {
    cipher.setAAD(Buffer.from(options.aad, "utf8"));
  }

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    VERSION_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(
  encryptedValue: string | null,
  key: Buffer,
  options: CryptoAtRestOptions = {},
): string | null {
  if (encryptedValue === null) {
    return null;
  }

  assertKey(key);

  const parts = encryptedValue.split(":");

  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== VERSION_PREFIX) {
    throw new Error("Encrypted secret has invalid enc:v1 format");
  }

  const iv = Buffer.from(parts[2] ?? "", "base64url");
  const tag = Buffer.from(parts[3] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[4] ?? "", "base64url");

  if (iv.length !== IV_BYTES) {
    throw new Error("Encrypted secret has invalid IV length");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;

  if (options.aad) {
    decipher.setAAD(Buffer.from(options.aad, "utf8"));
  }

  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error("AES-256-GCM key must be exactly 32 bytes");
  }
}

function tryDecodeBase64(value: string): Buffer | null {
  const normalized = value.trim();

  if (normalized.length % 4 !== 0) {
    return null;
  }

  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    return null;
  }

  const decoded = Buffer.from(normalized, "base64");
  const canonical = decoded.toString("base64");

  return canonical === normalized ? decoded : null;
}
