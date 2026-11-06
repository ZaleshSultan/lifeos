import { describe, expect, it } from "vitest";
import {
  WEB_MODULES,
  WEB_SECTIONS,
  webContextDate,
  webNavigationHref,
  webSection,
} from "./navigation";
describe("four-section web navigation", () => {
  it("keeps all fourteen existing routes reachable under four sections", () => {
    expect(WEB_SECTIONS.map(({ label }) => label)).toEqual([
      "Главная",
      "Здоровье",
      "Учёба",
      "Настройки",
    ]);
    const routes = new Set(
      Object.values(WEB_MODULES)
        .flat()
        .map(({ href }) => href.split("#")[0]),
    );
    for (const route of [
      "/today",
      "/planner",
      "/calendar",
      "/study",
      "/workouts",
      "/health",
      "/nutrition",
      "/finance",
      "/ai",
      "/capture",
      "/ideal-human",
      "/creator",
      "/notifications",
      "/settings",
    ])
      expect(routes.has(route)).toBe(true);
  });
  it.each([
    ["/web/planner", "home"],
    ["/web/workouts", "health"],
    ["/nutrition", "health"],
    ["/study", "study"],
    ["/notifications", "settings"],
    ["/settings", "settings"],
  ])("groups the legacy %s route", (path, section) =>
    expect(webSection(path)).toBe(section),
  );
  it("keeps a shared journal in its selected context", () => {
    expect(webSection("/ideal-human", "health")).toBe("health");
    expect(webSection("/planner", "health")).toBe("home");
    expect(webSection("/settings", "__proto__")).toBe("settings");
  });
  it("preserves resource context but excludes auth and unrecognized query values", () => {
    const href = webNavigationHref(
      "/study#grades",
      "courseId=fixture&date=2026-01-02&studyTab=grades&token=secret&unknown=private",
      "study",
    );
    expect(href).toBe(
      "/study?courseId=fixture&studyTab=grades&date=2026-01-02&section=study#grades",
    );
  });
  it("accepts an actual calendar date without normalizing invalid days", () => {
    expect(webContextDate("2026-02-28", "2026-01-01")).toBe("2026-02-28");
    for (const invalid of [
      "2026-02-30",
      "invalid",
      ["2026-02-28"],
      "2026-01-01&secret=value",
    ])
      expect(webContextDate(invalid, "2026-01-01")).toBe("2026-01-01");
  });
});
