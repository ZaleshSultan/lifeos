import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { sectionForScreen } from "../lib/navigation";
import type { ScreenId } from "../types";

describe("unified TMA shell", () => {
  it.each([
    "home",
    "capture",
    "workout",
    "study",
    "dashboard",
    "lms",
    "sources",
    "reminders",
    "settings",
  ] as ScreenId[])("marks exactly one primary section for %s", (screen) => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        screen,
        onScreenChange: vi.fn(),
        children: "Synthetic content",
      }),
    );
    const nav =
      html.match(/<nav aria-label="Разделы LifeOS"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect((nav.match(/<button/g) ?? []).length).toBe(4);
    expect((nav.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(nav).not.toContain("Ещё");
    const labels = {
      home: "Главная",
      health: "Здоровье",
      study: "Учёба",
      settings: "Настройки",
    };
    expect(nav).toMatch(
      new RegExp(
        `aria-label="${labels[sectionForScreen(screen)]}" aria-current="page"`,
      ),
    );
  });
  it("does not expose primary or contextual navigation before authentication", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        screen: "home",
        onScreenChange: vi.fn(),
        showNavigation: false,
        children: "Authenticate",
      }),
    );
    expect(html).not.toContain("<nav");
  });
});
