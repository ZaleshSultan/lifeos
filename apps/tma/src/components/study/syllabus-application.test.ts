import { describe, expect, it, vi } from "vitest";
import { syllabusProfiles } from "./syllabus-profiles";
import {
  applyStudySyllabusProfiles,
  studySyllabusApplications,
} from "./syllabus-application";
import type { StudyWorkspaceCourse } from "../../api/study";

function course(title: string, index = 0): StudyWorkspaceCourse {
  return {
    id: `course-${index}`,
    title,
    code: "",
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
    schedules: [],
    calculator: null,
  };
}

describe("syllabus auto-application on workspace load", () => {
  it("configures all five matched courses and every duplicate course without selection or confirmation", async () => {
    const courses = syllabusProfiles.map((profile, index) =>
      course(profile.title, index),
    );
    courses.push(course("Database Management Systems | Other group", 5));
    courses.push(course("Unknown elective", 6));
    const applications = studySyllabusApplications(courses);
    const configure = vi.fn(async () => undefined);
    expect(await applyStudySyllabusProfiles(applications, configure)).toEqual(
      [],
    );
    expect(configure).toHaveBeenCalledTimes(6);
    expect(applications.map((application) => application.courseId)).toEqual(
      courses.slice(0, 6).map((item) => item.id),
    );
    for (const application of applications) {
      expect(application.target).toBe(70);
      expect(application.expectedState).toBeNull();
      expect(application.values).toEqual({});
      expect(
        application.definition.fields.some((field) =>
          field.label.includes("Практики / лабораторные"),
        ),
      ).toBe(false);
    }
  });

  it("does not configure an already exact formula or a custom formula", () => {
    const profile = syllabusProfiles[0];
    const exact = {
      ...course(profile.title),
      calculator: {
        definition: profile.definition,
        values: { assignment_1: 95 },
        target: 85,
      },
    };
    const custom = {
      ...course(profile.title, 1),
      calculator: {
        ...exact.calculator,
        definition: {
          ...profile.definition,
          fields: profile.definition.fields.map((field) => ({
            ...field,
            weightPercent: field.period === "exam" ? 100 : 20,
          })),
        },
      },
    };
    expect(studySyllabusApplications([exact, custom])).toEqual([]);
  });

  it("continues applying other courses after a failure and reports the failed course", async () => {
    const applications = studySyllabusApplications(
      syllabusProfiles.map((profile, index) => course(profile.title, index)),
    );
    const error = new Error("Network unavailable");
    const configure = vi.fn(async (application) => {
      if (application.courseId === "course-1") throw error;
    });
    expect(await applyStudySyllabusProfiles(applications, configure)).toEqual([
      { courseId: "course-1", error },
    ]);
    expect(configure).toHaveBeenCalledTimes(5);
  });

  it("isolates synchronous configure errors so every matched course is still attempted", async () => {
    const applications = studySyllabusApplications(
      syllabusProfiles.map((profile, index) => course(profile.title, index)),
    );
    const error = new Error("Could not begin request");
    const configure = vi.fn((application) => {
      if (application.courseId === "course-0") throw error;
      return Promise.resolve();
    });
    expect(await applyStudySyllabusProfiles(applications, configure)).toEqual([
      { courseId: "course-0", error },
    ]);
    expect(configure).toHaveBeenCalledTimes(5);
  });
});
