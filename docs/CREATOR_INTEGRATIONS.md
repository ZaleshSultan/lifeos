# Creator planning and optional account integrations

Issue [#26](https://github.com/ZaleshSultan/lifeos/issues/26) covers future authorized YouTube analytics and a designated creator-business inbox. No YouTube or mailbox account is connected by this release. No new OAuth consent, inbox read, external message, sponsorship acceptance or provider purchase was performed.

The current usable surface is `/web/creator`: it reads actual Ideal Human storyboard/footage metadata and prepares an editable, deterministic question draft in browser memory. The draft has no recipient or send operation and is never sent or accepted automatically. Film plans/catalog updates remain in the existing Ideal Human journal. The authenticated `GET /api/tma/creator/capabilities` v1 contract explicitly returns disabled external integrations, null metrics/inbox and `sendingEnabled: false`.

## Official YouTube route

Use a registered server-side Google OAuth application and an explicit channel-owner grant. The current reports reference notes `youtube.readonly`; its analytics scope list includes `yt-analytics.readonly`. A future implementation should request only those needed read scopes and verify them against the exact authorized reports. Do not request monetary or account-management permissions for a views/retention MVP. [Reports query reference](https://developers.google.com/youtube/analytics/reference/reports/query).

Identify the owner's channel using an authorized `channels.list` request with `mine=true`, then keep channel IDs server-owned and bound to that LifeOS owner. Do not accept a caller's arbitrary channel as authorization. [Channels reference](https://developers.google.com/youtube/v3/docs/channels/list).

Retention requires an authorized per-video report using `elapsedVideoTimeRatio` and compatible retention metrics; the report accepts a single video filter. Missing permissions or unavailable results must remain unavailable, without fabricated retention percentages. [Channel report types](https://developers.google.com/youtube/analytics/channel_reports).

For scheduled read-only checks, request offline access through Google's normal code flow and encrypt the resulting owner-bound grant with existing backend credential utilities. Handle revocation/expiry with reconnect; never scrape Studio cookies or put refresh credentials in a browser. Keep creator grants purpose/account-separated from existing Calendar access. [Server OAuth flow](https://developers.google.com/youtube/reporting/guides/authorization/server-side-web-apps).

## Creator inbox boundary

A selected creator-business account and label must be explicitly authorized. Personal, university and TASTAMA accounts are excluded unless separately opted in. `gmail.readonly` is a restricted scope; `gmail.metadata` omits message bodies. Google lists `gmail.compose` as managing drafts **and sending email**, so it is not a safe draft-only permission boundary. This release requests none of them. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [send method permissions](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

The first mailbox adapter should use approved read-only access, an explicit account/label allowlist, small bounded pages, duplicate receipts and no attachments by default. `messages.list` supports `labelIds` and returns message/thread identifiers; bodies require separate reads. Its search query is unavailable with the metadata-only scope. Apply account/label checks again before every body read. [Message listing reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

Mail text and attachments are untrusted input. They cannot issue tool instructions, change preferences or authorize messages. Keep draft generation local to LifeOS review unless a separately approved provider is selected. Sending, accepting/rejecting terms, quoting prices, modifying labels and deleting original mail remain unavailable in the v1 capability contract. A future Gmail draft-writing integration requires explicit write consent and an independent application-layer send denylist; OAuth compose permission alone does not prevent sending.

## Acceptance status and next authorization

- PASS: typed disabled capability projection; local-only editable question draft; actual existing documentary plan/catalog display; no duplicate journal database.
- PASS: tests reject send/recipient/acceptance flags and preserve null metrics/inbox. Draft text is data and has no execution or network authority.
- BLOCKED: owner-account OAuth test, live channel metrics/retention and designated-inbox reads. A registered authorized Google client, explicit selected creator account/channel/label consent and a test account are required.
- UNVERIFIED: actual account API availability, quota behavior, provider refresh/revocation and scheduled creator checks. No fake successful analytics or inbox synchronization is claimed.

The exact inspiration video's public metadata, description and creator chapter labels were verified in an authorized local browser on November 3, 2026. No transcript was retrieved, so its spoken feature claims remain unverified; see [video evidence audit](VIDEO_IDEAS_AUDIT.md). Google API findings above are independently based on official documentation, not on that video's reported claims.
