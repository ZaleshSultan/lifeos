import { describe, expect, it } from "vitest";
import {
  buildReminderMessage,
  classifyAcademicEvent,
  classifySourceEvent,
  classifyTaskDomain,
  normalizeSourceEventToLifeEntity,
  shouldCreateReminder,
} from "./source-events.js";

describe("source event normalization", () => {
  it("classifies finals and examfx as critical study events", () => {
    expect(classifyAcademicEvent("Calculus 2 final")).toMatchObject({
      domain: "study",
      priority: "critical",
      kind: "exam",
    });
    expect(classifyAcademicEvent("Electronics examfx")).toMatchObject({
      domain: "study",
      priority: "critical",
      kind: "examfx",
    });
  });

  it("classifies task domains deterministically", () => {
    expect(classifyTaskDomain("Pay electricity bill")).toMatchObject({
      domain: "finance",
    });
    expect(classifyTaskDomain("Gym training")).toMatchObject({
      domain: "fitness",
    });
    expect(classifyTaskDomain("Check HRV and sleep")).toMatchObject({
      domain: "health",
    });
    expect(classifyTaskDomain("Clean inbox")).toMatchObject({
      domain: "personal",
    });
  });

  it("normalizes source events to life entity input", () => {
    const entity = normalizeSourceEventToLifeEntity({
      id: "event-1",
      sourceKey: "university_ics",
      externalId: "calc-final",
      eventType: "academic_event",
      title: "Calculus 2 final",
      startsAt: "2026-05-26T15:00:00.000+06:00",
      rawJson: {
        source: "seed",
      },
    });

    expect(entity).toMatchObject({
      entityType: "deadline",
      domain: "study",
      title: "Calculus 2 final",
      dueAt: "2026-05-26T15:00:00.000+06:00",
      linkedTable: "source_events",
      linkedId: "event-1",
      metadata: {
        priority: "critical",
        sourceKey: "university_ics",
      },
      rawPayloadJson: {
        source: "seed",
      },
    });
  });

  it("builds reminder messages and decides reminder eligibility", () => {
    expect(
      buildReminderMessage({
        title: "Political Science final",
        startsAt: "2026-05-25T12:00:00.000+06:00",
      }),
    ).toBe("Political Science final at 2026-05-25T12:00:00.000+06:00");
    expect(
      shouldCreateReminder({
        title: "Political Science final",
        eventType: "academic_event",
      }),
    ).toBe(true);
    expect(
      shouldCreateReminder({
        title: "Cancelled final",
        startsAt: "2026-05-25T12:00:00.000+06:00",
        status: "cancelled",
      }),
    ).toBe(false);
  });

  it("classifies generic source events through event type and title", () => {
    expect(
      classifySourceEvent({
        eventType: "task",
        title: "Homework deadline",
      }),
    ).toMatchObject({
      domain: "study",
      priority: "high",
    });
  });
});
