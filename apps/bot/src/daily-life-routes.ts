import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildDailyBriefings,
  projectDailyHealth,
  dailyLifeDate,
  dailyLifeObject,
  assistantLocalDate,
  parseTaskMutation,
  parseHydrationInput,
  parseDailyLifePreferences,
  documentaryPrompts,
  DailyLifeConflictError,
  DailyLifeInputError,
  idealHumanLocalDate,
  idealHumanDayNumber,
  emptyIdealHumanDay,
  type DailyLifeSummary,
  type IdealHumanDay,
} from "@lifeos/core";
import {
  DailyLifeNotFoundError,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";

export async function dailyLifeSummary(
  store: LifeOSStore,
  user: TelegramUserRecord,
  date: string,
  now = new Date(),
  deliveryPrivacy?: { includeHealth: boolean; includeFilming: boolean },
): Promise<DailyLifeSummary> {
  const warnings: string[] = [];
  const results = await Promise.allSettled([
    store.getIdealHumanDays?.(user.userId) ?? Promise.resolve([]),
    store.getHealthMetricDay(user.userId, date),
    store.dailyLife?.hydration(user.userId, date, user.timezone) ??
      Promise.resolve(null),
    store.dailyLife?.tasks(user.userId) ??
      Promise.resolve({ tasks: [], truncated: false }),
    store.getTmaStudySummary(user.userId, user.timezone),
    store.getWorkoutHistory(user.userId),
    store.getLmsWork(user.userId, user.timezone),
    store.getHealthSyncStatus?.(user.userId) ?? Promise.resolve(null),
  ] as const);
  const take = <T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    label: string,
  ): T => {
    if (result.status === "fulfilled") return result.value;
    warnings.push(
      label + " unavailable; previous stored data was not changed.",
    );
    return fallback;
  };
  const days = take(results[0], [] as IdealHumanDay[], "Journal");
  const day = days.find((d) => d.date === date) ?? null;
  const metric = take(
    results[1],
    {
      date,
      metrics: {},
      records: [],
      sources: [],
      sourceLabel: null,
      latestSource: null,
      missingMetrics: {},
    },
    "Health",
  );
  const health = projectDailyHealth({
    date,
    manual: day,
    metrics: metric.metrics,
    records: metric.records,
    now,
  });
  const hydration = take(results[2], null, "Hydration");
  const tasks = take(results[3], { tasks: [], truncated: false }, "Tasks");
  if (tasks.truncated)
    warnings.push(
      "Task history is truncated; completion counts cover available records only.",
    );
  const study = take(
    results[4],
    { timezone: user.timezone, courses: [], records: [] },
    "Study",
  );
  const history = take(results[5], [], "Workouts");
  const work = take(results[6], null, "LMS");
  const sync = take(results[7], null, "Health sync");
  const validTimestamp = (value: string | null | undefined): string | null => {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value).toISOString();
  };
  const healthSync: NonNullable<DailyLifeSummary["healthSync"]> = {
    available: results[7].status === "fulfilled" && sync !== null,
    latestStatus: sync?.latestRun?.status ?? null,
    latestCompletedAt: validTimestamp(sync?.latestRun?.completedAt),
    recentSuccessAt: validTimestamp(
      sync?.runs.find((r) => r.status === "success")?.completedAt,
    ),
    historyLimit: 5,
  };
  if (work?.truncated)
    warnings.push(
      "LMS items are truncated; check the source for the full list.",
    );
  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][new Date(date + "T12:00:00Z").getUTCDay()];
  const classes = study.courses
    .flatMap((c) =>
      c.schedules
        .filter(
          (s) =>
            s.dayOfWeek === weekday &&
            (!c.startsOn || c.startsOn <= date) &&
            (!c.endsOn || c.endsOn >= date),
        )
        .map((s) => ({
          title: c.title,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const deadlines = (work?.items ?? [])
    .filter((d) => ["upcoming", "overdue", "exams"].includes(d.category))
    .map((d) => ({ title: d.title, dueAt: d.dueAt }));
  const workouts = history.filter(
    (w) => idealHumanLocalDate(new Date(w.endedAt)) === date,
  );
  const briefings = buildDailyBriefings({
    date,
    day,
    health,
    classes,
    deadlines,
    tasks: tasks.tasks,
    workouts,
    lmsStale: !work || work.stale,
    sourceAvailability: {
      tasks: Boolean(store.dailyLife) && results[3].status === "fulfilled",
      workouts: results[5].status === "fulfilled",
      journal:
        Boolean(store.getIdealHumanDays) && results[0].status === "fulfilled",
    },
    deliveryPrivacy,
  });
  const meals = day?.meals ?? [];
  const total = (key: "caloriesKcal" | "proteinG" | "fatG" | "carbsG") => {
    if (meals.length) {
      const values = meals
        .map((m) => m[key])
        .filter((v): v is number => typeof v === "number");
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    }
    return key === "caloriesKcal"
      ? (day?.caloriesKcal ?? null)
      : key === "proteinG"
        ? (day?.proteinG ?? null)
        : null;
  };
  const fallbackPlan = idealHumanDayNumber(date)
    ? emptyIdealHumanDay(date)
    : null;
  return {
    date,
    timezone: "Asia/Almaty",
    dayNumber: idealHumanDayNumber(date),
    health,
    healthSync,
    hydration,
    nutrition: {
      mealCount: meals.length,
      caloriesKcal: total("caloriesKcal"),
      proteinG: total("proteinG"),
      fatG: total("fatG"),
      carbsG: total("carbsG"),
      estimated:
        meals.some((m) => m.estimated) ||
        (!meals.length && total("caloriesKcal") !== null),
      incomplete:
        !meals.length ||
        meals.some((m) => m.caloriesKcal === null || m.proteinG === null),
    },
    ...briefings,
    documentary: {
      shots: documentaryPrompts(day ?? fallbackPlan, date),
      filmingDays: days.filter(
        (d) =>
          d.footageCaptured === true ||
          d.aRoll === true ||
          d.bRoll === true ||
          (d.filmingMinutes ?? 0) > 0 ||
          (d.footage?.length ?? 0) > 0,
      ).length,
      backupConfirmedDays: days.filter((d) => d.footageBackedUp === true)
        .length,
      weeklyReflection: days
        .filter(
          (d) =>
            d.date <= date &&
            Date.parse(date) - Date.parse(d.date) < 7 * 86400000,
        )
        .map((d) => d.videoReflection || d.highlights)
        .filter(Boolean),
    },
    sourceWarnings:
      deliveryPrivacy?.includeHealth === false
        ? warnings.filter((warning) => !/^(?:Health|Workouts) /.test(warning))
        : warnings,
    generatedBy: "deterministic",
  };
}

/** Only the existing authenticated active-profile API boundary may invoke this. */
export async function handleDailyLifeRoute(context: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  user: TelegramUserRecord;
  store: LifeOSStore;
  readJsonBody: (r: IncomingMessage) => Promise<unknown>;
  writeJson: (r: ServerResponse, status: number, body: unknown) => void;
}): Promise<boolean> {
  const { request, response, url, user, store, readJsonBody, writeJson } =
    context;
  const path = url.pathname;
  if (
    !["/api/tma/daily-life/", "/api/tma/hydration", "/api/tma/tasks"].some(
      (prefix) => path.startsWith(prefix),
    )
  )
    return false;
  response.setHeader("Cache-Control", "no-store");
  const send = (data: unknown) => writeJson(response, 200, { data });
  try {
    const date = dailyLifeDate(
      url.searchParams.get("date") ??
        (path.startsWith("/api/tma/hydration")
          ? assistantLocalDate(new Date(), user.timezone)
          : idealHumanLocalDate(new Date())),
    );
    if (path === "/api/tma/daily-life/summary" && request.method === "GET") {
      send(await dailyLifeSummary(store, user, date));
      return true;
    }
    if (!store.dailyLife) {
      writeJson(response, 503, { error: "daily_life_unavailable" });
      return true;
    }
    if (path === "/api/tma/daily-life/preferences") {
      if (request.method === "GET")
        send(await store.dailyLife.preferences(user.userId));
      else if (request.method === "PUT")
        send(
          await store.dailyLife.savePreferences(
            user.userId,
            parseDailyLifePreferences(await readJsonBody(request)),
          ),
        );
      else writeJson(response, 405, { error: "method_not_allowed" });
      return true;
    }
    if (path === "/api/tma/hydration") {
      if (request.method === "GET")
        send(await store.dailyLife.hydration(user.userId, date, user.timezone));
      else if (request.method === "POST") {
        const body = parseHydrationInput(await readJsonBody(request));
        const day = await store.dailyLife.logWater(
          user.userId,
          body.amountMl,
          body.requestId,
          request.headers.authorization ? "web" : "tma",
        );
        send(await store.dailyLife.hydration(user.userId, day, user.timezone));
      } else writeJson(response, 405, { error: "method_not_allowed" });
      return true;
    }
    const undo = path.match(/^\/api\/tma\/hydration\/([0-9a-f-]{36})\/undo$/i);
    if (undo && request.method === "POST") {
      dailyLifeObject(await readJsonBody(request), []);
      const day = await store.dailyLife.undoWater(user.userId, undo[1]);
      send(await store.dailyLife.hydration(user.userId, day, user.timezone));
      return true;
    }
    if (path === "/api/tma/tasks") {
      if (request.method === "GET")
        send(await store.dailyLife.tasks(user.userId));
      else if (request.method === "POST") {
        const body = parseTaskMutation(await readJsonBody(request), false);
        send(
          await store.dailyLife.manageTask(
            user.userId,
            null,
            body.requestId,
            body.patch,
            null,
          ),
        );
      } else writeJson(response, 405, { error: "method_not_allowed" });
      return true;
    }
    const task = path.match(/^\/api\/tma\/tasks\/([0-9a-f-]{36})$/i);
    if (task && request.method === "PATCH") {
      const body = parseTaskMutation(await readJsonBody(request), true);
      send(
        await store.dailyLife.manageTask(
          user.userId,
          task[1],
          null,
          body.patch,
          body.expectedUpdatedAt,
        ),
      );
      return true;
    }
    writeJson(response, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof DailyLifeInputError)
      writeJson(response, 400, {
        error: "invalid_daily_life_input",
        message: error.message,
      });
    else if (error instanceof DailyLifeConflictError)
      writeJson(response, 409, { error: "daily_life_conflict" });
    else if (error instanceof DailyLifeNotFoundError)
      writeJson(response, 404, { error: "record_not_found" });
    else throw error;
  }
  return true;
}
