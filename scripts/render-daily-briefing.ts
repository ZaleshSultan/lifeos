/** Internal deterministic renderer; never sends notifications or invokes a model. */
import { createBotDependencies } from "../apps/bot/src/dependencies.js";
import { dailyLifeSummary } from "../apps/bot/src/daily-life-routes.js";
import { dailyLifeDate, dailyLifeObject } from "@lifeos/core";
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 8192) throw new Error("bounded_input");
  }
  const v = dailyLifeObject(JSON.parse(raw), [
    "userId",
    "date",
    "kind",
    "includeHealth",
    "includeFilming",
  ]);
  if (
    typeof v.userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v.userId,
    ) ||
    !["morning", "evening"].includes(String(v.kind)) ||
    typeof v.includeHealth !== "boolean" ||
    typeof v.includeFilming !== "boolean"
  )
    throw new Error("invalid_input");
  const date = dailyLifeDate(v.date);
  const { store } = createBotDependencies({
    ...process.env,
    NODE_ENV: "production",
  });
  if (!store) throw new Error("unavailable");
  const user = await store.resolveUserById(v.userId);
  if (!user || user.status !== "active") throw new Error("inactive");
  const preferences = await store.dailyLife?.preferences(user.userId);
  if (!preferences) throw new Error("unavailable");
  const includeHealth = v.includeHealth && preferences.includeHealth;
  const includeFilming = v.includeFilming && preferences.includeFilming;
  const data = await dailyLifeSummary(store, user, date, new Date(), {
    includeHealth,
    includeFilming,
  });
  const view = v.kind === "morning" ? data.morning : data.evening;
  const lines = [
    `${view.title} · ${date} · ${user.timezone}`,
    "Факты:",
    ...view.facts.map((s) => "• " + s),
    ...view.warnings.map((s) => "⚠ " + s),
    "Предложения (ничего не изменено):",
    ...view.suggestions.map((s) => "• " + s),
    ...view.questions.map((s) => "• " + s),
    ...data.sourceWarnings
      .filter((s) => includeHealth || !/^(?:Health|Workouts) /.test(s))
      .map((s) => "⚠ " + s),
  ];
  let text = "";
  for (const line of lines) {
    if (
      Buffer.byteLength(text + line, "utf8") > 6800 ||
      text.length + line.length > 3700
    ) {
      text += "\nОткрой LifeOS для полного обзора.";
      break;
    }
    text += (text ? "\n" : "") + line;
  }
  process.stdout.write(JSON.stringify({ ok: true, text }));
}
main().catch(() => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: "daily_briefing_unavailable" }),
  );
  process.exitCode = 1;
});
