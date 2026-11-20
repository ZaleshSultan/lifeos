import {
  calculateStudyScenario,
  calculateStudyTargetPlan,
  validateStudyCalculatorDefinition,
  type StudyCalculatorDefinition,
  type StudyCalculatorField,
  type StudyCalculatorState,
} from "./study.js";
import { resolveStudyCalculator } from "./study-syllabi.js";
import {
  normalizeStudyTitle,
  studyEvidenceBelongsToCourse,
  studyEvidenceIsAggregate,
  studyEvidenceIsMocked,
  studyEvidenceMatchesField,
  studyEvidencePercent,
  studyEvidencePeriodTotal,
  studyEvidenceOfficialPeriod,
  studyEvidenceExternalAsyncField,
  type StudyGradeEvidence,
} from "./study-evidence.js";

export const SCHOLARSHIP_SCENARIOS = [
  "pessimistic",
  "realistic",
  "optimistic",
] as const;
export type ScholarshipScenarioId = (typeof SCHOLARSHIP_SCENARIOS)[number];
export const SCHOLARSHIP_KINDS = [
  "assignment",
  "quiz",
  "midterm",
  "endterm",
  "exam",
  "other",
] as const;
export type ScholarshipWorkKind = (typeof SCHOLARSHIP_KINDS)[number];
export interface ScholarshipScenario {
  defaults: Record<ScholarshipWorkKind, number | null>;
  overrides: Record<string, number | null>;
  /** Hypotheses only; cannot replace a verified period total. */
  periodTotals: { att1: number | null; att2: number | null };
}
export interface ScholarshipBinding {
  mode: "aggregate" | "weighted";
  /** Weighted rules must be explicitly checked against the course's actual rubric. */
  ruleConfirmed: boolean;
  entries: Array<{ recordId: string; weight: number }>;
}
export interface ScholarshipConfig {
  version: 1;
  included: boolean;
  threshold: number;
  target: number;
  useManualValues: boolean;
  scenarios: Record<ScholarshipScenarioId, ScholarshipScenario>;
  bindings: Record<string, ScholarshipBinding>;
}
export interface ScholarshipCourseInput {
  id: string;
  title: string;
  code: string;
  calculator: StudyCalculatorState | null;
  externalCourseKey?: string | null;
  scholarship?: ScholarshipConfig | null;
}
export interface ScholarshipWorkInput {
  title: string;
  courseTitle: string | null;
  dueAt: string | null;
}
export function defaultScholarshipConfig(target = 70): ScholarshipConfig {
  const scenario = (score: number): ScholarshipScenario => ({
    defaults: Object.fromEntries(
      SCHOLARSHIP_KINDS.map((kind) => [kind, score]),
    ) as ScholarshipScenario["defaults"],
    overrides: {},
    periodTotals: { att1: null, att2: null },
  });
  return {
    version: 1,
    included: true,
    threshold: 70,
    target,
    useManualValues: true,
    scenarios: {
      pessimistic: scenario(50),
      realistic: scenario(70),
      optimistic: scenario(90),
    },
    bindings: {},
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const percent = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;
const optionalPercent = (value: unknown) => value === null || percent(value);
const key = (value: string) =>
  /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value) &&
  !["constructor", "prototype"].includes(value);
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).every((name) => names.includes(name));
export function validateScholarshipConfig(
  value: unknown,
): value is ScholarshipConfig {
  if (
    !object(value) ||
    !keys(value, [
      "version",
      "included",
      "threshold",
      "target",
      "useManualValues",
      "scenarios",
      "bindings",
    ]) ||
    value.version !== 1 ||
    typeof value.included !== "boolean" ||
    !percent(value.threshold) ||
    !percent(value.target) ||
    typeof value.useManualValues !== "boolean" ||
    !object(value.scenarios) ||
    Object.keys(value.scenarios).length !== 3 ||
    !keys(value.scenarios, SCHOLARSHIP_SCENARIOS) ||
    !object(value.bindings) ||
    Object.keys(value.bindings).length > 20
  )
    return false;
  for (const id of SCHOLARSHIP_SCENARIOS) {
    const scenario = value.scenarios[id];
    if (
      !object(scenario) ||
      !keys(scenario, ["defaults", "overrides", "periodTotals"]) ||
      !object(scenario.defaults) ||
      Object.keys(scenario.defaults).length !== SCHOLARSHIP_KINDS.length ||
      !keys(scenario.defaults, SCHOLARSHIP_KINDS) ||
      !Object.values(scenario.defaults).every(optionalPercent) ||
      !object(scenario.overrides) ||
      Object.keys(scenario.overrides).length > 100 ||
      !Object.entries(scenario.overrides).every(
        ([id, score]) => key(id) && optionalPercent(score),
      ) ||
      !object(scenario.periodTotals) ||
      Object.keys(scenario.periodTotals).length !== 2 ||
      !keys(scenario.periodTotals, ["att1", "att2"]) ||
      !Object.values(scenario.periodTotals).every(optionalPercent)
    )
      return false;
  }
  const recordIds = new Set<string>();
  let entries = 0;
  for (const [fieldId, binding] of Object.entries(value.bindings)) {
    if (
      !key(fieldId) ||
      !object(binding) ||
      !keys(binding, ["mode", "ruleConfirmed", "entries"]) ||
      !["aggregate", "weighted"].includes(String(binding.mode)) ||
      binding.ruleConfirmed !== true ||
      !Array.isArray(binding.entries) ||
      binding.entries.length < 1 ||
      binding.entries.length > 40 ||
      (binding.mode === "aggregate" && binding.entries.length !== 1)
    )
      return false;
    let sum = 0;
    for (const entry of binding.entries) {
      if (
        !object(entry) ||
        !keys(entry, ["recordId", "weight"]) ||
        typeof entry.recordId !== "string" ||
        !/^[A-Za-z0-9:_-]{1,100}$/.test(entry.recordId) ||
        recordIds.has(entry.recordId) ||
        !percent(entry.weight) ||
        entry.weight <= 0
      )
        return false;
      recordIds.add(entry.recordId);
      sum += entry.weight;
      entries += 1;
    }
    if (Math.abs(sum - 100) > 1e-7) return false;
  }
  return entries <= 60;
}
export function scholarshipWorkKind(
  field: StudyCalculatorField,
): ScholarshipWorkKind {
  if (field.period === "exam") return "exam";
  const name = normalizeStudyTitle(field.id + " " + field.label);
  if (/quiz|квиз|asynchron|асинх/.test(name)) return "quiz";
  if (/midterm|att1 control/.test(name)) return "midterm";
  if (/endterm|att2 control/.test(name)) return "endterm";
  if (/assignment|задани|асай|att[12] work/.test(name)) return "assignment";
  return "other";
}
export interface ScholarshipEvidenceRow {
  id: string;
  originalFieldId: string;
  label: string;
  period: StudyCalculatorField["period"];
  kind: ScholarshipWorkKind;
  weightInFinal: number;
  confirmed: number | null;
  manual: number | null;
  updatedAt: string | null;
  dueAt: string | null;
  source: "moodle" | "unknown";
}
export interface ScholarshipScenarioResult {
  finalScore: number | null;
  att1: number | null;
  att2: number | null;
  requiredExam: number | null;
  requiredExamInteger: number | null;
  assumedFields: number;
  manualOverrides: number;
  values: Record<string, number | null>;
}
export interface ScholarshipAction {
  courseId: string;
  courseTitle: string;
  fieldId: string;
  label: string;
  kind: ScholarshipWorkKind;
  dueAt: string | null;
  weightInFinal: number;
  minimumIfOthers100: number | null;
  requiredUnderScenario: number | null;
  assumptionAverage: number | null;
  scenarioScore: number | null;
  gainPer10: number;
  possibleGain: number;
  priority: number;
}
export interface ScholarshipCoursePlan {
  courseId: string;
  title: string;
  configured: boolean;
  included: boolean;
  threshold: number;
  target: number;
  minimum: number | null;
  maximum: number | null;
  requiredAverage: number | null;
  targetPossible: boolean | null;
  scholarshipPossible: boolean | null;
  risk: "unknown" | "impossible" | "at_risk" | "narrow" | "safe";
  confirmedCount: number;
  evidence: ScholarshipEvidenceRow[];
  scenarios: Record<ScholarshipScenarioId, ScholarshipScenarioResult> | null;
  actions: ScholarshipAction[];
  warnings: string[];
  attestationChecks: Array<{
    period: "att1" | "att2";
    calculated: number | null;
    official: number;
    matches: boolean | null;
  }>;
}
const stable = (value: number) => Math.round(value * 1e10) / 1e10;
/** Never round a required minimum down. */
const required = (value: number) =>
  Math.max(0, Math.ceil(value * 100 - 1e-8) / 100);

export function selectScholarshipCourseRecords<T extends StudyGradeEvidence>(
  course: ScholarshipCourseInput,
  records: T[],
) {
  const linked = course.externalCourseKey?.startsWith("moodle:")
    ? course.externalCourseKey
    : null;
  const visible = records.filter((record) => {
    const raw = record.rawJson;
    return (
      !studyEvidenceIsMocked(record) &&
      !(
        raw &&
        typeof raw === "object" &&
        "_grade_visibility_unknown" in raw &&
        raw._grade_visibility_unknown === true
      )
    );
  });
  const candidates = visible
    .map((record) => {
      const raw = record.rawJson;
      const id =
        raw && typeof raw === "object" && "moodle_course_id" in raw
          ? raw.moodle_course_id
          : null;
      const key =
        (typeof id === "string" && id.trim() !== "") ||
        (typeof id === "number" && Number.isSafeInteger(id))
          ? "moodle:" + String(id).trim()
          : null;
      return { record, key, title: normalizeStudyTitle(record.courseTitle) };
    })
    .filter(
      ({ record, key }) =>
        (linked !== null && key === linked) ||
        studyEvidenceBelongsToCourse(record, course),
    );

  const knownTitles = new Set(
    candidates.filter(({ key }) => key !== null).map(({ title }) => title),
  );
  const sources = new Set<string>();
  for (const { key, title } of candidates) {
    if (key !== null) sources.add(key);
    else if (!knownTitles.has(title)) sources.add("title:" + title);
  }
  const ambiguous =
    sources.size > 1 ||
    (linked !== null &&
      candidates.some(({ key }) => key !== null && key !== linked));
  const own = candidates
    .filter(({ key }) => {
      if (linked && key !== null) return key === linked;
      return !ambiguous;
    })
    .map(({ record }) => record);
  const skipped =
    ambiguous && candidates.some(({ key }) => !linked || key === null);
  return { own, skipped };
}

// Input is already filtered to a single course and visible, non-demo observations.
function publishedFinalRegister(
  records: StudyGradeEvidence[],
  reserved: Set<string>,
) {
  const moodleId = (value: unknown) => {
    if (typeof value === "number")
      return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    return typeof value === "string" &&
      /^[a-z0-9][a-z0-9_-]{0,99}$/iu.test(value.trim())
      ? value.trim()
      : null;
  };
  let registered:
    | { course: string; item: string; record: StudyGradeEvidence }
    | undefined;
  for (const record of records) {
    if (!record.sourceEventId?.trim()) continue;
    const raw = record.rawJson;
    if (
      !object(raw) ||
      raw.moodle_module ||
      raw.itemmodule ||
      raw.itemtype === "mod" ||
      raw.itemtype === "course"
    )
      continue;
    const name = raw.item_name ?? raw.itemname ?? record.title;
    if (
      typeof name !== "string" ||
      !/^(?:calculated grade )?register final$/u.test(
        name.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " "),
      )
    )
      continue;
    const course = moodleId(raw.moodle_course_id);
    const item = moodleId(raw.moodle_item_id);
    if (course === null || item === null) continue;
    // A bound observation and its Moodle mirrors represent the very same score.
    if (reserved.has(record.id)) return undefined;
    if (
      registered &&
      (registered.course !== course ||
        registered.item !== item ||
        registered.record.score !== record.score ||
        registered.record.maxScore !== record.maxScore)
    )
      return undefined;
    registered = { course, item, record };
  }
  return registered && studyEvidencePercent(registered.record) !== null
    ? registered.record
    : undefined;
}

function buildEvidence(
  course: ScholarshipCourseInput,
  state: StudyCalculatorState,
  config: ScholarshipConfig,
  { own, skipped }: ReturnType<typeof selectScholarshipCourseRecords>,
  work: ScholarshipWorkInput[],
) {
  const activeBindings = Object.entries(config.bindings).filter(
    ([id, binding]) =>
      state.definition.fields.some(
        (field) =>
          field.id === id &&
          (field.period !== "exam" || binding.mode === "aggregate"),
      ),
  );
  const reserved = new Set(
    activeBindings.flatMap(([, binding]) =>
      binding.entries.map((entry) => entry.recordId),
    ),
  );
  const warnings: string[] = [];
  if (skipped)
    warnings.push(
      "Найдено несколько подходящих курсов Moodle. Оценки без однозначной привязки к предмету пропущены.",
    );
  if (activeBindings.length !== Object.keys(config.bindings).length)
    warnings.push(
      "Устаревшие сопоставления или разбиение экзамена игнорируются. Проверьте настройки после изменения формулы.",
    );
  const usedIds = new Set(state.definition.fields.map((field) => field.id));
  const uniqueId = (candidate: string) => {
    let id = candidate.slice(0, 80);
    let suffix = 0;
    while (usedIds.has(id)) id = candidate.slice(0, 70) + "_" + ++suffix;
    usedIds.add(id);
    return id;
  };
  const fields: StudyCalculatorField[] = [];
  const rows: ScholarshipEvidenceRow[] = [];
  const add = (
    field: StudyCalculatorField,
    original: StudyCalculatorField,
    record?: StudyGradeEvidence,
    manual: number | null = state.values[original.id] ?? null,
  ) => {
    fields.push(field);
    const deadlines = work.filter(
      (item) =>
        item.courseTitle &&
        studyEvidenceBelongsToCourse(
          { courseTitle: item.courseTitle },
          course,
        ) &&
        ((record &&
          normalizeStudyTitle(item.title) ===
            normalizeStudyTitle(record.title)) ||
          (field.id === original.id &&
            studyEvidenceMatchesField(
              original,
              {
                ...item,
                id: "",
                courseTitle: item.courseTitle!,
                score: null,
                maxScore: null,
                updatedAt: "",
              },
              course,
            ))),
    );
    const due =
      record?.dueAt ?? (deadlines.length === 1 ? deadlines[0].dueAt : null);
    rows.push({
      id: field.id,
      originalFieldId: original.id,
      label:
        record &&
        studyEvidenceExternalAsyncField(record, course) === original.id
          ? `${record.title.trim().slice(0, 260)} · итог внешней платформы`
          : field.label,
      period: field.period,
      kind: scholarshipWorkKind(original),
      weightInFinal: stable(
        field.weightPercent * (field.period === "exam" ? 0.4 : 0.3),
      ),
      confirmed: record ? studyEvidencePercent(record) : null,
      manual,
      source:
        record && studyEvidencePercent(record) !== null ? "moodle" : "unknown",
      updatedAt:
        record &&
        studyEvidencePercent(record) !== null &&
        Number.isFinite(Date.parse(record.updatedAt))
          ? record.updatedAt
          : null,
      dueAt: due && Number.isFinite(Date.parse(due)) ? due : null,
    });
  };
  const addMatched = (
    field: StudyCalculatorField,
    useFinalRegister = false,
  ) => {
    const matching = own.filter((row) =>
      studyEvidenceMatchesField(field, row, course),
    );
    const candidates = matching.filter((row) => !reserved.has(row.id));
    const published = candidates.filter(
      (row) => studyEvidencePercent(row) !== null,
    );
    if (
      useFinalRegister &&
      matching.every((row) => studyEvidencePercent(row) === null)
    ) {
      const register = publishedFinalRegister(own, reserved);
      if (register) {
        add(field, field, register);
        return;
      }
    }
    const matches = published.length > 0 ? published : candidates;
    add(field, field, matches.length === 1 ? matches[0] : undefined);
    if (published.length > 1)
      warnings.push(
        field.label + ": неоднозначные оценки Moodle не подставлены.",
      );
  };
  for (const period of ["att1", "att2"] as const) {
    const total = own.filter(
      (record) =>
        studyEvidencePeriodTotal(record) === period &&
        studyEvidencePercent(record) !== null,
    );
    if (total.length === 1) {
      const field: StudyCalculatorField = {
        id: uniqueId(period + "_verified_total"),
        label: "Подтверждённый итог " + period.toUpperCase(),
        period,
        weightPercent: 100,
      };
      add(field, field, total[0], null);
      continue; // The total replaces its children, never adds to them.
    }
    if (total.length > 1)
      warnings.push(
        "Несколько итогов " +
          period.toUpperCase() +
          ": требуется однозначное сопоставление.",
      );
    for (const field of state.definition.fields.filter(
      (item) => item.period === period,
    )) {
      const binding = config.bindings[field.id];
      if (binding) {
        if (
          state.definition.fields.length +
            Object.values(config.bindings).reduce(
              (sum, item) => sum + item.entries.length - 1,
              0,
            ) >
          100
        ) {
          warnings.push(
            "Слишком много связанных работ; сократите сопоставления до 100 компонентов.",
          );
          add(field, field);
          continue;
        }
        if (
          binding.entries.some((entry) =>
            own.some(
              (row) =>
                row.id === entry.recordId &&
                studyEvidenceOfficialPeriod(row, course),
            ),
          )
        ) {
          warnings.push(
            field.label +
              ": итог аттестации нельзя записывать в отдельный компонент.",
          );
          add(field, field);
          continue;
        }
        const items = binding.entries.map((entry) => ({
          entry,
          record: own.find((record) => record.id === entry.recordId),
        }));
        if (
          binding.mode === "weighted" &&
          items.some(
            ({ record }) =>
              record &&
              (studyEvidenceIsAggregate(record) ||
                studyEvidenceOfficialPeriod(record, course)),
          )
        ) {
          warnings.push(
            field.label +
              ": итог и отдельные работы нельзя складывать; выберите один готовый итог или только отдельные работы.",
          );
          add(field, field);
          continue;
        }
        for (const [index, { entry, record }] of items.entries()) {
          const expanded = binding.mode === "weighted";
          add(
            expanded
              ? {
                  ...field,
                  id: uniqueId(field.id.slice(0, 68) + "_part_" + (index + 1)),
                  label: (
                    field.label +
                    " · " +
                    (record?.title ?? "Неизвестная работа")
                  ).slice(0, 300),
                  weightPercent: (field.weightPercent * entry.weight) / 100,
                }
              : field,
            field,
            record,
            expanded ? null : (state.values[field.id] ?? null),
          );
          if (!record)
            warnings.push(
              field.label +
                ": связанная запись Moodle отсутствует или принадлежит другому курсу.",
            );
        }
      } else {
        addMatched(field);
      }
    }
  }
  const exams = state.definition.fields.filter(
    (item) => item.period === "exam",
  );
  for (const field of exams) {
    const binding = config.bindings[field.id];
    if (binding?.mode === "aggregate") {
      const record = own.find(
        (row) =>
          row.id === binding.entries[0].recordId &&
          !studyEvidenceOfficialPeriod(row, course),
      );
      add(field, field, record);
      continue;
    }
    addMatched(
      field,
      !binding &&
        exams.length === 1 &&
        field.id === "final_exam" &&
        field.weightPercent === 100,
    );
  }
  if (
    rows.some((row) => row.kind === "quiz" && row.confirmed === null) &&
    own.some((row) => /asynchron|асинх/.test(normalizeStudyTitle(row.title)))
  ) {
    warnings.push(
      "DBMS asynchronous work: укажите Quiz нужной аттестации и подтверждённый способ подсчёта; среднее по названию не угадывается.",
    );
  }
  const definition: StudyCalculatorDefinition = { ...state.definition, fields };
  if (!validateStudyCalculatorDefinition(definition))
    throw new RangeError("Expanded scholarship definition is invalid");
  return { definition, rows, warnings };
}

/** Source components for an editable syllabus worksheet, before any forecast assumptions. */
export function scholarshipSyllabusEvidence(
  course: ScholarshipCourseInput,
  records: StudyGradeEvidence[],
) {
  const state = resolveStudyCalculator(course);
  if (!state) return null;
  const config = course.scholarship ?? defaultScholarshipConfig(state.target);
  if (!validateScholarshipConfig(config)) return null;
  return buildEvidence(
    course,
    state,
    config,
    selectScholarshipCourseRecords(course, records),
    [],
  );
}

type SyllabusEvidence = NonNullable<
  ReturnType<typeof scholarshipSyllabusEvidence>
>;

/** Only individual, explicit inputs count. Scenario defaults never supply missing grades. */
function syllabusValues(evidence: SyllabusEvidence, config: ScholarshipConfig) {
  return Object.fromEntries(
    evidence.rows.map((row) => {
      const overrides = config.scenarios.realistic.overrides;
      const manual = Object.hasOwn(overrides, row.id)
        ? overrides[row.id]
        : Object.hasOwn(overrides, row.originalFieldId)
          ? overrides[row.originalFieldId]
          : config.useManualValues
            ? row.manual
            : null;
      return [row.id, row.confirmed ?? manual] as const;
    }),
  );
}

function syllabusRequirements(
  evidence: SyllabusEvidence,
  values: StudyCalculatorState["values"],
  target: number,
) {
  const state = { definition: evidence.definition, values, target };
  // Reuse the course calculator's attestation checks and its unrounded scoring.
  const plan = calculateStudyTargetPlan(state);
  const remaining = evidence.rows.reduce(
    (sum, row) => sum + (values[row.id] == null ? row.weightInFinal : 0),
    0,
  );
  const stageMinima = (["att1", "att2"] as const).map((period) => {
    const fields = evidence.definition.fields.filter(
      (field) => field.period === period,
    );
    let earned = 0,
      pendingWeight = 0;
    for (const field of fields) {
      const value = values[field.id];
      if (value == null) pendingWeight += field.weightPercent;
      else earned += (value * field.weightPercent) / 100;
    }
    const gap = Math.max(
      0,
      stable(evidence.definition.attestationThreshold - earned),
    );
    return {
      period,
      gap,
      blocked: gap > pendingWeight + 1e-8,
      needed: pendingWeight > 0 ? required((gap * 100) / pendingWeight) : null,
    };
  });
  const gradeGap = Math.max(0, stable(target - plan.earnedFinalPoints));
  // Meeting both stage floors also contributes to the course total. Never add that weight twice.
  const shortfall = Math.max(
    gradeGap,
    stable(stageMinima.reduce((sum, stage) => sum + stage.gap * 0.3, 0)),
  );
  return {
    ...plan,
    values,
    gradeGap,
    shortfall,
    stageMinima,
    minimumAverage:
      remaining > 0 ? required((shortfall * 100) / remaining) : null,
  };
}

export function calculateSyllabusMinimum(
  evidence: SyllabusEvidence,
  config: ScholarshipConfig,
) {
  return syllabusRequirements(
    evidence,
    syllabusValues(evidence, config),
    config.target,
  );
}

/** Balance remaining scores at hundredth-point precision, first honoring each attestation minimum. */
export function calculateSyllabusWorkPlan(
  evidence: SyllabusEvidence,
  config: ScholarshipConfig,
  forecasts: Readonly<Record<string, number>> = {},
) {
  const values = syllabusValues(evidence, config);
  const remaining = evidence.rows.filter((row) => values[row.id] == null);
  const open: ScholarshipEvidenceRow[] = [];
  for (const row of remaining) {
    if (!Object.hasOwn(forecasts, row.id)) {
      open.push(row);
      continue;
    }
    const score = forecasts[row.id];
    if (!percent(score)) throw new RangeError("Invalid forecast score");
    values[row.id] = score;
  }
  const plan = syllabusRequirements(evidence, values, config.target);
  const possible =
    plan.targetPossible && !plan.stageMinima.some((stage) => stage.blocked);
  const floor = { att1: 0, att2: 0, exam: 0 };
  for (const stage of plan.stageMinima)
    floor[stage.period] = Math.min(100, stage.needed ?? 0);
  const scoreAt = (row: ScholarshipEvidenceRow, cents: number) =>
    Math.max(floor[row.period], cents / 100);
  const totalAt = (cents: number) =>
    plan.earnedFinalPoints +
    open.reduce(
      (sum, row) => sum + (scoreAt(row, cents) * row.weightInFinal) / 100,
      0,
    );
  // Find the smallest shared score on the display grid that covers the target;
  // stages with a higher threshold keep their own floor throughout the search.
  let low = 0;
  let high = 10_000;
  if (possible && open.length > 0) {
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (totalAt(mid) + 1e-10 >= config.target) high = mid;
      else low = mid + 1;
    }
  }
  return {
    rows: remaining.map((row) => ({
      id: row.id,
      forecast: values[row.id] ?? null,
      recommended:
        possible && values[row.id] == null ? scoreAt(row, low) : null,
    })),
    possible,
    projectedFinal: possible || open.length === 0 ? stable(totalAt(low)) : null,
  };
}

export function calculateScholarshipCourse(
  course: ScholarshipCourseInput,
  records: StudyGradeEvidence[],
  options: {
    target?: number;
    selected?: ScholarshipScenarioId;
    assignmentScore?: number;
    work?: ScholarshipWorkInput[];
    now?: string;
  } = {},
): ScholarshipCoursePlan {
  const state = resolveStudyCalculator(course);
  const config =
    course.scholarship ?? defaultScholarshipConfig(state?.target ?? 70);
  if (
    !validateScholarshipConfig(config) ||
    (options.target !== undefined && !percent(options.target)) ||
    (options.assignmentScore !== undefined && !percent(options.assignmentScore))
  )
    throw new RangeError("Invalid scholarship configuration");
  const target = options.target ?? config.target;
  const base: ScholarshipCoursePlan = {
    courseId: course.id,
    title: course.title,
    configured: Boolean(state),
    included: config.included,
    threshold: config.threshold,
    target,
    minimum: null,
    maximum: null,
    requiredAverage: null,
    targetPossible: null,
    scholarshipPossible: null,
    risk: "unknown",
    confirmedCount: 0,
    evidence: [],
    scenarios: null,
    actions: [],
    warnings: [],
    attestationChecks: [],
  };
  if (!state)
    return {
      ...base,
      warnings: [
        "Нет подтверждённой схемы оценивания. Настройте формулу курса в калькуляторе.",
      ],
    };
  const courseEvidence = selectScholarshipCourseRecords(course, records);
  const { definition, rows, warnings } = buildEvidence(
    course,
    state,
    config,
    courseEvidence,
    options.work ?? [],
  );
  const confirmedValues = Object.fromEntries(
    rows.map((row) => [row.id, row.confirmed]),
  );
  const confirmedState = { definition, values: confirmedValues, target };
  const bounds = calculateStudyTargetPlan(confirmedState);
  const verified = calculateStudyScenario(confirmedState);
  const attestationChecks: ScholarshipCoursePlan["attestationChecks"] = [];
  for (const period of ["att1", "att2"] as const) {
    const official = courseEvidence.own.filter(
      (row) =>
        studyEvidenceOfficialPeriod(row, course) === period &&
        studyEvidencePercent(row) !== null,
    );
    if (official.length === 1) {
      const score = studyEvidencePercent(official[0])!;
      const calculated = verified[period].score;
      const matches =
        calculated === null ? null : Math.abs(calculated - score) < 0.011;
      attestationChecks.push({ period, calculated, official: score, matches });
      if (matches === false)
        warnings.push(
          `${period.toUpperCase()}: расчёт по компонентам расходится с официальным итогом Moodle. Проверьте веса и сопоставления.`,
        );
    }
  }
  const scenarios = {} as Record<
    ScholarshipScenarioId,
    ScholarshipScenarioResult
  >;
  for (const id of SCHOLARSHIP_SCENARIOS) {
    const scenario =
      options.assignmentScore === undefined
        ? config.scenarios[id]
        : withScholarshipAssignmentAssumption(
            config,
            id,
            rows,
            options.assignmentScore,
          ).scenarios[id];
    let assumedFields = 0;
    let manualOverrides = 0;
    const values = Object.fromEntries(
      rows.map((row) => {
        let value = row.confirmed;
        // Manual edits remain hypotheses, including when they differ from fresh Moodle.
        if (
          row.confirmed === null &&
          config.useManualValues &&
          row.manual !== null
        ) {
          value = row.manual;
          if (value !== row.confirmed) manualOverrides += 1;
        }
        if (row.confirmed === null) {
          if (Object.hasOwn(scenario.overrides, row.id))
            value = scenario.overrides[row.id];
          else if (Object.hasOwn(scenario.overrides, row.originalFieldId))
            value = scenario.overrides[row.originalFieldId];
          else if (value === null) value = scenario.defaults[row.kind];
          if (value !== null) assumedFields += 1;
        }
        return [row.id, value];
      }),
    );
    for (const period of ["att1", "att2"] as const) {
      const hypotheticalTotal = scenario.periodTotals[period];
      const periodRows = rows.filter((row) => row.period === period);
      const pending = periodRows.filter((row) => row.confirmed === null);
      if (hypotheticalTotal === null || !pending.length) continue;
      const earned = periodRows.reduce(
        (sum, row) => sum + ((row.confirmed ?? 0) * row.weightInFinal) / 30,
        0,
      );
      const pendingWeight = pending.reduce(
        (sum, row) => sum + row.weightInFinal / 30,
        0,
      );
      const uniform = stable((hypotheticalTotal - earned) / pendingWeight);
      if (uniform < 0 || uniform > 100) {
        for (const row of pending) values[row.id] = null;
        warnings.push(
          `${id}: допущение ${period.toUpperCase()} = ${hypotheticalTotal} несовместимо с подтверждёнными оценками; итог сценария неизвестен.`,
        );
      } else for (const row of pending) values[row.id] = uniform;
    }
    assumedFields = rows.filter(
      (row) => row.confirmed === null && values[row.id] !== null,
    ).length;
    const result = calculateStudyScenario({ definition, values, target });
    const exam = rows.find((row) => row.period === "exam")!;
    const examState = calculateStudyScenario({
      definition,
      values: { ...values, [exam.id]: null },
      target,
    });
    scenarios[id] = {
      finalScore: result.finalScore,
      att1: result.att1.score,
      att2: result.att2.score,
      requiredExam:
        examState.requiredExamScore === null
          ? null
          : required(examState.requiredExamScore),
      requiredExamInteger:
        examState.requiredExamScore === null
          ? null
          : Math.ceil(examState.requiredExamScore - 1e-8),
      assumedFields,
      manualOverrides,
      values,
    };
  }
  const selected = scenarios[options.selected ?? "realistic"];
  const known = rows.filter((row) => row.confirmed !== null);
  const now = options.now ? Date.parse(options.now) : null;
  const actions = rows
    .filter((row) => row.confirmed === null)
    .map((row): ScholarshipAction => {
      const others = rows.filter((other) => other.id !== row.id);
      const othersComplete = others.every(
        (other) => selected.values[other.id] !== null,
      );
      const othersPoints = others.reduce(
        (sum, other) =>
          sum + ((selected.values[other.id] ?? 0) * other.weightInFinal) / 100,
        0,
      );
      const assumedOther = others.filter((other) => other.confirmed === null);
      const assumedWeight = assumedOther.reduce(
        (sum, other) => sum + other.weightInFinal,
        0,
      );
      const assumedPoints = assumedOther.reduce(
        (sum, other) =>
          sum + (selected.values[other.id] ?? 0) * other.weightInFinal,
        0,
      );
      const requiredUnderScenario = othersComplete
        ? required(((target - othersPoints) * 100) / row.weightInFinal)
        : null;
      const minimumIfOthers100 = required(
        ((target -
          bounds.earnedFinalPoints -
          rows
            .filter((item) => item.confirmed === null && item.id !== row.id)
            .reduce((sum, item) => sum + item.weightInFinal, 0)) *
          100) /
          row.weightInFinal,
      );
      const scenarioScore = selected.values[row.id];
      const possibleGain = stable(
        (row.weightInFinal * (100 - (scenarioScore ?? 0))) / 100,
      );
      const days =
        now !== null && row.dueAt
          ? Math.max(0, (Date.parse(row.dueAt) - now) / 86400000)
          : null;
      const urgency = days === null ? 1 : 1 + 1 / (1 + days);
      return {
        courseId: course.id,
        courseTitle: course.title,
        fieldId: row.id,
        label: row.label,
        kind: row.kind,
        dueAt: row.dueAt,
        weightInFinal: row.weightInFinal,
        minimumIfOthers100,
        requiredUnderScenario,
        assumptionAverage:
          othersComplete && assumedWeight > 0
            ? stable(assumedPoints / assumedWeight)
            : null,
        scenarioScore,
        gainPer10: stable(row.weightInFinal / 10),
        possibleGain,
        priority: stable(
          possibleGain *
            urgency *
            (1 +
              Math.max(
                0,
                config.threshold - (selected.finalScore ?? config.threshold),
              ) /
                10),
        ),
      };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.weightInFinal - a.weightInFinal ||
        a.fieldId.localeCompare(b.fieldId),
    );
  const realistic = scenarios.realistic;
  const scholarshipPossible = bounds.maximumFinal + 1e-8 >= config.threshold;
  const hasEvidence = known.length > 0 || realistic.manualOverrides > 0;
  if (
    config.useManualValues &&
    rows.some(
      (row) =>
        row.confirmed !== null &&
        row.manual !== null &&
        row.confirmed !== row.manual,
    )
  )
    warnings.push(
      "Ручные оценки сохранены в калькуляторе; для подтверждённых работ планировщик использует свежие оценки Moodle.",
    );
  const risk = !scholarshipPossible
    ? "impossible"
    : !hasEvidence || realistic.finalScore === null
      ? "unknown"
      : realistic.finalScore < config.threshold ||
          bounds.attestationWarnings.length ||
          attestationChecks.some((check) => check.matches === false)
        ? "at_risk"
        : realistic.finalScore < Math.max(75, config.threshold)
          ? "narrow"
          : "safe";
  return {
    ...base,
    minimum: bounds.minimumFinal,
    maximum: bounds.maximumFinal,
    requiredAverage: bounds.requiredAverage,
    targetPossible: bounds.targetPossible,
    scholarshipPossible,
    risk,
    confirmedCount: known.length,
    evidence: rows,
    scenarios,
    actions,
    attestationChecks,
    warnings: [...warnings, ...bounds.attestationWarnings],
  };
}

export function calculateScholarshipDashboard(
  courses: ScholarshipCourseInput[],
  records: StudyGradeEvidence[],
  options: Parameters<typeof calculateScholarshipCourse>[2] = {},
) {
  const plans = courses.map((course) =>
    calculateScholarshipCourse(course, records, options),
  );
  const relevant = plans.filter((plan) => plan.included);
  const rank = { impossible: 0, at_risk: 1, unknown: 2, narrow: 3, safe: 4 };
  return {
    courses: [...plans].sort(
      (a, b) =>
        rank[a.risk] - rank[b.risk] ||
        (a.risk === "unknown"
          ? 0
          : (a.scenarios?.realistic.finalScore ?? 100) -
            (b.scenarios?.realistic.finalScore ?? 100)) ||
        a.title.localeCompare(b.title),
    ),
    relevantCount: relevant.length,
    impossibleCount: relevant.filter((plan) => plan.risk === "impossible")
      .length,
    atRiskCount: relevant.filter((plan) => plan.risk === "at_risk").length,
    narrowCount: relevant.filter((plan) => plan.risk === "narrow").length,
    unknownCount: relevant.filter((plan) => plan.risk === "unknown").length,
    numericallyPossible:
      relevant.length > 0 &&
      relevant.every((plan) => plan.scholarshipPossible === true)
        ? true
        : relevant.some((plan) => plan.scholarshipPossible === false)
          ? false
          : null,
    priorities: relevant
      .filter((plan) => plan.scholarshipPossible !== false)
      .flatMap((plan) => plan.actions)
      .sort(
        (a, b) =>
          b.priority - a.priority || a.courseTitle.localeCompare(b.courseTitle),
      )
      .slice(0, 10),
  };
}

export function scholarshipConfigsMatch(
  a: ScholarshipConfig | null,
  b: ScholarshipConfig | null,
): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : object(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** A literal "all remaining assignments" replaces conflicting hypotheses, never verified grades. */
export function withScholarshipAssignmentAssumption(
  config: ScholarshipConfig,
  id: ScholarshipScenarioId,
  rows: ScholarshipEvidenceRow[],
  score: number,
): ScholarshipConfig {
  if (!percent(score)) throw new RangeError("Invalid assignment assumption");
  const scenario = config.scenarios[id];
  const pending = rows.filter(
    (row) => row.kind === "assignment" && row.confirmed === null,
  );
  const periodTotals = { ...scenario.periodTotals };
  for (const row of pending)
    if (row.period !== "exam") periodTotals[row.period] = null;
  return {
    ...config,
    scenarios: {
      ...config.scenarios,
      [id]: {
        ...scenario,
        defaults: { ...scenario.defaults, assignment: score },
        overrides: {
          ...scenario.overrides,
          ...Object.fromEntries(pending.map((row) => [row.id, score])),
        },
        periodTotals,
      },
    },
  };
}
