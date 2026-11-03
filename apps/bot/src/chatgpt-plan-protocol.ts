import { ChatgptPlanError } from "./chatgpt-plan-auth.js";

/** Deliberately text-only, tool-free preview subset. There is no API-key billing fallback. */
export function buildChatgptPlanRequest(input: {
  model: string;
  messages: { role: "user" | "assistant" | "developer"; text: string }[];
  instructions?: string;
}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !["model", "messages", "instructions"].includes(key),
    ) ||
    typeof input.model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.model) ||
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 100 ||
    (input.instructions !== undefined &&
      (typeof input.instructions !== "string" ||
        input.instructions.length > 30_000))
  )
    throw new ChatgptPlanError("chatgpt_unsupported_request");
  let bytes = Buffer.byteLength(input.instructions ?? "");
  for (const message of input.messages) {
    if (
      !message ||
      !["user", "assistant", "developer"].includes(message.role) ||
      Object.keys(message).some((key) => !["role", "text"].includes(key)) ||
      typeof message.text !== "string" ||
      !message.text.trim()
    )
      throw new ChatgptPlanError("chatgpt_unsupported_request");
    bytes += Buffer.byteLength(message.text);
  }
  if (bytes > 120_000) throw new ChatgptPlanError("chatgpt_request_too_large");
  return {
    model: input.model,
    input: input.messages.map((m) => ({ role: m.role, content: m.text })),
    ...(input.instructions ? { instructions: input.instructions } : {}),
    store: false,
    stream: true,
  } as const;
}
export interface ChatgptPlanCompletedResponse {
  text: string;
  model: string;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };
}
/** Buffer text until completed; a partial answer is never a success or safe retry signal. */
export async function readChatgptPlanCompletion(
  response: Response,
  options: {
    signal?: AbortSignal;
    /** A caller can shorten the 20-second reader deadline, never extend it. */
    timeoutMs?: number;
    maxOutputBytes: number;
    expectedModel: string;
  },
): Promise<ChatgptPlanCompletedResponse> {
  if (
    !response.ok ||
    !response.body ||
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "text/event-stream"
  )
    throw new ChatgptPlanError("chatgpt_stream_rejected");
  if (
    !Number.isSafeInteger(options.maxOutputBytes) ||
    options.maxOutputBytes < 1 ||
    options.maxOutputBytes > 128 * 1024
  )
    throw new ChatgptPlanError("chatgpt_invalid_output_limit");
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000)
    throw new ChatgptPlanError("chatgpt_invalid_deadline");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    output = "",
    wireBytes = 0,
    events = 0,
    timedOut = false,
    completed: ChatgptPlanCompletedResponse | undefined;
  function fail(code: string): never {
    throw new ChatgptPlanError(code);
  }
  const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const outputItem = (value: unknown): string => {
    if (!record(value)) return fail("chatgpt_invalid_stream");
    if (value.type === "reasoning") {
      if (
        value.summary !== undefined &&
        (!Array.isArray(value.summary) ||
          value.summary.some(
            (part) =>
              !record(part) ||
              part.type !== "summary_text" ||
              typeof part.text !== "string",
          ))
      )
        return fail("chatgpt_unsupported_output");
      return "";
    }
    if (
      value.type !== "message" ||
      value.role !== "assistant" ||
      !Array.isArray(value.content)
    )
      return fail("chatgpt_unsupported_output");
    return value.content
      .map((part) => {
        if (
          !record(part) ||
          part.type !== "output_text" ||
          typeof part.text !== "string"
        )
          return fail("chatgpt_unsupported_output");
        return part.text;
      })
      .join("");
  };
  const outputList = (value: unknown): string => {
    if (!Array.isArray(value) || value.length > 100)
      return fail("chatgpt_invalid_stream");
    return value.map(outputItem).join("");
  };
  const allowedEvents = new Set([
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.output_item.done",
    "response.content_part.added",
    "response.content_part.done",
    "response.output_text.delta",
    "response.output_text.done",
    "response.output_text.annotation.added",
    "response.reasoning_summary_part.added",
    "response.reasoning_summary_part.done",
    "response.reasoning_summary_text.delta",
    "response.reasoning_summary_text.done",
    "response.reasoning_text.delta",
    "response.reasoning_text.done",
    "response.completed",
    "response.failed",
    "response.incomplete",
    "error",
  ]);
  const handle = (block: string) => {
    const parts = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (!parts.length) return;
    if (++events > 10_000) fail("chatgpt_stream_too_large");
    const raw = parts.join("\n");
    if (raw === "[DONE]") {
      if (!completed) fail("chatgpt_stream_interrupted");
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return fail("chatgpt_invalid_stream");
    }
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof event.type !== "string"
    )
      fail("chatgpt_invalid_stream");
    if (completed) fail("chatgpt_invalid_stream");
    if (!allowedEvents.has(event.type as string))
      fail("chatgpt_unsupported_output");
    if (
      ["response.failed", "response.incomplete", "error"].includes(
        event.type as string,
      )
    )
      fail("chatgpt_inference_not_completed");
    if (
      event.type === "response.output_item.added" ||
      event.type === "response.output_item.done"
    )
      outputItem(event.item);
    if (
      [
        "response.content_part.added",
        "response.content_part.done",
        "response.reasoning_summary_part.added",
        "response.reasoning_summary_part.done",
      ].includes(event.type as string)
    ) {
      if (
        !record(event.part) ||
        !["output_text", "summary_text", "reasoning_text"].includes(
          event.part.type as string,
        )
      )
        fail("chatgpt_unsupported_output");
    }
    if (event.response !== undefined) {
      if (!record(event.response)) fail("chatgpt_invalid_stream");
      if (event.response.output !== undefined)
        outputList(event.response.output);
    }
    if (event.type === "response.output_text.delta") {
      if (typeof event.delta !== "string") fail("chatgpt_invalid_stream");
      output += event.delta;
      if (Buffer.byteLength(output) > options.maxOutputBytes)
        fail("chatgpt_output_limit");
    }
    if (event.type === "response.completed") {
      const result = event.response as Record<string, unknown> | undefined;
      if (
        !result ||
        result.status !== "completed" ||
        result.model !== options.expectedModel ||
        !output.trim() ||
        outputList(result.output) !== output
      )
        throw new ChatgptPlanError("chatgpt_invalid_stream");
      const usage = result.usage as Record<string, unknown> | undefined;
      const count = (value: unknown) =>
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 10_000_000
          ? value
          : null;
      completed = {
        text: output,
        model: result.model as string,
        usage: {
          input_tokens: count(usage?.input_tokens),
          output_tokens: count(usage?.output_tokens),
          total_tokens: count(usage?.total_tokens),
        },
      };
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (timedOut) fail("chatgpt_timeout");
      if (options.signal?.aborted) fail("chatgpt_cancelled");
      const next = await reader.read();
      if (next.done) break;
      wireBytes += next.value.byteLength;
      if (wireBytes > 2 * 1024 * 1024) fail("chatgpt_stream_too_large");
      buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      if (Buffer.byteLength(buffer) > 256 * 1024)
        fail("chatgpt_stream_too_large");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
    if (timedOut) fail("chatgpt_timeout");
    if (options.signal?.aborted) fail("chatgpt_cancelled");
    if (!completed) throw new ChatgptPlanError("chatgpt_stream_interrupted");
    return completed;
  } catch (error) {
    if (error instanceof ChatgptPlanError) throw error;
    throw new ChatgptPlanError(
      timedOut
        ? "chatgpt_timeout"
        : options.signal?.aborted
          ? "chatgpt_cancelled"
          : "chatgpt_stream_interrupted",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    // A hostile/failed underlying cancel promise must not extend the deadline.
    abort();
    reader.releaseLock();
  }
}
