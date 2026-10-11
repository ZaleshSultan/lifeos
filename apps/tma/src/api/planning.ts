import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, request } from "./client";

export interface DailyPlan {
  date: string;
  timezone: string;
  mode: string;
  window: { startsAt: string; endsAt: string };
  availableMinutes: number;
  freeSlots: Array<{ startsAt: string; endsAt: string }>;
  conflicts: Array<{ eventIds: string[] }>;
  rankedTasks: Array<{
    id: string;
    title: string;
    domain?: string;
    priority?: number;
    dueAt?: string | null;
    estimatedMinutes?: number | null;
    score: number;
    reasons: string[];
  }>;
  blocks: Array<{
    taskId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    estimated: boolean;
  }>;
  unscheduledTaskIds: string[];
  warnings: string[];
}

export interface AiStatus {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  liveEnabled: false;
  assistantEnabled?: boolean;
}

export interface TodaySummary {
  plan: DailyPlan;
  events: Array<{ title: string; startsAt: string; endsAt: string }>;
  reminders: Array<{ title: string; remindAt: string }>;
  productivity: {
    startDate: string;
    endDate: string;
    timezone: string;
    daily: Array<{ date: string; created: number; completed: number }>;
    totalCreated: number;
    totalCompleted: number;
    completionRate: number | null;
    truncated: boolean;
    warnings: string[];
  };
  ai: AiStatus;
}

export interface AiMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiChatAnswer {
  answer: string;
  suggestions: Array<{
    taskId: string;
    startsAt: string;
    endsAt: string;
    title?: string;
    estimated?: boolean;
  }>;
  provider: "gemini" | "lifeos";
  readOnly: boolean;
  tool?: {
    name: string;
    permission: "READ" | "WRITE" | "SENSITIVE" | "DESTRUCTIVE";
    status: "completed" | "pending_confirmation";
    summary: string;
  };
  sources?: Array<{ name: string; updatedAt: string | null }>;
  confirmation?: { token: string; summary: string };
}

export interface AiChatRequest {
  messages: AiMessage[];
  date?: string;
  requestId?: string;
  confirmationToken?: string;
}

export const AI_MAX_MESSAGES = 12;
export const AI_MAX_MESSAGE_CHARS = 2000;
export const todayQueryKey = ["today"] as const;

export function getToday(date?: string, signal?: AbortSignal) {
  return request<TodaySummary>(
    `/api/tma/today${date ? `?date=${encodeURIComponent(date)}` : ""}`,
    { signal },
  );
}

export function getAiStatus(signal?: AbortSignal) {
  return request<AiStatus>("/api/tma/ai/status", { signal });
}

export function sendAiChat(input: AiChatRequest & { signal?: AbortSignal }) {
  return request<AiChatAnswer>("/api/tma/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: input.messages,
      date: input.date,
      requestId: input.requestId,
      confirmationToken: input.confirmationToken,
    }),
    signal: input.signal,
  });
}

export function useTodayQuery(date?: string) {
  return useQuery({
    queryKey: [...todayQueryKey, date ?? "current"],
    queryFn: ({ signal }) => getToday(date, signal),
  });
}

export function useAiStatusQuery() {
  return useQuery({
    queryKey: ["ai", "status"],
    queryFn: ({ signal }) => getAiStatus(signal),
    retry: false,
  });
}

export function useAiChatMutation() {
  return useMutation({
    mutationFn: sendAiChat,
    retry: false,
    gcTime: 0,
  });
}

// Keep whole recent exchanges while bounding all text sent back to the provider.
export function prepareAiMessages(
  history: AiMessage[],
  userText: string,
): AiMessage[] {
  return [
    ...history.slice(-(AI_MAX_MESSAGES - 2)),
    { role: "user" as const, text: userText.trim() },
  ].map((message) => ({
    role: message.role,
    text: message.text.slice(0, AI_MAX_MESSAGE_CHARS),
  }));
}

export function prepareAiChatRequest(
  history: AiMessage[],
  userText: string,
  date?: string,
): AiChatRequest {
  return {
    messages: prepareAiMessages(history, userText),
    date,
    requestId: crypto.randomUUID(),
  };
}

// The backend-issued token is the only confirmation authority. Keep the
// original request identity so confirmation and retries cannot create duplicates.
export function confirmAiChatRequest(
  original: AiChatRequest,
  token: string,
): AiChatRequest {
  return { ...original, confirmationToken: token };
}

export function aiUnavailableMessage(status: AiStatus): string {
  if (!status.enabled) {
    return "AI assistance is disabled. Your daily plan works without AI.";
  }
  if (status.reason === "ai_missing_credentials") {
    return "AI assistance is not configured. Your daily plan remains available.";
  }
  if (status.reason === "ai_unsupported_model") {
    return "The configured AI model is unavailable. Your daily plan remains available.";
  }
  return "AI assistance is currently unavailable. Your daily plan remains available.";
}

export function planningErrorMessage(error: unknown): string {
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
      // Only known error codes are shown; raw backend responses stay out of the UI.
    }
    if (code === "ai_disabled")
      return "AI assistance is disabled. Your daily plan remains available.";
    if (code === "ai_missing_credentials" || code === "ai_invalid_credentials")
      return "AI assistance is not configured correctly. Your daily plan remains available.";
    if (code === "ai_unsupported_model")
      return "The configured AI model is unavailable. Your daily plan remains available.";
    if (code === "ai_invalid_response")
      return "AI returned an answer that could not be validated. Please try again.";
    if (code === "assistant_confirmation_invalid")
      return "This confirmation has expired or no longer matches the request. Send the request again to review a fresh confirmation.";
    if (code === "assistant_tool_unavailable")
      return "This assistant tool is unavailable. Check the connected source or try again later.";
    if (code === "assistant_unavailable")
      return "The assistant is temporarily unavailable. Please try again later.";
    if (code === "assistant_invalid_request")
      return "This request could not be validated. Check the details and send it again.";
    if (code === "assistant_confirmation_unavailable")
      return "Changes are currently unavailable. You can still ask for information.";
    if (code === "assistant_permission_denied")
      return "This action is disabled. You can still ask for information.";
    if (code === "assistant_sensitive_data")
      return "This request includes sensitive data the assistant cannot process. Remove credentials or private records and try again.";
    if (error.status === 401 || error.status === 403) {
      return "Reopen LifeOS from Telegram to refresh your access.";
    }
    if (error.status === 429) {
      return "The request limit was reached. Wait a little before trying again.";
    }
    if (error.status === 504) {
      return "The request took too long. Please try again.";
    }
    if (error.status === 503) {
      return "This service is temporarily unavailable. Please try again later.";
    }
  }
  return "Could not load this information. Check your connection and try again.";
}
