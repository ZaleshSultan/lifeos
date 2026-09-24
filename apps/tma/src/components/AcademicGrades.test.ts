import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AcademicRecord } from "../api/types";
import { AcademicGrades } from "./AcademicGrades";

const record: AcademicRecord = {
  id: "grade-1",
  userId: "user-a",
  sourceEventId: "event-1",
  courseTitle: "Database Systems",
  recordType: "assignment",
  title: "Assignment 1",
  valueText: null,
  score: null,
  maxScore: 10,
  percentage: null,
  occursAt: null,
  dueAt: null,
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
};

describe("AcademicGrades", () => {
  it("distinguishes missing grades from actual zero and labels mock data", () => {
    const html = renderToStaticMarkup(
      createElement(AcademicGrades, {
        records: [
          record,
          { ...record, id: "grade-2", score: 0, rawJson: { _is_mocked: true } },
        ],
      }),
    );
    expect(html).toContain("Not graded");
    expect(html).toContain("0 / 10");
    expect(html).toContain("Demo data");
  });

  it("shows an honest empty state", () => {
    const html = renderToStaticMarkup(
      createElement(AcademicGrades, { records: [] }),
    );
    expect(html).toContain("No grades synced yet.");
  });
});
