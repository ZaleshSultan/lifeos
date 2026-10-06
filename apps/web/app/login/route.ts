import { NextRequest, NextResponse } from "next/server";
import { verifyWebTokenAgainstApi } from "@/lib/lifeos-api";

function publicWebUrl(path: string): URL {
  const base =
    process.env.NEXT_PUBLIC_WEB_APP_URL?.trim() ||
    "https://lifeos.zalewko.me/web";

  return new URL(
    `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return NextResponse.redirect(
      publicWebUrl("access?error=invalid"),
    );
  }

  try {
    const verification = await verifyWebTokenAgainstApi(token);

    if (!verification.ok) {
      return NextResponse.redirect(
        publicWebUrl("access?error=invalid"),
      );
    }
  } catch {
    return NextResponse.redirect(
      publicWebUrl("access?error=invalid"),
    );
  }

  const response = NextResponse.redirect(
    publicWebUrl("today"),
  );

  response.cookies.set("lifeos_web_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}
