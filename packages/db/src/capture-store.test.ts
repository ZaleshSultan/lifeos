import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractCaptureActions } from "@lifeos/core";
import type { Database } from "./types.js";
import { SupabaseCaptureStore } from "./capture-store.js";

const owner = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
const view = {
  id,
  inputType: "text",
  source: "web",
  sourceLabel: "Web dashboard",
  text: "Add task DBMS",
  transcript: null,
  state: "queued",
  revision: 1,
  createdAt: "2026-11-03T17:00:00.123456+00:00",
  updatedAt: "2026-11-03T17:00:00.123456+00:00",
  archivedAt: null,
  expiresAt: null,
  reviewExpiresAt: null,
  errorCode: null,
  actions: [],
};
function fixture(data: unknown = view, error: unknown = null) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data,
    error,
  }));
  return {
    rpc,
    store: new SupabaseCaptureStore({
      rpc,
    } as unknown as SupabaseClient<Database>),
  };
}
describe("capture database trust boundary", () => {
  it("keeps multilingual review metadata separate from executable SQL payloads", async () => {
    const { store, rpc } = fixture();
    const proposals = extractCaptureActions(
      "Завтра после университета нужно потренироваться, закончить DBMS и снять пару кадров для Ideal Human.",
      { now: new Date("2026-11-03T19:10:00Z"), timezone: "Asia/Almaty" },
    );
    expect(proposals).toHaveLength(3);
    const original = structuredClone(proposals);
    await store.finish(owner, id, "synthetic-lease-1", { proposals });
    const args = rpc.mock.calls[0][1];
    expect(args.p_user_id).toBe(owner);
    expect(args.p_operation).toBe("finish");
    const input = args.p_input as {
      proposals: Array<Record<string, unknown>>;
      presentations: Record<string, { title: string }>;
    };
    expect(
      input.proposals.every(
        (proposal) => !Object.hasOwn(proposal, "presentation"),
      ),
    ).toBe(true);
    expect(Object.keys(input.presentations)).toEqual([
      "action-1",
      "action-2",
      "action-3",
    ]);
    expect(
      Object.values(input.presentations)
        .map((p) => p.title)
        .join(" "),
    ).toContain("DBMS");
    expect(proposals).toEqual(original);
  });
  it("binds an external claim to the owner, reviewed revision and fixed safe policy", async () => {
    const { store, rpc } = fixture(null);
    expect(
      await store.claimExternal(owner, id, {
        expectedRevision: 7,
        mode: "transcription",
        requestId: "voice-request-1",
        leaseToken: "voice-lease-1",
        consentExpiresAt: "2026-11-04T00:12:00Z",
        policy: {
          settingsRevision: 2,
          modelId: "approved-voice",
          provider: "openai",
          maxRequestCostMicros: 9000,
        },
      }),
    ).toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("capture_service_v2", {
      p_user_id: owner,
      p_operation: "claim_external",
      p_capture_id: id,
      p_expected_revision: 7,
      p_input: {
        mode: "transcription",
        requestId: "voice-request-1",
        leaseToken: "voice-lease-1",
        consentExpiresAt: "2026-11-04T00:12:00Z",
        policy: {
          settingsRevision: 2,
          modelId: "approved-voice",
          provider: "openai",
          maxRequestCostMicros: 9000,
        },
      },
    });
  });
  it("rejects unbounded or caller-expanded external policy before database work", async () => {
    const { store, rpc } = fixture(null);
    await expect(
      store.claimExternal(owner, id, {
        expectedRevision: 7,
        mode: "transcription",
        requestId: "voice-request-1",
        leaseToken: "voice-lease-1",
        consentExpiresAt: "2026-11-04T00:12:00Z",
        policy: {
          settingsRevision: 2,
          modelId: "approved-voice",
          provider: "openai",
          maxRequestCostMicros: -1,
        },
      }),
    ).rejects.toMatchObject({ code: "capture_invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects duplicate patch/rejection IDs instead of silently revising the same action twice", async () => {
    const { store, rpc } = fixture();
    await expect(
      store.revise(owner, id, 3, {
        updates: [],
        cancelActionIds: ["action-1", "action-1"],
      }),
    ).rejects.toMatchObject({ code: "capture_invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("scopes every capture lookup to authenticated owner and exact selector", async () => {
    const { store, rpc } = fixture();
    expect(await store.get(owner, id)).toMatchObject(view);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("capture_service_v2", {
      p_user_id: owner,
      p_operation: "get",
      p_capture_id: id,
      p_expected_revision: null,
      p_input: {},
    });
  });
  it("keeps private search text as a parameter instead of filter grammar", async () => {
    const { store, rpc } = fixture({ captures: [view], nextCursor: null });
    await store.search(owner, {
      query: "DBMS),user_id.eq.other%_",
      includeArchived: false,
      limit: 20,
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_user_id: owner,
      p_operation: "search",
      p_input: { query: "DBMS),user_id.eq.other%_" },
    });
  });
  it("preserves created/duplicate outcomes for Telegram retry suppression", async () => {
    const { store, rpc } = fixture({ capture: view, created: false });
    const result = await store.ingest(owner, {
      requestId: "tg-capture:123:456",
      inputType: "text",
      text: "Add task DBMS",
      retentionDays: null,
      source: "telegram",
      sourceReference: {
        chatId: 123,
        messageId: 456,
        updateId: 789,
        occurredAt: "2026-11-03T17:00:00Z",
      },
    });
    expect(result.created).toBe(false);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_user_id: owner,
      p_input: {
        source: "telegram",
        sourceReference: { occurredAt: "2026-11-03T17:00:00Z" },
      },
    });
  });
  it("does not permit legacy authority or arbitrary file URLs in new ingestion", async () => {
    const { store, rpc } = fixture();
    await expect(
      store.ingest(owner, {
        requestId: "request-0001",
        inputType: "text",
        text: "Note",
        retentionDays: null,
        source: "legacy" as "web",
      }),
    ).rejects.toThrow();
    await expect(
      store.ingest(owner, {
        requestId: "request-0001",
        inputType: "voice",
        text: "",
        retentionDays: null,
        source: "telegram",
        voice: {
          fileId: "https://example.invalid/secret",
          fileUniqueId: "safe",
          durationSeconds: 10,
          mimeType: "audio/ogg",
          fileSize: 100,
          referenceExpiresAt: "2026-11-04T17:00:00Z",
        },
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends one atomic confirmation with current revision and selected IDs", async () => {
    const { store, rpc } = fixture();
    await store.confirm(
      owner,
      id,
      {
        requestId: "confirm-0001",
        expectedRevision: 3,
        actionIds: ["action-2"],
        confirmed: true,
      },
      { allowMemoryDelete: false },
    );
    expect(rpc.mock.calls[0]).toEqual([
      "capture_service_v2",
      {
        p_user_id: owner,
        p_operation: "confirm",
        p_capture_id: id,
        p_expected_revision: 3,
        p_input: {
          requestId: "confirm-0001",
          expectedRevision: 3,
          actionIds: ["action-2"],
          confirmed: true,
          allowMemoryDelete: false,
          journalEntries: [],
          readResults: [],
        },
      },
    ]);
  });
  it("rejects unsupported writes disguised as prepared read answers", async () => {
    const { store, rpc } = fixture();
    await expect(
      store.confirm(
        owner,
        id,
        {
          requestId: "confirm-0001",
          expectedRevision: 1,
          actionIds: ["action-1"],
          confirmed: true,
        },
        {
          allowMemoryDelete: false,
          readResults: [
            {
              actionId: "action-1",
              action: { kind: "water.log", args: { amountMl: 250 } },
              summary: "Answer",
            },
          ],
        },
      ),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("normalizes missing-field metadata instead of trusting a proposed authorization hint", async () => {
    const { store, rpc } = fixture();
    const p = extractCaptureActions("water a glass", {
      now: new Date("2026-11-03T17:00:00Z"),
      timezone: "Asia/Almaty",
    })[0];
    await store.finish(owner, id, "lease-00001", {
      proposals: [
        { ...p, missingFields: [], summary: "Automatically approved" },
      ],
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_operation: "finish",
      p_input: {
        proposals: [
          { missingFields: ["amountMl"], summary: "water.log: Water" },
        ],
      },
    });
  });
  it("keeps global claims server-only and validates returned owner and fencing metadata", async () => {
    const job = {
      capture: { ...view, state: "processing", revision: 2 },
      leaseToken: "lease-00001",
      leaseExpiresAt: "2026-11-03T17:01:00Z",
      attemptCount: 1,
      voice: null,
      referenceTime: "2026-11-03T16:59:00Z",
    };
    const { store, rpc } = fixture({ userId: owner, job });
    expect(await store.claimNext("lease-00001")).toMatchObject({
      userId: owner,
      job: { referenceTime: "2026-11-03T16:59:00Z" },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("capture_claim_next", {
      p_lease_token: "lease-00001",
    });
  });
  it("marks external attempts through the fenced durable boundary before dispatch", async () => {
    const { store, rpc } = fixture({ marked: true });
    await store.markExternalAttempt(owner, id, "lease-00001");
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_user_id: owner,
      p_capture_id: id,
      p_operation: "mark_external",
      p_input: { leaseToken: "lease-00001" },
    });
  });
  it("bounds sweeps and validates their aggregate result", async () => {
    const { store, rpc } = fixture({ scrubbed: 3 });
    expect(await store.sweep(20)).toEqual({ scrubbed: 3 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("capture_sweep", {
      p_limit: 20,
    });
    await expect(store.sweep(101)).rejects.toThrow();
  });
  it("hides provider/database diagnostics while preserving known conflict codes", async () => {
    const bad = fixture(null, {
      message: "private provider response with credentials",
    });
    await expect(bad.store.get(owner, id)).rejects.toThrow(
      "capture_storage_unavailable",
    );
    const conflict = fixture(null, { message: "capture_conflict" });
    await expect(conflict.store.get(owner, id)).rejects.toThrow(
      "capture_conflict",
    );
  });
  it.each([
    ["daily_life_conflict", "capture_conflict"],
    ["ideal_human_conflict", "capture_conflict"],
    ["assistant_idempotency_conflict", "capture_conflict"],
    ["task_not_found", "capture_not_found"],
    ["profile_inactive", "capture_permission_denied"],
  ])("maps nested %s safely to %s", async (message, expected) => {
    const { store } = fixture(null, { message });
    await expect(store.get(owner, id)).rejects.toThrow(expected);
  });
  it("rejects owner substitution and private fields in public projections", async () => {
    const { store, rpc } = fixture();
    await expect(store.get("foreign-invalid", id)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    const extra = fixture({
      ...view,
      userId: owner,
      fileId: "private-file-reference",
    });
    await expect(extra.store.get(owner, id)).rejects.toThrow();
  });
});
