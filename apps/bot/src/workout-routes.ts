import type { IncomingMessage, ServerResponse } from "node:http";
import {
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
      send(await store.getWorkoutHistory(userId));
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
      writeJson(response, error.code === "workout_completed" ? 409 : 404, {
        error: error.code,
      });
      return true;
    }
    throw error;
  }
}
