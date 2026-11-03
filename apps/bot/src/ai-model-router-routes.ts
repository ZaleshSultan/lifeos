import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AiRouterValidationError,
  AI_ROUTER_TASK_CATEGORIES,
  type AiRouterTaskCategory,
} from "@lifeos/core";
import { AiRouterSettingsConflictError } from "@lifeos/db";
import { AiRouterError, type AiModelRouter } from "./ai-model-router.js";
export async function handleAiModelRouterRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  userId: string;
  router?: AiModelRouter;
  readJsonBody: (
    request: IncomingMessage,
    maxBytes?: number,
  ) => Promise<unknown>;
  writeJson: (response: ServerResponse, status: number, value: unknown) => void;
}): Promise<boolean> {
  const { request, response, url, router, writeJson } = options;
  if (!url.pathname.startsWith("/api/tma/ai/router/")) return false;
  response.setHeader("Cache-Control", "no-store");
  const settings = url.pathname === "/api/tma/ai/router/settings";
  const preview = url.pathname === "/api/tma/ai/router/preview";
  if (!settings && !preview) {
    writeJson(response, 404, { error: "ai_router_action_not_supported" });
    return true;
  }
  if (url.search) {
    writeJson(response, 400, { error: "ai_router_invalid_request" });
    return true;
  }
  if (
    !(
      (settings && ["GET", "PUT"].includes(request.method ?? "")) ||
      (preview && request.method === "POST")
    )
  ) {
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!router) {
    writeJson(response, 503, { error: "ai_router_unavailable" });
    return true;
  }
  // Preserve the server's bounded malformed-JSON/oversize error handling.
  const parsedBody =
    request.method === "GET"
      ? undefined
      : await options.readJsonBody(request, 65536);
  try {
    if (settings && request.method === "GET") {
      writeJson(response, 200, { data: await router.snapshot(options.userId) });
      return true;
    }
    const value = parsedBody;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new AiRouterError("ai_router_invalid_request", 400);
    const body = value as Record<string, unknown>;
    if (settings) {
      if (
        Object.keys(body).length !== 2 ||
        !Object.hasOwn(body, "settings") ||
        !Number.isSafeInteger(body.expectedRevision) ||
        Number(body.expectedRevision) < 0 ||
        Number(body.expectedRevision) >= 2147483647
      )
        throw new AiRouterError("ai_router_invalid_request", 400);
      writeJson(response, 200, {
        data: await router.save(
          options.userId,
          body.settings,
          Number(body.expectedRevision),
        ),
      });
      return true;
    }
    if (
      Object.keys(body).some(
        (k) =>
          ![
            "category",
            "estimatedInputTokens",
            "maxOutputTokens",
            "previousModelId",
          ].includes(k),
      ) ||
      !AI_ROUTER_TASK_CATEGORIES.includes(body.category as AiRouterTaskCategory)
    )
      throw new AiRouterError("ai_router_invalid_request", 400);
    const category = body.category as AiRouterTaskCategory;
    const dataCategories: ("general" | "health" | "university")[] =
      category === "nutrition_photo"
        ? ["general", "health"]
        : category === "planning"
          ? ["general", "university"]
          : ["general"];
    writeJson(response, 200, {
      data: {
        decision: await router.preview(
          options.userId,
          {
            category,
            dataCategories,
            requiredCapabilities: ["deterministic", "tagging"].includes(
              category,
            )
              ? []
              : ["json"],
          },
          body.estimatedInputTokens as number,
          body.maxOutputTokens as number,
          body.previousModelId as string | undefined,
        ),
        providerRequests: 0,
        budgetEnforcedAtExecution: true,
      },
    });
  } catch (error) {
    if (error instanceof AiRouterSettingsConflictError)
      writeJson(response, 409, { error: "ai_router_settings_conflict" });
    else if (error instanceof AiRouterValidationError)
      writeJson(response, 400, { error: "ai_router_invalid_settings" });
    else if (error instanceof AiRouterError)
      writeJson(response, error.statusCode, { error: error.code });
    else if (error instanceof SyntaxError)
      writeJson(response, 400, { error: "ai_router_invalid_request" });
    else writeJson(response, 503, { error: "ai_router_storage_unavailable" });
  }
  return true;
}
