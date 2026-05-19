import type { HealthMode, HealthSignals, Score10 } from "./types.js";

export const HEALTH_MODE_LABELS: Record<HealthMode, string> = {
  recovery: "Recovery Mode",
  maintenance: "Normal-Light",
  baseline: "Normal",
  growth: "High Performance",
};

export function healthModeLabel(mode: HealthMode): string {
  return HEALTH_MODE_LABELS[mode];
}

function highestScore(scores: Score10[] | undefined): number {
  return Math.max(0, ...(scores ?? []));
}

export function resolveHealthMode(signals: HealthSignals): HealthMode {
  const severeSymptom = highestScore(signals.symptomSeverities) >= 8;

  if (
    severeSymptom ||
    (signals.sleepHours ?? 8) < 4 ||
    (signals.stressScore ?? 1) >= 9
  ) {
    return "recovery";
  }

  if (
    (signals.sleepHours ?? 8) < 6 ||
    (signals.energyScore ?? 10) <= 4 ||
    (signals.moodScore ?? 10) <= 4 ||
    (signals.stressScore ?? 1) >= 7 ||
    highestScore(signals.symptomSeverities) >= 5
  ) {
    return "maintenance";
  }

  if (
    (signals.sleepHours ?? 0) >= 7 &&
    (signals.energyScore ?? 0) >= 7 &&
    (signals.moodScore ?? 0) >= 7 &&
    (signals.stressScore ?? 10) <= 4 &&
    highestScore(signals.symptomSeverities) === 0
  ) {
    return "growth";
  }

  return "baseline";
}
