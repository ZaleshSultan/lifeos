import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleCreatorRoute } from "./creator-routes.js";
describe("disabled creator capabilities", () => {
  it("serves only an uncached read-only capability projection", () => {
    const writeJson = vi.fn();
    const setHeader = vi.fn();
    expect(
      handleCreatorRoute({
        request: { method: "GET" } as IncomingMessage,
        response: { setHeader } as unknown as ServerResponse,
        pathname: "/api/tma/creator/capabilities",
        writeJson,
      }),
    ).toBe(true);
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(writeJson.mock.calls[0][1]).toBe(200);
    expect(writeJson.mock.calls[0][2].data.sponsorship.sendingEnabled).toBe(
      false,
    );
  });
  it("exposes no OAuth connection, inbox mutation or send operation", () => {
    for (const path of ["/api/tma/creator/send", "/api/tma/creator/connect"]) {
      const writeJson = vi.fn();
      handleCreatorRoute({
        request: { method: "POST" } as IncomingMessage,
        response: { setHeader: vi.fn() } as unknown as ServerResponse,
        pathname: path,
        writeJson,
      });
      expect(writeJson.mock.calls[0][1]).toBe(404);
    }
    const writeJson = vi.fn();
    handleCreatorRoute({
      request: { method: "POST" } as IncomingMessage,
      response: { setHeader: vi.fn() } as unknown as ServerResponse,
      pathname: "/api/tma/creator/capabilities",
      writeJson,
    });
    expect(writeJson.mock.calls[0][1]).toBe(405);
  });
});
