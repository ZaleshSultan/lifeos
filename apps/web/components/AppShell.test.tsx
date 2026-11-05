import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/web/today", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean;
  }) => <a {...props}>{children}</a>,
}));
import { AppShell } from "./AppShell";
describe("web shell primary navigation", () => {
  it.each([
    ["/web/planner", "Главная"],
    ["/web/workouts", "Здоровье"],
    ["/web/nutrition", "Здоровье"],
    ["/web/study", "Учёба"],
    ["/web/notifications", "Настройки"],
  ])("shows four primary sections for %s", (pathname, active) => {
    route.pathname = pathname;
    route.search = "courseId=fixture&date=2026-01-02";
    const html = renderToStaticMarkup(
      <AppShell
        draftOwner={900001}
        systemStatus={{
          apiBaseUrl: null,
          checkedAt: "",
          label: "Fixture",
          online: false,
          shortLabel: "Fixture",
        }}
      >
        <p>Content</p>
      </AppShell>,
    );
    const navs = [
      ...html.matchAll(
        /<nav aria-label="Основные разделы LifeOS"[^>]*>([\s\S]*?)<\/nav>/g,
      ),
    ];
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(nav[1].match(/<a /g)).toHaveLength(4);
      expect(nav[1].match(/aria-current="page"/g)).toHaveLength(1);
      expect(nav[1]).toMatch(
        new RegExp(
          'aria-current="page"[\\s\\S]*?<span>' + active + "<\\/span>",
        ),
      );
      expect(nav[1]).toContain("courseId=fixture");
      expect(nav[1]).toContain("date=2026-01-02");
    }
    expect(html).not.toContain("Все разделы");
    expect(html).not.toContain(">Ещё<");
  });
});
