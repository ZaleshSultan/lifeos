import {
  ACADEMIC_TIMEZONE,
  academicDate,
  type AcademicOverview,
} from "./academic-concierge.js";

/** Read-only projection of the existing Concierge authority, never a timetable generator. */
export function academicAgenda(
  overview: AcademicOverview,
  date: string,
  now: string,
  activeDeadlines?: ReadonlyMap<string, number>,
) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ACADEMIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayOf = (instant: string) => formatter.format(new Date(instant));
  const time = Date.parse(now);
  academicDate(date);
  if (!Number.isFinite(time))
    throw new RangeError("Invalid academic agenda date or clock.");
  const within = (from: string | null, through: string | null) =>
    from !== null && through !== null && from <= date && date <= through;
  const confirmedPeriod = (kind: "holiday" | "calendar_period") =>
    overview.events.some(
      (event) =>
        event.status === "confirmed" &&
        event.kind === kind &&
        (kind === "holiday" || event.periodType === "teaching") &&
        within(event.startsOn, event.endsOn),
    );
  const verification = overview.scheduleVerification;
  const scheduleState =
    !verification.current ||
    verification.changed ||
    !within(verification.validFrom, verification.validThrough)
      ? "unverified"
      : confirmedPeriod("holiday")
        ? "holiday"
        : !confirmedPeriod("calendar_period")
          ? "outside_teaching"
          : "verified";
  const classes =
    scheduleState === "verified"
      ? overview.classes
          .filter((item) => dayOf(item.startsAt) === date)
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      : [];
  const events = overview.events
    .filter(
      (event) =>
        event.status === "confirmed" &&
        (event.kind === "university_exam" || event.kind === "personal_exam") &&
        event.startsAt !== null &&
        dayOf(event.startsAt) === date,
    )
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  const synced = Date.parse(overview.lms.lastSuccessfulSyncAt ?? "");
  const lmsFresh =
    overview.lms.configured &&
    !overview.lms.stale &&
    Number.isFinite(synced) &&
    synced >= time - 6 * 60 * 60_000 &&
    synced <= time + 5 * 60_000;
  const assignments = lmsFresh
    ? overview.assignments
        .filter(
          (item) =>
            item.verified &&
            activeDeadlines?.get(item.key) === Date.parse(item.dueAt) &&
            !item.stale &&
            item.submissionState === "not_submitted" &&
            Date.parse(item.dueAt) >= time &&
            Date.parse(item.dueAt) <= time + 30 * 24 * 60 * 60_000,
        )
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    : [];
  return {
    date,
    timezone: ACADEMIC_TIMEZONE,
    scheduleState,
    classes,
    events,
    assignments,
    lmsFresh,
    incomplete: overview.truncated,
    uncertainAssignments: overview.assignments.some(
      (item) =>
        item.stale || !item.verified || item.submissionState === "unknown",
    ),
  };
}
