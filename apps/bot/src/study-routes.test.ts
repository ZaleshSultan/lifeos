import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudyWorkspaceError, type LifeOSStore } from "@lifeos/db";
import { createBotServer } from "./server.js";
import {
  parseStudyAssignment,
  parseStudyPdf,
  parseStudyPdfBytes,
} from "./study-routes.js";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const courseA = "aaaaaaaa-0000-4000-8000-000000000001";
const assessmentA = "aaaaaaaa-0000-4000-8000-000000000002";
const docA = "aaaaaaaa-0000-4000-8000-000000000003";
const schemeA = "aaaaaaaa-0000-4000-8000-000000000004";
const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});
function signedInitData(
  telegramId: number,
  authDate = Math.floor(Date.now() / 1000),
) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: telegramId, first_name: "Test" }),
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("study-test-token")
    .digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
async function fixture() {
  const owned = (userId: string) => {
    if (userId !== userA)
      throw new StudyWorkspaceError("study_course_not_found");
  };
  const store = {
    resolveTelegramUser: vi.fn(async (telegramId: number) => ({
      userId: telegramId === 11 ? userA : userB,
      telegramUserId: telegramId,
      displayName: "Test",
      username: null,
      timezone: "Asia/Qyzylorda",
      status: "active",
      role: "user",
    })),
    getTmaStudySummary: vi.fn(async (userId: string, timezone: string) => ({
      timezone,
      courses: [],
      records: [],
      assignments: [{ id: userId === userA ? assessmentA : "private-b" }],
      deadlines: [],
      sources: [],
      sync: { updatedAt: null, status: "not_synced", message: "" },
    })),
    createManualStudyAssignment: vi.fn(
      async (userId: string, input: Record<string, unknown>) => {
        owned(userId);
        if (input.studyCourseId !== courseA)
          throw new StudyWorkspaceError("study_course_not_found");
        return {
          id: assessmentA,
          ...input,
          rawJson: { secret: "must not leave" },
        };
      },
    ),
    editManualStudyAssignment: vi.fn(async (userId: string) => {
      owned(userId);
      return { id: assessmentA, rawJson: {} };
    }),
    saveStudyGradeOverride: vi.fn(async (userId: string) => {
      owned(userId);
    }),
    saveStudyComponentMapping: vi.fn(async (userId: string) => {
      owned(userId);
    }),
    createStudyDocument: vi.fn(async (userId: string) => {
      owned(userId);
      return { id: docA, extractionStatus: "needs_review" };
    }),
    downloadStudyDocument: vi.fn(async (userId: string) => {
      owned(userId);
      return {
        fileName: "Силлабус.pdf",
        bytes: Buffer.from("%PDF-1.4\n%%EOF"),
      };
    }),
    createStudyScheme: vi.fn(async (userId: string) => {
      owned(userId);
      return { id: schemeA, isActive: false };
    }),
    activateStudyScheme: vi.fn(
      async (
        userId: string,
        courseId: string,
        schemeId: string,
        confirmed: boolean,
      ) => {
        owned(userId);
        if (!confirmed)
          throw new StudyWorkspaceError("study_scheme_needs_review");
        return { id: schemeId, isActive: true };
      },
    ),
  };
  const server = createBotServer({
    config: {
      telegramBotToken: "study-test-token",
      allowUnsafeTmaDevAuth: false,
    },
    store: store as unknown as LifeOSStore,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    telegramId = 11,
    initData = signedInitData(telegramId),
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-telegram-init-data": initData,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { store, request, base };
}
describe("authenticated study API", () => {
  it("keeps signed account scope when query/body contains another user ID", async () => {
    const f = await fixture();
    const a = await f.request(`/api/tma/study?user_id=${userB}`);
    const b = await f.request(
      `/api/tma/study?user_id=${userA}`,
      "GET",
      undefined,
      22,
    );
    expect(await a.json()).toMatchObject({
      data: { assignments: [{ id: assessmentA }] },
    });
    expect(await b.json()).toMatchObject({
      data: { assignments: [{ id: "private-b" }] },
    });
    const created = await f.request("/api/tma/study/assignments", "POST", {
      studyCourseId: courseA,
      title: "Manual assignment",
      maxScore: 30,
      actualScore: 15,
      user_id: userB,
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.json())).not.toContain("secret");
    expect(f.store.createManualStudyAssignment).toHaveBeenCalledWith(
      userA,
      expect.objectContaining({
        source: "manual",
        actualScore: 15,
        maxScore: 30,
      }),
    );
    for (const [path, method, body] of [
      [
        `/api/tma/study/assignments/${assessmentA}/grade-override`,
        "PUT",
        { earned: 29, max: 30, user_id: userA },
      ],
      [
        `/api/tma/study/assignments/${assessmentA}/component`,
        "PUT",
        { componentId: "assignment-1" },
      ],
      [`/api/tma/study/documents/${docA}/download`, "GET", undefined],
      [
        `/api/tma/study/courses/${courseA}/schemes/${schemeA}/activate`,
        "POST",
        { confirmed: true },
      ],
    ] as const) {
      expect((await f.request(path, method, body, 22)).status).toBe(404);
    }
  });
  it("rejects tampered, expired, future and duplicate initData before store access", async () => {
    const f = await fixture();
    const now = Math.floor(Date.now() / 1000);
    const good = signedInitData(11);
    const invalid = [
      good.replace(/hash=[^&]+/, `hash=${"0".repeat(64)}`),
      signedInitData(11, now - 90000),
      signedInitData(11, now + 3600),
      `${good}&user=${encodeURIComponent(JSON.stringify({ id: 22 }))}`,
    ];
    for (const auth of invalid)
      expect(
        (await f.request("/api/tma/study", "GET", undefined, 11, auth)).status,
      ).toBe(401);
    expect(f.store.getTmaStudySummary).not.toHaveBeenCalled();
    expect(f.store.resolveTelegramUser).not.toHaveBeenCalled();
  });
  it("requires explicit scheme activation confirmation and downloads scoped PDF bytes", async () => {
    const f = await fixture();
    expect(
      (
        await f.request(
          `/api/tma/study/courses/${courseA}/schemes/${schemeA}/activate`,
          "POST",
          {},
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.request(
          `/api/tma/study/courses/${courseA}/schemes/${schemeA}/activate`,
          "POST",
          { confirmed: true },
        )
      ).status,
    ).toBe(200);
    const pdf = await f.request(`/api/tma/study/documents/${docA}/download`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");
    expect(pdf.headers.get("access-control-allow-origin")).toBe("*");
    expect(await pdf.text()).toContain("%PDF-");
    expect(
      (await f.request("/api/tma/study/assignments", "PUT", {})).status,
    ).toBe(405);
  });
  it("accepts binary PDF uploads with a Unicode filename and keeps the signed owner", async () => {
    const f = await fixture();
    const bytes = Buffer.from("%PDF-1.4\n%%EOF");
    const headers = {
      "content-type": "application/pdf",
      "x-study-file-name": encodeURIComponent("Русский язык.pdf"),
      "x-telegram-init-data": signedInitData(11),
    };
    const response = await fetch(
      `${f.base}/api/tma/study/courses/${courseA}/documents?user_id=${userB}`,
      {
        method: "POST",
        headers,
        body: bytes,
      },
    );
    expect(response.status).toBe(201);
    expect(f.store.createStudyDocument).toHaveBeenCalledWith(userA, courseA, {
      fileName: "Русский язык.pdf",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(
      (
        await fetch(`${f.base}/api/tma/study/courses/${courseA}/documents`, {
          method: "POST",
          headers: { ...headers, "x-telegram-init-data": signedInitData(22) },
          body: bytes,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${f.base}/api/tma/study/courses/${courseA}/documents`, {
          method: "POST",
          headers: { ...headers, "x-study-file-name": "%broken" },
          body: bytes,
        })
      ).status,
    ).toBe(400);
  });
  it("rejects oversized binary bodies before reading them and advertises the upload header", async () => {
    const f = await fixture();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${f.base}/api/tma/study/courses/${courseA}/documents`,
        {
          method: "POST",
          headers: {
            "content-type": "application/pdf",
            "content-length": 60 * 1024 * 1024 + 1,
            "x-study-file-name": "large.pdf",
            "x-telegram-init-data": signedInitData(11),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(413);
    expect(f.store.createStudyDocument).not.toHaveBeenCalled();
    const preflight = await fetch(
      `${f.base}/api/tma/study/courses/${courseA}/documents`,
      { method: "OPTIONS" },
    );
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "x-study-file-name",
    );
  });
});
describe("study request validation", () => {
  it("rejects malformed scores, dates, statuses, URLs and untrusted raw payload fields", () => {
    const valid = {
      studyCourseId: courseA,
      title: "A",
      maxScore: 30,
      actualScore: 15,
      dueAt: "2026-10-08T10:00:00+05:00",
    };
    expect(
      parseStudyAssignment(
        { ...valid, source: "moodle", rawJson: { secret: "injected" } },
        true,
      ),
    ).toMatchObject({ source: "manual", dueAt: "2026-10-08T05:00:00.000Z" });
    for (const extra of [
      { maxScore: 0 },
      { actualScore: 31 },
      { actualScore: -1 },
      { dueAt: "week 4" },
      { dueAt: "2026-02-31T10:00:00+05:00" },
      { dueAt: "2026-10-08T24:00:00Z" },
      { status: "made_up" },
      { status: ["pending"] },
      { sourceUrl: "javascript:alert(1)" },
    ])
      expect(() => parseStudyAssignment({ ...valid, ...extra }, true)).toThrow(
        "invalid_study_assignment",
      );
  });
  it("accepts actual PDF magic and checks filename, canonical base64 and checksum", () => {
    const pdfBase64 = Buffer.from("%PDF-1.4\n%%EOF").toString("base64");
    expect(
      parseStudyPdf({ fileName: "Русский язык.pdf", pdfBase64 }),
    ).toMatchObject({
      fileName: "Русский язык.pdf",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    for (const input of [
      { fileName: "../a.pdf", pdfBase64 },
      { fileName: "a.pdf", pdfBase64: "bm90LXBkZg==" },
      { fileName: "a.pdf", pdfBase64: pdfBase64 + "\n" },
    ])
      expect(() => parseStudyPdf(input)).toThrow("invalid_study_document");
  });
  it("rejects binary non-PDF content and path filenames", () => {
    for (const [name, bytes] of [
      ["../private.pdf", Buffer.from("%PDF-1.4\n%%EOF")],
      ["a.pdf", Buffer.from("not PDF content")],
      ["a.txt", Buffer.from("%PDF-1.4\n%%EOF")],
    ] as const)
      expect(() => parseStudyPdfBytes(name, bytes)).toThrow(
        "invalid_study_document",
      );
  });
});
