import type {
  AcademicEventRevisionInput,
  AcademicImportInput,
  AcademicImportResult,
  AcademicOverview,
  AcademicPreferences,
  AcademicScheduleVerificationInput,
} from "../../core/src/academic-concierge.js";
import {
  getAcademicOverview,
  importAcademicRecords,
  reviseAcademicEvent,
  saveAcademicPreferences,
  verifyAcademicSchedule,
} from "./academic-concierge-store.js";

/** The authenticated boundary supplies the owner; imported content never does. */
export interface AcademicConciergeStore {
  overview(userId: string): Promise<AcademicOverview>;
  importRecords(
    userId: string,
    input: AcademicImportInput,
  ): Promise<AcademicImportResult>;
  preferences(
    userId: string,
    input: { expectedRevision: number; preferences: AcademicPreferences },
  ): Promise<AcademicOverview>;
  reviseEvent(
    userId: string,
    eventId: string,
    input: AcademicEventRevisionInput,
  ): Promise<AcademicOverview>;
  verifySchedule(
    userId: string,
    input: AcademicScheduleVerificationInput,
  ): Promise<AcademicOverview>;
}

export function createAcademicConciergeStore(
  client: Parameters<typeof getAcademicOverview>[0],
): AcademicConciergeStore {
  return {
    overview: (userId) => getAcademicOverview(client, userId),
    importRecords: (userId, input) =>
      importAcademicRecords(client, userId, input),
    preferences: (userId, input) =>
      saveAcademicPreferences(client, userId, input),
    reviseEvent: (userId, eventId, input) =>
      reviseAcademicEvent(client, userId, eventId, input),
    verifySchedule: (userId, input) =>
      verifyAcademicSchedule(client, userId, input),
  };
}
