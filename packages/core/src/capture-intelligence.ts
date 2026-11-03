/** Bounded multilingual proposal analysis. Pure data only: never authorizes an action. */
import { containsAssistantCredentials, isAssistantDate } from "./assistant.js";
import {
  addAssistantDays,
  assistantLocalDate,
  assistantLocalInstant,
} from "./assistant-router.js";
import { IDEAL_HUMAN_TIMEZONE } from "./ideal-human.js";
import {
  CAPTURE_MAX_TEXT,
  CAPTURE_MAX_ACTIONS,
  CaptureInputError,
  captureExpectedRevision,
  captureActionSummary,
  extractCaptureClause,
  isCaptureJournalAction,
  parseCaptureActionPayload,
  parseCaptureProposals,
  type CaptureActionPayload,
  type CaptureActionView,
  type CaptureExtractContext,
  type CaptureLanguage,
  type CaptureProposal,
  type CaptureProposalPresentation,
} from "./universal-capture.js";

export interface CaptureAnalysis {
  language: CaptureLanguage;
  proposals: CaptureProposal[];
  warnings: string[];
}
export interface CaptureCorrectionRequest {
  expectedRevision: number;
  instruction: string;
}
export interface CaptureCorrectionPlan {
  expectedRevision: number;
  updates: {
    actionId: string;
    action: CaptureActionPayload;
    presentation: CaptureProposalPresentation;
  }[];
  cancelActionIds: string[];
  warnings: string[];
}
const LANGUAGES = ["ru", "kk", "en", "mixed", "und"];
const INJECTION =
  /ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s*prompt|developer\s*(?:message|instruction)|игнорируй\s+(?:все\s+)?(?:предыдущ|инструкц)|обойди\s+(?:защит|огранич)|<\/?(?:system|assistant|tool)|\b(?:execute|run)\s+(?:sql|shell|bash)|\b(?:DROP\s+TABLE|DELETE\s+FROM)\b/iu;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CaptureInputError();
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  allowed: string[],
  required = allowed,
) {
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw new CaptureInputError();
}
function bounded(value: unknown, max: number, min = 0): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    value.trim().length < min ||
    containsAssistantCredentials(value)
  )
    throw new CaptureInputError();
  return value.trim();
}
function safeInput(value: unknown, max = CAPTURE_MAX_TEXT): string {
  const text = bounded(value, max, 1)
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "");
  if (INJECTION.test(text))
    throw new CaptureInputError(
      "Untrusted instructions cannot grant permissions or execute commands",
    );
  return text;
}
function nullable(value: unknown, max: number): string | null {
  return value === null ? null : bounded(value, max, 1);
}
function timezone(value: unknown): string {
  const result = bounded(value, 100, 1);
  try {
    new Intl.DateTimeFormat("en", { timeZone: result });
  } catch {
    throw new CaptureInputError();
  }
  return result;
}
export function parseCapturePresentation(
  raw: unknown,
): CaptureProposalPresentation {
  const v = object(raw);
  exact(v, [
    "title",
    "description",
    "suggestedDate",
    "timeHint",
    "relation",
    "language",
    "evidence",
    "warnings",
    "timezone",
    "dateBasis",
  ]);
  if (
    !LANGUAGES.includes(String(v.language)) ||
    !["user_statement", "recommendation"].includes(String(v.evidence)) ||
    !["profile", "ideal_human"].includes(String(v.dateBasis)) ||
    !Array.isArray(v.warnings) ||
    v.warnings.length > 8 ||
    (v.suggestedDate !== null &&
      (typeof v.suggestedDate !== "string" ||
        !isAssistantDate(v.suggestedDate)))
  )
    throw new CaptureInputError();
  return {
    title: bounded(v.title, 240, 1),
    description: nullable(v.description, 2000),
    suggestedDate: v.suggestedDate as string | null,
    timeHint: nullable(v.timeHint, 120),
    relation: nullable(v.relation, 240),
    language: v.language as CaptureLanguage,
    evidence: v.evidence as CaptureProposalPresentation["evidence"],
    warnings: v.warnings.map((w) => bounded(w, 240, 1)),
    timezone: timezone(v.timezone),
    dateBasis: v.dateBasis as CaptureProposalPresentation["dateBasis"],
  };
}
export function identifyCaptureLanguage(text: string): CaptureLanguage {
  const kk =
    /[әғқңөұүһі]|(?:^|\s)(?:ертең|бүгін|сосын|керек|кейін|тапсырма\S*|бітіру|түсіру)(?=$|\s|[,.!?])/iu.test(
      text,
    );
  const ru =
    /[а-яё]/iu.test(text) &&
    (!kk ||
      /(?:^|\s)(?:после|завтра|сегодня|потом|снять|съ[её]м\S*|нужно|хочу|законч\S*|напомни)(?=$|\s|[,.!?])/iu.test(
        text,
      ));
  // Course/product names do not turn an otherwise Russian/Kazakh clause into English.
  const en =
    /(?:^|\s)(?:tomorrow|today|finish|film|go|gym|remind|study|after|want|should|note|reflection|meal|water)(?=$|\s|[,.!?])/iu.test(
      text,
    );
  if (Number(kk) + Number(ru) + Number(en) > 1) return "mixed";
  return kk ? "kk" : ru ? "ru" : en ? "en" : "und";
}
const DAY_WORDS =
  /(?:^|[^\p{L}\p{N}_])(послезавтра|бүрсігүні|day after tomorrow|tomorrow|завтра|ертең|today|сегодня|бүгін)(?=$|[^\p{L}\p{N}_])/iu;
const WEEKDAYS = [
  /(?:понедельник\S*|monday|дүйсенбі\S*)/iu,
  /(?:вторник\S*|tuesday|сейсенбі\S*)/iu,
  /(?:сред[ауеы]|wednesday|сәрсенбі\S*)/iu,
  /(?:четверг\S*|thursday|бейсенбі\S*)/iu,
  /(?:пятниц[ауеы]|friday|жұма(?:да|ға)?)/iu,
  /(?:суббот[ауеы]|saturday|сенбі(?:де|ге)?)/iu,
  /(?:воскресень[ея]|sunday|жексенбі\S*)/iu,
];
function localDateHint(
  text: string,
  context: CaptureExtractContext,
  zone: string,
): string | null {
  const today = assistantLocalDate(context.now, zone);
  // A negated date never wins over its explicit replacement.
  const positive = text.replace(
    /(?:не|not|емес)\s+(?:завтра|сегодня|tomorrow|today|ертең|бүгін)/giu,
    "",
  );
  const iso = positive.match(/(?:^|[^\d])(\d{4}-\d\d-\d\d)(?=$|[^\d])/u)?.[1];
  if (iso) {
    if (!isAssistantDate(iso))
      throw new CaptureInputError("Invalid suggested date");
    return iso;
  }
  const relative = positive.match(DAY_WORDS)?.[1]?.toLowerCase();
  if (relative)
    return addAssistantDays(
      today,
      /послезавтра|бүрсігүні|day after tomorrow/u.test(relative)
        ? 2
        : /tomorrow|завтра|ертең/u.test(relative)
          ? 1
          : 0,
    );
  const weekday = WEEKDAYS.findIndex((pattern) =>
    new RegExp(
      "(?:^|[^\\p{L}])" + pattern.source + "(?=$|[^\\p{L}])",
      "iu",
    ).test(positive),
  );
  if (weekday >= 0) {
    const current = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const delta = (weekday - current + 7) % 7;
    return addAssistantDays(
      today,
      delta + (/next\s+|следующ|келесі/iu.test(positive) ? 7 : 0),
    );
  }
  return null;
}
function stripHints(text: string): string {
  return text
    .replace(
      /(?:^|\s)(?:послезавтра|бүрсігүні|tomorrow|завтра|ертең|today|сегодня|бүгін|вечером|утром|дн[её]м|кешке|таңертең|evening|morning|afternoon)(?=$|\s|[,.:])/giu,
      " ",
    )
    .replace(
      /\b(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu,
      " ",
    )
    .replace(
      /(?:^|\s)(?:в\s+)?(?:пятниц[ауеы]|сред[ауеы]|понедельник\S*|вторник\S*|четверг\S*|суббот[ауеы]|воскресень[ея]|жұма(?:да|ға)?)(?=$|\s|[,.:])/giu,
      " ",
    )
    .replace(/(?:^|\s)\d{4}-\d\d-\d\d(?=$|\s|[,.:])/gu, " ")
    .trim();
}
function relationHint(text: string): string | null {
  return (
    text.match(
      /(?:после\s+(?:университета|универа|пар|занятий)|сабақтан\s+кейін|университеттен\s+кейін|after\s+(?:university|classes|class|school))/iu,
    )?.[0] ?? null
  );
}
function timeHint(text: string): string | null {
  return (
    text.match(
      /вечер(?:ом)?|утром|дн[её]м|кешке|таңертең|evening|morning|afternoon|(?:[01]\d|2[0-3]):[0-5]\d/iu,
    )?.[0] ?? null
  );
}
function cleanClause(text: string): string {
  return stripHints(text)
    .replace(/^(?:(?:and|then|и|потом|сосын|және|одан\s+кейін)\s+)+/iu, "")
    .replace(
      /^(?:после\s+(?:университета|универа|пар|занятий)|сабақтан\s+кейін|университеттен\s+кейін|after\s+(?:university|classes|class|school))[,\s]*/iu,
      "",
    )
    .replace(
      /^(?:(?:мне\s+)?(?:нужно|надо|хочу|планирую)|i\s+(?:want\s+to|need\s+to|should|plan\s+to))\s+/iu,
      "",
    )
    .replace(/\s+керек$/iu, "")
    .replace(/^[,:\s]+|[.!?,;:\s]+$/gu, "")
    .replace(/\s+/gu, " ");
}
const START =
  /^(?:(?:finish|complete|do|go|film|shoot|record|save|add|create|remind|log|water|meal|reflection|learning|workout|training|note|task|studied|learned|remember|update|archive|delete)\b|законч\S*|сдела\S*|закры\S*|подготов\S*|потрен\S*|тренир\S*|зал(?:ға|а)?(?:\s|$)|купить|напомни|снять|съ[её]м\S*|записать|влог|вид[ео]\S*|кадр\S*|задач\S*|вода|выпил\S*|съел\S*|рефлекси\S*|заметк\S*|DBMS\b|OOP\b|IELTS\b|ДЗ(?:\s|$)|домашк\S*|тапсырма\S*)/iu;
function canStart(text: string): boolean {
  return (
    START.test(cleanClause(text)) ||
    /^(?:what|which|when|how|show|какие|когда|как|покажи|i have|у меня|ертең сабақ)/iu.test(
      cleanClause(text),
    )
  );
}
function hasObject(text: string): boolean {
  const value = cleanClause(text).replace(
    /^(?:remind\s+me\s+(?:to\s+)?|напомни\s+|i\s+want\s+to\s*|хочу\s*)/iu,
    "",
  );
  return (
    value.length > 2 && !/^(?:finish|go|film|снять|закончить|to)$/iu.test(value)
  );
}
function clauses(text: string): string[] {
  const protectedText: string[] = [];
  const masked = text.replace(
    /https?:\/\/[^\s]+|"[^"\n]*"|«[^»\n]*»|“[^”\n]*”/giu,
    (quote) => {
      protectedText.push(quote);
      return `⟦${protectedText.length - 1}⟧`;
    },
  );
  const boundary =
    /\r?\n+|;|[.!?](?=\s)|,\s*|\s+(?:and|и|және|then|потом|сосын|одан\s+кейін)\s+/giu;
  const result: string[] = [];
  let current = "",
    cursor = 0;
  for (const match of masked.matchAll(boundary)) {
    current += masked.slice(cursor, match.index);
    const rest = masked.slice(match.index! + match[0].length);
    const hard = /[\n;]/u.test(match[0]);
    if (current.trim() && (hard || (hasObject(current) && canStart(rest)))) {
      result.push(current.trim());
      current = "";
    } else current += match[0];
    cursor = match.index! + match[0].length;
  }
  current += masked.slice(cursor);
  if (current.trim()) result.push(current.trim());
  const restore = (value: string) =>
    value.replace(
      /⟦(\d+)⟧/gu,
      (_, index: string) => protectedText[Number(index)] ?? "",
    );
  const expanded: string[] = [];
  for (const part of result) {
    let start = 0;
    const implicit =
      /\s+(?=(?:go\s+(?:to\s+)?(?:the\s+)?gym\b|film\b|finish\b|законч(?:ить)?\s+|снять\s+|потренироваться(?=$|\s)|залға\s+|влог\s+түсіру))/giu;
    for (const match of part.matchAll(implicit)) {
      const before = part.slice(start, match.index);
      if (canStart(before) && hasObject(before)) {
        expanded.push(restore(before.trim()));
        start = match.index! + match[0].length;
      }
    }
    expanded.push(restore(part.slice(start).trim()));
  }
  if (expanded.length > CAPTURE_MAX_ACTIONS)
    throw new CaptureInputError("Use at most sixteen actions in one capture");
  return expanded.filter(Boolean);
}
function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : text;
}
function titleFor(text: string): string {
  return capitalize(
    cleanClause(text)
      .replace(/^законч(?=\s)/iu, "закончить")
      .replace(/^закрыть(?=\s)/iu, "закончить")
      .replace(/\s+(?:бітіру|аяқтау)\s+керек$/iu, " бітіру"),
  );
}
function taskNotes(
  notes: string,
  date: string | null,
  relation: string | null,
  language: CaptureLanguage,
): string {
  const clean = notes
    .replace(
      /^(?:Suggested date|Планируемая дата|Ұсынылған күн): \d{4}-\d\d-\d\d\n?/gmu,
      "",
    )
    .trim();
  const prefix =
    language === "en"
      ? "Suggested date"
      : language === "kk"
        ? "Ұсынылған күн"
        : "Планируемая дата";
  return [
    clean,
    date ? `${prefix}: ${date}` : "",
    relation && !clean.toLowerCase().includes(relation.toLowerCase())
      ? relation
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
function legacyPayload(
  text: string,
  context: CaptureExtractContext,
): CaptureActionPayload {
  const proposal = extractCaptureClause(text, context)[0];
  if (!proposal) throw new CaptureInputError();
  return parseCaptureActionPayload({
    kind: proposal.kind,
    args: proposal.args,
  });
}
function payloadFor(
  text: string,
  context: CaptureExtractContext,
  date: string,
): CaptureActionPayload {
  const clean = cleanClause(text),
    relation = relationHint(text);
  if (
    /^(?:remind\s+me|напомни|create\s+(?:a\s+)?reminder|создай\s+напоминание|remember|запомни|update\s+memory|archive\s+memory|delete\s+memory)/iu.test(
      text.trim(),
    )
  )
    return legacyPayload(text, context);
  if (/^(?:https?:\/\/|note\b|заметка(?=$|\s)|сохрани\s+заметку)/iu.test(clean))
    return parseCaptureActionPayload({
      kind: "note.save",
      args: { title: clean.slice(0, 240), content: clean },
    });
  const existingTask =
    /^(?:complete\s+(?:the\s+)?task|finish\s+(?:the\s+)?task|mark\s+task|заверши\s+задачу|выполнил\s+задачу|update\s+(?:the\s+)?task|edit\s+(?:the\s+)?task|обнови\s+задачу|измени\s+задачу)/iu.test(
      clean,
    );
  if (existingTask) return legacyPayload(clean, context);
  const gym =
    /(?:\bgym\b|(?:^|\s)зал(?:ға|а)?(?=$|\s)|потренир|трениров|жаттығ)/iu.test(
      clean,
    );
  if (
    gym &&
    !/^(?:workout\s+note|training\s+note|заметка|после\s+тренировки)/iu.test(
      clean,
    )
  ) {
    const title = /потренир/iu.test(clean)
      ? `Потренироваться${relation ? ` ${relation}` : ""}`
      : titleFor(clean) + (relation ? ` ${relation}` : "");
    return parseCaptureActionPayload({
      kind: "planning.suggest",
      args: { date, title: title.slice(0, 240), notes: text, time: null },
    });
  }
  const filming =
    /(?:\b(?:film|filming|shoot|documentary)\b|снять|съ[её]м|түсіру)/iu.test(
      clean,
    ) &&
    !/(?:снять\s+(?:квартиру|комнату|дом|деньги|ограничени)|shoot\s+(?:an?\s+)?email)/iu.test(
      clean,
    );
  if (filming)
    return parseCaptureActionPayload({
      kind: "filming.idea",
      args: { date, content: titleFor(clean) },
    });
  const academic =
    /^(?:finish\b|do\b|законч\S*|сдела\S*|закры\S*|подготов\S*|купить(?=$|\s))/iu.test(
      clean,
    ) || /^(?:DBMS|OOP|IELTS|ДЗ|домашк\S*|тапсырма\S*)/iu.test(clean);
  if (academic)
    return parseCaptureActionPayload({
      kind: "task.create",
      args: { title: titleFor(clean).slice(0, 240), notes: "", dueAt: null },
    });
  // Legacy explicit action grammars remain authoritative for water/meals/notes/etc.
  if (
    /(?:снять\s+(?:квартиру|комнату|дом|деньги|ограничени)|shoot\s+(?:an?\s+)?email)/iu.test(
      clean,
    )
  )
    return parseCaptureActionPayload({
      kind: "task.create",
      args: { title: titleFor(clean).slice(0, 240), notes: "", dueAt: null },
    });
  return legacyPayload(text, context);
}
function present(
  action: CaptureActionPayload,
  text: string,
  context: CaptureExtractContext,
  inherited: string | null,
): CaptureProposalPresentation {
  const journal = isCaptureJournalAction(action),
    zone = journal ? IDEAL_HUMAN_TIMEZONE : context.timezone;
  const language = identifyCaptureLanguage(text),
    relation = relationHint(text),
    hint = timeHint(text);
  const date =
    localDateHint(text, context, zone) ??
    (inherited ? localDateHint(inherited, context, zone) : null);
  const args = action.args as unknown as Record<string, unknown>;
  const title = String(
    args.title ??
      args.label ??
      args.topic ??
      args.content ??
      args.key ??
      args.text ??
      (args.amountMl == null ? "Water" : `${args.amountMl} ml water`),
  ).slice(0, 240);
  return parseCapturePresentation({
    title,
    description: relation || hint ? text.slice(0, 2000) : null,
    suggestedDate: date ?? (journal ? String(args.date) : null),
    timeHint: hint,
    relation,
    language,
    evidence: "user_statement",
    warnings: relation
      ? ["Точное время занятий не подтверждено; время не назначено."]
      : [],
    timezone: zone,
    dateBasis: journal ? "ideal_human" : "profile",
  });
}
/** Recompute display metadata from a newly edited payload; never copy stale hints. */
export function buildCapturePresentation(
  action: CaptureActionPayload,
  context: CaptureExtractContext,
): CaptureProposalPresentation {
  const parsed = parseCaptureActionPayload(action);
  const args = parsed.args as unknown as Record<string, unknown>;
  const source = [args.title, args.topic, args.content, args.notes, args.label]
    .filter((value) => typeof value === "string")
    .join("\n");
  const presentation = present(
    parsed,
    source || captureActionSummary(parsed),
    context,
    null,
  );
  if (isCaptureJournalAction(parsed))
    presentation.suggestedDate = String(args.date);
  return presentation;
}
export function analyzeCaptureText(
  raw: string,
  context: CaptureExtractContext,
): CaptureAnalysis {
  const text = safeInput(raw).replace(
    /^(?:брат|бро|bro|бауырым|досым|эй|hey)[,!:]\s*/iu,
    "",
  );
  timezone(context.timezone);
  if (
    !Number.isFinite(context.now.getTime()) ||
    (context.date !== undefined && !isAssistantDate(context.date))
  )
    throw new CaptureInputError();
  const language = identifyCaptureLanguage(text);
  // Explicit memory content stays one unit even when it contains clause-like text.
  if (
    /^(?:remember|запомни|update\s+memory|archive\s+memory|delete\s+memory|обнови\s+память|архивируй\s+память|удали\s+память)(?=$|\s|:)/iu.test(
      text,
    )
  ) {
    const proposals = extractCaptureClause(text, context).map((p) => ({
      ...p,
      presentation: present(p, text, context, null),
    }));
    return { language, proposals, warnings: [] };
  }
  const parts = clauses(text),
    prefix =
      text.match(
        /^(?:послезавтра|бүрсігүні|tomorrow|завтра|ертең|today|сегодня|бүгін)(?=$|[^\p{L}\p{N}_])/iu,
      )?.[0] ?? null;
  const payloads: CaptureActionPayload[] = [],
    presentations: CaptureProposalPresentation[] = [];
  for (const part of parts) {
    const zone = IDEAL_HUMAN_TIMEZONE,
      date =
        localDateHint(part, context, zone) ??
        (prefix ? localDateHint(prefix, context, zone) : null) ??
        context.date ??
        assistantLocalDate(context.now, zone);
    let action = payloadFor(part, context, date);
    if (!action) continue;
    if (isCaptureJournalAction(action))
      action = parseCaptureActionPayload({
        kind: action.kind,
        args: { ...action.args, date },
      });
    const presentation = present(action, part, context, prefix);
    if (action.kind === "task.create")
      action = parseCaptureActionPayload({
        kind: action.kind,
        args: {
          ...action.args,
          notes: taskNotes(
            action.args.notes,
            presentation.suggestedDate,
            presentation.relation,
            presentation.language,
          ),
        },
      });
    payloads.push(action);
    presentations.push(presentation);
  }
  const proposals = parseCaptureProposals(payloads).map((proposal, index) => ({
    ...proposal,
    presentation: presentations[index],
  }));
  return { language, proposals, warnings: [] };
}
function payloadKey(action: CaptureActionPayload): string {
  const typed = parseCaptureActionPayload({
    kind: action.kind,
    args: action.args,
  });
  return JSON.stringify(typed, (_key, value: unknown) =>
    typeof value === "string"
      ? value
          .normalize("NFKC")
          .replace(/\p{Cf}/gu, "")
          .replace(/\s+/gu, " ")
          .trim()
          .toLowerCase()
      : value,
  );
}
function intentText(action: CaptureActionPayload): string {
  const args = action.args as unknown as Record<string, unknown>;
  return String(
    args.title ?? args.topic ?? args.label ?? args.content ?? args.text ?? "",
  )
    .normalize("NFKC")
    .toLowerCase();
}
function coversKnownIntent(
  rule: CaptureProposal,
  candidate: CaptureProposal,
): boolean {
  if (rule.kind !== candidate.kind || candidate.missingFields.length > 0)
    return false;
  if (payloadKey(rule) === payloadKey(candidate)) return true;
  if (rule.kind === "water.log" && candidate.kind === "water.log")
    return rule.args.amountMl === candidate.args.amountMl;
  const source = intentText(rule),
    result = intentText(candidate);
  const importantNames =
    intentText(rule).match(/\b(?:dbms|oop|ielts|ideal\s+human)\b/giu) ?? [];
  if (importantNames.some((name) => !result.includes(name))) return false;
  const candidateNames =
    result.match(/\b(?:dbms|oop|ielts|ideal\s+human)\b/giu) ?? [];
  if (candidateNames.some((name) => !source.includes(name))) return false;
  if (importantNames.length > 0) return true;
  if (
    /тренир|трениров|\bgym\b|(?:^|\s)зал|жаттығ/iu.test(source) &&
    /тренир|трениров|\bgym\b|(?:^|\s)зал|жаттығ/iu.test(result)
  )
    return true;
  if (rule.kind === "filming.idea")
    return /снять|съ[её]м|влог|видео|film|vlog|түсіру/iu.test(result);
  const stop =
    /^(?:finish|complete|create|task|add|plan|study|want|need|should|tomorrow|today|after|the|and|законч\p{L}*|сдела\p{L}*|задач\p{L}*|нужно|надо|после|завтра|сегодня|ертең|бүгін)$/iu;
  const anchors =
    source
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length > 2 && !stop.test(token)) ?? [];
  return anchors.some((token) => result.includes(token));
}
export function parseCaptureModelExtraction(
  raw: unknown,
  context: CaptureExtractContext,
): CaptureAnalysis {
  let decoded: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 65536) throw new CaptureInputError();
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new CaptureInputError("Invalid model JSON");
    }
  }
  const root = object(decoded);
  exact(root, ["actions"]);
  if (
    JSON.stringify(root).length > 65536 ||
    !Array.isArray(root.actions) ||
    root.actions.length > CAPTURE_MAX_ACTIONS
  )
    throw new CaptureInputError();
  const presentations: CaptureProposalPresentation[] = [];
  const payloads = root.actions.map((value) => {
    const entry = object(value);
    exact(entry, ["kind", "args", "presentation"], ["kind", "args"]);
    let action = parseCaptureActionPayload({
      kind: entry.kind,
      args: entry.args,
    });
    if (action.kind === "question.read" && action.args.tool !== null)
      throw new CaptureInputError(
        "Model output cannot select executable tools",
      );
    if (INJECTION.test(JSON.stringify(action))) throw new CaptureInputError();
    const source =
      context.sourceText === undefined ? "" : safeInput(context.sourceText);
    const explicitTime =
      source.match(/(?:^|[^\d])((?:[01]\d|2[0-3]):[0-5]\d)(?=$|[^\d])/u)?.[1] ??
      null;
    const sourceDate =
      localDateHint(source, context, context.timezone) ?? context.date ?? null;
    const supportsInstant = (instant: string | null) => {
      if (!instant || !source) return false;
      if (source.includes(instant)) return true;
      return !!(
        explicitTime &&
        sourceDate &&
        Date.parse(
          assistantLocalInstant(sourceDate, explicitTime, context.timezone),
        ) === Date.parse(instant)
      );
    };
    if (action.kind === "task.create" && !supportsInstant(action.args.dueAt))
      action = { ...action, args: { ...action.args, dueAt: null } };
    if (action.kind === "task.update" || action.kind === "task.complete")
      action = {
        ...action,
        args: { ...action.args, taskId: null, expectedUpdatedAt: null },
      };
    if (
      action.kind === "reminder.create" &&
      !supportsInstant(action.args.remindAt)
    )
      action = { ...action, args: { ...action.args, remindAt: null } };
    if (action.kind.startsWith("memory."))
      throw new CaptureInputError(
        "Explicit memory commands use deterministic parsing, not model output",
      );
    const journalToday = assistantLocalDate(context.now, IDEAL_HUMAN_TIMEZONE);
    const journalDate =
      localDateHint(source, context, IDEAL_HUMAN_TIMEZONE) ??
      context.date ??
      journalToday;
    const futureIntent =
      journalDate > journalToday ||
      /(?:will\s+(?:study|train|work\s*out)|want\s+to|хочу|планирую|нужно\s+(?:потрен|учить|изучить)|керек|барамын)/iu.test(
        source,
      );
    if (
      futureIntent &&
      (action.kind === "workout.note" || action.kind === "study.record")
    ) {
      const title =
        action.kind === "study.record"
          ? `Изучить ${action.args.topic}`
          : "Запланировать тренировку";
      action = parseCaptureActionPayload({
        kind: "planning.suggest",
        args: {
          date: journalDate,
          title: title.slice(0, 240),
          notes: source.slice(0, 2000),
          time: null,
        },
      });
    }
    if (isCaptureJournalAction(action))
      action = parseCaptureActionPayload({
        kind: action.kind,
        args: {
          ...action.args,
          date: journalDate,
        },
      });
    if (action.kind === "planning.suggest" && action.args.time !== explicitTime)
      action = { ...action, args: { ...action.args, time: null } };
    if (action.kind === "study.record") {
      const past =
        /(?:studied|учился|училась|занимался|занималась|оқыдым|оқыдық)/iu.test(
          source,
        ) &&
        !/(?:tomorrow|завтра|ертең|планирую|will\s+study|не\s+(?:учил|занимал)|(?:not|never|haven.t|didn.t)\s+stud)/iu.test(
          source,
        );
      const minutes = action.args.minutes;
      const quantity =
        minutes !== null &&
        new RegExp(
          `(?:^|[^0-9])${minutes}\\s*(?:minutes?|mins?|минут|мин|минуты)(?=$|[^\\p{L}])`,
          "iu",
        ).test(source);
      action = {
        ...action,
        args: {
          ...action.args,
          completed: past ? action.args.completed : null,
          minutes: quantity ? minutes : null,
        },
      };
    }
    if (action.kind === "meal.record") {
      const args = { ...action.args, estimated: true };
      const units = {
        caloriesKcal: "kcal|calories|ккал",
        proteinG: "protein|белк\\p{L}*|ақуыз",
        fatG: "fat|жир\\p{L}*|май",
        carbsG: "carbs?|углевод\\p{L}*|көмірсу",
      };
      for (const field of [
        "caloriesKcal",
        "proteinG",
        "fatG",
        "carbsG",
      ] as const) {
        const amount = args[field];
        if (
          amount === null ||
          !new RegExp(
            `(?:^|[^0-9])${amount}(?:[.,]0+)?\\s*(?:g\\s*|г\\s*)?(?:${units[field]})(?=$|[^\\p{L}])`,
            "iu",
          ).test(source)
        )
          args[field] = null;
      }
      if (args.mealTime !== explicitTime) args.mealTime = null;
      if (
        args.portion &&
        !source.toLowerCase().includes(args.portion.toLowerCase())
      )
        args.portion = "";
      action = { ...action, args };
    }
    if (action.kind === "water.log") {
      const quantities = [
        ...source.matchAll(
          /(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*(ml|мл|l|литр\p{L}*)(?=$|[^\p{L}])/giu,
        ),
      ].map(
        (m) =>
          Number(m[1].replace(",", ".")) *
          (/^(?:l|литр)/iu.test(m[2]) ? 1000 : 1),
      );
      if (!quantities.includes(action.args.amountMl ?? -1))
        action = { ...action, args: { amountMl: null } };
    }
    const presentation =
      entry.presentation === undefined
        ? present(action, captureActionSummary(action), context, null)
        : parseCapturePresentation(entry.presentation);
    presentation.title = buildCapturePresentation(action, context).title;
    presentation.language = identifyCaptureLanguage(
      source || intentText(action),
    );
    presentation.evidence = "recommendation";
    presentation.timezone = isCaptureJournalAction(action)
      ? IDEAL_HUMAN_TIMEZONE
      : context.timezone;
    presentation.dateBasis = isCaptureJournalAction(action)
      ? "ideal_human"
      : "profile";
    presentation.suggestedDate = isCaptureJournalAction(action)
      ? String((action.args as unknown as Record<string, unknown>).date)
      : localDateHint(source, context, context.timezone);
    presentation.timeHint = timeHint(source);
    presentation.relation = relationHint(source);
    if (action.kind === "task.create")
      action = parseCaptureActionPayload({
        kind: action.kind,
        args: {
          ...action.args,
          notes: taskNotes(
            action.args.notes,
            presentation.suggestedDate,
            presentation.relation,
            presentation.language,
          ),
        },
      });
    presentation.warnings = [
      ...new Set([
        "Предложено моделью; проверьте по исходному тексту.",
        ...presentation.warnings,
      ]),
    ].slice(0, 8);
    presentations.push(presentation);
    return action;
  });
  const rules =
    context.sourceText === undefined
      ? []
      : analyzeCaptureText(context.sourceText, context).proposals;
  const sourceCounts = new Map<string, number>();
  for (const rule of rules) {
    const key = payloadKey(rule);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const retained: CaptureActionPayload[] = [],
    retainedPresentations: CaptureProposalPresentation[] = [];
  const seen = new Map<string, number>();
  let duplicates = 0;
  for (const [index, payload] of payloads.entries()) {
    const key = payloadKey(payload),
      count = seen.get(key) ?? 0;
    if (count >= Math.max(1, sourceCounts.get(key) ?? 0)) {
      duplicates++;
      continue;
    }
    seen.set(key, count + 1);
    retained.push(payload);
    retainedPresentations.push(presentations[index]);
  }
  const warnings =
    duplicates > 0 ? ["Повторяющиеся предложения объединены."] : [];
  if (duplicates > 0 && retainedPresentations[0])
    retainedPresentations[0].warnings = [
      "Предложено моделью; проверьте по исходному тексту.",
      ...warnings,
      ...retainedPresentations[0].warnings,
    ]
      .filter((warning, index, all) => all.indexOf(warning) === index)
      .slice(0, 8);
  const proposals = parseCaptureProposals(retained, "model").map(
    (p, index) => ({ ...p, presentation: retainedPresentations[index] }),
  );
  const known = rules.filter(
    (rule) => rule.kind !== "note.save" && rule.missingFields.length === 0,
  );
  if (known.length >= 2) {
    const matched = new Set<number>();
    for (const rule of known) {
      const index = proposals.findIndex(
        (candidate, candidateIndex) =>
          !matched.has(candidateIndex) && coversKnownIntent(rule, candidate),
      );
      if (index < 0)
        throw new CaptureInputError(
          "Model output omitted an independently recognized source intention",
        );
      matched.add(index);
    }
  }
  const languages = new Set(
    retainedPresentations.map((p) => p.language).filter((l) => l !== "und"),
  );
  return {
    language: languages.size > 1 ? "mixed" : ([...languages][0] ?? "und"),
    proposals,
    warnings,
  };
}
export function parseCaptureCorrectionRequest(
  raw: unknown,
): CaptureCorrectionRequest {
  const v = object(raw);
  exact(v, ["expectedRevision", "instruction"]);
  return {
    expectedRevision: captureExpectedRevision(v.expectedRevision),
    instruction: safeInput(v.instruction, 1000),
  };
}
export function planCaptureCorrection(
  instruction: string,
  capture: { revision: number; actions: CaptureActionView[] },
  context: CaptureExtractContext,
): CaptureCorrectionPlan {
  const text = safeInput(instruction, 1000),
    result: CaptureCorrectionPlan = {
      expectedRevision: captureExpectedRevision(capture.revision),
      updates: [],
      cancelActionIds: [],
      warnings: [],
    };
  if (
    !Array.isArray(capture.actions) ||
    capture.actions.length > CAPTURE_MAX_ACTIONS
  )
    throw new CaptureInputError();
  const pending = capture.actions.filter((a) =>
    ["pending", "needs_input", "conflict"].includes(a.status),
  );
  const tokens =
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const named = pending.filter((action) => {
    const title = (
      action.presentation?.title ?? captureActionSummary(action)
    ).toLowerCase();
    if (/тренир|workout|gym|зал|жаттығ/iu.test(text))
      return /тренир|workout|gym|зал|жаттығ/iu.test(title);
    if (/съ[её]м|снят|filming|film|влог|видео|түсіру/iu.test(text))
      return action.kind === "filming.idea";
    return tokens.some(
      (token) =>
        token.length > 2 &&
        !/^(?:нет|завтра|сегодня|пятницу|остальные|задачи|сохрани|перенеси|вечер|tomorrow|today|friday|move|keep|remove|delete|убери|исправь|емес|ертең|бүгін)$/iu.test(
          token,
        ) &&
        title.includes(token),
    );
  });
  if (named.length !== 1) {
    result.warnings.push(
      "Уточните одну неподтверждённую цель или выберите её вручную.",
    );
    return result;
  }
  const target = named[0];
  if (/убери|удали|отмени|remove|dismiss|cancel|алып\s+таста/iu.test(text)) {
    result.cancelActionIds.push(target.id);
    return result;
  }
  const old =
    target.presentation ??
    present(target, captureActionSummary(target), context, null);
  const date = localDateHint(text, context, old.timezone),
    hint = timeHint(text);
  if (!date && !hint) {
    result.warnings.push(
      "Изменение не распознано; отредактируйте предложение вручную.",
    );
    return result;
  }
  let action = parseCaptureActionPayload({
    kind: target.kind,
    args: target.args,
  });
  const presentation = parseCapturePresentation({
    ...old,
    suggestedDate: date ?? old.suggestedDate,
    timeHint: hint ?? old.timeHint,
    evidence: "user_statement",
  });
  if (date && isCaptureJournalAction(action))
    action = parseCaptureActionPayload({
      kind: action.kind,
      args: { ...action.args, date },
    });
  if (action.kind === "task.create" || action.kind === "task.update")
    action = parseCaptureActionPayload({
      kind: action.kind,
      args: {
        ...action.args,
        notes: taskNotes(
          action.args.notes ?? "",
          presentation.suggestedDate,
          presentation.relation,
          presentation.language,
        ),
      },
    });
  if (action.kind === "reminder.create" && date && action.args.remindAt) {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: context.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(action.args.remindAt));
    action = parseCaptureActionPayload({
      kind: action.kind,
      args: {
        ...action.args,
        remindAt: assistantLocalInstant(date, time, context.timezone),
      },
    });
  }
  if (hint && action.kind === "planning.suggest")
    action = parseCaptureActionPayload({
      kind: action.kind,
      args: {
        ...action.args,
        time: null,
        notes: [action.args.notes, hint].filter(Boolean).join("\n"),
      },
    });
  if (hint && action.kind === "filming.idea")
    action = parseCaptureActionPayload({
      kind: action.kind,
      args: { ...action.args, content: `${action.args.content}\n${hint}` },
    });
  result.updates.push({ actionId: target.id, action, presentation });
  return result;
}
