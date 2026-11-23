import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { fullBodyTemplate } from "@lifeos/core/personal-workout";
import { personalKey } from "../api/personal-workout";
import { PersonalTemplateCard } from "./PersonalTemplate";

vi.mock("../telegram", () => ({ telegram: { hapticImpact: vi.fn() } }));

function renderCard(activeWorkoutTitle?: string) {
  const client = new QueryClient();
  client.setQueryData([...personalKey, 7], {
    revision: 0,
    exercises: fullBodyTemplate(),
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(PersonalTemplateCard, {
        account: 7,
        activeWorkoutTitle,
        onStart: vi.fn(),
      }),
    ),
  );
}
describe("personal workout template", () => {
  it("opens the routine directly and shows each planned set with its load convention", () => {
    const html = renderCard();
    expect(html).not.toContain("<details");
    expect(html.indexOf("Начать тренировку")).toBeLessThan(
      html.indexOf("Приседания в Смите"),
    );
    expect(html).toContain("35 кг × 12 · 35 кг × 8 · 30 кг × 10 · 25 кг × 12");
    expect(html).toContain("9 кг × 12 · 9 кг × 12");
    expect(html).toContain("Вес одной гантели · 2 гантели");
  });
  it("preserves access to the template and explains an existing session", () => {
    const html = renderCard("День ног");
    expect(html).toContain("Сначала заверши тренировку «День ног»");
    expect(html).not.toContain(">Начать тренировку</button>");
    expect(html).toContain("Настроить шаблон");
    expect(html).toContain("Махи гантелями в стороны");
  });
});
