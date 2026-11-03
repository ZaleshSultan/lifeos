import { CaptureInputError } from "@lifeos/core";
import {
  CaptureStoreError,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import { CaptureService, CaptureServiceError } from "./capture-service.js";
import {
  CaptureTelegramIngestError,
  CaptureTelegramRequestError,
  type CaptureTelegramPort,
} from "./telegram/capture.js";

/** This adapter is private server code: identities and media references come from the webhook. */
export function createCaptureTelegramPort(
  service: CaptureService,
  store: LifeOSStore,
): CaptureTelegramPort {
  async function owner(userId: string): Promise<TelegramUserRecord> {
    const user = await store.resolveUserById(userId);
    if (!user || user.status !== "active" || user.userId !== userId)
      throw new CaptureTelegramRequestError("unavailable");
    return user;
  }
  function safeFailure(error: unknown): never {
    if (
      error instanceof CaptureTelegramRequestError ||
      error instanceof CaptureInputError
    )
      throw error;
    if (error instanceof CaptureServiceError && error.statusCode < 500)
      throw new CaptureTelegramRequestError(
        error.statusCode === 409 ? "conflict" : "invalid_input",
      );
    if (
      error instanceof CaptureStoreError &&
      !["capture_storage_unavailable", "capture_journal_unavailable"].includes(
        error.code,
      )
    )
      throw new CaptureTelegramRequestError(
        error.code === "capture_conflict" ? "conflict" : "invalid_input",
      );
    throw new CaptureTelegramIngestError();
  }
  return {
    async ingestText(input) {
      try {
        const user = await owner(input.userId);
        let inputType: "text" | "link" = "text";
        try {
          const url = new URL(input.text);
          if (
            ["https:", "http:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !/\s/u.test(input.text)
          )
            inputType = "link";
        } catch {
          /* Plain text remains plain data; no URL is fetched. */
        }
        const result = await service.ingest(
          user,
          {
            requestId: input.requestId,
            inputType,
            text: input.text,
            retentionDays: null,
          },
          "telegram",
          { sourceReference: input.sourceReference },
        );
        return {
          id: result.capture.id,
          state: result.capture.state,
          duplicate: !result.created,
        };
      } catch (error) {
        return safeFailure(error);
      }
    },
    async ingestVoice(input) {
      try {
        const user = await owner(input.userId);
        const result = await service.ingest(
          user,
          {
            requestId: input.requestId,
            inputType: "voice",
            text: "",
            retentionDays: null,
          },
          "telegram",
          { voice: input.voice, sourceReference: input.sourceReference },
        );
        return {
          id: result.capture.id,
          state: result.capture.state,
          duplicate: !result.created,
        };
      } catch (error) {
        return safeFailure(error);
      }
    },
    async setTranscript(input) {
      try {
        const user = await owner(input.userId);
        const capture = await service.get(user, input.captureId);
        if (capture.inputType !== "voice")
          throw new CaptureTelegramRequestError("invalid_input");
        if (capture.transcript === input.text)
          return { id: capture.id, state: capture.state, duplicate: true };
        // Telegram transcript attachment is write-once. Late retried messages can
        // never overwrite a newer transcript or approved actions; edits use the inbox.
        if (capture.transcript)
          throw new CaptureTelegramRequestError("conflict");
        const result = await service.edit(user, capture.id, {
          expectedRevision: capture.revision,
          transcript: input.text,
        });
        return { id: result.id, state: result.state, duplicate: false };
      } catch (error) {
        return safeFailure(error);
      }
    },
  };
}
