import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  loadLabels,
  parsePersonalTemplate,
  type LoadMode,
  type PersonalTemplate,
  type PlannedLift,
} from "@lifeos/core/personal-workout";
import {
  personalApi,
  personalKey,
  readDraft,
  writeDraft,
  type usePersonalTemplateQuery,
} from "../api/personal-workout";
import { workoutErrorMessage, type WorkoutSession } from "../api/workout";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/hooks";
import {
  workoutButtonClass as button,
  workoutInputClass as input,
  workoutPanelClass as panel,
} from "./WorkoutSetFields";
import { LoadingPanel, ErrorPanel } from "./AsyncState";

function Numeric({
  label,
  value,
  onChange,
  integer = false,
  optional = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  integer?: boolean;
  optional?: boolean;
}) {
  return (
    <label className="block text-xs text-zinc-300">
      {label}
      <input
        aria-label={label}
        className={input}
        inputMode={integer ? "numeric" : "decimal"}
        defaultValue={value ?? ""}
        placeholder={optional ? "Неизвестно" : ""}
        maxLength={8}
        onChange={(e) => {
          const v = e.target.value.trim().replace(",", ".");
          onChange(!v ? (optional ? null : NaN) : Number(v));
        }}
      />
    </label>
  );
}
function EditTemplate({
  template,
  saved,
  cancel,
  reload,
  onDirtyChange,
}: {
  template: PersonalTemplate;
  saved: (t: PersonalTemplate) => void;
  cancel: () => void;
  reload: () => Promise<PersonalTemplate | null>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(template));
  const [baseline, setBaseline] = useState(template);
  const [active, setActive] = useState(draft.exercises[0].key);
  const [error, setError] = useState("");
  const [reloading, setReloading] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const index = draft.exercises.findIndex((e) => e.key === active);
  const ex = draft.exercises[index];
  const change = (patch: Partial<PlannedLift>) =>
    setDraft({
      ...draft,
      exercises: draft.exercises.map((e) =>
        e.key === active ? { ...e, ...patch } : e,
      ),
    });
  const save = useMutation({
    mutationFn: personalApi.save,
    onSuccess: saved,
    networkMode: "always",
  });
  async function reloadSavedTemplate() {
    setReloading(true);
    try {
      const fresh = await reload();
      if (!fresh) throw new Error();
      setDraft(structuredClone(fresh));
      setBaseline(fresh);
      setActive(
        fresh.exercises.some((e) => e.key === active)
          ? active
          : fresh.exercises[0].key,
      );
      save.reset();
      setError("");
    } catch {
      setError(
        "Не удалось загрузить шаблон. Твои правки остались в редакторе.",
      );
    } finally {
      setReloading(false);
    }
  }
  function move(offset: number) {
    const list = [...draft.exercises];
    [list[index], list[index + offset]] = [list[index + offset], list[index]];
    setDraft({ ...draft, exercises: list });
  }
  return (
    <fieldset
      disabled={save.isPending || reloading}
      className={panel + " space-y-3"}
    >
      <h2 className="text-lg font-semibold">Редактор шаблона</h2>
      <select
        aria-label="Упражнение шаблона"
        className={input}
        value={active}
        onChange={(e) => setActive(e.target.value)}
      >
        {draft.exercises.map((e, i) => (
          <option key={e.key} value={e.key}>
            {i + 1}. {e.name}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!index} onClick={() => move(-1)}>
          Выше
        </button>
        <button
          className={button}
          disabled={index === draft.exercises.length - 1}
          onClick={() => move(1)}
        >
          Ниже
        </button>
        <button
          className={button}
          disabled={draft.exercises.length === 1}
          onClick={() => {
            const list = draft.exercises.filter((e) => e.key !== active);
            setDraft({ ...draft, exercises: list });
            setActive(list[0].key);
          }}
        >
          Удалить упражнение
        </button>
      </div>
      <div className="space-y-2" key={draft.revision + ":" + active}>
        <label className="block text-xs">
          Название
          <input
            className={input}
            value={ex.name}
            maxLength={120}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label className="block text-xs">
          Тренажёр или вариант
          <input
            className={input}
            placeholder="Например, блок у окна"
            value={ex.variant}
            maxLength={120}
            onChange={(e) => change({ variant: e.target.value })}
          />
        </label>
        <label className="block text-xs">
          Учёт веса
          <select
            className={input}
            value={ex.mode}
            onChange={(e) =>
              change({ mode: e.target.value as LoadMode, baseKg: null })
            }
          >
            {Object.entries(loadLabels).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <Numeric
          label="Шаг веса, кг"
          value={ex.step}
          onChange={(v) => change({ step: v! })}
        />
        {(ex.mode === "smith" || ex.mode === "sled") && (
          <Numeric
            key={ex.mode}
            label={
              ex.mode === "smith" ? "Масса грифа, кг" : "Масса платформы, кг"
            }
            value={ex.baseKg}
            optional
            onChange={(v) => change({ baseKg: v })}
          />
        )}
        {ex.sets.map((s, i) => {
          const update = (patch: Partial<typeof s>) =>
            change({
              sets: ex.sets.map((x) =>
                x.slot === s.slot ? { ...x, ...patch } : x,
              ),
            });
          return (
            <div key={s.slot} className="border-t border-white/10 pt-2">
              <div className="text-sm">Подход {i + 1}</div>
              <div className="grid grid-cols-2 gap-2">
                <Numeric
                  label="Вес, кг"
                  value={s.weightKg}
                  onChange={(v) => update({ weightKg: v! })}
                />
                <Numeric
                  label="Повторения"
                  value={s.reps}
                  integer
                  onChange={(v) => update({ reps: v! })}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={s.warmup}
                    onChange={(e) => update({ warmup: e.target.checked })}
                  />
                  Разминка
                </label>
                <button
                  className={button}
                  disabled={ex.sets.length === 1}
                  onClick={() =>
                    change({ sets: ex.sets.filter((x) => x.slot !== s.slot) })
                  }
                >
                  Убрать
                </button>
              </div>
            </div>
          );
        })}
        <button
          className={button}
          disabled={ex.sets.length >= 30}
          onClick={() =>
            change({
              sets: [
                ...ex.sets,
                { ...ex.sets.at(-1)!, slot: crypto.randomUUID() },
              ],
            })
          }
        >
          Добавить подход
        </button>
      </div>
      <button
        className={button}
        disabled={draft.exercises.length >= 30}
        onClick={() => {
          const key = crypto.randomUUID();
          setDraft({
            ...draft,
            exercises: [
              ...draft.exercises,
              {
                key,
                name: "Новое упражнение",
                mode: "stack",
                variant: "",
                baseKg: null,
                step: 1,
                sets: [{ slot: "s1", weightKg: 0, reps: 12, warmup: false }],
              },
            ],
          });
          setActive(key);
        }}
      >
        Добавить упражнение
      </button>
      {(error || save.isError) && (
        <p role="alert">{error || workoutErrorMessage(save.error)}</p>
      )}
      {save.error instanceof ApiError && save.error.status === 409 && (
        <button className={button} onClick={() => void reloadSavedTemplate()}>
          {reloading
            ? "Загружаем…"
            : "Отменить мои правки и загрузить актуальный шаблон"}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          className={button}
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Закрыть шаблон и отменить несохранённые правки?")
            )
              cancel();
          }}
        >
          Закрыть
        </button>
        <button
          className={button + " bg-cyan-300 text-graphite-950"}
          onClick={() => {
            try {
              const t = parsePersonalTemplate(draft);
              setError("");
              save.mutate(t);
            } catch {
              setError(
                "Проверь поля. Шаг должен быть больше нуля, повторения — целыми, вес — с точностью до сотых.",
              );
            }
          }}
        >
          {save.isPending ? "Сохраняем…" : "Сохранить шаблон"}
        </button>
      </div>
    </fieldset>
  );
}

export function PersonalTemplateCard({
  account,
  onStart,
  activeWorkoutTitle,
  resume,
  query,
  onDirtyChange,
  beforeStart,
}: {
  account: number;
  onStart: (s: WorkoutSession) => void;
  activeWorkoutTitle?: string;
  resume?: () => void;
  query: ReturnType<typeof usePersonalTemplateQuery>;
  onDirtyChange?: (dirty: boolean) => void;
  beforeStart?: () => boolean;
}) {
  const client = useQueryClient();
  const [edit, setEdit] = useState(false);
  const key = "lifeos:full-body:start:" + account;
  const start = useMutation({
    mutationFn: personalApi.start,
    networkMode: "always",
    onSuccess: (s) => {
      writeDraft(key, null);
      onStart(s);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409)
        void client.invalidateQueries({ queryKey: queryKeys.workout });
    },
  });
  if (query.isLoading) return <LoadingPanel title="Загружаем шаблон" />;
  if (query.isError && !query.data)
    return (
      <ErrorPanel
        title="Шаблон недоступен"
        detail={workoutErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return null;
  if (edit)
    return (
      <EditTemplate
        template={query.data}
        onDirtyChange={onDirtyChange}
        reload={async () =>
          (await query.refetch({ throwOnError: true })).data ?? null
        }
        saved={(t) => {
          client.setQueryData([...personalKey, account], t);
          setEdit(false);
        }}
        cancel={() => {
          setEdit(false);
          void query.refetch();
        }}
      />
    );
  const sets = query.data.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <section className={panel + " space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Мой Full Body</h2>
        <button className={button} onClick={() => setEdit(true)}>
          Настроить шаблон
        </button>
      </div>
      <p className="text-sm text-zinc-300">
        {query.data.exercises.length} упражнений · {sets} подходов по плану
      </p>
      {resume ? (
        <button
          className={button + " w-full bg-cyan-300 text-graphite-950"}
          onClick={resume}
        >
          Продолжить тренировку
        </button>
      ) : activeWorkoutTitle ? (
        <p className="text-sm text-amber-200">
          Сначала заверши тренировку «{activeWorkoutTitle}», чтобы начать «Мой
          Full Body».
        </p>
      ) : (
        <button
          className={button + " w-full bg-cyan-300 text-graphite-950"}
          disabled={start.isPending}
          onClick={() => {
            if (beforeStart && !beforeStart()) return;
            const id = readDraft<string>(key, "") || crypto.randomUUID();
            writeDraft(key, id);
            start.mutate(id);
          }}
        >
          {start.isPending ? "Открываем…" : "Начать тренировку"}
        </button>
      )}
      {start.isError && <p role="alert">{workoutErrorMessage(start.error)}</p>}
      <ol
        className="divide-y divide-white/10 text-sm"
        aria-label="Упражнения по порядку"
      >
        {query.data.exercises.map((e, i) => (
          <li key={e.key} className="py-2">
            <p className="font-semibold">
              {i + 1}. {e.name}
            </p>
            <p className="mt-0.5 text-zinc-200">
              {e.sets
                .map(
                  (s) =>
                    s.weightKg.toLocaleString("ru-RU") +
                    " кг × " +
                    s.reps +
                    (s.warmup ? " (разминка)" : ""),
                )
                .join(" · ")}
            </p>
            <p className="text-xs text-zinc-400">
              {loadLabels[e.mode]}
              {e.variant ? " · " + e.variant : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
