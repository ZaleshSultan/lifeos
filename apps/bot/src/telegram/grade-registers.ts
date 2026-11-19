import type { AcademicRecord } from "@lifeos/db";

type Slot = "mid" | "end" | "final" | "total";
type CourseRegisters = { title: string; slots: Record<Slot, Map<string, string | null>> };

const officialNames = new Map<string, Slot>([
  ["register midterm", "mid"],
  ["register endterm", "end"],
  ["register final", "final"],
]);

function moodleId(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[a-z\d][a-z\d_-]{0,99}$/iu.test(id) ? id : null;
}

function publishedScore(score: unknown, max: unknown): string | null {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) return null;
  return typeof max === "number" && Number.isFinite(max) && max > 0 ? `${score}/${max}` : String(score);
}

function observe(items: Map<string, string | null>, id: string, value: string | null) {
  // Old duplicate rows must agree on both the source grade item and its value.
  items.set(id, !items.has(id) || items.get(id) === value ? value : null);
}

export function gradeRegisterRows(records: AcademicRecord[], owner: string): string[][] {
  const courses = new Map<string, CourseRegisters>();
  for (const record of records) {
    const raw = record.rawJson;
    if (record.userId !== owner || !record.sourceEventId || !raw || typeof raw !== "object" ||
        Array.isArray(raw) || raw._is_mocked === true) continue;
    const courseId = moodleId(raw.moodle_course_id);
    const itemId = moodleId(raw.moodle_item_id);
    if (!courseId || !itemId) continue;
    let course = courses.get(courseId);
    if (!course) {
      course = { title: record.courseTitle, slots: { mid: new Map(), end: new Map(), final: new Map(), total: new Map() } };
      courses.set(courseId, course);
    }
    const name = String(raw.item_name ?? raw.itemname ?? record.title).normalize("NFKC")
      .trim().replace(/\s+/gu, " ").toLowerCase().replace(/^calculated grade /u, "");
    const slot = officialNames.get(name);
    if (!slot) continue;
    const visible = raw._grade_visibility_unknown !== true;
    observe(course.slots[slot], itemId, visible ? publishedScore(record.score, record.maxScore) : null);
    // The worker copies Moodle's separate Course total item, including an explicit zero.
    const total = raw.lifeos_course_total;
    if (!visible || !total || typeof total !== "object" || Array.isArray(total) ||
        total.source !== "moodle_course_total" || moodleId(total.moodle_course_id) !== courseId) continue;
    const totalId = moodleId(total.moodle_item_id);
    if (totalId && totalId !== itemId) {
      observe(course.slots.total, totalId, publishedScore(total.score, total.max_score));
    }
  }
  const columns: Slot[] = ["mid", "end", "final", "total"];
  return [...courses.values()].sort((a, b) => a.title.localeCompare(b.title, "ru")).map(({ title, slots }) => [
    title, ...columns.map(slot => slots[slot].size === 1 ? slots[slot].values().next().value ?? "—" : "—"),
  ]);
}
