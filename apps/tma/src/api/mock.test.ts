import { describe, expect, it } from "vitest";
import { isMockDataAllowed } from "./mock";

describe("TMA mock data policy", () => {
  it("does not allow mock data in a production build when explicitly disabled", () => {
    expect(isMockDataAllowed(false, "false")).toBe(false);
  });
});
