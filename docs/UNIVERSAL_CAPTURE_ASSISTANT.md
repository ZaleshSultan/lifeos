# Universal Capture Assistant (Nighthawk)

This document describes the implementation in the Nighthawk worktree for Issue #50. It does not establish that the feature is deployed or that a real Telegram voice message has been received in production. Release and validation evidence is recorded separately below and in `docs/OVERNIGHT_PHASE2_REPORT.md`.

## Capture and review

The Telegram Mini App and authenticated Next.js dashboard share one `CaptureInbox` component. Open **Входящие** from More/sidebar navigation or **Записать мысль** from Home/Today. Text and complete HTTP(S) links can be captured; a link is stored as text, without downloading its destination. A voice recording received through Telegram can be found in the same private history and given a manual transcript.

Capture creates a durable private input and reviewable proposals. Original text, transcripts, saved preferences and model output cannot grant permissions. Domain actions run only after the authenticated owner checks the desired actions and presses **Подтвердить выбранные действия**. Every action starts unchecked. Missing details, unavailable permissions, completed actions, archived captures and expired reviews block approval. Typed forms allow corrections without exposing a JSON/tool editor. Existing tasks are selected from owned task data rather than entered as opaque IDs.

Edits advance the capture revision and discard the previous selection. Confirmation includes `confirmed:true`, the reviewed revision, selected action IDs and a stable request ID. Retrying the same ambiguous confirmation keeps that request ID. The database transaction checks the stored proposals, revision, expiry, permissions and idempotency before writing. Already completed actions have durable receipts; retrying processing does not approve or repeat them. Cancelling proposals, archiving a capture or deleting its history does not undo previously saved domain records.

## Actions and existing data

| Proposal                                                              | Result after explicit confirmation                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.create`, `task.update`, `task.complete`                         | Existing task storage; updates/completion use the selected task's current version. Omitted update notes/due date preserve existing values.    |
| `reminder.create`                                                     | Existing reminder storage; a real reminder instant is required.                                                                               |
| `planning.suggest`                                                    | A proposed plan in the existing Ideal Human journal, without calendar writes or assumed completion.                                           |
| `study.record`, `learning.note`                                       | Study records/notes in the existing Ideal Human journal. Unknown duration or factual completion is not invented.                              |
| `meal.record`                                                         | Existing journal meal entry; unknown macros remain null and estimates are labelled.                                                           |
| `water.log`                                                           | Existing hydration storage, with an explicitly reviewed positive amount.                                                                      |
| `workout.note`, `reflection.add`, `filming.idea`                      | Existing Ideal Human journal fields. A workout note does not complete a workout; a filming idea does not mark footage as filmed.              |
| `note.save`                                                           | A private database note. This slice does not add an Obsidian mirror for these notes.                                                          |
| `question.read`                                                       | An allowlisted read of existing LifeOS data, without external model inference or write permission.                                            |
| `memory.remember`, `memory.update`, `memory.archive`, `memory.delete` | Existing assistant memory, only through explicit owner review. Permanent deletion additionally requires the existing destructive-memory flag. |

Context shows the backend's actual date/timezone, commitments, known deadlines, source freshness warnings and proposed ordering. Explicitly saved preferences/constraints are displayed separately. Missing university schedules remain unknown; the interface never invents class times. Memory is data rather than authority.

## Voice and provider status

The current capture service uses deterministic extraction and reports `aiExtraction:false` and transcription `unavailable`. No new paid provider or speech-to-text request is enabled by this feature. The existing AI governor/router is not duplicated. No provider keys or subscription OAuth tokens are entered into capture forms.

Telegram voice metadata is bounded to **5 MiB / 120 seconds**. The page does not request microphone access on load and does not claim to have recognised speech. Its voice button explains the Telegram flow and the manual-transcript fallback. A received recording remains `awaiting_transcript` until text is supplied. Browser projections do not expose Telegram file IDs, download links or audio bytes. Server-only Telegram references expire independently within 24 hours; audio bytes are not persisted by this slice.

Any later STT/model integration needs its own verified adapter, owner consent where required, privacy/budget checks and tests through the existing governor. A configured provider or sign-in link alone does not mean transcription or inference is working.

## History, retention and privacy

History is owner scoped, searchable and paginated. Search text travels in the JSON body of `POST /captures/search`, never in the browser URL. Only an opaque capture ID is accepted for a deep link. Initial web history uses an authenticated server read; the shared component has injected transports rather than browser database credentials.

The default `retentionDays:null` keeps the private capture until its owner deletes it. The owner can explicitly select 7, 30 or 90 days instead. This is separate from the short-lived Telegram reference and review expiry. Legacy captures retain their original contents and are shown as completed history without executable proposals; ordinary processing/expiry sweeps do not silently convert or delete them.

Archive removes an item from the default active-history search. The archive filter reveals it; **Вернуть запись из архива** restores its visibility without performing actions. Deletion requires an explicit confirmation and the current revision, and removes the original input, transcript and capture history. It does not undo approved tasks, hydration or journal facts. Permanent memory deletion is a distinct operation and remains unavailable when the destructive-memory flag is off.

No private captures are stored in localStorage/sessionStorage. The existing authenticated TMA transport and revocable web sessions remain the only browser API boundaries. The web bridge has an exact method/resource allowlist, exact mutation Origin checks, bounded JSON and cookie-derived identity. Its JSON DELETE forwarding is limited to the capture resource; existing reminder deletion semantics remain unchanged. Raw provider/database diagnostics are not shown as product copy.

## Operations and recovery

`LIFEOS_CAPTURE_ENABLED` controls capture availability; `LIFEOS_CAPTURE_WORKER_ENABLED` controls bounded background processing. `LIFEOS_ASSISTANT_MEMORY_DELETE_ENABLED` retains its existing destructive-memory role. Check `apps/bot/src/capture-service.ts` for current defaults and the production service environment for effective values. These flags do not authorize paid AI calls.

The UI keeps unsaved input on failures, warns before abandoning edited forms and provides explicit retries. A synchronous write lock prevents double submission before React rerenders. Accepted edits/confirmations reset the previous selection. Older history/detail/memory responses are aborted and sequenced so they cannot replace a newer accepted revision; polling never rolls a capture back to an older revision. Processing and transport waits are bounded. If a response is ambiguous, reload the capture or retry the same operation rather than create another action.

Before deploying, root must verify a current database/application backup, an actual restore, compatible migration state and a concrete rollback. Disabling capture is an application recovery option; it does not reset user data. Rollback must preserve the additive migration and already saved domain records unless a separately verified recovery procedure requires otherwise.

## Source map

- Domain contracts, deterministic extraction, validation and journal application: `packages/core/src/universal-capture.ts` and its colocated tests.
- Owner-scoped persistence/RPC boundary: `packages/db/src/capture-store.ts`, its tests and `supabase/migrations/20261103060000_universal_capture.sql`.
- Authenticated routes, processing/context and Telegram adapter: `apps/bot/src/capture-routes.ts`, `capture-service.ts`, `capture-telegram-adapter.ts`; Telegram capture/voice adapters under `apps/bot/src/telegram/`.
- Shared browser UI: `apps/tma/src/components/capture/{CaptureInbox,CaptureDetail,ActionEditor,ContextPanel,MemoryPanel}.tsx`; injected contract/formatting/error helpers in `transport.ts`, `model.ts`, `errors.ts`; focused colocated tests.
- TMA integration: `apps/tma/src/api/capture.ts`, `screens/CaptureScreen.tsx`, `App.tsx`, `types.ts`, `components/AppShell.tsx`, `screens/HomeScreen.tsx`.
- Web integration: `apps/web/app/(dashboard)/capture/page.tsx`, `components/workspaces/CaptureWorkspace.tsx`, `components/AppShell.tsx`, `app/(dashboard)/today/page.tsx`.
- Bridge policy/body forwarding and negative tests: `apps/web/lib/bridge-policy.ts`, `apps/web/app/api/bridge/[...path]/route.ts` and their colocated tests.
- Shared private fixtures/scenarios: `scripts/capture-browser-fixtures.mjs`, `scripts/capture-browser-scenarios.mjs`; TMA runner `scripts/test-capture-browser.mjs`; authenticated Next runner `apps/web/scripts/test-dashboard-browser.mjs`.

## Validation and release evidence

Root will fill these entries after verification. Source implementation, fixture execution and production verification are separate claims.

| Evidence                                              | Verified result                   |
| ----------------------------------------------------- | --------------------------------- |
| TypeScript and focused/full unit/API tests            | Pending root validation record    |
| Isolated migration/RLS/idempotency tests              | Pending root validation record    |
| Staged TMA and Next builds                            | Pending root validation record    |
| TMA fixture browser at 320/390 pixels                 | Pending root validation record    |
| Authenticated web fixture browser and owner isolation | Pending root validation record    |
| Backup restore and rollback                           | Pending root release record       |
| Deployed application and migration SHA                | Not yet verified for this feature |
| Real Telegram voice ingress/manual transcript         | Not yet verified for this feature |
| Paid STT/model requests                               | Not enabled by this feature       |
