/** Verified LMS facts and explicit consent; no session, credential or AI authority. */
export interface AcademicGradePolicyReview {
  version: 1;
  externalCourseKey: string;
  definitionKey: string;
  bindingsKey: string;
  contextKey: string;
  reviewedAt: string;
  sourceRef: string;
  supportedPolicy: "linear-30-30-40";
}

export interface GradeChangeEvent {
  id: string;
  courseId: string | null;
  courseTitle: string;
  itemTitle: string;
  kind: "posted" | "corrected";
  observedAt: string;
  oldScore: number | null;
  oldMaxScore: number | null;
  newScore: number;
  newMaxScore: number | null;
  moodleCourseId: string;
  moodleItemId: string;
  sourceUrl: string | null;
}

export interface EligibleAcademicDeadline {
  key: string;
  courseId: string | null;
  courseTitle: string | null;
  title: string;
  kind: "assignment" | "quiz";
  dueAt: string;
  sourceUrl: string | null;
  lastSuccessfulSyncAt: string;
}

export interface AcademicIntelligencePreferencesInput {
  gradeAlertsEnabled: boolean;
  assignmentAlertsEnabled: boolean;
  quizAlertsEnabled: boolean;
  assignmentOffsetsMinutes: number[];
  quizOffsetsMinutes: number[];
  quietStart: string;
  quietEnd: string;
}

export interface AcademicIntelligencePreferences extends AcademicIntelligencePreferencesInput {
  revision: number;
  /** Existing concierge revision: assignment consent and quiet hours stay shared. */
  academicRevision: number;
  courseReviews: Record<string, AcademicGradePolicyReview>;
}

export interface GradeEventFeed {
  events: GradeChangeEvent[];
  eligibleDeadlines: EligibleAcademicDeadline[];
  preferences: AcademicIntelligencePreferences;
  lms: {
    configured: boolean;
    stale: boolean;
    lastSuccessfulSyncAt: string | null;
    state: string;
  };
  truncated: boolean;
  deliveryEnabled?: boolean;
}

export const SUGGESTED_ACADEMIC_DEADLINE_OFFSETS = [4320, 1440] as const;
export const OPTIONAL_URGENT_ACADEMIC_DEADLINE_OFFSET = 180;

export class AcademicIntelligenceInputError extends Error {
  readonly code = "academic_intelligence_invalid_input";
  constructor() {
    super("Review the academic settings and try again.");
    this.name = "AcademicIntelligenceInputError";
  }
}

export function academicIntelligenceObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AcademicIntelligenceInputError();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key))) throw new AcademicIntelligenceInputError();
  return object;
}

export function academicIntelligenceRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2147483647)
    throw new AcademicIntelligenceInputError();
  return value as number;
}

export function parseAcademicIntelligencePreferences(value: unknown): AcademicIntelligencePreferencesInput {
  const input = academicIntelligenceObject(value, ["gradeAlertsEnabled", "assignmentAlertsEnabled", "quizAlertsEnabled", "assignmentOffsetsMinutes", "quizOffsetsMinutes", "quietStart", "quietEnd"]);
  const boolean = (key: string): boolean => {
    if (typeof input[key] !== "boolean") throw new AcademicIntelligenceInputError();
    return input[key] as boolean;
  };
  const offsets = (key: string): number[] => {
    const values = input[key];
    if (!Array.isArray(values) || values.length < 1 || values.length > 6 || new Set(values).size !== values.length
      || values.some((v) => !Number.isSafeInteger(v) || v < 1 || v > 10080)) throw new AcademicIntelligenceInputError();
    return [...values].sort((a, b) => b - a);
  };
  const clock = (key: string): string => {
    const value = input[key];
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new AcademicIntelligenceInputError();
    return value;
  };
  return { gradeAlertsEnabled: boolean("gradeAlertsEnabled"), assignmentAlertsEnabled: boolean("assignmentAlertsEnabled"),
    quizAlertsEnabled: boolean("quizAlertsEnabled"), assignmentOffsetsMinutes: offsets("assignmentOffsetsMinutes"),
    quizOffsetsMinutes: offsets("quizOffsetsMinutes"), quietStart: clock("quietStart"), quietEnd: clock("quietEnd") };
}

export function safeAcademicMoodleUrl(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\/lms\.astanait\.edu\.kz\/(?:course\/view|mod\/(?:assign|quiz)\/view)\.php\?id=[1-9]\d{0,11}$/.test(value) ? value : null;
}
