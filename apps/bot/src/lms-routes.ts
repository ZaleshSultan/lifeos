import { DateTime } from "luxon";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  LmsStoreError,
  type LmsSessionStore,
  type TelegramUserRecord,
  type ManualStudyWork,
} from "@lifeos/db";
import { LmsSessionService, LmsSessionError } from "./lms-sessions.js";

function bodyObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new LmsSessionError("lms_invalid_request", 400);
  return value as Record<string, unknown>;
}
function parseManual(value: unknown): ManualStudyWork {
  const b = bodyObject(value, [
    "title",
    "courseTitle",
    "kind",
    "dueAt",
    "submissionStatus",
  ]);
  if (
    typeof b.title !== "string" ||
    !b.title.trim() ||
    b.title.length > 240 ||
    /[\x00-\x1f]/.test(b.title) ||
    (b.courseTitle != null &&
      (typeof b.courseTitle !== "string" ||
        b.courseTitle.length > 240 ||
        /[\x00-\x1f]/.test(b.courseTitle))) ||
    !["assignment", "quiz", "exam", "midterm"].includes(String(b.kind)) ||
    !["not_submitted", "submitted", "unknown"].includes(
      String(b.submissionStatus),
    ) ||
    (b.dueAt != null &&
      (typeof b.dueAt !== "string" ||
        b.dueAt.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(b.dueAt) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(b.dueAt) ||
        !DateTime.fromISO(b.dueAt, { setZone: true }).isValid))
  )
    throw new LmsSessionError("lms_invalid_manual_work", 400);
  return {
    title: b.title.trim(),
    courseTitle:
      typeof b.courseTitle === "string" ? b.courseTitle.trim() || null : null,
    kind: b.kind as ManualStudyWork["kind"],
    submissionStatus: b.submissionStatus as ManualStudyWork["submissionStatus"],
    dueAt: typeof b.dueAt === "string" ? new Date(b.dueAt).toISOString() : null,
  };
}
export async function handleLmsRoute({
  request,
  response,
  url,
  user,
  store,
  sessions,
  readJsonBody,
  writeJson,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  user: TelegramUserRecord;
  store: LmsSessionStore;
  sessions: LmsSessionService;
  readJsonBody: (r: IncomingMessage, max?: number) => Promise<unknown>;
  writeJson: (r: ServerResponse, status: number, body: unknown) => void;
}): Promise<boolean> {
  if (!url.pathname.startsWith("/api/tma/lms/")) return false;
  response.setHeader("Cache-Control", "no-store");
  const routes: Record<string, string> = {
    "/api/tma/lms/connection": "GET",
    "/api/tma/lms/work": "GET",
    "/api/tma/lms/work/manual": "POST",
    "/api/tma/lms/session/validate": "POST",
    "/api/tma/lms/session/save": "POST",
    "/api/tma/lms/session": "DELETE",
    "/api/tma/lms/sync": "POST",
  };
  const expected = routes[url.pathname];
  try {
    if (!expected) throw new LmsSessionError("lms_not_found", 404);
    if (request.method !== expected)
      throw new LmsSessionError("method_not_allowed", 405);
    // No endpoint accepts a user ID, credential, receipt or Moodle URL in a URL.
    if (url.search) throw new LmsSessionError("lms_invalid_request", 400);
    const action = url.pathname.split("/").pop()!;
    sessions.checkRate(
      user.userId,
      action,
      expected === "GET"
        ? 60
        : action === "validate"
          ? 3
          : action === "sync"
            ? 2
            : 10,
    );
    let data: unknown;
    if (expected === "GET")
      data =
        action === "work"
          ? await store.getLmsWork(user.userId, user.timezone)
          : await store.getLmsConnection(user.userId);
    else {
      if (
        expected === "POST" &&
        !/^application\/json(?:\s*;|$)/i.test(
          String(request.headers["content-type"] || ""),
        )
      )
        throw new LmsSessionError("lms_invalid_request", 415);
      const body = await readJsonBody(
        request,
        action === "validate" ? 20000 : action === "manual" ? 2048 : 1024,
      );
      if (action === "validate") {
        const b = bodyObject(body, ["cookie"]);
        data = await sessions.validate(user.userId, b.cookie);
      } else if (action === "save") {
        const b = bodyObject(body, ["validationToken"]);
        data = await sessions.save(user.userId, b.validationToken, store);
      } else if (action === "manual") {
        await store.addManualStudyWork(user.userId, parseManual(body));
        data = { created: true };
      } else {
        bodyObject(body, []);
        if (expected === "DELETE") {
          sessions.discard(user.userId);
          data = await store.deleteLmsSession(user.userId);
        } else {
          await store.requestLmsSync(user.userId);
          data = { requested: true };
        }
      }
    }
    writeJson(response, 200, { data });
  } catch (error) {
    if (error instanceof LmsSessionError)
      writeJson(response, error.statusCode, {
        error: error.code,
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
      });
    else if (error instanceof LmsStoreError)
      writeJson(
        response,
        error.code === "lms_sync_in_progress"
          ? 409
          : error.code === "lms_session_required"
            ? 422
            : 503,
        { error: error.code },
      );
    else if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      "errorCode" in error
    )
      writeJson(response, Number(error.statusCode), {
        error: String(error.errorCode),
      });
    else writeJson(response, 503, { error: "lms_unavailable" });
  }
  return true;
}
