import { resolveHealthMode } from "./health.js";
import type { FocusScoreInput, FocusScoreResult, HealthMode } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function score10(value: number | undefined, fallback: number): number {
  return clamp(value ?? fallback, 1, 10) / 10;
}

function sleepScore(hours: number | undefined): number {
  if (hours === undefined) {
    return 0.7;
  }

  if (hours >= 7.5) {
    return 1;
  }

  if (hours >= 7) {
    return 0.9;
  }

  if (hours >= 6) {
    return 0.75;
  }

  if (hours >= 5) {
    return 0.55;
  }

  return 0.25;
}

function healthModePenalty(mode: HealthMode): number {
  switch (mode) {
    case "recovery":
      return 25;
    case "maintenance":
      return 12;
    case "baseline":
      return 4;
    case "growth":
      return 0;
  }
}

export function scoreFocus(input: FocusScoreInput): FocusScoreResult {
  const mode = input.healthMode ?? resolveHealthMode(input);
  const taskLoadPenalty = Math.min(input.openTaskCount ?? 0, 10);
  const raw =
    score10(input.energyScore, 6) * 30 +
    score10(input.moodScore, 6) * 20 +
    sleepScore(input.sleepHours) * 25 +
    (1 - score10(input.stressScore, 4)) * 25 -
    healthModePenalty(mode) -
    taskLoadPenalty;
  const score = Math.round(clamp(raw, 0, 100));
  const reasons: string[] = [];

  if (mode === "recovery") {
    reasons.push("recovery-mode");
  }

  if ((input.sleepHours ?? 8) < 6) {
    reasons.push("low-sleep");
  }

  if ((input.stressScore ?? 1) >= 7) {
    reasons.push("high-stress");
  }

  if ((input.openTaskCount ?? 0) >= 8) {
    reasons.push("high-task-load");
  }

  return {
    score,
    band: score >= 75 ? "high" : score >= 45 ? "medium" : "low",
    reasons,
  };
}
