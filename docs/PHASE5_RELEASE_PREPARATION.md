# Phase 5 release preparation — November 5, 2026

This checkpoint covers integration and release preparation. Production activation
requires the owner's explicit decision. Passing source, fixture and isolated-restore
checks do not establish a production import, delivery or live model inference.

## Source and publication

- Academic implementation: `8da835fd05bbcc5412459bb39f356932bada5f4e`, [PR #60](https://github.com/ZaleshSultan/lifeos/pull/60),
  merged as `9921eb4038a71c9a3dd2f5174ace7d0007c2833a`.
- Dependency security: original `1c822249f67bebac00eb8b66da0a86997c0d83f1`,
  integrated head `9897069a5fa00f79e2346b7745a8ca9ba58c0666`, [PR #61](https://github.com/ZaleshSultan/lifeos/pull/61),
  merged as `cdb40e5c0e43f912ea6581e1843af5a75227e95a`.
- Free-router implementation retains original commits `5a606b8`, `befb025` and
  `7297922`. Combined tested source is
  `e63dee8310852ceaeaa7bebe6f47e66c2767ca90`, [PR #62](https://github.com/ZaleshSultan/lifeos/pull/62). Merged as `066374876a0c7d086965ccdfd6cec1d1fe435ba8`.
- Original commits remain ancestors. Both core exports are retained. The two new
  migrations and all 56 baseline migrations retain their original bytes.
- Additional changes concern test coverage, bounded isolated checks, a one-worker
  Next.js build and the documented OpenRouter privacy activation gate.

## Verified checks

Both exact-head push and PR workflows passed for all three PRs, including the
academic and shared-provider-quota SQL steps for the combined source. The final
[accepted-branch push workflow](https://github.com/ZaleshSultan/lifeos/actions/runs/42084213925)
also passed at merge `066374876a0c7d086965ccdfd6cec1d1fe435ba8`; its tree
matches the tested source. Actual
integrated CI logs confirm 2,147 TypeScript tests across 135 files, 410 Python
worker tests and 47 operations tests passed. CI used Node 22.23.4 and Python
3.12.16; these are hosted results. Preserved Debian Python checks remain separately
bound to unchanged worker bytes, and the actual compatible-worker probe below
used the installed Debian interpreter.

Local combined-source checks passed all three TypeScript configurations, 14 SQL
suites, the `/tma/` production build and the Next.js production build. Academic
SQL covers 72 assertions and three groups of eight concurrent requests. The
existing notification suite covers 160 assertions; its alias is not counted as
another distinct suite. Shared-provider quotas passed two eight-connection groups.

Fresh browser acceptance: academic 20/20; web 78/78; general Mini App 24/24. These use
synthetic fixture APIs and are not production smoke tests. Free-only settings
coverage includes 320/390 px, saved auto/manual selection, pooled quota status,
blocked paid spending and no chat dispatch. Earlier failed or interrupted
attempts remain preserved, including a too-small local TypeScript heap cap; no
production validation was weakened to obtain a pass.

The local heavy queue runs one job at a time, with one CPU and a 1 GiB process
scope. Disposable SQL containers additionally use 256 MiB, no network or Docker
plaintext logs, and bounded process counts. Fresh anonymous audits report zero
advisories across 323 full and 117 production candidate dependencies.

Configured-credential/private-fact scans passed across 366 source files and 1,158
compiled files (328,390,789 bytes), with zero matches. No private schedule, personal address,
original import package, credentials or real provider data is published.

## Private import and recovery

The original import archive and private evidence hashes were revalidated. The
reviewed normalized payload contains nine university examinations (five `exam`,
four `examfx`), 30 official calendar records across all three trimesters and one
separate owner-provided personal proposal. Language alternatives were resolved
from owned enrollment evidence. The proposal retains its supplied location and
unknown end time. University and personal examinations on the same day coexist.
No notification opt-in is inferred from importing.

The fresh encrypted schema-56 backup completed at 17:45:19 UTC, with cipher SHA-256
`c7975e2e4096038e2d3750f938bbe5774d8c55258d821f357ab61d8b17071b29`.
The matching installed isolated restore completed at 17:47:41 UTC. A subsequent
actual PostgreSQL 17 rehearsal completed at 18:02:05 UTC: 56 → 57, the exact
40-record import and duplicate replay, then → 58. All 32 original factual
projections, router settings, seven capture functions, the original notification
implementation and imported academic records were preserved. Alerts, academic
jobs, provider attempts and quota buckets remained off or empty.

The actual compatible rollback worker cancelled one preclaimed synthetic academic
job with its master switch off, using the real database finish RPC. No sender,
network, recipient-resolution or planning call occurred. Temporary rows were
removed and complete hashes matched. Original reminder claiming and recovery
were deliberately not run against restored original reminders. Every isolated
container was removed; no production restore target was available.

The private deployment bundle is sealed and independently verified. It contains
hash-verified candidate and prior builds, both directions of retained Next.js
static assets, compatible fallback source `92452781995fd6d270ac1b8c434fa40bbb284998`
and copied recovery/validation evidence. Actual TMA candidate/prior publication
and atomic Next.js installation into existing and missing directories passed in
private copies. Saved-bundle validation succeeds with current candidate, production
and fallback paths deliberately unavailable, with no subprocess, HTTP, Git or
environment dependency. File/directory synchronization precedes the final manifest.
Its SHA-256 is
`ad62f2ec2e35900804acc58bf118dd20d1bd1537515c246df0c015c280997a07`.
No activation action is implemented; proposed flags are separate from current settings. The superseded academic-only activation helper is
hard-blocked. An application rollback must preserve additive data and receipts,
retain the fenced worker with its master switch off, and preserve current secrets.

## Production and remaining gates

The actual loaded application remains
`a01a697fdfd40b0c5dd868c551177b7050f6130f`, with checkout
`e1bb7e46b421032f2ef95371cd591f67de2f4a28` and schema 56. Local/public health and
stable bot, web and reminder processes were verified read-only. Phase 5 is not
deployed, and its owner import has not been performed. No Telegram test message,
real provider inference or OAuth flow was initiated by this release work.

New academic/router/free/paid/STT/vision flags remain off or absent. Existing
legacy AI/assistant configuration remains unchanged; this is not a global legacy
AI shutdown claim. The proposed future configuration disables global AI and
asserts its kill switch while new notification/provider gates remain off. No
proposed environment change has been applied.

After owner activation approval, recheck a fresh current-schema backup, coordinate
the migration and service release, take and actually restore a new schema-58
backup before app promotion, and perform genuine guarded API/browser verification.
Only then apply the reviewed private owner import and verify idempotency and
unchanged opt-outs. Owner reminder opt-ins, current weekly timetable review and
approved LMS reconnection remain separate steps.

Real AI additionally requires provider- and data-category-specific consent, fresh
price/capability/eligibility metadata, protected credential references and account
privacy verification. Two Gemini and three OpenRouter references share their
project/account quotas. OpenRouter `zdr:true` alone does not establish strict
ZDR-only account/guardrail policy. Gemini unpaid personal-data restrictions remain
binding. Personal free STT is unverified; manual transcription remains available.
ChatGPT subscription access, API credits and native Claude Code remain separate.

Offsite backup capacity and independent recovery-key custody remain unverified.
Privileged system-journal review, unhealthy-service recovery, actual Telegram
handset delivery and real provider/voice quality are not established by this
preparation. No clean-log, complete outage-recovery or live-inference claim is made.
