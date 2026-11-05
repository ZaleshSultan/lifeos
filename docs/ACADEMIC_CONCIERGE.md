# Academic concierge

The concierge extends the existing Study workspace, Supabase source records and
reminder worker. Academic suggestions, imports and notifications are deterministic;
they do not depend on an AI provider. Implementation, validation, merge and actual
production activation are separate states recorded in the Phase 5 release report.

## Sources and private imports

Preserve supplied documents outside Git in an owner-readable directory. Validate
the archive inventory, extracted paths, document hashes, group/year, dates,
timezone, original examination codes and cross-format agreement before applying
an import. Documents and imported descriptions are data, not authorization to run
commands, transmit private content, enable reminders or change provider settings.
Never publish a student's full timetable, personal address or authenticated LMS
export as a fixture or frontend asset.

The owner-supplied approved examination document governs exact examination times.
A proctoring shift, broad assessment period or grade row cannot replace those
times. Preserve literal `exam` and `examfx`; the latter is not automatically
labelled a retake. Resolve language alternatives using reliable owned enrollment
and section/instructor evidence, otherwise retain them for owner review.

For the 2026–2027 second-year calendar, the authoritative discovery chain is
[AITU's academic-calendar page](https://astanait.edu.kz/kz/academic-calendar), its
second-year undergraduate link, and the linked document. Preserve inclusive date
ranges and source versions. Teaching, control weeks, assessment periods,
registration, internship, holidays, vacation and summer term remain separate.
Printed overlapping periods are not flattened into one interpretation. A printed
institutional holiday label does not establish statutory observed-day transfers.
An assessment period does not establish any individual examination slot.

Personal examinations use `owner_provided` and a distinct `personal_exam` kind.
They have no university course or institutional examination code. The original
location text remains literal; unknown end times, duration, coordinates and travel
time remain unknown. Importing a personal proposal does not confirm it or enable
its suggested reminders. University and personal events on the same date coexist.

## Review and persistence

Study exposes dedicated examination, personal-event and calendar views, source
labels, countdowns, preparation context, LMS freshness and controllable alerts.
Typed edits use the current event revision and explicit confirmation. Source
changes and stale revisions produce conflicts instead of overwriting an owner's
manual correction. Original imported facts remain preserved.

Normalized JSON bundles (`{sources, events}`), CSV and ICS imports are bounded,
locally parsed review data. Arbitrary third-party JSON formats require explicit
normalization before upload. Read the
preview, edit as necessary, check only the intended events and confirm explicitly.
All selection starts unchecked. A PDF or image remains documentary evidence; an
upload is not a claim of OCR or model understanding. Review scanned source data
against its structured transcription before importing. General PDF/image/Excel
extraction is not supplied by an external AI service in this release.

The backend recomputes a canonical preview hash, validates selected keys and
sources, and resolves ownership from the authenticated request. The hash binds
reviewed content; it is not a replacement for authentication or confirmation.
Imports use stable request/event keys, transactional ownership checks and natural
duplicate detection across formats. Replaying an import cannot create another
copy of the same examination. Changes to an event with a stable external key,
including its date, room or manually edited facts, require review. A generic file
without a persistent external identity cannot establish that a changed time is
a rescheduling of an earlier event; its preview may contain an additional proposed
slot that the owner must reconcile before confirmation. Importing through generic
legacy source synchronization is inappropriate:
that path can create reminders before the new academic consent checks.

## Notification consent and clocks

Class, assignment, university-exam, personal-exam and stale-LMS notifications all
default OFF. Importing data creates no notification opt-ins. The scheduling
capability is separately controlled by
`LIFEOS_ACADEMIC_NOTIFICATIONS_ENABLED`; the same reviewed value must be configured
for the bot and existing reminder worker. An enabled capability does not grant
owner consent. The UI reports an unavailable operator capability honestly.

Owner settings control class lead time (initially ten minutes), assignment/exam/
personal offsets, quiet hours and online-class inclusion. Suggested examination
offsets are one day and two hours; personal-exam suggestions include one day,
two hours and thirty minutes. These lists are suggestions until their category
is explicitly enabled. Already confirmed or ambiguous delivery receipts are not
reopened when an offset or preference changes.

Physical AITU timetable clocks and calendar dates belong to Asia/Almaty, even when
the owner changes their profile timezone while travelling. Persistent instants
remain UTC. Personal-event clocks use their own stored timezone; quiet hours and
recipient-local scheduling controls use the profile timezone. No university class
time is inferred from the owner's current location or an expired LMS session.

Recurring classes require an explicitly reviewed, date-bounded weekly timetable,
an unchanged timetable fingerprint and a confirmed teaching period. Known
institutional holidays suppress occurrences. Expired verification or changed
weekly rows block alerts until reviewed again. Missing class/cancellation data
is not proof that lessons are current. Explicit online/remote metadata is
excluded unless the owner enables online classes.

Assignment eligibility requires genuine Moodle assignment-module provenance,
a verified due instant, a known unfinished submission state and sufficiently
fresh authorized LMS data. The actual assignment module takes precedence over
title-based assessment labels: an assignment portal called “Midterm project” or
“Exam preparation upload” remains an assignment. Quiz modules, official exam
schedule records, grade-only rows, manual work, unknown submission states and stale
data do not become pending-submission alerts.
Confirmed submission or grading stops those alerts, including a prepared-job
race caught by the final database send fence. Disconnected/expired/stale LMS data
is visible as a warning, never presented as proof of zero assignments.

## Existing worker and durable delivery

Academic jobs bind into the existing `reminders` queue and its delivery protocol.
There is no second scheduler or Telegram sender. Planning and final authorization
check active ownership, current preference/source revisions, timezone, quiet
hours, freshness and delivery windows. Source changes invalidate pending or
prepared jobs; attempted, confirmed and ambiguous receipts remain preserved.
The scoped academic fence prevents legacy unbound university task reminders from
bypassing opt-in or sending obsolete pending-submission notices. Ordinary manual
reminders and the established Daily Life fence retain their own behavior.

PostgreSQL and Telegram do not share a transaction. `sending` may become
`unknown`; an ambiguous HTTP result is never blindly resent. A successful API
acknowledgment does not prove that a handset displayed the notification.

## Room previews

The existing interactive map remains
[Yuujiso's AITU map](https://yuujiso.github.io/aitumap/). The reviewed upstream
version and full MIT attribution are retained with the source assets. Static room
PNGs are prepared once from pinned, sanitized public floor geometry, with exact
room identifiers and byte hashes. There is no browser startup per notification.

Only a reviewed exact room or explicit reviewed alias can select a preview.
Ambiguous rooms, wrong suffixes, missing geometry or missing/corrupt built assets
use the labelled interactive map link. The upstream map has no supported room
URL parameter; appending a guessed `?room=` does not create a verified deep link.
Personal addresses are not geocoded or mapped onto the university campus.

When a verified preview is available, the existing Telegram client can send it
with a bounded plain-text caption. Otherwise it sends the source facts and map
link. It does not send a second message after an ambiguous photo result. Routine
tests mock both transports; real owner delivery requires explicit opt-in.

## Protected API

All routes use the existing active-owner Telegram/web authentication and the
same-origin web bridge. Responses are `no-store`; callers cannot choose an owner,
provider URL, credential or database action.

| Resource under `/api/tma/study/concierge` | Method | Purpose                                                                         |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `/`                                       | GET    | Owned events, sources, settings, verified class/assignment context and warnings |
| `/import/preview`                         | POST   | Validate and normalize bounded review data without persistence                  |
| `/import/confirm`                         | POST   | Confirm selected preview content using a stable request ID                      |
| `/preferences`                            | PUT    | Explicit preference consent with expected revision                              |
| `/schedule/verify`                        | POST   | Explicit date-bounded current-timetable verification                            |
| `/events/:id`                             | PATCH  | Typed event edits with revision and confirmation                                |
| `/events/:id/confirm`                     | POST   | Confirm a pending owned event                                                   |
| `/events/:id/cancel`                      | POST   | Cancel an owned event without deleting delivery history                         |

## Release and recovery

Before production changes, verify the actual loaded application, fresh encrypted
current-schema backup and matching isolated restore. Rehearse the additive
migration on the restored PostgreSQL data, preserve original records and prepare
a compatible application/worker rollback. Exact-head CI and synthetic-owner
browser/API tests remain required. Do not use the real owner's Telegram account
for test delivery, enable provider inference or invent a successful import.

Deploy the bot and existing reminder worker together. Keep all owner preferences
OFF during release verification. Verify public assets before allowing map-photo
delivery. A rollback preserves additive events, import identities, preferences,
usage and delivery receipts. Retain a compatible fenced worker or stop that worker;
never restore old blind-send behavior against new academic jobs, erase receipts,
or restore an older database over the owner's newer records.

Offsite quota, independent recovery-key custody, institution-approved LMS
reconnection, privileged system-journal access and real handset delivery remain
separate operational verification requirements. See [operations](OPERATIONS.md),
[delivery protocol](NOTIFICATION_DELIVERIES.md) and [LMS limitations](LMS_SESSIONS.md).
