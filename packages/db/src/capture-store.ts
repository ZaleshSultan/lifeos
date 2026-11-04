import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAPTURE_MAX_VOICE_BYTES,
  CAPTURE_MAX_VOICE_SECONDS,
  captureActionMissingFields,
  captureActionSummary,
  captureExpectedRevision,
  captureRecordId,
  parseCaptureActionPayload,
  parseCaptureConfirmRequest,
  parseCaptureEditRequest,
  parseCaptureIngestRequest,
  parseCaptureSearchInput,
  parseCaptureView,
  parseCapturePresentation,
  parseIdealHumanDay,
  type CaptureActionPayload,
  type CaptureConfirmRequest,
  type CaptureEditRequest,
  type CaptureIngestRequest,
  type CaptureProposal,
  type CaptureProposalPresentation,
  type CaptureSearchInput,
  type CaptureSearchResult,
  type CaptureSource,
  type CaptureView,
  type IdealHumanDay,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

/** Trusted-server metadata only. Never returned by public capture projections. */
export interface CaptureVoiceReference {
  fileId: string;
  fileUniqueId: string;
  durationSeconds: number;
  mimeType: string | null;
  fileSize: number | null;
  referenceExpiresAt: string;
}
export interface CaptureSourceReference {
  chatId: number;
  messageId: number;
  updateId: number;
  occurredAt?: string;
}
export interface CaptureStoreIngestInput extends CaptureIngestRequest {
  source: Exclude<CaptureSource, "legacy">;
  voice?: CaptureVoiceReference;
  sourceReference?: CaptureSourceReference;
}
export interface CaptureIngestResult {
  capture: CaptureView;
  created: boolean;
}
export interface CaptureProcessingJob {
  capture: CaptureView;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptCount: number;
  voice: CaptureVoiceReference | null;
  referenceTime?: string;
}
/** Constructed only by the backend from current saved journal data and selected actions. */
export interface PreparedCaptureJournalEntry {
  actionId: string;
  action: CaptureActionPayload;
  date: string;
  expectedRevision: number;
  entry: IdealHumanDay;
}
export interface PreparedCaptureReadResult {
  actionId: string;
  action: CaptureActionPayload;
  summary: string;
}
export interface CaptureConfirmOptions {
  allowMemoryDelete: boolean;
  journalEntries?: PreparedCaptureJournalEntry[];
  readResults?: PreparedCaptureReadResult[];
}
export interface CaptureExternalClaimInput {
  expectedRevision: number;
  mode: "model" | "transcription";
  requestId: string;
  leaseToken: string;
  consentExpiresAt: string;
  policy: {
    settingsRevision: number;
    modelId: string;
    provider: "gemini" | "openrouter" | "openai" | "anthropic";
    maxRequestCostMicros: number;
  };
}
export interface CaptureRevisionChanges {
  updates: Array<{
    actionId: string;
    action: CaptureActionPayload;
    presentation: CaptureProposalPresentation;
  }>;
  cancelActionIds: string[];
}
export interface CaptureServiceStore {
  search(
    userId: string,
    input: CaptureSearchInput,
  ): Promise<CaptureSearchResult>;
  get(userId: string, captureId: string): Promise<CaptureView | null>;
  ingest(
    userId: string,
    input: CaptureStoreIngestInput,
  ): Promise<CaptureIngestResult>;
  edit(
    userId: string,
    captureId: string,
    input: CaptureEditRequest,
  ): Promise<CaptureView>;
  retry(
    userId: string,
    captureId: string,
    expectedRevision: number,
  ): Promise<CaptureView>;
  claim(
    userId: string,
    captureId: string,
    leaseToken: string,
  ): Promise<CaptureProcessingJob | null>;
  claimNext(
    leaseToken: string,
  ): Promise<{ userId: string; job: CaptureProcessingJob } | null>;
  /** Explicit per-record consent only; the automatic worker never uses this. */
  claimExternal?(
    userId: string,
    captureId: string,
    input: CaptureExternalClaimInput,
  ): Promise<CaptureProcessingJob | null>;
  revise?(
    userId: string,
    captureId: string,
    expectedRevision: number,
    changes: CaptureRevisionChanges,
  ): Promise<CaptureView>;
  markExternalAttempt(
    userId: string,
    captureId: string,
    leaseToken: string,
  ): Promise<void>;
  sweep(limit?: number): Promise<{ scrubbed: number }>;
  finish(
    userId: string,
    captureId: string,
    leaseToken: string,
    input: {
      proposals?: CaptureProposal[];
      transcript?: string;
      errorCode?: string;
      ambiguousProvider?: boolean;
      fallbackCode?: "capture_model_fallback";
      transcriptSource?: "manual" | "provider";
    },
  ): Promise<CaptureView>;
  confirm(
    userId: string,
    captureId: string,
    input: CaptureConfirmRequest,
    options: CaptureConfirmOptions,
  ): Promise<CaptureView>;
  cancel(
    userId: string,
    captureId: string,
    expectedRevision: number,
  ): Promise<CaptureView>;
  archive(
    userId: string,
    captureId: string,
    expectedRevision: number,
    archived: boolean,
  ): Promise<CaptureView>;
  delete(
    userId: string,
    captureId: string,
    expectedRevision: number,
  ): Promise<void>;
}
export class CaptureStoreError extends Error {
  constructor(
    readonly code:
      | "capture_invalid_input"
      | "capture_not_found"
      | "capture_conflict"
      | "capture_expired"
      | "capture_lease_lost"
      | "capture_storage_unavailable"
      | "capture_permission_denied"
      | "capture_journal_unavailable",
  ) {
    super(code);
    this.name = "CaptureStoreError";
  }
}

type CaptureDatabase = {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      capture_service: {
        Args: {
          p_user_id: string;
          p_operation: string;
          p_capture_id: string | null;
          p_expected_revision: number | null;
          p_input: Json;
        };
        Returns: Json;
      };
      capture_service_v2: {
        Args: {
          p_user_id: string;
          p_operation: string;
          p_capture_id: string | null;
          p_expected_revision: number | null;
          p_input: Json;
        };
        Returns: Json;
      };
      capture_claim_next: { Args: { p_lease_token: string }; Returns: Json };
      capture_sweep: { Args: { p_limit: number }; Returns: Json };
    };
  };
};
const REQUEST = /^[A-Za-z0-9:_-]{8,120}$/;
const ERRORS = new Set([
  "capture_invalid_input",
  "capture_not_found",
  "capture_conflict",
  "capture_expired",
  "capture_lease_lost",
  "capture_permission_denied",
  "capture_journal_unavailable",
]);
const DOMAIN_ERRORS: Record<string, CaptureStoreError["code"]> = {
  daily_life_conflict: "capture_conflict",
  ideal_human_conflict: "capture_conflict",
  assistant_idempotency_conflict: "capture_conflict",
  task_not_found: "capture_not_found",
  hydration_not_found: "capture_not_found",
  profile_inactive: "capture_permission_denied",
  ideal_human_profile_inactive: "capture_permission_denied",
  invalid_task: "capture_invalid_input",
  invalid_hydration: "capture_invalid_input",
  invalid_hydration_timezone: "capture_invalid_input",
  invalid_ideal_human_day: "capture_invalid_input",
  assistant_invalid_input: "capture_invalid_input",
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CaptureStoreError("capture_storage_unavailable");
  return value as Record<string, unknown>;
}
function voiceReference(value: unknown): CaptureVoiceReference | null {
  if (value === null || value === undefined) return null;
  const v = record(value);
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "fileId",
          "fileUniqueId",
          "durationSeconds",
          "mimeType",
          "fileSize",
          "referenceExpiresAt",
        ].includes(k),
    ) ||
    typeof v.fileId !== "string" ||
    !/^[-A-Za-z0-9_]{1,512}$/.test(v.fileId) ||
    typeof v.fileUniqueId !== "string" ||
    !/^[-A-Za-z0-9_]{1,200}$/.test(v.fileUniqueId) ||
    typeof v.durationSeconds !== "number" ||
    !Number.isInteger(v.durationSeconds) ||
    v.durationSeconds < 1 ||
    v.durationSeconds > CAPTURE_MAX_VOICE_SECONDS ||
    (v.fileSize !== null &&
      (typeof v.fileSize !== "number" ||
        !Number.isSafeInteger(v.fileSize) ||
        v.fileSize < 1 ||
        v.fileSize > CAPTURE_MAX_VOICE_BYTES)) ||
    (v.mimeType !== null &&
      !["audio/ogg", "audio/opus", "audio/ogg; codecs=opus"].includes(
        String(v.mimeType),
      )) ||
    typeof v.referenceExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(v.referenceExpiresAt))
  )
    throw new CaptureStoreError("capture_invalid_input");
  return v as unknown as CaptureVoiceReference;
}
function sourceReference(
  value: CaptureSourceReference | undefined,
): CaptureSourceReference | null {
  if (value === undefined) return null;
  const v = record(value);
  if (
    Object.keys(v).some(
      (k) => !["chatId", "messageId", "updateId", "occurredAt"].includes(k),
    ) ||
    !["chatId", "messageId", "updateId"].every(
      (k) =>
        typeof v[k] === "number" &&
        Number.isSafeInteger(v[k]) &&
        (k === "chatId"
          ? Number(v[k]) !== 0
          : k === "messageId"
            ? Number(v[k]) > 0
            : Number(v[k]) >= 0),
    ) ||
    (v.occurredAt !== undefined &&
      (typeof v.occurredAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v.occurredAt) ||
        !Number.isFinite(Date.parse(v.occurredAt))))
  )
    throw new CaptureStoreError("capture_invalid_input");
  return value;
}
export class SupabaseCaptureStore implements CaptureServiceStore {
  private readonly db: SupabaseClient<CaptureDatabase>;
  constructor(client: SupabaseClient<Database>) {
    this.db = client as unknown as SupabaseClient<CaptureDatabase>;
  }
  private async call(
    userId: string,
    operation: string,
    captureId: string | null,
    input: unknown = {},
    expectedRevision: number | null = null,
  ): Promise<unknown> {
    captureRecordId(userId);
    if (captureId !== null) captureRecordId(captureId);
    const { data, error } = await this.db.rpc("capture_service_v2", {
      p_user_id: userId,
      p_operation: operation,
      p_capture_id: captureId,
      p_expected_revision: expectedRevision,
      p_input: input as Json,
    });
    if (error) {
      const code = ERRORS.has(error.message)
        ? (error.message as CaptureStoreError["code"])
        : Object.hasOwn(DOMAIN_ERRORS, error.message)
          ? DOMAIN_ERRORS[error.message]
          : "capture_storage_unavailable";
      throw new CaptureStoreError(code);
    }
    return data;
  }
  async search(
    userId: string,
    input: CaptureSearchInput,
  ): Promise<CaptureSearchResult> {
    const r = record(
      await this.call(userId, "search", null, parseCaptureSearchInput(input)),
    );
    if (!Array.isArray(r.captures) || r.captures.length > 50)
      throw new CaptureStoreError("capture_storage_unavailable");
    const result = {
      captures: r.captures.map(parseCaptureView),
      nextCursor: r.nextCursor === null ? null : record(r.nextCursor),
    };
    if (result.nextCursor) {
      const cursor = parseCaptureSearchInput({
        query: "",
        cursor: result.nextCursor,
      });
      return { captures: result.captures, nextCursor: cursor.cursor! };
    }
    return { captures: result.captures, nextCursor: null };
  }
  async get(userId: string, captureId: string): Promise<CaptureView | null> {
    const value = await this.call(userId, "get", captureId);
    return value === null ? null : parseCaptureView(value);
  }
  async ingest(
    userId: string,
    input: CaptureStoreIngestInput,
  ): Promise<CaptureIngestResult> {
    const { source, voice, sourceReference: reference, ...publicInput } = input;
    const parsed = parseCaptureIngestRequest(publicInput);
    if (
      !["telegram", "tma", "web"].includes(source) ||
      (voice && source !== "telegram") ||
      (reference && source !== "telegram") ||
      (voice && parsed.inputType !== "voice")
    )
      throw new CaptureStoreError("capture_invalid_input");
    const v = record(
      await this.call(userId, "ingest", null, {
        ...parsed,
        source,
        voice: voiceReference(voice),
        sourceReference: sourceReference(reference),
      }),
    );
    if (typeof v.created !== "boolean")
      throw new CaptureStoreError("capture_storage_unavailable");
    return { capture: parseCaptureView(v.capture), created: v.created };
  }
  async edit(
    userId: string,
    captureId: string,
    input: CaptureEditRequest,
  ): Promise<CaptureView> {
    const parsed = parseCaptureEditRequest(input);
    return parseCaptureView(
      await this.call(
        userId,
        "edit",
        captureId,
        parsed,
        parsed.expectedRevision,
      ),
    );
  }
  async retry(
    userId: string,
    captureId: string,
    expectedRevision: number,
  ): Promise<CaptureView> {
    return parseCaptureView(
      await this.call(
        userId,
        "retry",
        captureId,
        {},
        captureExpectedRevision(expectedRevision),
      ),
    );
  }
  private job(value: unknown): CaptureProcessingJob | null {
    if (value === null) return null;
    const v = record(value);
    if (
      typeof v.leaseToken !== "string" ||
      !REQUEST.test(v.leaseToken) ||
      typeof v.leaseExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(v.leaseExpiresAt)) ||
      typeof v.attemptCount !== "number" ||
      !Number.isInteger(v.attemptCount) ||
      v.attemptCount < 1 ||
      v.attemptCount > 3 ||
      (v.referenceTime !== undefined &&
        (typeof v.referenceTime !== "string" ||
          !Number.isFinite(Date.parse(v.referenceTime))))
    )
      throw new CaptureStoreError("capture_storage_unavailable");
    return {
      capture: parseCaptureView(v.capture),
      leaseToken: v.leaseToken,
      leaseExpiresAt: v.leaseExpiresAt,
      attemptCount: v.attemptCount,
      voice: voiceReference(v.voice),
      ...(v.referenceTime ? { referenceTime: String(v.referenceTime) } : {}),
    };
  }
  async claim(
    userId: string,
    captureId: string,
    leaseToken: string,
  ): Promise<CaptureProcessingJob | null> {
    if (!REQUEST.test(leaseToken))
      throw new CaptureStoreError("capture_invalid_input");
    return this.job(
      await this.call(userId, "claim", captureId, { leaseToken }),
    );
  }
  async claimNext(
    leaseToken: string,
  ): Promise<{ userId: string; job: CaptureProcessingJob } | null> {
    if (!REQUEST.test(leaseToken))
      throw new CaptureStoreError("capture_invalid_input");
    const { data, error } = await this.db.rpc("capture_claim_next", {
      p_lease_token: leaseToken,
    });
    if (error) throw new CaptureStoreError("capture_storage_unavailable");
    if (data === null) return null;
    const v = record(data),
      userId = captureRecordId(v.userId),
      job = this.job(v.job);
    if (!job) throw new CaptureStoreError("capture_storage_unavailable");
    return { userId, job };
  }
  async claimExternal(
    userId: string,
    captureId: string,
    input: CaptureExternalClaimInput,
  ): Promise<CaptureProcessingJob | null> {
    const { expectedRevision, policy, ...body } = input;
    if (
      Object.keys(input).some(
        (key) =>
          ![
            "expectedRevision",
            "mode",
            "requestId",
            "leaseToken",
            "consentExpiresAt",
            "policy",
          ].includes(key),
      ) ||
      !["model", "transcription"].includes(body.mode) ||
      !REQUEST.test(body.requestId) ||
      !REQUEST.test(body.leaseToken) ||
      !Number.isFinite(Date.parse(body.consentExpiresAt)) ||
      !policy ||
      Object.keys(policy).some(
        (key) =>
          ![
            "settingsRevision",
            "modelId",
            "provider",
            "maxRequestCostMicros",
          ].includes(key),
      ) ||
      !Number.isSafeInteger(policy.settingsRevision) ||
      policy.settingsRevision < 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(policy.modelId) ||
      !["gemini", "openrouter", "openai", "anthropic"].includes(
        policy.provider,
      ) ||
      !Number.isSafeInteger(policy.maxRequestCostMicros) ||
      policy.maxRequestCostMicros < 0 ||
      policy.maxRequestCostMicros > 1_000_000_000_000
    )
      throw new CaptureStoreError("capture_invalid_input");
    return this.job(
      await this.call(
        userId,
        "claim_external",
        captureId,
        { ...body, policy },
        captureExpectedRevision(expectedRevision),
      ),
    );
  }
  async revise(
    userId: string,
    captureId: string,
    expectedRevision: number,
    changes: CaptureRevisionChanges,
  ): Promise<CaptureView> {
    if (
      !changes ||
      Object.keys(changes).some(
        (key) => !["updates", "cancelActionIds"].includes(key),
      ) ||
      !Array.isArray(changes.updates) ||
      !Array.isArray(changes.cancelActionIds) ||
      changes.updates.length + changes.cancelActionIds.length < 1 ||
      changes.updates.length + changes.cancelActionIds.length > 16
    )
      throw new CaptureStoreError("capture_invalid_input");
    const ids = [
      ...changes.updates.map((update) => update.actionId),
      ...changes.cancelActionIds,
    ];
    if (
      ids.some(
        (id) => typeof id !== "string" || !/^action-(?:[1-9]|1[0-6])$/.test(id),
      ) ||
      new Set(ids).size !== ids.length
    )
      throw new CaptureStoreError("capture_invalid_input");
    const updates = changes.updates.map((update) => {
      if (
        Object.keys(update).some(
          (key) => !["actionId", "action", "presentation"].includes(key),
        )
      )
        throw new CaptureStoreError("capture_invalid_input");
      return {
        actionId: update.actionId,
        action: parseCaptureActionPayload(update.action),
        presentation: parseCapturePresentation(update.presentation),
      };
    });
    return parseCaptureView(
      await this.call(
        userId,
        "revise",
        captureId,
        { updates, cancelActionIds: [...changes.cancelActionIds] },
        captureExpectedRevision(expectedRevision),
      ),
    );
  }
  async markExternalAttempt(
    userId: string,
    captureId: string,
    leaseToken: string,
  ): Promise<void> {
    if (!REQUEST.test(leaseToken))
      throw new CaptureStoreError("capture_invalid_input");
    await this.call(userId, "mark_external", captureId, { leaseToken });
  }
  async sweep(limit = 50): Promise<{ scrubbed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new CaptureStoreError("capture_invalid_input");
    const { data, error } = await this.db.rpc("capture_sweep", {
      p_limit: limit,
    });
    if (error) throw new CaptureStoreError("capture_storage_unavailable");
    const v = record(data);
    if (
      typeof v.scrubbed !== "number" ||
      !Number.isInteger(v.scrubbed) ||
      v.scrubbed < 0 ||
      v.scrubbed > limit
    )
      throw new CaptureStoreError("capture_storage_unavailable");
    return { scrubbed: v.scrubbed };
  }
  async finish(
    userId: string,
    captureId: string,
    leaseToken: string,
    input: {
      proposals?: CaptureProposal[];
      transcript?: string;
      errorCode?: string;
      ambiguousProvider?: boolean;
      fallbackCode?: "capture_model_fallback";
      transcriptSource?: "manual" | "provider";
    },
  ): Promise<CaptureView> {
    if (
      !REQUEST.test(leaseToken) ||
      Object.keys(input).some(
        (k) =>
          ![
            "proposals",
            "transcript",
            "errorCode",
            "ambiguousProvider",
            "fallbackCode",
            "transcriptSource",
          ].includes(k),
      )
    )
      throw new CaptureStoreError("capture_invalid_input");
    if (input.proposals) {
      if (input.proposals.length > 16)
        throw new CaptureStoreError("capture_invalid_input");
      for (const p of input.proposals) {
        parseCaptureActionPayload({ kind: p.kind, args: p.args });
        if (
          !/^action-(?:[1-9]|1[0-6])$/.test(p.id) ||
          !["deterministic", "model", "edited"].includes(p.origin)
        )
          throw new CaptureStoreError("capture_invalid_input");
      }
    }
    if (input.transcript !== undefined)
      parseCaptureEditRequest({
        expectedRevision: 1,
        transcript: input.transcript,
      });
    if (
      input.errorCode !== undefined &&
      !/^[a-z][a-z0-9_]{0,99}$/.test(input.errorCode)
    )
      throw new CaptureStoreError("capture_invalid_input");
    if (
      input.ambiguousProvider !== undefined &&
      typeof input.ambiguousProvider !== "boolean"
    )
      throw new CaptureStoreError("capture_invalid_input");
    if (
      (input.fallbackCode !== undefined &&
        (input.fallbackCode !== "capture_model_fallback" ||
          !input.proposals ||
          input.errorCode)) ||
      (input.transcriptSource !== undefined &&
        (!input.transcript ||
          !["manual", "provider"].includes(input.transcriptSource)))
    )
      throw new CaptureStoreError("capture_invalid_input");
    const presentations = Object.fromEntries(
      (input.proposals ?? []).flatMap((proposal) =>
        proposal.presentation
          ? [[proposal.id, parseCapturePresentation(proposal.presentation)]]
          : [],
      ),
    );
    const proposals = input.proposals?.map((p) => {
      const payload = parseCaptureActionPayload({ kind: p.kind, args: p.args });
      return {
        ...payload,
        id: p.id,
        origin: p.origin,
        summary: captureActionSummary(payload),
        missingFields: captureActionMissingFields(payload),
      };
    });
    return parseCaptureView(
      await this.call(userId, "finish", captureId, {
        leaseToken,
        ...input,
        ...(proposals ? { proposals } : {}),
        ...(Object.keys(presentations).length ? { presentations } : {}),
      }),
    );
  }
  async confirm(
    userId: string,
    captureId: string,
    input: CaptureConfirmRequest,
    options: CaptureConfirmOptions,
  ): Promise<CaptureView> {
    const parsed = parseCaptureConfirmRequest(input);
    if (typeof options.allowMemoryDelete !== "boolean")
      throw new CaptureStoreError("capture_invalid_input");
    const journalEntries = (options.journalEntries ?? []).map((j) => {
      parseCaptureActionPayload(j.action);
      const entry = parseIdealHumanDay(j.entry);
      if (
        j.date !== entry.date ||
        !Number.isSafeInteger(j.expectedRevision) ||
        j.expectedRevision < 0 ||
        entry.revision !== j.expectedRevision
      )
        throw new CaptureStoreError("capture_invalid_input");
      const { revision: _revision, ...saved } = entry;
      return { ...j, entry: saved };
    });
    const readResults = (options.readResults ?? []).map((r) => {
      const a = parseCaptureActionPayload(r.action);
      if (
        a.kind !== "question.read" ||
        typeof r.summary !== "string" ||
        !r.summary.trim() ||
        r.summary.length > 8000
      )
        throw new CaptureStoreError("capture_invalid_input");
      return r;
    });
    return parseCaptureView(
      await this.call(
        userId,
        "confirm",
        captureId,
        {
          ...parsed,
          allowMemoryDelete: options.allowMemoryDelete,
          journalEntries,
          readResults,
        },
        parsed.expectedRevision,
      ),
    );
  }
  async cancel(
    userId: string,
    captureId: string,
    expectedRevision: number,
  ): Promise<CaptureView> {
    return parseCaptureView(
      await this.call(
        userId,
        "cancel",
        captureId,
        {},
        captureExpectedRevision(expectedRevision),
      ),
    );
  }
  async archive(
    userId: string,
    captureId: string,
    expectedRevision: number,
    archived: boolean,
  ): Promise<CaptureView> {
    if (typeof archived !== "boolean")
      throw new CaptureStoreError("capture_invalid_input");
    return parseCaptureView(
      await this.call(
        userId,
        "archive",
        captureId,
        { archived },
        captureExpectedRevision(expectedRevision),
      ),
    );
  }
  async delete(
    userId: string,
    captureId: string,
    expectedRevision: number,
  ): Promise<void> {
    await this.call(
      userId,
      "delete",
      captureId,
      {},
      captureExpectedRevision(expectedRevision),
    );
  }
}
export function createCaptureStore(
  client: SupabaseClient<Database>,
): CaptureServiceStore {
  return new SupabaseCaptureStore(client);
}
