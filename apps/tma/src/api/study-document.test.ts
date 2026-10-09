import { afterEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ initData: "signed-A" }));
vi.mock("../telegram", () => ({ telegram: context }));
import { fetchStudyPdf, studyApi } from "./study";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  context.initData = "signed-A";
});

describe("private syllabus transport", () => {
  it("uploads original binary bytes and a Unicode filename using the signed session", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data: { id: "doc-A" } }), {
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const file = new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" });
    await studyApi.uploadDocument({
      courseId: "course-A",
      fileName: "Русский язык.pdf",
      file,
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      body: file,
      headers: {
        "content-type": "application/pdf",
        "x-study-file-name": encodeURIComponent("Русский язык.pdf"),
        "x-telegram-init-data": "signed-A",
      },
    });
  });

  it("rejects an account A PDF when the session changes while its bytes are received", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "application/pdf" }),
        blob: async () => {
          context.initData = "signed-B";
          return new Blob(["%PDF-1.4 private A"]);
        },
      })),
    );
    await expect(fetchStudyPdf("doc-A")).rejects.toThrow(
      "Сессия Telegram изменилась",
    );
  });

  it("requires authenticated PDF content and never shows remote error details", async () => {
    for (const response of [
      new Response("private backend error", { status: 404 }),
      new Response("<html>proxy error</html>", {
        headers: { "content-type": "text/html" },
      }),
    ]) {
      const fetch = vi.fn(async () => response);
      vi.stubGlobal("fetch", fetch);
      await expect(fetchStudyPdf("foreign/id")).rejects.toThrow(
        "Не удалось открыть PDF",
      );
      expect(fetch.mock.calls[0]).toEqual([
        expect.stringContaining("foreign%2Fid/download"),
        { headers: { "x-telegram-init-data": "signed-A" }, cache: "no-store" },
      ]);
    }
  });

  it("closes a blank preview on denied access before creating a private object URL", async () => {
    const preview = {
      opener: {},
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    vi.stubGlobal("window", { open: vi.fn(() => preview) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    await expect(studyApi.openDocument("doc-A")).rejects.toThrow(
      "Не удалось открыть PDF",
    );
    expect(preview.opener).toBeNull();
    expect(preview.close).toHaveBeenCalledOnce();
    expect(preview.location.replace).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
