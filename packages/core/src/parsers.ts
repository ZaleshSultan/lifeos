import type { ParsedDuration, ParsedScore } from "./types.js";

const SCORE_PATTERN = /(?:^|\D)(10|[1-9])(?:\s*\/\s*10)?(?:\D|$)/;
const HOUR_PATTERN = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i;
const MINUTE_PATTERN = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i;
const CLOCK_PATTERN = /^(\d{1,2}):([0-5]\d)$/;

export function parseScore(raw: string): ParsedScore {
  const input = raw.trim();
  const match = input.match(SCORE_PATTERN);

  if (!match) {
    throw new Error(`Could not parse 1-10 score from: ${raw}`);
  }

  return {
    value: Number.parseInt(match[1] ?? "", 10),
    raw,
  };
}

export function parseDurationToMinutes(raw: string): ParsedDuration {
  const input = raw.trim();
  const clockMatch = input.match(CLOCK_PATTERN);

  if (clockMatch) {
    return {
      minutes:
        Number.parseInt(clockMatch[1] ?? "0", 10) * 60 +
        Number.parseInt(clockMatch[2] ?? "0", 10),
      raw,
    };
  }

  const hourMatch = input.match(HOUR_PATTERN);
  const minuteMatch = input.match(MINUTE_PATTERN);
  const hours = hourMatch ? Number.parseFloat(hourMatch[1] ?? "0") : 0;
  const minutes = minuteMatch ? Number.parseInt(minuteMatch[1] ?? "0", 10) : 0;
  const total = Math.round(hours * 60 + minutes);

  if (total <= 0) {
    throw new Error(`Could not parse duration from: ${raw}`);
  }

  return {
    minutes: total,
    raw,
  };
}

export function parseTags(raw: string): string[] {
  const tags = raw
    .split(/[,\s]+/)
    .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);

  return [...new Set(tags)];
}
