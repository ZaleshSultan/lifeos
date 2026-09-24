import { BookOpen } from "lucide-react";
import type { AcademicRecord } from "../../api/types";
import { studyScoreLabel } from "./model";

export function StudyGrades({ records }: { records: AcademicRecord[] }) {
  const groups = new Map<string, AcademicRecord[]>();
  for (const record of records) {
    const items = groups.get(record.courseTitle) ?? [];
    items.push(record);
    groups.set(record.courseTitle, items);
  }
  return (
    <section className="space-y-3" aria-label="Оценки из Moodle">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <BookOpen className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          Оценки из Moodle
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {records.length} записей · {groups.size} курсов
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Здесь показаны последние синхронизированные данные. Задание без оценки
          не считается нулём. Значения калькулятора сохраняются отдельно.
        </p>
      </div>
      {!records.length ? (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400">
          Оценок пока нет. Подключи Moodle и запусти синхронизацию, затем обнови
          экран.
        </p>
      ) : null}
      {[...groups].map(([title, items]) => (
        <details
          key={title}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03]"
        >
          <summary className="min-h-11 cursor-pointer break-words rounded-xl p-4 text-sm font-semibold text-white hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            {title}{" "}
            <span className="font-normal text-zinc-400">({items.length})</span>
          </summary>
          <ul className="divide-y divide-white/[0.06] px-4 pb-2">
            {items.map((record) => (
              <li key={record.id} className="space-y-1 py-3">
                <p className="break-words text-sm text-zinc-300">
                  {record.title}
                </p>
                <p className="text-sm font-semibold tabular-nums text-white">
                  {record.score === null
                    ? "Ещё не оценено"
                    : record.maxScore === null
                      ? studyScoreLabel(record.score)
                      : `${studyScoreLabel(record.score)} / ${studyScoreLabel(record.maxScore)}`}
                </p>
                {record.rawJson?._is_mocked === true ? (
                  <p className="text-xs text-amber-300">
                    Демонстрационные данные
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
