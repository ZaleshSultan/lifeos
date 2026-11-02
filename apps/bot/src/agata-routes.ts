import type { IncomingMessage, ServerResponse } from "node:http";
import { agataCapabilities } from "../../../packages/core/src/agata.js";

/** Invoke only after the existing authenticated active-profile API boundary. */
export function handleAgataRoute({
  request,
  response,
  url,
  writeJson,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  writeJson: (response: ServerResponse, status: number, body: unknown) => void;
}): boolean {
  if (!url.pathname.startsWith("/api/tma/agata/")) return false;
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname !== "/api/tma/agata/capabilities") {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (url.search) {
    writeJson(response, 400, { error: "agata_invalid_request" });
    return true;
  }
  writeJson(response, 200, { data: agataCapabilities() });
  return true;
}
