import { describe, expect, it } from "vitest";
import {
  applyModeToFocusScoring,
  getModeLabel,
  getModePriorityWeights,
  parseLifeMode,
  resolveCurrentMode,
} from "./modes.js";

describe("life mode resolution", () => {
  it("resolves an active manual override first", () => {
    const result = resolveCurrentMode("user-1", {
      now: "2026-05-21T10:00:00.000Z",
      manualOverrides: [
        {
          userId: "user-1",
          mode: "summer",
          source: "manual",
          reason: "Manual test",
          activeFrom: "2026-05-21T09:00:00.000Z",
          activeUntil: null,
          isActive: true,
        },
      ],
      latestHealthDaily: {
        userId: "user-1",
        sleepMinutes: 240,
        recoveryMode: "recovery",
      },
    });

    expect(result.mode).toBe("summer");
    expect(result.source).toBe("manual");
    expect(result.reason).toBe("Manual test");
  });

  it("ignores expired manual overrides", () => {
    const result = resolveCurrentMode("user-1", {
      now: "2026-05-21T10:00:00.000Z",
      manualOverrides: [
        {
          userId: "user-1",
          mode: "summer",
          source: "manual",
          activeFrom: "2026-05-20T09:00:00.000Z",
          activeUntil: "2026-05-21T09:59:59.000Z",
          isActive: true,
        },
      ],
    });

    expect(result.mode).toBe("trimester");
    expect(result.source).toBe("default");
  });

  it("enters recovery mode from latest health daily", () => {
    const result = resolveCurrentMode("user-1", {
      now: "2026-05-21T10:00:00.000Z",
      latestHealthDaily: {
        userId: "user-1",
        sleepMinutes: 329,
        recoveryMode: "baseline",
      },
    });

    expect(result.mode).toBe("recovery");
    expect(result.source).toBe("health");
  });

  it("uses active season by date", () => {
    const result = resolveCurrentMode("user-1", {
      now: "2026-07-01T10:00:00.000Z",
      seasons: [
        {
          userId: "user-1",
          name: "Summer build",
          mode: "summer",
          startsOn: "2026-06-10",
          endsOn: "2026-08-20",
        },
      ],
    });

    expect(result.mode).toBe("summer");
    expect(result.source).toBe("season");
    expect(result.reason).toContain("Summer build");
  });

  it("defaults to trimester", () => {
    expect(
      resolveCurrentMode("user-1", {
        now: "2026-05-21T10:00:00.000Z",
      }).mode,
    ).toBe("trimester");
  });

  it("returns configured labels", () => {
    expect(getModeLabel("exam_war")).toBe("Exam War Mode");
    expect(getModeLabel("recovery_setup")).toBe("Recovery / Setup Mode");
    expect(getModeLabel("summer_term")).toBe("Summer Term Mode");
  });

  it("parses phase 1 mode names", () => {
    expect(parseLifeMode("Practice Mode")).toBe("practice");
    expect(parseLifeMode("Recovery / Setup Mode")).toBe("recovery_setup");
    expect(parseLifeMode("summer-term")).toBe("summer_term");
  });

  it("resolves the phase 1 summer term season", () => {
    const result = resolveCurrentMode("user-1", {
      now: "2026-07-10T10:00:00.000Z",
      seasons: [
        {
          userId: "user-1",
          name: "Summer Term Mode",
          mode: "summer_term",
          startsOn: "2026-07-06",
          endsOn: "2026-08-15",
        },
      ],
    });

    expect(result.mode).toBe("summer_term");
    expect(result.label).toBe("Summer Term Mode");
  });

  it("has weights for phase 1 course work", () => {
    expect(getModePriorityWeights("practice").practice).toBe(100);
    expect(getModePriorityWeights("summer_term").discrete_math).toBe(100);
  });
});

describe("mode-aware focus scoring", () => {
  it("changes item ordering between exam_war and summer", () => {
    const items = [
      {
        id: "project",
        title: "Ship cybersecurity project",
        metadata: { priorityKey: "projects" },
        score: 10,
      },
      {
        id: "exam",
        title: "Study for exam deadline",
        metadata: { priorityKey: "study" },
        score: 10,
      },
    ];

    expect(applyModeToFocusScoring(items, "exam_war").at(0)?.id).toBe("exam");
    expect(applyModeToFocusScoring(items, "summer").at(0)?.id).toBe("project");
  });
});
