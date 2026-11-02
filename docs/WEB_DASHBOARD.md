# LifeOS web dashboard

The existing Next.js application runs at `https://lifeos.zalewko.me/web` on the authorized Debian deployment. Its backend remains `apps/bot`; Supabase remains authoritative. The dashboard shares the Ideal Human domain model and pure journal components with the Mini App, and uses the existing workout, academic, finance and notification stores.

## Access and navigation

Send `/web` to [the LifeOS bot](https://t.me/MYlifeeOS_bot) in a private chat and open the one-time link. Login links expire after at most two minutes. A successful exchange creates the existing revocable, opaque, HttpOnly browser session, then removes the link credential from the URL. Sessions have an absolute expiry; use `/web` again when access expires. Sign out through navigation; its same-origin fetch preserves a valid Origin under the existing no-referrer policy. Logout revokes the server session before expiring the cookie, and a failed revocation stays visible for retry. See [web sessions](WEB_SESSIONS.md).

The desktop sidebar exposes Today, tasks, calendar, study, workouts, health, nutrition/water, finance, AI, Ideal Human, creator planning, reminders and settings. Narrow screens use four primary destinations plus a More drawer, with the same remaining destinations and logout. All controls support keyboard focus and at least 44px touch targets. Loading and error states preserve the surrounding navigation.

## Daily workflows

- **Today:** factual morning/evening overviews, source warnings, optional filming ideas and links to daily actions. Suggestions do not mark tasks complete or change tomorrow automatically.
- **Tasks:** create a task with optional notes/deadline, edit it, or change status. Updates compare the saved timestamp; stale changes are rejected. Creation uses an idempotency key.
- **Calendar:** show saved events for a selected Asia/Almaty date. Calculated task blocks are labelled suggestions and do not create calendar events. Missing events do not imply a free day.
- **Study:** courses, saved class slots, grades, deadlines and credential-free LMS status. Saved schedules carry freshness warnings. Institutional login guidance does not claim that signing in to AITU transfers an integration grant to LifeOS. Credential management remains in the existing Telegram-only flow.
- **Workouts:** explicitly start a session, log repetitions/weights/rest, mark or undo sets, finish, and review the same existing workout history. A journal training note does not create another session.
- **Health:** actual available measurements, sources and trends with gaps for missing days. A browser login does not grant access to phone sensors or Health Connect permissions.
- **Nutrition and water:** manual food entries use the existing Ideal Human daily record. Water entries have explicit quick/custom amounts, idempotent requests and undo; there is no imposed medical target. Photo analysis is optional, requires explicit consent before external transmission, returns an editable estimate and saves only after confirmation. Availability and provider errors remain visible; manual logging works independently.
- **AI:** bounded conversation with the existing backend. Provider failure remains an error. A backend-issued action confirmation requires a separate user click; the same request identity is retained for confirmation/retry. Clearing the screen does not revoke already committed actions.
- **Ideal Human:** November 3–December 2, 2026, Asia/Almaty. Shared editable Day 1 blocks, body/sleep, meals, learning, video metadata, reflections, trends and full JSON export. Dates and completion are never fabricated. Saves compare the day revision; conflicts retain local edits for export before an explicit reload.
- **Reminders:** create or cancel an explicit Telegram reminder; choose optional daily briefing, quiet-hour and hydration preferences separately. Automatic notifications default off. Delivery requires a working linked profile and worker.

Unknown observations remain unknown. Successful saves reload from the database. Unsaved journal/task/preference edits stay in memory and are guarded before navigation/exit; an offline page reload cannot recover unsaved data. The browser does not persist a private journal or photo in local/session storage.

## Backend boundary

Server components read authenticated backend projections through `lib/lifeos-api.ts` with caching disabled. Interactive clients use `/web/api/bridge/<resource>`. This route:

1. Allows explicit resource/method pairs only; caller-supplied backend URLs, account IDs and credential-management routes are rejected.
2. Reads the HttpOnly cookie on the server and forwards only that identity as the backend bearer. Client Authorization or Telegram headers cannot replace it.
3. Requires an exact configured Origin on mutations, rejects cross-site requests, accepts bounded JSON and enforces a one-megabyte streaming limit.
4. Keeps redirects disabled toward the backend, uses timeouts, sets no-store, and returns stable error codes without provider diagnostics.
5. Leaves profile status, revocation, resource ownership, validation, idempotency and conflict checks authoritative in the bot/database.

The existing Next proxy continues checking every protected document/RSC/API request against the live backend session. No service-role, bot, LMS or health-device secret is added to browser code. The optional server-only `LIFEOS_WEB_APP_URL` configures the runtime public base; the existing `NEXT_PUBLIC_WEB_APP_URL` fallback remains supported. Credential-bearing or invalid base URLs are rejected with a fixed diagnostic. Public login/access routes remain separate; credential-mutating LMS and health-device endpoints are absent from the bridge allowlist.

## Build and verification

```bash
pnpm --filter @lifeos/web typecheck
pnpm exec vitest run apps/web/lib/bridge-policy.test.ts 'apps/web/app/api/bridge/[...path]/route.test.ts' apps/web/app/login/route.test.ts apps/web/app/logout/route.test.ts apps/web/proxy.test.ts --maxWorkers=1
pnpm --filter @lifeos/web build
node scripts/test-web-session-smoke.mjs
LIFEOS_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
LIFEOS_CHROMIUM_EXECUTABLE=/path/to/chrome \
LIFEOS_WEB_BROWSER_ARTIFACTS=/private/artifact-directory \
pnpm exec tsx apps/web/scripts/test-dashboard-browser.mjs
```

The dashboard browser harness starts an isolated loopback fixture API, a production Next server and a local TLS frontend. A server-only `LIFEOS_WEB_APP_URL` runtime override points its native redirects and Origin checks at that local HTTPS frontend; the public build fallback stays unchanged. The isolated browser accepts its generated test certificate only in that test context, and DNS/network guards block external destinations. It exercises the real Next login/cookie/CSRF/proxy flow using isolated test identities, never a production database or real AI provider. Its results explicitly distinguish fixture verification from production verification.

The build uses Next's supported webpack mode and `resolve.extensionAlias` for the repository's `.js` Node ESM imports beside TypeScript sources. This preserves the shared core's runtime conventions. References: [Next bundler configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack), [webpack extension aliases](https://webpack.js.org/configuration/resolve/#resolveextensionalias).

Deployment, actual production commit, backup/rollback evidence and remaining live verification limitations belong in [the phase 2 report](OVERNIGHT_PHASE2_REPORT.md). Build only in the isolated release checkout; preserve the existing live build until the tested artifact is ready.
