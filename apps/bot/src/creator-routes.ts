import type { IncomingMessage, ServerResponse } from "node:http";
import { creatorCapabilities } from "../../../packages/core/src/creator.js";
/** Run only after the shared active-profile boundary. No provider/account access exists here. */
export function handleCreatorRoute({
  request,
  response,
  pathname,
  writeJson,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  writeJson: (response: ServerResponse, code: number, body: unknown) => void;
}): boolean {
  if (!pathname.startsWith("/api/tma/creator/")) return false;
  response.setHeader("Cache-Control", "no-store");
  if (pathname !== "/api/tma/creator/capabilities") {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  writeJson(response, 200, { data: creatorCapabilities() });
  return true;
}
