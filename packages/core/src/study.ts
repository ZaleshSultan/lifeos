export type StudyPeriod = "att1" | "att2" | "exam";
export type StudyVerification = "verified" | "needs_review";

export interface StudyCalculatorField {
  id: string;
  label: string;
  period: StudyPeriod;
  /** Percentage within this period, not within the final course grade. */
  weightPercent: number;
  /** Raw assessment denominator, independent of its category weight. */
  maxScore?: number;
  pointStep?: number;
  type?: string;
  sourcePage?: number;
  sourceDocument?: string;
  maxScoreSourcePage?: number;
  verification?: StudyVerification;
}

export interface StudyRequirement {
  id: string;
  label: string;
  kind: "period_minimum" | "component_minimum" | "attendance_minimum";
  period?: StudyPeriod;
  fieldId?: string;
  minimumPercent: number;
  verification: StudyVerification;
  sourcePage?: number;
}

export interface StudyCalculatorDefinition {
  /** Kept at 1 so saved percentage-only calculators remain readable. */
  version: 1;
  sourceName: string;
  /** Legacy advisory threshold; only explicit verified requirements block feasibility. */
  attestationThreshold: number;
  topLevelWeights?: Record<StudyPeriod, number>;
  requirements?: StudyRequirement[];
  verification?: StudyVerification;
  fields: StudyCalculatorField[];
}

export interface StudyScore {
  earned: number;
  max: number;
  kind?: "actual" | "assumed";
  source?: string;
}

/** Old numeric values are percentages and remain manual what-if assumptions. */
export type StudyCalculatorValue = number | StudyScore | null;
export interface StudyCalculatorState {
  definition: StudyCalculatorDefinition;
  values: Record<string, StudyCalculatorValue>;
  target: number;
  attendancePercent?: number | null;
  /** Per-scenario raw maxima, including assessments whose earned score is still unknown. */
  maxima?: Record<string, number>;
}

export interface StudyPeriodResult {
  score: number | null;
  earned: number;
  complete: boolean;
}

export interface StudyFieldContribution {
  id: string;
  normalizedPercent: number | null;
  kind: "actual" | "assumed" | "unknown";
  maxScore: number;
  periodContribution: number;
  finalContribution: number;
  finalWeightPercent: number;
}

export interface StudyRequiredComponent {
  fieldId: string;
  requiredPercent: number;
  /** Rounded UP to a attainable raw score, using pointStep (default 1). */
  requiredPoints: number;
  maxScore: number;
  possible: boolean;
}

export interface StudyScenarioOptions {
  selectedFieldId?: string;
  unknownFieldIds?: string[];
  ranges?: Record<string, { minPercent: number; maxPercent: number }>;
}

export interface StudyScenarioResult {
  att1: StudyPeriodResult;
  att2: StudyPeriodResult;
  examScore: number | null;
  finalScore: number | null;
  /** Known actual and assumed contributions; unspecified assessments contribute 0 only to this lower bound. */
  minimumFinal: number;
  maximumFinal: number;
  guaranteedFinal: number;
  /** Sum of known/assumed contributions; null when no score is known. See unknownFieldIds. */
  projection: number | null;
  requiredExamScore: number | null;
  belowThreshold: boolean | null;
  targetStatus: "achieved" | "possible" | "impossible";
  numericTargetStatus: "achieved" | "possible" | "impossible";
  eligibilityStatus: "satisfied" | "pending" | "blocked";
  fieldContributions: StudyFieldContribution[];
  unknownFieldIds: string[];
  requiredComponents: StudyRequiredComponent[];
  requirementResults: {
    id: string;
    label: string;
    status: "passed" | "failed" | "pending" | "needs_review";
  }[];
  warnings: string[];
  scenarioRange: {
    minimumFinal: number;
    maximumFinal: number;
    requiredCommonPercent: number | null;
    feasible: boolean;
    components: StudyRequiredComponent[];
  } | null;
}

const DEFAULT_WEIGHTS: Record<StudyPeriod, number> = {
  att1: 30,
  att2: 30,
  exam: 40,
};
const PERIODS: StudyPeriod[] = ["att1", "att2", "exam"];
const stable = (value: number): number =>
  Math.abs(value) > 1e12 ? value : Math.round(value * 1e10) / 1e10;
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}
function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function isVerification(value: unknown): value is StudyVerification {
  return value === "verified" || value === "needs_review";
}
function isPage(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function validateStudyCalculatorDefinition(
  value: unknown,
): value is StudyCalculatorDefinition {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.sourceName !== "string" ||
    !value.sourceName.trim() ||
    value.sourceName.length > 200 ||
    !isPercent(value.attestationThreshold) ||
    !Array.isArray(value.fields) ||
    value.fields.length < 3 ||
    value.fields.length > 100 ||
    (value.verification !== undefined && !isVerification(value.verification))
  )
    return false;
  if (
    value.topLevelWeights !== undefined &&
    (!isObject(value.topLevelWeights) ||
      Object.keys(value.topLevelWeights).length !== 3 ||
      !PERIODS.every((period) =>
        isPercent((value.topLevelWeights as Record<string, unknown>)[period]),
      ) ||
      Math.abs(
        Object.values(value.topLevelWeights).reduce<number>(
          (sum, weight) => sum + (weight as number),
          0,
        ) - 100,
      ) > 1e-7)
  )
    return false;
  const ids = new Set<string>();
  const weights = { att1: 0, att2: 0, exam: 0 };
  for (const field of value.fields) {
    if (
      !isObject(field) ||
      typeof field.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(field.id) ||
      ["constructor", "prototype"].includes(field.id) ||
      ids.has(field.id) ||
      typeof field.label !== "string" ||
      !field.label.trim() ||
      field.label.length > 300 ||
      !PERIODS.includes(field.period as StudyPeriod) ||
      !isPercent(field.weightPercent) ||
      field.weightPercent === 0 ||
      (field.maxScore !== undefined && !isPositive(field.maxScore)) ||
      (field.pointStep !== undefined &&
        (!isPositive(field.pointStep) ||
          field.pointStep > ((field.maxScore as number) ?? 100))) ||
      (field.sourcePage !== undefined && !isPage(field.sourcePage)) ||
      (field.maxScoreSourcePage !== undefined &&
        !isPage(field.maxScoreSourcePage)) ||
      (field.sourceDocument !== undefined &&
        (typeof field.sourceDocument !== "string" ||
          field.sourceDocument.length > 300)) ||
      (field.type !== undefined &&
        (typeof field.type !== "string" || field.type.length > 80)) ||
      (field.verification !== undefined && !isVerification(field.verification))
    )
      return false;
    ids.add(field.id);
    weights[field.period as StudyPeriod] += field.weightPercent;
  }
  if (!Object.values(weights).every((weight) => Math.abs(weight - 100) < 1e-7))
    return false;
  if (value.requirements !== undefined) {
    if (!Array.isArray(value.requirements) || value.requirements.length > 100)
      return false;
    const requirementIds = new Set<string>();
    for (const requirement of value.requirements) {
      if (
        !isObject(requirement) ||
        typeof requirement.id !== "string" ||
        !requirement.id.trim() ||
        requirement.id.length > 80 ||
        requirementIds.has(requirement.id) ||
        typeof requirement.label !== "string" ||
        !requirement.label.trim() ||
        requirement.label.length > 500 ||
        !isPercent(requirement.minimumPercent) ||
        !isVerification(requirement.verification) ||
        (requirement.sourcePage !== undefined &&
          !isPage(requirement.sourcePage))
      )
        return false;
      if (requirement.kind === "period_minimum") {
        if (!PERIODS.includes(requirement.period as StudyPeriod)) return false;
      } else if (requirement.kind === "component_minimum") {
        if (
          typeof requirement.fieldId !== "string" ||
          !ids.has(requirement.fieldId)
        )
          return false;
      } else if (requirement.kind !== "attendance_minimum") return false;
      requirementIds.add(requirement.id);
    }
  }
  return true;
}

export function validateStudyCalculatorValues(
  value: unknown,
  definition: StudyCalculatorDefinition,
): value is Record<string, StudyCalculatorValue> {
  if (!isObject(value) || !validateStudyCalculatorDefinition(definition))
    return false;
  const ids = new Set(definition.fields.map((field) => field.id));
  return Object.entries(value).every(
    ([id, score]) =>
      ids.has(id) &&
      (score === null ||
        isPercent(score) ||
        (isObject(score) &&
          isPositive(score.max) &&
          typeof score.earned === "number" &&
          Number.isFinite(score.earned) &&
          score.earned >= 0 &&
          score.earned <= score.max &&
          (score.kind === undefined ||
            score.kind === "actual" ||
            score.kind === "assumed") &&
          (score.source === undefined ||
            (typeof score.source === "string" && score.source.length <= 500)))),
  );
}

export function validateStudyCalculatorMaxima(
  value: unknown,
  definition: StudyCalculatorDefinition,
): value is Record<string, number> {
  if (!isObject(value) || !validateStudyCalculatorDefinition(definition))
    return false;
  const ids = new Set(definition.fields.map((field) => field.id));
  return Object.entries(value).every(
    ([id, maximum]) => ids.has(id) && isPositive(maximum),
  );
}

/** This is a scenario, not an LMS grade. No missing score is persisted or presented as zero. */
export function calculateStudyScenario(
  state: StudyCalculatorState,
  options: StudyScenarioOptions = {},
): StudyScenarioResult {
  if (
    !state ||
    !validateStudyCalculatorDefinition(state.definition) ||
    !validateStudyCalculatorValues(state.values, state.definition) ||
    (state.maxima !== undefined &&
      !validateStudyCalculatorMaxima(state.maxima, state.definition)) ||
    !isPercent(state.target) ||
    (state.attendancePercent !== undefined &&
      state.attendancePercent !== null &&
      !isPercent(state.attendancePercent))
  ) {
    throw new RangeError("Invalid study calculator state");
  }
  const { fields, attestationThreshold } = state.definition;
  const topWeights = state.definition.topLevelWeights ?? DEFAULT_WEIGHTS;
  const fieldContributions = fields.map((field): StudyFieldContribution => {
    const value = state.values[field.id] ?? null;
    const normalizedPercent =
      value === null
        ? null
        : typeof value === "number"
          ? value
          : (value.earned / value.max) * 100;
    const finalWeightPercent =
      (field.weightPercent * topWeights[field.period]) / 100;
    return {
      id: field.id,
      normalizedPercent:
        normalizedPercent === null ? null : stable(normalizedPercent),
      kind:
        value === null
          ? "unknown"
          : typeof value === "number"
            ? "assumed"
            : (value.kind ?? "assumed"),
      maxScore:
        value !== null && typeof value === "object"
          ? value.max
          : (state.maxima?.[field.id] ?? field.maxScore ?? 100),
      periodContribution: stable(
        ((normalizedPercent ?? 0) * field.weightPercent) / 100,
      ),
      finalContribution: stable(
        ((normalizedPercent ?? 0) * finalWeightPercent) / 100,
      ),
      finalWeightPercent: stable(finalWeightPercent),
    };
  });
  const contributions = new Map(
    fieldContributions.map((item) => [item.id, item]),
  );
  const period = (name: StudyPeriod): StudyPeriodResult => {
    const items = fields
      .filter((field) => field.period === name)
      .map((field) => contributions.get(field.id)!);
    const complete = items.every((item) => item.normalizedPercent !== null);
    const earned = stable(
      items.reduce((sum, item) => sum + item.periodContribution, 0),
    );
    return { score: complete ? earned : null, earned, complete };
  };
  const periods = {
    att1: period("att1"),
    att2: period("att2"),
    exam: period("exam"),
  };
  const unknownFieldIds = fieldContributions
    .filter((item) => item.kind === "unknown")
    .map((item) => item.id);
  const minimumFinal = stable(
    fieldContributions.reduce((sum, item) => sum + item.finalContribution, 0),
  );
  const maximumFinal = stable(
    minimumFinal +
      fieldContributions
        .filter((item) => item.kind === "unknown")
        .reduce((sum, item) => sum + item.finalWeightPercent, 0),
  );
  const guaranteedFinal = stable(
    fieldContributions
      .filter((item) => item.kind === "actual")
      .reduce((sum, item) => sum + item.finalContribution, 0),
  );
  const warnings: string[] = [];
  const requirementResults = (state.definition.requirements ?? []).map(
    (requirement): StudyScenarioResult["requirementResults"][number] => {
      const value =
        requirement.kind === "period_minimum"
          ? periods[requirement.period!].score
          : requirement.kind === "component_minimum"
            ? contributions.get(requirement.fieldId!)!.normalizedPercent
            : (state.attendancePercent ?? null);
      const periodMaximum =
        requirement.kind === "period_minimum"
          ? periods[requirement.period!].earned +
            fields
              .filter(
                (field) =>
                  field.period === requirement.period &&
                  contributions.get(field.id)!.kind === "unknown",
              )
              .reduce((sum, field) => sum + field.weightPercent, 0)
          : 100;
      const status =
        requirement.verification === "needs_review"
          ? "needs_review"
          : value === null
            ? requirement.kind === "period_minimum" &&
              periods[requirement.period!].earned + 1e-9 >=
                requirement.minimumPercent
              ? "passed"
              : periodMaximum + 1e-9 < requirement.minimumPercent
                ? "failed"
                : "pending"
            : value + 1e-9 < requirement.minimumPercent
              ? "failed"
              : "passed";
      if (status !== "passed")
        warnings.push(
          `${requirement.label}: ${status === "failed" ? "требование не выполнено" : status === "needs_review" ? "требует проверки" : "нет подтверждённых данных"}`,
        );
      return { id: requirement.id, label: requirement.label, status };
    },
  );
  if (
    state.definition.verification === "needs_review" ||
    fields.some((field) => field.verification === "needs_review")
  )
    warnings.push(
      "Схема оценивания требует проверки; результат предварительный.",
    );
  const eligibilityStatus = requirementResults.some(
    (item) => item.status === "failed",
  )
    ? "blocked"
    : requirementResults.some(
          (item) => item.status === "pending" || item.status === "needs_review",
        ) || warnings.some((item) => item.includes("результат предварительный"))
      ? "pending"
      : "satisfied";
  const numericTargetStatus =
    minimumFinal + 1e-9 >= state.target
      ? "achieved"
      : maximumFinal + 1e-9 < state.target
        ? "impossible"
        : "possible";
  const targetStatus =
    eligibilityStatus === "blocked"
      ? "impossible"
      : numericTargetStatus === "achieved" && eligibilityStatus === "pending"
        ? "possible"
        : numericTargetStatus;
  const belowThreshold = [periods.att1, periods.att2].some(
    (item) => item.score !== null && item.score < attestationThreshold,
  )
    ? true
    : periods.att1.complete && periods.att2.complete
      ? false
      : null;

  const selected =
    options.unknownFieldIds ??
    (options.selectedFieldId ? [options.selectedFieldId] : []);
  if (
    !Array.isArray(selected) ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !contributions.has(id)) ||
    (options.ranges &&
      Object.entries(options.ranges).some(
        ([id, range]) =>
          !selected.includes(id) ||
          !range ||
          !isPercent(range.minPercent) ||
          !isPercent(range.maxPercent) ||
          range.minPercent > range.maxPercent,
      ))
  )
    throw new RangeError("Invalid study scenario variables");
  const pointsRequired = (
    field: StudyCalculatorField,
    percent: number,
  ): number => {
    const max = contributions.get(field.id)!.maxScore;
    const step = field.pointStep ?? 1;
    const raw = stable(max * (Math.max(0, percent) / 100));
    // The denominator itself is attainable even when it is not a multiple of the score step.
    return stable(
      Math.min(
        percent <= 100 ? max : Infinity,
        Math.ceil((raw - 1e-10) / step) * step,
      ),
    );
  };
  const rangeFor = (id: string): { minPercent: number; maxPercent: number } => {
    const range = options.ranges?.[id] ?? { minPercent: 0, maxPercent: 100 };
    const field = fields.find((item) => item.id === id)!;
    const max = contributions.get(id)!.maxScore;
    const step = field.pointStep ?? 1;
    return {
      minPercent: stable((pointsRequired(field, range.minPercent) / max) * 100),
      maxPercent:
        range.maxPercent === 100
          ? 100
          : stable(
              ((Math.floor((max * (range.maxPercent / 100) + 1e-10) / step) *
                step) /
                max) *
                100,
            ),
    };
  };
  const satisfies = (scores: Map<string, number>): boolean => {
    const numeric = fields.reduce(
      (sum, field) =>
        sum +
        ((scores.get(field.id) ??
          contributions.get(field.id)!.normalizedPercent ??
          0) *
          contributions.get(field.id)!.finalWeightPercent) /
          100,
      0,
    );
    return (
      numeric + 1e-8 >= state.target &&
      (state.definition.requirements ?? []).every((requirement) => {
        if (requirement.verification !== "verified") return true;
        if (requirement.kind === "attendance_minimum")
          return (
            state.attendancePercent == null ||
            state.attendancePercent + 1e-9 >= requirement.minimumPercent
          );
        const score =
          requirement.kind === "component_minimum"
            ? (scores.get(requirement.fieldId!) ??
              contributions.get(requirement.fieldId!)!.normalizedPercent ??
              0)
            : fields
                .filter((field) => field.period === requirement.period)
                .reduce(
                  (sum, field) =>
                    sum +
                    ((scores.get(field.id) ??
                      contributions.get(field.id)!.normalizedPercent ??
                      0) *
                      field.weightPercent) /
                      100,
                  0,
                );
        return score + 1e-8 >= requirement.minimumPercent;
      })
    );
  };
  const solve = (ids: string[]): StudyScenarioResult["scenarioRange"] => {
    if (!ids.length) return null;
    const fixed = fieldContributions
      .filter((item) => !ids.includes(item.id))
      .reduce((sum, item) => sum + item.finalContribution, 0);
    const total = (bound: "minPercent" | "maxPercent") =>
      stable(
        fixed +
          ids.reduce(
            (sum, id) =>
              sum +
              (rangeFor(id)[bound] *
                contributions.get(id)!.finalWeightPercent) /
                100,
            0,
          ),
      );
    const at = (common: number) =>
      new Map(
        ids.map((id) => [
          id,
          Math.min(
            rangeFor(id).maxPercent,
            Math.max(rangeFor(id).minPercent, common),
          ),
        ]),
      );
    const feasible =
      ids.every((id) => rangeFor(id).minPercent <= rangeFor(id).maxPercent) &&
      satisfies(at(100));
    let low = 0,
      high = 100;
    if (feasible)
      for (let iteration = 0; iteration < 60; iteration += 1) {
        const middle = (low + high) / 2;
        if (satisfies(at(middle))) high = middle;
        else low = middle;
      }
    const requiredCommonPercent = feasible ? stable(high) : null;
    return {
      minimumFinal: total("minPercent"),
      maximumFinal: total("maxPercent"),
      requiredCommonPercent,
      feasible,
      components: ids.map((id) => {
        const field = fields.find((item) => item.id === id)!;
        const needed = feasible
          ? Math.min(
              rangeFor(id).maxPercent,
              Math.max(rangeFor(id).minPercent, high),
            )
          : 101;
        return {
          fieldId: id,
          requiredPercent: stable(needed),
          requiredPoints: pointsRequired(field, needed),
          maxScore: contributions.get(id)!.maxScore,
          possible: feasible,
        };
      }),
    };
  };
  const requiredComponents = unknownFieldIds.map(
    (id): StudyRequiredComponent => {
      const item = contributions.get(id)!;
      const field = fields.find((candidate) => candidate.id === id)!;
      const needed =
        item.finalWeightPercent === 0
          ? minimumFinal >= state.target
            ? 0
            : 101
          : stable(
              Math.max(
                0,
                ((state.target - minimumFinal) / item.finalWeightPercent) * 100,
              ),
            );
      const solution = solve([id]);
      const constrained = solution?.feasible
        ? Math.max(needed, solution.components[0]!.requiredPercent)
        : needed;
      return {
        fieldId: id,
        requiredPercent: constrained,
        requiredPoints: pointsRequired(field, constrained),
        maxScore: item.maxScore,
        possible: needed <= 100 && solution!.feasible,
      };
    },
  );
  const attestationsComplete = periods.att1.complete && periods.att2.complete;
  return {
    att1: periods.att1,
    att2: periods.att2,
    examScore: periods.exam.score,
    finalScore: unknownFieldIds.length === 0 ? minimumFinal : null,
    minimumFinal,
    maximumFinal,
    guaranteedFinal,
    projection: unknownFieldIds.length < fields.length ? minimumFinal : null,
    requiredExamScore:
      attestationsComplete && topWeights.exam > 0
        ? stable(
            Math.max(
              0,
              (state.target -
                (topWeights.att1 / 100) * periods.att1.score! -
                (topWeights.att2 / 100) * periods.att2.score!) /
                (topWeights.exam / 100),
            ),
          )
        : null,
    belowThreshold,
    targetStatus,
    numericTargetStatus,
    eligibilityStatus,
    fieldContributions,
    unknownFieldIds,
    requiredComponents,
    requirementResults,
    warnings,
    scenarioRange: solve(selected),
  };
}
