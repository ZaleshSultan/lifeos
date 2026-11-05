# LifeOS 6 unified navigation

The candidate exposes exactly four primary destinations on both surfaces: **Главная**, **Здоровье**, **Учёба**, **Настройки**. There is no fifth More tab. Contextual navigation provides the existing workflows within each section.

| Primary section | Existing workflows retained inside it                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home            | Today, daily briefing, planner, calendar, tasks/reminders, capture/Inbox, assistant, focus, Ideal Human/documentary/creator and finance.                                           |
| Health          | Health metrics and recovery, workouts/plans/history, nutrition/macros, water, weight, sleep, Health Connect and related journal workflows.                                         |
| Study           | Overview, LMS connection/freshness, observed grades/history, reviewed 70+ plans and scenarios, assignments/quizzes, schedule/exams/calendar/maps/syllabi and scholarship planning. |
| Settings        | Account/integrations, notification preferences and daily briefings, academic opt-ins, AI router/privacy controls, source/system status and existing mode settings.                 |

Legacy web pages remain authenticated destinations, grouped under the correct active primary section. `/study`, `/health`, `/workouts`, `/nutrition`, `/capture`, `/ai`, `/planner`, `/calendar` and `/notifications` remain reachable. Telegram `screen` aliases map deliberately to existing screens and retain resource context. Course links use the owned course identifier and `studyTab`, rather than dropping the user on an unrelated landing page.

## Routes and context

The self-hosted web prefix remains `/web`. Existing pages are preserved rather than replaced by a new router:

| Section  | Existing web destinations                                                                    |
| -------- | -------------------------------------------------------------------------------------------- |
| Home     | `/today`, `/planner`, `/calendar`, `/capture`, `/ai`, `/ideal-human`, `/creator`, `/finance` |
| Health   | `/health`, `/workouts`, `/nutrition`; a contextual journal link retains Health selection     |
| Study    | `/study`, with the existing academic/calendar/map workflows and LMS settings link            |
| Settings | `/settings`, `/notifications`                                                                |

Web context links retain only the recognized course, Study tab, academic tab, calendar date/day, workout, capture and assignment parameters. They do not forward arbitrary query strings, tokens or identity parameters. TMA preserves its existing launch/context query parameters and hash while updating screen/section; it adds no identity or authentication fields. Calendar and nutrition dates are validated before selection. Course analysis and simulator links select the actual owned course, while foreign, missing or duplicate matches display unavailable instead of silently selecting the first course. Server-rendered Study content receives the initial course/tab selection, avoiding an unrelated-course first render.

TMA retains all existing screen IDs. `today`, `planner` and `calendar` resolve to Home's actual date-aware Today planner; `workouts` resolves to Workout; `nutrition`/`water` resolve to Daily Life inside Health; `notifications` resolves to reminders inside Settings; `integrations` resolves to sources. An explicit section is accepted only when it contains the selected screen. Internal navigation and browser back/forward update the real screen and Study selection.

Study's existing schedule, calculator, grades and Academic Concierge remain available. TMA's new Work tab reuses `StudyLmsOverview`; it does not implement a second assignment service. Grade/history cards are filtered by stable course ID. Verified exam links open the existing Concierge exam view. Deadline links open the existing Work list while preserving course context; that list is not filtered by course. Global exam links clear an unrelated course selection.

Legacy workout and assignment identifiers remain in navigation context. This candidate does not add an arbitrary historical workout-detail selector or claim that every retained identifier has a dedicated detail page. Existing active workout/history and assignment lists remain reachable; direct Moodle links require verified destinations.

TMA visits load lazily and retain visited views so switching primary sections does not discard form input. Web draft retention remains scoped to the authenticated workspace lifetime; no provider credentials or personal form state are put in URLs. Navigation is not permission to commit a draft. Existing save, confirmation, identity and owner checks still apply.

## Drafts and loading

Web's owner-keyed draft provider retains dirty form fields and their original optimistic revisions in React memory. It clears on logout, rejected authentication, owner replacement or provider disposal. It uses no local/session storage and no module-global personal cache. Clean forms adopt fresh server state. Dirty calculator, notification, journal, task, capture, nutrition and workout drafts retain their original comparison base, and successful saves clear the relevant cached editor state before revision remounts. An uncertain import retains its retry identity, while the confirm action must be clicked again.

TMA retains lazily visited screens inside its existing owner-scoped workspace. Switching a primary section does not submit a form. In-flight operations retain their navigation guards. Credential fields and explicit one-time review/import/notification approval clicks are not retained by the draft helper. Draft survival across reload, browser close or a different device is intentionally not promised.

Home's academic card is compact and read-only: recent grade references, verified upcoming unfinished deadlines, confirmed exams and reviewed target risks use existing services. Less frequent integrations and monthly review are disclosures. The same academic view composes inside the on-screen morning briefing; it never changes the scheduled digest or creates a second delivery path.

The design keeps the existing graphite panels, cyan navigation accent, readable labels, 44-pixel actions and mobile safe areas. Empty, unavailable, stale and conditional academic states are visible. New cards display real normalized data or an honest missing-source explanation. The candidate adds no fake health, fitness, grade or nutrition data.

Final implementation details, browser widths, deep-link checks and known limits are recorded in [release readiness](LIFEOS_V6_RELEASE_READINESS.md).
