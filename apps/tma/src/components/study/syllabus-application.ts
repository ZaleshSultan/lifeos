import {
  resolveStudyCalculator,
  studySyllabusAutoApplication,
} from "../../../../../packages/core/src/study-syllabi.js";
import type {
  ConfigureStudyCalculatorInput,
  StudyWorkspaceCourse,
} from "../../api/study";

/** Build upgrades for every eligible course, independently of the selected tab. */
export function studySyllabusApplications(
  courses: StudyWorkspaceCourse[],
): ConfigureStudyCalculatorInput[] {
  return courses.flatMap((course) => {
    const application = studySyllabusAutoApplication(course);
    if (!application) return [];
    return [
      {
        courseId: course.id,
        ...application,
        values: resolveStudyCalculator(course)!.values,
        expectedState: course.calculator,
      },
    ];
  });
}

/** A failed course must not prevent the other matched courses from upgrading. */
export async function applyStudySyllabusProfiles(
  applications: ConfigureStudyCalculatorInput[],
  configure: (application: ConfigureStudyCalculatorInput) => Promise<unknown>,
): Promise<Array<{ courseId: string; error: unknown }>> {
  const results = await Promise.allSettled(
    applications.map(async (application) => configure(application)),
  );
  return results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ courseId: applications[index].courseId, error: result.reason }]
      : [],
  );
}
