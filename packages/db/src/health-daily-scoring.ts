import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateHealthIngestDaily } from "@lifeos/core";
import type { Database } from "./types.js";

/** Recompute only derived cache fields from a guarded, owner-scoped stored snapshot. */
export async function recalculateHealthDailyScores(
  client: SupabaseClient<Database>,
  userId: string,
  date: string,
  dailyId: string,
) {
  const columns = {
    sleepMinutes: "sleep_minutes",
    deepSleepMinutes: "deep_sleep_minutes",
    remSleepMinutes: "rem_sleep_minutes",
    awakeMinutes: "awake_minutes",
    restingHeartRate: "resting_heart_rate",
    hrvMs: "hrv_ms",
    steps: "steps",
    activeEnergyKcal: "active_energy_kcal",
    caloriesBurned: "calories_burned",
    spo2Avg: "spo2_avg",
    moodScore: "mood_score",
    energyScore: "energy_score",
    stressScore: "stress_score",
  } as const;
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await client
      .from("health_daily")
      .select("*")
      .eq("user_id", userId)
      .eq("log_date", date)
      .eq("id", dailyId)
      .single();
    if (snapshot.error) throw new Error("Failed to load health scoring state");
    const row = snapshot.data;
    const [workouts, samples] = await Promise.all([
      client
        .from("health_workouts")
        .select("id")
        .eq("user_id", userId)
        .eq("health_daily_id", dailyId)
        .limit(1),
      client
        .from("health_samples")
        .select("id")
        .eq("user_id", userId)
        .eq("health_daily_id", dailyId)
        .limit(1),
    ]);
    if (workouts.error)
      throw new Error("Failed to load health workout availability");
    if (samples.error)
      throw new Error("Failed to load health sample availability");
    const metrics = Object.fromEntries(
      Object.entries(columns).flatMap(([metric, column]) =>
        row[column] === null || row[column] === undefined
          ? []
          : [[metric, Number(row[column])]],
      ),
    );
    const computed = calculateHealthIngestDaily({
      metrics,
      workouts: { length: workouts.data.length },
      samples: { length: samples.data.length },
      missing: {},
    });
    // Update derived fields only. Never copy a stale measurement snapshot back
    // over a concurrent ingest. Values supplement the existing timestamp fence
    // because its legacy now() trigger is not a strictly monotonic revision.
    let update = client
      .from("health_daily")
      .update({
        recovery_mode: computed.recoveryMode,
        data_completeness_score: computed.dataCompletenessScore,
      })
      .eq("user_id", userId)
      .eq("log_date", date)
      .eq("id", dailyId)
      .eq("updated_at", row.updated_at);
    for (const column of Object.values(columns)) {
      update =
        row[column] === null || row[column] === undefined
          ? update.is(column, null)
          : update.eq(column, row[column]);
    }
    const saved = await update.select("id").maybeSingle();
    if (saved.error) throw new Error("Failed to save health scoring state");
    if (saved.data) return computed;
  }
  throw new Error(
    "Health daily changed during score calculation; retry the sync",
  );
}
