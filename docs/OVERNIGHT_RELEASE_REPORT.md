# Overnight release verification — 2026-10-31

Release date uses Asia/Qyzylorda. Evidence is separated by environment; mocked
browser sessions are never evidence of successful real Telegram authentication.

## Release and initial state

- Repository: <https://github.com/ZaleshSultan/lifeos>.
- Dedicated branch: [codex/overnight-stabilization-20261031](https://github.com/ZaleshSultan/lifeos/tree/codex/overnight-stabilization-20261031).
- Tested/deployed application revision: `562c4dac3b6c9f04755dcdb830f33c6bbee2c625`.
- Deployment outcome: verified application deployment; live user-specific Telegram/academic flows remain unverified as detailed below.
- This report is committed separately after the application release; its
  documentation-only commit does not change the tested runtime source.
- Initial clean production checkout: `deployment/tasks-1-4`,
  `53c583b0d3df06263c5f5a10867d96b748cc7059`, synchronized with
  `origin/codex/release-tasks-1-4`. The supplied preview-branch description was
  older than the actual deployment. Existing security, web-session, reminder and
  Obsidian changes were preserved; no unrelated branch was merged.
- Scholarship worktree remained clean at `3d9e159709d0cb1886ffa8ae2cd3710454dc6193`
  on `feat/scholarship-survival-planner`, matching its remote. Other worktrees
  were preserved, including an already-prunable temporary worktree.
- Bot and web services initially active since October 26; bot main PID 3008367,
  web PID 3008368. The bot runs as `zalewko`, with `Restart=always` and
  `KillMode=control-group`, from `apps/bot` using its existing environment file.
- Initial TMA: `index-BGKx1d64.js` (598,712 bytes),
  `index-DUdA8dgT.css`, correct `/tma/` base. Initial local health returned
  `status: ok`; configuration flags in that response are not a database health
  probe.
- Rollback artifacts and private evidence:
  `/home/zalewko/lifeos-release-state/overnight-20261031/` (mode 0700).
  Initial TMA `dist` and web `.next` were copied before builds. The original
  application revision remains on `deployment/tasks-1-4`.

## Verification status

| Status                 | Evidence and limit                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VERIFIED IN PRODUCTION | Local and public healthy JSON; public entrypoint references the tested JS/CSS; all 25 generated assets match candidate bytes/MIME/immutable cache headers; protected routes return safe non-cacheable 401s; a missing asset returns non-cacheable JSON 404. Bot restarted successfully; monitored web/worker PIDs unchanged.                               |
| VERIFIED LOCALLY       | 1,102 JavaScript tests, 372 worker tests, complete typecheck, TMA and isolated web builds, local web-session smoke, six isolated PostgreSQL suites, 12 deployment fixtures.                                                                                                                                                                                |
| VERIFIED LOCALLY       | 16/16 local browser scenarios on the final absolute-API-origin production build at 320/390 px, including five courses, DBMS reconciliation, no horizontal/internal metric overflow, 44 px navigation targets, draft refresh/navigation/in-flight-save recovery, real conflict handling with mock data, empty/error/auth/chunk-failure states.              |
| VERIFIED IN PRODUCTION | Configured Supabase REST access succeeds. Owner-scoped Assistant memory/action reads succeed and REST metadata advertises its mutation RPC. No production mutation was invoked.                                                                                                                                                                            |
| NOT VERIFIED           | A real authenticated Telegram WebView, the user's actual DBMS/course/timetable/deadline data, live memory writes/confirmations, and real Gemini responses.                                                                                                                                                                                                 |
| BLOCKED                | The configured bot administrator resolves to no profile. The university worker's configured owner has zero active courses and zero academic records through `SupabaseLifeOSStore.getTmaStudySummary`. No safe live owner with the requested grades was resolved. Users were not enumerated, grades were not invented, and no profile or grade was created. |
| BLOCKED                | Direct live PostgreSQL catalog inspection: configured `DATABASE_URL` fails URL validation. REST works, but live RLS/grants/function body and migration-ledger status were not independently inspected.                                                                                                                                                     |
| BLOCKED                | Full remotely managed Cloudflare ingress/account inspection and credential rotation require account authorization. No infrastructure rules were changed.                                                                                                                                                                                                   |

## Bugs fixed

1. Recognize DBMS official `Calculated Register Midterm`, `Register Midterm` and
   `Calculated grade Register Midterm` consistently. Official totals reconcile
   with components and are excluded from automatic and explicit saved bindings.
   The binding UI uses the same rule as the engine.
2. Label matched Lecture Async evidence as an external-platform total, retaining
   the user-confirmed syllabus bucket and weight. It is not presented as a native
   Moodle quiz.
3. Route the exact question `Какие у меня завтра пары?` to deterministic class
   tools, with today and equivalent-wording regressions.
4. Recover unsaved Scholarship and Study drafts after refresh/navigation using a
   validated, bounded, per-authenticated-user/session buffer. Supabase remains
   authoritative. Preserve the original conflict version and invalid/incomplete
   numeric text; clear stale buffers when an in-flight save already reached the
   matching server state. No scenario or score is placed in URLs.
5. Keep screen, calculator tab and selected course URL state coherent. Split
   screens with lazy imports and retain navigation/reload recovery on failed
   chunks. Render safe access-error messages rather than raw backend/proxy text.
6. Fix overlapping 320 px card metrics with two min/max columns and a full-width
   remaining-average row. Reuse number formatters rather than allocating one
   for every displayed score.
7. Return a non-cacheable 404 for missing static assets instead of SPA HTML.
   Extensionless application navigation retains its SPA fallback.
8. Stage self-host builds with `/tma/` and mocks disabled; validate entry assets
   before publication; reject immutable filename collisions; publish all assets
   before atomically replacing the entrypoint; retain older hashed files.
9. Invoke the non-executable build script through Bash. Deployment uses only
   noninteractive sudo or a checked same-user `Restart=always` TERM fallback;
   no stale-PID KILL escalation. Restart only the affected bot. Probes validate
   JSON health and bundle references and use the verified browser user agent.
   Twelve failure/success fixtures now run in CI.
10. Give disposable Assistant PostgreSQL tests bounded tmpfs storage and an
    explicit successful readiness check. Original SQL assertions are unchanged.

## Scholarship calculations and Moodle mapping

These results are **VERIFIED LOCALLY** against deterministic engine fixtures
using the user-confirmed records; they are **NOT VERIFIED** against the user's
live production academic rows.

| DBMS record      | Score | ATT1 weight | Treatment                                                        |
| ---------------- | ----: | ----------: | ---------------------------------------------------------------- |
| Assignment 1     |    75 |         20% | Confirmed component                                              |
| Assignment 2     |    50 |         20% | Confirmed component                                              |
| Assignment 3     |    70 |         20% | Confirmed component                                              |
| Lecture Async 1  |    88 |         10% | External learning-platform aggregate imported into Moodle        |
| Quiz Midterm     |    81 |         30% | Confirmed Moodle quiz component                                  |
| Register Midterm |  72.1 |        None | Official reconciliation total; never an extra weighted component |

```text
DBMS ATT1 = 75*.20 + 50*.20 + 70*.20 + 88*.10 + 81*.30 = 72.1
DBMS final = 72.1*.30 + 80*.30 + 61*.40 = 70.03
OS final = 66.25*.30 + 70*.30 + 73*.40 = 70.075
```

Default target is 70 per subject. With the stated ATT1/ATT2, DBMS needs an exam
score of at least 60.93, or 61 with integer grading; OS needs 72.82, or 73.
Required minima round upward. Display uses two decimals (OS 70.08), while risk
and reachability are evaluated before display rounding. Missing scores remain
unknown; manual values and scenario period totals remain hypothetical.

All five builtin profiles, separate subject risks, pessimistic/realistic/
optimistic scenarios, remaining-work requirements, threshold boundaries,
official-total mismatches, foreign-course isolation and explicit-binding
exclusions have test coverage. Moodle imports update assessment rows separately
from scholarship scenario metadata; owner-scoped conditional saves protect
against concurrent scenario overwrites. Browser tests exercise a real conflict
response using mocked backend data.

## Assistant Brain and database rollout

The running application already had `LIFEOS_ASSISTANT_ENABLED=true`, with a
confirmation secret configured, classification disabled, and permanent memory
deletion disabled. Existing Gemini planning and its settings were preserved.
No Assistant flag or production schema change was made in this release.

`20261011084249_assistant_brain_persistence.sql` was reviewed and tested fresh
and as part of the complete migration chain. It adds separate user-owned
memories/actions and an atomic service-only RPC without changing academic rows.
Forced RLS, browser table/RPC denial, owner scoping, credential rejection, memory
lifecycle, deletion isolation, atomic rollback and concurrent idempotent retries
passed. TMA writes require signed user/request/action-bound confirmations; model
classification cannot authorize writes. Sensitive health/finance tools remain
disabled. Service-role table grants remain broader than individual CRUD needs,
but remain restricted to the trusted backend.

Raw migration DDL is one-shot, not safe to execute twice; use its migration
ledger. Mutation retry idempotence is separately verified. Existing persistence
tables and advertised RPC were found in the configured deployment, so blindly
reapplying the migration would be unsafe and unnecessary. Live catalog equality
and migration-ledger state are not proven by REST advertisement.

Local rescue dump files and an existing rescue PostgreSQL container were found,
but no fresh independently restored production recovery point was established
in this session. No hosted migration or destructive database operation was
attempted. Existing memory, grades, scenarios, reminders and user data were
preserved.

All six requested Russian question forms route deterministically: scholarship
preservation, DBMS required grades, remaining assignments at 70, greatest subject
risk, tomorrow's classes and deadlines. Scholarship answers call the existing
deterministic engines. Gemini is not used to invent grades or perform official
arithmetic. Actual answers for the user's account remain unverified because
the live owner/data prerequisite above is unresolved.

## Executed checks and evidence

Private logs are under the release-state directory unless an absolute path is
specified. No skipped or interrupted suite is counted as passing.

| Command/check                                                                                                          | Actual result                                                                                                        | Evidence                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `corepack pnpm typecheck`                                                                                              | Passed after final source changes                                                                                    | `typecheck-verified.log`                                 |
| `corepack pnpm test -- --maxWorkers=1 --minWorkers=1`                                                                  | 72 files, 1,102 tests passed                                                                                         | `js-tests-verified.log`                                  |
| `PATH=/tmp/lifeos-phase2-workers-venv/bin:$PATH corepack pnpm test:workers`                                            | 372 tests passed in compatible isolated dependencies                                                                 | `workers.log`                                            |
| TMA build with production API URL, mocks false, `/tma/`, external staging output                                       | Passed; live output untouched by final builds                                                                        | `tma-build-verified.log`, `tma-verified/`                |
| `corepack pnpm --filter @lifeos/web build` in isolated source/dependencies                                             | Passed with the public `/web` URL                                                                                    | `web-build-final.log`                                    |
| `LIFEOS_SMOKE_PUBLIC_WEB_URL=https://lifeos.zalewko.me/web node scripts/test-web-session-smoke.mjs` in isolated source | Passed login/cookies/redirects/HTML/RSC/replay/CSRF/block/logout/revoked-session checks against a local mock backend | `web-smoke-final.log`                                    |
| `bash scripts/test-selfhost-deployment.sh`                                                                             | 12 fixtures passed; fake build/service tools; no live service action                                                 | `selfhost-fixtures.log`                                  |
| Final staged browser harness                                                                                           | 16/16 passed at 320/390 px; APIs mocked locally, including production-origin requests; no real Telegram credentials  | `browser-verified.log`                                   |
| Assistant SQL                                                                                                          | Passed ownership/grants/RLS, memory lifecycle, rollback and concurrent reminder retry checks                         | `/tmp/lifeos-overnight-assistant-migration.log`          |
| Security migration chain                                                                                               | Passed realistic roles, escalation defenses, tenant/RPC isolation, health expiry/revocation and issuance/block races | `/tmp/lifeos-overnight-test-security-migrations.log`     |
| LMS SQL                                                                                                                | Passed migration, encrypted-credential privileges, ownership and leases                                              | `/tmp/lifeos-overnight-test-lms-migration.log`           |
| Web-session SQL                                                                                                        | Passed, including eight concurrent exchanges and exchange/block race                                                 | `/tmp/lifeos-overnight-test-web-session-migration.log`   |
| Notification SQL                                                                                                       | 107 assertions, eight reminder and eight digest contenders passed                                                    | `/tmp/lifeos-overnight-test-notification-deliveries.log` |
| Obsidian SQL                                                                                                           | 191 assertions, eight independent workers, eight same-note contenders and expiry race passed                         | `/tmp/lifeos-overnight-test-obsidian-sync.log`           |
| Browser-secret scan                                                                                                    | 26 candidate TMA files and 12 web static files checked against configured server-secret literals: zero matches       | `deployment-verification.json`, `web-secrets-final.json` |

The final browser harness can be repeated with the isolated tooling used here:

```bash
LIFEOS_TMA_DIST=/home/zalewko/lifeos-release-state/overnight-20261031/tma-verified \
LIFEOS_PLAYWRIGHT_MODULE=/tmp/lifeos-overnight-browser/node_modules/playwright/index.mjs \
LIFEOS_CHROMIUM_EXECUTABLE=/home/zalewko/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
LIFEOS_BROWSER_ARTIFACTS=/home/zalewko/lifeos-release-state/overnight-20261031/browser-verified \
corepack pnpm exec tsx scripts/test-tma-browser.mjs
```

Every SQL suite used a disposable local PostgreSQL container. The existing
production rescue container was not used as a destructive test fixture.

Initial parallel JS verification had four 5-second timer failures under host
memory/I/O pressure (1,080 passing); assertions were not weakened. Serial final
runs passed. Initial Assistant container startup failed before SQL readiness;
the harness fix resolved it. Initial isolated Next build failed because staging
dependency symlinks escaped Turbopack's root; self-contained hardlink dependency
directories resolved that without changing repository configuration or the live
web build. Early browser harness duplicate-label/origin issues were corrected;
only the final complete run is counted.

## Public delivery, performance and operational limits

The final published entrypoint references `/tma/assets/index-CK9G1eE6.js` and
`/tma/assets/index-BsdocCJM.css`. All 25 candidate JS/CSS/chunk files were fetched
through public HTTPS and matched local bytes, expected MIME types and
`public, max-age=31536000, immutable`. HTML uses `no-cache`; the public edge adds
its own analytics markup, so generated asset references rather than whole-HTML
byte equality were compared. `/tma` resolves to `/tma/` correctly.

Public `/healthz` returns healthy JSON. Unauthenticated session, Study and AI
status routes return 401 `invalid_telegram_init_data` with `no-store`. A new
missing-chunk URL returns 404 `tma_asset_not_found` with `no-store` and Cloudflare
BYPASS instead of cached HTML. TLS certificate validation succeeded. Generic
Python/curl user agents encounter Cloudflare 403/code 1010; the verified
Telegram-style Chromium user agent succeeds. This edge policy was preserved.

**VERIFIED IN PRODUCTION:** a separate real Chromium smoke passed at both 320
and 390 px against public HTTPS, with no API mocks, Telegram initData or
credentials. HTML and final JS/CSS returned 200; actual session calls returned
401 and displayed a safe Telegram recovery message and Retry control. Protected
navigation stayed hidden. There were no page crashes, failed application GETs,
missing app assets or horizontal overflow. A GET-only network guard blocked the
edge analytics POST to `/cdn-cgi/rum`; no POST or account action reached the
network. Evidence: `public-unauth-browser.log` and
`public-browser/unauth-{320,390}.png`. This verifies unauthenticated rendering,
not a signed Telegram session.

The bot main PID changed from 3008367 to 778528 using a validated same-user TERM
and systemd autorestart because `sudo -n` is unavailable. Local health succeeded
with retries; subsequent public checks passed. Every other monitored stable
service retained its PID. The running web BUILD_ID checksum still matches the
initial rollback snapshot. `bot-restart.json`, `post-deployment-services.json`,
`post-deployment-log-summary.json`, `release-record.json`,
`tested-source-manifest.json`, `tma-verified-manifest.json` and
`deployment-verification.json` retain revision and artifact evidence outside
the repository. No runtime source changed after the final checks. Sanitized
restart logs contained the expected pnpm lifecycle exit marker caused by TERM,
a startup marker and no uncaught/fatal or connection error codes. Local health
was checked again after more than two minutes of uptime and remained healthy.

Final main JS is approximately 379.3 kB, down from 598.7 kB (about 36.7% less);
Vite reports approximately 113.7 kB gzip. Largest lazy screen is about 55.8 kB.
The large-chunk warning is gone through code splitting, without changing its
warning limit. Reused number formatters reduced the five-course render test
from 8–10 seconds under contention to roughly 0.25–0.31 seconds in focused runs.
These are local measurements, not field WebView performance telemetry.

During verification, an ordinary build briefly wrote an unverified root-base
artifact into the live TMA directory. It was restored from the initial snapshot,
then all further candidate builds used external staging. The publisher and
fixtures now prevent this failure in the self-host deployment path. Old-entry
assets were checked publicly after restoration.

The initial ICS and Platonus units were already auto-restarting. ICS logs show
the deliberate legacy single-user guard. Bot history included fetch failures.
No legacy bypass was enabled, no unrelated unit was restarted, and these
upstream/integration conditions are not claimed resolved. Full remote ingress
configuration is account-managed and was not changed.

Confidentiality incident: service introspection and a malformed connection-URL
diagnostic unexpectedly included a Cloudflare tunnel credential and database
connection string in private tool output. Values are omitted from this report
and commits; task diagnostic files were checked for the connection string and
needed no redaction. Diagnostics were changed to fixed safe messages/selected
metadata. Rotation through the Cloudflare/Supabase account remains blocked by
account authorization. Credentials were not intentionally submitted to an
external reporting service or published to GitHub.

## Inspection and rollback

Safe inspection commands (do not dump service environments or token-bearing
Cloudflare `ExecStart`):

```bash
git status --short --branch
git log -2 --oneline
systemctl show lifeos-bot.service -p ActiveState -p MainPID -p User -p Restart
systemctl is-active lifeos-bot.service lifeos-web.service
curl --fail --silent http://127.0.0.1:3000/healthz
cat /home/zalewko/lifeos-release-state/overnight-20261031/deployment-verification.json
```

Rollback restores only application code and the saved TMA entrypoint/assets;
it never resets the database, removes memory tables, discards working changes,
or changes Assistant flags:

1. Inspect `git status --short`. Stop if it contains new work; preserve that work
   before switching. Keep the release branch for re-deployment.
2. Use the retained publisher to restore the initial tested TMA assets/index:

   ```bash
   node /home/zalewko/lifeos-release-state/overnight-20261031/publish-tma-build.mjs \
     /home/zalewko/lifeos-release-state/overnight-20261031/apps/tma/dist \
     /home/zalewko/lifeos/apps/tma/dist
   git switch deployment/tasks-1-4
   git rev-parse HEAD
   ```

   Expected revision is `53c583b0d3df06263c5f5a10867d96b748cc7059`.

3. Restart only the bot with `sudo -n systemctl restart lifeos-bot.service`.
   If sudo is unavailable, first verify the service is still owned by the
   current account with `Restart=always` and `KillMode=control-group`; send TERM
   only to its current main PID and wait for systemd to produce a new PID.
   Do not use KILL or the old deployment script that also restarts a worker.
4. Retry local JSON health, then inspect the public `/tma/` entry with the
   documented browser user agent and confirm `index-BGKx1d64.js` and
   `index-DUdA8dgT.css` are served with the expected MIME types. Keep the new
   hashed assets; they are harmless and support still-open sessions.
5. The web service was not changed and needs no rollback. Database schema,
   grades, scenarios, memory and environment settings remain untouched.

No GitHub PR was created or merged; the dedicated branch is the reviewable
release artifact.
