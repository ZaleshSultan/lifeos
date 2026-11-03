import type { CaptureContextView } from "../../../../../packages/core/src/universal-capture.js";
import { captureDateTime } from "./model";

export function CaptureContextPanel({
  context,
}: {
  context: CaptureContextView | undefined;
}) {
  if (!context)
    return (
      <p className="text-xs leading-relaxed text-zinc-400">
        Проверенный контекст пока не загружен. Время занятий и выполненные
        действия не предполагаются.
      </p>
    );
  return (
    <details className="rounded-xl border border-white/10 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-cyan-100">
        Контекст и ограничения · {context.date}
      </summary>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-300">
        <p className="text-xs text-zinc-400">
          Часовой пояс: {context.timezone}. Предложения не изменяют
          подтверждённые обязательства.
        </p>
        {!context.scheduleKnown ? (
          <p className="text-amber-100">
            Подтверждённое расписание недоступно. LifeOS не придумывает время
            занятий.
          </p>
        ) : null}
        {context.warnings.map((warning, index) => (
          <p key={index} className="break-words text-amber-100">
            {warning}
          </p>
        ))}
        {context.facts?.length ? (
          <section>
            <h4 className="font-semibold text-zinc-100">Сохранённые факты</h4>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              {context.facts.map((fact, index) => (
                <li key={index} className="break-words">
                  {fact}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {context.preferences?.length ? (
          <section>
            <h4 className="font-semibold text-zinc-100">
              Явно сохранённые пожелания
            </h4>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              {context.preferences.map((item, index) => (
                <li key={index} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {context.commitments.length ? (
          <section>
            <h4 className="font-semibold text-zinc-100">
              Подтверждённые обязательства
            </h4>
            <ul className="mt-2 space-y-2">
              {context.commitments.map((item, index) => (
                <li key={index} className="break-words">
                  {item.title}
                  <span className="block text-xs text-zinc-400">
                    {captureDateTime(item.startsAt, context.timezone)} —{" "}
                    {captureDateTime(item.endsAt, context.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {context.deadlines.length ? (
          <section>
            <h4 className="font-semibold text-zinc-100">Известные сроки</h4>
            <ul className="mt-2 space-y-2">
              {context.deadlines.map((item, index) => (
                <li key={index} className="break-words">
                  {item.title}
                  <span className="block text-xs text-zinc-400">
                    {captureDateTime(item.dueAt, context.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {context.suggestedOrder.length ? (
          <section>
            <h4 className="font-semibold text-zinc-100">Возможный порядок</h4>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              {context.suggestedOrder.map((item, index) => (
                <li key={index} className="break-words">
                  {item}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-zinc-400">
              Это предложение. Ничего не отмечено выполненным и не добавлено в
              календарь.
            </p>
          </section>
        ) : null}
      </div>
    </details>
  );
}
