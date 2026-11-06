import type { TodaySummary } from "../apps/tma/src/api/planning.js";

/** Synthetic read model checked against the actual TMA response contract. */
export function v6Today(date: string): TodaySummary {
  return {
    plan: {
      date,
      timezone: "Asia/Almaty",
      mode: "maintenance",
      window: { startsAt: `${date}T04:00:00Z`, endsAt: `${date}T16:00:00Z` },
      availableMinutes: 720,
      freeSlots: [],
      conflicts: [],
      rankedTasks: [],
      blocks: [],
      unscheduledTaskIds: [],
      warnings: [],
    },
    events: [],
    reminders: [],
    productivity: {
      startDate: date,
      endDate: date,
      timezone: "Asia/Almaty",
      daily: [],
      totalCreated: 0,
      totalCompleted: 0,
      completionRate: null,
      truncated: false,
      warnings: [],
    },
    ai: {
      enabled: false,
      available: false,
      reason: "fixture_disabled",
      liveEnabled: false,
      assistantEnabled: false,
    },
  };
}
