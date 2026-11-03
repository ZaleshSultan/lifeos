import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chmod, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHATGPT_PLAN_ENDPOINTS,
  CHATGPT_PLAN_SCOPE,
  chatgptPlanConnectionStatus,
  completeChatgptAuthorization,
  createChatgptAuthorizationAttempt,
  newChatgptHostId,
  refreshChatgptCredentials,
  revokeChatgptCredentials,
  verifyChatgptIdentity,
  type ChatgptPlanCredentials,
} from "./chatgpt-plan-auth.js";
import {
  ChatgptPlanVault,
  openChatgptCredentials,
  sealChatgptCredentials,
} from "./chatgpt-plan-vault.js";
import {
  buildChatgptPlanRequest,
  readChatgptPlanCompletion,
} from "./chatgpt-plan-protocol.js";

const OWNER = "10000000-0000-4000-8000-000000000001",
  OTHER = "10000000-0000-4000-8000-000000000002";
const HOST = "urn:uuid:10000000-0000-4000-8000-000000000003",
  CLIENT = "oaiapp_fixture_client";
const NOW = Date.parse("2026-11-03T12:00:00Z"),
  REDIRECT = "http://127.0.0.1:1455/auth/callback";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "fixture",
  alg: "RS256",
  use: "sig",
};
function token(
  nonce = "nonce",
  changes: Record<string, unknown> = {},
  headerChanges: Record<string, unknown> = {},
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "fixture", ...headerChanges }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: CHATGPT_PLAN_ENDPOINTS.issuer,
      aud: CLIENT,
      sub: "fixture-subject",
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
      nonce,
      ...changes,
    }),
  ).toString("base64url");
  return (
    header +
    "." +
    payload +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(header + "." + payload),
      pair.privateKey,
    ).toString("base64url")
  );
}
function attempt(existing?: ChatgptPlanCredentials) {
  return createChatgptAuthorizationAttempt({
    ownerId: OWNER,
    hostId: HOST,
    redirectUri: REDIRECT,
    browserConsent: true,
    existing,
    now: NOW,
  });
}
function credentials(
  changes: Partial<ChatgptPlanCredentials> = {},
): ChatgptPlanCredentials {
  return {
    version: 1,
    ownerId: OWNER,
    hostId: HOST,
    clientId: CLIENT,
    issuer: CHATGPT_PLAN_ENDPOINTS.issuer,
    subject: "fixture-subject",
    accessToken: "synthetic-access-secret",
    refreshToken: "synthetic-refresh-secret",
    idToken: token(),
    scopes: ["openid", CHATGPT_PLAN_SCOPE],
    expiresAt: NOW + 3600_000,
    revoked: false,
    ...changes,
  };
}
function mockFetch(nonce: string, changes: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(
    async (url) =>
      new Response(
        JSON.stringify(
          url === CHATGPT_PLAN_ENDPOINTS.jwks
            ? { keys: [jwk] }
            : {
                token_type: "Bearer",
                access_token: "synthetic-access-secret",
                refresh_token: "synthetic-refresh-secret",
                id_token: token(nonce),
                scope:
                  "openid profile email offline_access resource.invoke " +
                  CHATGPT_PLAN_SCOPE,
                expires_in: 3600,
                ...changes,
              },
        ),
        { status: 200 },
      ),
  );
}
const callback = (state: string, extra = "&client_id=" + CLIENT) =>
  REDIRECT + "?state=" + state + "&code=synthetic-code" + extra;
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function folder() {
  const path = await mkdtemp(join(tmpdir(), "lifeos-chatgpt-test-"));
  directories.push(path);
  return path;
}

describe("prepared ChatGPT plan OAuth", () => {
  it("requires explicit browser consent and only accepts the owner's loopback callback", () => {
    expect(() =>
      createChatgptAuthorizationAttempt({
        ownerId: OWNER,
        hostId: HOST,
        redirectUri: REDIRECT,
        browserConsent: false,
      }),
    ).toThrow("chatgpt_browser_consent_required");
    for (const redirectUri of [
      "https://lifeos.example/auth/callback",
      "http://localhost:1455/auth/callback",
      "http://127.0.0.1:1455/callback",
      REDIRECT + "?next=other",
    ])
      expect(() =>
        createChatgptAuthorizationAttempt({
          ownerId: OWNER,
          hostId: HOST,
          redirectUri,
          browserConsent: true,
        }),
      ).toThrow("chatgpt_invalid_callback");
  });
  it("registers dynamically with strong independent state/nonce/S256 and no token hints", () => {
    const first = attempt(),
      second = attempt(),
      url = new URL(first.authorizationUrl);
    expect(url.origin + url.pathname).toBe(CHATGPT_PLAN_ENDPOINTS.authorize);
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("agent_name_hint")).toBe("LifeOS");
    expect(url.searchParams.get("scope")).toContain(CHATGPT_PLAN_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe(
      first.attempt.verifier,
    );
    expect(first.attempt.state).not.toBe(first.attempt.nonce);
    expect(first.attempt.state).not.toBe(second.attempt.state);
    expect(url.searchParams.has("id_token_hint")).toBe(false);
    expect(newChatgptHostId()).toMatch(/^urn:uuid:/);
  });
  it("exchanges once at the fixed token endpoint and validates cryptographic identity", async () => {
    const { attempt: pending } = attempt(),
      fetcher = mockFetch(pending.nonce);
    const result = await completeChatgptAuthorization(
      pending,
      callback(pending.state),
      { fetcher, now: NOW },
    );
    expect(result.subject).toBe("fixture-subject");
    expect(result.clientId).toBe(CLIENT);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      CHATGPT_PLAN_ENDPOINTS.token,
      CHATGPT_PLAN_ENDPOINTS.jwks,
    ]);
    const init = fetcher.mock.calls[0][1]!;
    expect(init.redirect).toBe("error");
    const form = init.body as URLSearchParams;
    expect(form.get("code_verifier")).toBe(pending.verifier);
    expect(form.get("redirect_uri")).toBe(REDIRECT);
    expect(form.get("client_id")).toBe(CLIENT);
    expect(form.has("client_secret")).toBe(false);
    expect(chatgptPlanConnectionStatus(result, NOW)).toMatchObject({
      identityConnected: true,
      planUsageAuthorized: true,
      usesApiCredits: false,
      liveInferenceVerified: false,
    });
    await expect(
      completeChatgptAuthorization(pending, callback(pending.state), {
        fetcher,
        now: NOW,
      }),
    ).rejects.toThrow("chatgpt_attempt_expired");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects wrong/duplicate state, mismatched ports and declined consent without networking", async () => {
    const { attempt: pending } = attempt(),
      fetcher = mockFetch(pending.nonce);
    await expect(
      completeChatgptAuthorization(pending, callback("wrong"), {
        fetcher,
        now: NOW,
      }),
    ).rejects.toThrow("chatgpt_invalid_state");
    await expect(
      completeChatgptAuthorization(
        pending,
        callback(pending.state) + "&state=" + pending.state,
        { fetcher, now: NOW },
      ),
    ).rejects.toThrow("chatgpt_invalid_callback");
    await expect(
      completeChatgptAuthorization(
        pending,
        callback(pending.state).replace(":1455", ":54321"),
        { fetcher, now: NOW },
      ),
    ).rejects.toThrow("chatgpt_invalid_callback");
    await expect(
      completeChatgptAuthorization(
        pending,
        REDIRECT + "?state=" + pending.state + "&error=access_denied",
        { fetcher, now: NOW },
      ),
    ).rejects.toThrow("chatgpt_consent_declined");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps identity separate from the token response's plan-sharing permission", async () => {
    const { attempt: pending } = attempt(),
      fetcher = mockFetch(pending.nonce, {
        scope: "openid profile email",
        access_token: undefined,
        refresh_token: undefined,
      });
    const result = await completeChatgptAuthorization(
      pending,
      callback(pending.state) + "&scope=" + CHATGPT_PLAN_SCOPE,
      { fetcher, now: NOW },
    );
    expect(chatgptPlanConnectionStatus(result, NOW)).toMatchObject({
      identityConnected: true,
      planUsageAuthorized: false,
      status: "permission_required",
    });
    await expect(
      refreshChatgptCredentials(result, { fetcher, now: NOW }),
    ).rejects.toThrow("chatgpt_reauthorization_required");
  });
  it("reuses the issued registration and rejects returning client/account replacement", async () => {
    const old = credentials(),
      { attempt: pending, authorizationUrl } = attempt(old);
    expect(new URL(authorizationUrl).searchParams.get("client_id")).toBe(
      CLIENT,
    );
    expect(new URL(authorizationUrl).searchParams.has("agent_name_hint")).toBe(
      false,
    );
    await expect(
      completeChatgptAuthorization(
        pending,
        callback(pending.state, "&client_id=oaiapp_other"),
        { fetcher: mockFetch(pending.nonce), now: NOW },
      ),
    ).rejects.toThrow("chatgpt_invalid_callback");
    const fresh = attempt(old).attempt;
    await expect(
      completeChatgptAuthorization(fresh, callback(fresh.state, ""), {
        fetcher: mockFetch(fresh.nonce, {
          id_token: token(fresh.nonce, { sub: "different-account" }),
        }),
        now: NOW,
      }),
    ).rejects.toThrow("chatgpt_account_mismatch");
  });
  it.each([
    { iss: "https://attacker.example" },
    { aud: "oaiapp_other" },
    { exp: NOW / 1000 },
    { nonce: "other" },
    { iat: NOW / 1000 + 300 },
    { aud: [CLIENT, "other"] },
  ])("rejects signed invalid OIDC claims %j", (changes) => {
    expect(() =>
      verifyChatgptIdentity(token("nonce", changes), {
        clientId: CLIENT,
        nonce: "nonce",
        keys: [jwk],
        now: NOW,
      }),
    ).toThrow("chatgpt_invalid_identity");
  });
  it("rejects algorithm confusion, signature tampering and remote-key injection", () => {
    for (const value of [
      token("nonce", {}, { alg: "none" }),
      token("nonce", {}, { jku: "https://attacker.example" }),
      token().slice(0, -8) + "tampered",
    ])
      expect(() =>
        verifyChatgptIdentity(value, {
          clientId: CLIENT,
          nonce: "nonce",
          keys: [jwk],
          now: NOW,
        }),
      ).toThrow("chatgpt_invalid_identity");
  });
  it("rotates refresh credentials with the saved client and no scope escalation", async () => {
    const fetcher = mockFetch("nonce", {
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      scope: undefined,
      id_token: undefined,
    });
    const result = await refreshChatgptCredentials(credentials(), {
      fetcher,
      now: NOW,
    });
    expect(result.refreshToken).toBe("rotated-refresh");
    expect(result.scopes).toEqual(credentials().scopes);
    const form = fetcher.mock.calls[0][1]!.body as URLSearchParams;
    expect(form.get("client_id")).toBe(CLIENT);
    expect(form.has("scope")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never upgrades identity-only or existing plan scopes through refresh", async () => {
    for (const initialScopes of [
      ["openid", "offline_access"],
      ["openid", CHATGPT_PLAN_SCOPE],
    ]) {
      const original = credentials({ scopes: initialScopes }),
        before = structuredClone(original);
      const fetcher = mockFetch("nonce", {
        scope:
          initialScopes.join(" ") +
          " " +
          (initialScopes.includes(CHATGPT_PLAN_SCOPE)
            ? "new.permission"
            : CHATGPT_PLAN_SCOPE),
        id_token: undefined,
      });
      await expect(
        refreshChatgptCredentials(original, { fetcher, now: NOW + 300_000 }),
      ).rejects.toThrow("chatgpt_scope_escalation");
      expect(original).toEqual(before);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("does not extend an old access token when refresh omits a fresh nonempty token", async () => {
    for (const access_token of [undefined, "", "   "]) {
      const original = credentials(),
        before = structuredClone(original);
      const fetcher = mockFetch("nonce", {
        access_token,
        expires_in: 7200,
        scope: undefined,
        id_token: undefined,
      });
      await expect(
        refreshChatgptCredentials(original, { fetcher, now: NOW + 300_000 }),
      ).rejects.toThrow("chatgpt_invalid_response");
      expect(original).toEqual(before);
      expect(original.expiresAt).toBe(NOW + 3600_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("distinguishes terminal refresh revocation from temporary failures and sanitizes errors", async () => {
    const old = credentials(),
      terminal = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              detail: old.refreshToken,
            }),
            { status: 400 },
          ),
      );
    await expect(
      refreshChatgptCredentials(old, { fetcher: terminal, now: NOW }),
    ).rejects.toThrow("chatgpt_reauthorization_required");
    const outage = vi.fn<typeof fetch>(async () => {
      throw new Error(old.refreshToken!);
    });
    await expect(
      refreshChatgptCredentials(old, { fetcher: outage, now: NOW }),
    ).rejects.toThrow("chatgpt_transport_unavailable");
    expect(old.revoked).toBe(false);
    expect(outage).toHaveBeenCalledTimes(1);
  });
  it("requires renewed consent for revoked records and reports revocation accurately", async () => {
    const revoked = credentials({
      revoked: true,
      accessToken: null,
      refreshToken: null,
      idToken: null,
    });
    expect(chatgptPlanConnectionStatus(revoked, NOW)).toMatchObject({
      status: "revoked",
      identityConnected: false,
      planUsageAuthorized: false,
    });
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    await expect(
      refreshChatgptCredentials(revoked, { fetcher }),
    ).rejects.toThrow("chatgpt_reauthorization_required");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      revokeChatgptCredentials(credentials(), { fetcher }),
    ).resolves.toEqual({ revoked: true });
    expect(fetcher.mock.calls[0][0]).toBe(CHATGPT_PLAN_ENDPOINTS.revoke);
    expect(fetcher.mock.calls[0][1]!.redirect).toBe("error");
    await expect(
      revokeChatgptCredentials(credentials(), {
        fetcher: vi.fn(async () => new Response(null, { status: 503 })),
      }),
    ).rejects.toThrow("chatgpt_revocation_unconfirmed");
  });
});

describe("owner/host encrypted companion vault", () => {
  it("persists a newly issued registration before an unsuccessful exchange without claiming identity", async () => {
    const path = await folder(),
      vault = new ChatgptPlanVault(path, OWNER);
    await vault.initialize();
    const pending = createChatgptAuthorizationAttempt({
      ownerId: OWNER,
      hostId: vault.getHostId(),
      redirectUri: REDIRECT,
      browserConsent: true,
      now: NOW,
    }).attempt;
    const fetcher = vi.fn<typeof fetch>(async () => {
      expect((await vault.loadRegistration())?.clientId).toBe(CLIENT);
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      });
    });
    await expect(
      vault.withLock(() =>
        completeChatgptAuthorization(pending, callback(pending.state), {
          fetcher,
          now: NOW,
          onRegistration: (value) => vault.saveRegistration(value),
        }),
      ),
    ).rejects.toThrow("chatgpt_reauthorization_required");
    const reopened = new ChatgptPlanVault(path, OWNER);
    await reopened.initialize();
    const registration = await reopened.loadRegistration();
    expect(registration).toMatchObject({ clientId: CLIENT, subject: null });
    expect(chatgptPlanConnectionStatus(await reopened.load())).toMatchObject({
      identityConnected: false,
      planUsageAuthorized: false,
    });
    const retry = createChatgptAuthorizationAttempt({
      ownerId: OWNER,
      hostId: reopened.getHostId(),
      redirectUri: REDIRECT,
      browserConsent: true,
      existing: registration,
      now: NOW,
    });
    expect(new URL(retry.authorizationUrl).searchParams.get("client_id")).toBe(
      CLIENT,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("authenticates the owner and host in ciphertext without exposing tokens", () => {
    const key = randomBytes(32),
      value = credentials(),
      encrypted = sealChatgptCredentials(value, key);
    expect(JSON.stringify(encrypted)).not.toContain(value.refreshToken);
    expect(openChatgptCredentials(encrypted, key, OWNER, HOST)).toEqual(value);
    expect(() =>
      openChatgptCredentials(
        { ...encrypted, ownerId: OTHER },
        key,
        OTHER,
        HOST,
      ),
    ).toThrow("chatgpt_invalid_encrypted_credentials");
    expect(() =>
      openChatgptCredentials(encrypted, key, OWNER, newChatgptHostId()),
    ).toThrow("chatgpt_owner_or_host_mismatch");
    expect(() =>
      openChatgptCredentials(encrypted, randomBytes(32), OWNER, HOST),
    ).toThrow("chatgpt_invalid_encrypted_credentials");
  });
  it("persists a private stable host and enforces one refresh/save lock across processes", async () => {
    const path = await folder(),
      a = new ChatgptPlanVault(path, OWNER);
    await a.initialize();
    await expect(
      a.save(credentials({ hostId: a.getHostId() })),
    ).rejects.toThrow("chatgpt_session_lock_required");
    await a.withLock(async () => {
      const b = new ChatgptPlanVault(path, OWNER);
      await b.initialize();
      expect(b.getHostId()).toBe(a.getHostId());
      await expect(b.withLock(async () => undefined)).rejects.toThrow(
        "chatgpt_session_busy",
      );
      await a.save(credentials({ hostId: a.getHostId() }));
    });
    expect((await stat(join(path, "key.bin"))).mode & 0o077).toBe(0);
    expect((await stat(join(path, "connection.enc"))).mode & 0o077).toBe(0);
    expect((await a.load())?.subject).toBe("fixture-subject");
  });
  it("imports protected credentials for the same owner and preserves the VM host ID", async () => {
    const laptop = new ChatgptPlanVault(await folder(), OWNER),
      vm = new ChatgptPlanVault(await folder(), OWNER);
    await laptop.initialize();
    await vm.initialize();
    await laptop.withLock(() =>
      laptop.save(credentials({ hostId: laptop.getHostId() })),
    );
    const vmHost = vm.getHostId();
    expect(vmHost).not.toBe(laptop.getHostId());
    await vm.withLock(() =>
      vm.import(
        join(laptop.directory, "connection.enc"),
        join(laptop.directory, "key.bin"),
      ),
    );
    expect(vm.getHostId()).toBe(vmHost);
    expect((await vm.load())?.hostId).toBe(vmHost);
    expect((await vm.load())?.clientId).toBe(CLIENT);
    const other = new ChatgptPlanVault(await folder(), OTHER);
    await other.initialize();
    await expect(
      other.withLock(() =>
        other.import(
          join(laptop.directory, "connection.enc"),
          join(laptop.directory, "key.bin"),
        ),
      ),
    ).rejects.toThrow("chatgpt_owner_or_host_mismatch");
  });
  it("rejects broad permissions and symlinked private state", async () => {
    const path = await folder();
    await chmod(path, 0o755);
    await expect(
      new ChatgptPlanVault(path, OWNER).initialize(),
    ).rejects.toThrow("chatgpt_private_directory_required");
    await chmod(path, 0o700);
    const target = await folder();
    await symlink(target, join(path, "link"));
    await expect(
      new ChatgptPlanVault(join(path, "link"), OWNER).initialize(),
    ).rejects.toThrow("chatgpt_private_directory_required");
    const vault = new ChatgptPlanVault(path, OWNER);
    await vault.initialize();
    await chmod(join(path, "key.bin"), 0o644);
    await expect(
      new ChatgptPlanVault(path, OWNER).initialize(),
    ).rejects.toThrow("chatgpt_private_file_required");
  });
});

function stream(events: unknown[]) {
  return new Response(
    events
      .map(
        (event) =>
          "data: " +
          (typeof event === "string" ? event : JSON.stringify(event)) +
          "\n\n",
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const delta = { type: "response.output_text.delta", delta: "A safe answer." };
const done = {
  type: "response.completed",
  response: {
    status: "completed",
    model: "fixture-model",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "A safe answer." }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
  },
};
describe("ChatGPT plan Responses preview contract", () => {
  it("builds only the supported text request subset", () => {
    const body = buildChatgptPlanRequest({
      model: "fixture-model",
      messages: [{ role: "user", text: "Test" }],
    });
    expect(body).toMatchObject({
      store: false,
      stream: true,
      input: [{ role: "user", content: "Test" }],
    });
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(() =>
      buildChatgptPlanRequest({
        ...body,
        messages: [{ role: "user", text: "Test" }],
        max_output_tokens: 8,
      } as never),
    ).toThrow("chatgpt_unsupported_request");
    expect(() =>
      buildChatgptPlanRequest({
        model: "fixture-model",
        messages: [{ role: "system", text: "Test" }],
      } as never),
    ).toThrow("chatgpt_unsupported_request");
  });
  it("returns text and actual usage only after response.completed", async () => {
    await expect(
      readChatgptPlanCompletion(stream([delta, done, "[DONE]"]), {
        expectedModel: "fixture-model",
        maxOutputBytes: 100,
      }),
    ).resolves.toEqual({
      text: "A safe answer.",
      model: "fixture-model",
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    });
  });
  it("accepts benign message and reasoning metadata in the text-only flow", async () => {
    const events = [
      { type: "response.created", response: { output: [] } },
      {
        type: "response.output_item.added",
        item: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Benign metadata" }],
        },
      },
      {
        type: "response.output_item.added",
        item: { type: "message", role: "assistant", content: [] },
      },
      {
        type: "response.content_part.added",
        part: { type: "output_text", text: "" },
      },
      delta,
      done,
    ];
    await expect(
      readChatgptPlanCompletion(stream(events), {
        expectedModel: "fixture-model",
        maxOutputBytes: 100,
      }),
    ).resolves.toMatchObject({ text: "A safe answer." });
  });
  it.each([
    "function_call",
    "web_search_call",
    "code_interpreter_call",
    "mcp_call",
  ])(
    "rejects unrequested %s output before accepting text completion",
    async (type) => {
      await expect(
        readChatgptPlanCompletion(
          stream([
            { type: "response.output_item.added", item: { type } },
            delta,
            done,
          ]),
          { expectedModel: "fixture-model", maxOutputBytes: 100 },
        ),
      ).rejects.toThrow("chatgpt_unsupported_output");
      const final = {
        ...done,
        response: {
          ...done.response,
          output: [...done.response.output, { type }],
        },
      };
      await expect(
        readChatgptPlanCompletion(stream([delta, final]), {
          expectedModel: "fixture-model",
          maxOutputBytes: 100,
        }),
      ).rejects.toThrow("chatgpt_unsupported_output");
    },
  );
  it("rejects undeclared tool events and inconsistent final text", async () => {
    await expect(
      readChatgptPlanCompletion(
        stream([
          { type: "response.function_call_arguments.delta", delta: "{}" },
          delta,
          done,
        ]),
        { expectedModel: "fixture-model", maxOutputBytes: 100 },
      ),
    ).rejects.toThrow("chatgpt_unsupported_output");
    const inconsistent = {
      ...done,
      response: {
        ...done.response,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Different text" }],
          },
        ],
      },
    };
    await expect(
      readChatgptPlanCompletion(stream([delta, inconsistent]), {
        expectedModel: "fixture-model",
        maxOutputBytes: 100,
      }),
    ).rejects.toThrow("chatgpt_invalid_stream");
  });
  it("times out a stalled stream even without caller cancellation or EOF, including after completion", async () => {
    vi.useFakeTimers();
    for (const afterCompletion of [false, true]) {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (afterCompletion)
            controller.enqueue(
              new TextEncoder().encode(
                [delta, done]
                  .map((event) => "data: " + JSON.stringify(event) + "\n\n")
                  .join(""),
              ),
            );
        },
        cancel,
      });
      const response = new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
      const pending = expect(
        readChatgptPlanCompletion(response, {
          expectedModel: "fixture-model",
          maxOutputBytes: 100,
        }),
      ).rejects.toThrow("chatgpt_timeout");
      await vi.advanceTimersByTimeAsync(20_001);
      await pending;
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it("allows only shorter reader deadlines", async () => {
    await expect(
      readChatgptPlanCompletion(stream([delta, done]), {
        expectedModel: "fixture-model",
        maxOutputBytes: 100,
        timeoutMs: 20_001,
      }),
    ).rejects.toThrow("chatgpt_invalid_deadline");
  });
  it.each([
    [delta],
    [delta, "[DONE]"],
    [{ type: "response.failed" }],
    [
      delta,
      {
        type: "response.failed",
        response: {
          error: { code: "subscription_sharing_usage_limit_exceeded" },
        },
      },
    ],
    [delta, { type: "response.incomplete" }],
  ])(
    "never treats partial or failed inference as successful: %j",
    async (...events) => {
      await expect(
        readChatgptPlanCompletion(stream(events), {
          expectedModel: "fixture-model",
          maxOutputBytes: 100,
        }),
      ).rejects.toThrow(
        /chatgpt_(?:inference_not_completed|stream_interrupted)/,
      );
    },
  );
  it("enforces cancellation, output bounds and expected model", async () => {
    await expect(
      readChatgptPlanCompletion(stream([delta, done]), {
        expectedModel: "fixture-model",
        maxOutputBytes: 2,
      }),
    ).rejects.toThrow("chatgpt_output_limit");
    await expect(
      readChatgptPlanCompletion(stream([delta, done]), {
        expectedModel: "unapproved-model",
        maxOutputBytes: 100,
      }),
    ).rejects.toThrow("chatgpt_invalid_stream");
    const controller = new AbortController();
    controller.abort();
    await expect(
      readChatgptPlanCompletion(stream([delta, done]), {
        signal: controller.signal,
        expectedModel: "fixture-model",
        maxOutputBytes: 100,
      }),
    ).rejects.toThrow("chatgpt_cancelled");
  });
  it("rejects a late stream error even after a completed event was seen", async () => {
    await expect(
      readChatgptPlanCompletion(
        stream([delta, done, { type: "response.failed" }]),
        { expectedModel: "fixture-model", maxOutputBytes: 100 },
      ),
    ).rejects.toThrow("chatgpt_invalid_stream");
  });
});
