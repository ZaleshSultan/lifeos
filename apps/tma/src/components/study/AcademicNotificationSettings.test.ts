import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AcademicNotificationSettings } from "./AcademicNotificationSettings";
import type { AcademicIntelligencePreferences } from "../../../../../packages/core/src/academic-intelligence.js";

const preferences: AcademicIntelligencePreferences = {
  revision: 3,
  academicRevision: 7,
  courseReviews: {},
  gradeAlertsEnabled: false,
  assignmentAlertsEnabled: false,
  quizAlertsEnabled: false,
  assignmentOffsetsMinutes: [1440, 180, 30],
  quizOffsetsMinutes: [4320, 1440],
  quietStart: "22:00",
  quietEnd: "07:00",
};
describe("academic notification consent presentation", () => {
  it("keeps delivery off and preserves existing timings instead of applying suggested values on read", () => {
    const save = vi.fn();
    const html = renderToStaticMarkup(
      createElement(AcademicNotificationSettings, {
        preferences,
        deliveryEnabled: false,
        onSave: save,
      }),
    );
    expect(html).toContain("об оценках и тестах пока не готовятся");
    expect(html).toContain('value="1440, 180, 30"');
    expect(html).toContain("Это подсказка, не согласие");
    expect(html).not.toContain(" checked=");
    expect(html).toMatch(/type="submit" disabled=""/);
    expect(save).not.toHaveBeenCalled();
  });
  it("does not turn saved category preferences into an approved save or a release activation", () => {
    const save = vi.fn();
    const html = renderToStaticMarkup(
      createElement(AcademicNotificationSettings, {
        preferences: { ...preferences, gradeAlertsEnabled: true },
        deliveryEnabled: false,
        onSave: save,
      }),
    );
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    expect(html).toMatch(/type="submit" disabled=""/);
    expect(html).toContain("Подтверждаю выбранные категории");
    expect(save).not.toHaveBeenCalled();
  });
  it("preserves saved assignment consent when the new grade and quiz categories are inactive", () => {
    const save = vi.fn();
    const html = renderToStaticMarkup(
      createElement(AcademicNotificationSettings, {
        preferences: { ...preferences, assignmentAlertsEnabled: true },
        deliveryEnabled: false,
        onSave: save,
      }),
    );
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    expect(html).toContain("об оценках и тестах пока не готовятся");
    expect(html).toContain("Напоминания о заданиях сохраняют свои настройки");
    expect(html).toMatch(/type="submit" disabled=""/);
    expect(save).not.toHaveBeenCalled();
  });
});
