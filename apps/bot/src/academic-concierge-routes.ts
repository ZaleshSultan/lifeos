import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AcademicInputError,
  academicKey,
  academicObject,
  academicRevision,
  parseAcademicEventRevision,
  parseAcademicImport,
  parseAcademicPreferences,
  parseAcademicScheduleVerification,
  type AcademicImportInput,
} from "@lifeos/core";
import {
  AcademicStoreError,
  type AcademicConciergeStore,
  type TelegramUserRecord,
} from "@lifeos/db";

const PREFIX = "/api/tma/study/concierge";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const PREVIEW_REQUEST = "academic-preview-v1";

function bundle(raw: unknown): AcademicImportInput {
  const input = academicObject(raw, ["sources", "events"]);
  const parsed = parseAcademicImport({ requestId: PREVIEW_REQUEST, ...input });
  if (
    parsed.events.some(
      (event) => event.kind === "personal_exam" && event.status !== "proposed",
    )
  )
    throw new AcademicInputError();
  return parsed;
}

/** Selection is separate consent. Every source/event field stays bound to preview. */
export function academicImportPreview(raw: unknown) {
  const input = bundle(raw);
  const preview = { sources: input.sources, events: input.events };
  return {
    ...preview,
    previewHash: createHash("sha256")
      .update(JSON.stringify(preview))
      .digest("hex"),
    warnings: [
      "academic_source_requires_document_review",
      "academic_import_does_not_enable_notifications",
      ...(input.events.some(
        (event) => event.kind === "personal_exam" && event.endsAt === null,
      )
        ? ["academic_personal_duration_unknown"]
        : []),
    ],
  };
}

export function parseAcademicImportConfirmation(
  raw: unknown,
): AcademicImportInput {
  const input = academicObject(raw, [
    "sources",
    "events",
    "selectedKeys",
    "previewHash",
    "confirmed",
    "requestId",
  ]);
  if (input.confirmed !== true) throw new AcademicInputError();
  const preview = academicImportPreview({
    sources: input.sources,
    events: input.events,
  });
  if (
    typeof input.previewHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.previewHash) ||
    input.previewHash !== preview.previewHash
  )
    throw new AcademicInputError();
  if (
    !Array.isArray(input.selectedKeys) ||
    input.selectedKeys.length < 1 ||
    input.selectedKeys.length > 500
  )
    throw new AcademicInputError();
  const keys = input.selectedKeys.map(academicKey);
  const selected = new Set(keys);
  if (
    selected.size !== keys.length ||
    keys.some((key) => !preview.events.some((event) => event.key === key))
  )
    throw new AcademicInputError();
  const events = preview.events.filter((event) => selected.has(event.key));
  const sourceKeys = new Set(events.map((event) => event.sourceKey));
  // A personal proposal stays proposed; importing data does not confirm an exam.
  return parseAcademicImport({
    requestId: academicKey(input.requestId),
    sources: preview.sources.filter((source) => sourceKeys.has(source.key)),
    events,
  });
}

export async function handleAcademicConciergeRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  user: TelegramUserRecord;
  academic?: AcademicConciergeStore;
  deliveryEnabled: boolean;
  readJsonBody: (
    request: IncomingMessage,
    maxBytes?: number,
  ) => Promise<unknown>;
  writeJson: (response: ServerResponse, status: number, value: unknown) => void;
}): Promise<boolean> {
  const { request, response, url, user, academic, writeJson } = options;
  if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + "/"))
    return false;
  response.setHeader("Cache-Control", "no-store");
  if (url.search) {
    writeJson(response, 400, { error: "academic_invalid_input" });
    return true;
  }
  const relative = url.pathname.slice(PREFIX.length);
  const fixed: Record<string, readonly string[]> = {
    "": ["GET"],
    "/preferences": ["PUT"],
    "/import/preview": ["POST"],
    "/import/confirm": ["POST"],
    "/schedule/verify": ["POST"],
  };
  const event = /^\/events\/([a-f0-9-]{36})(?:\/(confirm|cancel))?$/i.exec(
    relative,
  );
  const methods =
    fixed[relative] ?? (event ? [event[2] ? "POST" : "PATCH"] : null);
  if (!methods) {
    writeJson(response, 404, { error: "academic_not_found" });
    return true;
  }
  if (!methods.includes(request.method ?? "")) {
    response.setHeader("Allow", methods.join(", "));
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (event && !UUID.test(event[1])) {
    writeJson(response, 400, { error: "academic_invalid_input" });
    return true;
  }
  if (!academic) {
    writeJson(response, 503, { error: "academic_unavailable" });
    return true;
  }
  const raw =
    request.method === "GET"
      ? undefined
      : await options.readJsonBody(request, 262144);
  const sendOverview = (overview: unknown) =>
    writeJson(response, 200, {
      data: {
        ...(overview as object),
        deliveryEnabled: options.deliveryEnabled,
      },
    });
  try {
    if (relative === "") sendOverview(await academic.overview(user.userId));
    else if (relative === "/import/preview")
      writeJson(response, 200, { data: academicImportPreview(raw) });
    else if (relative === "/import/confirm") {
      const result = await academic.importRecords(
        user.userId,
        parseAcademicImportConfirmation(raw),
      );
      writeJson(response, 200, {
        data: {
          ...result,
          overview: {
            ...result.overview,
            deliveryEnabled: options.deliveryEnabled,
          },
        },
      });
    } else if (relative === "/preferences") {
      const input = academicObject(raw, [
        "expectedRevision",
        "preferences",
        "confirmed",
      ]);
      if (input.confirmed !== true) throw new AcademicInputError();
      sendOverview(
        await academic.preferences(user.userId, {
          expectedRevision: academicRevision(input.expectedRevision),
          preferences: parseAcademicPreferences(input.preferences),
        }),
      );
    } else if (relative === "/schedule/verify")
      sendOverview(
        await academic.verifySchedule(
          user.userId,
          parseAcademicScheduleVerification(raw),
        ),
      );
    else if (event) {
      let input;
      if (event[2]) {
        const body = academicObject(raw, ["expectedRevision", "confirmed"]);
        if (body.confirmed !== true) throw new AcademicInputError();
        input = parseAcademicEventRevision({
          expectedRevision: body.expectedRevision,
          patch: { status: event[2] === "confirm" ? "confirmed" : "cancelled" },
          confirmed: true,
        });
      } else input = parseAcademicEventRevision(raw);
      sendOverview(
        await academic.reviseEvent(user.userId, event[1].toLowerCase(), input),
      );
    }
  } catch (error) {
    if (error instanceof AcademicInputError)
      writeJson(response, 400, { error: error.code });
    else if (error instanceof AcademicStoreError) {
      const status =
        error.code === "academic_not_found"
          ? 404
          : error.code === "academic_conflict"
            ? 409
            : error.code === "academic_invalid_input"
              ? 400
              : 503;
      writeJson(response, status, { error: error.code });
    } else writeJson(response, 503, { error: "academic_unavailable" });
  }
  return true;
}
