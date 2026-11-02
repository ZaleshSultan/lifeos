import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT } from "./route";
const context = (path: string) => ({
  params: Promise.resolve({ path: path.split("/") }),
});
const origin = "https://lifeos.fixture.invalid";
const fetchMock = vi.fn();
function request(
  path: string,
  method = "GET",
  options: {
    cookie?: string;
    origin?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return new NextRequest(`${origin}/web/api/bridge/${path}`, {
    method,
    headers: {
      ...(options.cookie
        ? { cookie: `lifeos_web_session=${options.cookie}` }
        : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body,
  });
}
beforeEach(() => {
  vi.stubEnv("LIFEOS_API_BASE_URL", "http://127.0.0.1:9999");
  vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", `${origin}/web`);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("private same-origin web bridge", () => {
  it("rejects absent sessions, arbitrary resource access, and forged mutation origins", async () => {
    expect(
      (await GET(request("ideal-human/days"), context("ideal-human/days")))
        .status,
    ).toBe(401);
    expect(
      (
        await POST(
          request("lms/session", "POST", {
            cookie: "fixture-session",
            origin,
            body: "{}",
          }),
          context("lms/session"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await PUT(
          request("ideal-human/days", "PUT", {
            cookie: "fixture-session",
            origin: "https://sibling.fixture.invalid",
            body: "{}",
          }),
          context("ideal-human/days"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await PUT(
          request("ideal-human/days", "PUT", {
            cookie: "fixture-session",
            body: "{}",
          }),
          context("ideal-human/days"),
        )
      ).status,
    ).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses only the caller cookie for backend identity and keeps private data uncached", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ date: "2026-11-03", notes: "fixture-owned" }] }),
    );
    const response = await GET(
      request("ideal-human/days", "GET", {
        cookie: "owner-A",
        headers: {
          authorization: "Bearer owner-B",
          "x-telegram-init-data": "forged",
        },
      }),
      context("ideal-human/days"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9999/api/tma/ideal-human/days",
      expect.objectContaining({
        headers: {
          authorization: "Bearer owner-A",
          "content-type": "application/json",
        },
        cache: "no-store",
        redirect: "error",
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("owner-A");
  });
  it("preserves conflict status while stripping unsafe backend diagnostics", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: "ideal_human_conflict", message: "private-diagnostic" },
        { status: 409 },
      ),
    );
    const response = await PUT(
      request("ideal-human/days", "PUT", {
        cookie: "owner-A",
        origin,
        body: '{"day":{},"expectedRevision":0}',
      }),
      context("ideal-human/days"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ideal_human_conflict" });
    fetchMock.mockRejectedValueOnce(new Error("private-provider-credential"));
    const unavailable = await GET(
      request("health", "GET", { cookie: "owner-A" }),
      context("health"),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private-provider");
  });
  it("rejects malformed, oversized, non-JSON and identity-bearing requests before forwarding", async () => {
    for (const [body, headers, status] of [
      ["{", {}, 400],
      ["x".repeat(1_048_577), {}, 413],
      ["{}", { "content-type": "text/plain" }, 415],
    ] as const) {
      expect(
        (
          await POST(
            request("tasks", "POST", {
              cookie: "owner-A",
              origin,
              body,
              headers,
            }),
            context("tasks"),
          )
        ).status,
      ).toBe(status);
    }
    expect(
      (
        await GET(
          request("tasks?user_id=other", "GET", { cookie: "owner-A" }),
          context("tasks"),
        )
      ).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("forwards independent sessions without reusing another user's authorization", async () => {
    fetchMock.mockImplementation(async (_url, options) =>
      Response.json({
        data: {
          owner: options.headers.authorization.endsWith("A") ? "A" : "B",
        },
      }),
    );
    const a = await GET(
      request("tasks", "GET", { cookie: "owner-A" }),
      context("tasks"),
    );
    const b = await GET(
      request("tasks", "GET", { cookie: "owner-B" }),
      context("tasks"),
    );
    expect((await a.json()).data.owner).toBe("A");
    expect((await b.json()).data.owner).toBe("B");
  });
  it("propagates client cancellation to a pending external meal analysis", async () => {
    const controller = new AbortController();
    const incoming = new NextRequest(
      `${origin}/web/api/bridge/nutrition/analyze`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          cookie: "lifeos_web_session=owner-A",
          origin,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => (started = resolve));
    fetchMock.mockImplementationOnce(async (_url, options) => {
      started();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        );
      });
    });
    const pending = POST(incoming, context("nutrition/analyze"));
    await ready;
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await response.json()).toEqual({ error: "backend_unavailable" });
  });
});
