import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  emptyIdealHumanDay,
  IdealHumanConflictError,
  type IdealHumanDay,
} from "@lifeos/core";
import type { LifeOSStore } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";

const token = "ideal-human-fixture-token";
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
function headers(id = 30, age = 0) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - age),
    user: JSON.stringify({ id, first_name: "Test" }),
  });
  const content = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(content).digest("hex"),
  );
  return {
    "x-telegram-init-data": params.toString(),
    "content-type": "application/json",
  };
}
async function fixture(status = "active") {
  const saved = new Map<string, Map<string, IdealHumanDay>>();
  const getIdealHumanDays = vi.fn(async (owner: string) => [
    ...(saved.get(owner)?.values() ?? []),
  ]);
  const saveIdealHumanDay = vi.fn(
    async (owner: string, day: IdealHumanDay, expected: number) => {
      const days = saved.get(owner) ?? new Map<string, IdealHumanDay>();
      const current = days.get(day.date);
      if ((current?.revision ?? 0) !== expected) {
        throw new IdealHumanConflictError();
      }
      const result = { ...day, revision: expected + 1 };
      days.set(day.date, result);
      saved.set(owner, days);
      return result;
    },
  );
  const store = {
    resolveTelegramUser: async (id: number) => ({
      userId: `owner-${id}`,
      telegramUserId: id,
      status,
      role: "user",
      timezone: "Asia/Almaty",
    }),
    getIdealHumanDays,
    saveIdealHumanDay,
  } as unknown as LifeOSStore;
  const server = createBotServer({
    store,
    config: { telegramBotToken: token },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tma/ideal-human`;
  const put = (day: unknown, expectedRevision: unknown = 0, id = 30) =>
    fetch(`${base}/days`, {
      method: "PUT",
      headers: headers(id),
      body: JSON.stringify({ day, expectedRevision }),
    });
  return { base, put, getIdealHumanDays, saveIdealHumanDay };
}

describe("Ideal Human authenticated persistence", () => {
  it("requires fresh signed auth and an active profile before any access", async () => {
    const f = await fixture();
    for (const options of [
      {},
      { headers: { "x-telegram-init-data": "invalid" } },
      { headers: headers(30, 172800) },
    ]) {
      expect((await fetch(`${f.base}/days`, options)).status).toBe(401);
    }
    expect(f.getIdealHumanDays).not.toHaveBeenCalled();
    for (const status of ["pending", "blocked"]) {
      const other = await fixture(status);
      expect(
        (await fetch(`${other.base}/days`, { headers: headers() })).status,
      ).toBe(403);
      expect(other.getIdealHumanDays).not.toHaveBeenCalled();
    }
  });
  it("roundtrips partial observations, leaves missing values null, isolates owners and dates", async () => {
    const f = await fixture();
    const response = await f.put({
      date: "2026-11-03",
      weightKg: 51.2,
      revision: 0,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data).toMatchObject({
      date: "2026-11-03",
      weightKg: 51.2,
      sleepMinutes: null,
      footageBackedUp: null,
      revision: 1,
    });
    expect(f.saveIdealHumanDay).toHaveBeenCalledWith(
      "owner-30",
      expect.objectContaining({ weightKg: 51.2 }),
      0,
    );
    const reload = await fetch(`${f.base}/days`, { headers: headers() });
    expect(await reload.json()).toEqual({ data: [data] });
    const foreign = await fetch(`${f.base}/days`, { headers: headers(31) });
    expect(await foreign.json()).toEqual({ data: [] });
    expect(
      (
        await f.put({
          date: "2026-12-02",
          notes: "A real final reflection",
          revision: 0,
        })
      ).status,
    ).toBe(200);
  });
  it("rejects unknown owners, dates, values and missing concurrency protection", async () => {
    const f = await fixture();
    const invalid = [
      { date: "2026-11-03", userId: "other", notes: "x" },
      { date: "2026-11-02", notes: "x" },
      { date: "2026-12-03", notes: "x" },
      { date: "2026-11-31", notes: "x" },
      { date: "2026-11-03", sleepMinutes: -1 },
      { date: "2026-11-03", weightKg: "51" },
      { date: "2026-11-03", footageBackedUp: "yes" },
    ];
    for (const day of invalid) expect((await f.put(day)).status).toBe(400);
    expect((await f.put({ date: "2026-11-03", notes: "x" }, -1)).status).toBe(
      400,
    );
    expect(
      (await f.put({ date: "2026-11-03", notes: "x", revision: 1 }, 0)).status,
    ).toBe(400);
    const noRevision = await fetch(`${f.base}/days`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ day: { date: "2026-11-03", notes: "x" } }),
    });
    expect(noRevision.status).toBe(400);
    expect(f.saveIdealHumanDay).not.toHaveBeenCalled();
  });
  it("rejects competing stale edits and preserves the successful write", async () => {
    const f = await fixture();
    const day = { ...emptyIdealHumanDay("2026-11-03"), notes: "first" };
    const responses = await Promise.all([
      f.put(day),
      f.put({ ...day, notes: "second" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((r) => r.status === 409)!;
    expect(await conflict.json()).toEqual({
      error: "ideal_human_conflict",
      message: "This day changed in another session. Reload it before saving.",
    });
    const reload = await fetch(`${f.base}/days`, { headers: headers() });
    const result = await reload.json();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].revision).toBe(1);
  });
  it("enforces methods, safe errors and size limits without persistence", async () => {
    const f = await fixture();
    const badMethod = await fetch(`${f.base}/days`, {
      method: "POST",
      headers: headers(),
    });
    expect(badMethod.status).toBe(405);
    expect(badMethod.headers.get("allow")).toBe("GET, PUT");
    expect(
      (await fetch(`${f.base}/unknown`, { headers: headers() })).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${f.base}/days`, {
          method: "PUT",
          headers: headers(),
          body: "{invalid",
        })
      ).status,
    ).toBe(400);
    const oversized = await fetch(`${f.base}/days`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ filler: "x".repeat(1_100_000) }),
    });
    expect(oversized.status).toBe(413);
    expect(f.saveIdealHumanDay).not.toHaveBeenCalled();
    f.getIdealHumanDays.mockRejectedValueOnce(
      new Error("private connection and password"),
    );
    const failure = await fetch(`${f.base}/days`, { headers: headers() });
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({
      error: "internal_error",
      message: "Request failed.",
    });
  });
});
