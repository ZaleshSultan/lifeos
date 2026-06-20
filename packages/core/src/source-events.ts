export type LifeDomain =
  | "study"
  | "fitness"
  | "health"
  | "finance"
  | "personal";

export type NormalizedPriority = "critical" | "high" | "normal" | "low";

export interface SourceEventLike {
  id?: string;
  userId?: string;
  sourceKey?: string;
  externalId?: string | null;
  eventType?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
  status?: string | null;
  rawJson?: unknown;
}

export interface SourceEventClassification {
  domain: LifeDomain;
  priority: NormalizedPriority;
  tags: string[];
  kind: string;
}

export interface NormalizedLifeEntityInput {
  entityType: "deadline" | "health" | "workout" | "spend" | "capture";
  domain: LifeDomain;
  status: string;
  title: string;
  description: string | null;
  body: string | null;
  dueAt: string | null;
  source: string;
  sourceCommand: string;
  linkedTable: "source_events";
  linkedId: string | null;
  metadata: Record<string, unknown>;
  rawPayloadJson: Record<string, unknown>;
}

const STUDY_CRITICAL_PATTERN = /\b(examfx|exam|final|midterm|quiz)\b/i;
const STUDY_HIGH_PATTERN = /\b(deadline|assignment|homework|coursework)\b/i;
const FITNESS_PATTERN = /\b(workout|training|gym)\b/i;
const HEALTH_PATTERN = /\b(sleep|steps|health|hr|heart|heart rate|rhr|hrv)\b/i;
const FINANCE_PATTERN = /\b(bill|payment|money|expense|spend|invoice)\b/i;

function textFor(title?: string | null, description?: string | null): string {
  return [title ?? "", description ?? ""].join(" ").trim();
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.filter(Boolean))];
}

export function classifyAcademicEvent(
  title?: string | null,
  description?: string | null,
): SourceEventClassification {
  const text = textFor(title, description);

  if (STUDY_CRITICAL_PATTERN.test(text)) {
    const kind = /\bexamfx\b/i.test(text) ? "examfx" : "exam";
    return {
      domain: "study",
      priority: "critical",
      tags: uniqueTags(["study", kind, "critical"]),
      kind,
    };
  }

  if (STUDY_HIGH_PATTERN.test(text)) {
    return {
      domain: "study",
      priority: "high",
      tags: uniqueTags(["study", "deadline", "high"]),
      kind: "deadline",
    };
  }

  return {
    domain: "study",
    priority: "normal",
    tags: ["study"],
    kind: "academic_event",
  };
}

export function classifyTaskDomain(
  title?: string | null,
  description?: string | null,
): SourceEventClassification {
  const text = textFor(title, description);

  if (STUDY_CRITICAL_PATTERN.test(text) || STUDY_HIGH_PATTERN.test(text)) {
    return classifyAcademicEvent(title, description);
  }

  if (FITNESS_PATTERN.test(text)) {
    return {
      domain: "fitness",
      priority: "normal",
      tags: ["fitness"],
      kind: "workout",
    };
  }

  if (HEALTH_PATTERN.test(text)) {
    return {
      domain: "health",
      priority: "normal",
      tags: ["health"],
      kind: "health",
    };
  }

  if (FINANCE_PATTERN.test(text)) {
    return {
      domain: "finance",
      priority: "normal",
      tags: ["finance"],
      kind: "finance",
    };
  }

  return {
    domain: "personal",
    priority: "normal",
    tags: ["personal"],
    kind: "capture",
  };
}

export function classifySourceEvent(
  event: SourceEventLike,
): SourceEventClassification {
  const eventType = event.eventType ?? "";

  if (eventType.includes("academic") || eventType.includes("grade")) {
    return classifyAcademicEvent(event.title, event.description);
  }

  return classifyTaskDomain(event.title, event.description);
}

function entityTypeFor(classification: SourceEventClassification) {
  if (
    classification.domain === "study" &&
    classification.priority !== "normal"
  ) {
    return "deadline";
  }

  if (classification.domain === "fitness") {
    return "workout";
  }

  if (classification.domain === "health") {
    return "health";
  }

  if (classification.domain === "finance") {
    return "spend";
  }

  return "capture";
}

function rawObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function normalizeSourceEventToLifeEntity(
  event: SourceEventLike,
): NormalizedLifeEntityInput {
  const classification = classifySourceEvent(event);
  const title = event.title?.trim() || "Untitled source event";
  const body = [event.description, event.location]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return {
    entityType: entityTypeFor(classification),
    domain: classification.domain,
    status: event.status ?? "inbox",
    title,
    description: event.description ?? null,
    body: body || null,
    dueAt: event.dueAt ?? event.startsAt ?? null,
    source: event.sourceKey ?? "source_event",
    sourceCommand: "normalize_source_event",
    linkedTable: "source_events",
    linkedId: event.id ?? null,
    metadata: {
      sourceKey: event.sourceKey ?? null,
      externalId: event.externalId ?? null,
      eventType: event.eventType ?? null,
      startsAt: event.startsAt ?? null,
      endsAt: event.endsAt ?? null,
      dueAt: event.dueAt ?? null,
      priority: classification.priority,
      tags: classification.tags,
      kind: classification.kind,
    },
    rawPayloadJson: rawObject(event.rawJson),
  };
}

export function buildReminderMessage(entityOrEvent: {
  title?: string | null;
  dueAt?: string | null;
  startsAt?: string | null;
  remindAt?: string | null;
}): string {
  const title = entityOrEvent.title?.trim() || "LifeOS reminder";
  const when =
    entityOrEvent.dueAt ?? entityOrEvent.startsAt ?? entityOrEvent.remindAt;

  return when ? `${title} at ${when}` : title;
}

export function shouldCreateReminder(entityOrEvent: {
  title?: string | null;
  dueAt?: string | null;
  startsAt?: string | null;
  status?: string | null;
  eventType?: string | null;
}): boolean {
  if (entityOrEvent.status === "cancelled" || entityOrEvent.status === "done") {
    return false;
  }

  if (entityOrEvent.dueAt || entityOrEvent.startsAt) {
    return true;
  }

  const classification = classifySourceEvent(entityOrEvent);
  return (
    classification.domain === "study" &&
    (classification.priority === "critical" ||
      classification.priority === "high")
  );
}
