import type { IncomingMessage, ServerResponse } from "node:http";
import { IdealHumanInputError, parseIdealHumanDay } from "@lifeos/core";
import type { LifeOSStore } from "@lifeos/db";

export async function handleIdealHumanRoute({
  request, response, pathname, userId, store, readJsonBody, writeJson,
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
  if (pathname !== "/api/tma/ideal-human/days") {
    writeJson(response, 404, { error: "not_found" });
    return true;
  }
  if (!store.getIdealHumanDays || !store.saveIdealHumanDay) {
    writeJson(response, 503, { error: "ideal_human_unavailable" });
    return true;
  }
  if (request.method === "GET") {
    writeJson(response, 200, { data: await store.getIdealHumanDays(userId) });
    return true;
  }
  if (request.method === "PUT") {
    try {
      const day = parseIdealHumanDay(await readJsonBody(request));
      writeJson(response, 200, { data: await store.saveIdealHumanDay(userId, day) });
    } catch (error) {
      if (!(error instanceof IdealHumanInputError)) throw error;
      writeJson(response, 400, { error: "invalid_ideal_human_day", message: error.message });
    }
    return true;
  }
  writeJson(response, 405, { error: "method_not_allowed" });
  return true;
}
