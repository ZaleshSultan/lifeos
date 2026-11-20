import { ApiError } from "../../tma/src/api/errors";
import { WebApiError, webRequest } from "./web-client";

// Shared screens use the authenticated Web bridge when rendered by Next.
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const prefix = "/api/tma/";
  if (!path.startsWith(prefix)) throw new Error("Unexpected LifeOS resource");
  try {
    return await webRequest<T>(path.slice(prefix.length), options);
  } catch (error) {
    if (!(error instanceof WebApiError)) throw error;
    if (error.status === 401 && typeof window !== "undefined") {
      window.location.replace("/web/access");
    }
    throw new ApiError(JSON.stringify({ error: error.code }), error.status);
  }
}
