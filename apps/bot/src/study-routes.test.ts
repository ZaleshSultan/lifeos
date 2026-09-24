import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { LifeOSStore } from "@lifeos/db";
import { StudyWorkspaceError } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";

const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function authHeaders() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 30, first_name: "Test" }),
  });
  const content = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("study-test-token")
    .digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(content).digest("hex"),
  );
  return {
    "x-telegram-init-data": params.toString(),
    "content-type": "application/json",
  };
}

async function fixture() {
  const getTmaStudySummary = vi.fn(async () => ({
    timezone: "Asia/Almaty",
    courses: [],
    records: [],
  }));
  const saveStudyCalculator = vi.fn(
    async (_user: string, _id: string, input: unknown) => input,
  );
  const store = {
    resolveTelegramUser: async () => ({
      userId: "owner",
      telegramUserId: 30,
      status: "active",
      role: "user",
      timezone: "Asia/Almaty",
    }),
    getTmaStudySummary,
    saveStudyCalculator,
  } as unknown as LifeOSStore;
  const server = createBotServer({
    store,
    config: { telegramBotToken: "study-test-token" },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    getTmaStudySummary,
    saveStudyCalculator,
  };
}

describe("study routes", () => {
  it("authenticates before returning the user's timetable", async () => {
    const f = await fixture();
    expect((await fetch(`${f.base}/api/tma/study`)).status).toBe(401);
    expect(f.getTmaStudySummary).not.toHaveBeenCalled();
    const response = await fetch(`${f.base}/api/tma/study`, {
      headers: authHeaders(),
    });
    expect(response.status).toBe(200);
    expect(f.getTmaStudySummary).toHaveBeenCalledWith("owner", "Asia/Almaty");
    await expect(response.json()).resolves.toEqual({
      data: { timezone: "Asia/Almaty", courses: [], records: [] },
    });
  });

  it("uses the authenticated owner when saving and rejects malformed IDs", async () => {
    const f = await fixture();
    const options = {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ values: {}, target: 70, userId: "other" }),
    };
    expect(
      (
        await fetch(
          `${f.base}/api/tma/study/courses/not-a-uuid/calculator`,
          options,
        )
      ).status,
    ).toBe(400);
    expect(f.saveStudyCalculator).not.toHaveBeenCalled();
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      (await fetch(`${f.base}/api/tma/study/courses/${id}/calculator`, options))
        .status,
    ).toBe(200);
    expect(f.saveStudyCalculator).toHaveBeenCalledWith("owner", id, {
      values: {},
      target: 70,
      userId: "other",
    });
  });

  it("returns a safe ownership error without exposing another course", async () => {
    const f = await fixture();
    f.saveStudyCalculator.mockRejectedValue(
      new StudyWorkspaceError("study_course_not_found"),
    );
    const response = await fetch(
      `${f.base}/api/tma/study/courses/11111111-1111-4111-8111-111111111111/calculator`,
      { method: "PUT", headers: authHeaders(), body: "{}" },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "study_course_not_found",
    });
  });
});
