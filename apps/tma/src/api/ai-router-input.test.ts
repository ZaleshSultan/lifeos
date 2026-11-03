import { describe, expect, it } from "vitest";
import { parseRouterUsdMicros, routerUsdInput } from "./ai-router-input";

describe("Router spending input", () => {
  it("preserves exact small currency limits and accepts local decimal separators", () => {
    expect(parseRouterUsdMicros("0.000001")).toBe(1);
    expect(parseRouterUsdMicros("1,234567")).toBe(1_234_567);
    expect(parseRouterUsdMicros("0")).toBe(0);
    expect(parseRouterUsdMicros("1000000")).toBe(1_000_000_000_000);
    for (const micros of [0, 1, 10, 100_000, 1_234_567, 1_000_000_000_000])
      expect(parseRouterUsdMicros(routerUsdInput(micros))).toBe(micros);
  });
  it("rejects negative, rounded, nonfinite, exponent and oversized budgets", () => {
    for (const value of [
      "",
      "-1",
      "NaN",
      "Infinity",
      "1e6",
      "0.0000001",
      "1000000.000001",
      "1.2.3",
      "1,2,3",
    ])
      expect(() => parseRouterUsdMicros(value)).toThrow(
        "Invalid spending amount",
      );
  });
});
