import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";
import {
  SupabaseAssistantStore,
  type AssistantMutation,
} from "./assistant-store.js";

const userId = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const receipt = {
  actionId: userId,
  resourceId,
  status: "succeeded",
  replayed: false,
};
function fakeClient() {
  const rows: Array<Record<string, unknown>> = [];
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    upsert: vi.fn(async () => ({ error: null })),
  };
  const client = {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({ data: receipt, error: null as unknown })),
  };
  return {
    client,
    query,
    rows,
    store: new SupabaseAssistantStore(
      client as unknown as SupabaseClient<Database>,
    ),
  };
}
const remember: AssistantMutation = {
  type: "memory.remember",
  memoryKey: "study.format",
  category: "learning",
  content: "Explain with concrete examples",
};

describe("assistant persistence boundary", () => {
  it("scopes reads and searches to the supplied user without filter grammar injection", async () => {
    const { store, query, rows } = fakeClient();
    rows.push({
      id: resourceId,
      user_id: userId,
      memory_key: "study.format",
      category: "learning",
      content: remember.content,
      created_at: "2026-10-11T10:00:00Z",
      updated_at: "2026-10-11T10:00:00Z",
      archived_at: null,
    });
    const result = await store.listMemories(userId, {
      query: "examples),user_id.eq.other%_",
      category: "learning",
      limit: 7,
    });
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(query.eq).toHaveBeenCalledWith("category", "learning");
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
    expect(query.limit).toHaveBeenCalledWith(7);
    for (const [, filter] of query.ilike.mock.calls)
      expect(filter).toMatch(/^%[\p{L}\p{N}]+%$/u);
    expect(result[0]).toMatchObject({
      key: "study.format",
      userId,
      category: "learning",
    });
  });

  it("keeps archived memories hidden until explicitly requested", async () => {
    const { store, query } = fakeClient();
    await store.listMemories(userId, { includeArchived: true });
    expect(query.is).not.toHaveBeenCalled();
  });

  it("performs one atomic RPC instead of separate memory/reminder and audit writes", async () => {
    const { store, client } = fakeClient();
    await expect(
      store.executeMutation({
        userId,
        source: "tma",
        idempotencyKey: "tma:request-1",
        action: remember,
      }),
    ).resolves.toEqual(receipt);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "assistant_execute_mutation",
      {
        p_user_id: userId,
        p_source: "tma",
        p_request_id: "tma:request-1",
        p_action: remember,
      },
    );
  });

  it.each([
    { ...remember, content: "password: do-not-store" },
    { ...remember, content: "my password is do-not-store" },
    { ...remember, content: "Authorization: Bearer examplecredential" },
    { ...remember, content: "пароль: do-not-store" },
    {
      ...remember,
      content: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    },
    { ...remember, category: "medical" },
    { ...remember, memoryKey: "key,other_user.eq.any" },
    { ...remember, sql: "delete from profiles" },
    { type: "shell.execute", command: "echo denied" },
    { type: "reminder.create", message: "Test", remindAt: "tomorrow" },
    {
      type: "reminder.create",
      message: "Test",
      remindAt: "2026-02-30T12:00:00Z",
    },
  ])(
    "rejects credential or malformed writes before reaching Supabase (%j)",
    async (action) => {
      const { store, client } = fakeClient();
      await expect(
        store.executeMutation({
          userId,
          source: "telegram",
          idempotencyKey: "request-1",
          action: action as AssistantMutation,
        }),
      ).rejects.toThrow("assistant_invalid_input");
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("validates owner identity for every operation", async () => {
    const { store, client } = fakeClient();
    await expect(store.listMemories("other")).rejects.toThrow(
      "assistant_invalid_input",
    );
    await expect(store.listGradeChanges("")).rejects.toThrow(
      "assistant_invalid_input",
    );
    await expect(
      store.executeMutation({
        userId: "",
        source: "tma",
        idempotencyKey: "request",
        action: remember,
      }),
    ).rejects.toThrow("assistant_invalid_input");
    await expect(
      store.recordRead({
        userId: "",
        requestId: "request",
        source: "tma",
        tool: "tasks.read",
        status: "succeeded",
      }),
    ).rejects.toThrow("assistant_invalid_input");
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects unbounded memory/grade reads", async () => {
    const { store, client } = fakeClient();
    await expect(store.listMemories(userId, { limit: 1000 })).rejects.toThrow(
      "assistant_invalid_input",
    );
    await expect(
      store.listGradeChanges(userId, { since: "invalid" }),
    ).rejects.toThrow("assistant_invalid_input");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns only the existing per-user grade notification projection", async () => {
    const { store, query, rows } = fakeClient();
    rows.push({
      message: "DBMS: 75/100",
      created_at: "2026-10-11T10:00:00Z",
      metadata_json: { external_id: "private" },
    });
    expect(
      await store.listGradeChanges(userId, {
        since: "2026-10-10T00:00:00Z",
        limit: 5,
      }),
    ).toEqual([{ message: "DBMS: 75/100", createdAt: "2026-10-11T10:00:00Z" }]);
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(query.eq).toHaveBeenCalledWith(
      "reminder_policy_key",
      "academic_grade_posted",
    );
    expect(query.contains).toHaveBeenCalledWith("metadata_json", {
      notification_kind: "instant_academic",
    });
    expect(query.select).toHaveBeenCalledWith("message,created_at");
  });

  it("audits read metadata without input text or provider responses", async () => {
    const { store, query } = fakeClient();
    await store.recordRead({
      userId,
      requestId: "read-1",
      source: "tma",
      tool: "tasks.read",
      status: "succeeded",
      durationMs: 10,
    });
    expect(query.upsert).toHaveBeenCalledExactlyOnceWith(
      {
        user_id: userId,
        request_id: "read-1",
        source: "tma",
        tool: "tasks.read",
        permission: "READ",
        status: "succeeded",
        duration_ms: 10,
        error_code: null,
      },
      { onConflict: "user_id,request_id", ignoreDuplicates: true },
    );
  });

  it("sanitizes storage errors instead of exposing provider error strings", async () => {
    const { store, client } = fakeClient();
    client.rpc.mockResolvedValue({
      data: receipt,
      error: { message: "credential: never expose" },
    });
    await expect(
      store.executeMutation({
        userId,
        source: "tma",
        idempotencyKey: "error",
        action: remember,
      }),
    ).rejects.toThrow("assistant_storage_unavailable");
  });
});
