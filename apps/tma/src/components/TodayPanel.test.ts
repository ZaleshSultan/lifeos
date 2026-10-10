import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({ telegram: { initData: "" } }));

import type { TodaySummary } from "../api/planning";
import { formatPlanTime, shiftPlanDate, TodayDetails } from "./TodayPanel";

describe("Today planner presentation", () => {
  it("uses planner timezone rather than the browser timezone and handles date boundaries", () => {
    expect(formatPlanTime("2026-10-10T04:00:00Z", "Asia/Almaty")).toMatch(
      /09:00|9:00/,
    );
    expect(shiftPlanDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftPlanDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("presents actual activity, provisional duration, and conflicts without internal references", () => {
    const summary: TodaySummary = {
      plan: {
        date: "2026-10-10",
        timezone: "Asia/Almaty",
        mode: "trimester",
        window: {
          startsAt: "2026-10-10T04:00:00Z",
          endsAt: "2026-10-10T17:00:00Z",
        },
        availableMinutes: 90,
        freeSlots: [],
        conflicts: [{ eventIds: ["hidden-event-ref"] }],
        rankedTasks: [
          {
            id: "hidden-task-ref",
            title: "Finish assignment",
            dueAt: "invalid",
            score: 20,
            reasons: ["Deadline is overdue."],
          },
        ],
        blocks: [
          {
            taskId: "hidden-task-ref",
            title: "Finish assignment",
            startsAt: "2026-10-10T04:00:00Z",
            endsAt: "2026-10-10T04:30:00Z",
            estimated: true,
          },
        ],
        unscheduledTaskIds: [],
        warnings: [],
      },
      events: [],
      reminders: [
        { title: "Bring notebook", remindAt: "2026-10-10T05:00:00Z" },
      ],
      productivity: {
        startDate: "2026-10-04",
        endDate: "2026-10-10",
        timezone: "Asia/Almaty",
        daily: [{ date: "2026-10-10", created: 3, completed: 2 }],
        totalCreated: 3,
        totalCompleted: 2,
        completionRate: null,
        truncated: true,
        warnings: [],
      },
      ai: {
        enabled: false,
        available: false,
        reason: "ai_disabled",
        liveEnabled: false,
      },
    };
    const html = renderToStaticMarkup(createElement(TodayDetails, { summary }));
    expect(html).toContain("2 tasks completed · 3 created");
    expect(html).toContain("Duration estimated");
    expect(html).toContain("assumed 09:00–21:00 day");
    expect(html).toContain("1 calendar conflict needs attention");
    expect(html).toContain("Deadline is overdue.");
    expect(html).toContain("Activity is partial");
    expect(html).toContain("invalid deadline");
    expect(html).not.toContain("hidden-task-ref");
    expect(html).not.toContain("hidden-event-ref");
  });
});
