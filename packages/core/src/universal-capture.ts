/** Universal capture contracts. Pure validation/planning only; no I/O or authority from text. */
import {
  assistantToolPermission,
  containsAssistantCredentials,
  isAssistantDate,
  parseAssistantToolCall,
  validateAssistantMemoryContent,
  type AssistantMemoryCategory,
  type AssistantToolCall,
} from "./assistant.js";
import {
  assistantLocalDate,
  assistantLocalInstant,
  addAssistantDays,
  routeAssistantIntent,
} from "./assistant-router.js";
import {
  IDEAL_HUMAN_START,
  IDEAL_HUMAN_END,
  IDEAL_HUMAN_TIMEZONE,
  parseIdealHumanDay,
  parseStoredIdealHumanDay,
  type IdealHumanDay,
} from "./ideal-human.js";

export const CAPTURE_ACTION_KINDS = [
  "task.create",
  "task.update",
  "task.complete",
  "reminder.create",
  "planning.suggest",
  "study.record",
  "learning.note",
  "meal.record",
  "water.log",
  "workout.note",
  "reflection.add",
  "filming.idea",
  "note.save",
  "question.read",
  "memory.remember",
  "memory.update",
  "memory.archive",
  "memory.delete",
] as const;
export type CaptureActionKind = (typeof CAPTURE_ACTION_KINDS)[number];
export type CaptureSource = "telegram" | "tma" | "web" | "legacy";
export type CaptureInputType = "text" | "voice" | "link";
export type CaptureState =
  | "queued"
  | "processing"
  | "awaiting_transcript"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";
export type CaptureActionStatus =
  | "pending"
  | "needs_input"
  | "succeeded"
  | "conflict"
  | "cancelled";
export type CaptureActionOrigin = "deterministic" | "model" | "edited";
export type CaptureActionArgs = {
  "task.create": { title: string; notes: string; dueAt: string | null };
  "task.update": {
    taskId: string | null;
    expectedUpdatedAt: string | null;
    title: string;
    notes?: string;
    dueAt?: string | null;
  };
  "task.complete": {
    taskId: string | null;
    expectedUpdatedAt: string | null;
    title: string;
  };
  "reminder.create": { title: string; remindAt: string | null };
  "planning.suggest": {
    date: string;
    title: string;
    notes: string;
    time: string | null;
  };
  "study.record": {
    date: string;
    topic: string;
    minutes: number | null;
    notes: string;
    category: "programming" | "english" | "cybersecurity" | "science" | "other";
    completed: boolean | null;
  };
  "learning.note": { date: string; topic: string; content: string };
  "meal.record": {
    date: string;
    label: string;
    caloriesKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    mealTime: string | null;
    portion: string;
    estimated: boolean;
  };
  "water.log": { amountMl: number | null };
  "workout.note": { date: string; content: string };
  "reflection.add": { date: string; content: string };
  "filming.idea": { date: string; content: string };
  "note.save": { title: string; content: string };
  "question.read": { text: string; tool: AssistantToolCall | null };
  "memory.remember": {
    key: string;
    category: AssistantMemoryCategory;
    content: string;
  };
  "memory.update": {
    key: string;
    category: AssistantMemoryCategory;
    content: string;
  };
  "memory.archive": { key: string };
  "memory.delete": { key: string };
};
export type CaptureActionPayload = {
  [K in CaptureActionKind]: { kind: K; args: CaptureActionArgs[K] };
}[CaptureActionKind];
export type CaptureProposal = CaptureActionPayload & {
  id: string;
  origin: CaptureActionOrigin;
  summary: string;
  missingFields: string[];
};
export type CaptureActionView = CaptureProposal & {
  status: CaptureActionStatus;
  resultSummary: string | null;
  completedAt: string | null;
};
export interface CaptureContextView {
  date: string;
  timezone: string;
  warnings: string[];
  commitments: Array<{ title: string; startsAt: string; endsAt: string }>;
  deadlines: Array<{ title: string; dueAt: string | null }>;
  suggestedOrder: string[];
  scheduleKnown: boolean;
  preferences?: string[];
}
export interface CaptureView {
  id: string;
  inputType: CaptureInputType;
  source: CaptureSource;
  sourceLabel: string;
  text: string;
  transcript: string | null;
  state: CaptureState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  expiresAt: string | null;
  reviewExpiresAt: string | null;
  errorCode: string | null;
  actions: CaptureActionView[];
  context?: CaptureContextView;
}
export interface CaptureSearchInput {
  query: string;
  state?: CaptureState;
  includeArchived: boolean;
  cursor?: { createdAt: string; id: string };
  limit: number;
}
export interface CaptureSearchResult {
  captures: CaptureView[];
  nextCursor: { createdAt: string; id: string } | null;
}
export interface CaptureCapabilities {
  enabled: boolean;
  text: boolean;
  telegramVoice: boolean;
  transcription: "unavailable" | "configured_unverified";
  transcriptionRequiresConsent: boolean;
  aiExtraction: boolean;
  maxTextLength: number;
  maxVoiceBytes: number;
  maxVoiceSeconds: number;
  memoryDeleteEnabled: boolean;
  actionKinds: CaptureActionKind[];
}
export interface CaptureMemoryView {
  key: string;
  category: AssistantMemoryCategory;
  content: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface CaptureExtractContext {
  now: Date;
  timezone: string;
  date?: string;
}
export interface CaptureIngestRequest {
  requestId: string;
  inputType: CaptureInputType;
  text: string;
  retentionDays: 7 | 30 | 90 | null;
}
export interface CaptureConfirmRequest {
  requestId: string;
  expectedRevision: number;
  actionIds: string[];
  confirmed: true;
}
export interface CaptureEditRequest {
  expectedRevision: number;
  transcript?: string;
  actionId?: string;
  action?: CaptureActionPayload;
}
export class CaptureInputError extends Error {
  constructor(message = "Invalid capture input") {
    super(message);
    this.name = "CaptureInputError";
  }
}
export const CAPTURE_MAX_TEXT = 8000;
export const CAPTURE_MAX_ACTIONS = 16;
export const CAPTURE_REVIEW_TTL_MS = 600_000;
export const CAPTURE_MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const CAPTURE_MAX_VOICE_SECONDS = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_ID = /^[a-z][a-z0-9_-]{0,39}$/;
const REQUEST_ID = /^[A-Za-z0-9:_-]{8,120}$/;
const MEMORY_KEY = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const SOURCES = ["telegram", "tma", "web", "legacy"];
const STATES = [
  "queued",
  "processing",
  "awaiting_transcript",
  "needs_review",
  "completed",
  "failed",
  "cancelled",
];
const ORIGINS = ["deterministic", "model", "edited"];
const ACTION_STATES = [
  "pending",
  "needs_input",
  "succeeded",
  "conflict",
  "cancelled",
];
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new CaptureInputError();
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = [],
): void {
  if (
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    throw new CaptureInputError();
}
function text(value: unknown, maximum: number, minimum = 0): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.trim().length < minimum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    throw new CaptureInputError();
  return value.trim();
}
function safeText(value: unknown, maximum: number, minimum = 0): string {
  const result = text(value, maximum, minimum);
  if (containsAssistantCredentials(result))
    throw new CaptureInputError("Credentials cannot be stored in captures");
  return result;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new CaptureInputError();
  return value;
}
function nullableNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new CaptureInputError();
  return value;
}
function instant(value: unknown, nullable = false): string | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    !isAssistantDate(value.slice(0, 10))
  )
    throw new CaptureInputError();
  // PostgreSQL CAS tokens may have six fractional digits; do not round them to JS milliseconds.
  return value;
}
function date(value: unknown): string {
  if (!isAssistantDate(value)) throw new CaptureInputError();
  return value;
}
function nullableId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID.test(value))
    throw new CaptureInputError();
  return value;
}
function clockTime(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new CaptureInputError();
  return value;
}
function flag(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new CaptureInputError();
  return value;
}
export function captureRecordId(value: unknown): string {
  const id = nullableId(value);
  if (!id) throw new CaptureInputError();
  return id;
}
export function captureExpectedRevision(value: unknown): number {
  return integer(value, 1, 2147483646);
}
export function parseCaptureIngestRequest(raw: unknown): CaptureIngestRequest {
  const v = object(raw);
  keys(
    v,
    ["requestId", "inputType", "text", "retentionDays"],
    ["requestId", "inputType", "text"],
  );
  if (
    typeof v.requestId !== "string" ||
    !REQUEST_ID.test(v.requestId) ||
    !["text", "voice", "link"].includes(String(v.inputType))
  )
    throw new CaptureInputError();
  const body = safeText(
    v.text,
    CAPTURE_MAX_TEXT,
    v.inputType === "voice" ? 0 : 1,
  );
  const retention = v.retentionDays ?? null;
  if (retention !== null && ![7, 30, 90].includes(Number(retention)))
    throw new CaptureInputError();
  if (retention !== null && typeof retention !== "number")
    throw new CaptureInputError();
  if (v.inputType === "link") {
    try {
      const url = new URL(body);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        body.length > 2000
      )
        throw new Error();
    } catch {
      throw new CaptureInputError(
        "Use a complete HTTP or HTTPS link without credentials",
      );
    }
  }
  return {
    requestId: v.requestId,
    inputType: v.inputType as CaptureInputType,
    text: body,
    retentionDays: retention as 7 | 30 | 90 | null,
  };
}
export function parseCaptureSearchInput(raw: unknown): CaptureSearchInput {
  const v = object(raw);
  keys(v, ["query", "state", "includeArchived", "cursor", "limit"]);
  const query = safeText(v.query ?? "", 200);
  if (v.state !== undefined && !STATES.includes(String(v.state)))
    throw new CaptureInputError();
  if (v.includeArchived !== undefined && typeof v.includeArchived !== "boolean")
    throw new CaptureInputError();
  let cursor: CaptureSearchInput["cursor"];
  if (v.cursor != null) {
    const c = object(v.cursor);
    keys(c, ["createdAt", "id"], ["createdAt", "id"]);
    cursor = { createdAt: instant(c.createdAt)!, id: captureRecordId(c.id) };
  }
  return {
    query,
    includeArchived: v.includeArchived === true,
    limit: integer(v.limit ?? 20, 1, 50),
    ...(v.state ? { state: v.state as CaptureState } : {}),
    ...(cursor ? { cursor } : {}),
  };
}
export function parseCaptureConfirmRequest(
  raw: unknown,
): CaptureConfirmRequest {
  const v = object(raw);
  keys(
    v,
    ["requestId", "expectedRevision", "actionIds", "confirmed"],
    ["requestId", "expectedRevision", "actionIds", "confirmed"],
  );
  if (
    v.confirmed !== true ||
    typeof v.requestId !== "string" ||
    !REQUEST_ID.test(v.requestId) ||
    !Array.isArray(v.actionIds) ||
    v.actionIds.length < 1 ||
    v.actionIds.length > CAPTURE_MAX_ACTIONS ||
    v.actionIds.some((id) => typeof id !== "string" || !ACTION_ID.test(id)) ||
    new Set(v.actionIds).size !== v.actionIds.length
  )
    throw new CaptureInputError(
      "Select and explicitly confirm valid pending actions",
    );
  return {
    requestId: v.requestId,
    expectedRevision: captureExpectedRevision(v.expectedRevision),
    actionIds: [...v.actionIds] as string[],
    confirmed: true,
  };
}
export function parseCaptureActionPayload(raw: unknown): CaptureActionPayload {
  const v = object(raw);
  keys(v, ["kind", "args"], ["kind", "args"]);
  if (!CAPTURE_ACTION_KINDS.includes(v.kind as CaptureActionKind))
    throw new CaptureInputError();
  const kind = v.kind as CaptureActionKind,
    a = object(v.args);
  let result: Record<string, unknown>;
  const content = () => safeText(a.content ?? "", 2000);
  if (kind === "task.create") {
    keys(a, ["title", "notes", "dueAt"]);
    result = {
      title: safeText(a.title ?? "", 500),
      notes: safeText(a.notes ?? "", 5000),
      dueAt: instant(a.dueAt, true),
    };
  } else if (kind === "task.update") {
    keys(a, ["taskId", "expectedUpdatedAt", "title", "notes", "dueAt"]);
    result = {
      taskId: nullableId(a.taskId),
      expectedUpdatedAt: instant(a.expectedUpdatedAt, true),
      title: safeText(a.title ?? "", 500),
      ...(Object.hasOwn(a, "notes") ? { notes: safeText(a.notes, 5000) } : {}),
      ...(Object.hasOwn(a, "dueAt") ? { dueAt: instant(a.dueAt, true) } : {}),
    };
  } else if (kind === "task.complete") {
    keys(a, ["taskId", "expectedUpdatedAt", "title"]);
    result = {
      taskId: nullableId(a.taskId),
      expectedUpdatedAt: instant(a.expectedUpdatedAt, true),
      title: safeText(a.title ?? "", 500),
    };
  } else if (kind === "reminder.create") {
    keys(a, ["title", "remindAt"]);
    result = {
      title: safeText(a.title ?? "", 500),
      remindAt: instant(a.remindAt, true),
    };
  } else if (kind === "planning.suggest") {
    keys(a, ["date", "title", "notes", "time"]);
    result = {
      date: date(a.date),
      title: safeText(a.title ?? "", 240),
      notes: safeText(a.notes ?? "", 2000),
      time: clockTime(a.time),
    };
  } else if (kind === "study.record") {
    keys(a, ["date", "topic", "minutes", "notes", "category", "completed"]);
    const category = a.category ?? "other";
    if (
      !["programming", "english", "cybersecurity", "science", "other"].includes(
        String(category),
      )
    )
      throw new CaptureInputError();
    result = {
      date: date(a.date),
      topic: safeText(a.topic ?? "", 240),
      minutes: nullableNumber(a.minutes, 0, 900),
      notes: safeText(a.notes ?? "", 2000),
      category,
      completed: flag(a.completed),
    };
  } else if (kind === "learning.note") {
    keys(a, ["date", "topic", "content"]);
    result = {
      date: date(a.date),
      topic: safeText(a.topic ?? "", 240),
      content: content(),
    };
  } else if (kind === "meal.record") {
    keys(a, [
      "date",
      "label",
      "caloriesKcal",
      "proteinG",
      "fatG",
      "carbsG",
      "mealTime",
      "portion",
      "estimated",
    ]);
    if (a.estimated !== undefined && typeof a.estimated !== "boolean")
      throw new CaptureInputError();
    result = {
      date: date(a.date),
      label: safeText(a.label ?? "", 240),
      caloriesKcal: nullableNumber(a.caloriesKcal, 0, 10000),
      proteinG: nullableNumber(a.proteinG, 0, 400),
      fatG: nullableNumber(a.fatG, 0, 1000),
      carbsG: nullableNumber(a.carbsG, 0, 2000),
      mealTime: clockTime(a.mealTime),
      portion: safeText(a.portion ?? "", 240),
      estimated: a.estimated === true,
    };
  } else if (kind === "water.log") {
    keys(a, ["amountMl"]);
    const amount = nullableNumber(a.amountMl, 1, 5000);
    if (amount !== null && !Number.isInteger(amount))
      throw new CaptureInputError();
    result = { amountMl: amount };
  } else if (
    ["workout.note", "reflection.add", "filming.idea"].includes(kind)
  ) {
    keys(a, ["date", "content"]);
    result = { date: date(a.date), content: content() };
  } else if (kind === "note.save") {
    keys(a, ["title", "content"]);
    result = {
      title: safeText(a.title ?? "", 240),
      content: safeText(a.content ?? "", CAPTURE_MAX_TEXT),
    };
  } else if (kind === "question.read") {
    keys(a, ["text", "tool"]);
    let tool: AssistantToolCall | null = null;
    if (a.tool != null) {
      tool = parseAssistantToolCall(a.tool);
      if (assistantToolPermission(tool.tool) !== "READ")
        throw new CaptureInputError("A question cannot authorize a write tool");
    }
    result = { text: safeText(a.text ?? "", 2000), tool };
  } else {
    const writing = kind === "memory.remember" || kind === "memory.update";
    keys(a, writing ? ["key", "category", "content"] : ["key"]);
    const key = safeText(a.key ?? "", 80);
    if (key && !MEMORY_KEY.test(key)) throw new CaptureInputError();
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new CaptureInputError();
    if (writing) {
      const category = a.category ?? "preference";
      if (
        !["preference", "goal", "constraint", "learning", "fact"].includes(
          String(category),
        )
      )
        throw new CaptureInputError();
      const value = safeText(a.content ?? "", 1000);
      if (value && !validateAssistantMemoryContent(value))
        throw new CaptureInputError(
          "Sensitive credentials and records cannot become assistant memory",
        );
      result = { key, category, content: value };
    } else result = { key };
  }
  return { kind, args: result } as CaptureActionPayload;
}
export function captureActionMissingFields(
  action: CaptureActionPayload,
): string[] {
  const missing: string[] = [];
  const a = action.args as unknown as Record<string, unknown>;
  for (const key of ["title", "content", "topic", "label", "key", "text"])
    if (Object.hasOwn(a, key) && !String(a[key] ?? "").trim())
      missing.push(key);
  if (action.kind === "task.update" || action.kind === "task.complete") {
    if (!action.args.taskId) missing.push("taskId");
    if (!action.args.expectedUpdatedAt) missing.push("expectedUpdatedAt");
  }
  if (action.kind === "reminder.create" && !action.args.remindAt)
    missing.push("remindAt");
  if (action.kind === "water.log" && action.args.amountMl === null)
    missing.push("amountMl");
  if (action.kind === "question.read" && !action.args.tool)
    missing.push("supportedQuestion");
  if (action.kind === "study.record" && action.args.minutes === null)
    missing.push("minutes");
  if (
    Object.hasOwn(a, "date") &&
    (String(a.date) < IDEAL_HUMAN_START || String(a.date) > IDEAL_HUMAN_END)
  )
    missing.push("experimentDate");
  return missing;
}
export function captureActionSummary(action: CaptureActionPayload): string {
  const a = action.args as unknown as Record<string, unknown>;
  const label = String(
    a.title ??
      a.label ??
      a.topic ??
      a.content ??
      a.key ??
      a.text ??
      (a.amountMl === null ? "Water" : `${a.amountMl} ml water`),
  );
  return `${action.kind}: ${label}`.slice(0, 600);
}
export function parseCaptureProposals(
  raw: unknown,
  origin: CaptureActionOrigin = "deterministic",
): CaptureProposal[] {
  if (
    !Array.isArray(raw) ||
    raw.length > CAPTURE_MAX_ACTIONS ||
    !ORIGINS.includes(origin)
  )
    throw new CaptureInputError();
  return raw.map((value, index) => {
    const action = parseCaptureActionPayload(value);
    if (origin === "model" && action.kind === "meal.record")
      action.args.estimated = true;
    return {
      ...action,
      id: `action-${index + 1}`,
      origin,
      summary: captureActionSummary(action),
      missingFields: captureActionMissingFields(action),
    };
  });
}
export function parseCaptureEditRequest(raw: unknown): CaptureEditRequest {
  const v = object(raw);
  keys(
    v,
    ["expectedRevision", "transcript", "actionId", "action"],
    ["expectedRevision"],
  );
  const expectedRevision = captureExpectedRevision(v.expectedRevision);
  if (Object.hasOwn(v, "transcript")) {
    if (Object.hasOwn(v, "actionId") || Object.hasOwn(v, "action"))
      throw new CaptureInputError();
    return {
      expectedRevision,
      transcript: safeText(v.transcript, CAPTURE_MAX_TEXT, 1),
    };
  }
  if (
    typeof v.actionId !== "string" ||
    !ACTION_ID.test(v.actionId) ||
    !Object.hasOwn(v, "action")
  )
    throw new CaptureInputError();
  return {
    expectedRevision,
    actionId: v.actionId,
    action: parseCaptureActionPayload(v.action),
  };
}
/** Formatter deliberately keeps all punctuation/newlines inside one explicit memory command. */
export function captureMemoryCommand(
  action: Extract<
    CaptureActionPayload,
    {
      kind:
        | "memory.remember"
        | "memory.update"
        | "memory.archive"
        | "memory.delete";
    }
  >,
): string {
  const parsed = parseCaptureActionPayload(action);
  if (
    !parsed.kind.startsWith("memory.") ||
    captureActionMissingFields(parsed).length
  )
    throw new CaptureInputError();
  if (parsed.kind === "memory.remember")
    return `remember ${parsed.args.category} ${parsed.args.key}: ${parsed.args.content}`;
  if (parsed.kind === "memory.update")
    return `update memory ${parsed.args.key} ${parsed.args.category}: ${parsed.args.content}`;
  if (parsed.kind === "memory.archive" || parsed.kind === "memory.delete")
    return `${parsed.kind === "memory.archive" ? "archive" : "delete"} memory ${parsed.args.key}`;
  throw new CaptureInputError();
}

function explicitMemory(value: string): CaptureActionPayload | null {
  let m = value.match(
    /^remember\s+(preference|goal|constraint|learning|fact)\s+([a-z0-9][a-z0-9_.-]{0,79}):[ \t]*([\s\S]+)$/u,
  );
  if (m)
    return parseCaptureActionPayload({
      kind: "memory.remember",
      args: { category: m[1], key: m[2], content: m[3] },
    });
  m = value.match(
    /^update memory\s+([a-z0-9][a-z0-9_.-]{0,79})\s+(preference|goal|constraint|learning|fact):[ \t]*([\s\S]+)$/u,
  );
  if (m)
    return parseCaptureActionPayload({
      kind: "memory.update",
      args: { key: m[1], category: m[2], content: m[3] },
    });
  m = value.match(/^(archive|delete) memory\s+([a-z0-9][a-z0-9_.-]{0,79})$/u);
  if (m)
    return parseCaptureActionPayload({
      kind: m[1] === "archive" ? "memory.archive" : "memory.delete",
      args: { key: m[2] },
    });
  return null;
}
const AUTHORITY_INJECTION =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s*prompt|developer\s*(?:message|instruction)|игнорируй\s+(?:все\s+)?(?:предыдущ|инструкц)|обойди\s+(?:защит|огранич)|<\/?(?:system|assistant|tool)|\b(?:execute|run)\s+(?:sql|shell|bash)|\b(?:DROP\s+TABLE|DELETE\s+FROM)\b)/iu;
/** Deterministic extraction creates reviewable data, never authorizes a write. */
export function extractCaptureActions(
  raw: string,
  context: CaptureExtractContext,
): CaptureProposal[] {
  const input = safeText(raw, CAPTURE_MAX_TEXT, 1),
    normalized = input.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const memory = explicitMemory(normalized);
  if (memory) return parseCaptureProposals([memory]);
  if (AUTHORITY_INJECTION.test(normalized))
    throw new CaptureInputError(
      "Untrusted instructions cannot grant permissions or execute commands",
    );
  const today = assistantLocalDate(context.now, context.timezone);
  const requestedDate = context.date ? date(context.date) : today;
  const targetDate = /\b(?:tomorrow)\b|завтра/iu.test(normalized)
    ? addAssistantDays(today, 1)
    : requestedDate;
  const pieces = normalized
    .split(
      /(?:\r?\n|;|[.!?](?=\s+[A-ZА-ЯЁ])|,\s+(?:and|и)\s+|\s+(?:and|и)\s+(?=(?:remind|add|create|log|record|save|напомни|добавь|запиши|создай)))/u,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  if (pieces.length > CAPTURE_MAX_ACTIONS)
    throw new CaptureInputError("Use at most sixteen actions in one capture");
  const actions: CaptureActionPayload[] = [];
  for (const piece of pieces) {
    const cleaned = piece
      .replace(/^(?:and|и)\s+/iu, "")
      .replace(/[.!?]+$/u, "")
      .trim();
    if (!cleaned) continue;
    let routed: AssistantToolCall | null = null;
    try {
      routed = routeAssistantIntent(cleaned, { ...context, date: targetDate });
    } catch {
      /* Incomplete explicit requests stay editable below. */
    }
    if (routed) {
      if (assistantToolPermission(routed.tool) === "READ") {
        actions.push(
          parseCaptureActionPayload({
            kind: "question.read",
            args: { text: cleaned, tool: routed },
          }),
        );
        continue;
      }
      if (routed.tool === "reminders.create") {
        actions.push(
          parseCaptureActionPayload({
            kind: "reminder.create",
            args: routed.args,
          }),
        );
        continue;
      }
      if (routed.tool.startsWith("memory.")) {
        actions.push(
          parseCaptureActionPayload({
            kind: routed.tool,
            args: { ...routed.args, key: routed.args.key ?? "" },
          }),
        );
        continue;
      }
    }
    let m: RegExpMatchArray | null;
    if (
      (m = cleaned.match(
        /^(?:remind\s+me|create\s+(?:a\s+)?reminder|напомни|создай\s+напоминание)\s*:?\s*(?:to\s+)?(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "reminder.create",
          args: { title: m[1], remindAt: null },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:complete\s+(?:the\s+)?task|finish\s+(?:the\s+)?task|mark\s+task\s+done|заверши\s+задачу|выполнил\s+задачу)\s*:?\s*(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "task.complete",
          args: { title: m[1], taskId: null, expectedUpdatedAt: null },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:update\s+(?:the\s+)?task|edit\s+(?:the\s+)?task|обнови\s+задачу|измени\s+задачу)\s*:?\s*(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "task.update",
          args: { title: m[1], taskId: null, expectedUpdatedAt: null },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:add\s+(?:a\s+)?task|create\s+(?:a\s+)?task|task|задача|добавь\s+задачу|создай\s+задачу)\s*:?\s*(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "task.create",
          args: { title: m[1], notes: "", dueAt: null },
        }),
      );
      continue;
    }
    if (
      /^(?:log\s+water|water|i\s+drank|drank|вода|выпил|выпила|запиши\s+воду)(?=$|[\s:])/iu.test(
        cleaned,
      )
    ) {
      const amount = cleaned.match(
        /(?:^|\s)(\d{1,4}(?:[.,]\d{1,3})?)\s*(ml|мл|l|литр(?:а|ов)?)(?=$|[\s.,!?])/iu,
      );
      let ml: number | null = null;
      if (amount)
        ml =
          Number(amount[1].replace(",", ".")) *
          (/^(?:l|литр)/iu.test(amount[2]) ? 1000 : 1);
      actions.push(
        parseCaptureActionPayload({
          kind: "water.log",
          args: { amountMl: ml },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:record\s+study|studied|i\s+studied|учился|училась|занимался|занималась)\s*:?\s*(.+)$/iu,
      ))
    ) {
      const amount = m[1].match(
        /(?:^|\s)(\d{1,3})\s*(?:minutes?|mins?|минут(?:ы|у)?|мин)(?=$|[\s.,!?])/iu,
      );
      actions.push(
        parseCaptureActionPayload({
          kind: "study.record",
          args: {
            date: targetDate,
            topic: m[1]
              .replace(
                /\s*\d{1,3}\s*(?:minutes?|mins?|минут(?:ы|у)?|мин)(?=$|[\s.,!?])/iu,
                "",
              )
              .trim(),
            minutes: amount ? Number(amount[1]) : null,
            category: "other",
            notes: "",
            completed:
              /^(?:studied|i\s+studied|учился|училась|занимался|занималась)/iu.test(
                cleaned,
              )
                ? true
                : null,
          },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:learning\s+note|learned|i\s+learned|учебная\s+заметка|заметка\s+по\s+уч[её]бе|узнал|узнала)\s*:?\s*(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "learning.note",
          args: { date: targetDate, topic: m[1].slice(0, 240), content: m[1] },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:meal|i\s+ate|ate|съел|съела|при[её]м\s+пищи)\s*:?\s*(.+)$/iu,
      ))
    ) {
      const kcal = m[1].match(
        /(?:^|\s)(\d{1,5})\s*(?:kcal|calories|ккал)(?=$|[\s.,!?])/iu,
      );
      actions.push(
        parseCaptureActionPayload({
          kind: "meal.record",
          args: {
            date: targetDate,
            label: m[1]
              .replace(
                /\s*\d{1,5}\s*(?:kcal|calories|ккал)(?=$|[\s.,!?])/iu,
                "",
              )
              .trim(),
            caloriesKcal: kcal ? Number(kcal[1]) : null,
            proteinG: null,
            fatG: null,
            carbsG: null,
            mealTime: null,
            portion: "",
            estimated: false,
          },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:workout\s+note|training\s+note|заметка\s+(?:о\s+)?тренировк[еи]|после\s+тренировки)\s*:?\s*(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "workout.note",
          args: { date: targetDate, content: m[1] },
        }),
      );
      continue;
    }
    if (
      (m = cleaned.match(
        /^(?:reflection|evening\s+reflection|рефлексия|вечерняя\s+рефлексия)\s*:?\s*(.+)$/iu,
      ))
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "reflection.add",
          args: { date: targetDate, content: m[1] },
        }),
      );
      continue;
    }
    if (
      /\b(?:film|filming|shoot|documentary|documentary\s+idea)\b|снять|съ[её]м|документаль/iu.test(
        cleaned,
      )
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "filming.idea",
          args: { date: targetDate, content: cleaned },
        }),
      );
      continue;
    }
    if (
      /\b(?:classes|university|timetable)\b|пары|занятия\s+в\s+университете/iu.test(
        cleaned,
      ) &&
      !/(?:gym|зал|трениров)/iu.test(cleaned)
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "question.read",
          args: {
            text: cleaned,
            tool: {
              tool: targetDate === today ? "classes.today" : "classes.tomorrow",
              args: {},
            },
          },
        }),
      );
      continue;
    }
    if (
      /\b(?:want\s+to|should|need\s+to|plan\s+to|after\s+classes|planning\s+suggestion)\b|хочу|планирую|после\s+пар|предложи\s+план/iu.test(
        cleaned,
      )
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "planning.suggest",
          args: {
            date: targetDate,
            title: cleaned.slice(0, 240),
            notes: cleaned,
            time: null,
          },
        }),
      );
      continue;
    }
    if (
      /^(?:what|which|when|how|show|ask|какие|когда|как|покажи|вопрос)\b/iu.test(
        cleaned,
      )
    ) {
      actions.push(
        parseCaptureActionPayload({
          kind: "question.read",
          args: { text: cleaned, tool: null },
        }),
      );
      continue;
    }
    const note = cleaned.replace(
      /^(?:save\s+(?:a\s+)?note|note|сохрани\s+заметку|заметка)\s*:?\s*/iu,
      "",
    );
    actions.push(
      parseCaptureActionPayload({
        kind: "note.save",
        args: { title: note.slice(0, 240), content: note },
      }),
    );
  }
  // Experiment dates have one fixed timezone even when a profile travels.
  // Task/reminder/READ routing above retains the authenticated profile timezone.
  const journalToday = assistantLocalDate(context.now, IDEAL_HUMAN_TIMEZONE);
  const journalDate = /\b(?:tomorrow)\b|завтра/iu.test(normalized)
    ? addAssistantDays(journalToday, 1)
    : context.date
      ? date(context.date)
      : journalToday;
  return parseCaptureProposals(
    actions.map((action) =>
      isCaptureJournalAction(action)
        ? { ...action, args: { ...action.args, date: journalDate } }
        : action,
    ),
  );
}

export function isCaptureJournalAction(action: CaptureActionPayload): boolean {
  return [
    "planning.suggest",
    "study.record",
    "learning.note",
    "meal.record",
    "workout.note",
    "reflection.add",
    "filming.idea",
  ].includes(action.kind);
}
/** Merge one reviewed observation/plan into a FULL existing validated day. No completion inference. */
export function applyCaptureJournalAction(
  input: IdealHumanDay,
  action: CaptureActionPayload,
  stableId: string,
  origin: CaptureActionOrigin = "deterministic",
): IdealHumanDay {
  // This helper receives an owned stored day or a server-created empty template,
  // never a client replacement. Validate empty templates without inventing facts.
  const day = parseStoredIdealHumanDay({
    ...input,
    revision: Math.max(1, input.revision),
  });
  day.revision = input.revision;
  const parsed = parseCaptureActionPayload(action);
  if (
    !isCaptureJournalAction(parsed) ||
    captureActionMissingFields(parsed).length
  )
    throw new CaptureInputError(
      "Complete a valid experiment action before approval",
    );
  const a = parsed.args as unknown as Record<string, unknown>;
  if (a.date !== day.date || !/^[A-Za-z0-9_-]{1,80}$/.test(stableId))
    throw new CaptureInputError();
  const append = (existing: string, addition: string) =>
    [existing, addition].filter(Boolean).join("\n");
  if (parsed.kind === "study.record")
    day.learningSessions.push({
      id: stableId,
      category: parsed.args.category,
      topic: parsed.args.topic,
      minutes: parsed.args.minutes,
      resource: "",
      notes: parsed.args.notes,
      completed: parsed.args.completed,
    });
  else if (parsed.kind === "learning.note")
    day.learningSessions.push({
      id: stableId,
      category: "other",
      topic: parsed.args.topic,
      minutes: null,
      resource: "",
      notes: parsed.args.content,
      completed: null,
    });
  else if (parsed.kind === "meal.record") {
    const { date: _date, ...meal } = parsed.args;
    day.meals.push({
      id: stableId,
      ...meal,
      estimated: origin === "model" || meal.estimated,
      ...(origin !== "model" ? { analysisSource: "manual" as const } : {}),
      corrected: origin === "edited",
    });
  } else if (parsed.kind === "workout.note")
    day.workoutNotes = append(day.workoutNotes, parsed.args.content);
  else if (parsed.kind === "reflection.add")
    day.notes = append(day.notes, parsed.args.content);
  else if (parsed.kind === "filming.idea")
    day.storyboard = append(day.storyboard ?? "", parsed.args.content);
  else if (parsed.kind === "planning.suggest")
    day.plan.push({
      id: stableId,
      title: parsed.args.title,
      notes: parsed.args.notes,
      time: parsed.args.time,
      kind: "flexible",
      tasks: [],
    });
  return parseIdealHumanDay(day);
}

export function parseCaptureView(raw: unknown): CaptureView {
  const v = object(raw);
  keys(
    v,
    [
      "id",
      "inputType",
      "source",
      "sourceLabel",
      "text",
      "transcript",
      "state",
      "revision",
      "createdAt",
      "updatedAt",
      "archivedAt",
      "expiresAt",
      "reviewExpiresAt",
      "errorCode",
      "actions",
      "context",
    ],
    [
      "id",
      "inputType",
      "source",
      "sourceLabel",
      "text",
      "transcript",
      "state",
      "revision",
      "createdAt",
      "updatedAt",
      "archivedAt",
      "expiresAt",
      "reviewExpiresAt",
      "errorCode",
      "actions",
    ],
  );
  if (
    !["text", "voice", "link"].includes(String(v.inputType)) ||
    !SOURCES.includes(String(v.source)) ||
    !STATES.includes(String(v.state)) ||
    !Array.isArray(v.actions) ||
    v.actions.length > CAPTURE_MAX_ACTIONS
  )
    throw new CaptureInputError();
  const actions = v.actions.map((rawAction) => {
    const a = object(rawAction);
    keys(
      a,
      [
        "id",
        "kind",
        "args",
        "origin",
        "summary",
        "missingFields",
        "status",
        "resultSummary",
        "completedAt",
      ],
      [
        "id",
        "kind",
        "args",
        "origin",
        "summary",
        "missingFields",
        "status",
        "resultSummary",
        "completedAt",
      ],
    );
    if (
      typeof a.id !== "string" ||
      !ACTION_ID.test(a.id) ||
      !ORIGINS.includes(String(a.origin)) ||
      !ACTION_STATES.includes(String(a.status)) ||
      !Array.isArray(a.missingFields) ||
      a.missingFields.some(
        (f) => typeof f !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(f),
      )
    )
      throw new CaptureInputError();
    const action = parseCaptureActionPayload({ kind: a.kind, args: a.args });
    return {
      ...action,
      id: a.id,
      origin: a.origin as CaptureActionOrigin,
      summary: safeText(a.summary, 600),
      missingFields: [...a.missingFields] as string[],
      status: a.status as CaptureActionStatus,
      resultSummary:
        a.resultSummary === null ? null : text(a.resultSummary, 8000),
      completedAt: instant(a.completedAt, true),
    };
  });
  if (new Set(actions.map((a) => a.id)).size !== actions.length)
    throw new CaptureInputError();
  const result: CaptureView = {
    id: captureRecordId(v.id),
    inputType: v.inputType as CaptureInputType,
    source: v.source as CaptureSource,
    sourceLabel: text(v.sourceLabel, 80),
    text: text(v.text, CAPTURE_MAX_TEXT),
    transcript:
      v.transcript === null ? null : text(v.transcript, CAPTURE_MAX_TEXT),
    state: v.state as CaptureState,
    revision: captureExpectedRevision(v.revision),
    createdAt: instant(v.createdAt)!,
    updatedAt: instant(v.updatedAt)!,
    archivedAt: instant(v.archivedAt, true),
    expiresAt: instant(v.expiresAt, true),
    reviewExpiresAt: instant(v.reviewExpiresAt, true),
    errorCode: v.errorCode === null ? null : text(v.errorCode, 100),
    actions,
  };
  if (v.context !== undefined) {
    const c = object(v.context);
    keys(
      c,
      [
        "date",
        "timezone",
        "warnings",
        "commitments",
        "deadlines",
        "suggestedOrder",
        "scheduleKnown",
        "preferences",
      ],
      [
        "date",
        "timezone",
        "warnings",
        "commitments",
        "deadlines",
        "suggestedOrder",
        "scheduleKnown",
      ],
    );
    const timezone = text(c.timezone, 100, 1);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new CaptureInputError();
    }
    const strings = (value: unknown, max: number) => {
      if (!Array.isArray(value) || value.length > 50)
        throw new CaptureInputError();
      return value.map((s) => text(s, max));
    };
    if (
      typeof c.scheduleKnown !== "boolean" ||
      !Array.isArray(c.commitments) ||
      c.commitments.length > 50 ||
      !Array.isArray(c.deadlines) ||
      c.deadlines.length > 50
    )
      throw new CaptureInputError();
    result.context = {
      date: date(c.date),
      timezone,
      warnings: strings(c.warnings, 1000),
      suggestedOrder: strings(c.suggestedOrder, 500),
      scheduleKnown: c.scheduleKnown,
      commitments: c.commitments.map((v) => {
        const e = object(v);
        keys(
          e,
          ["title", "startsAt", "endsAt"],
          ["title", "startsAt", "endsAt"],
        );
        return {
          title: text(e.title, 500),
          startsAt: instant(e.startsAt)!,
          endsAt: instant(e.endsAt)!,
        };
      }),
      deadlines: c.deadlines.map((v) => {
        const e = object(v);
        keys(e, ["title", "dueAt"], ["title", "dueAt"]);
        return { title: text(e.title, 500), dueAt: instant(e.dueAt, true) };
      }),
      ...(c.preferences === undefined
        ? {}
        : { preferences: strings(c.preferences, 1000) }),
    };
  }
  return result;
}
