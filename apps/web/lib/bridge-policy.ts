/** Explicit backend resources only: never forward a caller-supplied URL or identity. */
const resources: Array<{ pattern: RegExp; methods: readonly string[] }> = [
  {
    pattern:
      /^(session|home|health|finance|study|academic|sources|today|ai\/status|daily-life\/summary)$/,
    methods: ["GET"],
  },
  { pattern: /^lms\/(work|connection)$/, methods: ["GET"] },
  { pattern: /^daily-life\/preferences$/, methods: ["GET", "PUT"] },
  { pattern: /^ideal-human\/days$/, methods: ["GET", "PUT"] },
  { pattern: /^ideal-human\/reflection\/clear$/, methods: ["POST"] },
  { pattern: /^workout\/(current|history)$/, methods: ["GET"] },
  { pattern: /^workout\/program$/, methods: ["GET", "PUT"] },
  { pattern: /^workout\/start$/, methods: ["POST"] },
  { pattern: /^workout\/sets\/[a-zA-Z0-9_-]{1,80}$/, methods: ["PATCH"] },
  {
    pattern: /^workout\/sets\/[a-zA-Z0-9_-]{1,80}\/(complete|undo)$/,
    methods: ["POST"],
  },
  { pattern: /^workout\/[a-zA-Z0-9_-]{1,80}\/complete$/, methods: ["POST"] },
  {
    pattern: /^(tasks|reminders|hydration|nutrition)$/,
    methods: ["GET", "POST"],
  },
  { pattern: /^tasks\/[a-zA-Z0-9_-]{1,80}$/, methods: ["PATCH"] },
  { pattern: /^reminders\/[a-zA-Z0-9_-]{1,80}$/, methods: ["DELETE"] },
  { pattern: /^hydration\/[a-zA-Z0-9_-]{1,80}\/undo$/, methods: ["POST"] },
  { pattern: /^creator\/capabilities$/, methods: ["GET"] },
  { pattern: /^nutrition\/capabilities$/, methods: ["GET"] },
  { pattern: /^nutrition\/drafts\/[0-9a-f-]{36}$/, methods: ["GET"] },
  { pattern: /^nutrition\/analyze$/, methods: ["POST"] },
  { pattern: /^ai\/chat$/, methods: ["POST"] },
  { pattern: /^ai\/router\/settings$/, methods: ["GET", "PUT"] },
  { pattern: /^ai\/router\/preview$/, methods: ["POST"] },
  { pattern: /^captures$/, methods: ["GET", "POST"] },
  { pattern: /^captures\/(capabilities|memories)$/, methods: ["GET"] },
  { pattern: /^captures\/search$/, methods: ["POST"] },
  {
    pattern:
      /^captures\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    methods: ["GET", "PATCH", "DELETE"],
  },
  {
    pattern:
      /^captures\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(process|confirm|cancel|retry|archive|correct|reject|external)$/,
    methods: ["POST"],
  },
];
export function bridgeResourceAllowed(path: string, method: string) {
  return resources.some(
    (rule) => rule.pattern.test(path) && rule.methods.includes(method),
  );
}
export function bridgeQuery(search: URLSearchParams): string | null {
  const entries = [...search.entries()];
  if (
    entries.some(
      ([key, value]) => key !== "date" || !/^\d{4}-\d{2}-\d{2}$/.test(value),
    ) ||
    entries.length > 1
  )
    return null;
  return search.toString();
}
