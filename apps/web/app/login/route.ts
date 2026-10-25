import { NextRequest, NextResponse } from "next/server";
import {
  privateAuthResponse,
  publicWebUrl,
  webAuthRequest,
  webCookieOptions,
  WEB_SESSION_COOKIE,
} from "../../lib/web-auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  const invalid = () =>
    privateAuthResponse(
      NextResponse.redirect(publicWebUrl("access?error=invalid"), 303),
    );
  if (!token || token.length > 1024) return invalid();
  try {
    const exchange = await webAuthRequest("exchange", token);
    if (!exchange.ok) return invalid();
    const body = (await exchange.json()) as {
      data?: { token?: string; expiresAt?: string };
    };
    const session = body.data;
    const expiresAt = Date.parse(session?.expiresAt ?? "");
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
    if (
      !session?.token ||
      !/^ws1_[A-Za-z0-9_-]{43}$/.test(session.token) ||
      !Number.isFinite(maxAge) ||
      maxAge <= 0 ||
      maxAge > 30 * 24 * 60 * 60
    )
      return invalid();
    const response = privateAuthResponse(
      NextResponse.redirect(publicWebUrl("today"), 303),
    );
    response.cookies.set(WEB_SESSION_COOKIE, session.token, {
      ...webCookieOptions(),
      maxAge,
      expires: new Date(expiresAt),
    });
    return response;
  } catch {
    return invalid();
  }
}
