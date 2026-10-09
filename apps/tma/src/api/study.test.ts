import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({
  telegram: { initData: "signed-study-session" },
}));
import { studyApi } from "./study";

afterEach(() => vi.unstubAllGlobals());

describe("authenticated study writes", () => {
  it("creates and edits manual assignments with deadlines through the bot API", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data: { id: "assignment-one" } })),
    );
    vi.stubGlobal("fetch", fetch);
    const input = {
      studyCourseId: "course-one",
      title: "Russian C1 presentation",
      dueAt: "2026-10-12T01:00:00.000Z",
      maxScore: 30,
      status: "pending",
      notes: "Prepare slides",
    };
    await studyApi.saveAssignment({ input });
    await studyApi.saveAssignment({
      id: "assignment/one",
      input: { ...input, dueAt: null },
    });
    expect(fetch.mock.calls[0]).toEqual([
      expect.stringMatching(/\/api\/tma\/study\/assignments$/),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-study-session",
        }),
      }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      expect.stringMatching(
        /\/api\/tma\/study\/assignments\/assignment%2Fone$/,
      ),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ ...input, dueAt: null }),
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-study-session",
        }),
      }),
    ]);
  });

  it("preserves real zero grades, clears overrides explicitly and confirms component mapping", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ data: { saved: true } })),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      studyApi.overrideGrade({
        id: "assignment-one",
        value: { earned: 0, max: 30, note: "Checked" },
      }),
    ).resolves.toEqual({ saved: true });
    await studyApi.overrideGrade({ id: "assignment-one", value: null });
    await studyApi.mapGrade({
      id: "assignment-one",
      componentId: "presentation",
    });
    await studyApi.mapGrade({ id: "assignment-one", componentId: null });
    expect(
      fetch.mock.calls.map(([path, options]) => [
        String(path).split("/study/")[1],
        options?.method,
        JSON.parse(String(options?.body)),
      ]),
    ).toEqual([
      [
        "assignments/assignment-one/grade-override",
        "PUT",
        { earned: 0, max: 30, note: "Checked" },
      ],
      [
        "assignments/assignment-one/grade-override",
        "PUT",
        { earned: null, max: null },
      ],
      [
        "assignments/assignment-one/component",
        "PUT",
        { componentId: "presentation" },
      ],
      ["assignments/assignment-one/component", "PUT", { componentId: null }],
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(new Headers(options?.headers).get("x-telegram-init-data")).toBe(
        "signed-study-session",
      );
    }
  });

  it("requires explicit activation through the authenticated scheme endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { id: "scheme-one", isActive: true } }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await studyApi.activateScheme({
      courseId: "course/one",
      schemeId: "scheme/one",
    });
    expect(fetch.mock.calls[0]).toEqual([
      expect.stringMatching(
        /\/api\/tma\/study\/courses\/course%2Fone\/schemes\/scheme%2Fone\/activate$/,
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-study-session",
        }),
      }),
    ]);
  });

  it("returns server and network failures instead of substituting demo study data", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_study_assignment" }), {
          status: 400,
        }),
      )
      .mockRejectedValueOnce(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetch);
    const input = { studyCourseId: "course-one", title: "Presentation" };
    await expect(studyApi.saveAssignment({ input })).rejects.toMatchObject({
      status: 400,
    });
    await expect(studyApi.saveAssignment({ input })).rejects.toThrow(
      "Network unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
