/** Pure bounded interpretation. Raw response headers never enter receipts. */
export function aiProviderRetryAfter(
  value: string | null,
  nowMs: number,
): { retryAt: string | null; reviewRequired: boolean } {
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime()))
    throw new Error("invalid_quota_clock");
  const fallback = () => ({
    retryAt: new Date(nowMs + 60_000).toISOString(),
    reviewRequired: false,
  });
  if (value === null) return fallback();
  if (value.length > 128) return { retryAt: null, reviewRequired: true };
  const text = value.trim();
  let target: number;
  if (/^[0-9]+$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isSafeInteger(seconds))
      return { retryAt: null, reviewRequired: true };
    target = nowMs + seconds * 1000;
  } else if (
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      text,
    ) ||
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/.test(
      text,
    ) ||
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(
      text,
    )
  ) {
    // Obsolete asctime HTTP dates omit the GMT token but are still UTC.
    target = Date.parse(text.endsWith(" GMT") ? text : text + " GMT");
  } else return fallback();
  if (!Number.isFinite(target)) return fallback();
  // Never shorten a valid long provider wait. Require review rather than overflow.
  if (target - nowMs > 366 * 86400_000)
    return { retryAt: null, reviewRequired: true };
  return {
    retryAt: new Date(Math.max(nowMs + 1000, target)).toISOString(),
    reviewRequired: false,
  };
}
