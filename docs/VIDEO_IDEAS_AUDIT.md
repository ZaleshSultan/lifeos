# Exact-video ideas audit

Source requested: [YouTube video e9PweZXIzbw](https://www.youtube.com/watch?v=e9PweZXIzbw). Backlog: [issue #21](https://github.com/ZaleshSultan/lifeos/issues/21) and its [Gemini review comment](https://github.com/ZaleshSultan/lifeos/issues/21#issuecomment-6586123867).

## Evidence and limits

The initial local Chromium check at `2026-11-02T19:54:07Z` received HTTP 429. A later public web-tool request verified the exact title but returned only navigation/footer. Those earlier access failures are historical, not the current source status.

At `2026-11-03T11:23:23Z`, a fresh authorized **local Chromium session** retrieved the exact watch URL with HTTP 200. Embedded public player metadata verified video ID `e9PweZXIzbw`, title **“я позволил нейронке управлять моей жизнью”**, creator **stelmie**, channel `UC1SGZ654INLnNrFsehz3yAw`, duration **600 seconds (10:00)**, a 987-character description and player status `OK`. The reported Gemini duration of 10:01 is not the returned duration. Metadata and description matched an independent direct public response. The screenshot shows the paused player and 10:00 duration; the surrounding page was still loading, so title/creator/description evidence comes from the browser's embedded player response, not a rendered heading.

The successful session used no account cookies or login bypass, blocked media requests and closed at `2026-11-03T11:24:04Z`. An initial browser launch timeout is retained separately; it was not a successful viewing. Raw HTML/player JSON, exact description, screenshot and a machine-readable evidence summary remain private under the phase 2 release evidence `video-audit/` directory, outside Git.

The description supplies these creator-authored chapter markers, paraphrased below. They establish chapter topics, **not the detailed capabilities claimed by Gemini**:

| Time  | Description chapter topic |
| ----- | ------------------------- |
| 00:00 | Unlabeled opening         |
| 00:25 | Beginning                 |
| 00:43 | Choosing a Mac            |
| 02:06 | Adapter                   |
| 02:22 | Attention / hype          |
| 02:49 | Setup                     |
| 04:17 | First functions           |
| 04:45 | First dialogue            |
| 06:39 | Help with the channel     |
| 08:04 | Real-life use             |
| 09:10 | Conclusions               |

Russian and English **automatically generated** caption tracks were listed. One ordinary request to the returned public Russian timed-text URL received HTTP 200 with **zero response bytes**. No transcript was retrieved, and playback was not used to verify spoken content. No timestamped quotation, specific feature demonstration, model benchmark or hardware configuration is independently established by these chapter labels.

**Exact source metadata/description/chapters: VERIFIED in a local browser. Transcript text: unavailable in this bounded check. Spoken feature claims: UNVERIFIED.** The supplied Gemini report remains a third-party account of the video's substantive content. A public transcript or a later human viewing is needed to check those claims. No unrelated video, paid transcript provider, account connection or rate-limit bypass was used.

The engineering mapping below uses the user's explicit backlog and inspected LifeOS code. Its chapter references are contextual only; they do not authenticate Gemini's specific feature claims.

## Mapping and deduplication

Specific feature times remain **unverified**. Where a creator chapter is related, the evidence column says exactly what its label establishes; ideas otherwise remain Gemini-reported or independently specified in the user's issues.

| Reported idea                         | Source time / evidence                                  | Existing LifeOS behavior                                                            | Concrete gap / benefit                                                            | Effort       | Privacy and security                                                               | Priority / decision                            |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| Persistent personal assistant         | 04:45 dialogue chapter only; persistence unverified     | Existing bounded Brain, tool registry, confirmations and opt-in memory              | Improve budgets, cancellation and availability; preserve one system               | Small–medium | Tool authority and sensitive memory need strict limits                             | P1; #24, extend existing Brain                 |
| Morning overview                      | Feature time unverified                                 | Existing owner-scoped digest worker and local-time delivery                         | Add recorded health, Ideal Human and freshness caveats                            | Medium       | Health inclusion needs explicit preference; avoid unsolicited delivery             | P1; #17, reuse existing scheduler              |
| Interactive water logging             | Feature time unverified                                 | Existing Telegram callback infrastructure                                           | Idempotent quick/custom water entries and undo                                    | Small–medium | Owner-scoped callbacks and exact retry receipts                                    | P1; #22, existing store/API boundary           |
| Food-photo estimates                  | Feature time unverified                                 | Existing manual Ideal Human meals                                                   | Optional vision draft, correction and explicit save                               | Medium       | Per-photo external-analysis consent; uncertain portions; no silent write           | P2; #23, keep manual fallback                  |
| Calendar and tasks                    | Feature time unverified                                 | Existing planner and authoritative task/event tables                                | Useful secure web controls and honest distinction between events and suggestions  | Medium       | Per-user reads, CSRF and conflict-safe writes                                      | P1; #15, no second calendar database           |
| Smart scale / health automation       | Feature time unverified                                 | Existing Health Connect bridge and ingest                                           | Reuse available authorized source measurements and show freshness                 | Medium       | No invented Bluetooth/device support or automatic overwrite of manual observations | P1; #18, device verification remains separate  |
| YouTube performance                   | 06:39 channel-help chapter only; analytics unverified   | No authorized creator analytics grant verified                                      | Optional future owner-only read reports                                           | Medium       | Explicit channel/account authorization and read-only scopes                        | P3; #26, blocked on consent/configuration      |
| Sponsorship inbox                     | Feature time unverified                                 | No designated creator inbox authorized                                              | User-controlled proposal notes and draft assistance before any mailbox connection | Medium–large | Email/attachments are untrusted; no sending or binding acceptance                  | P3; #26, no personal/university/TASTAMA access |
| Voice and external assistants         | Feature time unverified                                 | Proposed disabled v1 capability contract; no existing personal-data AGATA API found | Optional typed adapter if service is verified available                           | Medium–large | Voice privacy and constrained authority; no unrestricted SQL/shell                 | P3; #25, do not duplicate the Brain            |
| Mac Mini / OpenClaw / local inference | 00:43 Mac chapter only; specific model/setup unverified | Working Debian Node/Python/Supabase system                                          | No verified need for replacement hardware/framework                               | Large        | Added attack surface, operating cost and memory pressure                           | Defer; no installation or purchase             |
| Editable agent identity through notes | Feature time unverified                                 | Obsidian is a mirror; core settings are validated                                   | Any future customization should be structured preferences                         | Medium       | Notes must not become executable authority or raw system prompts                   | Proposal only; no hot prompt reload            |

## At most three lean MVPs

1. **Execution limits (#24):** configurable request/token/time/concurrency limits and safe failure, using the existing AI boundary. Highest reliability value; independently testable without a real provider call.
2. **Water quick logs (#22):** atomic owner-scoped entries, request/callback idempotency and undo in Supabase; existing Telegram/TMA/web controls.
3. **Reviewed meal estimate (#23):** optional configured vision adapter produces a draft; user corrects and explicitly saves to the existing daily meal collection.

These are already separate, explicitly authorized LifeOS issues. Their phase 2 implementation is justified by that backlog, not by unverified video claims. No feature is introduced solely as a result of this source review. All additional video-inspired proposals remain for later prioritization.

## Architecture recommendation

Keep deterministic business rules in `packages/core`, persistence and atomic receipts in `packages/db`, authentication/provider calls in `apps/bot`, and the existing notification worker as the delivery mechanism. Reuse the Ideal Human journal for meal/documentary metadata and existing workout records for training. Optional providers may fail without breaking manual workflows. Do not import untrusted install scripts, replace Debian hosting, add a second agent framework, or expose mirror notes as trusted instructions.

Issue #21's source audit now includes local-browser verification of the exact metadata, description and creator chapter labels. Transcript and spoken feature verification remain incomplete. The deduplicated implementation choices remain justified by independent user issues; no new feature is deployed solely on the video's unverified claims.
