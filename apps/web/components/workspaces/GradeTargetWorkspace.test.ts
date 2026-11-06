import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudyWorkspace } from "../../../tma/src/api/study-types";
import { defaultScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import { GradeTargetWorkspace } from "./GradeTargetWorkspace";
const send = vi.hoisted(() => vi.fn());
vi.mock("../../lib/web-client", () => ({
  webRequest: send,
  webErrorMessage: () => "Unavailable",
}));
vi.mock("../WorkspaceUI", () => ({
  Notice: ({ children }: { children: unknown }) =>
    createElement("p", null, children as string),
  useUnsavedGuard: () => {},
  buttonClass: "button",
  inputClass: "input",
}));
function fixture(): { initial: StudyWorkspace; initialFeed: GradeEventFeed } {
  const now = new Date().toISOString();
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    initial: {
      timezone: "Asia/Almaty",
      courses: [
        {
          id,
          title: "Synthetic course",
          code: "DEMO",
          startsOn: null,
          endsOn: null,
          externalCourseKey: "moodle:42",
          schedules: [],
          calculator: {
            definition: {
              version: 1,
              sourceName: "Synthetic syllabus page 2",
              attestationThreshold: 25,
              fields: [
                { id: "a", label: "ATT1", period: "att1", weightPercent: 100 },
                { id: "b", label: "ATT2", period: "att2", weightPercent: 100 },
                {
                  id: "exam",
                  label: "Exam",
                  period: "exam",
                  weightPercent: 100,
                },
              ],
            },
            values: { a: 100, b: 100, exam: 100 },
            target: 70,
          },
          scholarship: {
            ...defaultScholarshipConfig(),
            bindings: {
              a: {
                mode: "aggregate",
                ruleConfirmed: true,
                entries: [{ recordId: "record", weight: 100 }],
              },
            },
          },
        },
      ],
      records: [
        {
          id: "record",
          userId: "synthetic-owner",
          sourceEventId: null,
          courseTitle: "Synthetic course",
          recordType: "assignment",
          title: "Synthetic grade",
          valueText: null,
          score: 15,
          maxScore: 30,
          percentage: 50,
          occursAt: null,
          dueAt: null,
          createdAt: now,
          updatedAt: now,
          rawJson: { moodle_course_id: "42", moodle_item_id: "101" },
        },
      ],
    },
    initialFeed: {
      events: [
        {
          id: "event",
          courseId: id,
          courseTitle: "Synthetic course",
          itemTitle: "Synthetic grade",
          kind: "corrected",
          observedAt: now,
          oldScore: 10,
          oldMaxScore: 30,
          newScore: 15,
          newMaxScore: 30,
          moodleCourseId: "42",
          moodleItemId: "101",
          sourceUrl: null,
        },
      ],
      eligibleDeadlines: [],
      preferences: {
        revision: 0,
        academicRevision: 0,
        courseReviews: {},
        gradeAlertsEnabled: false,
        assignmentAlertsEnabled: false,
        quizAlertsEnabled: false,
        assignmentOffsetsMinutes: [],
        quizOffsetsMinutes: [],
        quietStart: "23:00",
        quietEnd: "08:00",
      },
      lms: {
        configured: true,
        stale: false,
        lastSuccessfulSyncAt: now,
        state: "ready",
      },
      truncated: false,
      deliveryEnabled: false,
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  send.mockClear();
});
describe("authenticated web grade workspace", () => {
  it("focuses grades and corrections on the requested owned course", () => {
    const data = fixture();
    const first = data.initial.courses[0];
    data.initial.courses.push({
      ...first,
      id: "22222222-2222-4222-8222-222222222222",
      title: "Other owned course",
      externalCourseKey: "moodle:43",
    });
    data.initial.records.push({
      ...data.initial.records[0],
      id: "other-grade",
      title: "Other course observation",
      rawJson: { moodle_course_id: "43", moodle_item_id: "102" },
    });
    data.initialFeed.events.push({
      ...data.initialFeed.events[0],
      id: "other-event",
      courseId: data.initial.courses[1].id,
      itemTitle: "Other course correction",
    });
    vi.stubGlobal("window", {
      location: { search: `?studyTab=grades&courseId=${first.id}` },
    });
    const html = renderToStaticMarkup(
      createElement(GradeTargetWorkspace, data),
    );
    expect(html).toContain("10 / 30 → 15 / 30");
    expect(html).toContain("Synthetic grade");
    expect(html).not.toContain("Other course observation");
    expect(html).not.toContain("Other course correction");
    expect(html).not.toContain('aria-label="План до цели: Other owned course"');
  });
  it.each(["grades", "calculator"])(
    "shows an unavailable prompt for a foreign course in %s, without another course's facts",
    (tab) => {
      const html = renderToStaticMarkup(
        createElement(GradeTargetWorkspace, {
          ...fixture(),
          initialCourseId: "foreign",
          initialTab: tab as "grades" | "calculator",
        }),
      );
      expect(html).toContain("Запрошенный курс недоступен");
      expect(html).not.toContain("Synthetic grade");
      expect(html).not.toContain("10 / 30 → 15 / 30");
      expect(html).not.toContain('aria-label="План до цели:');
    },
  );
  it("shows observations separately from saved hypothetical 100s without network or AI calls", () => {
    const html = renderToStaticMarkup(
      createElement(GradeTargetWorkspace, fixture()),
    );
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Учтено по наблюдениям 15 / 100");
    expect(text).toContain("Среднее по оценённому 50");
    expect(text).toContain("Условный план");
    expect(send).not.toHaveBeenCalled();
  });
  it("honors the course simulator deep link and renders corrections plus actual restore", () => {
    vi.stubGlobal("window", {
      location: {
        search:
          "?studyTab=calculator&courseId=11111111-1111-4111-8111-111111111111",
      },
    });
    const html = renderToStaticMarkup(
      createElement(GradeTargetWorkspace, fixture()),
    );
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Вернуть фактические наблюдения в сценарий");
    expect(text).toContain("Твой сценарий");
    expect(text).toContain("Учтено по наблюдениям 15 / 100");
    expect(text).toContain("10 / 30 → 15 / 30");
    expect(text).toContain("Применить выбранную формулу");
    expect(send).not.toHaveBeenCalled();
  });
});
