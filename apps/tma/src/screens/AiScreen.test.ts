import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({ telegram: { initData: "signed-session" } }));

import type { AiStatus } from "../api/planning";
import {
  AiActionConfirmation,
  AiScreen,
  AiSuggestions,
  AiToolResult,
} from "./AiScreen";

afterEach(() => vi.unstubAllGlobals());

function renderAi(status: AiStatus): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["ai", "status"], status);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AiScreen, { onBack: () => undefined, date: "2026-10-11" }),
    ),
  );
  client.clear();
  return html;
}

describe("Optional LifeOS AI interface", () => {
  it("keeps the composer unavailable while AI is disabled or credentials are missing", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const disabled = renderAi({
      enabled: false,
      available: false,
      reason: "ai_disabled",
      liveEnabled: false,
    });
    const unconfigured = renderAi({
      enabled: true,
      available: false,
      reason: "ai_missing_credentials",
      liveEnabled: false,
    });
    expect(disabled).toContain("AI assistance is disabled");
    expect(disabled).toContain("Back to Today");
    expect(unconfigured).toContain("not configured");
    expect(disabled).not.toContain("textarea");
    expect(unconfigured).not.toContain("textarea");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a text-only, read-only composer with data-sharing disclosure before sending", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const html = renderAi({
      enabled: true,
      available: true,
      reason: null,
      liveEnabled: false,
    });
    expect(html).toContain("textarea");
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("Google Gemini");
    expect(html).toContain("private commitment times");
    expect(html).toContain("Health and finance records are excluded");
    expect(html).toContain("Anything you type is sent");
    expect(html).toContain("It cannot change your data");
    expect(html).toContain("Clear conversation");
    expect(html).not.toContain("microphone");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("labels validated suggestions with task titles and provisional estimates", () => {
    const html = renderToStaticMarkup(
      createElement(AiSuggestions, {
        timezone: "Asia/Almaty",
        suggestions: [
          {
            taskId: "hidden-reference",
            title: "Prepare university report",
            estimated: true,
            startsAt: "2026-10-10T04:00:00Z",
            endsAt: "2026-10-10T04:30:00Z",
          },
        ],
      }),
    );
    expect(html).toContain("Prepare university report");
    expect(html).toContain("Duration estimated");
    expect(html).toContain("These suggestions have not been saved");
    expect(html).not.toContain("hidden-reference");
  });

  it("opens deterministic assistant tools without Gemini and explains saved memory controls", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const html = renderAi({
      enabled: false,
      available: false,
      reason: "ai_disabled",
      liveEnabled: false,
      assistantEnabled: true,
    });
    expect(html).toContain("textarea");
    expect(html).toContain("English or Russian");
    expect(html).toContain("Review and confirm changes");
    expect(html).toContain("show memories");
    expect(html).toContain("does not erase saved memories");
    expect(html).toContain("archive memory study.time");
    expect(html).toContain("delete memory study.time");
    expect(html).toContain("Permanent deletion may be disabled");
    expect(html).toContain("without sending them to an AI provider");
    expect(html).toContain("Gemini planning is currently unavailable");
    expect(html).not.toContain("It cannot change your data");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows tool execution and known or unknown source freshness without internal tool identifiers", () => {
    const html = renderToStaticMarkup(
      createElement(AiToolResult, {
        timezone: "Asia/Almaty",
        answer: {
          answer: "DBMS is next.",
          suggestions: [],
          provider: "lifeos",
          readOnly: true,
          tool: {
            name: "internal-tool-reference",
            permission: "READ",
            status: "completed",
            summary: "Read your next class.",
          },
          sources: [
            { name: "Class schedule", updatedAt: "2026-10-11T04:00:00Z" },
            { name: "Moodle grades", updatedAt: null },
          ],
        },
      }),
    );
    expect(html).toContain("LifeOS tools · Completed");
    expect(html).toContain("Read your next class");
    expect(html).toContain("Class schedule");
    expect(html).toContain("Updated");
    expect(html).toContain("Asia/Almaty");
    expect(html).toContain("Moodle grades");
    expect(html).toContain("Freshness unknown");
    expect(html).not.toContain("internal-tool-reference");
  });

  it("shows explicit confirmation and cancel controls before a change", () => {
    const html = renderToStaticMarkup(
      createElement(AiActionConfirmation, {
        summary: "Remember your preference for morning study.",
        onConfirm: () => undefined,
        onCancel: () => undefined,
        disabled: false,
      }),
    );
    expect(html).toContain("Remember your preference for morning study");
    expect(html).toContain("Nothing has been changed yet");
    expect(html).toContain("Confirm change");
    expect(html).toContain("Cancel");
  });

  it("does not expose confirmation tokens and distinguishes local cancellation", () => {
    const html = renderToStaticMarkup(
      createElement(AiToolResult, {
        timezone: "UTC",
        cancelled: true,
        answer: {
          answer: "Please confirm.",
          provider: "lifeos",
          readOnly: true,
          suggestions: [],
          tool: {
            name: "memory.upsert",
            permission: "WRITE",
            status: "pending_confirmation",
            summary: "Save your preference.",
          },
          confirmation: {
            token: "private-confirmation-authority",
            summary: "Save your preference.",
          },
        },
      }),
    );
    expect(html).toContain("Confirmation cancelled");
    expect(html).toContain("You did not confirm this change");
    expect(html).not.toContain("private-confirmation-authority");
    expect(html).not.toContain("Awaiting confirmation");
  });
});
