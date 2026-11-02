import type {
  IdealHumanDay,
  IdealHumanFootage,
} from "../../../../../packages/core/src/ideal-human.js";
import { TextField, ChoiceField, buttonClass, inputClass } from "./Fields";
import type { ChangeDay } from "./JournalSections";
const localValue = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function VideoAssets({
  day,
  change,
}: {
  day: IdealHumanDay;
  change: ChangeDay;
}) {
  const entries = day.footage ?? [];
  const update = (index: number, patch: Partial<IdealHumanFootage>) =>
    change(
      "footage",
      entries.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  return (
    <div className="space-y-3 border-t border-white/[0.08] pt-4">
      <h3 className="font-semibold text-zinc-100">
        Каталог отснятого материала
      </h3>
      <p className="text-xs text-zinc-400">
        Записывай существующие кадры и их местоположение по своему выбору. Видео
        остаётся у тебя. Резервную копию здесь подтверждаешь ты; автоматической
        проверки файлов нет.
      </p>
      {entries.map((entry, index) => (
        <details
          key={entry.id}
          className="rounded-lg border border-white/[0.08] p-3"
          open={!entry.label}
        >
          <summary className="min-h-11 cursor-pointer break-words text-sm font-medium text-zinc-100">
            {entry.label || `Материал ${index + 1}`} ·{" "}
            {entry.backupStatus === "user_confirmed"
              ? "копия подтверждена тобой"
              : "копия не подтверждена"}
          </summary>
          <div className="space-y-3">
            <TextField
              title={`Материал ${index + 1}: название`}
              value={entry.label}
              maxLength={240}
              onChange={(label) => update(index, { label })}
            />
            <ChoiceField
              title="Тип материала"
              value={entry.kind}
              choices={[
                { value: "a_roll", label: "A-roll · речь в камеру" },
                { value: "b_roll", label: "B-roll · детали и события" },
                { value: "reflection", label: "Личная рефлексия" },
                { value: "other", label: "Другое" },
              ]}
              onChange={(kind) => update(index, { kind: kind ?? "other" })}
            />
            <label className="block text-xs text-zinc-300">
              Фактическое время съёмки (время телефона, если известно)
              <input
                className={inputClass}
                type="datetime-local"
                value={localValue(entry.capturedAt)}
                onChange={(e) =>
                  update(index, {
                    capturedAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </label>
            <TextField
              title="Имя исходного файла (если известно)"
              value={entry.filename}
              maxLength={240}
              onChange={(filename) => update(index, { filename })}
            />
            <TextField
              title="Где хранится файл (по желанию)"
              value={entry.location}
              maxLength={1000}
              onChange={(location) => update(index, { location })}
            />
            <TextField
              title="Заметка к материалу"
              value={entry.notes}
              multiline
              maxLength={2000}
              onChange={(notes) => update(index, { notes })}
            />
            <TextField
              title="Место в истории / запоминающийся момент"
              value={entry.storyBeat}
              multiline
              maxLength={1000}
              onChange={(storyBeat) => update(index, { storyBeat })}
            />
            <ChoiceField
              title="Копия этого материала"
              value={entry.backupStatus}
              choices={[
                { value: "not_backed_up", label: "Не подтверждена" },
                { value: "user_confirmed", label: "Скопировал и проверил сам" },
              ]}
              onChange={(backupStatus) =>
                update(index, { backupStatus: backupStatus ?? "not_backed_up" })
              }
            />
            <ChoiceField
              title="Монтаж материала"
              value={entry.editingStatus}
              choices={[
                { value: "not_started", label: "Не начинал" },
                { value: "in_progress", label: "В процессе" },
                { value: "done", label: "Готово" },
              ]}
              onChange={(editingStatus) =>
                update(index, { editingStatus: editingStatus ?? "not_started" })
              }
            />
            <button
              type="button"
              className={`${buttonClass} w-full`}
              onClick={() => {
                if (
                  window.confirm(
                    "Убрать запись материала из дневника? Сам видеофайл останется на месте.",
                  )
                )
                  change(
                    "footage",
                    entries.filter((_, i) => i !== index),
                  );
              }}
            >
              Убрать запись материала
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        className={`${buttonClass} w-full`}
        disabled={entries.length >= 80}
        onClick={() =>
          change("footage", [
            ...entries,
            {
              id: crypto.randomUUID(),
              label: "",
              kind: "a_roll",
              capturedAt: null,
              filename: "",
              location: "",
              notes: "",
              backupStatus: "not_backed_up",
              editingStatus: "not_started",
              storyBeat: "",
            },
          ])
        }
      >
        Добавить отснятый материал
      </button>
      <TextField
        title="План истории / раскадровка (черновик)"
        value={day.storyboard ?? ""}
        multiline
        maxLength={4000}
        onChange={(value) => change("storyboard", value)}
      />
      <p className="text-xs text-zinc-400">
        Каталог и раскадровка включаются в полный JSON-экспорт дневника для
        подготовки монтажа в DaVinci Resolve.
      </p>
    </div>
  );
}
