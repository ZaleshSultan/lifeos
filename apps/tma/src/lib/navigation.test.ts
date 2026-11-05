import { describe, expect, it } from "vitest";
import {
  PRIMARY_SECTIONS,
  SECTION_SCREENS,
  resolveTmaLocation,
  sectionForScreen,
  tmaNavigationUrl,
} from "./navigation";

describe("four-section TMA navigation", () => {
  it("has exactly four primary sections and retains every existing feature", () => {
    expect(PRIMARY_SECTIONS.map((item) => item.id)).toEqual([
      "home",
      "health",
      "study",
      "settings",
    ]);
    const screens = new Set(
      Object.values(SECTION_SCREENS).flatMap((items) =>
        items.map((item) => item.screen),
      ),
    );
    for (const screen of [
      "home",
      "capture",
      "ai",
      "study",
      "dashboard",
      "lms",
      "workout",
      "ideal-human",
      "daily-life",
      "health",
      "focus",
      "finance",
      "sources",
      "reminders",
      "mode",
      "settings",
    ] as const) {
      expect(screens.has(screen)).toBe(true);
      expect(resolveTmaLocation(new URLSearchParams({ screen }))).toEqual({
        screen,
        section: sectionForScreen(screen),
      });
    }
  });
  it.each([
    ["workouts", "workout", "health"],
    ["nutrition", "daily-life", "health"],
    ["planner", "home", "home"],
    ["calendar", "home", "home"],
    ["notifications", "reminders", "settings"],
    ["integrations", "sources", "settings"],
  ])("maps legacy %s without losing its section", (alias, screen, section) => {
    expect(resolveTmaLocation(new URLSearchParams({ screen: alias }))).toEqual({
      screen,
      section,
    });
  });
  it("keeps shared views in their selected context and rejects invalid grouping", () => {
    expect(
      resolveTmaLocation(
        new URLSearchParams("screen=daily-life&section=health"),
      ),
    ).toEqual({ screen: "daily-life", section: "health" });
    expect(
      resolveTmaLocation(new URLSearchParams("screen=workout&section=study")),
    ).toEqual({ screen: "workout", section: "health" });
    expect(resolveTmaLocation(new URLSearchParams("screen=__proto__"))).toEqual(
      { screen: "home", section: "home" },
    );
    expect(
      resolveTmaLocation(new URLSearchParams("workoutId=synthetic")),
    ).toEqual({ screen: "workout", section: "health" });
  });
  it("preserves course, assignment, day, workout and capture context across sections", () => {
    const before = new URL(
      "https://lifeos.invalid/tma/?screen=study&courseId=course-1&studyTab=grades&assignmentId=assignment-1&date=2030-03-05&workoutId=workout-1&captureId=capture-1#detail",
    );
    const after = new URL(
      tmaNavigationUrl(before.href, { screen: "health", section: "health" }),
    );
    for (const key of [
      "courseId",
      "studyTab",
      "assignmentId",
      "date",
      "workoutId",
      "captureId",
    ])
      expect(after.searchParams.get(key)).toBe(before.searchParams.get(key));
    expect(after.hash).toBe("#detail");
    expect(after.searchParams.get("section")).toBe("health");
  });
});
