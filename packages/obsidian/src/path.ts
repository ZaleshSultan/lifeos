const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export interface SanitizeObsidianSegmentOptions {
  fallback?: string;
  maxLength?: number;
}

export function sanitizeObsidianSegment(
  input: string,
  options: SanitizeObsidianSegmentOptions = {},
): string {
  const fallback = options.fallback ?? "untitled";
  const maxLength = options.maxLength ?? 120;
  const sanitized = input
    .normalize("NFKC")
    .replace(FORBIDDEN_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, maxLength)
    .trim();
  const safe = sanitized || fallback;

  if (RESERVED_WINDOWS_NAMES.has(safe.toLowerCase())) {
    return `${safe}-note`;
  }

  return safe;
}

export function buildObsidianNotePath(
  folders: string[],
  title: string,
  extension = "md",
): string {
  const safeExtension = sanitizeObsidianSegment(extension.replace(/^\./, ""), {
    fallback: "md",
    maxLength: 12,
  });
  const safeFolders = folders
    .map((folder) => sanitizeObsidianSegment(folder))
    .filter((folder) => folder.length > 0);
  const safeTitle = sanitizeObsidianSegment(title);

  return [...safeFolders, `${safeTitle}.${safeExtension}`].join("/");
}
