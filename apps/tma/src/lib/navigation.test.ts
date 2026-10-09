import { describe, expect, it } from "vitest";
import { screenFromSearch } from "./navigation";
import {
  studyTabIds,
  studyTabFromSearch,
  studyNavigationUrl,
} from "../components/study/navigation";

describe("Telegram Mini App launch routing", () => {
  it("opens each study tab from Telegram's URL and signed launch metadata", () => {
    for (const tab of studyTabIds) {
      const start = `study_${tab}`;
      const search = `?tgWebAppStartParam=${start}`;
      const initData = new URLSearchParams({ start_param: start }).toString();
      expect(screenFromSearch(search)).toBe("study");
      expect(studyTabFromSearch(search)).toBe(tab);
      expect(screenFromSearch("", initData)).toBe("study");
      expect(studyTabFromSearch("", initData)).toBe(tab);
    }
  });

  it("keeps explicit in-app navigation when the original Telegram launch parameter remains", () => {
    const initData = "start_param=study_grades";
    expect(screenFromSearch("?screen=finance", initData)).toBe("finance");
    const saved = studyNavigationUrl(
      "https://life.example/tma/?tgWebAppStartParam=study_grades",
      "deadlines",
      null,
    );
    expect(screenFromSearch(new URL(saved).search, initData)).toBe("study");
    expect(studyTabFromSearch(new URL(saved).search, initData)).toBe(
      "deadlines",
    );
  });

  it("supports all top-level sections, workout links and safe fallbacks", () => {
    for (const screen of [
      "home",
      "study",
      "workout",
      "health",
      "focus",
      "finance",
      "sources",
      "reminders",
      "mode",
    ] as const) {
      expect(screenFromSearch(`?tgWebAppStartParam=${screen}`)).toBe(screen);
      expect(screenFromSearch(`?screen=${screen}`)).toBe(screen);
    }
    expect(screenFromSearch("?workoutId=workout-one")).toBe("workout");
    expect(screenFromSearch("?screen=finance&workoutId=workout-one")).toBe(
      "finance",
    );
    expect(
      screenFromSearch(
        "?screen=unknown&tgWebAppStartParam=https%3A%2F%2Fforeign.example",
      ),
    ).toBe("home");
    expect(studyTabFromSearch("?tgWebAppStartParam=study_unknown")).toBe(
      "today",
    );
  });
});
