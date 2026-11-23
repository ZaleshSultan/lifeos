import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { fullBodyTemplate } from "@lifeos/core/personal-workout";
import { personalKey, usePersonalTemplateQuery } from "../api/personal-workout";
import { PersonalTemplateCard } from "./PersonalTemplate";

vi.mock("../telegram", () => ({ telegram: { hapticImpact: vi.fn() } }));

function renderCard(activeWorkoutTitle?: string, resume?: () => void) {
  const client = new QueryClient();
  client.setQueryData([...personalKey, 7], {
    revision: 0,
    exercises: fullBodyTemplate(),
  });
  function Card() {
    const query = usePersonalTemplateQuery(7);
    return createElement(PersonalTemplateCard, {
      account: 7,
      activeWorkoutTitle,
      onStart: vi.fn(),
      resume,
      query,
    });
  }
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Card)),
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
  it("resumes an active personal session and keeps its template editable", () => {
    const html = renderCard("Мой Full Body", vi.fn());
    expect(html).toContain("Продолжить тренировку");
    expect(html).toContain("Настроить шаблон");
    expect(html).not.toContain(">Начать тренировку</button>");
    expect(html).not.toContain("Сначала заверши");
  });
});
