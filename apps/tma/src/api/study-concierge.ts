import type {
  AcademicEventInput,
  AcademicEventRevisionInput,
  AcademicImportResult,
  AcademicOverview,
  AcademicPreferences,
  AcademicScheduleVerificationInput,
  AcademicSourceInput,
} from "../../../../packages/core/src/academic-concierge.js";

export interface AcademicImportBundle {
  sources: AcademicSourceInput[];
  events: AcademicEventInput[];
}
export interface AcademicImportPreview extends AcademicImportBundle {
  previewHash: string;
  warnings: string[];
}
export interface AcademicImportConfirmation extends AcademicImportBundle {
  selectedKeys: string[];
  previewHash: string;
  confirmed: true;
  requestId: string;
}
export type AcademicSnapshot = AcademicOverview & { deliveryEnabled?: boolean };
export interface AcademicTransport {
  overview(signal?: AbortSignal): Promise<AcademicSnapshot>;
  preview(bundle: AcademicImportBundle): Promise<AcademicImportPreview>;
  importSelected(
    input: AcademicImportConfirmation,
  ): Promise<AcademicImportResult>;
  preferences(preferences: AcademicPreferences): Promise<AcademicSnapshot>;
  revise(
    id: string,
    input: AcademicEventRevisionInput,
  ): Promise<AcademicSnapshot>;
  decide(
    id: string,
    action: "confirm" | "cancel",
    expectedRevision: number,
  ): Promise<AcademicSnapshot>;
  verifySchedule(
    input: AcademicScheduleVerificationInput,
  ): Promise<AcademicSnapshot>;
}

/** Uses the caller's existing authenticated transport; no credentials or provider calls. */
export function academicTransport(
  request: <T>(resource: string, options?: RequestInit) => Promise<T>,
): AcademicTransport {
  const base = "study/concierge";
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    body: JSON.stringify(body),
  });
  const id = (value: string) => encodeURIComponent(value);
  return {
    overview: (signal) => request<AcademicSnapshot>(base, { signal }),
    preview: (bundle) =>
      request<AcademicImportPreview>(
        base + "/import/preview",
        json("POST", bundle),
      ),
    importSelected: (input) =>
      request<AcademicImportResult>(
        base + "/import/confirm",
        json("POST", input),
      ),
    preferences: (preferences) =>
      request<AcademicSnapshot>(
        base + "/preferences",
        json("PUT", {
          expectedRevision: preferences.revision,
          preferences,
          confirmed: true,
        }),
      ),
    revise: (value, input) =>
      request<AcademicSnapshot>(
        base + "/events/" + id(value),
        json("PATCH", input),
      ),
    decide: (value, action, expectedRevision) =>
      request<AcademicSnapshot>(
        base + "/events/" + id(value) + "/" + action,
        json("POST", { expectedRevision, confirmed: true }),
      ),
    verifySchedule: (input) =>
      request<AcademicSnapshot>(base + "/schedule/verify", json("POST", input)),
  };
}
