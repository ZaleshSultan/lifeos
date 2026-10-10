import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, MessageCircle, Send, Trash2 } from "lucide-react";
import {
  AI_MAX_MESSAGE_CHARS,
  aiUnavailableMessage,
  planningErrorMessage,
  prepareAiMessages,
  useAiChatMutation,
  useAiStatusQuery,
  useTodayQuery,
  type AiChatAnswer,
  type AiMessage,
} from "../api/planning";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { cx } from "../lib/styles";

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

function AiConversation({ date }: { date?: string }) {
  const todayQuery = useTodayQuery(date);
  const mutation = useAiChatMutation();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AiChatAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || mutation.isPending || text.length > AI_MAX_MESSAGE_CHARS)
      return;

    const version = ++requestVersion.current;
    const abortController = new AbortController();
    controller.current = abortController;
    const nextMessages = prepareAiMessages(messages, text);
    setPendingQuestion(text);
    setDraft("");
    setError(null);
    setAnswer(null);
    try {
      const response = await mutation.mutateAsync({
        messages: nextMessages,
        date,
        signal: abortController.signal,
      });
      if (requestVersion.current !== version) return;
      setMessages([
        ...nextMessages,
        { role: "assistant", text: response.answer },
      ]);
      setAnswer(response);
    } catch (failure) {
      if (requestVersion.current !== version) return;
      setError(planningErrorMessage(failure));
      setDraft(text);
    } finally {
      if (requestVersion.current === version) {
        setPendingQuestion(null);
        controller.current = null;
        mutation.reset();
      }
    }
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
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          Ask about your tasks, university workload, availability, and
          productivity. AI can explain or suggest plans. It cannot change your
          data.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {date ? `Planning date: ${date}. ` : ""}Conversation keeps up to 6
          recent exchanges. Leaving this screen clears it.
        </p>
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
            Try “Which deadlines are urgent?” or “Analyze my last seven days.”
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
              {message.role === "user" ? "You" : "LifeOS AI · Gemini"}
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

      {answer && answer.suggestions.length > 0 ? (
        <AiSuggestions suggestions={answer.suggestions} timezone={timezone} />
      ) : null}

      {error ? (
        <div role="alert">
          <ErrorPanel title="AI could not answer" detail={error} />
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
          disabled={mutation.isPending}
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
          Sending shares your message, recent conversation, and a limited
          snapshot of named academic/project tasks, deadlines, private
          commitment times, availability, and task activity with Google Gemini.
          Other task, reminder, and calendar titles are masked. Health and
          finance records are excluded. Anything you type is sent.
        </p>
        <button
          type="submit"
          disabled={!draft.trim() || mutation.isPending}
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
      ) : !statusQuery.data.enabled || !statusQuery.data.available ? (
        <ErrorPanel
          title="AI assistance unavailable"
          detail={aiUnavailableMessage(statusQuery.data)}
          onRetry={() => void statusQuery.refetch()}
        />
      ) : (
        <AiConversation date={date} />
      )}
    </div>
  );
}
