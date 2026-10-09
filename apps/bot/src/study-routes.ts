import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  StudyWorkspaceError,
  studyObject,
  type LifeOSStore,
  type CreateAssessmentItemInput,
  type UpdateAssessmentItemInput,
} from "@lifeos/db";

export interface StudyRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  store: LifeOSStore;
  user: { userId: string; timezone: string };
  readJsonBody: (
    request: IncomingMessage,
    maxBytes?: number,
  ) => Promise<unknown>;
  readBinaryBody: (
    request: IncomingMessage,
    maxBytes: number,
  ) => Promise<Buffer>;
  writeJson: (response: ServerResponse, status: number, body: unknown) => void;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 60 * 1024 * 1024;
export function parseStudyPdfBytes(fileName: unknown, bytes: Uint8Array) {
  if (
    typeof fileName !== "string" ||
    !fileName.trim() ||
    fileName.length > 240 ||
    /[/\\\x00-\x1f]/.test(fileName) ||
    !/\.pdf$/i.test(fileName) ||
    bytes.length < 8 ||
    bytes.length > MAX_PDF_BYTES ||
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    throw new StudyWorkspaceError("invalid_study_document");
  }
  return {
    fileName: fileName.trim(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}
function id(value: string) {
  if (!UUID.test(value))
    throw new StudyWorkspaceError("invalid_study_assignment");
  return value;
}
function boundedString(
  value: unknown,
  max: number,
  nullable = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!nullable && !value.trim())
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  return value.trim();
}
function score(value: unknown, positive = false): number | null | undefined {
  if (value === null || value === undefined) return value;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (positive ? value <= 0 : value < 0)
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  return value;
}
function dueAt(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !==
      value.slice(0, 10) ||
    Number(value.slice(11, 13)) > 23
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  return new Date(value).toISOString();
}
export function parseStudyAssignment(
  input: unknown,
  create: boolean,
): CreateAssessmentItemInput | UpdateAssessmentItemInput {
  const body = studyObject(input);
  const title = boundedString(body.title, 300);
  if (create && !title)
    throw new StudyWorkspaceError("invalid_study_assignment");
  const status = body.status;
  if (
    status !== undefined &&
    (typeof status !== "string" ||
      !["pending", "submitted", "graded", "missed"].includes(status))
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  const maxScore = score(body.maxScore, true);
  const actualScore = score(body.actualScore);
  if (
    create &&
    actualScore !== undefined &&
    actualScore !== null &&
    (maxScore === undefined || maxScore === null)
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  if (
    actualScore !== null &&
    actualScore !== undefined &&
    (maxScore === null || (maxScore !== undefined && actualScore > maxScore))
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  const sourceUrl = boundedString(body.sourceUrl, 2000, true);
  if (sourceUrl) {
    try {
      if (!["https:", "http:"].includes(new URL(sourceUrl).protocol))
        throw new Error();
    } catch {
      throw new StudyWorkspaceError("invalid_study_assignment");
    }
  }
  const parsed: UpdateAssessmentItemInput = {
    title: title ?? undefined,
    assessmentType: boundedString(body.assessmentType, 80, true),
    maxScore,
    actualScore,
    dueAt: dueAt(body.dueAt),
    status: status as UpdateAssessmentItemInput["status"],
    notes: boundedString(body.notes, 2000, true),
  };
  if (sourceUrl !== undefined) parsed.rawJson = { source_url: sourceUrl };
  if (parsed.dueAt !== undefined) parsed.dueSource = "manual";
  if (create)
    return {
      ...parsed,
      title: title!,
      studyCourseId: id(String(body.studyCourseId ?? body.courseId ?? "")),
      source: "manual",
    };
  return parsed;
}
export function parseStudyPdf(input: unknown): {
  fileName: string;
  sha256: string;
  pdfBase64: string;
} {
  const body = studyObject(input);
  if (
    typeof body.fileName !== "string" ||
    !body.fileName.trim() ||
    body.fileName.length > 240 ||
    /[/\\\x00-\x1f]/.test(body.fileName) ||
    !/\.pdf$/i.test(body.fileName) ||
    typeof body.pdfBase64 !== "string" ||
    !body.pdfBase64 ||
    body.pdfBase64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(body.pdfBase64)
  )
    throw new StudyWorkspaceError("invalid_study_document");
  const bytes = Buffer.from(body.pdfBase64, "base64");
  if (
    bytes.length > MAX_PDF_BYTES ||
    bytes.length < 8 ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
    bytes.toString("base64") !== body.pdfBase64
  )
    throw new StudyWorkspaceError("invalid_study_document");
  return {
    fileName: body.fileName.trim(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pdfBase64: body.pdfBase64,
  };
}
function publicAssessment<T extends { rawJson: unknown }>(row: T) {
  const { rawJson: _raw, ...publicRow } = row;
  return publicRow;
}

/** Called only after the shared TMA authentication and rate limit boundary. */
export async function handleStudyRoutes(
  context: StudyRouteContext,
): Promise<boolean> {
  const { request, response, url, store, user, readJsonBody, writeJson } =
    context;
  if (!url.pathname.startsWith("/api/tma/study")) return false;
  const reply = (data: unknown, status = 200) =>
    writeJson(response, status, { data });
  try {
    if (url.pathname === "/api/tma/study") {
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return true;
      }
      reply(await store.getTmaStudySummary(user.userId, user.timezone));
      return true;
    }
    if (url.pathname === "/api/tma/study/assignments") {
      if (request.method !== "POST") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return true;
      }
      const body = parseStudyAssignment(
        await readJsonBody(request),
        true,
      ) as CreateAssessmentItemInput;
      reply(
        publicAssessment(
          await store.createManualStudyAssignment(user.userId, body),
        ),
        201,
      );
      return true;
    }
    const assignment = url.pathname.match(
      /^\/api\/tma\/study\/assignments\/([^/]+)(?:\/(grade-override|component))?$/,
    );
    if (assignment) {
      const assignmentId = id(assignment[1]);
      if (assignment[2]) {
        if (request.method !== "PUT") {
          writeJson(response, 405, { error: "method_not_allowed" });
          return true;
        }
        const body = await readJsonBody(request);
        if (assignment[2] === "grade-override")
          await store.saveStudyGradeOverride(user.userId, assignmentId, body);
        else
          await store.saveStudyComponentMapping(
            user.userId,
            assignmentId,
            body,
          );
        reply({ saved: true });
        return true;
      }
      if (!["PUT", "PATCH"].includes(request.method ?? "")) {
        writeJson(response, 405, { error: "method_not_allowed" });
        return true;
      }
      reply(
        publicAssessment(
          await store.editManualStudyAssignment(
            user.userId,
            assignmentId,
            parseStudyAssignment(await readJsonBody(request), false),
          ),
        ),
      );
      return true;
    }
    const download = url.pathname.match(
      /^\/api\/tma\/study\/documents\/([^/]+)\/download$/,
    );
    if (download) {
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return true;
      }
      const document = await store.downloadStudyDocument(
        user.userId,
        id(download[1]),
      );
      const bytes = Buffer.from(document.bytes);
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": bytes.length,
        "content-disposition": `attachment; filename="syllabus.pdf"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
      });
      response.end(bytes);
      return true;
    }
    const course = url.pathname.match(
      /^\/api\/tma\/study\/courses\/([^/]+)\/(documents|schemes|calculator|syllabus)(?:\/([^/]+)\/activate)?$/,
    );
    if (course) {
      const courseId = id(course[1]);
      const action = course[2];
      if (course[3]) {
        if (action !== "schemes" || request.method !== "POST") {
          writeJson(response, 405, { error: "method_not_allowed" });
          return true;
        }
        const body = studyObject(await readJsonBody(request));
        reply(
          await store.activateStudyScheme(
            user.userId,
            courseId,
            id(course[3]),
            body.confirmed === true,
          ),
        );
        return true;
      }
      if (action === "documents") {
        if (request.method !== "POST") {
          writeJson(response, 405, { error: "method_not_allowed" });
          return true;
        }
        let pdf;
        if (
          request.headers["content-type"]
            ?.split(";")[0]
            .trim()
            .toLowerCase() === "application/pdf"
        ) {
          let fileName;
          try {
            fileName = decodeURIComponent(
              String(request.headers["x-study-file-name"] ?? ""),
            );
          } catch {
            throw new StudyWorkspaceError("invalid_study_document");
          }
          pdf = parseStudyPdfBytes(
            fileName,
            await context.readBinaryBody(request, MAX_PDF_BYTES),
          );
        } else {
          pdf = parseStudyPdf(await readJsonBody(request, 80 * 1024 * 1024));
        }
        reply(await store.createStudyDocument(user.userId, courseId, pdf), 201);
        return true;
      }
      if (action === "schemes") {
        if (request.method !== "POST") {
          writeJson(response, 405, { error: "method_not_allowed" });
          return true;
        }
        reply(
          await store.createStudyScheme(
            user.userId,
            courseId,
            await readJsonBody(request),
          ),
          201,
        );
        return true;
      }
      if (request.method !== "PUT") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      reply(
        action === "calculator"
          ? await store.saveStudyCalculator(user.userId, courseId, body)
          : await store.configureStudyCalculator(user.userId, courseId, body),
      );
      return true;
    }
    return false;
  } catch (error) {
    if (!(error instanceof StudyWorkspaceError)) throw error;
    const code = error.code;
    const status =
      code.endsWith("_not_found") || code === "study_document_not_uploaded"
        ? 404
        : code === "study_calculator_conflict" ||
            code === "study_component_already_mapped"
          ? 409
          : code === "study_assignment_read_only"
            ? 403
            : 400;
    writeJson(response, status, { error: code });
    return true;
  }
}
