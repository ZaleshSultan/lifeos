import { NextRequest, NextResponse } from "next/server";
import { exchangeWebLoginToken } from "@/lib/lifeos-api";

function publicWebUrl(path: string): URL {
  const base =
    process.env.NEXT_PUBLIC_WEB_APP_URL?.trim() ||
    "https://lifeos.zalewko.me/web";

  return new URL(
    `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
  );
}

export async function GET(request: NextRequest) {
  const loginToken = request.nextUrl.searchParams.get("token")?.trim();

  if (!loginToken) {
    return NextResponse.redirect(
      publicWebUrl("access?error=invalid"),
    );
  }

  let sessionToken: string | null = null;

  try {
    sessionToken = await exchangeWebLoginToken(loginToken);
  } catch {
    sessionToken = null;
  }

  if (!sessionToken) {
    return NextResponse.redirect(
      publicWebUrl("access?error=invalid"),
    );
  }

  const response = NextResponse.redirect(
    publicWebUrl("today"),
  );

  response.cookies.set("lifeos_web_session", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}
