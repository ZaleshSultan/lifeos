import { describe, expect, it } from "vitest";
import type { AcademicRecord } from "../../api/types";
import { courseGradeCards, gradeLetter } from "./grade-cards";

function row(
  title: string,
  score: number | null,
  item: string,
  meta: Record<string, unknown> = {},
): AcademicRecord {
  return {
    id: item,
    userId: "test",
    sourceEventId: "event-" + item,
    courseTitle: "Networks | Tutor",
    title,
    score,
    maxScore: 100,
    recordType: "grade",
    valueText: null,
    percentage: null,
    occursAt: null,
    dueAt: null,
    createdAt: "",
    updatedAt: "",
    rawJson: { moodle_course_id: "1", moodle_item_id: item, ...meta },
  };
}
const total = {
  source: "moodle_course_total",
  moodle_course_id: "1",
  moodle_item_id: "99",
  score: 82,
  max_score: 100,
};
describe("course grade cards", () => {
  it("shows the Moodle total once, preserves real zeroes, separates assignments and derives the AITU letter", () => {
    const [card] = courseGradeCards(
      [
        row("Calculated grade Register Midterm", 78, "1", {
          lifeos_course_total: total,
        }),
        row("Register Endterm", 0, "2", { lifeos_course_total: total }),
        row("Attendance Attendance", 77.5, "3"),
        row("Essay", null, "4"),
      ],
      [],
    );
    expect(card).toMatchObject({
      name: "Networks",
      subtitle: "Tutor",
      total: { score: 82 },
      mid: { score: 78 },
      end: { score: 0 },
      final: null,
      attendance: 77.5,
    });
    expect(gradeLetter(card.total)).toBe("B");
    expect(card.rows.map((r) => r.id)).toEqual(["1", "2", "3", "99"]);
    expect(card.assignments[0].score).toBeNull();
  });
  it("keeps same-named Moodle courses separate and omits hidden, demo and other-course results", () => {
    const cards = courseGradeCards(
      [
        row("Register Midterm", 80, "1", {
          lifeos_course_total: total,
          _grade_visibility_unknown: true,
        }),
        row("Register Final", 100, "2", { _is_mocked: true }),
        row("Register Final", 70, "2", {
          moodle_course_id: "2",
          lifeos_course_total: total,
        }),
      ],
      [],
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      mid: { score: null },
      total: null,
      final: null,
    });
    expect(cards[1]).toMatchObject({ final: { score: 70 }, total: null });
  });
  it("does not guess when official totals disagree or only an assessment total is available", () => {
    expect(
      courseGradeCards(
        [
          row("Register Final", 80, "1", { lifeos_course_total: total }),
          row("Register Term", 60, "2", {
            lifeos_course_total: { ...total, score: 90 },
          }),
          row("Register(not to edit) total", 75, "3"),
        ],
        [],
      )[0].total,
    ).toBeNull();
    expect(gradeLetter({ score: 80, max: null })).toBeNull();
    expect(gradeLetter({ score: 0, max: 100 })).toBe("F");
  });
});
