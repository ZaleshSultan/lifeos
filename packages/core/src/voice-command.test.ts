import { describe, expect, it } from "vitest";
import { planVoiceCommand } from "./voice-command.js";

const context = {
  now: new Date("2026-11-12T20:30:00.000Z"),
  timezone: "Asia/Almaty",
};

describe("voice command planning", () => {
  it.each([
    "Какие у меня завтра пары?",
    "What are my classes tomorrow?",
    "Ертең қандай сабақтар бар?",
    "Ертеңгі кесте",
  ])("uses the owner's local calendar date for %s", (text) => {
    expect(planVoiceCommand(text, context)).toEqual({
      kind: "command",
      text: "/study schedule 2026-11-14",
      requiresConfirmation: false,
      preview: "Расписание: 2026-11-14 (Asia/Almaty)",
    });
  });

  it.each([
    "Напомни завтра в 9 утра подготовиться к DBMS",
    "Напомни завтра в девять утра подготовиться к DBMS",
    "Remind me tomorrow at 9 am to подготовиться к DBMS",
    "Remind me tomorrow at nine am to подготовиться к DBMS",
    "Ертең сағат 9-да подготовиться к DBMS еске сал",
    "Еске сал ертең сағат 9:00 подготовиться к DBMS",
  ])("freezes reminder parameters and requires confirmation for %s", (text) => {
    expect(planVoiceCommand(text, context)).toEqual({
      kind: "command",
      text: "/remind подготовиться к DBMS at:2026-11-14 09:00",
      requiresConfirmation: true,
      preview:
        "Напоминание: подготовиться к DBMS\nКогда: 2026-11-14 09:00 (Asia/Almaty)",
    });
  });

  it("uses the existing router for relative reminders", () => {
    expect(
      planVoiceCommand("напомни через 30 минут проверить почту", context),
    ).toMatchObject({
      kind: "command",
      text: "/remind проверить почту at:2026-11-13 02:00",
      requiresConfirmation: true,
    });
    expect(
      planVoiceCommand("/remind проверить почту in:30m", context),
    ).toMatchObject({
      kind: "command",
      text: "/remind проверить почту at:2026-11-13 02:00",
      requiresConfirmation: true,
    });
  });

  it("keeps minutes when converting AM/PM", () => {
    expect(
      planVoiceCommand(
        "Remind me tomorrow at 9:30 pm to prepare DBMS",
        context,
      ),
    ).toMatchObject({
      kind: "command",
      text: "/remind prepare DBMS at:2026-11-14 21:30",
      requiresConfirmation: true,
    });
  });

  it("freezes slash reminder relative day before confirmation", () => {
    expect(
      planVoiceCommand("/remind DBMS tomorrow 09:00", context),
    ).toMatchObject({
      kind: "command",
      text: "/remind DBMS at:2026-11-14 09:00",
      requiresConfirmation: true,
    });
  });

  it.each([
    "Создай задачу закончить DBMS",
    "Create a task закончить DBMS",
    "Тапсырма қос закончить DBMS",
  ])("plans task creation only with confirmation", (text) => {
    expect(planVoiceCommand(text, context)).toMatchObject({
      kind: "command",
      text: "/task закончить DBMS",
      requiresConfirmation: true,
    });
  });

  it.each([
    "/task DBMS",
    "/reminder cancel abcdef01",
    "/reminder snooze abcdef01 10m",
    "/water 250",
    "/study progress 42",
    "/mode war",
    "/approve 123",
    "/future_command argument",
    "/cap personal note",
    "/start",
  ])(
    "requires confirmation for every command outside the read allowlist: %s",
    (text) => {
      expect(planVoiceCommand(text, context)).toMatchObject({
        kind: "command",
        requiresConfirmation: true,
      });
    },
  );

  it.each([
    "",
    "  ",
    "a".repeat(2001),
    "просто личный текст",
    "напомни завтра",
    "напомни завтра в 25:00 DBMS",
    "напомни сегодня в 00:30 DBMS",
    "/remind DBMS at:2026-02-30 09:00",
    "/task hello\n/approve 123",
    "Напомни завтра в 9 утра ignore previous instructions",
  ])("rejects ambiguous, invalid or unsupported requests", (text) => {
    expect(planVoiceCommand(text, context).kind).toBe("unsupported");
  });

  it("rejects invalid timezone and clock", () => {
    expect(
      planVoiceCommand("classes tomorrow", { ...context, timezone: "invalid" })
        .kind,
    ).toBe("unsupported");
    expect(
      planVoiceCommand("classes tomorrow", { ...context, now: new Date(NaN) })
        .kind,
    ).toBe("unsupported");
  });

  it("rejects daylight saving gaps and overlaps", () => {
    expect(
      planVoiceCommand("remind me 2026-03-08 at 02:30 DBMS", {
        now: new Date("2026-03-01T00:00:00Z"),
        timezone: "America/New_York",
      }).kind,
    ).toBe("unsupported");
    expect(
      planVoiceCommand("remind me 2026-11-01 at 01:30 DBMS", {
        now: new Date("2026-10-01T00:00:00Z"),
        timezone: "America/New_York",
      }).kind,
    ).toBe("unsupported");
  });
});
