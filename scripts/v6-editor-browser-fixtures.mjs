// Synthetic editor controls only. Reuse the Academic Concierge fixture's CAS path.
import assert from "node:assert/strict";
import { academicBrowserFixture } from "./academic-browser-fixtures.mjs";

export const V6_EDITOR_VIEWPORTS = [320, 390];
export const V6_EDITOR_SCENARIO_COUNT = V6_EDITOR_VIEWPORTS.length * 4;

export function v6EditorBrowserFixture(owner = "A") {
  const academic = academicBrowserFixture(owner);
  const browserResponses = [];
  let controlWrites = 0;
  const personal = () =>
    academic.snapshot.events.find((event) => event.kind === "personal_exam");
  async function concurrentEdit(patch) {
    const before = personal();
    const result = await academic.response(
      `study/concierge/events/${before.id}`,
      "PATCH",
      { expectedRevision: before.revision, confirmed: true, patch },
    );
    assert.equal(result.status, 200, "synthetic concurrent edit must pass CAS");
    controlWrites++;
    return personal();
  }
  return {
    get snapshot() {
      return academic.snapshot;
    },
    get browserResponses() {
      return structuredClone(browserResponses);
    },
    get browserWrites() {
      return structuredClone(
        browserResponses.filter((response) => response.method !== "GET"),
      );
    },
    get controlWrites() {
      return controlWrites;
    },
    async configureClock(startsAt, endsAt, timezone) {
      // Added by PR #64; this deliberately requires its preserved integration.
      academic.setPersonalClock(startsAt, timezone);
      await concurrentEdit({ endsAt });
    },
    concurrentEdit,
    async response(path, method, body = {}) {
      const result = await academic.response(path, method, body);
      if (result)
        browserResponses.push({
          path,
          method,
          body: structuredClone(body),
          status: result.status,
        });
      return result;
    },
  };
}
