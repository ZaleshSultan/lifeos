# LifeOS 6 release readiness

Status: **VERIFIED_TEST_ONLY — combined browser/build verification in progress**. This is a development candidate, not a production release.

The read-only baseline verified production application `066374876a0c7d086965ccdfd6cec1d1fe435ba8`, schema 58 and healthy existing services. The generic public health probe initially received a Cloudflare 403; the existing mobile-client probe and loopback health both returned the expected healthy release. No application, schema, production record, credential, consent flag or service was changed.

The current accepted base is `71bdaa82e96368ef9acc2a29b870cfd7e1bbfa67`. Historical worktrees and other Codex/recovery tasks are preserved. Development uses isolated worktrees and explicit ownership of grade pipeline, grade-target UI, navigation and acceptance integration. The reviewed unmerged Moodle retry fix in [PR #68](https://github.com/ZaleshSultan/lifeos/pull/68) is a candidate dependency, not a deployed fix.

| Slice | Candidate behavior                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Durable staged snapshots, posted/corrected history, silent baseline, ordered recovery, consent epochs and existing final-send fences.                 |
| B     | Reviewed stable-course/item mapping, actual observed forecasts, conditional 70+ scenarios, separate what-if drafts and stale-save conflict detection. |
| C     | Submitted/graded suppression, separate supported quiz closing semantics, shared assignment preferences and explicit category opt-ins.                 |
| D/E   | Exactly four primary sections in TMA/web; existing workflows, lazy loading, owner-scoped drafts and contextual legacy navigation retained.            |
| F     | Compact read-only Home/morning composition, shared synthetic acceptance scenarios, hosted browser checks and release documentation.                   |

## Changes and evidence

The combined source at `63f0dcda` passed **2,311 TypeScript tests in 152 files**, using one worker and a 384 MiB Node heap. All three TypeScript projects passed with a bounded 640 MiB heap. The initial combined run exposed missing mocks in eight pre-existing SSR Study tests; their fixtures now supply the real screen's new hook/navigation dependencies, and all original syllabus assertions pass.

Review also reproduced a real stale-calculator-save defect: the backend ignored the client's comparison base. Eight new negative cases failed before the fix; all 33 database-store tests passed after it. Matching saved state and the database `updated_at` condition are now both required when a comparison base is supplied. TMA sends its original copied draft base; older clients that omit it retain compatibility. A mismatched web syllabus-save URL was corrected to the existing `/syllabus` route and covered by the bridge allowlist test.

| Verification                             | Actual result                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grade/notification Python cohort         | 111 passed with network connections blocked and bounded memory.                                                                                                       |
| Notification formatter/API/config cohort | 26 passed, including the real credential-free local Node formatter.                                                                                                   |
| New PostgreSQL 17 migrations             | 76 SQL assertions plus eight concurrent snapshot replays passed in a disposable network-isolated 256 MiB container.                                                   |
| Grade migration independently            | 46 assertions plus eight concurrent replays passed without the deadline migration.                                                                                    |
| Existing Concierge compatibility         | 72 SQL assertions plus eight concurrent imports/planners/claims passed.                                                                                               |
| TMA original-draft save follow-up        | 28 focused tests and TMA TypeScript passed.                                                                                                                           |
| Home/Study/bridge final follow-up        | 21 tests passed, including pending grade-history warnings.                                                                                                            |
| TMA production build/browser matrix      | Build passed; all 35 checks passed at all six widths, with zero unexpected origins/provider calls/sends/jobs.                                                         |
| Shared Today fixture contract            | Real Today component SSR and fixture regressions passed; TMA typecheck passed after adding the typed fixture helper.                                                  |
| Web build/browser matrix                 | Local compile/typecheck/static generation passed; process terminated with SIGTERM 143 during traces. Browser verification and complete hosted F build remain pending. |
| Production dependency advisory query     | Credential-free `pnpm audit --prod --json` passed with zero advisories at every severity; no dependencies changed.                                                    |

The synthetic browser suite uses invented owner-separated records, loopback APIs, local authentication and real built frontends. It covers 320, 360, 390, 430, 768 and 1,440 px, four primary links, legacy screens, owned/foreign course links, actual calendar selection, grade corrections, observed-versus-hypothetical scores, retained edits, explicit confirmation and preference revision conflicts. Provider calls, Telegram sends, delivery jobs and unexpected browser origins are asserted absent. Physical Telegram WebView and handset delivery remain unverified.

CI keeps the existing TypeScript, Python, operations, migrations/RLS, build and session-smoke checks. F adds serial browser acceptance after both builds with pinned Playwright 1.64.1 in runner temporary storage; it follows the [official browser/dependency installation guidance](https://playwright.dev/docs/ci). Artifacts include synthetic JSON and screenshots only, excluding fixture TLS keys. Hosted CI is required at each exact published head.

## Focused review chain

The dependency is the accepted head plus the isolated Moodle retry fix from PR #68. The unrelated selective-backport PR #69 is not included. These are stacked review branches; merging or deploying is not part of this mission.

| PR                                                        | Head and status                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A — [#70](https://github.com/ZaleshSultan/lifeos/pull/70) | `d3aaad2b8ab250a4794d88d3f4cdff9f529c5b14`; exact-head push and PR CI passed.                           |
| B — [#71](https://github.com/ZaleshSultan/lifeos/pull/71) | `f627431df0f87b107e6b82d2edb800b6c31b4b4d`; exact-head push/PR CI passed, including the Next build fix. |
| C — [#72](https://github.com/ZaleshSultan/lifeos/pull/72) | `5c83da1d102ccb5bd8422b2275321d424b59cec8`; exact-head push/PR CI passed.                               |
| D — [#73](https://github.com/ZaleshSultan/lifeos/pull/73) | `aad3908c4e844cbfc2ee2fc6795c5703ea0c0a82`; exact-head push/PR CI passed.                               |
| E — [#74](https://github.com/ZaleshSultan/lifeos/pull/74) | `1ea75991502963c034b3eac1b6dad69964bc9b19`; exact-head push/PR CI passed.                               |
| F                                                         | Final publication/hosted browser evidence pending.                                                      |

## Candidate migrations and controls

Production remains schema **58**. The two additive files are candidate-only and have been applied only in isolated synthetic databases:

| Order | File                                                | SHA-256                                                            |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 59    | `20261106010000_academic_grade_events.sql`          | `9bc4a7ddc4c73ff041f6cec5052251241cebf65b13a9aabc3fc1ab87edf78f66` |
| 60    | `20261106020000_academic_deadline_intelligence.sql` | `5524a6776208eff2b97aa1bc5320175cdd4786248bdeee9256dfeea9b3b0f0c2` |

New grade/quiz preferences default OFF. Existing saved assignment consent/timings are preserved rather than silently replaced. `LIFEOS_ACADEMIC_GRADE_EVENTS_ENABLED` and the compatible reminder worker's master notification switch remain OFF. Provider execution, free/paid activation, voice, extraction and meal vision were not enabled or invoked. There was no private academic import, source reconnection, personal test message or production record write.

## Security review and limits

The bounded review checked authenticated dispatch order, resolved-owner RPC calls, RLS/service grants, strict resource/method allowlists, existing web Origin/session/CSRF handling, no-store responses, bounded bodies/timeouts, safe institutional links, private owner-keyed draft lifetime and separation of actual observations from hypotheses. Isolated SQL checks cover owner isolation, active leases, receipts, consent changes, quiet hours, source revisions, restart/replay and ambiguous-delivery closure. No browser service key, new auth bypass or provider execution path was introduced.

A bounded scan of added source lines found no credential-pattern matches. The production dependency advisory query returned zero advisories. These checks complement the targeted security tests; they do not establish that every possible vulnerability has been excluded. Protected digest/renderer/summary/unit paths, dependency manifests and lockfile remain unchanged.

A diagnostic process listing exposed an existing infrastructure credential in this session's tool output. Its value was not copied into source, documentation or evidence files. The owner must review and rotate the affected tunnel credential through a separately authorized operational procedure; no live credential or tunnel configuration was changed by this task.

Remaining product limits are explicit: the supported reviewed forecast policy is linear 30/30/40, the latest history view is bounded to 100 events, failed/unconsumed snapshot backlog needs operational monitoring, and unsupported academic rules remain conditional. Course dates and a current source review are required for a confirmed forecast. Stale/expired Moodle access is reported unavailable; this task did not reconnect or independently verify the owner's live LMS. Arbitrary historical workout-detail selection is not added merely because navigation retains a `workoutId`.

## Release boundary and rollback

No production deployment or migration is authorized. New notification categories and providers remain unactivated. Candidate migrations must pass isolated PostgreSQL/RLS/owner/lease/replay tests before review. Application rollback must retain additive schema, observed grades, event history, newer personal records and all delivery receipts; never restore an old database as an application rollback. A compatible worker must retain the final send fence and decline unsupported jobs.

Scheduled morning-digest recovery remains independent. The candidate must not edit its worker, renderer, units or existing `dailyLifeSummary` function. Home academic references are read-only and do not enqueue notification jobs or consume delivery receipts.

Before a separately authorized release:

1. Review PR #68 and A → B → C → D → E → F in order, checking each exact head, compatibility and migration permissions. Resolve the diagnostic credential exposure through approved operations.
2. Re-audit the then-current deployed SHA/schema, worktrees, active recovery tasks and release lock. Obtain fresh encrypted current-schema backup and an actual isolated restore; offsite protection must be assessed separately.
3. With explicit deployment authorization, apply only the reviewed additive migrations in order and deploy a compatible app/worker artifact set with both new release gates OFF. Preserve all personal rows, observations, staged recovery data and delivery receipts.
4. Run authenticated/read-only production smoke checks without messages or personal test writes. Watch memory, source leases, pending stage count/bytes, `historyPending`, jobs and exceptions.
5. Have the owner review actual enrollment, syllabus evidence, stable item bindings and any stale LMS connection. Notification preference editing is not permission to reconnect a source or activate delivery.
6. Obtain separate release/category authorization and explicit owner opt-in before enabling any new grade/deadline delivery. External AI has a separate authorization and consent boundary and is unnecessary for this candidate.

Development checkpoints and synthetic logs/screenshots are retained outside the public repository. No private timetable, personal database, credential, backup or handset evidence is published.
