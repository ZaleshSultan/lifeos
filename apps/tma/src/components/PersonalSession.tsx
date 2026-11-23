import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  countedTotals,
  loadLabels,
  volumeCaption,
  type DraftChange,
  type LoadMode,
} from "@lifeos/core/personal-workout";
import {
  personalApi,
  personalKey,
  readDraft,
  writeDraft,
} from "../api/personal-workout";
import { queryKeys } from "../api/hooks";
import {
  workoutErrorMessage,
  type WorkoutSession,
  type RecordedWorkoutSet,
} from "../api/workout";
import { telegram } from "../telegram";
import {
  workoutButtonClass as button,
  workoutInputClass as input,
  workoutPanelClass as panel,
} from "./WorkoutSetFields";

const fmt = (n: number) => n.toLocaleString("ru-RU");
export function deltaText(kg: number, reps: number, mode: LoadMode) {
  const sign = (n: number) => (n > 0 ? "+" : "") + fmt(n);
  return (
    "Вес " +
    sign(kg) +
    " кг" +
    (mode === "dumbbells" ? " на гантель" : "") +
    " · повторы " +
    sign(reps)
  );
}
export function WorkoutTotals({ session }: { session: WorkoutSession }) {
  const t = countedTotals(session.exercises);
  return (
    <div>
      <p className="font-semibold text-cyan-200">
        {t.sets} подх. · {t.reps} повт. · {fmt(t.volumeKg)} кг
      </p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {volumeCaption}
      </p>
    </div>
  );
}
type Form = { weight: string; reps: string; warmup: boolean };
type Command = DraftChange & { revision: number; requestId: string };
interface LocalState {
  exercise?: string;
  set?: string;
  fields: Record<string, Form>;
  note?: string;
  pending?: Command;
}
const empty: LocalState = { fields: {} };
function fromSet(s: RecordedWorkoutSet): Form {
  return {
    weight: String(s.targetWeightKg ?? 0),
    reps: String(s.targetReps ?? 1),
    warmup: s.plan?.warmup ?? false,
  };
}
function decimal(s: string) {
  return /^\d+(?:[.,]\d{1,2})?$/.test(s.trim())
    ? Number(s.replace(",", "."))
    : NaN;
}
function Stepper({
  label,
  text,
  step,
  max,
  integer,
  set,
}: {
  label: string;
  text: string;
  step: number;
  max: number;
  integer?: boolean;
  set: (s: string) => void;
}) {
  function bump(direction: number) {
    const n = decimal(text);
    set(
      String(
        Math.max(
          integer ? 1 : 0,
          Math.min(
            max,
            Math.round(
              ((Number.isFinite(n) ? n : 0) + direction * step) * 100,
            ) / 100,
          ),
        ),
      ),
    );
  }
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-xs text-zinc-400">
        {label}
        <input
          className={
            input + " mt-1 text-center text-xl font-semibold tabular-nums"
          }
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          onChange={(e) => set(e.target.value)}
          maxLength={8}
        />
      </label>
      <div className="grid grid-cols-2 gap-1">
        <button
          className={button}
          aria-label={label + " уменьшить"}
          onClick={() => bump(-1)}
        >
          −
        </button>
        <button
          className={button}
          aria-label={label + " + шаг"}
          onClick={() => bump(1)}
        >
          +{fmt(step)}
        </button>
      </div>
    </div>
  );
}

export function PersonalSession({
  session,
  account,
  onFinish,
}: {
  session: WorkoutSession;
  account: number;
  onFinish: (s: WorkoutSession) => void;
}) {
  const client = useQueryClient();
  const key = "lifeos:full-body:" + account + ":" + session.id;
  const [local, setLocal] = useState<LocalState>(() => readDraft(key, empty));
  const [durable, setDurable] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [stepInput, setStepInput] = useState<string | null>(null);
  function persist(next: LocalState) {
    setLocal(next);
    setDurable(writeDraft(key, next));
  }
  const ex =
    session.exercises.find((e) => e.id === local.exercise) ??
    session.exercises.find((e) => e.sets.some((s) => !s.completed)) ??
    session.exercises[0];
  const load = ex.load!;
  const s =
    ex.sets.find((s) => s.id === local.set) ??
    ex.sets.find((s) => !s.completed) ??
    ex.sets[0];
  const form = s && (local.fields[s.id] ?? fromSet(s));
  const prev =
    s &&
    load.previous.find(
      (p) => p.slot === s.plan?.slot && p.warmup === form.warmup,
    );
  const kg = form ? decimal(form.weight) : NaN,
    reps = form ? decimal(form.reps) : NaN;
  const valid =
    kg >= 0 &&
    kg <= 2000 &&
    reps >= 1 &&
    reps <= 1000 &&
    Number.isInteger(reps);
  function edit(p: Partial<Form>) {
    persist({
      ...local,
      fields: { ...local.fields, [s.id]: { ...form, ...p } },
    });
    setError("");
  }
  const save = useMutation({
    mutationFn: (cmd: Command) => personalApi.change(session.id, cmd),
    networkMode: "always",
    onSuccess: (fresh, cmd) => {
      const next = {
        ...local,
        pending: undefined,
        fields: { ...local.fields },
      };
      if (cmd.kind === "set" || cmd.kind === "remove")
        delete next.fields[cmd.id];
      if (cmd.kind === "note") delete next.note;
      if (cmd.kind === "step") {
        setStepInput(null);
        void client.invalidateQueries({ queryKey: personalKey });
      }
      if (cmd.kind === "add") next.set = cmd.id;
      if (cmd.kind === "set" && cmd.completed) {
        const current = fresh.exercises.find((e) => e.id === ex.id)!;
        const unfinished = current.sets.find((x) => !x.completed);
        if (unfinished) next.set = unfinished.id;
        else {
          const following = fresh.exercises.find((e) =>
            e.sets.some((x) => !x.completed),
          );
          if (following) {
            next.exercise = following.id;
            next.set = undefined;
          }
        }
      }
      if (fresh.mode === "completed") {
        writeDraft(key, null);
        onFinish(fresh);
      } else {
        persist(next);
        client.setQueryData(queryKeys.workout, fresh);
      }
      telegram.hapticImpact("light");
      setError("");
    },
    onError: (e) => setError(workoutErrorMessage(e)),
  });
  function send(change: DraftChange) {
    if (local.pending || save.isPending) return;
    const cmd = {
      ...change,
      revision: session.personalRevision!,
      requestId: crypto.randomUUID(),
    };
    persist({ ...local, pending: cmd });
    setError("");
    save.mutate(cmd);
  }
  const dirty =
    Object.keys(local.fields).length > 0 || local.note !== undefined;
  const pending = Boolean(local.pending);
  const blocked = save.isPending || pending;
  const storeSet = (completed: boolean) => {
    if (valid)
      send({
        kind: "set",
        id: s.id,
        weightKg: kg,
        reps,
        warmup: form.warmup,
        completed,
      });
  };
  return (
    <div className="space-y-3">
      <section className={panel + " space-y-2"}>
        <h2 className="text-xl font-semibold">{session.title}</h2>
        <p className="text-xs text-zinc-300">
          Выполнено {session.completedSets} из {session.totalSets} подходов
        </p>
        <progress
          className="w-full accent-cyan-300"
          max={Math.max(1, session.totalSets)}
          value={session.completedSets}
        />
        <WorkoutTotals session={session} />
      </section>
      <div role="status" className="px-1 text-sm text-zinc-300">
        {save.isPending
          ? "Отправляем…"
          : pending
            ? "Сервер ещё не подтвердил запись"
            : !durable
              ? "Память телефона недоступна. Сохрани изменения на сервере."
              : dirty
                ? "Черновик на этом устройстве"
                : "Сохранено на сервере"}
      </div>
      {(error || (pending && !save.isPending)) && (
        <div className={panel + " space-y-2"}>
          <p role="alert">
            {error || "Проверь сохранение последнего действия."}
          </p>
          <button
            className={button}
            disabled={save.isPending}
            onClick={() => local.pending && save.mutate(local.pending)}
          >
            Повторить отправку
          </button>
          <button
            className={button}
            disabled={save.isPending}
            onClick={async () => {
              try {
                await client.refetchQueries(
                  { queryKey: queryKeys.workout },
                  { throwOnError: true },
                );
                persist({ ...local, pending: undefined });
                setError("");
              } catch {
                setError("Не удалось обновить данные.");
              }
            }}
          >
            Сверить с сервером
          </button>
        </div>
      )}
      <fieldset disabled={blocked} className={panel + " space-y-3"}>
        <label className="block text-xs text-zinc-400">
          Упражнение
          <select
            className={input + " mt-1"}
            aria-label="Упражнение"
            value={ex.id}
            onChange={(e) => {
              setStepInput(null);
              persist({ ...local, exercise: e.target.value, set: undefined });
            }}
          >
            {session.exercises.map((e, i) => (
              <option value={e.id} key={e.id}>
                {i + 1}. {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-zinc-300">
          {loadLabels[load.mode]}
          {load.variant ? " · " + load.variant : ""}
          {load.baseKg !== null
            ? " · " +
              (load.mode === "smith" ? "Гриф" : "Платформа") +
              " " +
              fmt(load.baseKg) +
              " кг"
            : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {ex.sets.map((x, i) => (
            <button
              key={x.id}
              aria-label={"Подход " + (i + 1)}
              aria-pressed={x.id === s?.id}
              className={
                button +
                (x.id === s?.id ? " border-cyan-300 text-cyan-200" : "")
              }
              onClick={() => persist({ ...local, exercise: ex.id, set: x.id })}
            >
              {x.completed ? "✓ " : ""}
              {i + 1}
              {local.fields[x.id] ? "*" : ""}
            </button>
          ))}
        </div>
        {s && (
          <>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Подход {ex.sets.indexOf(s) + 1}</h3>
              <span className="text-xs text-zinc-400">
                {s.completed ? "Выполнен" : "По плану"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stepper
                label={load.mode === "dumbbells" ? "Кг на гантель" : "Вес, кг"}
                text={form.weight}
                max={2000}
                step={load.step}
                set={(weight) => edit({ weight })}
              />
              <Stepper
                label="Повторения"
                text={form.reps}
                max={1000}
                step={1}
                integer
                set={(reps) => edit({ reps })}
              />
            </div>
            {load.mode === "dumbbells" && Number.isFinite(kg) && (
              <p className="text-xs text-zinc-300">
                {fmt(kg)} кг на гантель · 2 гантели
              </p>
            )}
            {prev && (
              <div className="rounded-lg bg-white/5 p-3 text-sm">
                <p>
                  В прошлый раз: {fmt(prev.weightKg)} кг × {prev.reps}
                </p>
                {valid && (
                  <p className="mt-1 text-cyan-200">
                    {deltaText(kg - prev.weightKg, reps - prev.reps, load.mode)}
                  </p>
                )}
                <button
                  className={button + " mt-2"}
                  onClick={() =>
                    edit({
                      weight: String(prev.weightKg),
                      reps: String(prev.reps),
                    })
                  }
                >
                  Повторить прошлый результат
                </button>
              </div>
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.warmup}
                onChange={(e) => edit({ warmup: e.target.checked })}
              />
              Разминочный подход
            </label>
            {!valid && (
              <p role="alert" className="text-sm text-amber-200">
                Вес от 0 до 2000 кг, до двух знаков после запятой. Повторения от
                1 до 1000.
              </p>
            )}
            <button
              className={button + " w-full bg-cyan-300 text-graphite-950"}
              disabled={!valid}
              onClick={() => storeSet(true)}
            >
              {s.completed ? "Сохранить исправление" : "Выполнено"}
            </button>
            <div className="flex flex-wrap gap-2">
              {s.completed ? (
                <button
                  className={button}
                  onClick={() => storeSet(false)}
                  disabled={!valid}
                >
                  Снять отметку
                </button>
              ) : (
                <button
                  className={button}
                  disabled={!valid}
                  onClick={() => storeSet(false)}
                >
                  Сохранить план
                </button>
              )}
              <button
                className={button}
                onClick={() => send({ kind: "remove", id: s.id })}
              >
                Убрать подход
              </button>
            </div>
          </>
        )}
        <button
          className={button}
          disabled={ex.sets.length >= 30}
          onClick={() =>
            send({
              kind: "add",
              id: crypto.randomUUID(),
              exercise: ex.id,
              weightKg: s?.targetWeightKg ?? 0,
              reps: s?.targetReps ?? 12,
              warmup: false,
            })
          }
        >
          Добавить подход
        </button>
        <details>
          <summary className="min-h-11 cursor-pointer text-sm text-zinc-300">
            Шаг веса · {fmt(load.step)} кг
          </summary>
          <label className="block text-sm">
            Новый шаг, кг
            <input
              className={input}
              inputMode="decimal"
              value={stepInput ?? String(load.step)}
              onChange={(e) => setStepInput(e.target.value)}
            />
          </label>
          <button
            className={button + " mt-2"}
            disabled={
              !(
                decimal(stepInput ?? "") > 0 && decimal(stepInput ?? "") <= 2000
              )
            }
            onClick={() =>
              send({ kind: "step", exercise: ex.id, step: decimal(stepInput!) })
            }
          >
            Сохранить шаг
          </button>
        </details>
        {!!load.previous.length && (
          <details>
            <summary className="min-h-11 cursor-pointer text-sm text-zinc-300">
              Последние результаты по подходам
            </summary>
            {load.previous.map((p) => (
              <div key={p.slot + ":" + p.warmup} className="text-sm">
                {p.index}. {fmt(p.weightKg)} кг × {p.reps}
                {p.warmup ? " · разминка" : ""}
              </div>
            ))}
          </details>
        )}
      </fieldset>
      <fieldset disabled={blocked} className={panel + " space-y-2"}>
        <label className="block text-sm">
          Заметка к тренировке
          <input
            className={input}
            value={local.note ?? session.sessionNote ?? ""}
            maxLength={500}
            onChange={(e) => persist({ ...local, note: e.target.value })}
          />
        </label>
        {local.note !== undefined && (
          <button
            className={button}
            onClick={() => send({ kind: "note", text: local.note! })}
          >
            Сохранить заметку
          </button>
        )}
      </fieldset>
      {dirty && (
        <p className="text-xs text-zinc-300">
          Сохрани правки перед завершением. Изменённые подходы отмечены
          звёздочкой.
        </p>
      )}
      {confirm && (
        <p className="text-sm">
          Сохранить {session.completedSets} из {session.totalSets} подходов в
          историю?
        </p>
      )}
      <button
        className={button + " w-full bg-emerald-300 text-graphite-950"}
        disabled={blocked || dirty || !session.completedSets}
        onClick={() =>
          confirm || session.completedSets === session.totalSets
            ? send({ kind: "finish" })
            : setConfirm(true)
        }
      >
        {confirm ? "Сохранить тренировку" : "Завершить тренировку"}
      </button>
      {confirm && (
        <button
          className={button + " w-full"}
          onClick={() => setConfirm(false)}
        >
          Продолжить тренировку
        </button>
      )}
    </div>
  );
}
