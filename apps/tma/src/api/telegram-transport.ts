import { telegram } from "../telegram";
import type { ApiEnvelope } from "./types";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

import { ApiError } from "./errors";

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-telegram-init-data": telegram.initData,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(
      text || `Request failed: ${response.status}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json()) as ApiEnvelope<T> | T;

  if (body && typeof body === "object" && "data" in body) {
    return (body as ApiEnvelope<T>).data;
  }

  return body as T;
}
