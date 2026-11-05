import { describe, expect, it } from "vitest";
import { bridgeResourceAllowed } from "./bridge-policy";
describe("grade target web bridge", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("does not expose an unimplemented calculator configure alias", () => {
    expect(
      bridgeResourceAllowed(`study/courses/${id}/calculator/configure`, "PUT"),
    ).toBe(false);
  });
  it.each(["calculator", "syllabus", "scholarship"])(
    "permits only explicit owned course PUT %s selectors",
    (resource) => {
      const path = `study/courses/${id}/${resource}`;
      expect(bridgeResourceAllowed(path, "PUT")).toBe(true);
      for (const method of ["GET", "POST", "PATCH", "DELETE"])
        expect(bridgeResourceAllowed(path, method)).toBe(false);
      for (const invalid of [
        `study/courses/not-a-uuid/${resource}`,
        `${path}/extra`,
        `${path}?user_id=other`,
        `https://example.invalid/${path}`,
        `study/courses/${id}/../${resource}`,
        `study/courses/${id}/${resource}/`,
      ])
        expect(bridgeResourceAllowed(invalid, "PUT")).toBe(false);
    },
  );
});
