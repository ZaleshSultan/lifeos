import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import { calculateCourseGradeTarget } from "../../../../packages/core/src/grade-target.js";
import type { AcademicCourseRisk } from "../../../../packages/core/src/academic-home.js";
import type { StudyWorkspace } from "../api/study-types";

export function academicHomeRisks(
  study: StudyWorkspace | undefined | null,
  feed: GradeEventFeed | undefined | null,
  now: string,
): AcademicCourseRisk[] {
  if (!study || !feed) return [];
  return study.courses.flatMap((course) => {
    const result = calculateCourseGradeTarget({
      courseId: course.id,
      externalCourseKey: course.externalCourseKey,
      courseStartsOn: course.startsOn,
      courseEndsOn: course.endsOn,
      calculator: course.calculator,
      records: study.records,
      bindings: course.scholarship?.bindings ?? {},
      review: feed.preferences.courseReviews[course.id],
      lms: feed.lms,
      now,
    });
    return result.plan
      ? [
          {
            courseId: course.id,
            title: course.title,
            target: course.calculator?.target ?? 70,
            maximumFinal: result.plan.maximumFinal,
            requiredRemainingAverage: result.plan.requiredAverage,
            confirmed: result.status === "confirmed",
          },
        ]
      : [];
  });
}
