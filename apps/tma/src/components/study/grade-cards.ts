import type { AcademicRecord } from "../../api/types";
import type { StudyWorkspaceCourse } from "../../api/study";
import { studyEvidenceBelongsToCourse } from "../../../../../packages/core/src/study-evidence.js";

type Points = { score: number | null; max: number | null };
type Item = Points & { id: string; title: string; demo?: boolean };
type Slot = "attendance" | "mid" | "end" | "final";

const registerSlots = new Map<string, Slot>([
  ["attendance", "attendance"],
  ["attendance attendance", "attendance"],
  ["register midterm", "mid"],
  ["register endterm", "end"],
  ["register final", "final"],
]);

// AITU Student Handbook, Grading System (astanait.edu.kz/wp-content/uploads/2020/04/aituhandbook.pdf).
const letters = [
  "F",
  "FX",
  "D",
  "D+",
  "C-",
  "C",
  "C+",
  "B-",
  "B",
  "B+",
  "A-",
  "A",
];
const thresholds = [0, 25, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : null;
}

export function gradePercent(points: Points | null) {
  if (
    !points ||
    points.score === null ||
    !points.max ||
    points.score > points.max
  )
    return null;
  return (points.score / points.max) * 100;
}

export function gradeLetter(total: Points | null) {
  const percent = gradePercent(total);
  if (percent === null) return null;
  return letters[thresholds.filter((min) => min <= percent).length - 1];
}

// Duplicate observations agree only if Moodle identifies the same item and value.
function consistent(items: Item[]): Item | null {
  const first = items[0];
  return first &&
    items.every(
      (item) =>
        item.id === first.id &&
        item.score === first.score &&
        item.max === first.max,
    )
    ? first
    : null;
}

function courseCard(
  records: AcademicRecord[],
  courses: StudyWorkspaceCourse[],
) {
  const first = records[0];
  const courseId = id(first.rawJson?.moodle_course_id);
  const [name, ...subtitle] = first.courseTitle
    .split("|")
    .map((part) => part.trim());
  const linked = courseId
    ? courses.filter((c) => c.externalCourseKey === "moodle:" + courseId)
    : [];
  const matches = linked.length
    ? linked
    : courses.filter(
        (c) =>
          !c.externalCourseKey?.startsWith("moodle:") &&
          studyEvidenceBelongsToCourse(first, c),
      );
  const teachers =
    matches.length === 1
      ? matches[0].schedules
          .map((s) => s.instructorName?.trim())
          .filter(Boolean)
      : [];
  const slots: Record<Slot, Item[]> = {
    attendance: [],
    mid: [],
    end: [],
    final: [],
  };
  const totals: Item[] = [];
  const registers: Item[] = [];
  const assignments: Item[] = [];
  for (const record of records) {
    const raw = record.rawJson;
    const visible = raw?._grade_visibility_unknown !== true;
    const demo = raw?._is_mocked === true;
    const itemId = id(raw?.moodle_item_id) ?? record.id;
    const item: Item = {
      id: itemId,
      title: record.title,
      score: visible ? number(record.score) : null,
      max: number(record.maxScore),
      demo,
    };
    const title = String(raw?.item_name ?? raw?.itemname ?? record.title)
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/^calculated grade /, "");
    const slot = registerSlots.get(title);
    const register =
      !raw?.moodle_module &&
      raw?.itemtype !== "mod" &&
      /^register(?:\s|\()/.test(title);
    if (register || slot === "attendance" || raw?.itemtype === "course")
      registers.push(item);
    else assignments.push(item);
    if (demo) continue;
    if (
      slot &&
      (slot === "attendance" ||
        (!raw?.moodle_module && raw?.itemtype !== "mod"))
    )
      slots[slot].push(item);
    if (!courseId || !record.sourceEventId || !id(raw?.moodle_item_id))
      continue;
    if (raw?.itemtype === "course") totals.push(item);
    if (!visible || !register) continue;
    const total = raw?.lifeos_course_total;
    if (
      !total ||
      typeof total !== "object" ||
      !("source" in total) ||
      total.source !== "moodle_course_total" ||
      !("moodle_course_id" in total) ||
      id(total.moodle_course_id) !== courseId ||
      !("moodle_item_id" in total)
    )
      continue;
    const totalId = id(total.moodle_item_id);
    if (totalId && totalId !== itemId)
      totals.push({
        id: totalId,
        title: "Course total",
        score: number("score" in total ? total.score : null),
        max: number("max_score" in total ? total.max_score : null),
      });
  }
  const total = consistent(totals);
  if (total && !registers.some((row) => row.id === total.id))
    registers.push(total);
  return {
    name: name || first.courseTitle,
    subtitle: subtitle.join(" · ") || [...new Set(teachers)].join(", "),
    total,
    rows: registers.length ? registers : assignments,
    assignments: registers.length ? assignments : [],
    attendance: gradePercent(consistent(slots.attendance)),
    mid: consistent(slots.mid),
    end: consistent(slots.end),
    final: consistent(slots.final),
  };
}

export function courseGradeCards(
  records: AcademicRecord[],
  courses: StudyWorkspaceCourse[],
) {
  const groups = new Map<string, AcademicRecord[]>();
  for (const record of records) {
    const moodleId = id(record.rawJson?.moodle_course_id);
    const key = moodleId ? "moodle:" + moodleId : "title:" + record.courseTitle;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  return [...groups]
    .map(([key, records]) => ({ key, ...courseCard(records, courses) }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key),
    );
}
