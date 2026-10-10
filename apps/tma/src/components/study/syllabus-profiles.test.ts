import { describe, expect, it } from "vitest";
import { validateStudyCalculatorDefinition } from "../../../../../packages/core/src/study.js";
import { createStudyDraft } from "./model";
import { previewMoodleGrades } from "./grade-import";
import { matchSyllabusProfile, syllabusProfiles } from "./syllabus-profiles";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";

describe("2026–2027 grading syllabus profiles", () => {
  it("contains only valid 30/30/40 calculator definitions", () => {
    expect(syllabusProfiles).toHaveLength(5);
    for (const profile of syllabusProfiles) {
      expect(validateStudyCalculatorDefinition(profile.definition)).toBe(true);
      expect(profile.definition.fields.filter(f => f.period === "exam")).toHaveLength(1);
      expect(profile.definition.fields.find(f => f.period === "exam")?.weightPercent).toBe(100);
    }
  });

  it("uses syllabus-specific weights instead of a shared fake formula", () => {
    const db = syllabusProfiles.find(p => p.id === "dbms")!;
    expect(db.definition.fields.filter(f => f.period === "att1").map(f => f.weightPercent))
      .toEqual([20, 20, 20, 10, 30]);
    const dld = syllabusProfiles.find(p => p.id === "dld")!;
    expect(dld.definition.fields.filter(f => f.period === "att1").map(f => f.weightPercent))
      .toEqual([20, 20, 20, 40]);
    const cn = syllabusProfiles.find(p => p.id === "networks")!;
    expect(cn.definition.fields.filter(f => f.period === "att2").map(f => f.weightPercent))
      .toEqual([15, 15, 15, 15, 10, 30]);
    const os = syllabusProfiles.find(p => p.id === "os")!;
    expect(os.definition.fields.filter(f => f.period === "att1").map(f => f.weightPercent))
      .toEqual([20, 20, 20, 20, 20]);
    const ru = syllabusProfiles.find(p => p.id === "russian")!;
    expect(ru.definition.fields.filter(f => f.period === "att2").map(f => f.weightPercent))
      .toEqual([60, 40]);
  });

  it("selects only matching academic subjects", () => {
    expect(matchSyllabusProfile("Database Management Systems | Tankeyev Samat")?.id).toBe("dbms");
    expect(matchSyllabusProfile("Operating Systems | Seilkhanova Kymbat")?.id).toBe("os");
    expect(matchSyllabusProfile("Русский язык C1_4")?.id).toBe("russian");
    expect(matchSyllabusProfile("Unknown statistics course")).toBeNull();
  });
});

describe("safe optional Moodle grade import", () => {
  const profile = syllabusProfiles[0];
  const course = {
    id: "course-1", title: "Database Management Systems", code: "DBMS",
    calculator: null, schedules: [], startsOn: null, endsOn: null, externalCourseKey: null,
  } satisfies StudyWorkspaceCourse;
  const draft = createStudyDraft({ definition: profile.definition, values: {}, target: 70 });
  const grade = (id: string, title: string, score: number): AcademicRecord => ({
    id, userId: "u", sourceEventId: null, courseTitle: "Database Management Systems | Teacher",
    recordType: "assignment", title, valueText: null, score, maxScore: 100,
    percentage: score, occursAt: null, dueAt: null, createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
  });

  it("accepts exact unique assignments but refuses ambiguous duplicates", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("a", "Assignment 1", 90),
      grade("b", "Assignment 1", 60),
      grade("c", "Assignment 2", 70),
    ]);
    expect(preview.ambiguous).toBe(1);
    expect(preview.updates.assignment_1).toBeUndefined();
    expect(preview.updates.assignment_2).toBe("70");
    expect(preview.matches).toBe(1);
  });

  it("never interprets a calculated register midterm as a single assessment", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("m", "Calculated grade Register Midterm", 76.4),
    ]);
    expect(preview.updates.midterm).toBeUndefined();
    expect(preview.matches).toBe(0);
  });

  it("never overwrites explicitly entered scenario values", () => {
    const preview = previewMoodleGrades(course, {
      ...draft, inputs: { ...draft.inputs, assignment_1: "88" },
    }, [grade("a", "Assignment 1", 90)]);
    expect(preview.updates.assignment_1).toBeUndefined();
  });
});
