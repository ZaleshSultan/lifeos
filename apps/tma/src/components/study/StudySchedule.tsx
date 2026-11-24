"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { StudyWeekday, StudyWorkspaceCourse } from "../../api/study";
import { studyDateLabel, studyDays, studyWeekday } from "./model";
import {
  defaultSchedulePeriod,
  layoutScheduleDay,
  localScheduleDate,
  scheduleHourBounds,
  schedulePeriods,
} from "./schedule-grid-model";
import styles from "./StudySchedule.module.css";

const sessionLabels: Record<string, string> = {
  lecture: "Лекция",
  practice: "Практика",
  practical: "Практика",
  seminar: "Семинар",
  lab: "Лабораторная",
  laboratory: "Лабораторная",
};
const hues = [345, 271, 157, 216, 86, 13, 42, 240, 185, 324, 66, 200];

type Lesson = ReturnType<typeof layoutScheduleDay>[number];
type PeriodDates = Pick<StudyWorkspaceCourse, "startsOn" | "endsOn">;
type ScheduleView = "week" | "day";
const plurals = new Intl.PluralRules("ru");

function lessonCount(count: number) {
  const forms: Record<string, string> = { one: "пара", few: "пары" };
  return count + " " + (forms[plurals.select(count)] ?? "пар");
}

function dateRange({ startsOn, endsOn }: PeriodDates) {
  if (startsOn && endsOn)
    return studyDateLabel(startsOn) + " — " + studyDateLabel(endsOn);
  if (startsOn) return "С " + studyDateLabel(startsOn);
  if (endsOn) return "До " + studyDateLabel(endsOn);
  return "Без указанных дат";
}

function courseStyle(code: string): CSSProperties {
  let hash = 0;
  for (const letter of code)
    hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  return { "--course-hue": hues[hash % hues.length] } as CSSProperties;
}

function timeRange(lesson: Lesson) {
  return (
    lesson.schedule.startTime.slice(0, 5) +
    "–" +
    lesson.schedule.endTime.slice(0, 5)
  );
}

function sessionKind(lesson: Lesson) {
  const type = lesson.schedule.sessionType;
  return type ? (sessionLabels[type] ?? type) : "";
}

function compactRoom(room: string | null) {
  if (!room) return "";
  if (/^онлайн(?:\s|$)/iu.test(room)) return "Онлайн";
  return room.replace(/\s*\([^()]+\)\s*$/u, "").trim() || room;
}

function LessonDetails({
  lesson,
  onClose,
}: {
  lesson: Lesson;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  const { course, schedule } = lesson;
  const day = studyDays.find((item) => item.id === schedule.dayOfWeek)?.label;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={course.title}
      onClose={onClose}
    >
      <div className={styles.dialogContent} style={courseStyle(course.code)}>
        <p className={styles.detailTime}>
          {day} · {timeRange(lesson)}
        </p>
        <h3>{course.title}</h3>
        <dl className={styles.detailList}>
          {sessionKind(lesson) && (
            <>
              <dt>Вид занятия</dt>
              <dd>{sessionKind(lesson)}</dd>
            </>
          )}
          <dt>Место</dt>
          <dd>{schedule.room || "Не указано"}</dd>
          {schedule.instructorName && (
            <>
              <dt>Преподаватель</dt>
              <dd>{schedule.instructorName}</dd>
            </>
          )}
          <dt>Код курса</dt>
          <dd>{course.code}</dd>
          <dt>Период курса</dt>
          <dd>{dateRange(course)}</dd>
        </dl>
        <form method="dialog">
          <button className={styles.close} autoFocus>
            Закрыть
          </button>
        </form>
      </div>
    </dialog>
  );
}

function WeekBoard({
  courses,
  onLesson,
}: {
  courses: StudyWorkspaceCourse[];
  onLesson: (item: Lesson) => void;
}) {
  const days = studyDays
    .map((day) => ({ ...day, lessons: layoutScheduleDay(courses, day.id) }))
    .filter((day) => day.id !== "sunday" || day.lessons.length > 0);
  const { first, last } = scheduleHourBounds(courses);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const duration = (last - first) * 60;
  const boardStyle = {
    "--days": days.length,
    "--hours": hours.length - 1,
  } as CSSProperties;
  return (
    <div
      className={styles.scroll}
      tabIndex={0}
      role="region"
      aria-label="Недельная сетка расписания"
    >
      <div className={styles.board} style={boardStyle}>
        <div aria-hidden="true" className={styles.timeHead}>
          Время
        </div>
        {days.map((day) => (
          <div key={day.id} className={styles.dayHead}>
            <strong>{day.label}</strong>
            <span>{lessonCount(day.lessons.length)}</span>
          </div>
        ))}
        <div className={styles.timeAxis} aria-hidden="true">
          {hours.map((hour) => (
            <span
              key={hour}
              style={{ top: ((hour - first) * 100) / (last - first) + "%" }}
            >
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            className={styles.dayColumn}
            key={day.id}
            role="group"
            aria-label={day.label}
            data-empty={!day.lessons.length}
          >
            {day.lessons.map((lesson) => {
              const { course, schedule } = lesson;
              const meta = [sessionKind(lesson), compactRoom(schedule.room)]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={schedule.id}
                  className={styles.slot}
                  type="button"
                  style={{
                    ...courseStyle(course.code),
                    top: ((lesson.start - first * 60) * 100) / duration + "%",
                    height: `calc(${((lesson.end - lesson.start) * 100) / duration}% - 1px)`,
                    left: `calc(${(lesson.lane * 100) / lesson.laneCount}% + 2px)`,
                    width: `calc(${100 / lesson.laneCount}% - 4px)`,
                  }}
                  aria-haspopup="dialog"
                  aria-label={[
                    day.label,
                    timeRange(lesson),
                    course.title,
                    meta,
                    schedule.instructorName,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  title={[
                    course.title,
                    timeRange(lesson),
                    meta,
                    schedule.instructorName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => onLesson(lesson)}
                >
                  <span className={styles.time}>{timeRange(lesson)}</span>
                  <strong className={styles.title}>{course.title}</strong>
                  {meta && <span className={styles.meta}>{meta}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudySchedule({
  courses,
  timezone,
}: {
  courses: StudyWorkspaceCourse[];
  timezone: string;
}) {
  const root = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [preferredView, setPreferredView] = useState<ScheduleView | null>(null);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<StudyWeekday | null>(null);
  const [detail, setDetail] = useState<Lesson | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => setNarrow(node.clientWidth < 680);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const today = localScheduleDate(timezone);
  const periods = schedulePeriods(courses);
  const defaultKey = defaultSchedulePeriod(periods, today);
  const selected =
    periods.find((p) => p.key === periodKey) ??
    periods.find((p) => p.key === defaultKey);
  const current = selected?.courses ?? [];
  const view = preferredView ?? (narrow ? "day" : "week");
  const day =
    selectedDay ??
    (selected?.startsOn && selected.startsOn > today
      ? "monday"
      : studyWeekday(timezone));
  const dayName = studyDays.find((d) => d.id === day)?.label;
  const lessons = layoutScheduleDay(current, day);
  const count = current.reduce((sum, c) => sum + c.schedules.length, 0);
  const zoneLabel = ["Asia/Almaty", "Asia/Qyzylorda"].includes(timezone)
    ? "Время Астаны"
    : timezone;

  return (
    <section
      ref={root}
      className={styles.shell}
      aria-label="Расписание занятий"
    >
      <header className={styles.header}>
        <div>
          <h2>Расписание занятий</h2>
          <p>
            {count > 0 && <>{lessonCount(count)} в неделю · </>}
            {zoneLabel}
          </p>
        </div>
        {selected && (
          <label className={styles.period}>
            Учебный период
            <select
              value={selected.key}
              onChange={(event) => {
                setPeriodKey(event.target.value);
                setSelectedDay(null);
              }}
            >
              {periods.map((period) => (
                <option key={period.key} value={period.key}>
                  {dateRange(period)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {!count ? (
        <p className={styles.empty}>Расписание занятий пока не добавлено.</p>
      ) : (
        <>
          <div
            className={styles.switch}
            role="group"
            aria-label="Вид расписания"
          >
            <button
              type="button"
              aria-pressed={view === "week"}
              onClick={() => setPreferredView("week")}
            >
              Неделя
            </button>
            <button
              type="button"
              aria-pressed={view === "day"}
              onClick={() => setPreferredView("day")}
            >
              День
            </button>
          </div>
          {view === "week" ? (
            <WeekBoard courses={current} onLesson={setDetail} />
          ) : (
            <>
              <div
                className={styles.dayPicker}
                role="group"
                aria-label="День недели"
              >
                {studyDays.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.label}
                    aria-pressed={day === item.id}
                    onClick={() => setSelectedDay(item.id)}
                  >
                    {item.short}
                  </button>
                ))}
              </div>
              <h3 className={styles.dayTitle}>
                {dayName} <span>· {lessonCount(lessons.length)}</span>
              </h3>
              {!lessons.length ? (
                <p className={styles.empty}>В этот день пар нет.</p>
              ) : (
                <ol className={styles.agenda}>
                  {lessons.map((lesson) => (
                    <li key={lesson.schedule.id}>
                      <button
                        type="button"
                        style={courseStyle(lesson.course.code)}
                        onClick={() => setDetail(lesson)}
                        aria-haspopup="dialog"
                      >
                        <span className={styles.time}>{timeRange(lesson)}</span>
                        <strong>{lesson.course.title}</strong>
                        <span>
                          {[
                            sessionKind(lesson),
                            lesson.schedule.room || "Аудитория не указана",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {lesson.schedule.instructorName && (
                          <span>{lesson.schedule.instructorName}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </>
      )}
      {detail && (
        <LessonDetails lesson={detail} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}
