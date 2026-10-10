import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({
  telegram: { initData: "signed-session", hapticImpact: vi.fn() },
}));

import {
  lmsConnectionQueryKey,
  type LmsConnection,
  type LmsWorkItem,
  type LmsWorkSummary,
} from "../api/lms";
import { LmsConnectionScreen } from "./LmsConnectionScreen";
import {
  LmsWorkDetails,
  ManualLmsWorkForm,
} from "../components/study/StudyLmsOverview";

afterEach(() => vi.unstubAllGlobals());

describe("Secure LMS connection screen", () => {
  it("shows masked manual entry and expiry status without starting secret operations on mount", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const connection: LmsConnection = {
      configured: false,
      state: "session_expired",
      lastSyncSuccessAt: "2026-09-01T12:00:00Z",
      lastSyncAttemptAt: "2026-10-10T12:00:00Z",
      lastErrorCategory: "session_expired",
      sessionExpiresAt: "2026-10-09T12:00:00Z",
      syncRequestedAt: null,
      unsupportedFeatures: [],
    };
    client.setQueryData(lmsConnectionQueryKey, connection);
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(LmsConnectionScreen, { onBack: () => undefined }),
      ),
    );
    expect(html).toContain("AITU LMS Connection");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("ESTSAUTHPERSISTENT");
    expect(html).toContain("Поле очищается сразу при проверке");
    expect(html).toContain("не отправляется AI");
    expect(html).toContain("Успешный вход в Firefox не гарантирует");
    expect(html).toContain("MFA");
    expect(html).toContain("Сессия истекла");
    expect(html).toContain("Последняя успешная синхронизация");
    expect(html).not.toContain("validationToken");
    expect(fetch).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("LMS work presentation", () => {
  it("distinguishes all six server categories, old unfinished work, unknown status, and real zero grades", () => {
    const base: LmsWorkItem = {
      category: "unknown",
      title: "Unknown work",
      courseTitle: "Computer Science",
      kind: "assignment",
      submissionStatus: "unknown",
      dueAt: null,
      startsAt: null,
      endsAt: null,
      score: null,
      maxScore: null,
      percentage: null,
      source: "moodle",
    };
    const summary: LmsWorkSummary = {
      timezone: "Asia/Almaty",
      lastSyncSuccessAt: null,
      lastSyncAttemptAt: null,
      stale: true,
      truncated: false,
      warnings: [],
      unsupportedFeatures: ["Quiz close dates were not exposed"],
      items: [
        base,
        {
          ...base,
          category: "overdue",
          title: "Old unfinished assignment",
          dueAt: "2020-01-01T12:00:00Z",
          submissionStatus: "not_submitted",
        },
        {
          ...base,
          category: "submitted_ungraded",
          title: "Submitted report",
          submissionStatus: "submitted",
        },
        {
          ...base,
          category: "graded",
          title: "Zero mark",
          submissionStatus: "graded",
          score: 0,
          maxScore: 20,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(LmsWorkDetails, { summary }),
    );
    for (const label of [
      "Ближайшие дедлайны",
      "Просроченная работа",
      "Сдано, но не оценено",
      "Оценённая работа",
      "Экзамены и рубежный контроль",
      "Неизвестно / не синхронизировано",
    ])
      expect(html).toContain(label);
    expect(html).toContain("Old unfinished assignment");
    expect(html).toContain("Статус сдачи неизвестен");
    expect(html).toContain("Срок: Неизвестно");
    expect(html).toContain("0 / 20");
    expect(html).toContain("Данные могут быть устаревшими");
    expect(html).toContain("Quiz close dates were not exposed");
    expect(html).toContain("Отсутствие оценки не означает");
  });

  it("offers manual fallback without requesting any session on mount", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ManualLmsWorkForm),
      ),
    );
    expect(html).toContain("Добавить вручную");
    expect(html).toContain("Ручные записи не меняют данные LMS");
    expect(fetch).not.toHaveBeenCalled();
    client.clear();
  });
});
