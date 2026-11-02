import type { IdealHumanDay } from "../../../../../packages/core/src/ideal-human.js";
import {
  ChoiceField,
  Fold,
  NumberField,
  ObservationField,
  TextField,
  buttonClass,
} from "./Fields";

export type ChangeDay = <K extends keyof IdealHumanDay>(
  key: K,
  value: IdealHumanDay[K],
) => void;
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function DayPlan({
  day,
  change,
}: {
  day: IdealHumanDay;
  change: ChangeDay;
}) {
  const update = (
    index: number,
    patch: Partial<IdealHumanDay["plan"][number]>,
  ) =>
    change(
      "plan",
      day.plan.map((block, i) =>
        i === index ? { ...block, ...patch } : block,
      ),
    );
  const completion = day.plan.flatMap((block) => block.tasks);
  const marked = completion.filter((task) => task.completed !== null);
  return (
    <Fold
      title="План и привычки"
      open
      detail="Гибкие блоки по порядку. Время можно добавить, когда оно известно."
    >
      <p className="text-xs text-zinc-400">
        Выполнено {marked.filter((task) => task.completed).length} из{" "}
        {marked.length} отмеченных задач; без оценки:{" "}
        {completion.length - marked.length}. Отдых и общение — часть дня.
      </p>
      {day.plan.map((block, index) => (
        <article
          key={block.id}
          className="space-y-3 rounded-lg border border-white/[0.08] p-3"
        >
          <div className="flex items-start gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-400/10 text-xs text-cyan-200">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-sm font-semibold text-zinc-100">
                {block.title}
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                {block.time ?? "Гибкое время"} ·{" "}
                {block.tasks.filter((task) => task.completed === true).length}{" "}
                выполнено ·{" "}
                {block.tasks.filter((task) => task.completed === null).length}{" "}
                без оценки
              </p>
            </div>
          </div>
          {block.notes ? (
            <p className="text-xs leading-relaxed text-zinc-400">
              {block.notes}
            </p>
          ) : null}
          <details>
            <summary className="min-h-11 cursor-pointer text-sm font-medium text-cyan-200">
              Задачи и редактирование: {block.title}
            </summary>
            <div className="space-y-3">
              <TextField
                title="Название блока"
                value={block.title}
                maxLength={160}
                onChange={(title) => update(index, { title })}
              />
              <TextField
                title="Время, если известно"
                type="time"
                value={block.time ?? ""}
                onChange={(time) => update(index, { time: time || null })}
              />
              <TextField
                title="Заметка к блоку"
                value={block.notes}
                multiline
                maxLength={1000}
                onChange={(notes) => update(index, { notes })}
              />
              <ChoiceField
                title="Тип блока"
                value={block.kind}
                choices={[
                  { value: "morning", label: "Утро" },
                  { value: "university", label: "Университет" },
                  { value: "gym", label: "Тренировка" },
                  { value: "social", label: "Общение / отдых" },
                  { value: "evening", label: "Вечер" },
                  { value: "flexible", label: "Свободное время" },
                ]}
                onChange={(kind) => update(index, { kind: kind ?? "flexible" })}
              />
              {block.tasks.map((task, taskIndex) => (
                <div key={task.id} className="rounded-lg bg-white/[0.03] p-2.5">
                  <TextField
                    title={`Задача ${taskIndex + 1}`}
                    value={task.title}
                    maxLength={240}
                    onChange={(title) =>
                      update(index, {
                        tasks: block.tasks.map((item, i) =>
                          i === taskIndex ? { ...item, title } : item,
                        ),
                      })
                    }
                  />
                  <div className="mt-2">
                    <ObservationField
                      title={`Статус: ${task.title}`}
                      value={task.completed}
                      yes="Выполнено"
                      no="Не выполнено / изменил план"
                      onChange={(completed) =>
                        update(index, {
                          tasks: block.tasks.map((item, i) =>
                            i === taskIndex ? { ...item, completed } : item,
                          ),
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className={`${buttonClass} mt-2 w-full text-xs`}
                    onClick={() =>
                      update(index, {
                        tasks: block.tasks.filter((_, i) => i !== taskIndex),
                      })
                    }
                  >
                    Убрать задачу из плана
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={`${buttonClass} w-full`}
                disabled={block.tasks.length >= 16}
                onClick={() =>
                  update(index, {
                    tasks: [
                      ...block.tasks,
                      { id: newId(), title: "Новая задача", completed: null },
                    ],
                  })
                }
              >
                Добавить задачу
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index === 0}
                  onClick={() => {
                    const plan = [...day.plan];
                    [plan[index - 1], plan[index]] = [
                      plan[index],
                      plan[index - 1],
                    ];
                    change("plan", plan);
                  }}
                >
                  Выше
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index === day.plan.length - 1}
                  onClick={() => {
                    const plan = [...day.plan];
                    [plan[index + 1], plan[index]] = [
                      plan[index],
                      plan[index + 1],
                    ];
                    change("plan", plan);
                  }}
                >
                  Ниже
                </button>
              </div>
              <button
                type="button"
                className={`${buttonClass} w-full text-xs`}
                onClick={() =>
                  change(
                    "plan",
                    day.plan.filter((_, i) => i !== index),
                  )
                }
              >
                Убрать блок из плана
              </button>
            </div>
          </details>
        </article>
      ))}
      <button
        type="button"
        className={`${buttonClass} w-full`}
        disabled={day.plan.length >= 12}
        onClick={() =>
          change("plan", [
            ...day.plan,
            {
              id: newId(),
              title: "Гибкий блок",
              notes: "",
              time: null,
              kind: "flexible",
              tasks: [],
            },
          ])
        }
      >
        Добавить блок
      </button>
    </Fold>
  );
}

export function NutritionJournal({
  day,
  change,
}: {
  day: IdealHumanDay;
  change: ChangeDay;
}) {
  const update = (
    index: number,
    patch: Partial<IdealHumanDay["meals"][number]>,
  ) =>
    change(
      "meals",
      day.meals.map((meal, i) => (i === index ? { ...meal, ...patch } : meal)),
    );
  const calories = day.meals.filter((meal) => meal.caloriesKcal !== null);
  const protein = day.meals.filter((meal) => meal.proteinG !== null);
  return (
    <Fold
      title="Питание"
      detail={
        day.meals.length
          ? `${day.meals.length} записей о еде`
          : "Ручной дневник. Количество и состав можно оценивать приблизительно."
      }
    >
      <p className="text-xs leading-relaxed text-zinc-400">
        Регулярные приёмы пищи и спокойное наблюдение за самочувствием. Числа
        необязательны; неизвестное оставь пустым.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          title="Итог дня, ккал (оценка)"
          max={10000}
          value={day.caloriesKcal}
          onChange={(value) => change("caloriesKcal", value)}
        />
        <NumberField
          title="Итог дня, белок, г (оценка)"
          max={400}
          step={0.1}
          value={day.proteinG}
          onChange={(value) => change("proteinG", value)}
        />
      </div>
      {day.meals.map((meal, index) => (
        <article
          key={meal.id}
          className="space-y-3 rounded-lg border border-white/[0.08] p-3"
        >
          <TextField
            title={`Приём пищи ${index + 1}: что ел`}
            value={meal.label}
            maxLength={240}
            onChange={(label) => update(index, { label })}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              title={`Блюдо ${index + 1}, ккал`}
              max={10000}
              value={meal.caloriesKcal}
              onChange={(caloriesKcal) => update(index, { caloriesKcal })}
            />
            <NumberField
              title={`Блюдо ${index + 1}, белок, г`}
              max={400}
              step={0.1}
              value={meal.proteinG}
              onChange={(proteinG) => update(index, { proteinG })}
            />
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="h-5 w-5 accent-cyan-400"
              checked={meal.estimated}
              onChange={(e) => update(index, { estimated: e.target.checked })}
            />
            Приблизительная оценка
          </label>
          <button
            type="button"
            className={`${buttonClass} w-full text-xs`}
            onClick={() =>
              change(
                "meals",
                day.meals.filter((_, i) => i !== index),
              )
            }
          >
            Убрать приём пищи
          </button>
        </article>
      ))}
      <button
        type="button"
        className={`${buttonClass} w-full`}
        disabled={day.meals.length >= 20}
        onClick={() =>
          change("meals", [
            ...day.meals,
            {
              id: newId(),
              label: "",
              caloriesKcal: null,
              proteinG: null,
              estimated: true,
            },
          ])
        }
      >
        Добавить приём пищи
      </button>
      {day.meals.length > 0 ? (
        <p className="text-xs text-zinc-400">
          Сумма только внесённых блюд:{" "}
          {calories.length
            ? `${calories.reduce((sum, meal) => sum + meal.caloriesKcal!, 0)} ккал`
            : "ккал неизвестны"}
          ;{" "}
          {protein.length
            ? `${protein.reduce((sum, meal) => sum + meal.proteinG!, 0).toFixed(1)} г белка`
            : "белок неизвестен"}
          . Это может быть неполный день. Итог дня учитывается отдельно, без
          сложения с блюдами.
        </p>
      ) : null}
    </Fold>
  );
}

const categories = [
  { value: "programming", label: "Программирование" },
  { value: "english", label: "Английский" },
  { value: "cybersecurity", label: "Кибербезопасность" },
  { value: "science", label: "Наука / нейробиология" },
  { value: "other", label: "Другая тема" },
] as const;

export function LearningJournal({
  day,
  change,
}: {
  day: IdealHumanDay;
  change: ChangeDay;
}) {
  const update = (
    index: number,
    patch: Partial<IdealHumanDay["learningSessions"][number]>,
  ) =>
    change(
      "learningSessions",
      day.learningSessions.map((session, i) =>
        i === index ? { ...session, ...patch } : session,
      ),
    );
  return (
    <Fold
      title="Интеллект и обучение"
      detail={
        day.learningSessions.length
          ? `${day.learningSessions.length} учебных сессий`
          : "Короткая сессия по возможностям дня."
      }
    >
      <TextField
        title="Учебные приоритеты на сегодня"
        multiline
        value={day.studyPriorities}
        onChange={(value) => change("studyPriorities", value)}
      />
      {day.learningSessions.map((session, index) => (
        <article
          key={session.id}
          className="space-y-3 rounded-lg border border-white/[0.08] p-3"
        >
          <ChoiceField
            title={`Категория сессии ${index + 1}`}
            value={session.category}
            choices={categories}
            onChange={(category) =>
              update(index, { category: category ?? "other" })
            }
          />
          <TextField
            title={`Тема сессии ${index + 1}`}
            value={session.topic}
            maxLength={160}
            onChange={(topic) => update(index, { topic })}
          />
          <NumberField
            title={`Сессия ${index + 1}, минут`}
            value={session.minutes}
            max={900}
            onChange={(minutes) => update(index, { minutes })}
          />
          <TextField
            title="Ресурс (название или ссылка)"
            value={session.resource}
            maxLength={1000}
            onChange={(resource) => update(index, { resource })}
          />
          <TextField
            title="Заметки по теме"
            multiline
            value={session.notes}
            maxLength={1500}
            onChange={(notes) => update(index, { notes })}
          />
          <ObservationField
            title="Сессия завершена"
            value={session.completed}
            onChange={(completed) => update(index, { completed })}
          />
          <button
            type="button"
            className={`${buttonClass} w-full text-xs`}
            onClick={() =>
              change(
                "learningSessions",
                day.learningSessions.filter((_, i) => i !== index),
              )
            }
          >
            Убрать сессию
          </button>
        </article>
      ))}
      <button
        type="button"
        className={`${buttonClass} w-full`}
        disabled={day.learningSessions.length >= 20}
        onClick={() =>
          change("learningSessions", [
            ...day.learningSessions,
            {
              id: newId(),
              category: "science",
              topic: "",
              minutes: null,
              resource: "",
              notes: "",
              completed: null,
            },
          ])
        }
      >
        Добавить учебную сессию
      </button>
      {day.scienceMinutes !== null ||
      day.englishMinutes !== null ||
      day.codingMinutes !== null ||
      day.scienceTopic ||
      day.scienceTakeaway ? (
        <details className="rounded-lg border border-white/[0.08] p-3">
          <summary className="min-h-11 cursor-pointer text-sm text-zinc-300">
            Ранее внесённые учебные итоги
          </summary>
          <p className="mb-3 text-xs text-zinc-400">
            Старые итоги сохранены. Не дублируй те же минуты в новых сессиях.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                title="Наука, минут (ранее)"
                value={day.scienceMinutes}
                max={900}
                onChange={(value) => change("scienceMinutes", value)}
              />
              <NumberField
                title="Английский, минут (ранее)"
                value={day.englishMinutes}
                max={900}
                onChange={(value) => change("englishMinutes", value)}
              />
              <NumberField
                title="Код, минут (ранее)"
                value={day.codingMinutes}
                max={900}
                onChange={(value) => change("codingMinutes", value)}
              />
            </div>
            <TextField
              title="Научная тема (ранее)"
              value={day.scienceTopic}
              maxLength={160}
              onChange={(value) => change("scienceTopic", value)}
            />
            <TextField
              title="Что понял (ранее)"
              multiline
              value={day.scienceTakeaway}
              maxLength={1500}
              onChange={(value) => change("scienceTakeaway", value)}
            />
          </div>
        </details>
      ) : null}
    </Fold>
  );
}

export function VideoJournal({
  day,
  change,
}: {
  day: IdealHumanDay;
  change: ChangeDay;
}) {
  return (
    <Fold
      title="Документальный фильм"
      detail="Galaxy S23+ · монтаж в DaVinci Resolve · файлы остаются у тебя."
    >
      <div className="grid grid-cols-2 gap-3">
        <ObservationField
          title="Материал снят"
          value={day.footageCaptured}
          onChange={(value) => change("footageCaptured", value)}
        />
        <NumberField
          title="Съёмка, минут"
          max={900}
          value={day.filmingMinutes}
          onChange={(value) => change("filmingMinutes", value)}
        />
        <ObservationField
          title="A-roll: речь в камеру"
          value={day.aRoll}
          onChange={(value) => change("aRoll", value)}
        />
        <ObservationField
          title="B-roll: детали дня"
          value={day.bRoll}
          onChange={(value) => change("bRoll", value)}
        />
      </div>
      <TextField
        title="Короткое размышление для фильма"
        multiline
        value={day.videoReflection}
        maxLength={1500}
        onChange={(value) => change("videoReflection", value)}
      />
      <TextField
        title="Запоминающиеся события и кадры"
        multiline
        value={day.highlights}
        maxLength={500}
        onChange={(value) => change("highlights", value)}
      />
      <ObservationField
        title="Резервная копия проверена"
        value={day.footageBackedUp}
        yes="Да, копию открыл и проверил"
        no="Нет, ещё не проверял"
        onChange={(value) => change("footageBackedUp", value)}
      />
      <p className="text-xs text-zinc-400">
        Отметь «Да» только после реального копирования и проверки файлов. LifeOS
        не загружает видео и не проверяет копии автоматически.
      </p>
      <ChoiceField
        title="Монтаж"
        value={day.editingStatus}
        choices={[
          { value: "not_started", label: "Не начинал" },
          { value: "in_progress", label: "В процессе" },
          { value: "done", label: "Готово" },
        ]}
        onChange={(value) => change("editingStatus", value)}
      />
    </Fold>
  );
}

export function ReflectionJournal({
  day,
  change,
}: {
  day: IdealHumanDay;
  change: ChangeDay;
}) {
  return (
    <Fold
      title="Вечерняя рефлексия"
      detail="Достаточно нескольких честных строк. Все поля необязательны."
    >
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          title="Энергия, 1–5"
          min={1}
          max={5}
          value={day.energy}
          onChange={(value) => change("energy", value)}
        />
        <NumberField
          title="Настроение, 1–5"
          min={1}
          max={5}
          value={day.mood}
          onChange={(value) => change("mood", value)}
        />
      </div>
      <TextField
        title="Что получилось"
        multiline
        value={day.whatWorked}
        onChange={(value) => change("whatWorked", value)}
      />
      <TextField
        title="Что не получилось / что изменить"
        multiline
        value={day.whatDidNotWork}
        onChange={(value) => change("whatDidNotWork", value)}
      />
      <TextField
        title="План на завтра"
        multiline
        value={day.tomorrowPlan}
        onChange={(value) => change("tomorrowPlan", value)}
      />
      <TextField
        title="Личные заметки о дне"
        multiline
        value={day.notes}
        onChange={(value) => change("notes", value)}
      />
    </Fold>
  );
}
