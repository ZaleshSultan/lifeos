import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({ telegram: { initData: "signed-session" } }));

import type { AiStatus } from "../api/planning";
import { AiScreen, AiSuggestions } from "./AiScreen";

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
});
