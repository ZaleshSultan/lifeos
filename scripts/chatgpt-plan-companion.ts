/** Owner-run local companion. No arguments means no disk writes, network, or browser launch. */
import { createServer } from "node:http";
import { resolve } from "node:path";
import {
  ChatgptPlanError,
  chatgptPlanConnectionStatus,
  completeChatgptAuthorization,
  createChatgptAuthorizationAttempt,
  refreshChatgptCredentials,
  revokeChatgptCredentials,
  type ChatgptPlanCredentials,
  type ChatgptPlanRegistration,
} from "../apps/bot/src/chatgpt-plan-auth.js";
import { ChatgptPlanVault } from "../apps/bot/src/chatgpt-plan-vault.js";

const HELP = `LifeOS ChatGPT plan connection companion (prepared; live integration unverified).

Run locally on the owner's device:
  pnpm exec tsx scripts/chatgpt-plan-companion.ts --status --owner-id UUID --state-dir /absolute/private/path
  pnpm exec tsx scripts/chatgpt-plan-companion.ts --connect --consent --owner-device --owner-id UUID --state-dir /absolute/private/path

The connect command prints an OpenAI authorization URL and waits on 127.0.0.1.
Open that URL in your own browser and review the actual OpenAI permission screen.
No browser is launched automatically. This command makes no inference request.

After an owner-authorized secure transfer of connection.enc and key.bin, import
on the VM with --import --consent --source-envelope PATH --source-key PATH and
the VM's own --state-dir/--owner-id. Never overwrite the VM's host-id file.
Existing connections support --refresh --consent or --revoke --consent.
No API key, OAuth token, cookie or password is accepted as a CLI argument.`;

function parse(args: string[]) {
  const flags = new Set<string>(),
    values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (
      [
        "--owner-id",
        "--state-dir",
        "--source-envelope",
        "--source-key",
      ].includes(key)
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--") || values.has(key))
        throw new ChatgptPlanError("chatgpt_invalid_companion_arguments");
      values.set(key, value);
    } else if (
      [
        "--status",
        "--connect",
        "--owner-device",
        "--consent",
        "--refresh",
        "--revoke",
        "--import",
      ].includes(key) &&
      !flags.has(key)
    )
      flags.add(key);
    else throw new ChatgptPlanError("chatgpt_invalid_companion_arguments");
  }
  const operations = [
    "--status",
    "--connect",
    "--refresh",
    "--revoke",
    "--import",
  ].filter((key) => flags.has(key));
  if (
    operations.length !== 1 ||
    !values.get("--owner-id") ||
    !values.get("--state-dir") ||
    (operations[0] !== "--status" && !flags.has("--consent"))
  )
    throw new ChatgptPlanError("chatgpt_explicit_consent_required");
  return { flags, values, operation: operations[0] };
}
async function connect(
  vault: ChatgptPlanVault,
  existing?: ChatgptPlanCredentials | ChatgptPlanRegistration,
) {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY)
    throw new ChatgptPlanError("chatgpt_run_on_owner_device");
  const server = createServer();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((done, reject) => {
      server.once("error", () =>
        reject(new ChatgptPlanError("chatgpt_callback_listener_unavailable")),
      );
      server.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new ChatgptPlanError("chatgpt_callback_listener_unavailable");
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const { attempt, authorizationUrl } = createChatgptAuthorizationAttempt({
      ownerId: vault.ownerId,
      hostId: vault.getHostId(),
      redirectUri,
      browserConsent: true,
      existing,
    });
    const completed = new Promise<ChatgptPlanCredentials>((done, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ChatgptPlanError("chatgpt_attempt_expired"));
      }, 300_000);
      server.on("request", async (request, response) => {
        response.setHeader("cache-control", "no-store");
        response.setHeader("referrer-policy", "no-referrer");
        response.setHeader(
          "content-security-policy",
          "default-src 'none'; frame-ancestors 'none'",
        );
        response.setHeader("content-type", "text/plain; charset=utf-8");
        if (
          request.method !== "GET" ||
          request.headers.host !== `127.0.0.1:${address.port}` ||
          !request.url?.startsWith("/auth/callback?")
        ) {
          response.writeHead(400).end("Invalid callback.");
          return;
        }
        if (attempt.consumed) {
          response.writeHead(409).end("Callback already received.");
          return;
        }
        try {
          const credentials = await completeChatgptAuthorization(
            attempt,
            new URL(request.url, redirectUri).href,
            {
              signal: controller.signal,
              onRegistration: (value) => vault.saveRegistration(value),
            },
          );
          response
            .writeHead(200)
            .end("Connection received. Return to the LifeOS companion.");
          done(credentials);
        } catch (error) {
          response
            .writeHead(400)
            .end(
              "Connection could not be completed. Return to the LifeOS companion.",
            );
          if (attempt.consumed) reject(error);
        }
      });
    });
    // This URL contains state/PKCE/nonce, never access, refresh or ID tokens.
    process.stdout.write(
      "Open in your own browser after reviewing consent:\n" +
        authorizationUrl +
        "\n",
    );
    return await completed;
  } finally {
    controller.abort();
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}
async function main() {
  if (
    !process.argv.slice(2).length ||
    process.argv.slice(2).includes("--help")
  ) {
    console.log(HELP);
    return;
  }
  const args = parse(process.argv.slice(2));
  if (args.operation === "--connect" && !args.flags.has("--owner-device"))
    throw new ChatgptPlanError("chatgpt_owner_device_confirmation_required");
  const vault = new ChatgptPlanVault(
    args.values.get("--state-dir")!,
    args.values.get("--owner-id")!,
  );
  await vault.initialize();
  await vault.withLock(async () => {
    const existing = await vault.load();
    if (args.operation === "--connect")
      await vault.save(
        await connect(vault, existing ?? (await vault.loadRegistration())),
      );
    if (args.operation === "--import") {
      if (
        !args.values.get("--source-envelope") ||
        !args.values.get("--source-key")
      )
        throw new ChatgptPlanError("chatgpt_import_paths_required");
      await vault.import(
        resolve(args.values.get("--source-envelope")!),
        resolve(args.values.get("--source-key")!),
      );
    }
    if (["--refresh", "--revoke"].includes(args.operation)) {
      if (!existing) throw new ChatgptPlanError("chatgpt_permission_required");
      if (args.operation === "--refresh") {
        try {
          await vault.save(await refreshChatgptCredentials(existing));
        } catch (error) {
          if (
            error instanceof ChatgptPlanError &&
            error.code === "chatgpt_reauthorization_required"
          )
            await vault.save({
              ...existing,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              revoked: true,
            });
          throw error;
        }
      } else {
        await revokeChatgptCredentials(existing);
        await vault.save({
          ...existing,
          accessToken: null,
          refreshToken: null,
          idToken: null,
          revoked: true,
        });
      }
    }
    console.log(
      JSON.stringify(chatgptPlanConnectionStatus(await vault.load()), null, 2),
    );
  });
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      error:
        error instanceof ChatgptPlanError
          ? error.code
          : "chatgpt_companion_failed",
      liveInferenceVerified: false,
    }),
  );
  process.exitCode = 1;
});
