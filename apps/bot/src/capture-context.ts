import { projectDailyHealth } from "@lifeos/core";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";

/** Owner-only factual reads. Never submits health/context to an external model. */
export async function captureSavedFacts(
  store: LifeOSStore,
  user: TelegramUserRecord,
  date: string,
  now: Date,
): Promise<{ facts: string[]; warnings: string[] }> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => store.getIdealHumanDays?.(user.userId) ?? []),
    Promise.resolve().then(() => store.getHealthMetricDay(user.userId, date)),
    Promise.resolve().then(() => store.getWorkoutProgram(user.userId)),
    Promise.resolve().then(() =>
      store.getCurrentWorkout({ userId: user.userId }),
    ),
  ] as const);
  const facts: string[] = [],
    warnings: string[] = [];
  const day =
    results[0].status === "fulfilled"
      ? (results[0].value.find((day) => day.date === date) ?? null)
      : null;
  if (results[0].status === "rejected")
    warnings.push("Saved Ideal Human activity is unavailable.");
  if (day) {
    const pending = day.plan
      .flatMap((block) =>
        block.tasks.filter((task) => !task.completed).map((task) => task.title),
      )
      .slice(0, 4);
    if (pending.length)
      facts.push(
        "Saved journal items not marked complete: " +
          pending.join("; ").slice(0, 700),
      );
    if (day.workoutNotes.trim())
      facts.push("Recorded workout note: " + day.workoutNotes.slice(0, 240));
    if (day.learningSessions.length)
      facts.push(
        `Saved learning entries: ${day.learningSessions.length}; completion is recorded per entry.`,
      );
    if (day.footageCaptured !== null)
      facts.push(
        "Footage recorded as captured: " + (day.footageCaptured ? "yes" : "no"),
      );
  } else
    facts.push(
      "No saved Ideal Human day is available for this date; template activities are not treated as commitments.",
    );
  {
    const metric =
      results[1].status === "fulfilled"
        ? results[1].value
        : { metrics: {}, records: [] };
    const health = projectDailyHealth({
      date,
      manual: day,
      metrics: metric.metrics,
      records: metric.records,
      now,
    });
    for (const [label, measurement] of [
      ["Sleep", health.sleepMinutes],
      ["Steps", health.steps],
      ["Workout activity", health.workoutMinutes],
    ] as const) {
      if (measurement)
        facts.push(
          `${label}: ${measurement.value} ${measurement.unit} (${measurement.source.slice(0, 80)}${measurement.stale ? ", stale" : ""}).`,
        );
    }
    if (health.missing.length)
      facts.push(
        "Missing recorded health fields: " +
          health.missing.join(", ") +
          ". No values inferred.",
      );
    warnings.push(...health.warnings);
  }
  if (results[1].status === "rejected")
    warnings.push(
      "Recorded health is unavailable; no health assumptions were made.",
    );
  if (results[2].status === "fulfilled" && results[2].value) {
    const program = results[2].value;
    facts.push(
      "Saved workout program: " +
        program.title.slice(0, 120) +
        ". Available sessions: " +
        program.days
          .slice(0, 3)
          .map((day) => day.title.slice(0, 100))
          .join("; ") +
        ". No session time or completion assumed.",
    );
  } else if (results[2].status === "rejected")
    warnings.push("Saved workout program is unavailable.");
  if (results[3].status === "fulfilled" && results[3].value) {
    const workout = results[3].value;
    facts.push(
      `Active workout: ${workout.title.slice(0, 160)}; ${workout.completedSets}/${workout.totalSets} sets recorded. It has not been marked complete by capture.`,
    );
  } else if (results[3].status === "rejected")
    warnings.push("Active workout status is unavailable.");
  return { facts: facts.slice(0, 12), warnings };
}
