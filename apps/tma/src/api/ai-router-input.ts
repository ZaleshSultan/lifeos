/** Decimal USD input without floating-point rounding or exponent shortcuts. */
export function parseRouterUsdMicros(input: string): number {
  const match = /^(0|[1-9][0-9]{0,6})(?:[.,]([0-9]{1,6}))?$/.exec(input.trim());
  if (!match) throw new Error("Invalid spending amount");
  const result =
    Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
  if (!Number.isSafeInteger(result) || result > 1_000_000_000_000)
    throw new Error("Invalid spending amount");
  return result;
}

export function routerUsdInput(micros: number): string {
  return (micros / 1_000_000).toFixed(6).replace(/\.?0+$/, "") || "0";
}
