import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isMockDataAllowed } from "./mock";

describe("TMA mock data policy", () => {
  it("does not allow mock data in a production build when explicitly disabled", () => {
    expect(isMockDataAllowed(false, "false")).toBe(false);
  });

  it("uses the live finance API instead of screen-level mock data", async () => {
    const screen = await readFile(
      new URL("../screens/FinanceScreen.tsx", import.meta.url),
      "utf8",
    );
    const client = await readFile(
      new URL("./client.ts", import.meta.url),
      "utf8",
    );

    expect(screen).toContain("useFinanceQuery");
    expect(screen).not.toContain("mock");
    expect(client).toContain('"/api/tma/finance"');
  });

  it("uses live monthly review API instead of screen-level mock data", async () => {
    const screen = await readFile(
      new URL("../screens/HomeScreen.tsx", import.meta.url),
      "utf8",
    );
    const client = await readFile(
      new URL("./client.ts", import.meta.url),
      "utf8",
    );

    expect(screen).toContain("useMonthlyReviewQuery");
    expect(screen).not.toContain("mock");
    expect(client).toContain('"/api/tma/monthly-review"');
  });
});
