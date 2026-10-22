import { NextRequest, NextResponse } from "next/server";
import {
  privateAuthResponse,
  publicWebUrl,
  verifyWebTokenAgainstApi,
  WEB_SESSION_COOKIE,
} from "./lib/web-auth";

// Layouts can survive client navigation. Check every protected request (including RSC).
// Backend authorization remains mandatory for every resource read and mutation.
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(WEB_SESSION_COOKIE)?.value;
  if (token) {
    try {
      const verification = await verifyWebTokenAgainstApi(token);
      if (verification.ok) {
        const body = (await verification.json()) as {
          data?: { state?: string };
        };
        if (body.data?.state === "active")
          return privateAuthResponse(NextResponse.next());
      }
    } catch {
      // Storage/network failures fail closed, without logging the credential.
    }
  }
  return privateAuthResponse(
    NextResponse.redirect(publicWebUrl("access"), 303),
  );
}

export const config = {
  matcher: ["/((?!access$|login$|logout$|_next/|favicon\\.ico$).*)"],
};
