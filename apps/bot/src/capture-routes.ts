import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CaptureInputError,
  captureExpectedRevision,
  captureRecordId,
} from "@lifeos/core";
import { CaptureStoreError, type TelegramUserRecord } from "@lifeos/db";
import { CaptureService, CaptureServiceError } from "./capture-service.js";

function bodyRecord(
  value: unknown,
  allowed: string[],
  required: string[] = allowed,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw new CaptureInputError();
  return value as Record<string, unknown>;
}

export async function handleCaptureRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  user: TelegramUserRecord;
  captures?: CaptureService;
  readJsonBody: (
    request: IncomingMessage,
    maxBytes?: number,
  ) => Promise<unknown>;
  writeJson: (response: ServerResponse, status: number, value: unknown) => void;
}): Promise<boolean> {
  const { request, response, url, user, captures, writeJson } = options;
  if (
    url.pathname !== "/api/tma/captures" &&
    !url.pathname.startsWith("/api/tma/captures/")
  )
    return false;
  response.setHeader("Cache-Control", "no-store");
  if (url.search) {
    writeJson(response, 400, { error: "capture_invalid_input" });
    return true;
  }
  const relative = url.pathname.slice("/api/tma/captures".length);
  const fixed: Record<string, string[]> = {
    "": ["GET", "POST"],
    "/capabilities": ["GET"],
    "/search": ["POST"],
    "/memories": ["GET"],
  };
  const match =
    /^\/([a-f0-9-]{36})(?:\/(process|confirm|cancel|retry|archive|correct|reject|external))?$/i.exec(
      relative,
    );
  const methods =
    fixed[relative] ??
    (match ? (match[2] ? ["POST"] : ["GET", "PATCH", "DELETE"]) : null);
  if (!methods) {
    writeJson(response, 404, { error: "capture_not_found" });
    return true;
  }
  if (!methods.includes(request.method ?? "")) {
    response.setHeader("Allow", methods.join(", "));
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!captures) {
    writeJson(response, 503, { error: "capture_unavailable" });
    return true;
  }
  // Keep malformed/oversized JSON in the existing HTTP boundary's safe error path.
  const raw =
    request.method === "GET"
      ? undefined
      : await options.readJsonBody(request, 65536);
  const send = (value: unknown, status = 200) =>
    writeJson(response, status, { data: value });
  try {
    if (relative === "/capabilities")
      send(await captures.ownerCapabilities(user));
    else if (relative === "/memories") send(await captures.memories(user));
    else if (
      relative === "/search" ||
      (relative === "" && request.method === "GET")
    )
      send(await captures.search(user, raw ?? {}));
    else if (relative === "") {
      const result = await captures.ingest(
        user,
        raw,
        request.headers.authorization ? "web" : "tma",
      );
      send(result.capture, result.created ? 201 : 200);
    } else {
      const id = captureRecordId(match![1]);
      const action = match![2];
      if (request.method === "GET") send(await captures.get(user, id));
      else if (request.method === "PATCH")
        send(await captures.edit(user, id, raw));
      else if (request.method === "DELETE") {
        const body = bodyRecord(raw, ["expectedRevision", "confirmed"]);
        if (body.confirmed !== true) throw new CaptureInputError();
        await captures.delete(
          user,
          id,
          captureExpectedRevision(body.expectedRevision),
        );
        send({ deleted: true });
      } else if (action === "confirm")
        send(await captures.confirm(user, id, raw));
      else if (action === "correct")
        send(await captures.correct(user, id, raw));
      else if (action === "external")
        send(await captures.external(user, id, raw));
      else if (action === "reject") {
        const body = bodyRecord(raw, ["expectedRevision", "actionId"]);
        if (typeof body.actionId !== "string") throw new CaptureInputError();
        send(
          await captures.reject(
            user,
            id,
            captureExpectedRevision(body.expectedRevision),
            body.actionId,
          ),
        );
      } else if (action === "archive") {
        const body = bodyRecord(raw, ["expectedRevision", "archived"]);
        if (typeof body.archived !== "boolean") throw new CaptureInputError();
        send(
          await captures.archive(
            user,
            id,
            captureExpectedRevision(body.expectedRevision),
            body.archived,
          ),
        );
      } else {
        const body = bodyRecord(raw, ["expectedRevision"]);
        const revision = captureExpectedRevision(body.expectedRevision);
        if (action === "retry") send(await captures.retry(user, id, revision));
        else if (action === "cancel")
          send(await captures.cancel(user, id, revision));
        else {
          const capture = await captures.get(user, id);
          if (capture.revision !== revision)
            throw new CaptureServiceError("capture_conflict", 409);
          send(await captures.process(user, id));
        }
      }
    }
  } catch (error) {
    if (error instanceof CaptureInputError)
      writeJson(response, 400, {
        error: "capture_invalid_input",
        message: "Review the capture fields and try again.",
      });
    else if (error instanceof CaptureServiceError)
      writeJson(response, error.statusCode, { error: error.code });
    else if (error instanceof CaptureStoreError) {
      const status =
        error.code === "capture_not_found"
          ? 404
          : [
                "capture_conflict",
                "capture_expired",
                "capture_lease_lost",
              ].includes(error.code)
            ? 409
            : error.code === "capture_permission_denied"
              ? 403
              : error.code === "capture_invalid_input"
                ? 400
                : 503;
      writeJson(response, status, { error: error.code });
    } else writeJson(response, 503, { error: "capture_storage_unavailable" });
  }
  return true;
}
