import { NextRequest, NextResponse } from "next/server";
import {
  bridgeQuery,
  bridgeResourceAllowed,
} from "../../../../lib/bridge-policy";
import {
  lifeosApiBaseUrl,
  privateAuthResponse,
  publicWebUrl,
  WEB_SESSION_COOKIE,
} from "../../../../lib/web-auth";

export const dynamic = "force-dynamic";
const json = (body: unknown, status: number) =>
  privateAuthResponse(NextResponse.json(body, { status }));
async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;
  const path = parts.join("/");
  if (!bridgeResourceAllowed(path, request.method))
    return json({ error: "resource_not_allowed" }, 404);
  const query = bridgeQuery(request.nextUrl.searchParams);
  if (query === null) return json({ error: "invalid_query" }, 400);
  const token = request.cookies.get(WEB_SESSION_COOKIE)?.value;
  if (!token) return json({ error: "invalid_web_session" }, 401);
  const mutation = !["GET", "HEAD"].includes(request.method);
  if (
    mutation &&
    (request.headers.get("origin") !== publicWebUrl("access").origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
  )
    return json({ error: "invalid_origin" }, 403);
  let body: string | undefined;
  if (
    mutation &&
    (request.method !== "DELETE" ||
      /^captures\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        path,
      ))
  ) {
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return json({ error: "json_required" }, 415);
    const size = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(size) || size > 1_048_576)
      return json({ error: "body_too_large" }, 413);
    const reader = request.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > 1_048_576) {
          await reader.cancel();
          return json({ error: "body_too_large" }, 413);
        }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = new TextDecoder().decode(bytes);
    }
    try {
      JSON.parse(body || "{}");
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
  }
  try {
    const response = await fetch(
      `${lifeosApiBaseUrl()}/api/tma/${path}${query ? `?${query}` : ""}`,
      {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            path === "nutrition/analyze"
              ? 125_000
              : path === "ai/chat"
                ? 60_000
                : 15_000,
          ),
        ]),
      },
    );
    if (response.status === 204)
      return privateAuthResponse(new NextResponse(null, { status: 204 }));
    const data: unknown = await response.json();
    if (!response.ok) {
      const code =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof data.error === "string" &&
        /^[a-z0-9_]{1,100}$/.test(data.error)
          ? data.error
          : "request_failed";
      return json(
        { error: response.status >= 500 ? "backend_unavailable" : code },
        response.status,
      );
    }
    return json(data, response.status);
  } catch {
    return json({ error: "backend_unavailable" }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
