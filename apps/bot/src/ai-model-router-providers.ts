import {
  aiProviderRetryAfter,
  isAiRouterModelId,
  type AiRouterModel,
} from "@lifeos/core";
import { validateMealImage } from "./meal-image.js";
import {
  routerJsonSchema,
  validRouterJson,
  type RouterJsonSchemaKey,
} from "./ai-model-router-json.js";

export type RouterProviderMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
};
export interface RouterProviderInput {
  model: AiRouterModel;
  fallbackModels: AiRouterModel[];
  apiKey: string;
  messages: RouterProviderMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
  schemaKey?: RouterJsonSchemaKey;
  /** Trusted clock for normalized Retry-After; never a caller URL/header override. */
  nowMs?: number;
  openRouter?: {
    providerOnly: string[];
    sort: "price" | "latency" | "throughput";
    requireZdr: boolean;
  };
}
export interface RouterProviderResult {
  text: string;
  servedModel: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  reportedCostMicros: number | null;
  upstreamProvider?: string;
}
export type RouterProviderErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "quota_exceeded"
  | "model_unavailable"
  | "provider_unavailable"
  | "invalid_response"
  | "cancelled"
  | "subscription_prepared"
  | "unsupported_capability";
/** Only safe categories leave this boundary; provider bodies/headers/causes are never retained. */
export class RouterProviderError extends Error {
  constructor(
    readonly code: RouterProviderErrorCode,
    readonly retryable = false,
    readonly ambiguous = false,
    readonly httpStatus?: number,
    readonly retryAt?: string | null,
    readonly quotaReviewRequired = false,
  ) {
    super(code);
    this.name = "RouterProviderError";
  }
}
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_TOKENS = 10_000_000;
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) =>
  Object.keys(v).length === fields.length &&
  fields.every((f) => Object.prototype.hasOwnProperty.call(v, f));
const badRequest = (): never => {
  throw new RouterProviderError("invalid_request");
};
const badResponse = (): never => {
  throw new RouterProviderError("invalid_response", false, true);
};
function image(url: string) {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) return badRequest();
  try {
    return validateMealImage(match[1], match[2]);
  } catch {
    return badRequest();
  }
}
/** Normalized allowlist prevents URL fetches, tools and arbitrary role/parameter passthrough. */
export function normalizeRouterProviderMessages(
  value: unknown,
): RouterProviderMessage[] {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    return badRequest();
  let imageCount = 0,
    textBytes = 0,
    nonSystemSeen = false,
    userSeen = false;
  const messages: RouterProviderMessage[] = [];
  for (const raw of value) {
    if (
      !record(raw) ||
      !exact(raw, ["role", "content"]) ||
      !["system", "user", "assistant"].includes(String(raw.role))
    )
      return badRequest();
    const role = raw.role as RouterProviderMessage["role"];
    if (role === "system" && nonSystemSeen) return badRequest();
    if (role !== "system") nonSystemSeen = true;
    if (role === "user") userSeen = true;
    if (typeof raw.content === "string") {
      textBytes += Buffer.byteLength(raw.content, "utf8");
      if (!raw.content.trim() || textBytes > MAX_TEXT_BYTES)
        return badRequest();
      messages.push({ role, content: raw.content });
      continue;
    }
    if (
      !Array.isArray(raw.content) ||
      !raw.content.length ||
      raw.content.length > 16
    )
      return badRequest();
    const content: Exclude<RouterProviderMessage["content"], string> = [];
    for (const part of raw.content) {
      if (!record(part)) return badRequest();
      if (
        part.type === "text" &&
        exact(part, ["type", "text"]) &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        textBytes += Buffer.byteLength(part.text, "utf8");
        if (textBytes > MAX_TEXT_BYTES) return badRequest();
        content.push({ type: "text", text: part.text });
      } else if (
        part.type === "image_url" &&
        exact(part, ["type", "image_url"]) &&
        record(part.image_url) &&
        exact(part.image_url, ["url"]) &&
        typeof part.image_url.url === "string" &&
        role === "user"
      ) {
        if (++imageCount > 1 || part.image_url.url.length > 720_100)
          return badRequest();
        image(part.image_url.url);
        content.push({
          type: "image_url",
          image_url: { url: part.image_url.url },
        });
      } else return badRequest();
    }
    messages.push({ role, content });
  }
  if (!userSeen || messages.at(-1)?.role !== "user") return badRequest();
  return messages;
}
function textContent(content: RouterProviderMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("\n");
}
function hasImages(messages: RouterProviderMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
}
function ready(model: AiRouterModel): boolean {
  return (
    Boolean(model) &&
    model.configured === true &&
    model.authorized === true &&
    model.metadataVerified === true &&
    ["configured", "connected"].includes(model.status) &&
    isAiRouterModelId(model.model) &&
    model.provider !== "chatgpt_plan" &&
    model.billing !== "chatgpt_plan"
  );
}
function price(model: AiRouterModel): { input: number; output: number } {
  const valid = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000_000_000;
  if (
    !valid(model.inputCostMicrosPer1k) ||
    !valid(model.outputCostMicrosPer1k) ||
    (model.billing === "free" &&
      (model.inputCostMicrosPer1k !== 0 || model.outputCostMicrosPer1k !== 0))
  )
    return badRequest();
  return {
    input: model.inputCostMicrosPer1k,
    output: model.outputCostMicrosPer1k,
  };
}
function bodyFor(
  input: RouterProviderInput,
  messages: RouterProviderMessage[],
): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  models: AiRouterModel[];
} {
  const primary = input.model;
  if (
    !ready(primary) ||
    !Array.isArray(input.fallbackModels) ||
    input.fallbackModels.length > 2
  )
    return badRequest();
  if (
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 8192 ||
    typeof input.apiKey !== "string" ||
    input.apiKey.length < 1 ||
    input.apiKey.length > 4096 ||
    /[^\x21-\x7e]/.test(input.apiKey)
  )
    return badRequest();
  if (hasImages(messages) && !primary.capabilities.includes("vision"))
    throw new RouterProviderError("unsupported_capability");
  let schema: Record<string, unknown> | undefined;
  if (input.schemaKey !== undefined) {
    try {
      schema = routerJsonSchema(input.schemaKey);
    } catch {
      return badRequest();
    }
    if (
      !["gemini", "openrouter"].includes(primary.provider) ||
      !primary.capabilities.includes("json")
    )
      throw new RouterProviderError("unsupported_capability");
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const models = [primary, ...input.fallbackModels];
  if (new Set(models.map((model) => model.model)).size !== models.length)
    return badRequest();
  for (const model of models) {
    if (
      !ready(model) ||
      model.provider !== primary.provider ||
      model.billing !== primary.billing ||
      (hasImages(messages) && !model.capabilities.includes("vision"))
    )
      return badRequest();
    price(model);
  }
  if (primary.provider !== "openrouter" && input.fallbackModels.length)
    return badRequest();
  if (primary.provider === "openrouter") {
    const routing = input.openRouter ?? {
      providerOnly: [],
      sort: "price",
      requireZdr: true,
    };
    if (
      !Array.isArray(routing.providerOnly) ||
      routing.providerOnly.length > 16 ||
      new Set(routing.providerOnly).size !== routing.providerOnly.length ||
      routing.providerOnly.some(
        (v) =>
          typeof v !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(v),
      ) ||
      !["price", "latency", "throughput"].includes(routing.sort) ||
      typeof routing.requireZdr !== "boolean"
    )
      return badRequest();
    const prices = models.map(price);
    headers.authorization = "Bearer " + input.apiKey;
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers,
      models,
      body: {
        ...(models.length > 1
          ? { models: models.map((model) => model.model) }
          : { model: primary.model }),
        messages,
        max_tokens: input.maxOutputTokens,
        stream: false,
        ...(schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: input.schemaKey, strict: true, schema },
              },
            }
          : {}),
        provider: {
          ...(routing.providerOnly.length
            ? { only: [...routing.providerOnly] }
            : {}),
          sort: routing.sort,
          data_collection: "deny",
          zdr: routing.requireZdr,
          allow_fallbacks: models.length > 1,
          require_parameters: true,
          max_price: {
            prompt: Math.max(...prices.map((p) => p.input)) / 1000,
            completion: Math.max(...prices.map((p) => p.output)) / 1000,
            request: 0,
            ...(primary.billing === "free" && hasImages(messages)
              ? { image: 0 }
              : {}),
          },
        },
      },
    };
  }
  if (primary.provider === "openai") {
    headers.authorization = "Bearer " + input.apiKey;
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers,
      models,
      body: {
        model: primary.model,
        messages,
        max_completion_tokens: input.maxOutputTokens,
        n: 1,
        stream: false,
        store: false,
      },
    };
  }
  if (primary.provider === "gemini") {
    const name = primary.model.replace(/^models\//, "");
    if (!/^gemini-[a-z0-9][a-z0-9.-]{0,100}$/.test(name)) return badRequest();
    headers["x-goog-api-key"] = input.apiKey;
    const systems = messages.filter((message) => message.role === "system");
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: (typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content
        ).map((part) => {
          if (part.type === "text") return { text: part.text };
          const checked = image(part.image_url.url);
          return {
            inlineData: {
              mimeType: checked.mimeType,
              data: checked.imageBase64,
            },
          };
        }),
      }));
    return {
      url:
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(name) +
        ":generateContent",
      headers,
      models,
      body: {
        contents,
        ...(systems.length
          ? {
              systemInstruction: {
                parts: [
                  {
                    text: systems
                      .map((message) => textContent(message.content))
                      .join("\n\n"),
                  },
                ],
              },
            }
          : {}),
        generationConfig: {
          maxOutputTokens: input.maxOutputTokens,
          ...(schema
            ? {
                responseMimeType: "application/json",
                responseJsonSchema: schema,
              }
            : {}),
        },
      },
    };
  }
  if (primary.provider === "anthropic") {
    // This adapter accepts Console API keys only; native Claude Code subscriptions
    // remain in the unmodified development client and are never an inference proxy.
    if (
      /^sk-ant-oat/i.test(input.apiKey) ||
      !input.apiKey.startsWith("sk-ant-api")
    )
      throw new RouterProviderError("invalid_credentials");
    headers["x-api-key"] = input.apiKey;
    headers["anthropic-version"] = "2026-10-21";
    const systems = messages.filter((message) => message.role === "system");
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers,
      models,
      body: {
        model: primary.model,
        max_tokens: input.maxOutputTokens,
        stream: false,
        ...(systems.length
          ? {
              system: systems
                .map((message) => textContent(message.content))
                .join("\n\n"),
            }
          : {}),
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role,
            content:
              typeof message.content === "string"
                ? message.content
                : message.content.map((part) => {
                    if (part.type === "text")
                      return { type: "text", text: part.text };
                    const checked = image(part.image_url.url);
                    return {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: checked.mimeType,
                        data: checked.imageBase64,
                      },
                    };
                  }),
          })),
      },
    };
  }
  return badRequest();
}
async function responseJson(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const rejectUnread = (): never => {
    void response.body?.cancel().catch(() => undefined);
    return badResponse();
  };
  if (
    !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    return rejectUnread();
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)
  )
    return rejectUnread();
  const reader = response.body?.getReader();
  if (!reader) return badResponse();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (signal.aborted)
        throw new RouterProviderError("cancelled", false, true);
      const part = await reader.read();
      if (signal.aborted)
        throw new RouterProviderError("cancelled", false, true);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return badResponse();
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks, size);
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!record(parsed) || parsed.error !== undefined) return badResponse();
    return parsed;
  } catch (error) {
    if (error instanceof RouterProviderError) throw error;
    if (signal.aborted) throw new RouterProviderError("cancelled", false, true);
    return badResponse();
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
function count(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TOKENS
  )
    return badResponse();
  return value;
}
function usage(
  input: unknown,
  provider: AiRouterModel["provider"],
): RouterProviderResult["usage"] {
  if (input === undefined) return undefined;
  if (!record(input)) return badResponse();
  let prompt: number | undefined,
    completion: number | undefined,
    total: number | undefined;
  if (provider === "gemini") {
    prompt = count(input.promptTokenCount);
    completion = count(input.candidatesTokenCount);
    total = count(input.totalTokenCount);
    const thoughts = count(input.thoughtsTokenCount) ?? 0,
      tools = count(input.toolUsePromptTokenCount) ?? 0;
    if (prompt !== undefined) prompt += tools;
    if (completion !== undefined) completion += thoughts;
  } else if (provider === "anthropic") {
    prompt = count(input.input_tokens);
    completion = count(input.output_tokens);
    const read = count(input.cache_read_input_tokens) ?? 0,
      creation = count(input.cache_creation_input_tokens) ?? 0;
    if (prompt !== undefined) prompt += read + creation;
    if (prompt !== undefined && completion !== undefined)
      total = prompt + completion;
  } else {
    prompt = count(input.prompt_tokens);
    completion = count(input.completion_tokens);
    total = count(input.total_tokens);
  }
  if (prompt === undefined || completion === undefined || total === undefined)
    return undefined;
  if (total < prompt + completion || total > MAX_TOKENS) return badResponse();
  return {
    prompt_tokens: prompt,
    completion_tokens: Math.max(completion, total - prompt),
    total_tokens: total,
  };
}
function observedCost(input: unknown): number | null {
  if (!record(input) || input.cost === undefined || input.cost === null)
    return null;
  if (
    typeof input.cost !== "number" ||
    !Number.isFinite(input.cost) ||
    input.cost < 0 ||
    input.cost > 1_000_000
  )
    return badResponse();
  return Math.ceil(input.cost * 1_000_000);
}
function completionText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > MAX_RESPONSE_BYTES
  )
    return badResponse();
  return value.trim();
}
function parsedResult(
  data: Record<string, unknown>,
  models: AiRouterModel[],
): RouterProviderResult {
  const model = models[0];
  const allowed = new Set(models.map((m) => m.model));
  if (model.provider === "gemini") {
    if (
      !Array.isArray(data.candidates) ||
      data.candidates.length !== 1 ||
      !record(data.candidates[0])
    )
      return badResponse();
    const candidate = data.candidates[0];
    if (
      candidate.finishReason !== "STOP" ||
      !record(candidate.content) ||
      !Array.isArray(candidate.content.parts) ||
      !candidate.content.parts.length ||
      (record(data.promptFeedback) && data.promptFeedback.blockReason)
    )
      return badResponse();
    let text = "";
    for (const part of candidate.content.parts) {
      if (!record(part)) return badResponse();
      if (
        part.functionCall !== undefined ||
        part.inlineData !== undefined ||
        part.executableCode !== undefined ||
        part.codeExecutionResult !== undefined
      )
        return badResponse();
      if (part.thought === true) continue;
      if (
        typeof part.text !== "string" ||
        part.functionCall !== undefined ||
        part.inlineData !== undefined ||
        part.executableCode !== undefined ||
        part.codeExecutionResult !== undefined
      )
        return badResponse();
      text += part.text;
    }
    if (typeof data.modelVersion !== "string") return badResponse();
    const served = data.modelVersion;
    if (
      !isAiRouterModelId(served) ||
      served.replace(/^models\//, "") !== model.model.replace(/^models\//, "")
    )
      return badResponse();
    return {
      text: completionText(text),
      servedModel: served,
      usage: usage(data.usageMetadata, model.provider),
      reportedCostMicros: null,
    };
  }
  if (model.provider === "anthropic") {
    if (
      data.type !== "message" ||
      data.role !== "assistant" ||
      data.stop_reason !== "end_turn" ||
      !Array.isArray(data.content) ||
      !data.content.length ||
      typeof data.model !== "string" ||
      !allowed.has(data.model)
    )
      return badResponse();
    let text = "";
    for (const part of data.content) {
      if (
        !record(part) ||
        part.type !== "text" ||
        typeof part.text !== "string"
      )
        return badResponse();
      text += part.text;
    }
    return {
      text: completionText(text),
      servedModel: data.model,
      usage: usage(data.usage, model.provider),
      reportedCostMicros: null,
    };
  }
  if (
    typeof data.model !== "string" ||
    !allowed.has(data.model) ||
    !Array.isArray(data.choices) ||
    data.choices.length !== 1 ||
    !record(data.choices[0])
  )
    return badResponse();
  const choice = data.choices[0];
  if (
    choice.finish_reason !== "stop" ||
    !record(choice.message) ||
    choice.message.role !== "assistant" ||
    choice.message.tool_calls != null ||
    choice.message.function_call != null ||
    choice.message.refusal != null
  )
    return badResponse();
  const upstreamProvider =
    typeof data.provider === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,99}$/.test(data.provider)
      ? data.provider
      : undefined;
  return {
    text: completionText(choice.message.content),
    servedModel: data.model,
    usage: usage(data.usage, model.provider),
    reportedCostMicros:
      model.provider === "openrouter" ? observedCost(data.usage) : null,
    ...(upstreamProvider ? { upstreamProvider } : {}),
  };
}
/** One bounded request. Retries, permission checks and durable accounting belong to the existing governor/router. */
export async function callAiRouterProvider(
  input: RouterProviderInput,
  fetchImpl: typeof fetch = fetch,
): Promise<RouterProviderResult> {
  if (input.model?.provider === "chatgpt_plan")
    throw new RouterProviderError("subscription_prepared");
  if (!(input.signal instanceof AbortSignal)) return badRequest();
  if (input.signal.aborted) throw new RouterProviderError("cancelled");
  const messages = normalizeRouterProviderMessages(input.messages);
  const request = bodyFor(input, messages);
  const body = JSON.stringify(request.body);
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) return badRequest();
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body,
      signal: input.signal,
      redirect: "error",
    });
  } catch {
    throw new RouterProviderError(
      input.signal.aborted ? "cancelled" : "provider_unavailable",
      false,
      true,
    );
  }
  if (input.signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw new RouterProviderError("cancelled", false, true);
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    if ([401, 403].includes(response.status))
      throw new RouterProviderError(
        "invalid_credentials",
        false,
        false,
        response.status,
      );
    if (response.status === 429) {
      const retry = aiProviderRetryAfter(
        response.headers.get("retry-after"),
        input.nowMs ?? Date.now(),
      );
      throw new RouterProviderError(
        "quota_exceeded",
        false,
        false,
        429,
        retry.retryAt,
        retry.reviewRequired,
      );
    }
    if (response.status === 404)
      throw new RouterProviderError("model_unavailable", true, false);
    if (response.status === 503)
      throw new RouterProviderError("provider_unavailable", true, false);
    throw new RouterProviderError("invalid_response", false, true);
  }
  const data = await responseJson(response, input.signal);
  // A billing violation must remain visible even if the generated text later
  // fails its schema. Do not return provider diagnostics or a usable result.
  if (
    input.model.provider === "openrouter" &&
    input.model.billing === "free" &&
    (observedCost(data.usage) ?? 0) > 0
  )
    throw new RouterProviderError(
      "invalid_response",
      false,
      true,
      undefined,
      null,
      true,
    );
  const result = parsedResult(data, request.models);
  if (input.schemaKey && !validRouterJson(input.schemaKey, result.text))
    return badResponse();
  if (
    input.apiKey.length >= 12 &&
    JSON.stringify(result).includes(input.apiKey)
  )
    return badResponse();
  return result;
}
