import { describe, expect, it } from "vitest";
import { defaultScholarshipConfig } from "../../../../../packages/core/src/scholarship.js";
import {
  reconcileScholarshipDraft,
  scholarshipDraftDirty,
  scholarshipScore,
} from "./model";
describe("scholarship edits and numerical presentation", () => {
  it("keeps two-decimal critical examples readable in Russian", () => {
    expect(scholarshipScore(70.03)).toBe("70,03");
    expect(scholarshipScore(70.075)).toBe("70,08");
    expect(scholarshipScore(null)).toBe("Неизвестно");
  });
  it("preserves a dirty scenario and its expected server version during Moodle refresh", () => {
    const base = defaultScholarshipConfig();
    const draft = reconcileScholarshipDraft(undefined, base);
    const edited = { ...draft, config: { ...draft.config, target: 80 } };
    const remote = defaultScholarshipConfig(90);
    expect(scholarshipDraftDirty(edited)).toBe(true);
    expect(reconcileScholarshipDraft(edited, remote)).toBe(edited);
    expect(reconcileScholarshipDraft(draft, remote).config.target).toBe(90);
  });
  it("treats a first-time target edit as dirty, including when no plan was saved yet", () => {
    const draft = reconcileScholarshipDraft(undefined, null, 70);
    expect(scholarshipDraftDirty(draft)).toBe(false);
    const edited = { ...draft, config: { ...draft.config, target: 80 } };
    expect(scholarshipDraftDirty(edited)).toBe(true);
    expect(reconcileScholarshipDraft(edited, null, 70).config.target).toBe(80);
  });
});
