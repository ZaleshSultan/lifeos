import { describe, expect, it, vi } from "vitest";
import { academicIntelligenceTransport } from "./academic-intelligence-transport";

describe("shared owner-authenticated academic transport", () => {
  const fixture = () => {
    const send = vi.fn(async () => ({ preferences: {} }));
    return {
      send,
      api: academicIntelligenceTransport(
        send as <T>(resource: string, options?: RequestInit) => Promise<T>,
      ),
    };
  };
  it("only reads history on mount; there is no notification or consent write", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    await f.api.feed(signal);
    expect(f.send).toHaveBeenCalledExactlyOnceWith("study/grade-events", {
      signal,
    });
  });
  it("carries both existing and new preference revisions with explicit confirmation", async () => {
    const f = fixture();
    const preferences = {
      gradeAlertsEnabled: false,
      assignmentAlertsEnabled: false,
      quizAlertsEnabled: false,
      assignmentOffsetsMinutes: [4320, 1440],
      quizOffsetsMinutes: [4320, 1440, 180],
      quietStart: "22:00",
      quietEnd: "07:00",
    };
    await f.api.preferences(preferences, {
      expectedRevision: 3,
      expectedAcademicRevision: 7,
    });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      "study/academic-preferences",
      {
        method: "PUT",
        body: JSON.stringify({
          expectedRevision: 3,
          expectedAcademicRevision: 7,
          confirmed: true,
          preferences,
        }),
      },
    );
    expect(f.send.mock.calls[0]).not.toContain("userId");
  });
  it("retains exact course, definition, binding and enrollment context in review", async () => {
    const f = fixture();
    await f.api.review({
      courseId: "synthetic-course",
      expectedRevision: 5,
      definitionKey: "reviewed-definition",
      bindingsKey: "reviewed-bindings",
      contextKey: "reviewed-enrollment",
      sourceRef: "Synthetic syllabus p. 2",
    });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      "study/grade-policy/synthetic-course",
      {
        method: "PUT",
        body: JSON.stringify({
          expectedRevision: 5,
          definitionKey: "reviewed-definition",
          bindingsKey: "reviewed-bindings",
          contextKey: "reviewed-enrollment",
          sourceRef: "Synthetic syllabus p. 2",
          currentEnrollmentConfirmed: true,
          supportedRulesConfirmed: true,
          confirmed: true,
        }),
      },
    );
  });
});
