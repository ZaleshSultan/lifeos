export interface GradeAssessmentInput {
  weightPercent: number; // 0-100. An assessment with an unknown weight
  // should not be passed to this function at all
  // (filtering that out is the caller's job, not
  // this engine's).
  maxScore: number | null; // null means "actualScore, if present, is
  // already a 0-100 percentage, not a raw score
  // out of some other max"
  actualScore: number | null; // null means not yet scored
  status: "pending" | "submitted" | "graded" | "missed";
}

export interface GradeCalculationResult {
  totalWeightPercent: number; // sum of all input weightPercent values,
  // whether or not they sum to 100 -
  // callers can compare this to 100 to
  // detect a syllabus that doesn't add up
  completedWeightPercent: number; // sum of weightPercent for items with
  // status === "graded" (or "missed")
  remainingWeightPercent: number; // totalWeightPercent - completedWeightPercent
  earnedWeightedPercent: number; // sum over graded items of
  // weightPercent * (percentScore / 100),
  // where percentScore = maxScore === null
  // ? actualScore : (actualScore / maxScore) * 100
  currentGrade: number | null; // earnedWeightedPercent / completedWeightPercent * 100,
  // i.e. "how am I doing on what's graded
  // so far" - null if completedWeightPercent === 0
  // (nothing graded yet, not even one item)
  projectedFinalGrade: number | null; // assumes the student continues
  // performing at their current average
  // rate on the remaining weight:
  // earnedWeightedPercent + remainingWeightPercent
  // * (currentGrade / 100). Equal to
  // currentGrade when totalWeightPercent
  // is fully accounted for (this is
  // expected, not a bug - projecting the
  // same average forward reproduces that
  // average). null under the same
  // condition currentGrade is null.
  requiredAverageOnRemaining: number | null; // null if no target was given or
  // remainingWeightPercent === 0
  targetAchieved: boolean;
  targetImpossible: boolean;
}

export function calculateGrade(
  assessments: GradeAssessmentInput[],
  targetGrade?: number,
): GradeCalculationResult {
  let totalWeightPercent = 0;
  let completedWeightPercent = 0;
  let earnedWeightedPercent = 0;

  for (const assessment of assessments) {
    totalWeightPercent += assessment.weightPercent;

    if (assessment.status === "graded") {
      completedWeightPercent += assessment.weightPercent;

      const score = assessment.actualScore ?? 0;
      let percentScore = 0;
      if (assessment.maxScore === null) {
        percentScore = score;
      } else if (assessment.maxScore > 0) {
        percentScore = (score / assessment.maxScore) * 100;
      }

      earnedWeightedPercent += assessment.weightPercent * (percentScore / 100);
    } else if (assessment.status === "missed") {
      // A missed assessment counts as graded with a score of 0
      completedWeightPercent += assessment.weightPercent;
      // Score contribution is zero, so earnedWeightedPercent does not increase
    }
  }

  const rawRemaining = totalWeightPercent - completedWeightPercent;
  // Normalize negative zero or tiny precision artifacts to 0
  const remainingWeightPercent = rawRemaining === 0 ? 0 : rawRemaining;

  const currentGrade =
    completedWeightPercent === 0
      ? null
      : (earnedWeightedPercent / completedWeightPercent) * 100;

  const projectedFinalGrade =
    currentGrade === null
      ? null
      : earnedWeightedPercent + remainingWeightPercent * (currentGrade / 100);

  let requiredAverageOnRemaining: number | null = null;
  let targetAchieved = false;
  let targetImpossible = false;

  if (targetGrade !== undefined) {
    if (remainingWeightPercent === 0) {
      targetAchieved = currentGrade !== null && currentGrade >= targetGrade;
      targetImpossible = !targetAchieved;
      requiredAverageOnRemaining = null;
    } else {
      const requiredPoints = targetGrade - earnedWeightedPercent;
      const requiredAverage = (requiredPoints / remainingWeightPercent) * 100;
      requiredAverageOnRemaining = requiredAverage;
      targetAchieved = requiredAverage <= 0;
      targetImpossible = requiredAverage > 100;
    }
  }

  return {
    totalWeightPercent,
    completedWeightPercent,
    remainingWeightPercent,
    earnedWeightedPercent,
    currentGrade,
    projectedFinalGrade,
    requiredAverageOnRemaining,
    targetAchieved,
    targetImpossible,
  };
}
