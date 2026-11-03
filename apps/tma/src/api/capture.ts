import { useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CaptureCapabilities,
  CaptureSearchResult,
} from "../../../../packages/core/src/universal-capture.js";
import { DraftOwnerContext } from "../lib/session-draft";
import { ApiError, apiErrorMessage, request } from "./client";
import {
  captureTransport,
  type CaptureTransport,
} from "../components/capture/transport";
import { captureErrorMessage } from "../components/capture/errors";

export function captureApiError(error: unknown) {
  if (error instanceof ApiError) {
    let code: string | undefined;
    try {
      const body: unknown = JSON.parse(error.message);
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
      )
        code = body.error;
    } catch {
      /* Never echo unstructured diagnostics. */
    }
    const message = captureErrorMessage(code, error.status);
    if (message) return message;
  }
  return apiErrorMessage(error);
}

export function useCaptureInbox() {
  const owner = useContext(DraftOwnerContext);
  const cache = useQueryClient();
  const transport = useMemo<CaptureTransport>(() => {
    const raw = captureTransport(<T>(resource: string, options?: RequestInit) =>
      request<T>(`/api/tma/${resource}`, options),
    );
    const changed = async <T>(work: Promise<T>) => {
      const result = await work;
      void cache.invalidateQueries({ queryKey: ["captures", owner] });
      void cache.invalidateQueries({ queryKey: ["daily-life", owner] });
      void cache.invalidateQueries({ queryKey: ["today"] });
      void cache.invalidateQueries({
        queryKey: ["ideal-human", "days", owner],
      });
      return result;
    };
    return {
      ...raw,
      search: (input, signal) =>
        cache.fetchQuery({
          queryKey: ["captures", owner, "search", input],
          queryFn: () => raw.search(input, signal),
          staleTime: 0,
          retry: false,
        }),
      get: (id, signal) =>
        cache.fetchQuery({
          queryKey: ["captures", owner, "detail", id],
          queryFn: () => raw.get(id, signal),
          staleTime: 0,
          retry: false,
        }),
      memories: (signal) =>
        cache.fetchQuery({
          queryKey: ["captures", owner, "memories"],
          queryFn: () => raw.memories(signal),
          staleTime: 0,
          retry: false,
        }),
      tasks: (signal) =>
        cache.fetchQuery({
          queryKey: ["captures", owner, "task-options"],
          queryFn: () => raw.tasks(signal),
          staleTime: 0,
          retry: false,
        }),
      create: (input) => changed(raw.create(input)),
      edit: (id, input) => changed(raw.edit(id, input)),
      lifecycle: (id, action, revision) =>
        changed(raw.lifecycle(id, action, revision)),
      confirm: (id, input) => changed(raw.confirm(id, input)),
      remove: (id, revision) => changed(raw.remove(id, revision)),
    };
  }, [owner, cache]);
  const capabilities = useQuery({
    queryKey: ["captures", owner, "capabilities"],
    queryFn: ({ signal }) =>
      request<CaptureCapabilities>("/api/tma/captures/capabilities", {
        signal,
      }),
    retry: false,
    staleTime: 30_000,
  });
  const history = useQuery({
    queryKey: ["captures", owner, "recent"],
    queryFn: ({ signal }) =>
      request<CaptureSearchResult>("/api/tma/captures", { signal }),
    retry: false,
    staleTime: 15_000,
  });
  return { capabilities, history, transport };
}
