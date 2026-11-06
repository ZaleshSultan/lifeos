import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  gradeTargetBindingsKey,
  gradeTargetContextKey,
  gradeTargetDefinitionKey,
} from "../packages/core/src/grade-target.js";
import { renderAcademicNotification } from "./render-academic-notification.js";

const now = "2026-11-06T10:00:00Z",
  id = "f1000000-0000-4000-8000-000000000001";
function candidate() {
  const definition = {
    version: 1 as const,
    sourceName: "Reviewed synthetic syllabus p2",
    attestationThreshold: 25,
    fields: [
      { id: "a", label: "ATT1", period: "att1" as const, weightPercent: 100 },
      { id: "b", label: "ATT2", period: "att2" as const, weightPercent: 100 },
      {
        id: "exam",
        label: "Exam",
        period: "exam" as const,
        weightPercent: 100,
      },
    ],
  };
  const bindings = {
    a: {
      mode: "aggregate" as const,
      ruleConfirmed: true,
      entries: [{ recordId: "r1", weight: 100 }],
    },
  };
  return {
    kind: "grade",
    courseId: id,
    courseTitle: "Synthetic course",
    events: [
      {
        kind: "posted",
        itemTitle: "Assessment",
        moodleCourseId: "42",
        moodleItemId: "101",
        oldScore: null,
        oldMaxScore: null,
        newScore: 15,
        newMaxScore: 30,
      },
    ],
    forecast: {
      courseId: id,
      externalCourseKey: "moodle:42",
      courseStartsOn: null,
      courseEndsOn: null,
      calculator: {
        definition,
        values: { a: 100, b: 100, exam: 100 },
        target: 70,
      },
      bindings,
      records: [
        {
          id: "r1",
          courseTitle: "Synthetic course",
          title: "Assessment",
          score: 15,
          maxScore: 30,
          updatedAt: "2026-11-06T09:00:00Z",
          rawJson: { moodle_course_id: "42", moodle_item_id: "101" },
        },
      ],
      lms: {
        configured: true,
        stale: false,
        lastSuccessfulSyncAt: "2026-11-06T09:50:00Z",
      },
      review: {
        version: 1,
        externalCourseKey: "moodle:42",
        definitionKey: gradeTargetDefinitionKey(definition),
        bindingsKey: gradeTargetBindingsKey(bindings),
        contextKey: gradeTargetContextKey({
          externalCourseKey: "moodle:42",
          startsOn: null,
          endsOn: null,
        }),
        reviewedAt: "2026-11-06T09:30:00Z",
        sourceRef: "Current synthetic syllabus p2",
        supportedPolicy: "linear-30-30-40",
      },
    },
  };
}
describe("academic notification preparation", () => {
  it("reuses actual engine evidence and sends course-specific supported deep links", () => {
    const result = renderAcademicNotification(candidate(), now);
    expect(result.message).toContain("15/30 (50.0%)");
    expect(result.message).toContain("Заработано итоговых баллов: 15.00/100");
    expect(result.message).toContain("Оставшийся вес: 70.0%");
    expect(result.message).toContain("78.6%");
    expect(result.links).toHaveLength(3);
    for (const link of result.links)
      expect(new URL(link.url).searchParams.get("courseId")).toBe(id);
    expect(new URL(result.links[0].url).searchParams.get("studyTab")).toBe(
      "grades",
    );
    expect(new URL(result.links[1].url).searchParams.get("studyTab")).toBe(
      "calculator",
    );
  });
  it("does not invent exact forecasts from unreviewed, stale or hidden evidence", () => {
    for (const defect of ["review", "stale", "hidden"] as const) {
      const c = candidate();
      if (defect === "review")
        c.forecast.review.definitionKey = "different definition";
      if (defect === "stale") c.forecast.lms.stale = true;
      if (defect === "hidden")
        Object.assign(c.forecast.records[0].rawJson, {
          _grade_visibility_unknown: true,
        });
      const result = renderAcademicNotification(c, now);
      expect(result.message).toContain("Точный прогноз на 70 пока недоступен");
      if (defect === "review")
        expect(result.message).toContain(
          "необходимо подтвердить веса оценивания",
        );
      if (defect === "stale")
        expect(result.message).toContain(
          "свежая успешная проверка Moodle не подтверждена",
        );
      expect(result.message).not.toContain("Заработано итоговых баллов");
    }
  });
  it("withholds exact analysis and names stale evidence while preserving the reviewed policy", () => {
    const c = candidate();
    const stale = "2026-11-04T09:59:59Z";
    c.forecast.records[0].updatedAt = stale;
    const result = renderAcademicNotification(c, now);
    expect(result.message).toContain("сведения об оценках устарели");
    expect(result.message).not.toContain("Заработано итоговых баллов");
    expect(result.message).not.toContain(
      "необходимо подтвердить веса оценивания",
    );
    expect(c.forecast.review.sourceRef).toBe("Current synthetic syllabus p2");
  });
  it("groups changes and omits pretend course analysis when mapping is unknown", () => {
    const c = candidate();
    const result = renderAcademicNotification(
      {
        ...c,
        courseId: null,
        events: Array.from({ length: 100 }, () => c.events[0]),
      },
      now,
    );
    expect(result.message).toContain("Ещё 95 изменений");
    expect(result.message.length).toBeLessThanOrEqual(3500);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].text).toBe("Открыть учёбу");
    expect(new URL(result.links[0].url).searchParams.has("courseId")).toBe(
      false,
    );
  });
  it("keeps a missing numerical maximum unknown and distinguishes corrections", () => {
    const result = renderAcademicNotification(
      {
        ...candidate(),
        events: [
          {
            kind: "corrected",
            itemTitle: "Work",
            oldScore: 0,
            oldMaxScore: null,
            newScore: 7,
            newMaxScore: null,
          },
        ],
      },
      now,
    );
    expect(result.message).toContain("Было: 0 (максимум не подтверждён)");
    expect(result.message).toContain("7 (максимум не подтверждён)");
  });
  it("runs the installed bounded CLI with JSON stdin and no provider configuration", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=128",
        "--import",
        "tsx",
        "scripts/render-academic-notification.ts",
      ],
      {
        cwd: process.cwd(),
        input: JSON.stringify({ candidate: candidate(), now }),
        timeout: 15000,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(
      renderAcademicNotification(candidate(), now),
    );
  });
  it("renders quiz closing separately and rejects an unverified Moodle destination", () => {
    const result = renderAcademicNotification(
      {
        kind: "quiz",
        courseId: id,
        courseTitle: "Synthetic",
        title: "Quiz",
        offsetMinutes: 180,
        targetAt: "2026-11-06T13:00:00Z",
        lastSuccessfulSyncAt: now,
        timezone: "UTC",
        sourceUrl: "https://evil.example/mod/quiz/view.php?id=1",
      },
      now,
    );
    expect(result.message).toContain("закрытие попыток");
    expect(result.message).toContain("3 ч");
    expect(result.links.some((link) => link.url.includes("evil"))).toBe(false);
    expect(new URL(result.links[0].url).searchParams.get("courseId")).toBe(id);
    expect(new URL(result.links[0].url).searchParams.get("studyTab")).toBe(
      "work",
    );
  });
});
