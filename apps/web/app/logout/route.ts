import { NextRequest, NextResponse } from "next/server";
import {
  privateAuthResponse,
  publicWebUrl,
  webAuthRequest,
  webCookieOptions,
  WEB_SESSION_COOKIE,
} from "../../lib/web-auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(WEB_SESSION_COOKIE)?.value;
  if (token) {
    // SameSite=Lax blocks cross-site POST; Origin also blocks same-site sibling hosts.
    if (request.headers.get("origin") !== publicWebUrl("access").origin) {
      return privateAuthResponse(
        NextResponse.json({ error: "invalid_origin" }, { status: 403 }),
      );
    }
    try {
      const revoked = await webAuthRequest("logout", token);
      if (!revoked.ok) throw new Error("Logout unavailable");
    } catch {
      // Keep the cookie so logout can be retried. Never claim success before revocation.
      return privateAuthResponse(
        NextResponse.json(
          {
            error: "logout_unavailable",
            message: "Logout failed. Please try again.",
          },
          { status: 503 },
        ),
      );
    }
  }
  const response = privateAuthResponse(
    NextResponse.redirect(publicWebUrl("access"), 303),
  );
  response.cookies.set(WEB_SESSION_COOKIE, "", {
    ...webCookieOptions(),
    maxAge: 0,
  });
  return response;
}
