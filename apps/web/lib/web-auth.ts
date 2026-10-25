import { NextResponse } from "next/server";

export const WEB_SESSION_COOKIE = "lifeos_web_session";

export function publicWebUrl(path: string): URL {
  const base =
    process.env.NEXT_PUBLIC_WEB_APP_URL?.trim() ||
    "https://lifeos.zalewko.me/web";
  return new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}

export function webCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export function privateAuthResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function lifeosApiBaseUrl(): string {
  const value =
    process.env.LIFEOS_API_BASE_URL ??
    process.env.NEXT_PUBLIC_LIFEOS_API_BASE_URL;
  if (!value) throw new Error("LIFEOS_API_BASE_URL is not configured");
  return value.replace(/\/$/, "");
}

export function verifyWebTokenAgainstApi(token: string): Promise<Response> {
  return fetch(`${lifeosApiBaseUrl()}/api/tma/session`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
}

export function webAuthRequest(
  action: "exchange" | "logout",
  token: string,
): Promise<Response> {
  return fetch(`${lifeosApiBaseUrl()}/api/web/auth/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
}
