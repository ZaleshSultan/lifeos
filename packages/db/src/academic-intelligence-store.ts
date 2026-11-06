import type { SupabaseClient } from "@supabase/supabase-js";
import {
  academicIntelligenceRevision,
  parseAcademicIntelligencePreferences,
  safeAcademicMoodleUrl,
  gradeTargetDefinitionKey,
  gradeTargetBindingsKey,
  gradeTargetContextKey,
  gradeTargetEnrollmentCurrent,
  validateStudyCalculatorDefinition,
  validateStudyCalculatorValues,
  validateScholarshipConfig,
  type AcademicIntelligencePreferencesInput,
  type AcademicGradePolicyReview,
  type GradeEventFeed,
} from "@lifeos/core";

export class AcademicIntelligenceStoreError extends Error {
  constructor(
    readonly code:
      | "academic_intelligence_invalid_input"
      | "academic_intelligence_conflict"
      | "academic_intelligence_not_found"
      | "academic_intelligence_unavailable",
  ) {
    super(code);
  }
}
type Client = Pick<SupabaseClient, "rpc" | "from">;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, limit = 500): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > limit ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new Error();
  return value;
};
const numeric = (value: unknown): number | null =>
  value === null
    ? null
    : typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : (() => {
          throw new Error();
        })();
const date = (value: unknown): string => {
  const result = text(value, 50);
  if (!Number.isFinite(Date.parse(result))) throw new Error();
  return result;
};

export function parseGradeEventFeed(value: unknown): GradeEventFeed {
  try {
    const v = object(value),
      p = object(v.preferences),
      lms = object(v.lms);
    if (
      !Array.isArray(v.events) ||
      v.events.length > 100 ||
      !Array.isArray(v.eligibleDeadlines) ||
      v.eligibleDeadlines.length > 100 ||
      typeof v.truncated !== "boolean" ||
      typeof lms.configured !== "boolean" ||
      typeof lms.stale !== "boolean"
    )
      throw new Error();
    const reviews: Record<string, AcademicGradePolicyReview> = {};
    if (Object.keys(object(p.courseReviews)).length > 100) throw new Error();
    for (const [id, raw] of Object.entries(object(p.courseReviews))) {
      const r = object(raw);
      if (
        !uuid(id) ||
        r.version !== 1 ||
        r.supportedPolicy !== "linear-30-30-40"
      )
        throw new Error();
      reviews[id] = {
        version: 1,
        externalCourseKey: text(r.externalCourseKey),
        definitionKey: text(r.definitionKey, 65536),
        bindingsKey: text(r.bindingsKey, 65536),
        contextKey: text(r.contextKey, 2000),
        reviewedAt: date(r.reviewedAt),
        sourceRef: text(r.sourceRef, 500),
        supportedPolicy: "linear-30-30-40",
      };
    }
    const url = (raw: unknown) => {
      if (raw === null) return null;
      const result = safeAcademicMoodleUrl(raw);
      if (!result) throw new Error();
      return result;
    };
    const courseId = (raw: unknown) => {
      if (raw === null) return null;
      if (!uuid(raw)) throw new Error();
      return raw;
    };
    return {
      events: v.events.map((raw) => {
        const e = object(raw);
        if (
          !uuid(e.id) ||
          !["posted", "corrected"].includes(String(e.kind)) ||
          numeric(e.newScore) === null
        )
          throw new Error();
        return {
          id: e.id,
          courseId: courseId(e.courseId),
          courseTitle: text(e.courseTitle),
          itemTitle: text(e.itemTitle),
          kind: e.kind as "posted" | "corrected",
          observedAt: date(e.observedAt),
          oldScore: numeric(e.oldScore),
          oldMaxScore: numeric(e.oldMaxScore),
          newScore: e.newScore as number,
          newMaxScore: numeric(e.newMaxScore),
          moodleCourseId: text(e.moodleCourseId, 30),
          moodleItemId: text(e.moodleItemId, 100),
          sourceUrl: url(e.sourceUrl),
        };
      }),
      eligibleDeadlines: v.eligibleDeadlines.map((raw) => {
        const d = object(raw);
        if (!["assignment", "quiz"].includes(String(d.kind))) throw new Error();
        return {
          key: text(d.key, 200),
          courseId: courseId(d.courseId),
          courseTitle: d.courseTitle === null ? null : text(d.courseTitle),
          title: text(d.title),
          kind: d.kind as "assignment" | "quiz",
          dueAt: date(d.dueAt),
          sourceUrl: url(d.sourceUrl),
          lastSuccessfulSyncAt: date(d.lastSuccessfulSyncAt),
        };
      }),
      preferences: {
        ...parseAcademicIntelligencePreferences({
          gradeAlertsEnabled: p.gradeAlertsEnabled,
          assignmentAlertsEnabled: p.assignmentAlertsEnabled,
          quizAlertsEnabled: p.quizAlertsEnabled,
          assignmentOffsetsMinutes: p.assignmentOffsetsMinutes,
          quizOffsetsMinutes: p.quizOffsetsMinutes,
          quietStart: p.quietStart,
          quietEnd: p.quietEnd,
        }),
        revision: academicIntelligenceRevision(p.revision),
        academicRevision: academicIntelligenceRevision(p.academicRevision),
        courseReviews: reviews,
      },
      lms: {
        configured: lms.configured,
        stale: lms.stale,
        lastSuccessfulSyncAt:
          lms.lastSuccessfulSyncAt === null
            ? null
            : date(lms.lastSuccessfulSyncAt),
        state: text(lms.state, 100),
      },
      truncated: v.truncated,
      historyPending: v.historyPending === true,
    };
  } catch {
    throw new AcademicIntelligenceStoreError(
      "academic_intelligence_unavailable",
    );
  }
}

export interface AcademicIntelligenceStore {
  feed(userId: string): Promise<GradeEventFeed>;
  preferences(
    userId: string,
    input: {
      expectedRevision: number;
      expectedAcademicRevision: number;
      preferences: AcademicIntelligencePreferencesInput;
    },
  ): Promise<GradeEventFeed>;
  reviewPolicy(
    userId: string,
    courseId: string,
    input: {
      expectedRevision: number;
      definitionKey: string;
      bindingsKey: string;
      contextKey: string;
      sourceRef: string;
    },
  ): Promise<GradeEventFeed>;
}

export function createAcademicIntelligenceStore(
  client: Client,
): AcademicIntelligenceStore {
  async function service(
    userId: string,
    operation: string,
    args: Record<string, unknown>,
  ): Promise<GradeEventFeed> {
    if (!uuid(userId))
      throw new AcademicIntelligenceStoreError(
        "academic_intelligence_invalid_input",
      );
    const { data, error } = await client.rpc("academic_intelligence_service", {
      p_user_id: userId,
      p_operation: operation,
      p_args: args,
    });
    if (error) {
      if (error.code === "40001")
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_conflict",
        );
      if (error.code === "P0002")
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_not_found",
        );
      if (["22023", "22P02"].includes(error.code))
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_invalid_input",
        );
      throw new AcademicIntelligenceStoreError(
        "academic_intelligence_unavailable",
      );
    }
    if (data === null)
      throw new AcademicIntelligenceStoreError(
        "academic_intelligence_not_found",
      );
    return parseGradeEventFeed(data);
  }
  return {
    feed: (userId) => service(userId, "feed", {}),
    preferences: (userId, input) => service(userId, "preferences", input),
    async reviewPolicy(userId, courseId, input) {
      if (!uuid(userId) || !uuid(courseId))
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_invalid_input",
        );
      const { data: course, error } = await client
        .from("study_courses")
        .select("id,external_course_key,metadata,updated_at,starts_on,ends_on")
        .eq("user_id", userId)
        .eq("id", courseId)
        .eq("status", "active")
        .maybeSingle();
      if (error)
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_unavailable",
        );
      if (!course)
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_not_found",
        );
      const metadata = object(course.metadata),
        calculator = object(metadata.study_calculator_v1),
        scholarship = metadata.scholarship_planner_v1;
      if (
        typeof course.external_course_key !== "string" ||
        !/^moodle:[1-9]\d{0,15}$/.test(course.external_course_key) ||
        !validateStudyCalculatorDefinition(calculator.definition) ||
        !validateStudyCalculatorValues(
          calculator.values,
          calculator.definition,
        ) ||
        !validateScholarshipConfig(scholarship) ||
        !gradeTargetEnrollmentCurrent(
          { startsOn: course.starts_on, endsOn: course.ends_on },
          new Date().toISOString(),
        )
      )
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_invalid_input",
        );
      const definitionKey = gradeTargetDefinitionKey(calculator.definition),
        bindingsKey = gradeTargetBindingsKey(scholarship.bindings);
      const contextKey = gradeTargetContextKey({
        externalCourseKey: course.external_course_key,
        startsOn: course.starts_on,
        endsOn: course.ends_on,
      });
      if (
        input.definitionKey !== definitionKey ||
        input.bindingsKey !== bindingsKey ||
        input.contextKey !== contextKey
      )
        throw new AcademicIntelligenceStoreError(
          "academic_intelligence_conflict",
        );
      return service(userId, "review_policy", {
        expectedRevision: input.expectedRevision,
        courseId,
        courseUpdatedAt: course.updated_at,
        review: {
          version: 1,
          externalCourseKey: course.external_course_key,
          definitionKey,
          bindingsKey,
          contextKey,
          sourceRef: input.sourceRef,
          supportedPolicy: "linear-30-30-40",
        },
      });
    },
  };
}
