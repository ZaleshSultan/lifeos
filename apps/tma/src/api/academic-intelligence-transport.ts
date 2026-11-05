import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import type { AcademicIntelligencePreferencesInput as AcademicPreferenceDraft } from "../../../../packages/core/src/academic-intelligence.js";

export interface GradePolicyReviewInput {
  courseId: string;
  expectedRevision: number;
  definitionKey: string;
  bindingsKey: string;
  contextKey: string;
  sourceRef: string;
}
export function academicIntelligenceTransport(
  send: <T>(resource: string, options?: RequestInit) => Promise<T>,
) {
  return {
    feed: (signal?: AbortSignal) =>
      send<GradeEventFeed>("study/grade-events", { signal }),
    preferences: (
      preferences: AcademicPreferenceDraft,
      expected: { expectedRevision: number; expectedAcademicRevision: number },
    ) =>
      send<GradeEventFeed>("study/academic-preferences", {
        method: "PUT",
        body: JSON.stringify({ ...expected, confirmed: true, preferences }),
      }),
    review: ({ courseId, ...review }: GradePolicyReviewInput) =>
      send<GradeEventFeed>(
        `study/grade-policy/${encodeURIComponent(courseId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...review,
            currentEnrollmentConfirmed: true,
            supportedRulesConfirmed: true,
            confirmed: true,
          }),
        },
      ),
  };
}
