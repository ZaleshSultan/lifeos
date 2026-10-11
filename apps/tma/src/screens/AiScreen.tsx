import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, MessageCircle, Send, Trash2 } from "lucide-react";
import {
  AI_MAX_MESSAGE_CHARS,
  aiUnavailableMessage,
  confirmAiChatRequest,
  planningErrorMessage,
  prepareAiChatRequest,
  useAiChatMutation,
  useAiStatusQuery,
  useTodayQuery,
  type AiChatAnswer,
  type AiChatRequest,
  type AiMessage,
} from "../api/planning";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { cx } from "../lib/styles";
import { telegram } from "../telegram";

interface AiScreenProps {
  date?: string;
  onBack: () => void;
}

export function AiSuggestions({
  suggestions,
  timezone,
}: {
  suggestions: AiChatAnswer["suggestions"];
  timezone: string;
}) {
  const time = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <h2 className="text-sm font-semibold text-white">
        Validated schedule suggestions
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {timezone} · These suggestions have not been saved.
      </p>
      <ul className="mt-3 space-y-3 text-sm text-zinc-200">
        {suggestions.map((suggestion, index) => (
          <li key={index}>
            <p className="break-words font-medium text-white">
              {suggestion.title ?? "Task suggestion"}
            </p>
            <p className="mt-1 tabular-nums text-zinc-300">
              {time(suggestion.startsAt)}–{time(suggestion.endsAt)}
            </p>
            {suggestion.estimated ? (
              <p className="mt-1 text-xs text-amber-200">Duration estimated</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AiToolResult({
  answer,
  timezone,
  cancelled = false,
}: {
  answer: AiChatAnswer;
  timezone: string;
  cancelled?: boolean;
}) {
  const updated = (value: string | null) => {
    if (!value || !Number.isFinite(Date.parse(value)))
      return "Freshness unknown";
    return `Updated ${new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value))}`;
  };

  return (
    <section
      aria-label="Assistant result details"
      className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
    >
      <h2 className="text-sm font-semibold text-white">
        {answer.provider === "lifeos" ? "LifeOS tools" : "Google Gemini"}
        {answer.tool
          ? cancelled
            ? " · Confirmation cancelled"
            : answer.tool.status === "pending_confirmation"
              ? " · Awaiting confirmation"
              : " · Completed"
          : " · Read-only answer"}
      </h2>
      {answer.tool ? (
        <p className="mt-2 break-words text-sm leading-relaxed text-zinc-300">
          {cancelled ? "You did not confirm this change." : answer.tool.summary}
        </p>
      ) : null}
      {answer.sources?.length ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-zinc-300">
            Source data · {timezone}
          </h3>
          <ul className="mt-2 space-y-2 text-xs text-zinc-400">
            {answer.sources.map((source, index) => (
              <li key={index} className="break-words">
                <span className="text-zinc-300">{source.name}</span>
                {" · "}
                {updated(source.updatedAt)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function AiActionConfirmation({
  summary,
  onConfirm,
  onCancel,
  disabled,
}: {
  summary: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <section
      aria-label="Confirm assistant change"
      className="rounded-xl border border-amber-300/25 bg-amber-300/[0.05] p-4"
    >
      <h2 className="text-sm font-semibold text-amber-100">
        Review before saving
      </h2>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
        {summary}
      </p>
      <p className="mt-2 text-xs text-zinc-400">
        Nothing has been changed yet.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="min-h-11 flex-1 rounded-lg bg-amber-200 px-4 text-sm font-semibold text-graphite-950 hover:bg-amber-100 active:scale-[0.98] disabled:opacity-50"
        >
          Confirm change
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="min-h-11 rounded-lg border border-white/[0.08] px-4 text-sm text-zinc-200 hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function AiConversation({
  date,
  assistantEnabled,
  geminiAvailable,
}: {
  date?: string;
  assistantEnabled: boolean;
  geminiAvailable: boolean;
}) {
  const todayQuery = useTodayQuery(date);
  const mutation = useAiChatMutation();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AiChatAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<AiChatRequest | null>(null);
  const [confirmationRequest, setConfirmationRequest] =
    useState<AiChatRequest | null>(null);
  const [confirmationCancelled, setConfirmationCancelled] = useState(false);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timezone = todayQuery.data?.plan.timezone ?? "UTC";

  useEffect(
    () => () => {
      requestVersion.current += 1;
      controller.current?.abort();
    },
    [],
  );

  async function sendRequest(request: AiChatRequest) {
    if (mutation.isPending) return;
    const version = ++requestVersion.current;
    const abortController = new AbortController();
    controller.current = abortController;
    setPendingQuestion(
      request.confirmationToken
        ? null
        : (request.messages.at(-1)?.text ?? null),
    );
    setError(null);
    setRetryRequest(null);
    setConfirmationRequest(null);
    setConfirmationCancelled(false);
    if (request.confirmationToken) setAnswer(null);
    try {
      const response = await mutation.mutateAsync({
        ...request,
        signal: abortController.signal,
      });
      if (requestVersion.current !== version) return;
      setMessages([
        ...request.messages,
        { role: "assistant", text: response.answer },
      ]);
      setAnswer(response);
      setConfirmationRequest(response.confirmation ? request : null);
      setPendingQuestion(null);
    } catch (failure) {
      if (requestVersion.current !== version) return;
      setError(planningErrorMessage(failure));
      setRetryRequest(request);
    } finally {
      if (requestVersion.current === version) {
        controller.current = null;
        mutation.reset();
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (
      !text ||
      mutation.isPending ||
      confirmationRequest ||
      text.length > AI_MAX_MESSAGE_CHARS
    )
      return;
    const request = prepareAiChatRequest(messages, text, date);
    setDraft("");
    setAnswer(null);
    await sendRequest(request);
  }

  function confirmChange() {
    if (!confirmationRequest || !answer?.confirmation || mutation.isPending)
      return;
    telegram.hapticImpact("medium");
    void sendRequest(
      confirmAiChatRequest(confirmationRequest, answer.confirmation.token),
    );
  }

  function cancelChange() {
    if (mutation.isPending) return;
    setConfirmationRequest(null);
    setConfirmationCancelled(true);
    telegram.hapticImpact("light");
  }

  function clearConversation() {
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    mutation.reset();
    setMessages([]);
    setDraft("");
    setPendingQuestion(null);
    setAnswer(null);
    setError(null);
    setRetryRequest(null);
    setConfirmationRequest(null);
    setConfirmationCancelled(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          {assistantEnabled
            ? "Ask in English or Russian about classes, grades, deadlines, tasks, and available time. LifeOS tools answer supported requests directly. Review and confirm changes before they are saved."
            : "Ask about your tasks, university workload, availability, and productivity. AI can explain or suggest plans. It cannot change your data."}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {date ? `Planning date: ${date}. ` : ""}Conversation keeps up to 6
          recent exchanges. Leaving this screen clears it.
          {assistantEnabled
            ? " Clearing this conversation does not erase saved memories."
            : ""}
        </p>
        {assistantEnabled ? (
          <details className="mt-2 text-xs leading-relaxed text-zinc-300">
            <summary className="min-h-11 cursor-pointer py-3 text-cyan-200">
              Memory commands
            </summary>
            <p className="text-zinc-400">
              Save only what you explicitly choose. Use the same key to update
              or archive a memory, for example:
            </p>
            <ul className="mt-2 space-y-2 break-words">
              <li>
                remember preference study.time: I study best in the morning
              </li>
              <li>show memories · что ты помнишь</li>
              <li>search memories for morning</li>
              <li>
                update memory study.time preference: I study best in the evening
              </li>
              <li>archive memory study.time</li>
              <li>delete memory study.time</li>
            </ul>
            <p className="mt-2 text-zinc-400">
              Permanent deletion may be disabled. Archiving removes a memory
              from active retrieval.
            </p>
          </details>
        ) : null}
        <button
          disabled={!messages.length && !draft && !pendingQuestion && !error}
          type="button"
          onClick={clearConversation}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-sm text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
          Clear conversation
        </button>
      </div>

      <div
        role="log"
        aria-label="LifeOS AI conversation"
        aria-live="polite"
        aria-busy={mutation.isPending}
        className="space-y-3"
      >
        {messages.length === 0 && !pendingQuestion ? (
          <p className="px-1 text-sm leading-relaxed text-zinc-400">
            {assistantEnabled
              ? "Try “What is my next class?” or “Какие дедлайны скоро?”. To save a preference, try “remember preference: I study best in the morning”. Open Memory commands above to view, search, update, archive, or delete memories."
              : "Try “Which deadlines are urgent?” or “Analyze my last seven days.”"}
          </p>
        ) : null}
        {messages.map((message, index) => (
          <article
            key={index}
            className={cx(
              "rounded-xl border p-4",
              message.role === "user"
                ? "border-cyan-400/20 bg-cyan-400/[0.05]"
                : "border-white/[0.08] bg-white/[0.03]",
            )}
          >
            <p className="mb-2 text-xs font-semibold text-zinc-400">
              {message.role === "user"
                ? "You"
                : assistantEnabled
                  ? "LifeOS AI"
                  : "LifeOS AI · Gemini"}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
              {message.text}
            </p>
          </article>
        ))}
        {pendingQuestion ? (
          <article className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4">
            <p className="mb-2 text-xs font-semibold text-zinc-400">You</p>
            <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">
              {pendingQuestion}
            </p>
          </article>
        ) : null}
        {mutation.isPending ? (
          <LoadingPanel title="Preparing an answer from your LifeOS data" />
        ) : null}
      </div>

      {answer ? (
        <AiToolResult
          answer={answer}
          timezone={timezone}
          cancelled={confirmationCancelled}
        />
      ) : null}

      {confirmationRequest && answer?.confirmation ? (
        <AiActionConfirmation
          summary={answer.confirmation.summary}
          disabled={mutation.isPending}
          onConfirm={confirmChange}
          onCancel={cancelChange}
        />
      ) : null}

      {answer && answer.suggestions.length > 0 ? (
        <AiSuggestions suggestions={answer.suggestions} timezone={timezone} />
      ) : null}

      {error ? (
        <div role="alert">
          <ErrorPanel
            title="AI could not answer"
            detail={error}
            onRetry={
              retryRequest && !mutation.isPending
                ? () => void sendRequest(retryRequest)
                : undefined
            }
          />
          {assistantEnabled && retryRequest ? (
            <p className="mt-2 px-1 text-xs leading-relaxed text-zinc-400">
              Retry checks the same request to avoid duplicate changes. A change
              may have completed even if the connection failed.
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={(event) => void submit(event)}
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      >
        <label htmlFor="ai-question" className="text-sm font-medium text-white">
          Your question
        </label>
        <textarea
          id="ai-question"
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={AI_MAX_MESSAGE_CHARS}
          disabled={mutation.isPending || Boolean(confirmationRequest)}
          placeholder="What should I focus on?"
          aria-describedby="ai-disclosure ai-character-count"
          className="mt-2 w-full resize-y rounded-lg border border-white/[0.08] bg-graphite-900 p-3 text-sm text-white placeholder:text-zinc-500 disabled:opacity-60"
        />
        <p
          id="ai-character-count"
          className="mt-1 text-right text-xs tabular-nums text-zinc-400"
        >
          {draft.length}/{AI_MAX_MESSAGE_CHARS}
        </p>
        <p
          id="ai-disclosure"
          className="mt-2 text-xs leading-relaxed text-zinc-400"
        >
          {assistantEnabled
            ? `LifeOS handles supported tool and memory requests without sending them to an AI provider. ${geminiAvailable ? "Other planning questions may share your current message and a limited snapshot of academic/project tasks, deadlines, commitment times, availability, and task activity with Google Gemini. Anything you type in a planning question may be sent. " : "Gemini planning is currently unavailable. "}Health, finance, and saved memories are excluded from Gemini context. Do not enter passwords or access tokens. Only explicit memory requests save memories.`
            : "Sending shares your message, recent conversation, and a limited snapshot of named academic/project tasks, deadlines, private commitment times, availability, and task activity with Google Gemini. Other task, reminder, and calendar titles are masked. Health and finance records are excluded. Anything you type is sent."}
        </p>
        <button
          type="submit"
          disabled={
            !draft.trim() || mutation.isPending || Boolean(confirmationRequest)
          }
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-graphite-950 hover:bg-cyan-200 active:scale-[0.98] disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {mutation.isPending ? "Sending…" : "Send question"}
        </button>
      </form>
    </div>
  );
}

export function AiScreen({ date, onBack }: AiScreenProps) {
  const statusQuery = useAiStatusQuery();
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-cyan-200 hover:bg-white/[0.06] active:scale-[0.98]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Today
      </button>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
        <MessageCircle className="h-5 w-5 text-cyan-400" />
        LifeOS AI
      </h1>
      {statusQuery.isLoading ? (
        <LoadingPanel title="Checking AI availability" />
      ) : statusQuery.isError ? (
        <ErrorPanel
          title="AI status unavailable"
          detail={planningErrorMessage(statusQuery.error)}
          onRetry={() => void statusQuery.refetch()}
        />
      ) : !statusQuery.data ? (
        <ErrorPanel
          title="AI status returned no data"
          onRetry={() => void statusQuery.refetch()}
        />
      ) : !statusQuery.data.assistantEnabled &&
        (!statusQuery.data.enabled || !statusQuery.data.available) ? (
        <ErrorPanel
          title="AI assistance unavailable"
          detail={aiUnavailableMessage(statusQuery.data)}
          onRetry={() => void statusQuery.refetch()}
        />
      ) : (
        <AiConversation
          key={statusQuery.data.assistantEnabled ? "assistant" : "gemini"}
          date={date}
          assistantEnabled={Boolean(statusQuery.data.assistantEnabled)}
          geminiAvailable={
            statusQuery.data.enabled && statusQuery.data.available
          }
        />
      )}
    </div>
  );
}
