// Pure fixture state shared by local TMA and authenticated Next browser harnesses.
// No network, production identity, provider, filesystem or message operation exists here.
import {
  CAPTURE_ACTION_KINDS,
  captureActionMissingFields,
  captureActionSummary,
  extractCaptureActions,
  parseCaptureConfirmRequest,
  parseCaptureEditRequest,
  parseCaptureIngestRequest,
  parseCaptureSearchInput,
} from "../packages/core/src/universal-capture.ts";

export function captureBrowserFixture(owner = "A") {
  const prefix =
    owner === "A" ? "11111111-1111-4111-8111" : "22222222-2222-4222-8222";
  const uuid = (number) => `${prefix}-${String(number).padStart(12, "0")}`;
  const stamp = () => new Date().toISOString();
  const context = {
    date: "2026-11-03",
    timezone: "Asia/Almaty",
    scheduleKnown: false,
    warnings: ["Fixture: подтверждённое расписание университета отсутствует."],
    commitments: [],
    deadlines: [],
    suggestedOrder: [],
    preferences: [],
    facts: ["Fixture: измерение сна не сохранено."],
  };
  const capabilities = {
    enabled: true,
    text: true,
    telegramVoice: true,
    transcription: "unavailable",
    transcriptionRequiresConsent: true,
    aiExtraction: false,
    maxTextLength: 8000,
    maxVoiceBytes: 5 * 1024 * 1024,
    maxVoiceSeconds: 120,
    memoryDeleteEnabled: false,
    actionKinds: [...CAPTURE_ACTION_KINDS],
  };
  const captures = new Map();
  const ingests = new Map();
  const receipts = new Map();
  let sequence = 1;
  const voiceId = uuid(sequence++);
  captures.set(voiceId, {
    id: voiceId,
    inputType: "voice",
    source: "telegram",
    sourceLabel: "Telegram",
    text: "",
    transcript: null,
    state: "awaiting_transcript",
    revision: 1,
    createdAt: stamp(),
    updatedAt: stamp(),
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: null,
    errorCode: "transcription_unavailable",
    actions: [],
    context: structuredClone(context),
  });
  const state = {
    capabilities,
    captures,
    voiceId,
    memories: [],
    tasks: [
      {
        id: uuid(900),
        title: `Owned fixture task ${owner}`,
        notes: "Keep original task notes",
        dueAt: "2026-11-04T12:00:00Z",
        status: "next",
        updatedAt: "2026-11-03T10:00:00.123456Z",
        completedAt: null,
      },
    ],
    createRequests: [],
    editRequests: [],
    confirmRequests: [],
    deleteRequests: [],
    searchRequests: [],
    domainWrites: [],
    failCreateAfterCommitOnce: false,
    failConfirmAfterCommitOnce: false,
    failEditOnce: false,
    providerCalls: 0,
  };
  const success = (data) => ({
    status: 200,
    body: { data: structuredClone(data) },
  });
  let nextSearchGate;
  state.deferNextSearch = () => {
    let release, started;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const received = new Promise((resolve) => {
      started = resolve;
    });
    nextSearchGate = { wait, started };
    return { release, received };
  };
  const failure = (status, error) => ({
    status,
    body: { error, message: "PRIVATE FIXTURE DIAGNOSTIC" },
  });
  function changed(capture) {
    capture.revision++;
    capture.updatedAt = stamp();
    return capture;
  }
  function search(input) {
    const value = parseCaptureSearchInput(input);
    state.searchRequests.push(structuredClone(input));
    const needle = value.query.toLowerCase();
    const matches = [...captures.values()]
      .filter(
        (item) =>
          (value.includeArchived || !item.archivedAt) &&
          (!value.state || item.state === value.state) &&
          (!needle ||
            `${item.text}\n${item.transcript ?? ""}`
              .toLowerCase()
              .includes(needle)),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
    const offset = value.cursor
      ? matches.findIndex((item) => item.id === value.cursor.id) + 1
      : 0;
    const page = matches.slice(offset, offset + value.limit);
    return {
      captures: page,
      nextCursor:
        offset + page.length < matches.length
          ? { id: page.at(-1).id, createdAt: page.at(-1).createdAt }
          : null,
    };
  }
  function process(capture) {
    const source = capture.transcript || capture.text;
    if (capture.inputType === "voice" && !capture.transcript) {
      capture.state = "awaiting_transcript";
      capture.errorCode = "transcription_unavailable";
      return changed(capture);
    }
    try {
      const old = new Map(capture.actions.map((action) => [action.id, action]));
      capture.actions = extractCaptureActions(source, {
        now: new Date("2026-11-03T10:00:00Z"),
        timezone: context.timezone,
        date: context.date,
      }).map((action) =>
        old.get(action.id)?.status === "succeeded"
          ? old.get(action.id)
          : {
              ...action,
              status: action.missingFields.length ? "needs_input" : "pending",
              resultSummary: null,
              completedAt: null,
            },
      );
      capture.state = capture.actions.some(
        (action) => action.status !== "succeeded",
      )
        ? "needs_review"
        : "completed";
      capture.reviewExpiresAt = new Date(Date.now() + 600_000).toISOString();
      capture.errorCode = null;
    } catch {
      capture.state = "failed";
      capture.errorCode = "capture_invalid_input";
      capture.actions = [];
    }
    return changed(capture);
  }
  state.response = (resource, method, input = {}) => {
    if (resource === "tasks" && method === "GET")
      return success({ tasks: state.tasks, truncated: false });
    if (!resource.startsWith("captures")) return null;
    try {
      if (resource === "captures/capabilities" && method === "GET")
        return success(capabilities);
      if (resource === "captures/memories" && method === "GET")
        return success(state.memories);
      if (resource === "captures" && method === "GET")
        return success(
          search({ query: "", includeArchived: false, limit: 20 }),
        );
      if (resource === "captures/search" && method === "POST") {
        const result = success(search(input));
        const gate = nextSearchGate;
        if (!gate) return result;
        nextSearchGate = undefined;
        gate.started();
        return gate.wait.then(() => result);
      }
      if (resource === "captures" && method === "POST") {
        const value = parseCaptureIngestRequest(input);
        state.createRequests.push(value);
        if (ingests.has(value.requestId)) {
          const existing = ingests.get(value.requestId);
          if (JSON.stringify(existing.input) !== JSON.stringify(value))
            return failure(409, "capture_request_conflict");
          return success(captures.get(existing.id));
        }
        const id = uuid(sequence++);
        const capture = {
          id,
          inputType: value.inputType,
          source: "tma",
          sourceLabel: "Fixture browser",
          text: value.text,
          transcript: null,
          state: "queued",
          revision: 1,
          createdAt: stamp(),
          updatedAt: stamp(),
          archivedAt: null,
          expiresAt: value.retentionDays
            ? new Date(
                Date.now() + value.retentionDays * 86400000,
              ).toISOString()
            : null,
          reviewExpiresAt: null,
          errorCode: null,
          actions: [],
          context: structuredClone(context),
        };
        captures.set(id, capture);
        ingests.set(value.requestId, { id, input: value });
        if (state.failCreateAfterCommitOnce) {
          state.failCreateAfterCommitOnce = false;
          return failure(503, "capture_unavailable");
        }
        return success(capture);
      }
      const match = resource.match(
        /^captures\/([0-9a-f-]{36})(?:\/(process|retry|cancel|archive|confirm))?$/,
      );
      if (!match) return failure(404, "capture_not_found");
      const capture = captures.get(match[1]);
      if (!capture) return failure(404, "capture_not_found");
      if (!match[2] && method === "GET") return success(capture);
      if (match[2] === "confirm" && method === "POST") {
        const value = parseCaptureConfirmRequest(input);
        state.confirmRequests.push(structuredClone(value));
        const signature = JSON.stringify({ id: capture.id, ...value });
        if (receipts.has(value.requestId)) {
          const receipt = receipts.get(value.requestId);
          return receipt.signature === signature
            ? success(receipt.capture)
            : failure(409, "capture_request_conflict");
        }
        if (value.expectedRevision !== capture.revision)
          return failure(409, "capture_conflict");
        if (
          !capture.reviewExpiresAt ||
          Date.parse(capture.reviewExpiresAt) <= Date.now()
        )
          return failure(409, "capture_review_expired");
        const selected = value.actionIds.map((id) =>
          capture.actions.find((action) => action.id === id),
        );
        if (
          selected.some(
            (action) =>
              !action ||
              action.status !== "pending" ||
              action.missingFields.length,
          )
        )
          return failure(409, "capture_action_conflict");
        if (
          selected.some((action) => action.kind === "memory.delete") &&
          !capabilities.memoryDeleteEnabled
        )
          return failure(403, "capture_permission_denied");
        for (const action of selected) {
          state.domainWrites.push({
            captureId: capture.id,
            actionId: action.id,
            kind: action.kind,
          });
          if (action.kind === "task.create")
            state.tasks.push({
              id: uuid(1000 + state.domainWrites.length),
              ...action.args,
              status: "inbox",
              updatedAt: stamp(),
              completedAt: null,
            });
          if (
            action.kind === "memory.remember" ||
            action.kind === "memory.update"
          )
            state.memories = [
              ...state.memories.filter((item) => item.key !== action.args.key),
              { ...action.args, updatedAt: stamp(), archivedAt: null },
            ];
          if (action.kind === "memory.archive")
            state.memories = state.memories.map((item) =>
              item.key === action.args.key
                ? { ...item, archivedAt: stamp() }
                : item,
            );
          if (action.kind === "memory.delete")
            state.memories = state.memories.filter(
              (item) => item.key !== action.args.key,
            );
          action.status = "succeeded";
          action.completedAt = stamp();
          action.resultSummary =
            action.kind === "question.read"
              ? "Подтверждённое расписание недоступно; время занятий неизвестно."
              : `Сохранено ровно один раз: ${action.summary}`;
        }
        capture.state = capture.actions.some(
          (action) =>
            action.status === "pending" || action.status === "needs_input",
        )
          ? "needs_review"
          : "completed";
        changed(capture);
        receipts.set(value.requestId, {
          signature,
          capture: structuredClone(capture),
        });
        if (state.failConfirmAfterCommitOnce) {
          state.failConfirmAfterCommitOnce = false;
          return failure(503, "capture_unavailable");
        }
        return success(capture);
      }
      if (input.expectedRevision !== capture.revision)
        return failure(409, "capture_conflict");
      if (!match[2] && method === "PATCH") {
        const value = parseCaptureEditRequest(input);
        state.editRequests.push(structuredClone(value));
        if (state.failEditOnce) {
          state.failEditOnce = false;
          return failure(503, "capture_unavailable");
        }
        if (value.transcript !== undefined) {
          capture.transcript = value.transcript;
          capture.state = "queued";
          capture.actions = [];
          capture.reviewExpiresAt = null;
        } else {
          const index = capture.actions.findIndex(
            (action) => action.id === value.actionId,
          );
          if (index < 0 || capture.actions[index].status === "succeeded")
            return failure(409, "capture_action_conflict");
          capture.actions[index] = {
            ...value.action,
            id: value.actionId,
            origin: "edited",
            summary: captureActionSummary(value.action),
            missingFields: captureActionMissingFields(value.action),
            status: captureActionMissingFields(value.action).length
              ? "needs_input"
              : "pending",
            resultSummary: null,
            completedAt: null,
          };
          capture.state = "needs_review";
          capture.reviewExpiresAt = new Date(
            Date.now() + 600_000,
          ).toISOString();
        }
        return success(changed(capture));
      }
      if (!match[2] && method === "DELETE") {
        if (input.confirmed !== true)
          return failure(400, "capture_invalid_request");
        state.deleteRequests.push(structuredClone(input));
        captures.delete(capture.id);
        return success({ deleted: true });
      }
      if (method === "POST" && ["process", "retry"].includes(match[2]))
        return success(process(capture));
      if (method === "POST" && match[2] === "archive") {
        if (typeof input.archived !== "boolean")
          return failure(400, "capture_invalid_request");
        capture.archivedAt = input.archived ? stamp() : null;
        return success(changed(capture));
      }
      if (method === "POST" && match[2] === "cancel") {
        capture.actions = capture.actions.map((action) =>
          action.status === "succeeded"
            ? action
            : { ...action, status: "cancelled" },
        );
        capture.state = "cancelled";
        return success(changed(capture));
      }
      return failure(405, "method_not_allowed");
    } catch {
      return failure(400, "capture_invalid_request");
    }
  };
  return state;
}
