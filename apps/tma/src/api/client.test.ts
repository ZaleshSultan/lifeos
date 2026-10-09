import { afterEach, describe, expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({ initData: "signed-A" }));
vi.mock("../telegram", () => ({ telegram: context }));
import { request } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  context.initData = "signed-A";
});

describe("TMA signed-session transport", () => {
  it("rejects an account A response when Telegram switched to B during the network request", async () => {
    let deliver!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            deliver = resolve;
          }),
      ),
    );
    const result = request("/api/tma/study");
    context.initData = "signed-B";
    deliver(
      new Response(JSON.stringify({ data: { privateCourse: "A" } }), {
        status: 200,
      }),
    );
    await expect(result).rejects.toMatchObject({ status: 401 });
  });

  it("prevents callers from replacing the validated signed-context header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data: { saved: true } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await request("/api/tma/study", {
      headers: { "x-telegram-init-data": "untrusted-caller" },
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { "x-telegram-init-data": "signed-A" },
    });
  });

  it.each([
    new Headers({
      "Content-Type": "application/pdf",
      "X-Telegram-Init-Data": "untrusted",
    }),
    [
      ["Content-Type", "application/pdf"],
      ["X-Telegram-Init-Data", "untrusted"],
    ] as [string, string][],
    { "Content-Type": "application/pdf", "X-Telegram-Init-Data": "untrusted" },
  ])(
    "normalizes custom header forms and always uses the current Telegram session",
    async (headers) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(JSON.stringify({ data: {} })),
      );
      vi.stubGlobal("fetch", fetch);
      await request("/api/tma/study", { headers });
      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get("content-type")).toBe("application/pdf");
      expect(sent.get("x-telegram-init-data")).toBe("signed-A");
    },
  );
});
