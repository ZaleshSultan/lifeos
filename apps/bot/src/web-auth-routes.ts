import type { IncomingMessage, ServerResponse } from "node:http";
import type { LifeOSStore } from "@lifeos/db";
import {
  exchangeWebLoginToken,
  hashWebToken,
  resolveWebSessionUser,
} from "./web-session.js";

export async function handleWebAuthRoute(input: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  token: string | undefined;
  store: LifeOSStore | undefined;
  secret: string | undefined;
  writeJson: (response: ServerResponse, status: number, body: unknown) => void;
}): Promise<boolean> {
  const { request, response, pathname, token, store, secret, writeJson } =
    input;
  if (
    pathname !== "/api/web/auth/exchange" &&
    pathname !== "/api/web/auth/logout"
  )
    return false;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    writeJson(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!store || !secret) {
    writeJson(response, 503, { error: "web_auth_unavailable" });
    return true;
  }
  try {
    if (pathname.endsWith("/exchange")) {
      const session = await exchangeWebLoginToken(store, token, secret);
      writeJson(
        response,
        session ? 200 : 401,
        session ? { data: session } : { error: "invalid_web_login" },
      );
    } else {
      const user = await resolveWebSessionUser(store, token);
      if (user && token)
        await store.revokeWebSession(user.userId, hashWebToken(token));
      response.writeHead(204);
      response.end();
    }
  } catch {
    // No tokens, URLs, request bodies or database diagnostics in logs/errors.
    writeJson(response, 503, { error: "web_auth_unavailable" });
  }
  return true;
}
