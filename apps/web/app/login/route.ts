import { NextRequest, NextResponse } from "next/server";
import { verifyWebTokenAgainstApi } from "@/lib/lifeos-api";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.redirect(new URL("/access?error=invalid", request.url));
  }

  try {
    const verification = await verifyWebTokenAgainstApi(token);
    if (!verification.ok) {
      return NextResponse.redirect(new URL("/access?error=invalid", request.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/access?error=invalid", request.url));
  }

  const response = NextResponse.redirect(new URL("/today", request.url));
  response.cookies.set("lifeos_web_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
