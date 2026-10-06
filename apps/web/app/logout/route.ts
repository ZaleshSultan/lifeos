import { NextResponse } from "next/server";

function publicWebUrl(path: string): URL {
  const base =
    process.env.NEXT_PUBLIC_WEB_APP_URL?.trim() ||
    "https://lifeos.zalewko.me/web";

  return new URL(
    `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
  );
}

export async function GET() {
  const response = NextResponse.redirect(
    publicWebUrl("access"),
  );

  response.cookies.set("lifeos_web_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
