import type { CaptureActionView } from "../../../../../packages/core/src/universal-capture.js";
import {
  captureCalendarDate,
  captureDateTime,
  captureProposalTitle,
} from "./model";

export function CaptureProposalDetails({
  action,
  timezone,
}: {
  action: CaptureActionView;
  timezone: string;
}) {
  const view = action.presentation;
  const args = action.args as unknown as Record<string, unknown>;
  const zone = view?.timezone ?? timezone;
  const instant =
    action.kind === "reminder.create"
      ? action.args.remindAt
      : action.kind === "task.create" || action.kind === "task.update"
        ? action.args.dueAt
        : null;
  const date =
    view?.suggestedDate ?? (typeof args.date === "string" ? args.date : null);
  const legacyDescription =
    !view &&
    typeof args.content === "string" &&
    args.content !== captureProposalTitle(action)
      ? args.content
      : null;
  return (
    <div className="mt-3 min-w-0 space-y-2 text-sm leading-relaxed text-zinc-300">
      {view?.description ? (
        <p className="whitespace-pre-wrap break-words">{view.description}</p>
      ) : null}
      {legacyDescription ? (
        <p className="whitespace-pre-wrap break-words">{legacyDescription}</p>
      ) : null}
      {date ? (
        <p className="break-words text-xs">
          <span className="text-zinc-400">Предложенная дата: </span>
          {captureCalendarDate(date)} · {zone}
        </p>
      ) : null}
      {instant ? (
        <p className="text-xs">
          {action.kind === "reminder.create" ? "Напомнить" : "Срок"}:{" "}
          {captureDateTime(instant, zone)} · {zone}
        </p>
      ) : null}
      {typeof args.time === "string" ? (
        <p className="text-xs">
          Предпочтительное время: {args.time} · {zone}
        </p>
      ) : null}
      {view?.relation ? (
        <p className="break-words text-xs">
          Условие из сообщения: {view.relation}
        </p>
      ) : null}
      {view?.timeHint ? (
        <p className="break-words text-xs">
          Пожелание по времени: {view.timeHint}
        </p>
      ) : null}
      {(view?.relation || view?.timeHint) && !instant && !args.time ? (
        <p className="text-xs text-zinc-400">Точное время не назначено.</p>
      ) : null}
      {view ? (
        <p className="text-xs text-zinc-400">
          {view.evidence === "recommendation"
            ? "Рекомендация LifeOS"
            : "Из твоего сообщения"}
          {view.dateBasis === "ideal_human" ? " · календарь Ideal Human" : ""}
        </p>
      ) : null}
      {action.kind === "planning.suggest" ? (
        <p className="text-xs text-zinc-400">
          Это план, а не выполненная тренировка или событие календаря.
        </p>
      ) : null}
      {action.kind === "filming.idea" ? (
        <p className="text-xs text-zinc-400">
          Идея съёмки не означает, что материал уже снят.
        </p>
      ) : null}
      {view?.warnings.map((warning, index) => (
        <p key={index} className="break-words text-xs text-amber-100">
          {warning}
        </p>
      ))}
    </div>
  );
}
