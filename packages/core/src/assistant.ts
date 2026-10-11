/** Public, pure contracts for the bounded LifeOS assistant. */
export const ASSISTANT_TOOL_NAMES = [
  "classes.today",
  "classes.tomorrow",
  "classes.next",
  "study.deadlines",
  "study.grades",
  "study.changes",
  "study.forecast",
  "productivity.tasks",
  "productivity.reminders",
  "productivity.calendar",
  "productivity.availability",
  "reminders.create",
  "memory.list",
  "memory.search",
  "memory.remember",
  "memory.update",
  "memory.archive",
  "memory.delete",
] as const;
export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];
export type AssistantPermissionClass =
  | "READ"
  | "WRITE"
  | "SENSITIVE"
  | "DESTRUCTIVE";
export type AssistantMemoryCategory =
  | "preference"
  | "goal"
  | "constraint"
  | "learning"
  | "fact";
export interface AssistantToolCall {
  tool: AssistantToolName;
  args: Record<string, unknown>;
}
export interface AssistantRoutingContext {
  now: Date;
  timezone: string;
  date?: string;
}
export interface AssistantToolOutput {
  text: string;
  sources: Array<{ name: string; updatedAt: string | null }>;
}

const CATEGORIES: readonly string[] = [
  "preference",
  "goal",
  "constraint",
  "learning",
  "fact",
];
const OBJECT_KEYS_DENIED = new Set(["__proto__", "prototype", "constructor"]);
export function assistantToolPermission(
  tool: AssistantToolName,
): AssistantPermissionClass {
  if (tool === "memory.delete") return "DESTRUCTIVE";
  if (
    [
      "reminders.create",
      "memory.remember",
      "memory.update",
      "memory.archive",
    ].includes(tool)
  )
    return "WRITE";
  return "READ";
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function requireKeys(
  value: Record<string, unknown>,
  allowed: string[],
  required: string[] = [],
): void {
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Invalid assistant fields");
  }
}
function boundedText(
  value: unknown,
  maximum: number,
  minimum = 1,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}
function numberIn(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
export function isAssistantDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}
export function isAssistantInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
}
export function containsAssistantCredentials(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return (
    /(?:\b(?:password|passwd|passphrase|pin|otp|2fa|mfa|seed[ _-]?phrase|recovery[ _-]?(?:code|phrase)|authentication[ _-]?code|cookie|cookies|bearer|authorization|access[ _-]?token|refresh[ _-]?token|api[ _-]?key|private[ _-]?key|service[ _-]?role|session[ _-]?(?:id|key|token)|secret|token)\b|парол[\p{L}]*|пин[ -]?код|код\s+(?:подтверждения|аутентификации|восстановления)|сид[ -]?фраз|куки|токен[\p{L}]*|секретн[\p{L}]*\s+ключ|-----BEGIN[^\n]*PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{12,}|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|https?:\/\/[^\s/]+:[^\s]+@|\b\d{6,}:[a-zA-Z0-9_-]{20,})/iu.test(
      normalized,
    ) ||
    /\b(?:AIza[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sb_secret_[a-zA-Z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/u.test(
      normalized,
    )
  );
}
export function containsAssistantSensitiveMemory(text: string): boolean {
  return (
    containsAssistantCredentials(text) ||
    /(?:\b(?:diagnos(?:is|ed)|medical record|bank account|card number|credit card|cvv|ssn|passport|health data|salary)\b|диагноз|медицинск|номер\s+(?:карт|сч[её]т|паспорт)|банковск|зарплат|баланс\s+сч[её]та|\b(?:\d[ -]?){13,19}\b)/iu.test(
      text,
    )
  );
}
export function validateAssistantMemoryContent(
  value: unknown,
): value is string {
  return boundedText(value, 1000) && !containsAssistantSensitiveMemory(value);
}
function validKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9_.-]{0,79}$/u.test(value) &&
    !OBJECT_KEYS_DENIED.has(value.toLowerCase()) &&
    !containsAssistantCredentials(value)
  );
}

/** Reject unknown properties so a model cannot smuggle identity or authorization. */
export function parseAssistantToolCall(value: unknown): AssistantToolCall {
  if (!record(value)) throw new Error("Invalid assistant tool call");
  requireKeys(value, ["tool", "args"], ["tool", "args"]);
  if (
    typeof value.tool !== "string" ||
    !(ASSISTANT_TOOL_NAMES as readonly string[]).includes(value.tool) ||
    !record(value.args)
  )
    throw new Error("Invalid assistant tool call");
  const tool = value.tool as AssistantToolName;
  const args = value.args;
  let allowed: string[] = [];
  let required: string[] = [];
  if (
    [
      "study.deadlines",
      "study.grades",
      "study.changes",
      "productivity.tasks",
      "productivity.reminders",
      "memory.list",
    ].includes(tool)
  )
    allowed = ["limit"];
  if (tool === "study.grades") allowed.push("course");
  if (tool === "memory.list") allowed.push("includeArchived");
  if (tool === "study.forecast") {
    allowed = ["course", "target"];
    required = ["course"];
  }
  if (tool === "productivity.calendar") allowed = ["date", "limit"];
  if (tool === "productivity.availability") {
    allowed = ["date", "startTime", "endTime", "durationMinutes"];
    required = ["date", "durationMinutes"];
  }
  if (tool === "reminders.create") {
    allowed = ["title", "remindAt"];
    required = allowed;
  }
  if (tool === "memory.search") {
    allowed = ["query", "limit"];
    required = ["query"];
  }
  if (["memory.remember", "memory.update"].includes(tool)) {
    allowed = ["key", "category", "content"];
    required = tool === "memory.update" ? allowed : ["category", "content"];
  }
  if (["memory.archive", "memory.delete"].includes(tool)) {
    allowed = ["key"];
    required = allowed;
  }
  requireKeys(args, allowed, required);
  if (
    Object.hasOwn(args, "includeArchived") &&
    typeof args.includeArchived !== "boolean"
  )
    throw new Error("Invalid archive filter");
  if (
    Object.hasOwn(args, "limit") &&
    (!numberIn(args.limit, 1, 50) || !Number.isInteger(args.limit))
  )
    throw new Error("Invalid assistant limit");
  if (Object.hasOwn(args, "course") && !boundedText(args.course, 200))
    throw new Error("Invalid course");
  if (Object.hasOwn(args, "target") && !numberIn(args.target, 0, 100))
    throw new Error("Invalid target");
  if (Object.hasOwn(args, "date") && !isAssistantDate(args.date))
    throw new Error("Invalid date");
  for (const name of ["startTime", "endTime"])
    if (
      Object.hasOwn(args, name) &&
      (typeof args[name] !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(args[name] as string))
    )
      throw new Error("Invalid time");
  if (
    typeof args.startTime === "string" &&
    typeof args.endTime === "string" &&
    args.startTime >= args.endTime
  )
    throw new Error("Invalid time window");
  if (
    Object.hasOwn(args, "durationMinutes") &&
    (!numberIn(args.durationMinutes, 5, 720) ||
      !Number.isInteger(args.durationMinutes))
  )
    throw new Error("Invalid duration");
  if (
    Object.hasOwn(args, "title") &&
    (!boundedText(args.title, 500) ||
      containsAssistantCredentials(args.title as string))
  )
    throw new Error("Invalid reminder title");
  if (Object.hasOwn(args, "remindAt") && !isAssistantInstant(args.remindAt))
    throw new Error("Invalid reminder instant");
  if (
    Object.hasOwn(args, "query") &&
    (!boundedText(args.query, 200) ||
      containsAssistantCredentials(args.query as string))
  )
    throw new Error("Invalid search");
  if (Object.hasOwn(args, "key") && !validKey(args.key))
    throw new Error("Invalid memory key");
  if (
    Object.hasOwn(args, "category") &&
    !CATEGORIES.includes(String(args.category))
  )
    throw new Error("Invalid memory category");
  if (
    Object.hasOwn(args, "content") &&
    !validateAssistantMemoryContent(args.content)
  )
    throw new Error("Sensitive or invalid memory content");
  return { tool, args: { ...args } };
}

/** Tool adapters explicitly construct this display envelope, then validate it. */
export function validateAssistantToolOutput(
  value: unknown,
): AssistantToolOutput {
  if (!record(value)) throw new Error("Invalid assistant output");
  requireKeys(value, ["text", "sources"], ["text", "sources"]);
  if (!boundedText(value.text, 14000))
    throw new Error("Invalid assistant response text");
  if (!Array.isArray(value.sources) || value.sources.length > 10)
    throw new Error("Invalid assistant sources");
  for (const source of value.sources) {
    if (!record(source)) throw new Error("Invalid assistant source");
    requireKeys(source, ["name", "updatedAt"], ["name", "updatedAt"]);
    if (
      !boundedText(source.name, 100) ||
      (source.updatedAt !== null && !isAssistantInstant(source.updatedAt))
    )
      throw new Error("Invalid assistant source");
  }
  return value as unknown as AssistantToolOutput;
}
export const parseAssistantToolOutput = validateAssistantToolOutput;
/** Gate external AI requests more broadly than persistent memory validation. */
export function containsAssistantSensitiveData(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return (
    containsAssistantSensitiveMemory(normalized) ||
    /\b(?:health|medical|medications?|doctor|therapy|diagnos(?:is|es)|blood|sleep|heart|hrv|spo2|calories|weight|glucose|diabet(?:es|ic)|pulse|cholesterol|symptoms?|allerg(?:y|ies)|metformin|finance|bank|salary|balance|budget|payment|invoice|receipt|expense|loan|debt|transaction|insulin|prescription|rent|mortgage|transfer|savings)\b|здоров|финанс|врач|лекарств|банк|оплат|зарплат|баланс|калори|давлен|диагноз|медицин|плат[её]ж|инсулин|транзакц|расход|доход|перевод\s+денег|(?<![\p{L}\p{N}])(?:вес(?:а|е|ом)?|пульс[\p{L}]*|глюкоз[\p{L}]*|сатурац[\p{L}]*|кров(?:ь|и|ью)|сахар[\p{L}]*|диабет[\p{L}]*|аллерги[\p{L}]*|сон|сна|сне|сном)(?![\p{L}\p{N}])/iu.test(
      normalized,
    )
  );
}
