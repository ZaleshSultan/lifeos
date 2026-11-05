import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ACADEMIC_PREFERENCES } from "../../core/src/academic-concierge.js";
import {
  AcademicStoreError,
  getAcademicOverview,
  importAcademicRecords,
  parseAcademicOverview,
  reviseAcademicEvent,
  saveAcademicPreferences,
  verifyAcademicSchedule,
} from "./academic-concierge-store.js";

const owner = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const overview = () => ({
  timezone: "Asia/Almaty",
  sources: [],
  events: [],
  preferences: structuredClone(DEFAULT_ACADEMIC_PREFERENCES),
  scheduleVerification: {
    revision: 0,
    validFrom: null,
    validThrough: null,
    sourceLabel: null,
    verifiedAt: null,
    current: false,
    changed: false,
  },
  lms: {
    configured: false,
    stale: true,
    lastSuccessfulSyncAt: null,
    state: "not_configured",
  },
  classes: [],
  assignments: [],
  warnings: ["academic_schedule_verification_required"],
  truncated: false,
});
function client(data: unknown = overview(), message: string | null = null) {
  const rpc = vi.fn(async () => ({
    data,
    error: message ? { message } : null,
  }));
  return { client: { rpc } as unknown as Pick<SupabaseClient, "rpc">, rpc };
}

describe("academic storage authority and safe response validation", () => {
  it("passes only the explicitly resolved canonical owner to the service-only RPC", async () => {
    const f = client();
    expect(await getAcademicOverview(f.client, owner)).toEqual(overview());
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("academic_service", {
      p_user_id: owner,
      p_operation: "overview",
      p_args: {},
    });
  });
  it("does not issue database calls for invalid ownership identifiers", async () => {
    const f = client();
    await expect(
      getAcademicOverview(f.client, "other-owner"),
    ).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([
    "academic_conflict",
    "academic_not_found",
    "academic_invalid_input",
  ])("preserves safe failure code %s", async (code) => {
    const f = client(null, code);
    await expect(getAcademicOverview(f.client, owner)).rejects.toMatchObject({
      code,
    });
  });
  it("never returns raw storage errors or accepts unexpected response authority", async () => {
    const f = client(null, "raw private cookie and database text");
    await expect(getAcademicOverview(f.client, owner)).rejects.toThrow(
      "academic_unavailable",
    );
    expect(() =>
      parseAcademicOverview({ ...overview(), user_id: "foreign" }),
    ).toThrow(AcademicStoreError);
    expect(() =>
      parseAcademicOverview({
        ...overview(),
        lms: { ...overview().lms, cookie: "private" },
      }),
    ).toThrow();
  });
  it("requires preference CAS revision agreement before calling storage", async () => {
    const f = client();
    await expect(
      saveAcademicPreferences(f.client, owner, {
        expectedRevision: 1,
        preferences: DEFAULT_ACADEMIC_PREFERENCES,
      }),
    ).rejects.toMatchObject({ code: "academic_conflict" });
    expect(f.rpc).not.toHaveBeenCalled();
    await saveAcademicPreferences(f.client, owner, {
      expectedRevision: 0,
      preferences: DEFAULT_ACADEMIC_PREFERENCES,
    });
    const { revision: _, ...preferences } = DEFAULT_ACADEMIC_PREFERENCES;
    expect(f.rpc).toHaveBeenCalledWith("academic_service", {
      p_user_id: owner,
      p_operation: "save_preferences",
      p_args: { expectedRevision: 0, preferences },
    });
  });
  it("fences explicit per-event revisions without granting import authority", async () => {
    const f = client();
    await reviseAcademicEvent(f.client, owner, recordId, {
      expectedRevision: 4,
      patch: { status: "confirmed" },
      confirmed: true,
    });
    expect(f.rpc).toHaveBeenCalledWith("academic_service", {
      p_user_id: owner,
      p_operation: "revise_event",
      p_args: {
        id: recordId,
        expectedRevision: 4,
        patch: { status: "confirmed" },
        confirmed: true,
      },
    });
    await expect(
      reviseAcademicEvent(f.client, owner, recordId, {
        expectedRevision: 4,
        patch: { user_id: owner },
        confirmed: true,
      } as never),
    ).rejects.toThrow();
  });
  it("requires an actual reviewed timetable validity interval", async () => {
    const f = client();
    await verifyAcademicSchedule(f.client, owner, {
      expectedRevision: 0,
      validFrom: "2026-11-04",
      validThrough: "2026-11-20",
      sourceLabel: "Synthetic reviewed timetable",
      confirmed: true,
    });
    expect(f.rpc).toHaveBeenCalledWith(
      "academic_service",
      expect.objectContaining({
        p_user_id: owner,
        p_operation: "verify_schedule",
      }),
    );
  });
  it("fails closed for malformed import results instead of claiming an import", async () => {
    const source = {
      key: "synthetic-owner-source",
      kind: "owner_provided",
      label: "Synthetic",
      sha256: "a".repeat(64),
      sourceUrl: null,
      page: null,
      academicYear: null,
      groupCode: null,
      verifiedAt: "2026-11-04T00:00:00Z",
    };
    const event = {
      key: "synthetic-personal",
      sourceKey: source.key,
      kind: "personal_exam",
      title: "Synthetic personal appointment",
      startsAt: "2026-11-17T11:00:00Z",
      endsAt: null,
      startsOn: null,
      endsOn: null,
      timezone: "Asia/Almaty",
      location: "Synthetic location",
      courseCode: null,
      sourceTypeCode: null,
      trimester: null,
      periodType: null,
      status: "proposed",
    };
    const f = client({
      created: -1,
      unchanged: 0,
      conflicts: [],
      overview: overview(),
    });
    await expect(
      importAcademicRecords(f.client, owner, {
        requestId: "synthetic-request",
        sources: [source],
        events: [event],
      } as never),
    ).rejects.toThrow("academic_unavailable");
  });
  it("cannot turn an arbitrary assignment link into a browser navigation", () => {
    const data = overview() as unknown as Record<string, unknown>;
    data.assignments = [
      {
        key: "synthetic-assignment",
        title: "Synthetic",
        courseTitle: "Synthetic course",
        dueAt: "2026-11-17T05:00:00Z",
        sourceUrl: "https://evil.invalid",
        submissionState: "not_submitted",
        verified: true,
        stale: false,
      },
    ];
    expect(() => parseAcademicOverview(data)).toThrow("academic_unavailable");
  });
});
