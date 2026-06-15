import path from "node:path";

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

const WINDOWS_DRIVE_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_ABSOLUTE = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/;

export type ObsidianVaultPathValidationResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

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

export function validateObsidianVaultPath(
  input: string,
): ObsidianVaultPathValidationResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: "Vault path cannot be empty." };
  }

  if (/[\u0000-\u001f]/.test(trimmed)) {
    return {
      ok: false,
      error: "Vault path contains control characters.",
    };
  }

  const isPosixAbsolute = path.posix.isAbsolute(trimmed);
  const isWindowsAbsolute =
    WINDOWS_DRIVE_ABSOLUTE.test(trimmed) ||
    WINDOWS_UNC_ABSOLUTE.test(trimmed);

  if (!isPosixAbsolute && !isWindowsAbsolute) {
    return {
      ok: false,
      error: "Vault path must be absolute.",
    };
  }

  if (hasTraversalSegment(trimmed)) {
    return {
      ok: false,
      error: "Vault path must not contain traversal segments.",
    };
  }

  const normalized = isWindowsAbsolute
    ? path.win32.normalize(trimmed)
    : path.posix.normalize(trimmed);
  const parsed = isWindowsAbsolute
    ? path.win32.parse(normalized)
    : path.posix.parse(normalized);

  if (normalized === parsed.root) {
    return {
      ok: false,
      error: "Vault path must not be a filesystem root.",
    };
  }

  return { ok: true, path: normalized };
}

function hasTraversalSegment(input: string): boolean {
  return input.split(/[\\/]+/).some((segment) => segment === "..");
}
