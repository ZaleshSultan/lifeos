// Invented local fixtures only. No owner timetable, credentials, AI or delivery.
import { createHash } from "node:crypto";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  parseAcademicImport,
  parseAcademicPreferences,
} from "../packages/core/src/academic-concierge.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
export function academicBrowserFixture(
  owner = "A",
  { confirmedPersonalForHome = false } = {},
) {
  const at = new Date().toISOString();
  const date = (days) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const day = date(2);
  let sequence = 10;
  const uid = () =>
    "11111111-2222-4333-8444-" + String(sequence++).padStart(12, "0");
  const source = (key, kind) => ({
    key,
    kind,
    label: "Synthetic fixture " + kind,
    sha256: sha(key),
    sourceUrl: null,
    page: 2,
    academicYear: null,
    groupCode: null,
    verifiedAt: at,
    revision: 1,
  });
  const sources = [
    source("fixture-timetable", "official_timetable"),
    source("fixture-personal", "owner_provided"),
    source("fixture-calendar", "official_calendar"),
  ];
  const event = (input) => ({
    id: uid(),
    revision: 1,
    manuallyEdited: false,
    updatedAt: at,
    startsAt: null,
    endsAt: null,
    startsOn: null,
    endsOn: null,
    timezone: "Asia/Almaty",
    location: null,
    courseCode: null,
    sourceTypeCode: null,
    trimester: null,
    periodType: null,
    status: "confirmed",
    ...input,
  });
  const events = [
    event({
      key: "fixture-exam",
      sourceKey: sources[0].key,
      kind: "university_exam",
      title: "Synthetic Systems examination",
      startsAt: day + "T05:00:00.000Z",
      endsAt: day + "T06:00:00.000Z",
      location: "C1.3.319",
      courseCode: "SYN",
      sourceTypeCode: "exam",
    }),
    event({
      key: "fixture-examfx",
      sourceKey: sources[0].key,
      kind: "university_exam",
      title: "Synthetic Systems additional slot",
      startsAt: date(5) + "T05:00:00.000Z",
      endsAt: date(5) + "T06:00:00.000Z",
      location: "C1.2.221K",
      courseCode: "SYN",
      sourceTypeCode: "examfx",
    }),
    event({
      key: "fixture-personal",
      sourceKey: sources[1].key,
      kind: "personal_exam",
      title: "Synthetic personal theory event",
      startsAt: day + "T11:00:00.000Z",
      endsAt: null,
      location: "Invented test street, 9",
      status: confirmedPersonalForHome ? "confirmed" : "proposed",
    }),
    ...[1, 2, 3].map((trimester) =>
      event({
        key: "fixture-term-" + trimester,
        sourceKey: sources[2].key,
        kind: "calendar_period",
        title: "Synthetic trimester " + trimester,
        trimester,
        periodType: "teaching",
        startsOn: date((trimester - 1) * 90),
        endsOn: date((trimester - 1) * 90 + 60),
      }),
    ),
    event({
      key: "fixture-summer",
      sourceKey: sources[2].key,
      kind: "calendar_period",
      title: "Synthetic summer term",
      trimester: 3,
      periodType: "summer",
      startsOn: date(270),
      endsOn: date(290),
    }),
    event({
      key: "fixture-vacation",
      sourceKey: sources[2].key,
      kind: "calendar_period",
      title: "Synthetic overlapping vacation",
      trimester: 3,
      periodType: "vacation",
      startsOn: date(270),
      endsOn: date(310),
    }),
    event({
      key: "fixture-holiday",
      sourceKey: sources[2].key,
      kind: "holiday",
      title: "Synthetic institutional holiday",
      trimester: 2,
      periodType: "holiday",
      startsOn: date(100),
      endsOn: date(100),
    }),
  ];
  let overview = {
    timezone: "Asia/Tokyo",
    deliveryEnabled: false,
    sources,
    events: owner === "A" ? events : [],
    preferences: structuredClone(DEFAULT_ACADEMIC_PREFERENCES),
    scheduleVerification: {
      revision: 1,
      validFrom: date(0),
      validThrough: date(30),
      sourceLabel: "Synthetic verified weekly source",
      verifiedAt: at,
      current: true,
      changed: false,
    },
    lms: {
      configured: true,
      stale: false,
      lastSuccessfulSyncAt: at,
      state: "active",
    },
    classes:
      owner === "A"
        ? [
            {
              key: "fixture-class",
              title: "Synthetic campus class",
              startsAt: day + "T04:00:00.000Z",
              endsAt: day + "T05:00:00.000Z",
              location: "C1.3.323K",
              courseCode: "SYN",
            },
          ]
        : [],
    assignments:
      owner === "A"
        ? [
            {
              key: "fixture-assignment",
              title: "Synthetic Moodle submission",
              courseTitle: "Synthetic Systems",
              dueAt: date(3) + "T13:00:00.000Z",
              sourceUrl:
                "https://lms.astanait.edu.kz/mod/assign/view.php?id=123",
              submissionState: "not_submitted",
              verified: true,
              stale: false,
            },
            {
              key: "fixture-submitted",
              title: "Synthetic submitted work",
              courseTitle: "Synthetic Systems",
              dueAt: date(4) + "T13:00:00.000Z",
              sourceUrl: "javascript:alert(1)",
              submissionState: "submitted",
              verified: true,
              stale: false,
            },
          ]
        : [],
    warnings: [],
    truncated: false,
  };
  const requests = [],
    imports = new Map();
  let preferenceFailure = false;
  const answer = (data, status = 200) => ({
    status,
    body: status === 200 ? { data } : { error: data },
  });
  const preview = (body) => {
    const input = parseAcademicImport({
      ...body,
      requestId: "academic-preview-v1",
    });
    const value = { sources: input.sources, events: input.events };
    return {
      ...value,
      previewHash: sha(JSON.stringify(value)),
      warnings: [
        "academic_source_requires_document_review",
        "academic_import_does_not_enable_notifications",
      ],
    };
  };
  return {
    day,
    get snapshot() {
      return structuredClone(overview);
    },
    get requests() {
      return structuredClone(requests);
    },
    failPreferencesOnce() {
      preferenceFailure = true;
    },
    setStale() {
      overview.lms.stale = true;
      overview.warnings = ["lms_stale_or_reconnect_required"];
    },
    async response(path, method, body = {}) {
      if (!path.startsWith("study/concierge")) return null;
      requests.push({ path, method, body: structuredClone(body) });
      if (path === "study/concierge" && method === "GET")
        return answer(overview);
      if (path === "study/concierge/import/preview" && method === "POST")
        return answer(preview(body));
      if (path === "study/concierge/import/confirm" && method === "POST") {
        if (body.confirmed !== true || !body.selectedKeys?.length)
          return answer("academic_invalid_input", 400);
        if (imports.has(body.requestId))
          return answer(imports.get(body.requestId));
        const checked = preview({ sources: body.sources, events: body.events });
        if (checked.previewHash !== body.previewHash)
          return answer("academic_invalid_input", 400);
        let created = 0,
          unchanged = 0;
        for (const row of checked.events.filter((item) =>
          body.selectedKeys.includes(item.key),
        )) {
          if (overview.events.some((item) => item.key === row.key)) {
            unchanged++;
            continue;
          }
          overview.events.push(event(row));
          created++;
        }
        for (const row of checked.sources)
          if (!overview.sources.some((item) => item.key === row.key))
            overview.sources.push({ ...row, revision: 1 });
        const result = {
          created,
          unchanged,
          conflicts: [],
          overview: structuredClone(overview),
        };
        imports.set(body.requestId, result);
        return answer(result);
      }
      if (path === "study/concierge/preferences" && method === "PUT") {
        if (preferenceFailure) {
          preferenceFailure = false;
          return answer("fixture_temporarily_unavailable", 503);
        }
        if (
          body.confirmed !== true ||
          body.expectedRevision !== overview.preferences.revision
        )
          return answer("academic_conflict", 409);
        overview.preferences = {
          ...parseAcademicPreferences(body.preferences),
          revision: overview.preferences.revision + 1,
        };
        return answer(overview);
      }
      if (path === "study/concierge/schedule/verify" && method === "POST") {
        if (
          body.confirmed !== true ||
          body.expectedRevision !== overview.scheduleVerification.revision
        )
          return answer("academic_conflict", 409);
        overview.scheduleVerification = {
          revision: body.expectedRevision + 1,
          validFrom: body.validFrom,
          validThrough: body.validThrough,
          sourceLabel: body.sourceLabel,
          verifiedAt: at,
          current: true,
          changed: false,
        };
        return answer(overview);
      }
      const match =
        /^study\/concierge\/events\/([a-f0-9-]{36})(?:\/(confirm|cancel))?$/.exec(
          path,
        );
      if (match) {
        const row = overview.events.find((item) => item.id === match[1]);
        if (!row) return answer("academic_not_found", 404);
        if (body.confirmed !== true || body.expectedRevision !== row.revision)
          return answer("academic_conflict", 409);
        if (method === "PATCH" && !match[2]) {
          Object.assign(row, body.patch, {
            manuallyEdited: true,
            revision: row.revision + 1,
          });
          return answer(overview);
        }
        if (method === "POST" && match[2]) {
          row.status = match[2] === "confirm" ? "confirmed" : "cancelled";
          row.revision++;
          return answer(overview);
        }
      }
      return answer("fixture_route_not_implemented", 404);
    },
  };
}
