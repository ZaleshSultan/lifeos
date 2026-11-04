# Universal Capture Assistant (Nighthawk)

## Nighthawk 2 candidate — November 4, 2026

The running production application remains **`7ca304bf07b835a57cda004fc0dead2638dba607`**, verified for the November 3 v1 release. Nighthawk 2 is a source candidate tracked by [Issue #54](https://github.com/ZaleshSultan/lifeos/issues/54); its full source QA, release backup/restore, promotion and deployed smoke evidence are **PENDING**. The historical v1 deployment evidence below does not establish deployment of these new changes.

| Area                                             | Current implementation evidence                                                          | Production/owner boundary                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Text, link and manual-transcript capture         | Existing v1 workflow; candidate adds multilingual intent separation and richer review    | v1 production verified; candidate behavior awaits full QA/deployment                      |
| Rich cards, corrections and per-action rejection | Candidate source and focused mock/fixture coverage                                       | No automatic approval or domain write; candidate production unverified                    |
| Automatic voice transcription                    | Native OpenAI `gpt-transcribe` adapter and governed durable lifecycle, tested with mocks | Disabled; no real audio/provider success or RU/KK/EN accuracy claim                       |
| External model extraction                        | Candidate uses existing router/governor and validates constrained model proposals        | Disabled; no real model request made for this feature                                     |
| Gemini/OpenRouter speech                         | Official-documentation research only                                                     | No speech adapter, live connection or quality verification                                |
| Existing meal-photo review                       | Separate estimated-draft/edit/explicit-confirm workflow                                  | Nighthawk 2 adds no vision call or automatic meal write                                   |
| ChatGPT plan connection                          | Existing separately documented preparation                                               | Owner browser consent, eligibility and runtime connection still required; not API credits |

Initial focused evidence is **85 core tests**, **194 baseline speech/router tests**, **21 shared UI tests**, and an initial isolated SQL compatibility check passing. These are source/mock checks, not the final full-suite or deployment result. Full TypeScript, complete unit/API/worker checks, staged browser results, security scans, the exact new file manifest and actual release verification remain **PENDING** until the release report records them. No paid provider request, owner OAuth action or new production deployment is authorized by this guide.

## Why multiple intents needed a parser fix

The previous deterministic parser split a narrow set of conjunctions/explicit commands, then gave broad filming keywords precedence over the whole remaining sentence. As a result, a mixed workout/DBMS/filming sentence could become one `filming.idea` with all the text. This was a segmentation/classification error; the interface was rendering the proposals it received.

The candidate separates intent fragments before classifying them, including supported RU/KZ/EN, mixed-language, typo and punctuation-free fixtures. It preserves quoted titles, noun lists and explicit memory contents rather than splitting every occurrence of “and”. Coverage examples are bounded regression examples, not a claim to understand arbitrary speech:

| Input                                                                                                  | Candidate proposals, initially unchecked                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `Завтра после университета нужно потренироваться, закончить DBMS и снять пару кадров для Ideal Human.` | Workout plan (`planning.suggest`), DBMS task (`task.create`), filming idea (`filming.idea`) |
| Same sentence with `законч DBMS`                                                                       | The same three distinct intents                                                             |
| `После пар зал потом DBMS вечером влог снять`                                                          | Workout plan, DBMS task, filming idea; literal time/relation hints                          |
| `Tomorrow finish DBMS, go to the gym and film my vlog.`                                                | DBMS task, workout plan, filming idea                                                       |
| `Tomorrow finish DBMS go to the gym film my vlog`                                                      | The same three intents without punctuation                                                  |
| `Ертең сабақтан кейін залға барамын, сосын DBMS тапсырмасын бітіру керек.`                             | Workout plan and DBMS task; no filming idea invented                                        |
| `Ертең после пар залға барамын потом DBMS тапсырмасын бітіру керек и снять влог`                       | Workout plan, DBMS task, filming idea                                                       |

A future workout remains a plan. A filming idea does not mark footage as filmed. Saying “finish DBMS” creates a proposed task rather than completing an unrelated existing task. Unknown duration, macros, schedule and completion stay unknown. Explicit memory commands retain their separate credential/sensitive-data checks and review requirements.

## Review cards, dates and corrections

Shared web/TMA review cards show a concise title, action type, explanation, missing information, source/provenance, optional suggested date/time/relation and warnings. Original input and transcript remain visible separately. All actions start unchecked; incomplete actions cannot be selected. Selecting only the DBMS card leaves workout and filming proposals pending. Confirmation still uses the current revision, selected action IDs, `confirmed:true` and a stable request ID; successful receipts survive reload and replay.

Optional `presentation` metadata is server-validated and stored separately from executable arguments. Its fields are `title`, nullable `description`, `suggestedDate`, `timeHint` and `relation`, `language`, `evidence`, `warnings`, `timezone` and `dateBasis`. Language can be `ru`, `kk`, `en`, `mixed` or `und`; evidence distinguishes `user_statement` from `recommendation`. Labels are presentation, not permissions or proof that a domain action ran. The stored `extractionOrigin` distinguishes deterministic/model extraction even after a manual edit; unknown legacy provenance stays unknown. No fabricated source-span quotation is displayed.

Task suggestions use the profile timezone. Ideal Human journal dates use **Asia/Almaty**; cards expose their date basis/timezone. For the fixed fixture instant `2026-11-03T19:10:00Z`, Almaty is already November 4 and “tomorrow” resolves to **November 5**, not November 4. The reference instant is preserved across retry. A date suggestion does not invent a task `dueAt`, reminder instant or clock time. “После университета” and “вечером” remain literal hints when actual schedule/time information is missing. Day 1 on November 3 remains the existing explicit journal date and is not advanced by a later capture.

**Уточнить предложения** sends a bounded natural-language instruction such as `Нет, DBMS не завтра, а в пятницу.` to deterministic `POST /captures/:id/correct` with the expected revision. It updates only the identified pending proposal, preserves stable action IDs/completed receipts, and clears prior selection. `capture_correction_unclear` means the instruction made no clear safe change; the draft stays available to edit. An explicit per-card rejection uses `POST /captures/:id/reject` with `expectedRevision` and `actionId`. Neither correction nor rejection approves other actions. Phrases such as “остальные сохрани” do not substitute for checked-card confirmation. Approved records are changed through their own normal domain workflows.

The browser regression plan preserves v1 empty/error/dirty/retry/history cases and adds the multilingual examples, DBMS-only confirmation/replay, partial receipts, correction failure/recovery, per-action rejection, explicit external consent and cancelled late completion. Web and TMA fixtures cover **320/390/768/1440 px**. Final executed counts belong in release evidence; fixture responses do not establish production STT.

## Voice, external processing and truthful progress

Telegram voice first records bounded owner-scoped metadata. It does not automatically download audio or call a provider. Manual transcription remains usable without any external route. The browser requests no microphone on load and never exposes a Telegram file ID/download URL. Metadata is limited to **5 MiB / 120 seconds**; server-only audio references expire within 24 hours independently of capture-history retention.

Candidate external controls appear only for an eligible owner route reported as `configured_unverified`; this means prepared configuration, not a successful provider test. Capabilities are derived from actual owner-scoped catalog/credential/settings checks, rather than a global flag alone. Defaults remain `aiExtraction:false`, `externalModel:unavailable` and `transcription:unavailable`. The transcription option is absent once a manual or provider transcript already exists; an existing transcript can be corrected/reviewed without sending the original voice again.

Each external operation requires its own unchecked consent and a request bound to the capture/revision: `POST /captures/:id/external` with `{expectedRevision,requestId,mode:'model'|'transcription',confirmed:true}`. This authorizes one governed processing operation, not proposal execution or changed spending limits. The server checks active canonical owner, settings/policy revision, privacy, price, budget and the durable capture lease again before dispatch. Original text, model output and saved memory cannot authorize external work.

For **model mode**, consent covers the text/transcript and the permitted bounded planning context: reference date/timezone, known-schedule status, commitments, deadlines and warnings. Saved health facts and raw saved memories/preferences are not appended to that payload. The capture text itself and schedule titles may contain sensitive information, so the selected provider must be allowed for **all four** categories: `general`, `university`, `health` and `finance`. For **transcription mode**, consent covers this record's audio; voice content may also mix those categories. Both modes use classification-scoped credentials and the existing shared governor. There is no legacy chat fallback, arbitrary provider URL or new agent framework.

After a durable claim, the API returns actual `processing` state while a bounded existing executor continues. Only server-persisted `processingStage:'transcribing'|'extracting'` justifies the corresponding progress label; the UI does not animate a fictitious completed stage. Polling observes the terminal record. `transcriptSource:'manual'|'provider'` reflects how a transcript was actually saved. A provider result produces unchecked proposals for review, never automatic tasks, meals, memory or journal completion.

**Отменить обработку** cancels the current revision durably and signals the existing executor. Archive/delete/service stop also abort active work; lease fencing prevents a late result from resurrecting a cancelled/deleted capture. Cancellation cannot undo data already received by a provider, guarantee a charge refund or reverse previously approved records. External reprocessing is blocked after any action succeeds; remaining proposals can be edited or rejected instead. No startup/worker retry automatically repeats external dispatch.

Unavailable configuration, permission/privacy/budget denial, expired reference, malformed/unsupported/oversized audio, timeout, cancellation and provider failure use safe error codes with manual fallback. An invalid/failed model extraction can retain the deterministic baseline with a `capture_model_fallback` warning; it does not silently spend on another provider. Do not infer working STT from this fallback, a processing label or mock transcript.

## Owner activation and the outstanding real test

Activation instructions and non-secret catalog examples are in [AI Model Router — capture voice activation](AI_MODEL_ROUTER.md#capture-voice-activation-owner-and-operator-steps). They require a protected owner/classification-scoped API-key reference, current verified audio pricing/capabilities, voice shortlist, all four provider privacy permissions, owner paid authorization, operator and owner money caps, shared budgets, explicit feature activation and then separate record consent. **No flag or key was enabled as part of this candidate implementation.** ChatGPT subscription allowance and legitimate native Claude Code development access remain separate from an OpenAI API key.

After source QA/release verification and explicit owner financial/privacy authorization, the remaining real Telegram test is:

1. Use the genuine approved owner account to record a short supported voice clip containing the three workout/DBMS/filming intents above. Confirm a durable metadata record arrives without automatic provider work. A typed fixture or injected Telegram file reference does not establish phone ingress.
2. Inspect the owner route, limits and actual privacy disclosure, then consent to **one** transcription from that capture. Observe real `transcribing` state, success/failure and `transcriptSource:provider`; compare the transcript with what was spoken. Verify RU, KK, EN and code-switching accuracy with separately authorized clips rather than assuming model quality.
3. Check that successful text extraction yields three distinct unchecked cards with honest date/time/missing-information labels. Do not confirm all. Select only DBMS, confirm explicitly, reload and replay the same request: one task/receipt should exist while the workout and filming ideas remain unapproved.
4. Search/reopen history; inspect provenance and receipts. Correct/reject a remaining pending card and verify a new revision clears old selection. No second transcription is offered for a capture that already has text or successful actions.
5. Use separate fresh consented captures for cancellation and provider failure/budget denial/reference expiry. A late result must not replace cancelled state; manual transcript/review must remain available. These failure experiments require their own owner-approved scope and must not alter ordinary owner records.
6. Record the served model, safe accounting/provenance, actual deployed SHA, results and limits without audio, transcripts, keys or auth headers in public evidence. Until that happens, real automatic STT and phone ingress remain **unverified**.

## Existing meal-photo review remains separate

The existing shared `MealPhotoReview` uses the nutrition capability endpoint, local image preparation, explicit per-photo external-analysis consent and an **estimated** editable draft. Label, portion, calories/macros and unknown values remain reviewable; a separate explicit confirmation saves the meal through the existing Ideal Human workflow. Unavailable analysis leaves manual nutrition logging usable. A model estimate is not a measured nutritional fact. Nighthawk 2 neither adds a second photo inbox nor authorizes a new vision provider request.

## Retention and compatibility for the candidate

The v1 live-history/deletion/backup rules below remain the boundary: history defaults to keep-until-delete, optional 7/30/90-day expiry is owner chosen, and audio references expire independently. Live deletion scrubs content while preserving a minimal owner/ID/request-fingerprint tombstone for dedupe. It does not delete the original Telegram message or undo approved domain records.

Encrypted backups follow a separate **30-day policy with at least seven verified copies**; pruning pauses when off-site copying fails, currently due to quota. Archives may therefore persist longer than 30 days, and live deletion does not scrub existing archives. Independent key custody/off-host recovery and real handset alert delivery remain outstanding.

Candidate presentation/provenance/processing metadata uses a separate workflow projection, with an additive v2 RPC; the v1 RPC keeps its old public shape for rollback. This does not replace a fresh matching encrypted backup, isolated restore, source/artifact binding and reader-compatible application rollback before release. The new exact changed-file manifest and deployment evidence are **PENDING**; the following 65/66-file appendix is the historical v1 record only.

## Historical v1 verified release — November 3, 2026

The following record describes the deployed v1 application and its verification at release time. References to “this release”, unavailable ports and test/file counts in this section are historical v1 statements; they do not describe Nighthawk 2 source readiness or a new deployment.

LifeOS is running application commit **`7ca304bf07b835a57cda004fc0dead2638dba607`**, promoted on **November 3, 2026 at 18:30:35 UTC**. The loaded local/HTTPS health version and publicly delivered TMA JavaScript/CSS were verified. This merged application's tree matches tested source `47114791b411f41bd1e1bfd01ed0a5f4d9e82e63`; the deployment is verified beyond GitHub merge state.

Production database migration 55 was acknowledged at 18:23:49 UTC. All 32 original factual-table projections and existing router settings were preserved. Actual production checks used two clearly marked synthetic owners, followed by cleanup across 66 owner tables. No production database reset or production restore was performed.

Automatic speech-to-text and LLM extraction remain **unavailable**. Real phone-recorded Telegram voice reception and handset delivery remain **unverified**. The deterministic text/manual-transcript workflow is implemented, with actual production evidence below and separate source/fixture coverage for additional action types.

### Capture and review

The Telegram Mini App and authenticated Next.js dashboard share one `CaptureInbox` component. Open **Входящие** from More/sidebar navigation or **Записать мысль** from Home/Today. Text and complete HTTP(S) links can be captured; links are stored without downloading their destinations. A Telegram voice record can receive a manual transcript through the same private review flow. This release's synthetic voice-metadata test does not establish real phone-recorded ingress.

Capturing input creates durable private history and proposals, without approving domain actions. Original text, transcripts, saved preferences and model output cannot grant permissions. The owner checks only the desired actions and presses **Подтвердить выбранные действия**. All actions begin unchecked. Missing details, unavailable permissions, completed actions, archived captures and expired reviews block approval. Typed forms replace raw JSON/tool editing; task updates/completion select an existing owned task and its current version.

Edits advance the capture revision and clear the previous selection. Confirmation sends `confirmed:true`, the reviewed revision, selected action IDs and a stable request ID. An unchanged ambiguous retry retains that ID. The database transaction checks stored proposals, revision, expiry, permissions and idempotency before writing. Durable completed-action receipts prevent replay; unselected proposals stay unapproved. Cancelling proposals, archiving history or deleting source input does not undo previously approved domain records.

The interface retains unsaved drafts, guards navigation and offers explicit retries. A synchronous write lock blocks duplicate submissions before React rerenders. Sequenced/aborted history, detail and memory reads cannot replace newer accepted state; processing polling is bounded and cannot roll a record back to an older revision. React 19's controlled textarea accessible-name regression was reproduced without data loss and corrected with stable explicit labels. A 12rem minimum fixes the narrow state-filter layout, with an actual select-width assertion of at least 180px in shared browser tests.

### Actions and verified scope

| Proposal                                                              | Implemented result after explicit approval                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `task.create`, `task.update`, `task.complete`                         | Existing task storage; updates/completion use the selected task version. Omitted notes/due date preserve existing values. |
| `reminder.create`                                                     | Existing reminders; a reviewed, real reminder instant is required.                                                        |
| `planning.suggest`                                                    | A proposal in the existing Ideal Human journal; no automatic calendar write or assumed completion.                        |
| `study.record`, `learning.note`                                       | Existing Ideal Human study records/notes, without invented duration/completion.                                           |
| `meal.record`                                                         | Existing journal meals; unknown macros remain null and estimates are labelled.                                            |
| `water.log`                                                           | Existing hydration storage with an explicitly reviewed positive amount.                                                   |
| `workout.note`, `reflection.add`, `filming.idea`                      | Existing Ideal Human fields. A note does not complete a workout; an idea does not mark footage as filmed.                 |
| `note.save`                                                           | A private database note. This slice does not add an Obsidian mirror for these notes.                                      |
| `question.read`                                                       | An allowlisted read of saved LifeOS data; no external inference or domain-write permission.                               |
| `memory.remember`, `memory.update`, `memory.archive`, `memory.delete` | Existing assistant memory through explicit review; permanent deletion additionally requires the destructive-memory flag.  |

All 14 domain and 4 memory proposal kinds have typed validation/forms and source/isolated/fixture coverage. The live smoke specifically exercised selected task/water writes and receipt replay, Day 1 journal/filming merges, memory create/update/archive and deletion denial, read-question summaries, history/CAS/archive/delete and ownership boundaries. It did not execute every action kind against production. Browser-created Note captures remained pending and were deleted without approving `note.save` or other domain actions; private-note persistence is additionally covered by isolated source/SQL tests.

Memory never grows automatically from a conversation. Its forms use explicit deterministic remember/update/archive/delete commands, then the same separate proposal review. Keys remain stable while editing an existing memory. Permanent deletion is disabled in the verified production capability; archive is available instead.

### Context, dates and privacy

Context shows actual backend date/timezone, commitments, known deadlines, source freshness warnings and suggested ordering. Saved owner-only facts include recorded health with provenance/staleness/missing values, active-workout set progress, the saved program without invented session times, and saved Ideal Human items without assumed completion. Explicit preferences/constraints appear separately. Actual production browser reads verified saved facts rendering without actions. These context reads do not send data to an external provider.

Ideal Human journal dates use **Asia/Almaty**, including Day 1 on **November 3, 2026**, even when the profile timezone differs. Task/reminder interpretation retains the profile timezone. Missing university schedules remain unknown. LMS reconnect/freshness remains a real operational warning; the interface does not invent class times or circumvent campus authentication.

History is owner scoped, paginated and searchable. Private search uses JSON in `POST /captures/search`, never the URL. Deep links contain at most an opaque capture ID. Initial web history is read by the authenticated server. Frontends hold no service-role key and do not access the database directly.

The existing signed Telegram initData and revocable native web sessions remain the browser boundaries. The web bridge uses exact method/resource allowlisting, mutation Origin checks, bounded JSON, no redirects and cookie-derived identity. JSON DELETE forwarding is limited to the capture UUID resource; reminder deletion semantics remain unchanged. Public projections hide raw Telegram file IDs, download URLs, internal receipt resource IDs and provider/database diagnostics. No capture input is persisted in localStorage/sessionStorage.

### Voice and model status

The running service reports `aiExtraction:false` and transcription `unavailable`. Deterministic extraction performs no paid inference. Telegram metadata is bounded to **5 MiB / 120 seconds**; audio bytes are not persisted and server-only references expire independently within 24 hours. The browser does not request a microphone on load, play stored audio or claim recognised speech. Its voice button explains Telegram and the manual-transcript fallback.

A dormant governed speech-adapter port and validated model-proposal boundary are prepared and tested with mocks. They reuse the durable AI governor, budgets, permissions, cancellation and execution limits; there is no second agent framework. They are not wired production STT/LLM integrations. No provider-key form, OAuth flow or new subscription access is enabled by capture. ChatGPT subscription access is not ordinary API credit, and third-party subscription tokens are not generic provider credentials.

A later live adapter needs verified pricing/capabilities, owner authorization before any paid request, required provider/browser consent and the existing privacy/budget controls. Configured Gemini/OpenRouter/direct-provider settings do not automatically grant capture authority. The production smoke made **zero provider requests, downloaded zero audio bytes, started zero OAuth flows and requested zero Telegram sends**. A synthetic metadata/manual-transcript API/browser test is explicitly distinguished from an actual phone-recorded voice test.

### Retention and deletion

`retentionDays:null` is the default: keep private history until its owner deletes it. The owner can explicitly choose 7, 30 or 90 days instead. Legacy captures retain their contents as completed history without executable proposals; ordinary processing/expiry sweeps do not silently convert or delete them. Archive hides a record from the default list, and **Вернуть запись из архива** restores visibility without executing actions.

Deletion requires explicit confirmation and the current revision. It scrubs live input/transcript, Telegram reference, proposals and review history, and removes the capture from normal reads/searches. It does not physically remove every database trace: a minimal owner/record-ID/ingestion-request-fingerprint tombstone and necessary scrubbed version/status/timestamp bookkeeping remain to prevent a replay from resurrecting deleted input. The fingerprint is not original text and is not exposed by the browser projection. Actual production smoke verified both the scrubbed tombstone and dedupe behavior.

Approved tasks, hydration, journal entries and memory are independent domain records. Removing source history does not undo them. An original Telegram message is also independent; deleting LifeOS history does not delete that chat message. Permanent memory deletion is a distinct gated operation.

Encrypted recovery copies are independent from live deletion. Managed local backup policy normally selects verified archive/manifest pairs older than **30 days**, preserving at least seven copies. Pruning pauses while an off-site copy is failing; the current quota failure therefore means archives can persist longer than 30 days. This is not a maximum deletion deadline. Live capture deletion does not scrub or rewrite existing encrypted archives, and no off-site retention deletion is enabled. Capture keep/7/30/90-day choices are separate from this backup policy.

### Verified deployment and recovery

| Evidence                | Verified result                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loaded application      | `7ca304bf07b835a57cda004fc0dead2638dba607`, live 18:30:35 UTC; local and public HTTPS health report that SHA. Bot and web were restarted onto the reviewed artifacts.                                                                                                                                  |
| Tested/build source     | `47114791b411f41bd1e1bfd01ed0a5f4d9e82e63`; source tree equality and artifact input/hash bindings verified for the merged release.                                                                                                                                                                     |
| Public TMA JavaScript   | `/tma/assets/index-C1SHC686.js`, 399,443 bytes, SHA-256 `082bd4ecc5b706939d2ea1b91732c84e06ef51e1b562dd80e94c16bff89754f4`.                                                                                                                                                                            |
| Public TMA CSS          | `/tma/assets/index-DQxiR9us.css`, 35,989 bytes, SHA-256 `0e07dfec3986d24d84b905b820ad933e70016379d1991f5ab7a7352ac5f7d401`. Both public assets matched indexed files without redirects/authentication.                                                                                                 |
| Database                | Migration 55 acknowledged 18:23:49 UTC; all 32 original factual-table projections preserved. App promotion applied no additional migration and restored no production database.                                                                                                                        |
| Actual matching backup  | Schema 55 encrypted archive completed 18:27:56 UTC, 1,114,661 bytes; SHA-256 `c6c8a2147425a895d2fec347600eb149e501117f67509fb5137a3ed8740fd8e2`. Verified archive/manifest and schema agree.                                                                                                           |
| Actual matching restore | Completed 18:28:55 UTC with installed recovery tooling and actual PostgreSQL 17 in an isolated network-none environment, production source unavailable. Schema 55, six counted tables and canonical owner matched; isolated container removed. This was an isolated restore, not a production restore. |
| Application fallback    | Preserved source `764f5d4746c843f0f2164cfcc33afaf62712b92c`; actual old fallback reader accepts all 7 saved journal kinds in Asia/Almaty, preserves unknowns and made no DB/provider requests. Rollback retains schema 55, tombstones and approved records. No production rollback was performed.      |
| Operations source       | `60c046a55a2789bdd609eaea647cc6c77448da8d`; loaded monitor command/unit/source matched reviewed operations bytes before/after promotion, with no hidden drop-ins.                                                                                                                                      |

`LIFEOS_CAPTURE_ENABLED` and `LIFEOS_CAPTURE_WORKER_ENABLED` are active for this release. The existing router and paid-request gates remain off; the destructive-memory flag remains off. Capture flags do not grant paid inference authority. A future release still requires a fresh matching backup, actual isolated restore, compatible rollback and preserved owner data.

### Verification results

| Check                     | Result and practical scope                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and unit/API   | PASS; 1,844 tests, including authorization/Origin/body limits, CAS/idempotency, expiry, selected approval and safe errors.                                                                                                                                            |
| Workers / operations      | PASS; 387 worker and 47 operations tests. Reused checks are bound to byte-identical relevant source.                                                                                                                                                                  |
| Migration/self-host       | PASS; isolated SQL/RLS/ownership/idempotency/recovery checks. Auxiliary release checks include 6 filesystem safety and 11 environment guard tests.                                                                                                                    |
| Staged browsers           | PASS; 81 fixture scenarios across web/TMA/Ideal Human/Capture, including error/empty/dirty/retry states and narrow layouts. The filter fix had fresh frontend builds and capture/web browser runs.                                                                    |
| Existing Telegram menu    | 13 existing menu labels preserve command routing rather than becoming capture text; focused menu/webhook/client regressions pass. No physical phone menu interaction is implied.                                                                                      |
| Dependency audit          | 117 production dependencies; 0 reported vulnerabilities at this release audit.                                                                                                                                                                                        |
| Configured-secret scans   | 65 changed source files and 797 compiled files scanned against 11 configured non-placeholder secret values; 0 matches. Placeholder exclusions and artifact hash binding are explicit. This is a defined scan, not proof that every possible secret pattern is absent. |
| Actual production API     | PASS; 11 groups on the deployed app, with `apiMocks:false`. Includes real selected writes, receipt replay, owner isolation, CAS/history/delete, Day 1 journal/memory/read behavior and unavailable-provider gates.                                                    |
| Actual production browser | PASS; 43 groups with `apiMocks:false`: genuine one-use web login at 320/1440 px, signed TMA at 320/390 px, owner-B opaque-ID denial, saved context/receipts/manual transcript/archive search, no overflow and no microphone requests.                                 |
| Actual browser mutations  | Exactly 8 history mutations: 4 controlled pending-Note creations and 4 explicitly confirmed deletions, each durable across reload. No browser action approvals or domain writes.                                                                                      |
| Cleanup / preservation    | Synthetic owners removed; 66 owner tables checked empty, synthetic capture tombstones removed by their owner cascade, no active fixture identity manifest. All 32 original factual-table projections and router settings remained unchanged.                          |

The API parent made its explicitly selected task/water, Day 1 journal, memory and read-summary writes only for the two synthetic owners. Its final invariants confirmed zero fixture AI reservations/outbound jobs; cleanup removed fixture data without deleting canonical owner rows. Browser-created Note captures never approved a note/domain action.

A genuine scheduled monitor invocation after promotion checked 20 conditions at 18:34:28 UTC: **18 OK, 2 WARN, 0 FAIL**, with 0 alert attempts. The warnings are LMS reconnect/freshness and unavailable off-site backup. All 9 supported service PIDs/invocations/restart counts stayed stable over observation; backup, monitor and restore-drill timers were loaded, enabled and active. During the production smoke at 18:36:31 UTC, bot/web memory was about 205/141 MiB, both services were active, and the scoped journals contained 0 entries matching the error checks.

Alerting is configured and uses durable reservations, recipient validation and acknowledgement-aware recovery. This release did not inject a production failure, trigger a manual monitor run or send an alert. An existing reserved LMS delivery remains unacknowledged; no new alert/recovery handset delivery is claimed. The post-promotion timer run demonstrates active monitoring, not delivery to a physical phone.

Safe release evidence is held under `/home/zalewko/lifeos-release-state/nighthawk-20261103`: `promotion-result.json`, `schema55-backup-proof.json`, `runtime-observation.json`, `runtime-during-smoke.json`, `capture-production-smoke-result.json`, `capture-production-browser-result.json`, `artifact-scan-binding-proof.json`, security audit/scans and source-bound QA summaries. No tokens, auth headers or private response bodies belong in user-facing reports.

### Remaining limits and priorities

- Automatic STT/LLM extraction has no enabled production adapter. Any future live provider needs separate owner authorization/consent, privacy/budget verification and real adapter tests through the existing governor; mock ports are preparation only.
- Real phone-recorded Telegram voice/file behavior and physical handset alert receipt remain unverified. Synthetic metadata/manual text is not a substitute.
- Off-site upload remains blocked by storage quota; local encrypted backup/actual isolated restore are verified. Independent recovery-key custody and verified off-host recovery remain outstanding. No paid storage upgrade was enabled.
- LMS reconnect/authentication/freshness remains unresolved; no restriction was bypassed and no schedule time was invented.
- `note.save` remains database-only without a new Obsidian mirror. Permanent memory deletion remains deliberately disabled.

Prioritize those independently verifiable reliability/consent tasks before additional feature development. Existing approved domain records, legacy history and canonical owner identities must remain intact.

### Historical v1 changed-file scope

The November 3 v1 feature source change set contained 65 unique paths, copied verbatim in Appendix A and available as the [exact 65-file manifest](/home/zalewko/lifeos-release-state/nighthawk-20261103/changed-files.txt). The v1 report update additionally changed `docs/OVERNIGHT_PHASE2_REPORT.md`, giving 66 unique paths in that historical source-plus-report scope. These counts and this appendix are not the Nighthawk 2 manifest; the final candidate manifest belongs in the release evidence. This documentation update does not alter application code or the actually loaded application SHA.

### Historical v1 Appendix A — exact 65 feature source paths

<!-- BEGIN EXACT CHANGED FILES -->

```text
.env.example
.github/workflows/ci.yml
apps/bot/src/capture-context.test.ts
apps/bot/src/capture-context.ts
apps/bot/src/capture-routes.test.ts
apps/bot/src/capture-routes.ts
apps/bot/src/capture-service.test.ts
apps/bot/src/capture-service.ts
apps/bot/src/capture-telegram-adapter.ts
apps/bot/src/server.ts
apps/bot/src/telegram/capture-webhook.test.ts
apps/bot/src/telegram/capture.test.ts
apps/bot/src/telegram/capture.ts
apps/bot/src/telegram/client.test.ts
apps/bot/src/telegram/client.ts
apps/bot/src/telegram/commands.test.ts
apps/bot/src/telegram/commands.ts
apps/bot/src/telegram/types.ts
apps/bot/src/telegram/voice.test.ts
apps/bot/src/telegram/voice.ts
apps/tma/src/App.tsx
apps/tma/src/api/capture.ts
apps/tma/src/components/AppShell.tsx
apps/tma/src/components/capture/ActionEditor.test.ts
apps/tma/src/components/capture/ActionEditor.tsx
apps/tma/src/components/capture/CaptureDetail.tsx
apps/tma/src/components/capture/CaptureInbox.test.ts
apps/tma/src/components/capture/CaptureInbox.tsx
apps/tma/src/components/capture/ContextPanel.tsx
apps/tma/src/components/capture/MemoryPanel.tsx
apps/tma/src/components/capture/errors.ts
apps/tma/src/components/capture/model.test.ts
apps/tma/src/components/capture/model.ts
apps/tma/src/components/capture/transport.test.ts
apps/tma/src/components/capture/transport.ts
apps/tma/src/screens/CaptureScreen.tsx
apps/tma/src/screens/HomeScreen.tsx
apps/tma/src/types.ts
apps/web/app/(dashboard)/capture/page.tsx
apps/web/app/(dashboard)/today/page.tsx
apps/web/app/api/bridge/[...path]/route.test.ts
apps/web/app/api/bridge/[...path]/route.ts
apps/web/components/AppShell.tsx
apps/web/components/workspaces/CaptureWorkspace.tsx
apps/web/lib/bridge-policy.test.ts
apps/web/lib/bridge-policy.ts
apps/web/scripts/test-dashboard-browser.mjs
apps/web/tailwind.config.ts
docs/UNIVERSAL_CAPTURE_ASSISTANT.md
packages/core/src/index.ts
packages/core/src/universal-capture.test.ts
packages/core/src/universal-capture.ts
packages/db/src/capture-store.test.ts
packages/db/src/capture-store.ts
packages/db/src/index.ts
packages/db/src/lifeos-store.ts
scripts/capture-browser-fixtures.mjs
scripts/capture-browser-scenarios.mjs
scripts/test-capture-browser.mjs
scripts/test-universal-capture-migration.sh
scripts/universal-capture-test-fixtures/assertions.sql
scripts/universal-capture-test-fixtures/helpers.sql
scripts/universal-capture-test-fixtures/prepare.sql
scripts/universal-capture-test-fixtures/setup.sql
supabase/migrations/20261103060000_universal_capture.sql
```

<!-- END EXACT CHANGED FILES -->

Historical v1 additional report-only path: `docs/OVERNIGHT_PHASE2_REPORT.md`.
