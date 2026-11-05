import type { IncomingMessage, ServerResponse } from "node:http";
import {
  academicIntelligenceObject,
  academicIntelligenceRevision,
  parseAcademicIntelligencePreferences,
  AcademicIntelligenceInputError,
} from "@lifeos/core";
import {
  AcademicIntelligenceStoreError,
  type AcademicIntelligenceStore,
} from "@lifeos/db";

export async function handleAcademicIntelligenceRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  userId: string;
  academic?: AcademicIntelligenceStore;
  deliveryEnabled: boolean;
  readJsonBody(request: IncomingMessage, maxBytes?: number): Promise<unknown>;
  writeJson(response: ServerResponse, status: number, value: unknown): void;
}): Promise<boolean> {
  const { request, response, url, academic, writeJson } = options;
  const policy =
    /^\/api\/tma\/study\/grade-policy\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(
      url.pathname,
    );
  const feed = url.pathname === "/api/tma/study/grade-events",
    preferences = url.pathname === "/api/tma/study/academic-preferences";
  if (!feed && !preferences && !policy) return false;
  response.setHeader("Cache-Control", "no-store");
  if (url.search) {
    writeJson(response, 400, { error: "academic_intelligence_invalid_input" });
    return true;
  }
  const method = feed ? "GET" : "PUT";
  if (request.method !== method) {
    response.setHeader("Allow", method);
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!academic) {
    writeJson(response, 503, { error: "academic_intelligence_unavailable" });
    return true;
  }
  try {
    let result;
    if (feed) result = await academic.feed(options.userId);
    else if (preferences) {
      const body = academicIntelligenceObject(
        await options.readJsonBody(request, 262144),
        [
          "expectedRevision",
          "expectedAcademicRevision",
          "confirmed",
          "preferences",
        ],
      );
      if (body.confirmed !== true) throw new AcademicIntelligenceInputError();
      result = await academic.preferences(options.userId, {
        expectedRevision: academicIntelligenceRevision(body.expectedRevision),
        expectedAcademicRevision: academicIntelligenceRevision(
          body.expectedAcademicRevision,
        ),
        preferences: parseAcademicIntelligencePreferences(body.preferences),
      });
    } else {
      const body = academicIntelligenceObject(
        await options.readJsonBody(request, 262144),
        [
          "expectedRevision",
          "definitionKey",
          "bindingsKey",
          "contextKey",
          "sourceRef",
          "currentEnrollmentConfirmed",
          "supportedRulesConfirmed",
          "confirmed",
        ],
      );
      if (
        body.confirmed !== true ||
        body.currentEnrollmentConfirmed !== true ||
        body.supportedRulesConfirmed !== true ||
        [body.definitionKey, body.bindingsKey].some(
          (v) => typeof v !== "string" || v.length < 1 || v.length > 65536,
        ) ||
        typeof body.contextKey !== "string" ||
        body.contextKey.length < 1 ||
        body.contextKey.length > 2000 ||
        typeof body.sourceRef !== "string" ||
        !body.sourceRef.trim() ||
        body.sourceRef.length > 500 ||
        /[\x00-\x1f]/.test(body.sourceRef)
      )
        throw new AcademicIntelligenceInputError();
      result = await academic.reviewPolicy(options.userId, policy![1], {
        expectedRevision: academicIntelligenceRevision(body.expectedRevision),
        definitionKey: body.definitionKey as string,
        bindingsKey: body.bindingsKey as string,
        contextKey: body.contextKey as string,
        sourceRef: body.sourceRef.trim(),
      });
    }
    writeJson(response, 200, {
      data: { ...result, deliveryEnabled: options.deliveryEnabled },
    });
  } catch (error) {
    if (error instanceof AcademicIntelligenceInputError)
      writeJson(response, 400, { error: error.code });
    else if (error instanceof AcademicIntelligenceStoreError)
      writeJson(
        response,
        error.code.endsWith("conflict")
          ? 409
          : error.code.endsWith("not_found")
            ? 404
            : error.code.endsWith("invalid_input")
              ? 400
              : 503,
        { error: error.code },
      );
    else
      writeJson(response, 503, { error: "academic_intelligence_unavailable" });
  }
  return true;
}
