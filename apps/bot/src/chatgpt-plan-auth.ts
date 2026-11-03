import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from "node:crypto";

/** This connection is separate from OpenAI API-key billing and native Codex login. */
export const CHATGPT_PLAN_ENDPOINTS = Object.freeze({
  issuer: "https://auth.openai.com",
  authorize: "https://auth.openai.com/api/accounts/authorize",
  token: "https://auth.openai.com/api/accounts/oauth/token",
  revoke: "https://auth.openai.com/api/accounts/oauth/revoke",
  jwks: "https://auth.openai.com/.well-known/jwks.json",
  resource: "https://api.openai.com/v1",
  manageUsage: "https://chatgpt.com/settings/usage",
});
export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  CHATGPT_PLAN_SCOPE,
];
const MAX_JSON_BYTES = 128 * 1024;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class ChatgptPlanError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ChatgptPlanError";
  }
}
function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new ChatgptPlanError(code);
}
function object(value: unknown): Record<string, unknown> {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    "chatgpt_invalid_response",
  );
  return value as Record<string, unknown>;
}
function secret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32_768 &&
    !/[\r\n\0]/.test(value)
  );
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function clientId(value: unknown): value is string {
  return (
    typeof value === "string" && /^oaiapp_[A-Za-z0-9_-]{1,192}$/.test(value)
  );
}
export function validateChatgptOwner(ownerId: string): void {
  requireValue(UUID.test(ownerId), "chatgpt_invalid_owner");
}
export function validateChatgptHostId(hostId: string): void {
  requireValue(
    /^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      hostId,
    ),
    "chatgpt_invalid_host",
  );
}
export function newChatgptHostId(): string {
  return "urn:uuid:" + randomUUID();
}
export function validateChatgptRedirect(redirectUri: string): void {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new ChatgptPlanError("chatgpt_invalid_callback");
  }
  requireValue(
    url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port &&
      Number(url.port) > 0 &&
      url.pathname === "/auth/callback" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password &&
      url.href === redirectUri,
    "chatgpt_invalid_callback",
  );
}
export interface ChatgptPlanCredentials {
  version: 1;
  ownerId: string;
  hostId: string;
  clientId: string;
  issuer: typeof CHATGPT_PLAN_ENDPOINTS.issuer;
  subject: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  scopes: string[];
  expiresAt: number;
  /** Local revocation/terminal-refresh marker; never inferred from a transient outage. */
  revoked: boolean;
}
/** A callback may issue a registration before token exchange succeeds. It is not a connection. */
export interface ChatgptPlanRegistration {
  version: 1;
  ownerId: string;
  hostId: string;
  clientId: string;
  subject: string | null;
}
export function validateChatgptRegistration(
  value: unknown,
): asserts value is ChatgptPlanRegistration {
  const v = object(value);
  validateChatgptOwner(v.ownerId as string);
  validateChatgptHostId(v.hostId as string);
  requireValue(
    Object.keys(v).every((key) =>
      ["version", "ownerId", "hostId", "clientId", "subject"].includes(key),
    ) &&
      v.version === 1 &&
      clientId(v.clientId) &&
      (v.subject === null ||
        (typeof v.subject === "string" &&
          v.subject.length > 0 &&
          v.subject.length <= 256)),
    "chatgpt_invalid_registration",
  );
}
export interface ChatgptAuthorizationAttempt {
  ownerId: string;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  clientId: string | null;
  subject: string | null;
  expiresAt: number;
  consumed: boolean;
}
export function createChatgptAuthorizationAttempt(input: {
  ownerId: string;
  hostId: string;
  redirectUri: string;
  browserConsent: boolean;
  existing?: ChatgptPlanCredentials | ChatgptPlanRegistration;
  now?: number;
}): { attempt: ChatgptAuthorizationAttempt; authorizationUrl: string } {
  requireValue(
    input.browserConsent === true,
    "chatgpt_browser_consent_required",
  );
  validateChatgptOwner(input.ownerId);
  validateChatgptHostId(input.hostId);
  validateChatgptRedirect(input.redirectUri);
  if (input.existing) {
    if ("accessToken" in input.existing)
      validateChatgptCredentials(input.existing);
    else validateChatgptRegistration(input.existing);
    requireValue(
      input.existing.ownerId === input.ownerId &&
        input.existing.hostId === input.hostId,
      "chatgpt_owner_or_host_mismatch",
    );
  }
  const attempt: ChatgptAuthorizationAttempt = {
    ownerId: input.ownerId,
    hostId: input.hostId,
    redirectUri: input.redirectUri,
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    clientId: input.existing?.clientId ?? null,
    subject: input.existing?.subject ?? null,
    expiresAt: (input.now ?? Date.now()) + 300_000,
    consumed: false,
  };
  const url = new URL(CHATGPT_PLAN_ENDPOINTS.authorize);
  const values = {
    client_id: attempt.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: input.hostId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: SCOPES.join(" "),
    resource: CHATGPT_PLAN_ENDPOINTS.resource,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256")
      .update(attempt.verifier)
      .digest("base64url"),
  };
  for (const [key, value] of Object.entries(values))
    url.searchParams.set(key, value);
  if (!attempt.clientId) url.searchParams.set("agent_name_hint", "LifeOS");
  // Deliberately omit id_token_hint: no token is ever placed in a generated URL.
  return { attempt, authorizationUrl: url.href };
}
type Fetcher = typeof fetch;
async function requestJson(
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new ChatgptPlanError(
      signal?.aborted ? "chatgpt_cancelled" : "chatgpt_transport_unavailable",
    );
  }
  const reader = response.body?.getReader();
  requireValue(reader, "chatgpt_invalid_response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      requireValue(bytes <= MAX_JSON_BYTES, "chatgpt_response_too_large");
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ChatgptPlanError) throw error;
    throw new ChatgptPlanError(
      signal?.aborted ? "chatgpt_cancelled" : "chatgpt_transport_unavailable",
    );
  } finally {
    await reader.cancel().catch(() => {});
  }
  let data: Record<string, unknown>;
  try {
    data = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new ChatgptPlanError("chatgpt_invalid_response");
  }
  if (!response.ok) {
    const code = typeof data.error === "string" ? data.error : "";
    const terminal = [
      "invalid_grant",
      "invalid_refresh_token",
      "token_expired",
      "refresh_token_expired",
      "refresh_token_invalidated",
      "refresh_token_reused",
    ];
    throw new ChatgptPlanError(
      terminal.includes(code)
        ? "chatgpt_reauthorization_required"
        : response.status === 429
          ? "chatgpt_usage_limit"
          : response.status === 401 || response.status === 403
            ? "chatgpt_permission_required"
            : "chatgpt_transport_unavailable",
    );
  }
  return data;
}
async function jwks(
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<JsonWebKey[]> {
  const data = await requestJson(
    CHATGPT_PLAN_ENDPOINTS.jwks,
    { method: "GET" },
    fetcher,
    signal,
  );
  requireValue(
    Array.isArray(data.keys) && data.keys.length > 0 && data.keys.length <= 16,
    "chatgpt_invalid_jwks",
  );
  return data.keys as JsonWebKey[];
}
/** Strict RS256 OIDC validation; an unverified email never establishes account ownership. */
export function verifyChatgptIdentity(
  token: string,
  input: {
    clientId: string;
    nonce?: string;
    subject?: string;
    keys: JsonWebKey[];
    now?: number;
  },
): { subject: string } {
  requireValue(
    secret(token) && clientId(input.clientId),
    "chatgpt_invalid_identity",
  );
  const parts = token.split(".");
  requireValue(
    parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)),
    "chatgpt_invalid_identity",
  );
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = object(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    );
    claims = object(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
  } catch {
    throw new ChatgptPlanError("chatgpt_invalid_identity");
  }
  requireValue(
    header.alg === "RS256" &&
      typeof header.kid === "string" &&
      !header.crit &&
      !header.jku &&
      !header.x5u,
    "chatgpt_invalid_identity",
  );
  const keys = input.keys.filter(
    (k) =>
      k &&
      typeof k === "object" &&
      !Array.isArray(k) &&
      k.kty === "RSA" &&
      k.kid === header.kid &&
      (!k.alg || k.alg === "RS256") &&
      (!k.use || k.use === "sig") &&
      (k.key_ops === undefined ||
        (Array.isArray(k.key_ops) && k.key_ops.includes("verify"))),
  );
  requireValue(keys.length === 1, "chatgpt_invalid_identity");
  try {
    const key = createPublicKey({ key: keys[0], format: "jwk" });
    requireValue(
      verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        key,
        Buffer.from(parts[2], "base64url"),
      ),
      "chatgpt_invalid_identity",
    );
  } catch {
    throw new ChatgptPlanError("chatgpt_invalid_identity");
  }
  const now = Math.floor((input.now ?? Date.now()) / 1000),
    audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  requireValue(
    claims.iss === CHATGPT_PLAN_ENDPOINTS.issuer &&
      audiences.length > 0 &&
      audiences.every((a) => typeof a === "string") &&
      audiences.includes(input.clientId),
    "chatgpt_invalid_identity",
  );
  requireValue(
    audiences.length === 1
      ? !claims.azp || claims.azp === input.clientId
      : claims.azp === input.clientId,
    "chatgpt_invalid_identity",
  );
  requireValue(
    Number.isSafeInteger(claims.exp) &&
      (claims.exp as number) > now &&
      Number.isSafeInteger(claims.iat) &&
      (claims.iat as number) <= now + 60 &&
      (claims.iat as number) < (claims.exp as number),
    "chatgpt_invalid_identity",
  );
  requireValue(
    claims.nbf === undefined ||
      (Number.isSafeInteger(claims.nbf) && (claims.nbf as number) <= now),
    "chatgpt_invalid_identity",
  );
  requireValue(
    typeof claims.sub === "string" &&
      claims.sub.length > 0 &&
      claims.sub.length <= 256,
    "chatgpt_invalid_identity",
  );
  if (input.nonce !== undefined)
    requireValue(
      typeof claims.nonce === "string" && equal(claims.nonce, input.nonce),
      "chatgpt_invalid_identity",
    );
  if (input.subject !== undefined)
    requireValue(claims.sub === input.subject, "chatgpt_account_mismatch");
  return { subject: claims.sub };
}
function credentialsFromTokens(
  data: Record<string, unknown>,
  context: {
    ownerId: string;
    hostId: string;
    clientId: string;
    subject: string;
    now: number;
    previous?: ChatgptPlanCredentials;
  },
): ChatgptPlanCredentials {
  requireValue(
    (data.token_type === "Bearer" ||
      (data.token_type === undefined && !data.access_token)) &&
      (data.access_token === undefined || secret(data.access_token)) &&
      (data.refresh_token === undefined || secret(data.refresh_token)) &&
      secret(data.id_token ?? context.previous?.idToken),
    "chatgpt_invalid_response",
  );
  requireValue(
    Number.isSafeInteger(data.expires_in) &&
      (data.expires_in as number) > 0 &&
      (data.expires_in as number) <= 86_400,
    "chatgpt_invalid_response",
  );
  requireValue(
    typeof data.scope === "string" ||
      (data.scope === undefined && context.previous),
    "chatgpt_invalid_response",
  );
  const scopes =
    typeof data.scope === "string"
      ? data.scope.split(/\s+/).filter(Boolean)
      : context.previous!.scopes;
  requireValue(
    scopes.length > 0 &&
      scopes.length <= 32 &&
      scopes.every((s) => /^[a-zA-Z0-9:._-]{1,100}$/.test(s)) &&
      scopes.includes("openid"),
    "chatgpt_invalid_response",
  );
  const accessToken = (data.access_token ?? null) as string | null;
  const refreshToken = (data.refresh_token ??
    context.previous?.refreshToken ??
    null) as string | null;
  requireValue(
    !scopes.includes(CHATGPT_PLAN_SCOPE) ||
      (secret(accessToken) && secret(refreshToken)),
    "chatgpt_invalid_response",
  );
  return {
    version: 1,
    ownerId: context.ownerId,
    hostId: context.hostId,
    clientId: context.clientId,
    issuer: CHATGPT_PLAN_ENDPOINTS.issuer,
    subject: context.subject,
    accessToken,
    refreshToken,
    idToken: (data.id_token ?? context.previous?.idToken) as string,
    scopes: [...new Set(scopes)],
    expiresAt: context.now + (data.expires_in as number) * 1000,
    revoked: false,
  };
}
export async function completeChatgptAuthorization(
  attempt: ChatgptAuthorizationAttempt,
  callbackUrl: string,
  options: {
    fetcher?: Fetcher;
    now?: number;
    signal?: AbortSignal;
    onRegistration?: (registration: ChatgptPlanRegistration) => Promise<void>;
  } = {},
): Promise<ChatgptPlanCredentials> {
  const now = options.now ?? Date.now();
  requireValue(
    !attempt.consumed &&
      now < attempt.expiresAt &&
      now >= attempt.expiresAt - 300_000,
    "chatgpt_attempt_expired",
  );
  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new ChatgptPlanError("chatgpt_invalid_callback");
  }
  requireValue(
    callback.origin + callback.pathname === attempt.redirectUri &&
      !callback.hash &&
      !callback.username &&
      !callback.password,
    "chatgpt_invalid_callback",
  );
  for (const key of callback.searchParams.keys())
    requireValue(
      callback.searchParams.getAll(key).length === 1,
      "chatgpt_invalid_callback",
    );
  const state = callback.searchParams.get("state");
  requireValue(
    typeof state === "string" && equal(state, attempt.state),
    "chatgpt_invalid_state",
  );
  attempt.consumed = true; // One callback/code exchange only, even if networking is ambiguous.
  if (callback.searchParams.has("error"))
    throw new ChatgptPlanError("chatgpt_consent_declined");
  const code = callback.searchParams.get("code"),
    issued = callback.searchParams.get("client_id") ?? attempt.clientId;
  requireValue(
    secret(code) &&
      clientId(issued) &&
      (!attempt.clientId || issued === attempt.clientId),
    "chatgpt_invalid_callback",
  );
  attempt.clientId = issued; // Retain a newly issued registration through an invalid_grant result.
  await options.onRegistration?.({
    version: 1,
    ownerId: attempt.ownerId,
    hostId: attempt.hostId,
    clientId: issued,
    subject: attempt.subject,
  });
  const fetcher = options.fetcher ?? fetch;
  const data = await requestJson(
    CHATGPT_PLAN_ENDPOINTS.token,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: issued,
        code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        resource: CHATGPT_PLAN_ENDPOINTS.resource,
      }),
    },
    fetcher,
    options.signal,
  );
  requireValue(secret(data.id_token), "chatgpt_invalid_identity");
  const identity = verifyChatgptIdentity(data.id_token, {
    clientId: issued,
    nonce: attempt.nonce,
    subject: attempt.subject ?? undefined,
    keys: await jwks(fetcher, options.signal),
    now,
  });
  return credentialsFromTokens(data, {
    ownerId: attempt.ownerId,
    hostId: attempt.hostId,
    clientId: issued,
    subject: identity.subject,
    now,
  });
}
export function validateChatgptCredentials(
  value: unknown,
): asserts value is ChatgptPlanCredentials {
  const v = object(value);
  requireValue(
    Object.keys(v).every((key) =>
      [
        "version",
        "ownerId",
        "hostId",
        "clientId",
        "issuer",
        "subject",
        "accessToken",
        "refreshToken",
        "idToken",
        "scopes",
        "expiresAt",
        "revoked",
      ].includes(key),
    ),
    "chatgpt_invalid_credentials",
  );
  validateChatgptOwner(v.ownerId as string);
  validateChatgptHostId(v.hostId as string);
  requireValue(
    v.version === 1 &&
      v.issuer === CHATGPT_PLAN_ENDPOINTS.issuer &&
      clientId(v.clientId) &&
      secret(v.subject) &&
      (v.accessToken === null || secret(v.accessToken)) &&
      (v.refreshToken === null || secret(v.refreshToken)) &&
      (secret(v.idToken) || (v.revoked === true && v.idToken === null)) &&
      Number.isSafeInteger(v.expiresAt) &&
      typeof v.revoked === "boolean",
    "chatgpt_invalid_credentials",
  );
  requireValue(
    Array.isArray(v.scopes) &&
      v.scopes.length <= 32 &&
      v.scopes.every(
        (s) => typeof s === "string" && /^[a-zA-Z0-9:._-]{1,100}$/.test(s),
      ) &&
      v.scopes.includes("openid"),
    "chatgpt_invalid_credentials",
  );
}
export function chatgptPlanConnectionStatus(
  credentials?: ChatgptPlanCredentials,
  now = Date.now(),
) {
  if (credentials) validateChatgptCredentials(credentials);
  const identityConnected = Boolean(credentials && !credentials.revoked);
  const planUsageAuthorized = Boolean(
    identityConnected &&
    credentials!.scopes.includes(CHATGPT_PLAN_SCOPE) &&
    credentials!.accessToken &&
    credentials!.refreshToken,
  );
  return {
    prepared: true,
    identityConnected,
    planUsageAuthorized,
    usesApiCredits: false,
    manageUsageUrl: CHATGPT_PLAN_ENDPOINTS.manageUsage,
    status: !credentials
      ? "permission_required"
      : credentials.revoked
        ? "revoked"
        : credentials.expiresAt <= now
          ? "expired"
          : planUsageAuthorized
            ? "connected"
            : "permission_required",
    liveInferenceVerified: false,
  } as const;
}
/** Caller must hold the credential-file lock across refresh and atomic save. No automatic retry. */
export async function refreshChatgptCredentials(
  credentials: ChatgptPlanCredentials,
  options: { fetcher?: Fetcher; now?: number; signal?: AbortSignal } = {},
): Promise<ChatgptPlanCredentials> {
  validateChatgptCredentials(credentials);
  requireValue(
    !credentials.revoked && credentials.refreshToken,
    "chatgpt_reauthorization_required",
  );
  const fetcher = options.fetcher ?? fetch,
    now = options.now ?? Date.now();
  const data = await requestJson(
    CHATGPT_PLAN_ENDPOINTS.token,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        refresh_token: credentials.refreshToken,
        resource: CHATGPT_PLAN_ENDPOINTS.resource,
      }),
    },
    fetcher,
    options.signal,
  );
  // A refresh renews an existing grant; it cannot supply fresh browser consent.
  requireValue(
    secret(data.access_token) && data.access_token.trim().length > 0,
    "chatgpt_invalid_response",
  );
  requireValue(
    data.scope === undefined || typeof data.scope === "string",
    "chatgpt_invalid_response",
  );
  if (typeof data.scope === "string") {
    const granted = data.scope.split(/\s+/).filter(Boolean);
    requireValue(
      granted.every((scope) => credentials.scopes.includes(scope)),
      "chatgpt_scope_escalation",
    );
  }
  if (data.id_token !== undefined) {
    requireValue(secret(data.id_token), "chatgpt_invalid_identity");
    verifyChatgptIdentity(data.id_token, {
      clientId: credentials.clientId,
      subject: credentials.subject,
      keys: await jwks(fetcher, options.signal),
      now,
    });
  }
  return credentialsFromTokens(data, {
    ownerId: credentials.ownerId,
    hostId: credentials.hostId,
    clientId: credentials.clientId,
    subject: credentials.subject,
    now,
    previous: credentials,
  });
}
/** 200 with no body is success; failed revocation never pretends the remote grant was removed. */
export async function revokeChatgptCredentials(
  credentials: ChatgptPlanCredentials,
  options: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<{ revoked: true }> {
  validateChatgptCredentials(credentials);
  requireValue(credentials.refreshToken, "chatgpt_revocation_unconfirmed");
  try {
    const response = await (options.fetcher ?? fetch)(
      CHATGPT_PLAN_ENDPOINTS.revoke,
      {
        method: "POST",
        redirect: "error",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: credentials.refreshToken,
          token_type_hint: "refresh_token",
          client_id: credentials.clientId,
        }),
      },
    );
    await response.body?.cancel();
    requireValue(response.status === 200, "chatgpt_revocation_unconfirmed");
    return { revoked: true };
  } catch {
    throw new ChatgptPlanError("chatgpt_revocation_unconfirmed");
  }
}
