import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import {
  assistantLocalDate,
  type AssistantToolCall,
  type AssistantToolOutput,
} from "@lifeos/core";
import type { AssistantMutation, LifeOSStore } from "@lifeos/db";
import { loadPlanningData, planningDate } from "../planning-context.js";
import { AssistantError, type AssistantExecutionContext } from "./registry.js";

function timestamp(value: string): string | null {
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function clock(value: string, timezone: string): string {
  return DateTime.fromISO(value, { zone: timezone }).toFormat(
    "yyyy-MM-dd HH:mm",
  );
}
function displayText(value: string): string {
  return value.length <= 14000
    ? value
    : `${value.slice(0, 13850)}\nResults are limited. / Показана часть результатов.`;
}

export async function executeProductivityTool(
  store: LifeOSStore,
  context: AssistantExecutionContext,
  call: AssistantToolCall,
): Promise<AssistantToolOutput> {
  const { user, now } = context;
  const limit = Number(call.args.limit ?? 20);
  if (call.tool === "productivity.reminders") {
    const reminders = await store.listUpcomingReminders(user.userId, limit);
    return {
      text: displayText(
        reminders.length
          ? reminders
              .map(
                (r) =>
                  `${clock(r.remindAt, user.timezone)} — ${r.message.slice(0, 350)}`,
              )
              .join("\n")
          : "No pending reminders. / Нет предстоящих напоминаний.",
      ),
      sources: [
        { name: "Saved reminders / Сохранённые напоминания", updatedAt: null },
      ],
    };
  }
  const date = planningDate(
    user,
    call.args.date ?? assistantLocalDate(now, user.timezone),
    now,
  );
  if (call.tool === "productivity.tasks") {
    const day = DateTime.fromISO(date, { zone: user.timezone }).startOf("day");
    const snapshot = await store.getPlanningSnapshot(user.userId, {
      startsAt: day.toUTC().toISO()!,
      endsAt: day.plus({ days: 7 }).toUTC().toISO()!,
      historyStartsAt: now.toISOString(),
      historyEndsAt: now.toISOString(),
    });
    return {
      text: displayText(
        [
          snapshot.tasks.length
            ? snapshot.tasks
                .slice(0, limit)
                .map(
                  (t) =>
                    `${t.title.slice(0, 350)}${t.scheduled_for ? ` — scheduled / запланировано: ${clock(t.scheduled_for, user.timezone)}` : ""}${t.due_at ? ` — due / срок: ${clock(t.due_at, user.timezone)}` : ""}`,
                )
                .join("\n")
            : "No current tasks. / Нет текущих задач.",
          ...(snapshot.truncated || snapshot.tasks.length > limit
            ? ["Results are limited. / Показана часть результатов."]
            : []),
        ].join("\n"),
      ),
      sources: [
        {
          name: "Current saved tasks / Текущие сохранённые задачи",
          updatedAt: null,
        },
      ],
    };
  }
  const data = await loadPlanningData(store, user, date, now);
  const sources = [
    {
      name: "Saved calendar, classes and tasks / Календарь, пары и задачи",
      updatedAt: null,
    },
  ];
  if (call.tool === "productivity.calendar")
    return {
      text: displayText(
        data.events.length
          ? data.events
              .slice(0, limit)
              .map(
                (e) =>
                  `${clock(e.startsAt, user.timezone)}–${clock(e.endsAt, user.timezone)} — ${e.title.slice(0, 350)}`,
              )
              .join("\n")
          : "No saved commitments for this day. / На этот день нет сохранённых событий.",
      ),
      sources,
    };
  if (call.tool !== "productivity.availability")
    throw new AssistantError("assistant_tool_unavailable");
  // Planner blocks all availability when commitments are incomplete or truncated.
  const day = DateTime.fromISO(date, { zone: user.timezone });
  const start = DateTime.fromISO(
    `${date}T${String(call.args.startTime ?? "09:00")}`,
    { zone: user.timezone },
  );
  const end = DateTime.fromISO(
    `${date}T${String(call.args.endTime ?? "21:00")}`,
    { zone: user.timezone },
  );
  if (!day.isValid || !start.isValid || !end.isValid || start >= end)
    throw new AssistantError("assistant_invalid_request");
  // Deliberately stay inside the existing planner's verified 09:00–21:00 window.
  const duration = Number(call.args.durationMinutes) * 60_000;
  const slots = data.plan.freeSlots
    .map((slot) => ({
      startsAt: Math.max(
        Date.parse(slot.startsAt),
        start.toMillis(),
        now.getTime(),
      ),
      endsAt: Math.min(Date.parse(slot.endsAt), end.toMillis()),
    }))
    .filter((slot) => slot.endsAt - slot.startsAt >= duration)
    .slice(0, 20);
  return {
    text: [
      slots.length
        ? slots
            .map(
              (s) =>
                `${clock(new Date(s.startsAt).toISOString(), user.timezone)}–${clock(new Date(s.endsAt).toISOString(), user.timezone)}`,
            )
            .join("\n")
        : "No verified slot of this duration. / Нет подтверждённого свободного окна нужной длительности.",
      "Based on saved commitments, within 09:00–21:00; travel and unscheduled tasks may need extra time. / Учтены сохранённые события в пределах 09:00–21:00; дорога и незапланированные дела могут занять время.",
      ...data.plan.warnings.slice(0, 5),
    ].join("\n"),
    sources,
  };
}

export function assistantMutation(call: AssistantToolCall): AssistantMutation {
  if (call.tool === "reminders.create")
    return {
      type: "reminder.create",
      message: String(call.args.title),
      remindAt: String(call.args.remindAt),
    };
  const memoryKey = String(
    call.args.key ??
      `fact-${createHash("sha256").update(String(call.args.content)).digest("hex").slice(0, 16)}`,
  );
  if (call.tool === "memory.remember" || call.tool === "memory.update")
    return {
      type: call.tool,
      memoryKey,
      content: String(call.args.content),
      category: call.args.category as "fact",
    };
  if (call.tool === "memory.archive" || call.tool === "memory.delete")
    return { type: call.tool, memoryKey };
  throw new AssistantError("assistant_invalid_request");
}

export function mutationSummary(
  call: AssistantToolCall,
  timezone: string,
): string {
  const mutation = assistantMutation(call);
  if (mutation.type === "reminder.create")
    return `Reminder / Напоминание: ${clock(mutation.remindAt, timezone)} (${timezone}) — ${mutation.message}`;
  if (mutation.type === "memory.remember" || mutation.type === "memory.update")
    return `${mutation.type === "memory.remember" ? "Remember / Запомнить" : "Update / Обновить"} [${mutation.memoryKey}]: ${mutation.content}`;
  return `${mutation.type === "memory.delete" ? "Permanently delete / Удалить навсегда" : "Archive / Архивировать"}: ${mutation.memoryKey}`;
}

export async function executeMemoryOrWriteTool(
  store: LifeOSStore,
  context: AssistantExecutionContext,
  call: AssistantToolCall,
): Promise<AssistantToolOutput> {
  const persistence = store.assistant;
  if (!persistence) throw new AssistantError("assistant_unavailable");
  if (call.tool === "memory.list" || call.tool === "memory.search") {
    const memories = await persistence.listMemories(context.user.userId, {
      limit: Number(call.args.limit ?? 20),
      ...(call.args.includeArchived === true ? { includeArchived: true } : {}),
      ...(call.tool === "memory.search"
        ? { query: String(call.args.query) }
        : {}),
    });
    if (memories.some((m) => m.userId !== context.user.userId))
      throw new AssistantError("assistant_permission_denied");
    return {
      text: displayText(
        memories.length
          ? memories
              .map(
                (m) =>
                  `[${m.key}] (${m.category}${m.archivedAt ? "; archived / архив" : ""}) ${m.content}`,
              )
              .join("\n")
          : "No matching memories. / Подходящих воспоминаний нет.",
      ),
      sources: [
        {
          name: "Explicit assistant memories / Явно сохранённая память",
          updatedAt: memories.length
            ? timestamp(
                memories
                  .map((m) => m.updatedAt)
                  .sort()
                  .at(-1)!,
              )
            : null,
        },
      ],
    };
  }
  // The RPC checks its durable receipt before validating a new reminder's time.
  // A committed request can therefore be retried after the reminder becomes due.
  const receipt = await persistence.executeMutation({
    userId: context.user.userId,
    source: context.source,
    idempotencyKey: `${context.source}:${context.requestId}`,
    action: assistantMutation(call),
  });
  return {
    text: receipt.replayed
      ? "This request was already completed; no action was repeated. / Запрос уже выполнен; повторного действия не было."
      : receipt.status === "not_found"
        ? "No matching memory exists. / Память с таким ключом не найдена."
        : `${call.tool === "memory.delete" ? "Permanently deleted / Удалено навсегда" : "Saved / Сохранено"}.\n${call.tool === "memory.delete" ? String(call.args.key) : mutationSummary(call, context.user.timezone)}`,
    sources: [{ name: "LifeOS", updatedAt: null }],
  };
}
