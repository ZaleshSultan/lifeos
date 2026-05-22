import type { HealthMode, LifeMode, LifeModeSource } from "./types.js";

export const LIFE_MODES: readonly LifeMode[] = [
  "exam_war",
  "summer",
  "trimester",
  "recovery",
  "project_sprint",
  "maintenance",
] as const;

export const LIFE_MODE_LABELS: Record<LifeMode, string> = {
  exam_war: "Exam War Mode",
  summer: "Summer Mode",
  trimester: "Trimester Mode",
  recovery: "Recovery Mode",
  project_sprint: "Project Sprint",
  maintenance: "Maintenance Mode",
};

export const DEFAULT_LIFE_MODE_PRIORITY_WEIGHTS: Record<
  LifeMode,
  Record<string, number>
> = {
  exam_war: {
    study: 100,
    deadline: 100,
    health: 20,
    fitness: 10,
    projects: -30,
    finance: 20,
  },
  summer: {
    projects: 90,
    cybersecurity: 80,
    health: 70,
    fitness: 60,
    finance: 50,
    study: 20,
  },
  recovery: {
    health: 100,
    sleep: 100,
    critical: 70,
    heavy_fitness: -100,
    projects: 10,
  },
  trimester: {
    study: 70,
    health: 40,
    finance: 30,
    projects: 30,
  },
  project_sprint: {
    current_project: 100,
    health: 40,
    finance: 30,
    distractions: -80,
  },
  maintenance: {
    health: 50,
    finance: 40,
    urgent: 80,
  },
};

export interface LifeModeRecord {
  id?: string;
  userId: string;
  mode: LifeMode;
  source: LifeModeSource;
  reason?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
  isActive?: boolean;
  priorityJson?: Record<string, number>;
  createdAt?: string | null;
}

export interface LifeSeasonRecord {
  id?: string;
  userId: string;
  name: string;
  mode: LifeMode;
  startsOn: string;
  endsOn: string;
  priorityJson?: Record<string, number>;
  createdAt?: string | null;
}

export interface LifeModeHealthSignal {
  userId?: string;
  sleepMinutes?: number | null;
  recoveryMode?: HealthMode | boolean | string | null;
  logDate?: string | null;
}

export interface LifeModeProjectSprint {
  id?: string;
  userId: string;
  name?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  priorityJson?: Record<string, number>;
}

export interface LifeModeResolutionInput {
  now?: Date | string;
  manualOverrides?: LifeModeRecord[];
  latestHealthDaily?: LifeModeHealthSignal | null;
  seasons?: LifeSeasonRecord[];
  projectSprint?: LifeModeProjectSprint | null;
  defaultMode?: LifeMode;
}

export interface LifeModeResolution {
  userId: string;
  mode: LifeMode;
  label: string;
  source: LifeModeSource | "default";
  reason: string;
  activeUntil: string | null;
  priorityWeights: Record<string, number>;
  matchedRecordId?: string;
  resolvedAt: string;
}

export interface FocusScoringItem {
  title?: string | null;
  entityType?: string | null;
  domain?: string | null;
  tags?: string[];
  priority?: number | null;
  score?: number | null;
  dueAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type ModeAwareFocusItem<T extends FocusScoringItem> = T & {
  modeScore: number;
  modePriorityDelta: number;
  modePriorityMatches: string[];
};

export function isLifeMode(value: string): value is LifeMode {
  return (LIFE_MODES as readonly string[]).includes(value);
}

export function parseLifeMode(value: string): LifeMode | null {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  return isLifeMode(normalized) ? normalized : null;
}

export function getModeLabel(mode: LifeMode): string {
  return LIFE_MODE_LABELS[mode];
}

export function getModePriorityWeights(mode: LifeMode): Record<string, number> {
  return { ...DEFAULT_LIFE_MODE_PRIORITY_WEIGHTS[mode] };
}

export function resolveCurrentMode(
  userId: string,
  input: LifeModeResolutionInput = {},
): LifeModeResolution {
  const now =
    typeof input.now === "string"
      ? new Date(input.now)
      : (input.now ?? new Date());
  const resolvedAt = now.toISOString();
  const today = resolvedAt.slice(0, 10);

  const manual = [...(input.manualOverrides ?? [])]
    .filter((record) => {
      return (
        record.userId === userId &&
        record.source === "manual" &&
        record.isActive !== false &&
        isActiveAt(record.activeFrom, record.activeUntil, now)
      );
    })
    .sort(compareModeRecords)
    .at(0);

  if (manual) {
    return buildResolution({
      userId,
      mode: manual.mode,
      source: "manual",
      reason: manual.reason ?? "Manual override is active.",
      activeUntil: manual.activeUntil ?? null,
      priorityJson: manual.priorityJson,
      matchedRecordId: manual.id,
      resolvedAt,
    });
  }

  const health = input.latestHealthDaily;
  const healthBelongsToUser = !health?.userId || health.userId === userId;

  if (health && healthBelongsToUser && indicatesRecovery(health)) {
    return buildResolution({
      userId,
      mode: "recovery",
      source: "health",
      reason:
        typeof health.sleepMinutes === "number" && health.sleepMinutes < 330
          ? `Latest health daily has ${health.sleepMinutes} minutes of sleep.`
          : "Latest health daily is in recovery mode.",
      activeUntil: null,
      resolvedAt,
    });
  }

  const season = [...(input.seasons ?? [])]
    .filter((record) => {
      return (
        record.userId === userId &&
        record.startsOn <= today &&
        record.endsOn >= today
      );
    })
    .sort((left, right) => right.startsOn.localeCompare(left.startsOn))
    .at(0);

  if (season) {
    return buildResolution({
      userId,
      mode: season.mode,
      source: "season",
      reason: `Active season: ${season.name}.`,
      activeUntil: endOfDateUtc(season.endsOn),
      priorityJson: season.priorityJson,
      matchedRecordId: season.id,
      resolvedAt,
    });
  }

  const sprint = input.projectSprint;

  if (
    sprint &&
    sprint.userId === userId &&
    isDateActive(today, sprint.startsOn, sprint.endsOn)
  ) {
    return buildResolution({
      userId,
      mode: "project_sprint",
      source: "sprint",
      reason: sprint.name
        ? `Active project sprint: ${sprint.name}.`
        : "Active project sprint is configured.",
      activeUntil: sprint.endsOn ? endOfDateUtc(sprint.endsOn) : null,
      priorityJson: sprint.priorityJson,
      matchedRecordId: sprint.id,
      resolvedAt,
    });
  }

  const defaultMode = input.defaultMode ?? "trimester";

  return buildResolution({
    userId,
    mode: defaultMode,
    source: "default",
    reason: "No manual override, recovery signal, season, or sprint is active.",
    activeUntil: null,
    resolvedAt,
  });
}

export function explainModeReason(modeResolution: LifeModeResolution): string {
  return `${modeResolution.label} is active from ${modeResolution.source}: ${modeResolution.reason}`;
}

export function applyModeToFocusScoring<T extends FocusScoringItem>(
  items: T[],
  mode: LifeMode,
): Array<ModeAwareFocusItem<T>> {
  const weights = getModePriorityWeights(mode);

  return items
    .map((item) => {
      const matches = matchedPriorityKeys(item);
      const modePriorityMatches = [...matches].filter(
        (match) => weights[match] !== undefined,
      );
      const modePriorityDelta = modePriorityMatches.reduce(
        (sum, match) => sum + weights[match],
        0,
      );
      const baseScore = item.score ?? item.priority ?? 0;

      return {
        ...item,
        modeScore: baseScore + modePriorityDelta,
        modePriorityDelta,
        modePriorityMatches,
      };
    })
    .sort((left, right) => right.modeScore - left.modeScore);
}

function buildResolution(input: {
  userId: string;
  mode: LifeMode;
  source: LifeModeResolution["source"];
  reason: string;
  activeUntil: string | null;
  priorityJson?: Record<string, number>;
  matchedRecordId?: string;
  resolvedAt: string;
}): LifeModeResolution {
  return {
    userId: input.userId,
    mode: input.mode,
    label: getModeLabel(input.mode),
    source: input.source,
    reason: input.reason,
    activeUntil: input.activeUntil,
    priorityWeights: {
      ...getModePriorityWeights(input.mode),
      ...(input.priorityJson ?? {}),
    },
    matchedRecordId: input.matchedRecordId,
    resolvedAt: input.resolvedAt,
  };
}

function isActiveAt(
  activeFrom: string | null | undefined,
  activeUntil: string | null | undefined,
  now: Date,
): boolean {
  const nowMs = now.getTime();

  if (activeFrom && new Date(activeFrom).getTime() > nowMs) {
    return false;
  }

  if (activeUntil && new Date(activeUntil).getTime() <= nowMs) {
    return false;
  }

  return true;
}

function compareModeRecords(
  left: LifeModeRecord,
  right: LifeModeRecord,
): number {
  const activeFrom = String(right.activeFrom ?? "").localeCompare(
    String(left.activeFrom ?? ""),
  );

  if (activeFrom !== 0) {
    return activeFrom;
  }

  return String(right.createdAt ?? "").localeCompare(
    String(left.createdAt ?? ""),
  );
}

function indicatesRecovery(signal: LifeModeHealthSignal): boolean {
  if (typeof signal.sleepMinutes === "number" && signal.sleepMinutes < 330) {
    return true;
  }

  return signal.recoveryMode === true || signal.recoveryMode === "recovery";
}

function isDateActive(
  today: string,
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): boolean {
  return (!startsOn || startsOn <= today) && (!endsOn || endsOn >= today);
}

function endOfDateUtc(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function matchedPriorityKeys(item: FocusScoringItem): Set<string> {
  const matches = new Set<string>();
  const metadata = item.metadata ?? {};
  const title = item.title?.toLowerCase() ?? "";
  const entityType = normalizeKey(item.entityType ?? "");
  const domain = normalizeKey(item.domain ?? "");
  const tags = item.tags?.map(normalizeKey) ?? [];
  const metadataKeys = [
    metadataKey(metadata.priorityKey),
    ...metadataArray(metadata.priorityKeys),
    ...metadataArray(metadata.tags),
    metadataKey(metadata.area),
    metadataKey(metadata.domain),
    metadataKey(metadata.category),
  ].filter(Boolean) as string[];

  for (const value of [entityType, domain, ...tags, ...metadataKeys]) {
    addSynonyms(matches, value);
  }

  if (item.dueAt || entityType === "deadline") {
    matches.add("deadline");
    matches.add("urgent");
  }

  if (metadata.current_project === true) {
    matches.add("current_project");
  }

  if (metadata.critical === true) {
    matches.add("critical");
  }

  if (metadata.distraction === true || metadata.distractions === true) {
    matches.add("distractions");
  }

  if (metadata.heavy_fitness === true || metadata.heavyFitness === true) {
    matches.add("heavy_fitness");
  }

  addTitleMatches(matches, title);

  return matches;
}

function metadataKey(value: unknown): string | null {
  return typeof value === "string" ? normalizeKey(value) : null;
}

function metadataArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map(normalizeKey)
    : [];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function addSynonyms(matches: Set<string>, value: string): void {
  if (!value) {
    return;
  }

  matches.add(value);

  if (["project", "projects"].includes(value)) {
    matches.add("projects");
  }

  if (["money", "spend", "budget", "finance"].includes(value)) {
    matches.add("finance");
  }

  if (["workout", "exercise", "gym", "fitness"].includes(value)) {
    matches.add("fitness");
  }

  if (["security", "cyber", "cybersecurity", "ctf"].includes(value)) {
    matches.add("cybersecurity");
  }
}

function addTitleMatches(matches: Set<string>, title: string): void {
  const titleMatchers: Array<[string, RegExp]> = [
    ["study", /\b(study|exam|course|lecture|reading|assignment|homework)\b/i],
    ["deadline", /\b(deadline|due|submit|exam)\b/i],
    ["projects", /\b(project|build|ship|launch)\b/i],
    ["cybersecurity", /\b(cyber|security|ctf|hack)\b/i],
    ["health", /\b(health|doctor|meds|medicine|therapy)\b/i],
    ["sleep", /\b(sleep|nap|rest)\b/i],
    ["fitness", /\b(workout|gym|run|lift|cardio)\b/i],
    ["finance", /\b(finance|budget|pay|invoice|tax|spend)\b/i],
    ["critical", /\b(critical|blocker|incident)\b/i],
    ["urgent", /\b(urgent|asap|today)\b/i],
    ["distractions", /\b(scroll|social|youtube|game)\b/i],
  ];

  for (const [key, matcher] of titleMatchers) {
    if (matcher.test(title)) {
      matches.add(key);
    }
  }
}
