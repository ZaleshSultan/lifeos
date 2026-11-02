import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DAILY_LIFE_PREFERENCES,
  DailyLifeConflictError,
  dailyLifeDate,
  dailyLifeTimestamp,
  dailyLifeRecordId,
  parseDailyLifePreferences,
  type DailyLifePreferences,
  type HydrationSummary,
  type TaskWorkspace,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

export interface DailyLifeStore {
  hydration(
    userId: string,
    date: string,
    timezone: string,
  ): Promise<HydrationSummary>;
  logWater(
    userId: string,
    amountMl: number,
    requestId: string,
    source: "telegram" | "tma" | "web",
  ): Promise<string>;
  undoWater(userId: string, entryId: string): Promise<string>;
  tasks(userId: string): Promise<TaskWorkspace>;
  manageTask(
    userId: string,
    taskId: string | null,
    requestId: string | null,
    patch: Record<string, unknown>,
    expectedUpdatedAt: string | null,
  ): Promise<TaskWorkspace["tasks"][number]>;
  preferences(userId: string): Promise<DailyLifePreferences>;
  savePreferences(
    userId: string,
    preferences: DailyLifePreferences,
  ): Promise<DailyLifePreferences>;
}
function storageError(error: { message: string } | null) {
  if (!error) return;
  if (error.message === "daily_life_conflict")
    throw new DailyLifeConflictError();
  if (
    error.message === "task_not_found" ||
    error.message === "hydration_not_found"
  )
    throw new DailyLifeNotFoundError();
  throw new Error("Daily Life storage unavailable");
}
export class DailyLifeNotFoundError extends Error {
  constructor() {
    super("Record not found");
    this.name = "DailyLifeNotFoundError";
  }
}
function record(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved Daily Life record");
  return value;
}
function savedTask(
  r: Record<string, Json | undefined>,
): TaskWorkspace["tasks"][number] {
  try {
    const id = dailyLifeRecordId(r.id);
    if (
      typeof r.title !== "string" ||
      !r.title.trim() ||
      r.title.length > 500 ||
      typeof r.notes !== "string" ||
      r.notes.length > 5000 ||
      !["inbox", "next", "scheduled", "waiting", "done", "cancelled"].includes(
        String(r.status),
      )
    )
      throw new Error();
    const dueAt = r.dueAt === null ? null : dailyLifeTimestamp(r.dueAt);
    const updatedAt = dailyLifeTimestamp(r.updatedAt),
      completedAt =
        r.completedAt === null ? null : dailyLifeTimestamp(r.completedAt);
    if (
      r.priority !== undefined &&
      (typeof r.priority !== "number" || !Number.isSafeInteger(r.priority))
    )
      throw new Error();
    return {
      id,
      title: r.title,
      notes: r.notes,
      dueAt,
      status: r.status as TaskWorkspace["tasks"][number]["status"],
      updatedAt,
      completedAt,
      ...(r.priority !== undefined ? { priority: r.priority as number } : {}),
    };
  } catch {
    throw new Error("Invalid saved task record");
  }
}
export function createDailyLifeStore(
  client: SupabaseClient<Database>,
): DailyLifeStore {
  return {
    async hydration(userId, date, _timezone) {
      dailyLifeDate(date);
      const { data, error } = await client.rpc("get_hydration_summary", {
        p_user_id: userId,
        p_date: date,
      });
      storageError(error);
      const saved = record(data!);
      if (
        saved.date !== date ||
        typeof saved.timezone !== "string" ||
        typeof saved.totalMl !== "number" ||
        !Number.isSafeInteger(saved.totalMl) ||
        saved.totalMl < 0 ||
        typeof saved.truncated !== "boolean" ||
        !Array.isArray(saved.entries) ||
        saved.entries.length > 200
      )
        throw new Error("Invalid saved hydration summary");
      const entries = saved.entries.map((value) => {
        const r = record(value);
        if (
          typeof r.id !== "string" ||
          typeof r.amountMl !== "number" ||
          !Number.isInteger(r.amountMl) ||
          r.amountMl < 1 ||
          r.amountMl > 5000 ||
          typeof r.occurredAt !== "string" ||
          !Number.isFinite(Date.parse(r.occurredAt)) ||
          !["telegram", "tma", "web"].includes(String(r.source)) ||
          (r.undoneAt !== null &&
            (typeof r.undoneAt !== "string" ||
              !Number.isFinite(Date.parse(r.undoneAt))))
        )
          throw new Error("Invalid saved hydration entry");
        return {
          id: r.id,
          amountMl: r.amountMl,
          occurredAt: r.occurredAt,
          source: r.source as "telegram" | "tma" | "web",
          undoneAt: r.undoneAt as string | null,
        };
      });
      return {
        date,
        timezone: saved.timezone,
        totalMl: saved.totalMl,
        entries,
        truncated: saved.truncated,
      };
    },
    async logWater(userId, amountMl, requestId, source) {
      const { data, error } = await client.rpc("log_hydration", {
        p_user_id: userId,
        p_request_id: requestId,
        p_amount_ml: amountMl,
        p_source: source,
      });
      storageError(error);
      return dailyLifeDate(record(data!).date);
    },
    async undoWater(userId, entryId) {
      dailyLifeRecordId(entryId);
      const { data, error } = await client.rpc("undo_hydration", {
        p_user_id: userId,
        p_entry_id: entryId,
      });
      storageError(error);
      return dailyLifeDate(record(data!).date);
    },
    async tasks(userId) {
      const { data, error } = await client
        .from("tasks")
        .select("id,title,notes,due_at,status,priority,updated_at,completed_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(501);
      storageError(error);
      return {
        tasks: (data ?? []).slice(0, 500).map((r) =>
          savedTask({
            id: r.id,
            title: r.title,
            notes: r.notes ?? "",
            dueAt: r.due_at,
            status: r.status,
            priority: r.priority,
            updatedAt: r.updated_at,
            completedAt: r.completed_at,
          }),
        ),
        truncated: (data?.length ?? 0) > 500,
      };
    },
    async manageTask(userId, taskId, requestId, patch, expectedUpdatedAt) {
      if (taskId !== null) dailyLifeRecordId(taskId);
      const { data, error } = await client.rpc("manage_lifeos_task", {
        p_user_id: userId,
        p_task_id: taskId,
        p_request_id: requestId,
        p_patch: patch as Json,
        p_expected_updated_at: expectedUpdatedAt,
      });
      storageError(error);
      return savedTask(record(data!));
    },
    async preferences(userId) {
      const { data, error } = await client
        .from("daily_life_preferences")
        .select("preferences,revision")
        .eq("user_id", userId)
        .maybeSingle();
      storageError(error);
      return data
        ? parseDailyLifePreferences({
            ...record(data.preferences),
            revision: data.revision,
          })
        : { ...DEFAULT_DAILY_LIFE_PREFERENCES };
    },
    async savePreferences(userId, input) {
      const parsed = parseDailyLifePreferences(input);
      const { revision, ...preferences } = parsed;
      const { data, error } = await client.rpc("save_daily_life_preferences", {
        p_user_id: userId,
        p_preferences: preferences,
        p_expected_revision: revision,
      });
      storageError(error);
      return parseDailyLifePreferences(data);
    },
  };
}
