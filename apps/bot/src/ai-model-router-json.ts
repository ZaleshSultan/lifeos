/** Trusted, closed schemas. No client/model-supplied schema or external $ref. */
export type RouterJsonSchemaKey =
  | "capture_actions_v1"
  | "meal_estimate_v1"
  | "lifeos_reply_v1"
  | "public_probe_v1";
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
  anyOf?: Schema[];
  enum?: unknown[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};
const text = (maxLength = 6000): Schema => ({ type: "string", maxLength });
const nullableText: Schema = { type: ["string", "null"], maxLength: 6000 };
const nullableNumber: Schema = {
  type: ["number", "null"],
  minimum: 0,
  maximum: 10000,
};
const nil: Schema = { type: "null" };
const obj = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const dated = { date: text(10), content: text() };
const args: Record<string, Schema> = {
  "task.create": obj({ title: text(500), notes: text(), dueAt: nullableText }),
  "task.update": obj({ title: text(500), taskId: nil, expectedUpdatedAt: nil }),
  "task.complete": obj({
    title: text(500),
    taskId: nil,
    expectedUpdatedAt: nil,
  }),
  "reminder.create": obj({ title: text(500), remindAt: nullableText }),
  "planning.suggest": obj({
    date: text(10),
    title: text(500),
    notes: text(),
    time: nullableText,
  }),
  "study.record": obj({
    date: text(10),
    topic: text(500),
    minutes: nullableNumber,
    notes: text(),
    category: {
      enum: ["programming", "english", "cybersecurity", "science", "other"],
    },
    completed: { type: ["boolean", "null"] },
  }),
  "learning.note": obj({ date: text(10), topic: text(500), content: text() }),
  "meal.record": obj({
    date: text(10),
    label: text(240),
    caloriesKcal: nullableNumber,
    proteinG: nullableNumber,
    fatG: nullableNumber,
    carbsG: nullableNumber,
    mealTime: nullableText,
    portion: text(240),
    estimated: { enum: [true] },
  }),
  "water.log": obj({ amountMl: nullableNumber }),
  "workout.note": obj(dated),
  "reflection.add": obj(dated),
  "filming.idea": obj(dated),
  "note.save": obj({ title: text(500), content: text() }),
  "question.read": obj({ text: text(), tool: nil }),
};
const schemas: Record<RouterJsonSchemaKey, Schema> = {
  capture_actions_v1: obj({
    actions: {
      type: "array",
      maxItems: 16,
      items: {
        anyOf: Object.entries(args).map(([kind, schema]) =>
          obj({ kind: { enum: [kind] }, args: schema }),
        ),
      },
    },
  }),
  meal_estimate_v1: obj({
    items: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: obj({
        label: text(240),
        portion: { type: ["string", "null"], maxLength: 240 },
        caloriesKcal: nullableNumber,
        proteinG: nullableNumber,
        fatG: nullableNumber,
        carbsG: nullableNumber,
      }),
    },
    uncertainty: { type: "array", maxItems: 8, items: text(500) },
  }),
  lifeos_reply_v1: obj({
    answer: { type: "string", minLength: 1, maxLength: 16000 },
    suggestions: {
      type: "array",
      maxItems: 20,
      items: obj({ taskId: text(100), startsAt: text(40), endsAt: text(40) }),
    },
  }),
  public_probe_v1: obj({ ok: { enum: [true] } }),
};
export function routerJsonSchema(
  key: RouterJsonSchemaKey,
): Record<string, unknown> {
  if (!Object.hasOwn(schemas, key))
    throw new Error("invalid_router_json_schema");
  return JSON.parse(JSON.stringify(schemas[key])) as Record<string, unknown>;
}
function matches(s: Schema, value: unknown): boolean {
  if (s.anyOf) return s.anyOf.some((item) => matches(item, value));
  if (s.enum) return s.enum.some((item) => item === value);
  const type =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (s.type && !(Array.isArray(s.type) ? s.type : [s.type]).includes(type))
    return false;
  if (value === null) return true;
  if (typeof value === "string")
    return (
      value.length >= (s.minLength ?? 0) &&
      value.length <= (s.maxLength ?? Infinity)
    );
  if (typeof value === "number")
    return (
      Number.isFinite(value) &&
      value >= (s.minimum ?? -Infinity) &&
      value <= (s.maximum ?? Infinity)
    );
  if (Array.isArray(value))
    return (
      value.length >= (s.minItems ?? 0) &&
      value.length <= (s.maxItems ?? Infinity) &&
      (!s.items || value.every((item) => matches(s.items!, item)))
    );
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return (
      !!s.properties &&
      (s.required ?? []).every((key) => Object.hasOwn(object, key)) &&
      Object.keys(object).every(
        (key) =>
          Object.hasOwn(s.properties!, key) &&
          matches(s.properties![key], object[key]),
      )
    );
  }
  return typeof value === "boolean";
}
export function validRouterJson(key: RouterJsonSchemaKey, text: string) {
  if (!Object.hasOwn(schemas, key) || text.length > 65536) return false;
  try {
    return matches(schemas[key], JSON.parse(text));
  } catch {
    return false;
  }
}
