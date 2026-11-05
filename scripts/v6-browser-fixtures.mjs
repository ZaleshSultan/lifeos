// Wholly invented, owner-isolated browser fixtures. No credentials, provider, DB or delivery.
import { parseAcademicIntelligencePreferences } from "../packages/core/src/academic-intelligence.ts";
import {
  gradeTargetBindingsKey,
  gradeTargetContextKey,
  gradeTargetDefinitionKey,
} from "../packages/core/src/grade-target.ts";
import { defaultScholarshipConfig } from "../packages/core/src/scholarship.ts";

import { v6Today } from "./v6-today-fixture.ts";
export { v6Today };

export const V6_VIEWPORTS = [320, 360, 390, 430, 768, 1440];
export const V6_FOREIGN_COURSE_ID = "99999999-9999-4999-8999-999999999999";
export const V6_SELECTED_DAY = "2031-04-07";
export const V6_SCENARIO_COUNT = V6_VIEWPORTS.length * 2 + 4;
const clone = (value) => structuredClone(value);
const result = (data, status = 200) => ({
  status,
  body: status === 200 ? { data: clone(data) } : { error: data },
});
const dayAt = (instant, delta = 0) =>
  new Date(Date.parse(instant) + delta * 86400000).toISOString().slice(0, 10);
const uuid = (owner, category, n) =>
  `${owner === "A" ? "11111111" : "22222222"}-${category}-4000-8000-${String(n).padStart(12, "0")}`;

export function v6BrowserFixture(
  owner = "A",
  { now = new Date().toISOString() } = {},
) {
  const userId = uuid(owner, "0000", 1);
  const courses = ["Alpha", "Beta"].map((name, index) => {
    const definition = {
      version: 1,
      sourceName: `Invented ${name} syllabus, current fixture edition p2`,
      attestationThreshold: 25,
      fields: [
        {
          id: "att1",
          label: "Synthetic ATT1 total",
          period: "att1",
          weightPercent: 100,
        },
        {
          id: "att2",
          label: "Synthetic ATT2 total",
          period: "att2",
          weightPercent: 100,
        },
        {
          id: "exam",
          label: "Synthetic final total",
          period: "exam",
          weightPercent: 100,
        },
      ],
    };
    const scholarship = defaultScholarshipConfig(70);
    scholarship.bindings = {
      att1: {
        mode: "aggregate",
        ruleConfirmed: true,
        entries: [{ recordId: uuid(owner, "2000", index + 1), weight: 100 }],
      },
    };
    return {
      id: uuid(owner, "1000", index + 1),
      code: `SYN-${name.toUpperCase()}`,
      title: `Synthetic ${name} Systems ${owner}`,
      startsOn: dayAt(now, -30),
      endsOn: dayAt(now, 90),
      externalCourseKey: `moodle:${owner === "A" ? 810001 + index : 820001 + index}`,
      schedules: [],
      calculator: {
        definition,
        values: { att1: 100, att2: 100, exam: 100 },
        target: 70,
      },
      scholarship,
    };
  });
  const records = courses.map((course, index) => ({
    id: uuid(owner, "2000", index + 1),
    userId,
    sourceEventId: null,
    courseTitle: index
      ? course.title
      : `Synthetic renamed Alpha transcript ${owner}`,
    title: `Synthetic ${index ? "Beta" : "Alpha"} checkpoint`,
    recordType: "grade",
    valueText: null,
    score: index ? 24 : 15,
    maxScore: 30,
    percentage: index ? 80 : 50,
    occursAt: null,
    dueAt: null,
    rawJson: {
      moodle_course_id: Number(course.externalCourseKey.slice(7)),
      moodle_item_id: String(910001 + index),
      itemtype: "mod",
    },
    createdAt: now,
    updatedAt: now,
  }));
  const workspace = { timezone: "Asia/Almaty", courses, records };
  const reviewFor = (course) => ({
    version: 1,
    externalCourseKey: course.externalCourseKey,
    contextKey: gradeTargetContextKey(course),
    definitionKey: gradeTargetDefinitionKey(course.calculator.definition),
    bindingsKey: gradeTargetBindingsKey(course.scholarship.bindings),
    reviewedAt: now,
    sourceRef: course.calculator.definition.sourceName,
    supportedPolicy: "linear-30-30-40",
  });
  const feed = {
    events: courses.map((course, index) => ({
      id: uuid(owner, "3000", index + 1),
      courseId: course.id,
      courseTitle: course.title,
      itemTitle: `Synthetic ${index ? "Beta" : "Alpha"} checkpoint`,
      kind: index ? "corrected" : "posted",
      observedAt: new Date(Date.parse(now) - (index + 1) * 60000).toISOString(),
      oldScore: index ? 18 : null,
      oldMaxScore: index ? 30 : null,
      newScore: records[index].score,
      newMaxScore: 30,
      moodleCourseId: course.externalCourseKey.slice(7),
      moodleItemId: String(910001 + index),
      sourceUrl: `https://lms.astanait.edu.kz/course/view.php?id=${course.externalCourseKey.slice(7)}`,
    })),
    eligibleDeadlines: [
      {
        key: `synthetic-assignment-${owner}`,
        courseId: courses[1].id,
        courseTitle: courses[1].title,
        title: "Synthetic Beta unfinished assignment",
        kind: "assignment",
        dueAt: new Date(Date.parse(now) + 3 * 86400000).toISOString(),
        sourceUrl: "https://lms.astanait.edu.kz/mod/assign/view.php?id=930001",
        lastSuccessfulSyncAt: now,
      },
    ],
    preferences: {
      revision: 0,
      academicRevision: 0,
      gradeAlertsEnabled: false,
      assignmentAlertsEnabled: false,
      quizAlertsEnabled: false,
      assignmentOffsetsMinutes: [4320, 1440],
      quizOffsetsMinutes: [4320, 1440],
      quietStart: "23:00",
      quietEnd: "08:00",
      courseReviews: { [courses[1].id]: reviewFor(courses[1]) },
    },
    lms: {
      configured: true,
      stale: false,
      lastSuccessfulSyncAt: now,
      state: "connected",
    },
    deliveryEnabled: false,
    truncated: false,
  };
  const requests = [];
  const state = {
    owner,
    userId,
    now,
    workspace,
    feed,
    requests,
    writes: { preferences: 0, policy: 0, calculator: 0, scholarship: 0 },
    providerCalls: 0,
    telegramSends: 0,
    deliveryJobs: 0,
    reviewFor,
    setStale(stale = true) {
      feed.lms.stale = stale;
    },
    remotePreferenceChange() {
      feed.preferences.revision++;
      feed.preferences.quietEnd = "07:30";
    },
    response(
      resource,
      method = "GET",
      body = {},
      query = new URLSearchParams(),
    ) {
      const parsed = new URL(resource, "https://fixture.invalid/");
      const path = parsed.pathname.replace(/^\//, "");
      const params = parsed.search ? parsed.searchParams : query;
      if (
        ![
          "study",
          "study/grade-events",
          "study/academic-preferences",
          "today",
          "lms/work",
          "lms/connection",
        ].includes(path) &&
        !path.startsWith("study/grade-policy/") &&
        !/^study\/courses\/[^/]+\/(calculator|scholarship)$/.test(path)
      )
        return null;
      requests.push({
        path,
        method,
        ...(path === "today" ? { date: params.get("date") } : {}),
        ...(method !== "GET" ? { body: clone(body) } : {}),
      });
      if (method === "GET" && path === "lms/connection")
        return result({
          configured: true,
          state: "connected",
          lastSyncSuccessAt: now,
          lastSyncAttemptAt: now,
          lastErrorCategory: null,
          sessionExpiresAt: null,
          syncRequestedAt: null,
          unsupportedFeatures: [],
        });
      if (method === "GET" && path === "lms/work")
        return result({
          timezone: "Asia/Almaty",
          lastSyncSuccessAt: now,
          lastSyncAttemptAt: now,
          stale: feed.lms.stale,
          truncated: false,
          warnings: [],
          unsupportedFeatures: [],
          items: [
            {
              category: "upcoming",
              title: "Synthetic Beta unfinished assignment",
              courseTitle: courses[1].title,
              kind: "assignment",
              submissionStatus: "not_submitted",
              dueAt: feed.eligibleDeadlines[0].dueAt,
              startsAt: null,
              endsAt: null,
              score: null,
              maxScore: null,
              percentage: null,
              source: "moodle",
            },
          ],
        });
      if (method === "GET" && path === "study") return result(workspace);
      if (method === "GET" && path === "study/grade-events")
        return result(feed);
      if (method === "GET" && path === "today")
        return result(v6Today(params.get("date") || dayAt(now)));
      if (path === "study/academic-preferences" && method === "PUT") {
        if (body.confirmed !== true)
          return result("academic_intelligence_invalid_input", 400);
        if (
          body.expectedRevision !== feed.preferences.revision ||
          body.expectedAcademicRevision !== feed.preferences.academicRevision
        )
          return result("academic_preferences_conflict", 409);
        try {
          Object.assign(
            feed.preferences,
            parseAcademicIntelligencePreferences(body.preferences),
          );
          feed.preferences.revision++;
          feed.preferences.academicRevision++;
          state.writes.preferences++;
          return result(feed);
        } catch {
          return result("academic_intelligence_invalid_input", 400);
        }
      }
      if (path.startsWith("study/grade-policy/") && method === "PUT") {
        const course = courses.find((row) => row.id === path.split("/").at(-1));
        if (!course) return result("course_not_found", 404);
        if (body.expectedRevision !== feed.preferences.revision)
          return result("academic_preferences_conflict", 409);
        const review = reviewFor(course);
        if (
          body.confirmed !== true ||
          body.currentEnrollmentConfirmed !== true ||
          body.supportedRulesConfirmed !== true ||
          !body.sourceRef?.trim() ||
          body.definitionKey !== review.definitionKey ||
          body.bindingsKey !== review.bindingsKey ||
          body.contextKey !== review.contextKey
        )
          return result("academic_intelligence_invalid_input", 400);
        feed.preferences.courseReviews[course.id] = {
          ...review,
          sourceRef: body.sourceRef.trim(),
          reviewedAt: now,
        };
        feed.preferences.revision++;
        state.writes.policy++;
        return result(feed);
      }
      const courseMatch =
        /^study\/courses\/([^/]+)\/(calculator|scholarship)$/.exec(path);
      if (courseMatch && method === "PUT") {
        const course = courses.find((row) => row.id === courseMatch[1]);
        if (!course) return result("course_not_found", 404);
        if (courseMatch[2] === "calculator") {
          course.calculator.values = clone(body.values);
          course.calculator.target = body.target;
          state.writes.calculator++;
          return result(course.calculator);
        }
        if (
          JSON.stringify(body.expectedConfig ?? null) !==
          JSON.stringify(course.scholarship ?? null)
        )
          return result("study_conflict", 409);
        course.scholarship = clone(body.config);
        delete feed.preferences.courseReviews[course.id];
        state.writes.scholarship++;
        return result(course.scholarship);
      }
      return result("method_not_allowed", 405);
    },
  };
  return state;
}
