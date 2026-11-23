import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseDraftCommand,
  parsePersonalTemplate,
  parseWorkoutProgram,
  parseWorkoutSet,
  WorkoutInputError,
} from "@lifeos/core";
import { WorkoutStateError, type LifeOSStore } from "@lifeos/db";

interface WorkoutRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  userId: string;
  personalOwner?: boolean;
  timezone?: string;
  store: LifeOSStore;
  readJsonBody: (request: IncomingMessage) => Promise<unknown>;
  writeJson: (
    response: ServerResponse,
    statusCode: number,
    body: unknown,
  ) => void;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorkoutInputError("Expected an object");
  return value as Record<string, unknown>;
}

function uuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new WorkoutInputError("Invalid workout or set ID");
  }
  return value;
}

/** Invoked only after the TMA authentication boundary has resolved the user. */
export async function handleWorkoutRoute(
  context: WorkoutRouteContext,
): Promise<boolean> {
  const {
    request,
    response,
    pathname,
    userId,
    store,
    readJsonBody,
    writeJson,
  } = context;
  if (!pathname.startsWith("/api/tma/workout/")) return false;
  const send = (data: unknown) => writeJson(response, 200, { data });
  try {
    if (pathname.startsWith("/api/tma/workout/personal/")) {
      const templatePath = pathname === "/api/tma/workout/personal/template";
      if (!context.personalOwner) {
        if (templatePath && request.method === "POST") send(null);
        else writeJson(response, 404, { error: "workout_not_found" });
        return true;
      }
      if (templatePath && request.method === "POST")
        send(await store.personalTemplate(userId));
      else if (templatePath && request.method === "PUT")
        send(
          await store.personalTemplate(
            userId,
            parsePersonalTemplate(await readJsonBody(request)),
          ),
        );
      else if (
        request.method === "POST" &&
        pathname === "/api/tma/workout/personal/start"
      ) {
        const body = record(await readJsonBody(request));
        send(
          await store.startPersonalWorkout(
            userId,
            uuid(String(body.requestId)),
          ),
        );
      } else if (
        request.method === "PATCH" &&
        /^\/api\/tma\/workout\/personal\/[\da-f-]+$/i.test(pathname)
      ) {
        const id = uuid(pathname.split("/").at(-1)!);
        const { change, revision, requestId } = parseDraftCommand(
          await readJsonBody(request),
        );
        send(
          await store.changePersonalWorkout(
            userId,
            id,
            revision,
            requestId,
            change,
          ),
        );
      } else writeJson(response, 404, { error: "not_found" });
      return true;
    }
    if (pathname === "/api/tma/workout/current" && request.method === "GET") {
      send(await store.getCurrentWorkout({ userId }));
      return true;
    }
    if (pathname === "/api/tma/workout/program" && request.method === "GET") {
      send(await store.getWorkoutProgram(userId));
      return true;
    }
    if (pathname === "/api/tma/workout/program" && request.method === "PUT") {
      const program = parseWorkoutProgram(await readJsonBody(request));
      send(await store.saveWorkoutProgram(userId, program));
      return true;
    }
    if (pathname === "/api/tma/workout/history" && request.method === "GET") {
      const offset = Number(
        new URL(request.url ?? pathname, "http://localhost").searchParams.get(
          "offset",
        ) ?? 0,
      );
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483597)
        throw new WorkoutInputError("Invalid offset");
      send(
        (await store.getWorkoutHistory(userId, offset)).map((session) => ({
          ...session,
          timezone: context.timezone,
        })),
      );
      return true;
    }
    if (pathname === "/api/tma/workout/start" && request.method === "POST") {
      const body = record(await readJsonBody(request));
      let day;
      if (body.programDayId !== undefined) {
        if (
          typeof body.programDayId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(body.programDayId)
        ) {
          throw new WorkoutInputError("Invalid program day ID");
        }
        const program = await store.getWorkoutProgram(userId);
        day = program?.days.find((entry) => entry.id === body.programDayId);
        if (!day) {
          writeJson(response, 404, { error: "workout_program_day_not_found" });
          return true;
        }
      }
      const mode = await store.resolveCurrentMode(userId);
      await store.getOrCreateCurrentWorkout({
        userId,
        now: new Date().toISOString(),
        lifeMode: mode.mode,
        ...(day
          ? {
              title: day.title,
              manualPlan: day.exercises.map((exercise) => ({
                ...exercise,
                category: "strength",
                equipment: "unspecified",
              })),
            }
          : {}),
      });
      const workout = await store.getCurrentWorkout({ userId });
      if (!workout) writeJson(response, 500, { error: "workout_start_failed" });
      else send(workout);
      return true;
    }
    const editSet = pathname.match(/^\/api\/tma\/workout\/sets\/([^/]+)$/);
    if (editSet && request.method === "PATCH") {
      const setId = uuid(editSet[1]);
      const values = parseWorkoutSet(await readJsonBody(request));
      send(await store.updateWorkoutSet({ userId, setId, values }));
      return true;
    }
    const setAction = pathname.match(
      /^\/api\/tma\/workout\/sets\/([^/]+)\/(complete|undo)$/,
    );
    if (setAction && request.method === "POST") {
      const setId = uuid(setAction[1]);
      send(
        setAction[2] === "complete"
          ? await store.completeWorkoutSet({
              userId,
              setId,
              completedAt: new Date().toISOString(),
            })
          : await store.undoWorkoutSet({ userId, setId }),
      );
      return true;
    }
    const complete = pathname.match(/^\/api\/tma\/workout\/([^/]+)\/complete$/);
    if (complete && request.method === "POST") {
      send(
        await store.completeWorkout({
          userId,
          workoutId: uuid(complete[1]),
          completedAt: new Date().toISOString(),
        }),
      );
      return true;
    }
    const knownPath =
      editSet ||
      setAction ||
      complete ||
      [
        "/api/tma/workout/current",
        "/api/tma/workout/program",
        "/api/tma/workout/history",
        "/api/tma/workout/start",
      ].includes(pathname);
    writeJson(response, knownPath ? 405 : 404, {
      error: knownPath ? "method_not_allowed" : "not_found",
    });
    return true;
  } catch (error) {
    if (error instanceof WorkoutInputError) {
      writeJson(response, 400, {
        error: "invalid_workout_input",
        message: error.message,
      });
      return true;
    }
    if (error instanceof WorkoutStateError) {
      writeJson(response, error.code === "workout_not_found" ? 404 : 409, {
        error: error.code,
      });
      return true;
    }
    throw error;
  }
}
