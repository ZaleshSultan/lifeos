import { DailyLifeInputError, dailyLifeObject } from "./daily-life.js";
import type { IdealHumanMeal } from "./ideal-human.js";

/** Apply only explicitly reviewed items to the latest journal copy, by stable draft IDs. */
export function mergeReviewedMeals(
  existing: IdealHumanMeal[],
  reviewed: IdealHumanMeal[],
): IdealHumanMeal[] {
  const replacements = new Map(reviewed.map((meal) => [meal.id, meal]));
  const result = existing.map((meal) => {
    const replacement = replacements.get(meal.id);
    replacements.delete(meal.id);
    return replacement ?? meal;
  });
  return [...result, ...replacements.values()];
}
export interface MealPhotoItem {
  label: string;
  portion: string | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}
export interface MealPhotoDraft {
  draftId: string;
  date?: string;
  expiresAt: string;
  items: MealPhotoItem[];
  uncertainty: string[];
  source: "gemini" | "openrouter" | "openai" | "anthropic" | "chatgpt_plan";
  modelRoute?: import("./ai-execution.js").AiModelRouteReceipt;
  estimated: true;
  requiresReview: true;
}
/** A model suggestion is never a persisted meal. Missing quantities remain null. */
export function parseMealPhotoItems(
  input: unknown,
): Pick<MealPhotoDraft, "items" | "uncertainty"> {
  const v = dailyLifeObject(input, ["items", "uncertainty"]);
  if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > 8)
    throw new DailyLifeInputError("The photo did not yield a reviewable meal");
  const number = (value: unknown, key: string, max: number): number | null => {
    if (value == null) return null;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > max
    )
      throw new DailyLifeInputError("Invalid estimated " + key);
    return key === "calories" ? Math.round(value) : Math.round(value * 10) / 10;
  };
  const items = v.items.map((item) => {
    const m = dailyLifeObject(item, [
      "label",
      "portion",
      "caloriesKcal",
      "proteinG",
      "fatG",
      "carbsG",
    ]);
    if (typeof m.label !== "string" || !m.label.trim() || m.label.length > 240)
      throw new DailyLifeInputError("Invalid food label");
    if (
      m.portion != null &&
      (typeof m.portion !== "string" || m.portion.length > 240)
    )
      throw new DailyLifeInputError("Invalid portion description");
    return {
      label: m.label.trim(),
      portion: typeof m.portion === "string" ? m.portion.trim() || null : null,
      caloriesKcal: number(m.caloriesKcal, "calories", 10000),
      proteinG: number(m.proteinG, "protein", 400),
      fatG: number(m.fatG, "fat", 1000),
      carbsG: number(m.carbsG, "carbohydrates", 2000),
    };
  });
  if (
    !Array.isArray(v.uncertainty) ||
    v.uncertainty.length > 8 ||
    v.uncertainty.some((s) => typeof s !== "string" || s.length > 500)
  )
    throw new DailyLifeInputError("Invalid uncertainty notes");
  return {
    items,
    uncertainty: [
      "Фото даёт приблизительную оценку. Количество, ингредиенты и порции могут быть определены неверно.",
      ...(v.uncertainty as string[]),
    ],
  };
}
