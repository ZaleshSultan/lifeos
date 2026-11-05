import {
  useDraftState,
  useDraftRetention,
  useDiscardDraft,
} from "../../lib/retained-draft";
import { useState, type FormEvent } from "react";
import type {
  AcademicEvent,
  AcademicEventInput,
  AcademicEventRevisionInput,
  AcademicSourceInput,
} from "../../../../../packages/core/src/academic-concierge.js";
import { AcademicRoomMap } from "./AcademicRoomMap";
import { academicInputTimestamp, localAcademicInput } from "./academic-import";
import {
  academicButton,
  academicCalendarDate,
  academicCountdown,
  academicDateTime,
  academicInput,
  academicKindLabel,
  academicPanel,
  academicStatusLabel,
} from "./academic-ui";

export function AcademicEventSummary({
  event,
  source,
  now,
  map = true,
}: {
  event: AcademicEventInput;
  source?: AcademicSourceInput;
  now: string | null;
  map?: boolean;
}) {
  const timed =
    event.kind === "university_exam" || event.kind === "personal_exam";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
        <span className="rounded bg-white/5 px-2 py-1">
          {academicKindLabel[event.kind]}
        </span>
        <span className="rounded bg-white/5 px-2 py-1">
          {academicStatusLabel[event.status]}
        </span>
        {event.sourceTypeCode ? (
          <span className="rounded bg-cyan-300/10 px-2 py-1 text-cyan-100">
            {event.sourceTypeCode}
          </span>
        ) : null}
      </div>
      <h3 className="mt-2 break-words text-base font-semibold text-white">
        {event.title}
      </h3>
      <p className="mt-2 break-words text-sm text-zinc-200">
        {timed
          ? academicDateTime(event.startsAt, event.timezone)
          : academicCalendarDate(event.startsOn) +
            " — " +
            academicCalendarDate(event.endsOn)}
      </p>
      {timed ? (
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          {event.endsAt
            ? "Окончание: " + academicDateTime(event.endsAt, event.timezone)
            : "Окончание и длительность неизвестны."}{" "}
          · {event.timezone}
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-400">
          Последний день включён · {event.timezone}
        </p>
      )}
      {timed ? (
        <p className="mt-2 text-sm font-medium text-cyan-200">
          {academicCountdown(event, now)}
        </p>
      ) : null}
      {event.location ? (
        <p className="mt-2 break-words text-sm text-zinc-200">
          Место: {event.location}
        </p>
      ) : timed ? (
        <p className="mt-2 text-xs text-zinc-400">Место не подтверждено.</p>
      ) : null}
      {event.kind === "personal_exam" ? (
        <p className="mt-2 text-xs text-amber-100">
          Личное событие со слов владельца. Оно не относится к AITU, занятиям
          или заданиям LMS.
        </p>
      ) : null}
      {source ? (
        <p className="mt-2 break-words text-xs leading-relaxed text-zinc-400">
          Источник: {source.label}
          {source.page ? ` · стр. ${source.page}` : ""}.{" "}
          {source.kind === "owner_provided"
            ? "Предоставлено владельцем."
            : "Документ предоставлен для проверки; импорт не означает автоматическую проверку внешнего сайта."}
        </p>
      ) : (
        <p className="mt-2 text-xs text-amber-100">
          Описание источника недоступно.
        </p>
      )}
      {map && event.kind === "university_exam" ? (
        <AcademicRoomMap key={event.location} location={event.location} />
      ) : null}
    </div>
  );
}

export function AcademicEventEditor({
  event,
  busy,
  onSave,
  onCancel,
}: {
  event: AcademicEventInput;
  busy: boolean;
  onSave: (patch: AcademicEventRevisionInput["patch"]) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useDraftState(
    `academic:event:${event.sourceKey}:${event.key}`,
    "title",
    event.title,
  );
  const [location, setLocation] = useDraftState(
    `academic:event:${event.sourceKey}:${event.key}`,
    "location",
    event.location ?? "",
  );
  const [start, setStart] = useDraftState(
    `academic:event:${event.sourceKey}:${event.key}`,
    "start",
    localAcademicInput(event.startsAt, event.timezone),
  );
  const [end, setEnd] = useDraftState(
    `academic:event:${event.sourceKey}:${event.key}`,
    "end",
    localAcademicInput(event.endsAt, event.timezone),
  );
  useDraftRetention(`academic:event:${event.sourceKey}:${event.key}`, true);
  const discardDraft = useDiscardDraft(
    `academic:event:${event.sourceKey}:${event.key}`,
  );
  const [invalid, setInvalid] = useState(false);
  const timed = event.startsAt !== null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setInvalid(false);
    try {
      if (!title.trim()) throw new Error();
      const patch: AcademicEventRevisionInput["patch"] = {
        title: title.trim(),
        location: location.trim() || null,
      };
      if (timed) {
        patch.startsAt = academicInputTimestamp(start, event.timezone);
        patch.endsAt = end ? academicInputTimestamp(end, event.timezone) : null;
        if (patch.endsAt && patch.endsAt <= patch.startsAt) throw new Error();
      }
      await onSave(patch);
      discardDraft();
    } catch {
      setInvalid(true);
    }
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className={academicPanel}
      aria-label="Правка учебного события"
    >
      <p className="text-sm text-zinc-300">
        Ручная правка сохранится отдельно от обновлений исходного документа.
        Время указано в {event.timezone}.
      </p>
      {invalid ? (
        <p role="alert" className="mt-2 text-sm text-amber-100">
          Проверь название и порядок времени. Если сервер недоступен или версия
          изменилась, правки остались в форме.
        </p>
      ) : null}
      <fieldset disabled={busy} className="mt-3 min-w-0 space-y-3">
        <label className="block min-w-0 text-sm text-zinc-300">
          Название
          <input
            className={academicInput}
            value={title}
            maxLength={500}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block min-w-0 text-sm text-zinc-300">
          Место как в источнике
          <input
            className={academicInput}
            value={location}
            maxLength={500}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        {timed ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 text-sm text-zinc-300">
              Начало · {event.timezone}
              <input
                className={academicInput}
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="block min-w-0 text-sm text-zinc-300">
              Окончание, если известно
              <input
                className={academicInput}
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">
            Даты учебного периода берутся из исходного календаря. Для
            исправления диапазона подготовь новую проверенную версию импорта.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={academicButton}>
            Сохранить ручную правку
          </button>
          <button
            type="button"
            className={academicButton}
            onClick={() => {
              discardDraft();
              onCancel();
            }}
          >
            Отменить правку
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function AcademicEventCard({
  event,
  source,
  now,
  busy,
  onEdit,
  onDecision,
}: {
  event: AcademicEvent;
  source?: AcademicSourceInput;
  now: string | null;
  busy: boolean;
  onEdit: () => void;
  onDecision: (action: "confirm" | "cancel") => void;
}) {
  return (
    <article className={academicPanel}>
      <AcademicEventSummary event={event} source={source} now={now} />
      {event.manuallyEdited ? (
        <p className="mt-2 text-xs text-amber-100">
          Есть сохранённая ручная правка.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={academicButton}
          disabled={busy}
          onClick={onEdit}
        >
          Править событие
        </button>
        {event.status === "proposed" ? (
          <button
            type="button"
            className={academicButton}
            disabled={busy}
            onClick={() => onDecision("confirm")}
          >
            Проверить и подтвердить
          </button>
        ) : null}
        {event.status !== "cancelled" ? (
          <button
            type="button"
            className={academicButton}
            disabled={busy}
            onClick={() => onDecision("cancel")}
          >
            Отменить событие
          </button>
        ) : null}
      </div>
    </article>
  );
}
