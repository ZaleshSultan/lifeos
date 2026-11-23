import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("mobile navigation", () => {
  it("opens workouts from a permanent tab and highlights it on the workout screen", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        screen: "workout",
        onScreenChange: () => true,
        children: null,
      }),
    );
    const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    expect(nav?.match(/<button\b/g)).toHaveLength(5);
    const active = nav?.match(/<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    expect(active).toContain("Тренировки");
    expect(html.match(/Тренировки/g)).toHaveLength(1);
  });
});
