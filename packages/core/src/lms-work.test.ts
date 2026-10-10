import { describe, it, expect } from "vitest";
import { classifyStudyWork, type StudyWorkItem } from "./lms-work.js";
const item: Omit<StudyWorkItem, "category"> = {
  title: "Lab",
  courseTitle: null,
  kind: "assignment",
  submissionStatus: "unknown",
  dueAt: "2026-08-01T00:00:00Z",
  startsAt: null,
  endsAt: null,
  score: null,
  maxScore: null,
  percentage: null,
  source: "moodle",
};
describe("verified study work categories", () => {
  it("keeps missing grade/submission evidence unknown even when overdue", () => {
    expect(classifyStudyWork(item, "2026-10-10T00:00:00Z").category).toBe(
      "unknown",
    );
  });
  it("keeps arbitrarily old explicitly unfinished work overdue", () => {
    expect(
      classifyStudyWork(
        { ...item, submissionStatus: "not_submitted" },
        "2026-10-10T00:00:00Z",
      ).category,
    ).toBe("overdue");
  });
  it("distinguishes submitted ungraded work, zero grades and unknown exam dates", () => {
    expect(
      classifyStudyWork(
        { ...item, submissionStatus: "submitted" },
        "2026-10-10T00:00:00Z",
      ).category,
    ).toBe("submitted_ungraded");
    expect(
      classifyStudyWork({ ...item, score: 0 }, "2026-10-10T00:00:00Z").category,
    ).toBe("graded");
    expect(
      classifyStudyWork(
        { ...item, kind: "exam", dueAt: null },
        "2026-10-10T00:00:00Z",
      ).category,
    ).toBe("exams");
    expect(
      classifyStudyWork({ ...item, dueAt: null }, "2026-10-10T00:00:00Z")
        .category,
    ).toBe("unknown");
  });
});
