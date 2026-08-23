import { describe, expect, it } from "vitest";
import {
  buildObsidianNotePath,
  sanitizeObsidianSegment,
  validateObsidianVaultPath,
} from "./path.js";

describe("sanitizeObsidianSegment", () => {
  it("removes traversal and forbidden path characters", () => {
    expect(sanitizeObsidianSegment("../Health: Sleep/Log?")).toBe(
      "Health- Sleep-Log",
    );
  });

  it("uses a fallback for empty segments", () => {
    expect(sanitizeObsidianSegment(" .. / ")).toBe("untitled");
  });

  it("protects reserved Windows filenames", () => {
    expect(sanitizeObsidianSegment("CON")).toBe("CON-note");
    expect(sanitizeObsidianSegment("COM1.md")).toBe("COM1.md-note");
  });

  it("normalizes Windows-invalid note characters", () => {
    expect(sanitizeObsidianSegment("Legs: Quads * Calisthenics?")).toBe(
      "Legs- Quads - Calisthenics",
    );
  });
});

describe("buildObsidianNotePath", () => {
  it("builds safe vault-relative note paths", () => {
    expect(
      buildObsidianNotePath(["Daily Notes", "../Health"], "Mood: 8/10"),
    ).toBe("Daily Notes/Health/Mood- 8-10.md");
  });
});

describe("validateObsidianVaultPath", () => {
  it("accepts normalized POSIX absolute paths", () => {
    expect(validateObsidianVaultPath("/srv/lifeos-vaults/user-a")).toEqual({
      ok: true,
      path: "/srv/lifeos-vaults/user-a",
    });
  });

  it("accepts normalized Windows drive paths", () => {
    expect(validateObsidianVaultPath("C:\\LifeOS\\Vaults\\UserA")).toEqual({
      ok: true,
      path: "C:\\LifeOS\\Vaults\\UserA",
    });
  });

  it("rejects relative paths", () => {
    expect(validateObsidianVaultPath("vaults/user-a")).toEqual({
      ok: false,
      error: "Vault path must be absolute.",
    });
  });

  it("rejects traversal segments", () => {
    expect(validateObsidianVaultPath("/srv/lifeos-vaults/../user-a")).toEqual({
      ok: false,
      error: "Vault path must not contain traversal segments.",
    });
  });
});
