import type { SupabaseClient } from "@supabase/supabase-js";
import { containsAssistantCredentials } from "@lifeos/core";
import type { Database, Json } from "./types.js";

export type AssistantMemoryCategory =
  | "preference"
  | "goal"
  | "constraint"
  | "learning"
  | "fact";
export interface AssistantMemoryRecord {
  id: string;
  userId: string;
  key: string;
  category: AssistantMemoryCategory;
  content: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface AssistantMemoryQuery {
  query?: string;
  category?: AssistantMemoryCategory;
  includeArchived?: boolean;
  limit?: number;
}
export type AssistantMutation =
  | {
      type: "memory.remember";
      memoryKey: string;
      category: AssistantMemoryCategory;
      content: string;
    }
  | {
      type: "memory.update";
      memoryKey: string;
      content: string;
      category?: AssistantMemoryCategory;
    }
  | { type: "memory.archive" | "memory.delete"; memoryKey: string }
  | { type: "reminder.create"; message: string; remindAt: string };
export interface AssistantMutationReceipt {
  actionId: string;
  resourceId: string | null;
  status: "succeeded" | "not_found";
  replayed: boolean;
}
export interface AssistantMutationInput {
  userId: string;
  idempotencyKey: string;
  source: "telegram" | "tma";
  action: AssistantMutation;
}
export interface AssistantReadAudit {
  userId: string;
  requestId: string;
  tool: string;
  source: "telegram" | "tma";
  status: "succeeded" | "rejected" | "failed";
  errorCode?:
    | "invalid_input"
    | "unauthorized"
    | "unavailable"
    | "confirmation_required"
    | "storage_error"
    | "handler_error";
  durationMs?: number;
}
export interface AssistantStore {
  listGradeChanges(
    userId: string,
    input?: { since?: string; limit?: number },
  ): Promise<Array<{ message: string; createdAt: string }>>;
  listMemories(
    userId: string,
    query?: AssistantMemoryQuery,
  ): Promise<AssistantMemoryRecord[]>;
  executeMutation(
    input: AssistantMutationInput,
  ): Promise<AssistantMutationReceipt>;
  recordRead(input: AssistantReadAudit): Promise<void>;
}

type MemoryRow = {
  id: string;
  user_id: string;
  memory_key: string;
  category: AssistantMemoryCategory;
  content: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
type ActionRow = {
  id: string;
  user_id: string;
  request_id: string;
  tool: string;
  source: "telegram" | "tma";
  permission: "READ" | "WRITE" | "DESTRUCTIVE";
  status: "succeeded" | "not_found" | "rejected" | "failed";
  resource_id: string | null;
  duration_ms: number | null;
  error_code: string | null;
  created_at: string;
};
// Keep additive assistant tables isolated from the operational store's schema.
type AssistantDatabase = {
  public: {
    Tables: Database["public"]["Tables"] & {
      assistant_memories: {
        Row: MemoryRow;
        Insert: Omit<
          MemoryRow,
          "id" | "created_at" | "updated_at" | "archived_at"
        >;
        Update: Partial<MemoryRow>;
        Relationships: [];
      };
      assistant_actions: {
        Row: ActionRow;
        Insert: Omit<ActionRow, "id" | "resource_id" | "created_at">;
        Update: Partial<ActionRow>;
        Relationships: [];
      };
    };
    Views: Database["public"]["Views"];
    Functions: Database["public"]["Functions"] & {
      assistant_execute_mutation: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_source: string;
          p_action: Json;
        };
        Returns: Json;
      };
    };
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requestKey = /^[A-Za-z0-9:_-]{1,120}$/;
const memoryKey = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const categories = new Set([
  "preference",
  "goal",
  "constraint",
  "learning",
  "fact",
]);
const errorCodes = new Set([
  "invalid_input",
  "unauthorized",
  "unavailable",
  "confirmation_required",
  "storage_error",
  "handler_error",
]);

export class AssistantStoreError extends Error {
  constructor(
    public readonly code:
      | "assistant_invalid_input"
      | "assistant_storage_unavailable",
  ) {
    super(code);
  }
}
function invalid(): never {
  throw new AssistantStoreError("assistant_invalid_input");
}
function assertUser(userId: string): void {
  if (typeof userId !== "string" || !uuid.test(userId)) invalid();
}
function assertKey(key: string): void {
  if (typeof key !== "string" || !requestKey.test(key)) invalid();
}
function validateAction(action: AssistantMutation): AssistantMutation {
  if (!action || typeof action !== "object" || Array.isArray(action)) invalid();
  const allowed =
    action.type === "reminder.create"
      ? ["type", "message", "remindAt"]
      : action.type === "memory.remember" || action.type === "memory.update"
        ? ["type", "memoryKey", "category", "content"]
        : action.type === "memory.archive" || action.type === "memory.delete"
          ? ["type", "memoryKey"]
          : invalid();
  if (Object.keys(action).some((key) => !allowed.includes(key))) invalid();
  if (action.type === "reminder.create") {
    if (
      typeof action.message !== "string" ||
      !action.message.trim() ||
      action.message.length > 1000 ||
      containsAssistantCredentials(action.message)
    )
      invalid();
    if (
      typeof action.remindAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        action.remindAt,
      ) ||
      !Number.isFinite(Date.parse(action.remindAt)) ||
      new Date(`${action.remindAt.slice(0, 10)}T00:00:00Z`)
        .toISOString()
        .slice(0, 10) !== action.remindAt.slice(0, 10)
    )
      invalid();
    return {
      ...action,
      message: action.message.trim(),
      remindAt: new Date(action.remindAt).toISOString(),
    };
  }
  if (typeof action.memoryKey !== "string" || !memoryKey.test(action.memoryKey))
    invalid();
  if (action.type === "memory.remember" || action.type === "memory.update") {
    if (
      typeof action.content !== "string" ||
      !action.content.trim() ||
      action.content.length > 1000 ||
      containsAssistantCredentials(action.content)
    )
      invalid();
    if (
      (action.type === "memory.remember" || action.category !== undefined) &&
      !categories.has(action.category!)
    )
      invalid();
    return { ...action, content: action.content.trim() };
  }
  return action;
}

/** Backend only. Consent and permission flags are enforced by the assistant registry. */
export class SupabaseAssistantStore implements AssistantStore {
  private readonly client: SupabaseClient<AssistantDatabase>;
  constructor(client: SupabaseClient<Database>) {
    this.client = client as unknown as SupabaseClient<AssistantDatabase>;
  }

  async listGradeChanges(
    userId: string,
    input: { since?: string; limit?: number } = {},
  ): Promise<Array<{ message: string; createdAt: string }>> {
    assertUser(userId);
    if (input.since !== undefined && !Number.isFinite(Date.parse(input.since)))
      invalid();
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)
    )
      invalid();
    let query = this.client
      .from("reminders")
      .select("message,created_at")
      .eq("user_id", userId)
      .eq("reminder_policy_key", "academic_grade_posted")
      .contains("metadata_json", { notification_kind: "instant_academic" });
    if (input.since !== undefined)
      query = query.gte("created_at", new Date(input.since).toISOString());
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 20);
    if (error || !data)
      throw new AssistantStoreError("assistant_storage_unavailable");
    return data.map((row) => ({
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  async listMemories(
    userId: string,
    input: AssistantMemoryQuery = {},
  ): Promise<AssistantMemoryRecord[]> {
    assertUser(userId);
    if (input.category !== undefined && !categories.has(input.category))
      invalid();
    if (
      input.includeArchived !== undefined &&
      typeof input.includeArchived !== "boolean"
    )
      invalid();
    if (
      input.query !== undefined &&
      (typeof input.query !== "string" || input.query.length > 200)
    )
      invalid();
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)
    )
      invalid();
    let query = this.client
      .from("assistant_memories")
      .select(
        "id,user_id,memory_key,category,content,created_at,updated_at,archived_at",
      )
      .eq("user_id", userId);
    if (!input.includeArchived) query = query.is("archived_at", null);
    if (input.category) query = query.eq("category", input.category);
    // No raw PostgREST grammar or wildcard characters originate in user input.
    const terms =
      input.query
        ?.toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.slice(0, 8) ?? [];
    for (const term of terms) query = query.ilike("content", `%${term}%`);
    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(input.limit ?? 20);
    if (error || !data)
      throw new AssistantStoreError("assistant_storage_unavailable");
    return data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      key: row.memory_key,
      category: row.category,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    }));
  }

  async executeMutation(
    input: AssistantMutationInput,
  ): Promise<AssistantMutationReceipt> {
    assertUser(input.userId);
    assertKey(input.idempotencyKey);
    if (input.source !== "telegram" && input.source !== "tma") invalid();
    const action = validateAction(input.action);
    // Mutation and content-free receipt commit together. Retry after a lost response
    // returns the committed receipt and cannot duplicate a memory or reminder.
    const { data, error } = await this.client.rpc(
      "assistant_execute_mutation",
      {
        p_user_id: input.userId,
        p_request_id: input.idempotencyKey,
        p_source: input.source,
        p_action: action as unknown as Json,
      },
    );
    if (error || !data || typeof data !== "object" || Array.isArray(data))
      throw new AssistantStoreError("assistant_storage_unavailable");
    if (
      typeof data.actionId !== "string" ||
      !uuid.test(data.actionId) ||
      (data.resourceId !== null &&
        (typeof data.resourceId !== "string" || !uuid.test(data.resourceId))) ||
      (data.status !== "succeeded" && data.status !== "not_found") ||
      typeof data.replayed !== "boolean"
    )
      throw new AssistantStoreError("assistant_storage_unavailable");
    return {
      actionId: data.actionId,
      resourceId: data.resourceId,
      status: data.status,
      replayed: data.replayed,
    };
  }

  async recordRead(input: AssistantReadAudit): Promise<void> {
    assertUser(input.userId);
    assertKey(input.requestId);
    if (
      typeof input.tool !== "string" ||
      !/^[a-z][a-z0-9_.]{0,79}$/.test(input.tool) ||
      !["telegram", "tma"].includes(input.source) ||
      !["succeeded", "rejected", "failed"].includes(input.status)
    )
      invalid();
    if (input.errorCode !== undefined && !errorCodes.has(input.errorCode))
      invalid();
    if (
      input.durationMs !== undefined &&
      (!Number.isInteger(input.durationMs) ||
        input.durationMs < 0 ||
        input.durationMs > 3_600_000)
    )
      invalid();
    const { error } = await this.client.from("assistant_actions").upsert(
      {
        user_id: input.userId,
        request_id: input.requestId,
        tool: input.tool,
        source: input.source,
        permission: "READ",
        status: input.status,
        duration_ms: input.durationMs ?? null,
        error_code: input.errorCode ?? null,
      },
      { onConflict: "user_id,request_id", ignoreDuplicates: true },
    );
    if (error) throw new AssistantStoreError("assistant_storage_unavailable");
  }
}
