import { describe, expect, it } from "vitest";
import { buildObsidianNotePath, sanitizeObsidianSegment } from "./path.js";

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
  });
});

describe("buildObsidianNotePath", () => {
  it("builds safe vault-relative note paths", () => {
    expect(
      buildObsidianNotePath(["Daily Notes", "../Health"], "Mood: 8/10"),
    ).toBe("Daily Notes/Health/Mood- 8-10.md");
  });
});
