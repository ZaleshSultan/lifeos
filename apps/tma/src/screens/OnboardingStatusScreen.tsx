import { Clock3, RefreshCw, ShieldAlert, Sparkles, UserPlus } from "lucide-react";
import type { TmaSessionState, TmaSessionStatus } from "../api/types";
import { useRegisterSessionMutation } from "../api/hooks";
import { ErrorPanel } from "../components/AsyncState";
import { IntegrationStatusCard } from "../components/IntegrationStatusCard";
import {
  integrationCardsForSession,
  onboardingContentForState,
} from "../lib/session-status";

interface OnboardingStatusScreenProps {
  session: TmaSessionStatus;
  onRetry: () => void;
}

function StateIcon({ state }: { state: TmaSessionState }) {
  if (state === "blocked") {
    return <ShieldAlert className="h-5 w-5 text-rose-300" />;
  }

  if (state === "pending") {
    return <Clock3 className="h-5 w-5 text-amber-300" />;
  }

  if (state === "unregistered") {
    return <UserPlus className="h-5 w-5 text-cyan-300" />;
  }

  return <Sparkles className="h-5 w-5 text-emerald-300" />;
}

export function OnboardingStatusScreen({
  onRetry,
  session,
}: OnboardingStatusScreenProps) {
  const register = useRegisterSessionMutation();
  const content = onboardingContentForState(session.state);
  const cards = integrationCardsForSession(session);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08]">
            <StateIcon state={session.state} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Account
            </p>
            <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-white">
              {content.title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {content.body}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {content.detail}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-300">
            {session.state}
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-400">
            Telegram {session.telegramUserId}
          </span>
        </div>

        {session.state === "unregistered" ? (
          <button
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-graphite-950 active:scale-[0.99] disabled:opacity-60"
            disabled={register.isPending}
            onClick={() => register.mutate()}
            type="button"
          >
            <UserPlus className="h-4 w-4" />
            Создать заявку
          </button>
        ) : null}

        <button
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm font-semibold text-zinc-200 active:scale-[0.99]"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh status
        </button>
      </section>

      {register.isError ? (
        <ErrorPanel
          detail={register.error.message}
          title="Could not create request"
        />
      ) : null}

      {session.state === "active" ? (
        <section className="space-y-2">
          <div className="text-sm font-semibold text-white">Integrations</div>
          {cards.map((card) => (
            <IntegrationStatusCard
              description={card.description}
              key={card.title}
              status={card.status}
              title={card.title}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
