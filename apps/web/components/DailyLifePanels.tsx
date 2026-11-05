import type {
  BriefingView,
  DailyLifeSummary,
} from "../../../packages/core/src/daily-life.js";
import { SectionPanel } from "@/components/SectionPanel";
import type { ReactNode } from "react";
export function BriefingPanel({
  view,
  children,
}: {
  view: BriefingView;
  children?: ReactNode;
}) {
  return (
    <SectionPanel title={view.title} eyebrow="Факты и предложения">
      <div className="space-y-4">
        {view.facts.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
              Из записанных данных
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-200">
              {view.facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Нет доступных фактов для обзора.
          </p>
        )}
        {view.warnings.map((warning, i) => (
          <p
            key={i}
            className="rounded-lg border border-amber-300/20 p-3 text-xs leading-relaxed text-amber-100"
          >
            {warning}
          </p>
        ))}
        {view.suggestions.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
              Возможные действия
            </h3>
            {view.suggestions.map((suggestion, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-zinc-300">
                {suggestion}
              </p>
            ))}
          </div>
        ) : null}
        {view.questions.length ? (
          <div>
            {view.questions.map((question, i) => (
              <p key={i} className="mt-2 text-sm text-zinc-300">
                {question}
              </p>
            ))}
          </div>
        ) : null}
        {children}
        {view.tomorrowOrder.length ? (
          <p className="text-xs leading-relaxed text-zinc-400">
            Для просмотра на завтра: {view.tomorrowOrder.join(" → ")}. Этот
            порядок не сохраняется автоматически.
          </p>
        ) : null}
      </div>
    </SectionPanel>
  );
}
export function DocumentaryPanel({ summary }: { summary: DailyLifeSummary }) {
  return (
    <SectionPanel
      title="Что можно снять сегодня"
      eyebrow="Предложения для фильма"
    >
      <p className="mb-3 text-xs text-zinc-400">
        Это идеи кадров, а не подтверждение съёмки. Galaxy S23+ → приватные
        файлы → DaVinci Resolve.
      </p>
      <div className="space-y-3">
        {summary.documentary.shots.map((shot, i) => (
          <article
            key={i}
            className="rounded-lg border border-white/[0.08] p-3"
          >
            <h3 className="text-sm font-semibold text-zinc-100">
              {shot.kind === "a_roll"
                ? "A-roll"
                : shot.kind === "b_roll"
                  ? "B-roll"
                  : "Рефлексия"}{" "}
              · {shot.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {shot.reason}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-sm text-zinc-300">
        Дней со съёмкой: {summary.documentary.filmingDays} · с твоим
        подтверждением копии: {summary.documentary.backupConfirmedDays}.
      </p>
      <div className="mt-3 space-y-2">
        {summary.documentary.weeklyReflection.map((reflection, i) => (
          <p key={i} className="text-xs leading-relaxed text-zinc-400">
            {reflection}
          </p>
        ))}
      </div>
    </SectionPanel>
  );
}
