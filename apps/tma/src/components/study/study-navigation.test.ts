import { describe, expect, it } from "vitest";
import { STUDY_NAVIGATION_TABS, studyTabFromRequest } from "./study-navigation";
describe("study destination contract", () => {
  it.each(STUDY_NAVIGATION_TABS)("lands the actual $id tab", ({ id }) => {
    expect(studyTabFromRequest(id)).toBe(id);
  });
  it("deliberately maps the academic alias and rejects unsupported destinations", () => {
    expect(studyTabFromRequest("academic")).toBe("concierge");
    expect(studyTabFromRequest("work")).toBe("work");
    expect(studyTabFromRequest("unknown")).toBeUndefined();
  });
});
