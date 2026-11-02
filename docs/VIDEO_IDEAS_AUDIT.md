# Exact-video ideas audit

Source requested: [YouTube video e9PweZXIzbw](https://www.youtube.com/watch?v=e9PweZXIzbw). Backlog: [issue #21](https://github.com/ZaleshSultan/lifeos/issues/21) and its [Gemini review comment](https://github.com/ZaleshSultan/lifeos/issues/21#issuecomment-6586123867).

## Evidence and limits

At `2026-11-02T19:54:07Z`, a fresh local Chromium session opened the exact public watch URL, without account cookies or an authentication bypass. YouTube returned HTTP 429. No title, author, duration, description, player metadata or subtitle track was available. The exact-page screenshot and metadata result are retained privately in the phase 2 release evidence under `video-audit/`.

At `2026-11-02T20:54:50Z`, an independent public web-tool review opened the exact [official short link](https://youtu.be/e9PweZXIzbw), which redirected to the matching YouTube watch ID. The returned page title was **“я позволил нейронке управлять моей жизнью”**. Its readable body contained only YouTube navigation/footer, with no substantive video description or transcript. Direct watch, official oEmbed, embed and public timed-text listing requests returned the tool diagnostic `Online fetch throttled`; those failures do not establish a new YouTube HTTP status. An exact-ID search found no results. No account connection, paid transcript provider, rate-limit bypass or repeated request loop was used.

**Original video content/transcript verification: BLOCKED; exact page title: VERIFIED.** No video timestamps, spoken quotations, creator identity, duration or feature claims are independently established. Apart from the title above, the corresponding claims in the supplied Gemini report remain third-party claims. An accessible creator-provided transcript or a later normal authorized viewing session is needed to verify those claims. No unrelated search result is substituted, and the title alone does not prove the reported feature contents.

The following engineering mapping uses the user's explicit backlog and inspected LifeOS code. It does not assert that these ideas appeared at a particular point in the inaccessible video.

## Mapping and deduplication

All source times below are **unverified**; ideas are Gemini-reported unless separately specified by the user's issues.

| Reported idea                         | Existing LifeOS behavior                                                            | Concrete gap / benefit                                                            | Effort       | Privacy and security                                                               | Priority / decision                            |
| ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| Persistent personal assistant         | Existing bounded Brain, tool registry, confirmations and opt-in memory              | Improve budgets, cancellation and availability; preserve one system               | Small–medium | Tool authority and sensitive memory need strict limits                             | P1; #24, extend existing Brain                 |
| Morning overview                      | Existing owner-scoped digest worker and local-time delivery                         | Add recorded health, Ideal Human and freshness caveats                            | Medium       | Health inclusion needs explicit preference; avoid unsolicited delivery             | P1; #17, reuse existing scheduler              |
| Interactive water logging             | Existing Telegram callback infrastructure                                           | Idempotent quick/custom water entries and undo                                    | Small–medium | Owner-scoped callbacks and exact retry receipts                                    | P1; #22, existing store/API boundary           |
| Food-photo estimates                  | Existing manual Ideal Human meals                                                   | Optional vision draft, correction and explicit save                               | Medium       | Per-photo external-analysis consent; uncertain portions; no silent write           | P2; #23, keep manual fallback                  |
| Calendar and tasks                    | Existing planner and authoritative task/event tables                                | Useful secure web controls and honest distinction between events and suggestions  | Medium       | Per-user reads, CSRF and conflict-safe writes                                      | P1; #15, no second calendar database           |
| Smart scale / health automation       | Existing Health Connect bridge and ingest                                           | Reuse available authorized source measurements and show freshness                 | Medium       | No invented Bluetooth/device support or automatic overwrite of manual observations | P1; #18, device verification remains separate  |
| YouTube performance                   | No authorized creator analytics grant verified                                      | Optional future owner-only read reports                                           | Medium       | Explicit channel/account authorization and read-only scopes                        | P3; #26, blocked on consent/configuration      |
| Sponsorship inbox                     | No designated creator inbox authorized                                              | User-controlled proposal notes and draft assistance before any mailbox connection | Medium–large | Email/attachments are untrusted; no sending or binding acceptance                  | P3; #26, no personal/university/TASTAMA access |
| Voice and external assistants         | Proposed disabled v1 capability contract; no existing personal-data AGATA API found | Optional typed adapter if service is verified available                           | Medium–large | Voice privacy and constrained authority; no unrestricted SQL/shell                 | P3; #25, do not duplicate the Brain            |
| Mac Mini / OpenClaw / local inference | Working Debian Node/Python/Supabase system                                          | No verified need for replacement hardware/framework                               | Large        | Added attack surface, operating cost and memory pressure                           | Defer; no installation or purchase             |
| Editable agent identity through notes | Obsidian is a mirror; core settings are validated                                   | Any future customization should be structured preferences                         | Medium       | Notes must not become executable authority or raw system prompts                   | Proposal only; no hot prompt reload            |

## At most three lean MVPs

1. **Execution limits (#24):** configurable request/token/time/concurrency limits and safe failure, using the existing AI boundary. Highest reliability value; independently testable without a real provider call.
2. **Water quick logs (#22):** atomic owner-scoped entries, request/callback idempotency and undo in Supabase; existing Telegram/TMA/web controls.
3. **Reviewed meal estimate (#23):** optional configured vision adapter produces a draft; user corrects and explicitly saves to the existing daily meal collection.

These are already separate, explicitly authorized LifeOS issues. Their phase 2 implementation is justified by that backlog, not by unverified video claims. No feature is introduced solely as a result of the blocked video review. All additional video-inspired proposals remain for later prioritization.

## Architecture recommendation

Keep deterministic business rules in `packages/core`, persistence and atomic receipts in `packages/db`, authentication/provider calls in `apps/bot`, and the existing notification worker as the delivery mechanism. Reuse the Ideal Human journal for meal/documentary metadata and existing workout records for training. Optional providers may fail without breaking manual workflows. Do not import untrusted install scripts, replace Debian hosting, add a second agent framework, or expose mirror notes as trusted instructions.

Issue #21's audit document is complete; verification of the original video's substantive content remains blocked. No fabricated transcript, timestamp, model benchmark, voice capability or creator analytics result is claimed.
