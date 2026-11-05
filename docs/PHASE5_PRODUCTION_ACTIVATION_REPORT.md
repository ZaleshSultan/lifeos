# Phase 5 production activation report

**Stage 1 release verdict: SUCCESS, with recorded operational limitations.**

**Final Stage 1 status: VERIFIED_PRODUCTION.** The accepted Phase 5 application is
running at schema 58. Existing personal data, configuration and historical
receipts were preserved. Every new academic notification and provider-execution
gate remains off. Specific verification and recovery limits remain BLOCKED below.

This report records the November 6, 2026 overnight mission. Times are
Asia/Qyzylorda (UTC+05:00). Merged source, isolated tests, actual production
behavior and future activation are different evidence categories.

1. **Loaded production SHA — VERIFIED_PRODUCTION.** Local and public health
   return `066374876a0c7d086965ccdfd6cec1d1fe435ba8`; production checkout is the same
   commit and is clean. The accepted branch remains
   `codex/overnight-stabilization-20261031`, head
   `71bdaa82e96368ef9acc2a29b870cfd7e1bbfa67`. The sealed application was built from
   `e63dee8310852ceaeaa7bebe6f47e66c2767ca90`, whose tree matches application merge
   `0663748`. The later documentation merge is not the loaded application SHA.

2. **Installed database — VERIFIED_PRODUCTION.** Exactly 58 migration entries;
   latest `20261104030000`. The additive academic and provider-quota entries were
   checked against their exact reviewed source bytes. No database reset,
   down-migration or production snapshot restore occurred.

3. **Installed components — VERIFIED_PRODUCTION.** Promotion finished at
   `2026-11-06 01:16:13 +0500`. Existing systemd services were updated using
   their reviewed same-user restart procedure. Their new processes and invocation
   IDs remained stable through the bounded observation. Both listeners remain on
   loopback, behind the existing Cloudflare Tunnel. Unrelated workers were not
   restarted or reconfigured.

| Component       | Installed identity and evidence                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot/API         | Loaded application `066374876a0c7d086965ccdfd6cec1d1fe435ba8`; local/public health and protected API checks passed                                   |
| Web             | Next.js 16.4.4; BUILD_ID `uT2vmG5g_RNsO-hswHmh1`; installed sealed build, public access delivery and authentication redirect passed                  |
| Mini App        | Accepted Phase 5 build; live indexed JavaScript/CSS bytes match the sealed artifacts; actual academic/import/AI interfaces checked                   |
| Reminder worker | Accepted release source; fenced worker SHA-256 `2108b85ce731cea4d052b6ecc4d98ce106ead643c874edcedc8a7ea657b92df6`; active with academic master false |

4. **Encrypted backups and actual restoration — VERIFIED_PRODUCTION.** Fresh
   archives were created before migration and again at schema 58 before app
   promotion. AES-256-GCM authentication, checksums, archive readability, original
   ownership and configured data floors passed. Each selected archive was
   actually restored into a fresh network-none PostgreSQL instance with no
   production restore target; archive counts matched and the container was
   removed. The local key was available through the protected mechanism. These
   are logical database recovery checks, not whole-host or full Supabase-platform
   recovery.

| Archive schema | Local backup completion   | Cipher SHA-256                                                     | Matching actual isolated restore completion |
| -------------- | ------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| 56             | 2026-11-06 00:54:04 +0500 | `cf0891188084ed926fe1998f74389e686a993b62ca8b263631a4626d80e8783e` | 2026-11-06 00:55:52 +0500                   |
| 58             | 2026-11-06 01:10:32 +0500 | `7e4a17a9df4c9480022898ca9470284ab3018bf9acf7ef3a2314adc8c31adbc6` | 2026-11-06 01:12:25 +0500                   |

The backup service initially refused another manual start because its existing
three-hour/two-start limit was exhausted; no new backup process had run. Only
that user unit's start counter was reset, with resource/time/rate configuration
unchanged. Fresh jobs then passed. Manual maintenance counters were cleared
afterward so the existing daily timer is not blocked. Backup, monitor and
restore timers remain enabled and active.

5. **Migrations — VERIFIED_PRODUCTION; prior attempt FAILED.** The earlier request
   returned HTTP 400 and was left unapplied at schema 56. Its wrapper incorrectly
   requested a platform-table SHARE lock unavailable to production `postgres` under
   [PostgreSQL 17 lock privileges](https://www.postgresql.org/docs/17/sql-lock.html);
   the original server exception was not retained, so that precise HTTP cause
   remains an inference. The old attempt and evidence were retained.

   The corrected transaction was rehearsed through a direct non-superuser
   `postgres` connection with matching production role memberships, effective
   table/schema privileges and database ownership. It reproduced the old lock
   denial. It uses repeatable read, preserves the platform auth ledger with its
   permitted lock, and retains stronger locks on application-owned data. No IAM
   grants, role attributes or RLS settings were changed to make it pass.

   Production acknowledged 56 → 57 → 58 at
   `2026-11-06 01:06:51 +0500`. The exact transaction preserved all 99
   original auth/public table projections, historical notification/accounting
   state, seven capture functions, the original notification implementation and
   existing ledger entries. All six new tables were empty and defaults off.

| Reviewed migration                      | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `20261104020000_academic_concierge.sql` | `ddc52f6fbd5bb1035f52c4d3f9964b86279ca4d2163120ff04591dabf6d70d7a` |
| `20261104030000_ai_provider_quotas.sql` | `027dfde5a7b4bcf31782c42ed7bae0fc38e0b230fc4c953679b6fd3f0201018e` |

6. **Actual production smoke — VERIFIED_PRODUCTION.** Twenty-four bounded API
   checks passed: local/public health, active-owner access, tasks, deterministic
   planner, journal/Ideal Human, nutrition capabilities, workout history, stored
   LMS/study data, academic overview and AI settings. Unauthenticated and unknown
   identities were rejected; an invalid bearer did not fall through to TMA auth,
   and caller-selected owner query parameters were rejected. Protected responses
   retained no-store behavior.

   Twelve actual Chromium UI cases passed at 320/390/1440 px, without API fixtures:
   academic tabs and six unchecked settings, import interface, AI router settings,
   Web access page and protected redirect. One exact invented preview was
   validated by the pure preview endpoint; nothing was selected or confirmed.
   Subsequent database checks found no imported sources/events, preference rows,
   academic jobs, provider attempts or quota buckets. No real owner task or
   calendar event was created. Two public room PNGs plus MIT attribution matched
   sealed bytes; indexed TMA assets and seven Web static assets also matched.

   Actual TMA auth used the established monitor's signed service probe. It does
   not establish physical Telegram handset behavior. Authenticated Next dashboard
   browsing is BLOCKED by the absence of an existing opaque browser session;
   this mission created none. Public delivery, the access guard and the actual
   protected backend were verified separately.

7. **CI and tests — VERIFIED_TEST_ONLY.** The deployed source retains its accepted
   integrated evidence: 2,147 TypeScript tests, 410 Python worker tests, 47
   operations tests, production builds, SQL and fixture acceptance. These are
   prior source-bound checks, not substitutes for the live checks above.

   Every new engineering PR passed exact-head push and pull-request workflows.
   The required typecheck and full test steps actually completed successfully;
   all job conclusions were checked. Focused counts below overlap broader
   coverage and must not be added into an invented aggregate.

| PR and final head                                                                                 | Focused evidence                                                                | Exact-head CI                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [#64](https://github.com/ZaleshSultan/lifeos/pull/64), `781c2b2d5bf09c3120da43912dc095efb676cfba` | 58 tests; isolated TMA build; 20 Chromium fixture scenarios at 320/390/768/1440 | [push](https://github.com/ZaleshSultan/lifeos/actions/runs/42098362884), [PR](https://github.com/ZaleshSultan/lifeos/actions/runs/42098417879) |
| [#65](https://github.com/ZaleshSultan/lifeos/pull/65), `29484a51116a134b5fb0a41a3b9809dac1d99d05` | All 52 operations tests; final follow-up changes ownership documentation only   | [push](https://github.com/ZaleshSultan/lifeos/actions/runs/42103119499), [PR](https://github.com/ZaleshSultan/lifeos/actions/runs/42103127420) |
| [#66](https://github.com/ZaleshSultan/lifeos/pull/66), `e184d186da2da52d0dcb79c43aa357b327e60a91` | 249 mocked router/provider/governor/core tests across ten files                 | [push](https://github.com/ZaleshSultan/lifeos/actions/runs/42099001693), [PR](https://github.com/ZaleshSultan/lifeos/actions/runs/42099168538) |

Private release guards additionally passed 23 offline application/recovery
checks and 13 browser request-guard checks. Heavy local jobs were sequential,
with bounded memory/CPU and browser concurrency; verified artifacts and offline
dependency caches were reused. No historical worktree, production container
or volume was pruned.

8. **Security and preservation audit — VERIFIED_PRODUCTION with stated limits.**
   New table RLS, owner policies, service-only grants and default-off consent were
   checked in the actual migration. Secret-bearing environments were preserved
   outside Git; unrelated legacy bytes were unchanged. Sealed artifact scans
   remained bound to their hashes. A fresh anonymous production-dependency audit
   found zero advisories across 117 dependencies. Independent quality builds
   passed critical credential/private-value scans; two non-unique course-title
   overlaps were traced to unchanged public catalog source, with no unclassified
   matches or private content introduced.

   Post-release hashes matched 97 original tables exactly. The remaining two
   operational tables were compared with the encrypted schema-58 archive in RAM:
   source identity/configuration was unchanged, only last-sync/update timestamps
   advanced, all 69 historical sync records were unchanged, and one failed sync
   receipt was appended. It created/updated zero domain records, matched a prior
   failure reason and finished before the synthetic preview. No newer record was
   erased to force a checksum match. Existing delivery attempts/receipts and AI
   accounting were preserved.

   A scheduled monitor invocation after promotion and a dry-run both checked 20
   conditions: 18 OK, two known WARN, zero FAIL and zero alert attempts. Bot,
   Web and reminder PIDs/invocations/restart counts remained stable after their
   planned restart. Telegram webhook configuration was read without sending a
   test message; historical diagnostics remain. System-journal inspection is
   BLOCKED: its bounded query timed out and privileged access is not established.
   No clean-log or complete outage-recovery claim is made.

9. **Academic functionality.** VERIFIED_PRODUCTION covers empty academic,
   personal-exam, calendar, LMS-warning, notification-settings and import-preview
   views, plus campus asset delivery. VERIFIED_TEST_ONLY covers duplicate/replay,
   literal source-code separation, personal/university separation, unknown
   duration, alternative-language handling, submitted/stale LMS fences, clock
   boundaries and verified-room/fallback behavior. All 255 public map images were
   revalidated locally; a real imported private schedule or map notification was
   not exercised.

10. **Import status — PREPARED_NOT_ACTIVATED.** The private package, normalized
    payload and locally reviewed room/enrollment evidence were revalidated without
    publication. Local import/replay evidence is test-only. The real production
    owner import count is zero. The one actual runtime preview used invented
    data and persisted nothing. No university or personal examination was
    imported or confirmed.

11. **Academic notifications — PREPARED_NOT_ACTIVATED.**
    `LIFEOS_ACADEMIC_NOTIFICATIONS_ENABLED=false` is verified in both bot and
    compatible worker processes. All five alert categories and online-class
    inclusion default false; actual UI controls were unchecked. No owner consent
    row or academic job exists. Existing unrelated notification settings were
    preserved. No Telegram test message, photo or alert was sent; no handset
    delivery is claimed.

12. **External AI — PREPARED_NOT_ACTIVATED.** Router, free profile, paid requests,
    capture transcription, capture AI extraction and meal vision are explicitly
    false in the deployed bot. Existing legacy AI/assistant/live-AI settings were
    preserved; this is not a global legacy shutdown or independent global egress
    audit. This mission issued zero inference requests, used no provider account
    diagnostics and transmitted no private LMS/health/finance/image/audio data
    to models. Public documentation and anonymous model-catalog metadata were
    inspected only. Fixed candidates remain [publicly listed](https://openrouter.ai/api/v1/models) with zero token
    prices; that does not establish account eligibility, all modality costs,
    privacy settings, remaining quota or live model quality. Unpaid Gemini
    restrictions and OpenRouter account/retention/cache review remain binding.
    See [routing guidance](FREE_AI_ROUTING.md) and the pending safety fixes in #66.

13. **LMS and existing source health — BLOCKED.** The stored session remains
    expired/reconnect-required. Existing data is accessible but is not described
    as fresh; stale LMS is not interpreted as proof of zero assignments. The
    existing failed source-sync pattern continued without a configuration change
    or domain writes. Legacy ICS/Platonus restart loops and the failed monthly
    review were observed before release and left unchanged. No OAuth, Microsoft
    or LMS reconnection flow was initiated.

14. **Offsite recovery — BLOCKED.** Upload still fails because of storage quota.
    Local encrypted backups and isolated restores do not protect against total
    host loss. Independent recovery-key custody and successful off-host recovery
    remain unverified. Database dumps exclude object bytes, vault/environment
    files and cluster IAM. No storage purchase, remote cleanup or key rotation
    was performed.

15. **Application rollback — VERIFIED_PRODUCTION precheck;
    PREPARED_NOT_ACTIVATED execution.** Sealed manifest SHA-256
    `ad62f2ec2e35900804acc58bf118dd20d1bd1537515c246df0c015c280997a07`, prior builds,
    retained static assets and the six retained dependency directories were
    verified. Compatible fallback source is
    `92452781995fd6d270ac1b8c434fa40bbb284998`, retaining the fenced academic worker
    with its master off. Durable intents and directory identities classify an
    interrupted dependency exchange. A rollback must keep schema 58, additive
    records, accounting and notification receipts; it must never activate the
    old blind-send worker or restore an older production database. No actual
    application rollback was needed. Starting a permanently stopped PID-0 unit
    still requires systemd authority not established by this mission.

16. **New engineering PRs — VERIFIED_TEST_ONLY, not deployed.** #64 fixes repeated
    local clocks and preserves exact timestamps during unchanged-time edits. #65
    requires an explicit release-verification caller and documents database-owner
    parity. #66 rechecks consent/eligibility after quota waits, sets the zero
    image-price ceiling, and retains a billing-review pause despite malformed
    generated JSON. Each defect was reproduced before its minimal fix. These
    heads are separate from the installed Stage 1 bundle; no additional fix was
    silently merged or deployed.

17. **Missing authorization — BLOCKED.** Private production import, academic
    notification activation, provider/paid execution, voice/photo inference and
    OAuth/LMS reconnection remain unauthorized. Physical handset delivery,
    authenticated Next browsing, full privileged journal review and off-host
    recovery remain unverified. They are not inferred from CI, a mock response,
    a Telegram API acknowledgment or process health.

18. **Minimal next owner steps.** Stage 1 is already deployed; no repeat deployment
    approval is needed. Review the three focused PRs and authorize a later release
    of additional fixes when ready, particularly #66 before any AI trial. If
    wanted, separately approve the reviewed private import; importing must keep
    notifications off. Notification activation and provider/data-category trials
    each need their own explicit authorization and consent. Owner-led supported
    LMS reconnection is separate. Establish independent key custody/offsite
    capacity for host-loss recovery, and use an ordinary existing Web login for
    the authenticated dashboard check. The agent did not initiate those flows.

Detailed raw evidence, failed attempts, manifests and recovery state are retained
privately. They are not included in this public report. The production migration
and promotion are already acknowledged: future work must inspect the current
checkpoint and must not repeat either operation blindly.
