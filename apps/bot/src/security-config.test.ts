import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";
import { loadBotConfig } from "./config.js";

const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});
async function fixture(secret: string | undefined = "test-webhook-secret") {
  const sendMessage = vi.fn();
  const server = createBotServer({
    config: { telegramWebhookSecret: secret || undefined },
    telegram: {
      sendMessage,
      answerCallbackQuery: vi.fn(),
      getFileUrl: vi.fn(),
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    sendMessage,
    port,
    url: `http://127.0.0.1:${port}/telegram/webhook`,
  };
}
const update = {
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: 1, type: "private" },
    from: { id: 1 },
    text: "/help",
  },
};
describe("webhook security", () => {
  it("does not log malformed payload contents or credential-bearing exception messages", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await fixture();
    const response = await fetch(f.url, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: "invalid-json private-health-payload Bearer synthetic-device-token",
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(errorLog.mock.calls)).toContain("invalid_json");
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(
      /private-health-payload|synthetic-device-token|test-webhook-secret/,
    );
    errorLog.mockRestore();
  });

  it("accepts valid authenticated Telegram updates", async () => {
    const f = await fixture();
    const response = await fetch(f.url, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify(update),
    });
    expect(response.status).toBe(200);
    expect(f.sendMessage).toHaveBeenCalled();
  });
  it.each([undefined, "incorrect", "invalid,secret", "a".repeat(257)])(
    "rejects missing, wrong and malformed headers (%s)",
    async (secret) => {
      const f = await fixture();
      const response = await fetch(f.url, {
        method: "POST",
        headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
        body: JSON.stringify(update),
      });
      expect(response.status).toBe(401);
      expect(f.sendMessage).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({
        error: "invalid_webhook_secret",
      });
    },
  );
  it("rejects duplicate secret headers", async () => {
    const f = await fixture();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        f.url,
        {
          method: "POST",
          headers: {
            "x-telegram-bot-api-secret-token": [
              "test-webhook-secret",
              "test-webhook-secret",
            ],
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(update));
    });
    expect(status).toBe(401);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it("keeps unconfigured local servers available but disables webhook processing", async () => {
    const f = await fixture("");
    const response = await fetch(f.url, {
      method: "POST",
      body: JSON.stringify(update),
    });
    expect(response.status).toBe(503);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it("rejects wrong methods and oversized authenticated payloads", async () => {
    const f = await fixture();
    expect((await fetch(f.url)).status).toBe(405);
    const response = await fetch(f.url, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it("requires production security in configuration and direct server construction", () => {
    expect(() => loadBotConfig({ NODE_ENV: "production" })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
    expect(() =>
      createBotServer({ config: { nodeEnv: "production" } }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() =>
      loadBotConfig({
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: "valid-secret",
      }),
    ).not.toThrow();
    expect(() => loadBotConfig({ NODE_ENV: "test" })).not.toThrow();
    expect(() =>
      loadBotConfig({
        NODE_ENV: "development",
        ALLOW_UNSAFE_TMA_DEV_AUTH: "true",
      }),
    ).not.toThrow();
  });
  it.each([" ", "has spaces", "secret+base64=", "a".repeat(257)])(
    "rejects malformed configured secrets",
    (secret) => {
      expect(() => loadBotConfig({ TELEGRAM_WEBHOOK_SECRET: secret })).toThrow(
        /TELEGRAM_WEBHOOK_SECRET/,
      );
    },
  );
  it("cannot override a production process with development config or a dev auth flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createBotServer({ config: { nodeEnv: "development" } }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() =>
      createBotServer({
        config: {
          nodeEnv: "test",
          telegramWebhookSecret: "valid",
          allowUnsafeTmaDevAuth: true,
        },
      }),
    ).toThrow(/ALLOW_UNSAFE_TMA_DEV_AUTH/);
    expect(() =>
      loadBotConfig({
        NODE_ENV: "test",
        TELEGRAM_WEBHOOK_SECRET: "valid",
        ALLOW_UNSAFE_TMA_DEV_AUTH: "true",
      }),
    ).toThrow(/ALLOW_UNSAFE_TMA_DEV_AUTH/);
  });
});
