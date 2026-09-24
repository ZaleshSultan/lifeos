import type { AcademicRecord } from "../api/types";

export function AcademicGrades({ records }: { records: AcademicRecord[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-zinc-500">No grades synced yet.</p>;
  }
  const courses = new Map<string, AcademicRecord[]>();
  for (const record of records) {
    const items = courses.get(record.courseTitle) ?? [];
    items.push(record);
    courses.set(record.courseTitle, items);
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Latest synced grades. An ungraded item is not a zero.
      </p>
      {[...courses].map(([title, items]) => (
        <details
          key={title}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03]"
        >
          <summary className="min-h-11 cursor-pointer break-words px-3 py-3 text-sm font-semibold text-white">
            {title}{" "}
            <span className="font-normal text-zinc-400">({items.length})</span>
          </summary>
          <ul className="divide-y divide-white/[0.06] px-3 pb-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words text-zinc-300">
                  {item.title}
                  {item.rawJson?._is_mocked === true ? (
                    <span className="ml-2 text-xs text-amber-300">
                      Demo data
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right tabular-nums text-white">
                  {item.score === null
                    ? "Not graded"
                    : item.maxScore === null
                      ? item.score
                      : `${item.score} / ${item.maxScore}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
