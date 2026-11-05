import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  type AcademicEvent,
} from "../../../../packages/core/src/academic-concierge.js";
import { academicTransport, type AcademicSnapshot } from "./study-concierge";

describe("academic HTTP mutation response contract", () => {
  it("adopts the whole canonical overview after event edit/confirmation, including new revisions and unrelated source freshness", async () => {
    const event: AcademicEvent = {
      id: "11111111-1111-4111-8111-111111111111",
      key: "synthetic-event",
      sourceKey: "synthetic-source",
      kind: "personal_exam",
      title: "Synthetic proposal",
      startsAt: "2030-11-12T11:00:00.000Z",
      endsAt: null,
      startsOn: null,
      endsOn: null,
      timezone: "Asia/Almaty",
      location: "Invented test place",
      courseCode: null,
      sourceTypeCode: null,
      trimester: null,
      periodType: null,
      status: "proposed",
      revision: 1,
      manuallyEdited: false,
      updatedAt: "2026-10-01T00:00:00Z",
    };
    const overview: AcademicSnapshot = {
      timezone: "Asia/Almaty",
      deliveryEnabled: false,
      sources: [],
      events: [event],
      preferences: { ...DEFAULT_ACADEMIC_PREFERENCES },
      scheduleVerification: {
        revision: 1,
        validFrom: null,
        validThrough: null,
        sourceLabel: null,
        verifiedAt: null,
        current: false,
        changed: false,
      },
      lms: {
        configured: false,
        stale: true,
        lastSuccessfulSyncAt: null,
        state: "not_configured",
      },
      classes: [],
      assignments: [],
      warnings: [],
      truncated: false,
    };
    const requests: Array<{ method: string; body: Record<string, unknown> }> =
      [];
    const server = createServer(async (request, response) => {
      let text = "";
      for await (const part of request) text += part;
      const body = JSON.parse(text) as Record<string, unknown>;
      requests.push({ method: request.method!, body });
      response.setHeader("content-type", "application/json");
      if (body.confirmed !== true || body.expectedRevision !== event.revision) {
        response.statusCode = 409;
        response.end(JSON.stringify({ error: "academic_conflict" }));
        return;
      }
      if (request.method === "PATCH") {
        Object.assign(event, body.patch);
        event.manuallyEdited = true;
      } else if (request.method === "POST" && request.url?.endsWith("/confirm"))
        event.status = "confirmed";
      else {
        response.statusCode = 405;
        response.end();
        return;
      }
      event.revision++;
      overview.scheduleVerification.revision++;
      overview.scheduleVerification.changed = true;
      overview.warnings = ["academic_schedule_verification_required"];
      response.end(JSON.stringify({ data: overview }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const transport = academicTransport(
      async <T>(resource: string, options?: RequestInit) => {
        const response = await fetch(origin + "/api/tma/" + resource, {
          ...options,
          headers: { "content-type": "application/json" },
        });
        if (!response.ok) throw new Error("fixture_mutation_rejected");
        return ((await response.json()) as { data: T }).data;
      },
    );
    try {
      const edited = await transport.revise(event.id, {
        expectedRevision: 1,
        patch: { title: "Synthetic corrected proposal" },
        confirmed: true,
      });
      expect(edited.events[0]).toMatchObject({
        title: "Synthetic corrected proposal",
        revision: 2,
        manuallyEdited: true,
        status: "proposed",
      });
      expect(edited.scheduleVerification).toMatchObject({
        revision: 2,
        changed: true,
      });
      expect(edited.warnings).toEqual([
        "academic_schedule_verification_required",
      ]);
      const confirmed = await transport.decide(event.id, "confirm", 2);
      expect(confirmed.events[0]).toMatchObject({
        revision: 3,
        status: "confirmed",
        endsAt: null,
      });
      expect(confirmed.scheduleVerification.revision).toBe(3);
      expect(confirmed.deliveryEnabled).toBe(false);
      expect(requests.map((r) => r.method)).toEqual(["PATCH", "POST"]);
      expect(requests[1].body).toEqual({
        expectedRevision: 2,
        confirmed: true,
      });
      await expect(transport.decide(event.id, "confirm", 1)).rejects.toThrow(
        "fixture_mutation_rejected",
      );
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
