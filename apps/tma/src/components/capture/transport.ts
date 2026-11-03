import type { TaskWorkspace } from "../../../../../packages/core/src/daily-life.js";
import type {
  CaptureCapabilities,
  CaptureConfirmRequest,
  CaptureEditRequest,
  CaptureIngestRequest,
  CaptureMemoryView,
  CaptureSearchInput,
  CaptureSearchResult,
  CaptureView,
} from "../../../../../packages/core/src/universal-capture.js";

export type CaptureLifecycle =
  | "process"
  | "retry"
  | "cancel"
  | "archive"
  | "restore";
export interface CaptureCorrectionInput {
  expectedRevision: number;
  instruction: string;
}
export interface CaptureRejectInput {
  expectedRevision: number;
  actionId: string;
}
export interface CaptureExternalInput {
  expectedRevision: number;
  requestId: string;
  mode: "model" | "transcription";
  confirmed: true;
}
export interface CaptureTransport {
  capabilities(signal?: AbortSignal): Promise<CaptureCapabilities>;
  search(
    input: CaptureSearchInput,
    signal?: AbortSignal,
  ): Promise<CaptureSearchResult>;
  get(id: string, signal?: AbortSignal): Promise<CaptureView>;
  create(input: CaptureIngestRequest): Promise<CaptureView>;
  edit(id: string, input: CaptureEditRequest): Promise<CaptureView>;
  lifecycle(
    id: string,
    action: CaptureLifecycle,
    expectedRevision: number,
  ): Promise<CaptureView>;
  confirm(id: string, input: CaptureConfirmRequest): Promise<CaptureView>;
  correct(id: string, input: CaptureCorrectionInput): Promise<CaptureView>;
  reject(id: string, input: CaptureRejectInput): Promise<CaptureView>;
  external(id: string, input: CaptureExternalInput): Promise<CaptureView>;
  remove(id: string, expectedRevision: number): Promise<unknown>;
  memories(signal?: AbortSignal): Promise<CaptureMemoryView[]>;
  tasks(signal?: AbortSignal): Promise<TaskWorkspace>;
}
export type CaptureDestination =
  | "priorities"
  | "water"
  | "workout"
  | "ideal-human";

/** Shared route assembly; callers supply the existing authenticated transport. */
export function captureTransport(
  request: <T>(resource: string, options?: RequestInit) => Promise<T>,
): CaptureTransport {
  const id = (value: string) => encodeURIComponent(value);
  const body = (method: string, value: unknown): RequestInit => ({
    method,
    body: JSON.stringify(value),
  });
  async function bounded<T>(
    resource: string,
    options: RequestInit = {},
  ): Promise<T> {
    const control = new AbortController();
    const abort = () => control.abort();
    const parent = options.signal;
    if (parent?.aborted) control.abort();
    else parent?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 45_000);
    try {
      return await request<T>(resource, { ...options, signal: control.signal });
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    }
  }
  return {
    capabilities: (signal) =>
      bounded<CaptureCapabilities>("captures/capabilities", { signal }),
    search: (input, signal) =>
      bounded<CaptureSearchResult>("captures/search", {
        ...body("POST", input),
        signal,
      }),
    get: (captureId, signal) =>
      bounded<CaptureView>(`captures/${id(captureId)}`, { signal }),
    create: (input) => bounded<CaptureView>("captures", body("POST", input)),
    edit: (captureId, input) =>
      bounded<CaptureView>(`captures/${id(captureId)}`, body("PATCH", input)),
    lifecycle: (captureId, action, expectedRevision) =>
      bounded<CaptureView>(
        `captures/${id(captureId)}/${action === "restore" ? "archive" : action}`,
        body("POST", {
          expectedRevision,
          ...(action === "archive" || action === "restore"
            ? { archived: action === "archive" }
            : {}),
        }),
      ),
    confirm: (captureId, input) =>
      bounded<CaptureView>(
        `captures/${id(captureId)}/confirm`,
        body("POST", input),
      ),
    correct: (captureId, input) =>
      bounded<CaptureView>(
        `captures/${id(captureId)}/correct`,
        body("POST", input),
      ),
    reject: (captureId, input) =>
      bounded<CaptureView>(
        `captures/${id(captureId)}/reject`,
        body("POST", input),
      ),
    external: (captureId, input) =>
      bounded<CaptureView>(
        `captures/${id(captureId)}/external`,
        body("POST", input),
      ),
    remove: (captureId, expectedRevision) =>
      bounded<unknown>(
        `captures/${id(captureId)}`,
        body("DELETE", { expectedRevision, confirmed: true }),
      ),
    memories: (signal) =>
      bounded<CaptureMemoryView[]>("captures/memories", { signal }),
    tasks: (signal) => bounded<TaskWorkspace>("tasks", { signal }),
  };
}
