import {
  assistantToolPermission,
  ASSISTANT_TOOL_NAMES,
  parseAssistantToolCall,
  validateAssistantToolOutput,
  type AssistantToolCall,
  type AssistantToolName,
  type AssistantToolOutput,
} from "@lifeos/core";
import type { TelegramUserRecord } from "@lifeos/db";

const errors = {
  assistant_invalid_request: [
    400,
    "Use a complete, explicit request with a date and time for reminders. / Уточните запрос; для напоминания укажите дату и время.",
  ],
  assistant_unavailable: [
    503,
    "Assistant storage is unavailable. Existing commands remain available. / Хранилище ассистента недоступно; обычные команды доступны.",
  ],
  assistant_tool_unavailable: [
    503,
    "This assistant tool is unavailable. Try the existing LifeOS controls. / Инструмент недоступен; используйте обычные команды LifeOS.",
  ],
  assistant_permission_denied: [
    403,
    "This operation is disabled or unauthorized. / Это действие отключено или недоступно.",
  ],
  assistant_confirmation_invalid: [
    400,
    "Confirmation expired or does not match this request. Submit the request again. / Подтверждение истекло или не соответствует запросу.",
  ],
  assistant_confirmation_unavailable: [
    503,
    "Changes are unavailable until backend confirmation is configured. / Подтверждение изменений ещё не настроено.",
  ],
  assistant_sensitive_data: [
    400,
    "Use the existing health or finance controls for sensitive data. Credentials cannot be stored or sent to AI. / Для чувствительных данных используйте раздел здоровья или финансов; секреты не сохраняются и не отправляются ИИ.",
  ],
  assistant_rate_limited: [
    429,
    "Too many assistant requests. Try again shortly. / Слишком много запросов; попробуйте позже.",
  ],
} as const;
export class AssistantError extends Error {
  readonly statusCode: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code][1]);
    this.statusCode = errors[code][0];
    this.name = "AssistantError";
  }
}

export interface AssistantExecutionContext {
  user: TelegramUserRecord;
  source: "telegram" | "tma";
  requestId: string;
  now: Date;
  origin: "deterministic" | "model";
  authorizedWrite?: AssistantToolCall;
  allowDestructive: boolean;
}
type ToolHandler = (
  context: AssistantExecutionContext,
  call: AssistantToolCall,
) => Promise<AssistantToolOutput>;

/** No runtime tool registration comes from messages, provider output or memory. */
export class AssistantToolRegistry {
  private readonly tools = new Map<AssistantToolName, ToolHandler>();

  register(name: AssistantToolName, handler: ToolHandler): this {
    if (this.tools.has(name)) throw new Error("Duplicate assistant tool");
    if (!(ASSISTANT_TOOL_NAMES as readonly string[]).includes(name))
      throw new Error("Unknown assistant tool");
    this.tools.set(name, handler);
    return this;
  }

  async execute(
    context: AssistantExecutionContext,
    rawCall: unknown,
  ): Promise<AssistantToolOutput> {
    if (!context.user.userId || context.user.status !== "active")
      throw new AssistantError("assistant_permission_denied");
    let call: AssistantToolCall;
    try {
      call = parseAssistantToolCall(rawCall);
    } catch {
      throw new AssistantError("assistant_invalid_request");
    }
    const handler = this.tools.get(call.tool);
    if (!handler) throw new AssistantError("assistant_tool_unavailable");
    const permission = assistantToolPermission(call.tool);
    if (
      permission === "SENSITIVE" ||
      (permission === "DESTRUCTIVE" && !context.allowDestructive)
    )
      throw new AssistantError("assistant_permission_denied");
    if (
      permission !== "READ" &&
      (context.origin !== "deterministic" ||
        !context.authorizedWrite ||
        JSON.stringify(context.authorizedWrite) !== JSON.stringify(call))
    )
      throw new AssistantError("assistant_permission_denied");
    try {
      return validateAssistantToolOutput(await handler(context, call));
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      throw new AssistantError("assistant_tool_unavailable");
    }
  }
}
