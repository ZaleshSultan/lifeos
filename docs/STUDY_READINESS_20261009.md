# Study readiness — 2026-10-09

Work is prepared in `feature/study-intelligence-v5` for a PR into `main-v2`. Production DB, Storage, env, live frontend build and services were not modified. Original PDFs remain local and are not published in the public repository. Existing unrelated web-login edits remain outside this change.

## Russian C1: exact TUS failure

The client created a signed upload token successfully, then sent `x-signature` to `/storage/v1/upload/resumable`. That endpoint uses JWT authentication; the signature does not select signed authentication. With no JWT Authorization, Storage tried to verify an empty JWT and returned `AccessDenied` / `Invalid Compact JWS` (HTTP 400, anon). The PDF size is within the bucket limit.

Signed uploads now use `/storage/v1/upload/resumable/sign`, with `x-signature` on POST, HEAD and PATCH. Neither the signed upload token nor an opaque `sb_secret_...` API key is sent as a JWT Bearer. Signing/ordinary Storage SDK requests continue to support opaque secret keys and legacy service-role JWTs. See the [Supabase resumable upload documentation](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) and [official signed-upload example](https://github.com/supabase/supabase/blob/master/examples/storage/resumable-upload-signed-uppy/index.html).

The bucket stays private. Ownership is checked before signing; paths include owner/course/SHA-256; uploads use immutable objects without upsert. Chunk size remains 6 MiB. Checkpoint recovery uses HEAD; an old unsigned-endpoint checkpoint is discarded locally and a signed session is created. Completed bytes are downloaded and checked by length and SHA-256 before metadata registration. Repeat import preserves document IDs, versions, provenance, schemes and grades.

Original Russian C1 PDF: **43,859,568 bytes**, SHA-256 `3b202a5738adc26ace86c94806b2e81dbc866bf8370b61f0ba740d0a3af8f812`.

## API, Mini App and Telegram

The authenticated `/api/tma/study/*` routes provide syllabus upload/download, assignments, deadlines, grade overrides, component mapping, versioned grading schemes and calculator state. User identity is resolved by the bot boundary; all persistence checks the owner. Manual assignments reject foreign courses, malformed statuses, impossible calendar dates and earned scores without a valid maximum. Synchronized grades remain separate from manual overrides. Binary PDF download uses the same CORS policy as the API and private/no-store caching.

The Mini App connects these routes to its nine study tabs. Binary upload retains authentication/custom headers; mutations refresh the workspace. Account changes invalidate caches and stale responses. Telegram buttons set their own screen/tab and clear stale course/workout filters. Direct Telegram launch metadata (`tgWebAppStartParam` / signed `start_param`) selects the intended tab; explicit navigation survives reload. Existing origin links redirect to `/tma/` with their query intact.

## Read-only production audit

Supabase migration history already includes `20261008000100`, `00200`, `00300`, `00400`. The repository now contains these existing migration files and SQL regression tests. **Do not reapply 00300/00400 or repair/reset migration history.** No missing live study migration was found.

`lifeos-study-syllabi`: `public=false`, limit 62,914,560 bytes, allowed MIME `application/pdf`. Russian C1 has one existing metadata document, with no stored PDF bytes (`has_content=false`).

Bot and daily-digest systemd services are active. The running worker has `DAILY_DIGEST_TIME=06:00`; code/examples use the same default in each profile's timezone. The bot still runs with `NODE_ENV=development`; bot/worker Mini App URLs still point to the origin root. A transient local health timeout/public 502 occurred under host load; repeat checks returned local health 200 and public `/tma/` 200. Services were not restarted.

After explicit production approval, edit only the following values, preserving every other env entry:

```dotenv
# apps/bot/.env
NODE_ENV=production
TMA_URL=https://lifeos.zalewko.me/tma/
TMA_APP_URL=https://lifeos.zalewko.me/tma/
TELEGRAM_WEBAPP_URL=https://lifeos.zalewko.me/tma/
TMA_STATIC_DIR=/home/zalewko/lifeos/apps/tma/dist
ALLOW_UNSAFE_TMA_DEV_AUTH=false

# workers/daily-digest-worker/.env
TMA_URL=https://lifeos.zalewko.me/tma/
DAILY_DIGEST_TIME=06:00
```

## Validation boundary

The complete original Russian PDF is tested over actual loopback HTTP against a protocol fixture: HTTP 400 recovery, checkpoint HEAD resume, all 6 MiB chunks, registration, SHA-256 download verification and repeat import. This is **not** a live Supabase Storage test. The optional original-PDF tests skip when private local originals are absent; regular auth/recovery/idempotency tests run without them.

SQL checks use a disposable PostgreSQL database with no production credentials, TCP ports or network in the Docker fallback. They cover A/B/anon ownership and RLS, legacy content, version hydration, grade/override preservation and concurrent digest claims. Browser tests use a separate local build/backend and intercepted A/B API fixtures. Auth/persistence are checked separately in TypeScript/SQL. GitHub Actions runs typecheck, TypeScript/worker suites, SQL checks and the Mini App build without production secrets.

Local checks passed on the isolated staged snapshot, including the absence of local private PDFs:

| Check | Result |
| --- | --- |
| Monorepo typecheck | PASS |
| TypeScript tests | 473 passed; 7 optional local-PDF cases skipped in clean checkout |
| All Python worker tests | 170 passed |
| Local original checksum tests | All five original PDFs match; 15 catalog tests passed |
| Russian original HTTP import | PASS: 43,859,568 bytes, HTTP400/resume/download/repeat |
| Disposable SQL | PASS: RLS/preservation, 1440 repeated claims, 48 concurrent transactions with one owner |
| Isolated Mini App build/smoke | PASS: nine tabs/assets, protected API |
| Chromium320/390px | PASS: Telegram links/reload, assignments, grades, PDF400/retry, account isolation |
| Diff/Bash/Python syntax | PASS |

GitHub check results are recorded in the PR. Real Supabase upload, Telegram WebView acceptance, proxy upload and actual delivery at 06:00 remain production acceptance steps, requiring the user's explicit confirmation. No merge or deployment is performed by this change.

## Russian C1 retry after approval

```bash
cd /home/zalewko/lifeos
corepack pnpm exec tsx scripts/import-study-syllabi.ts --env apps/bot/.env --course 'K(RUSSIAN)L51-RU' --apply
```

The same command resumes after a partial failure. A read-only verification omits `--apply`. Full deployment instructions: [STUDY_REFACTOR_DEPLOY_DEBIAN.md](STUDY_REFACTOR_DEPLOY_DEBIAN.md).
