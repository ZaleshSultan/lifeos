import type { IncomingMessage, ServerResponse } from "node:http";
import { isProduction } from "./security-config.js";

export function corsOrigins(
  values: readonly string[],
  nodeEnv?: string,
): Set<string> {
  const origins = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid LIFEOS_CORS_ALLOWED_ORIGINS");
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && local && !isProduction(nodeEnv)))
    ) {
      throw new Error(
        "CORS origins must be exact HTTPS origins (local HTTP allowed outside production)",
      );
    }
    origins.add(value);
  }
  return origins;
}

// CORS is transport policy only. Every permitted request still reaches normal auth.
export function handleApiCors(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  allowed: ReadonlySet<string>,
): boolean {
  if (!pathname.startsWith("/api/") && pathname !== "/health/ingest")
    return false;
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("vary", "Origin");
  const origin = request.headers.origin;
  const tma = pathname.startsWith("/api/tma/");
  const health = ["/api/health/ingest", "/health/ingest"].includes(pathname);
  const methods = tma
    ? ["GET", "POST", "PUT", "PATCH", "DELETE"]
    : health
      ? ["POST"]
      : [];
  const headers = ["authorization", "content-type", "x-telegram-init-data"];
  // Do not trust forwarded headers. TLS-terminating proxies must configure the public
  // frontend origin explicitly; direct same-origin HTTP/HTTPS remains supported.
  const protocol =
    "encrypted" in request.socket && request.socket.encrypted
      ? "https"
      : "http";
  const sameOrigin = origin === `${protocol}://${request.headers.host}`;
  const reject = (status: number, error: string) => {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error }));
    return true;
  };
  if (origin && (!methods.length || (!sameOrigin && !allowed.has(origin)))) {
    return reject(403, "origin_not_allowed");
  }
  if (origin) response.setHeader("access-control-allow-origin", origin);
  if (request.method !== "OPTIONS") return false;
  response.setHeader(
    "vary",
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  );
  const method = request.headers["access-control-request-method"];
  const requestedHeaders = request.headers["access-control-request-headers"];
  if (
    !origin ||
    typeof method !== "string" ||
    !methods.includes(method) ||
    (requestedHeaders !== undefined &&
      (typeof requestedHeaders !== "string" ||
        requestedHeaders
          .split(",")
          .some((header) => !headers.includes(header.trim().toLowerCase()))))
  ) {
    return reject(403, "preflight_not_allowed");
  }
  response.setHeader("access-control-allow-methods", methods.join(","));
  response.setHeader("access-control-allow-headers", headers.join(","));
  response.writeHead(204);
  response.end();
  return true;
}
