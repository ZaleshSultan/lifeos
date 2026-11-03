import type { IncomingMessage, ServerResponse } from "node:http";
import {
  IdealHumanConflictError,
  IdealHumanInputError,
  parseIdealHumanDay,
  parseIdealHumanReflectionClear,
} from "@lifeos/core";
import type { LifeOSStore } from "@lifeos/db";

/** Called only after the shared active-profile authentication boundary. */
export async function handleIdealHumanRoute({
  request,
  response,
  pathname,
  userId,
  store,
  readJsonBody,
  writeJson,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  userId: string;
  store: LifeOSStore;
  readJsonBody: (request: IncomingMessage) => Promise<unknown>;
  writeJson: (response: ServerResponse, code: number, body: unknown) => void;
}): Promise<boolean> {
  if (!pathname.startsWith("/api/tma/ideal-human/")) return false;
  response.setHeader("Cache-Control", "no-store");
  const clearing = pathname === "/api/tma/ideal-human/reflection/clear";
  if (pathname !== "/api/tma/ideal-human/days" && !clearing) {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  if (
    clearing
      ? request.method !== "POST"
      : request.method !== "GET" && request.method !== "PUT"
  ) {
    response.setHeader("Allow", clearing ? "POST" : "GET, PUT");
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (
    clearing
      ? !store.clearIdealHumanReflection
      : !store.getIdealHumanDays || !store.saveIdealHumanDay
  ) {
    writeJson(response, 503, { error: "ideal_human_unavailable" });
    return true;
  }
  try {
    if (clearing) {
      const command = parseIdealHumanReflectionClear(
        await readJsonBody(request),
      );
      writeJson(response, 200, {
        data: await store.clearIdealHumanReflection!(
          userId,
          command.date,
          command.expectedRevision,
        ),
      });
      return true;
    }
    if (request.method === "GET") {
      writeJson(response, 200, {
        data: await store.getIdealHumanDays!(userId),
      });
      return true;
    }
    const input = await readJsonBody(request);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new IdealHumanInputError("Expected a day and its saved revision");
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !["day", "expectedRevision"].includes(key),
      )
    )
      throw new IdealHumanInputError("Unexpected field");
    if (
      typeof body.expectedRevision !== "number" ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 0
    )
      throw new IdealHumanInputError("Reload the saved day before editing");
    const day = parseIdealHumanDay(body.day);
    if (day.revision !== body.expectedRevision)
      throw new IdealHumanInputError("Saved revision does not match the day");
    writeJson(response, 200, {
      data: await store.saveIdealHumanDay!(userId, day, body.expectedRevision),
    });
  } catch (error) {
    if (error instanceof IdealHumanInputError) {
      writeJson(response, 400, {
        error: "invalid_ideal_human_day",
        message: error.message,
      });
    } else if (error instanceof IdealHumanConflictError) {
      writeJson(response, 409, {
        error: "ideal_human_conflict",
        message:
          "This day changed in another session. Reload it before saving.",
      });
    } else {
      throw error;
    }
  }
  return true;
}
