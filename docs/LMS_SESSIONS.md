# AITU LMS sessions

LifeOS now supports a manually supplied Microsoft `ESTSAUTHPERSISTENT` cookie through **Study → AITU LMS Connection**. A Moodle Web Services token is optional. Today, Gemini and the external Agata consumer keep their existing boundaries.

## Connection flow

1. Sign in to AITU Moodle in your regular browser using Microsoft.
2. In that browser's developer tools, inspect the cookies for `https://login.microsoftonline.com` during the Microsoft sign-in flow. Copy only the **value** of `ESTSAUTHPERSISTENT`. Do not copy the cookie name, a complete Cookie header, other cookies, an authentication URL, or a password. If Microsoft does not issue this persistent cookie, this connection method cannot be used; LifeOS does not bypass MFA or browser isolation.
3. Open the Mini App from Telegram, choose **Study → AITU LMS Connection**, paste into the masked field and choose **Validate**. The field is cleared immediately. Validation makes a read-only authenticated check with the existing Moodle client and does not write a database credential.
4. After validation succeeds, choose **Save session** within five minutes. To replace an expired session, follow the same flow with a fresh value. A failed or expired validation must be repeated.
5. Choose **Sync**. The worker checks manual requests at least every 30 seconds when idle; requests wait behind an active sync. The screen shows the last successful sync, error category, retention limit and incomplete-data warnings.
6. **Delete stored session** removes the encrypted session and pending request. Replacement/deletion returns `lms_sync_in_progress` while a worker holds its lease; retry after that sync finishes. Deletion does not log your Microsoft account out of other applications.

Keep this value out of chat, AI prompts, shell history, screenshots and support messages. The Mini App cannot read Microsoft/Moodle browser cookies automatically. Clipboard contents belong to your device/browser and are not managed by LifeOS.

## Storage and authentication

Every `/api/tma/lms/*` endpoint requires signed, unexpired Telegram initData and an active linked profile. Personal web sessions and the development authentication shortcut are deliberately unavailable for these endpoints. Requests cannot supply `user_id`, a Moodle origin, or credentials in query parameters. Responses, including authentication failures, use `Cache-Control: no-store`.

The backend enforces strict JSON schemas, a 20,000-byte validation body limit, smaller limits for other mutations, per-user rate limits, two concurrent validations globally, and a 60-second bridge timeout. It invokes a static Python helper without a shell. The cookie travels on stdin; the subprocess receives neither service-role keys nor AI credentials. Its stderr and raw network errors are not forwarded or logged.

Successful validation creates a random owner-scoped receipt. Only an AES-256-GCM encrypted owner/platform envelope remains in backend memory, for at most five minutes; replacement, consumption and server shutdown discard it. The browser keeps the receipt only for the current screen. Neither cookie nor receipt goes into browser storage, shared mutation caches, analytics or URLs. Run one bot process or use sticky routing for this in-memory receipt flow; restarting or switching processes requires validation again and never permits an unvalidated save.

Stored sessions reuse the canonical `enc:v1:<iv-base64url>:<tag-base64url>:<ciphertext-base64url>` format. The authenticated plaintext envelope contains version, LifeOS owner, `aitu_moodle` platform and cookie. Workers verify the owner/platform after authenticated decryption. Missing, malformed or mismatched keys fail closed, independently of legacy plaintext migration options. Historic authenticated packed ciphertext remains readable for existing passwords/WS tokens only.

The bot and worker must use the same existing 32-byte `ENCRYPTION_KEY` (or supported existing alias). Do not replace an established key: that would make existing OAuth/LMS credentials unreadable. Session retention defaults to 24 hours and may be configured from 1 to 168 hours with `LIFEOS_LMS_SESSION_TTL_HOURS`. Microsoft can reject the credential earlier. The worker scrubs expired ciphertext, including inactive rows, and removes rejected sessions; a running worker is required for physical expiry cleanup. API reads also report elapsed retention as expired and deny sync. Password, WS token and iCal settings already present in a row survive session save/delete.

Credential columns and mutation/lease RPCs are inaccessible to browser database roles. The safe metadata view uses `security_invoker` plus ownership filtering. Session values, ciphertext and validation receipts are excluded from AI context queries and client metadata responses. See the [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) for the grants/view rules used here.

## Moodle support and limits

The client permits HTTPS on the exact AITU Moodle and Microsoft login origins, verifies every redirect/form target before requesting it, and injects the persistent cookie only on the Microsoft origin. It follows only the hidden OIDC callback form; credential/MFA/consent forms require a fresh browser login. Activity reads use canonical course/module view URLs without arbitrary action parameters. Redirects, body sizes and login duration are bounded.

Without Web Services, LifeOS attempts these read-only HTML pages:

- The authenticated Moodle course list and course views.
- Assignment module views: visible submission/grading status and due dates.
- Quiz module views: visible open/close dates and completed attempt states.
- Midterms/exams identified as such in actual accessible activity titles or grade records. No separate institutional exam schedule is inferred.

Supported HTML fixtures include standard Moodle activity dates, assignment status tables and quiz attempt summaries. Dates with explicit UTC offsets/epochs are used directly. Fully stated local times use the configured user's timezone; ambiguous, nonexistent or unrecognized dates stay unknown. If the Moodle account uses a different timezone, align the LifeOS profile before relying on offset-free HTML dates.

Missing grades never imply non-submission. Overdue requires a verified unfinished state and a known past deadline. Submitted ungraded work, graded work (including zero), exams/midterms, upcoming deadlines and unknown data are separate Study groups. Grade-only existing records remain visible. Unknown dates remain null. Manual entries have their own source and never overwrite Moodle records.

Stable course/module IDs deduplicate HTML records; an existing WS assignment record with a verified matching course/module ID is reused. HTML does not prove that hidden/lazy/filtered activities are absent, so an HTML snapshot never retires earlier events or grades. Grade retirement also requires a complete successful snapshot. Unsupported pages produce safe codes, partial sync/staleness indicators and manual-entry fallback. No pages/HTML, SSO values or internal LifeOS identifiers are returned in work cards.

Task and grade projections use deterministic pages of 100, capped at 2,000 records each. Truncation is explicit. There is no seven-day overdue cutoff; older verified unfinished work remains eligible. Linked-grade lookups are batched to avoid unbounded query strings.

### Actual environment verification

On 2026-10-10, a read-only check of the existing local SSO cookie returned `session_expired`. Authenticated AITU assignment/quiz/exam pages could therefore not be inspected. Standard Moodle HTML support is fixture-tested, but the institution's current templates, visible dates, quiz access and exam inventory require verification after reconnecting. The unavailable `mod_assign_get_assignments` method does not block attempting session HTML. ICS remains optional and is not part of this change.

An offline check of the inspected environment files found a valid bot encryption key but a missing or invalid key in `workers/university-sync/.env`. Session decryption remains blocked until that worker is configured with the same existing valid key as the bot, after approval. No key values or hashes were displayed.

The installed legacy and multi-user services were inspected read-only. Both remain active with their original environment files; no service was restarted, stopped or disabled. No migration, production secret change, deployment or push was performed.

## Migration

Apply `supabase/migrations/20261010141237_secure_lms_sessions.sql` after the existing LMS settings migration. It:

- Allows nullable username/password only for session mode, retaining password requirements for password mode.
- Adds encrypted session, expiry/version, state, safe error, request and unsupported-feature fields.
- Revokes browser access to credential columns/writes and adds safe metadata columns to the existing view.
- Adds a per-user/platform service-only lease and atomic lease-checked save/delete RPCs.
- Adds a paginated university task index.

Existing rows/configurations are preserved. Both workers must load the lease-aware code before enabling session sync: an old running process does not acquire the new lease. Leases renew during sync; loss/expiry stops persistence. Atomic session mutations check the unexpired owner lease in the same database transaction as the write.

## Deployment commands — run only after deployment approval

These commands target the inspected self-host paths. They are instructions, not actions already taken. Review the database backup/restore procedure first. Use the existing database/CLI authentication; do not put database passwords, cookies or encryption keys in command arguments.

First verify the candidate locally:

```bash
cd /home/zalewko/lifeos
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
/tmp/lifeos-study-checks-venv/bin/python -m unittest discover -s workers -p test_worker_suite.py
corepack pnpm --filter @lifeos/tma build
bash scripts/test-lms-migration.sh
```

The test venv path above is available in the inspected checkout. On a different host, create an isolated test venv and install `workers/university-sync/requirements.txt` and `workers/ics-sync/requirements.txt` before running the same unittest command. The migration test starts/removes an isolated PostgreSQL container without production settings or published ports.

Stage CLI configuration in a separate directory, preserving all existing LMS/project configuration. Set `LIFEOS_SUPABASE_PROJECT_REF` to your intended project ref (a non-secret identifier). CLI 2.120.0 commands were checked with `--help`:

```bash
cd /home/zalewko/lifeos
read -r -p 'Target Supabase project ref: ' LIFEOS_SUPABASE_PROJECT_REF
task_lms_release_dir="$(mktemp -d /tmp/lifeos-lms-release.XXXXXX)"
corepack pnpm dlx supabase@2.120.0 --workdir "$task_lms_release_dir" init
cp -a supabase/migrations "$task_lms_release_dir/supabase/"
corepack pnpm dlx supabase@2.120.0 login
corepack pnpm dlx supabase@2.120.0 --workdir "$task_lms_release_dir" link --project-ref "$LIFEOS_SUPABASE_PROJECT_REF"
corepack pnpm dlx supabase@2.120.0 --workdir "$task_lms_release_dir" migration list --linked
corepack pnpm dlx supabase@2.120.0 --workdir "$task_lms_release_dir" db push --linked --dry-run --skip-vault
```

Review the target and pending list. Proceed only if the intended prerequisites are already applied and the only pending change is `20261010141237_secure_lms_sessions.sql`; unrelated pending migrations need separate review. Then apply it:

```bash
corepack pnpm dlx supabase@2.120.0 --workdir "$task_lms_release_dir" db push --linked --skip-vault
```

`--skip-vault` prevents this migration operation from changing configured Vault secrets. See the [CLI reference](https://supabase.com/docs/reference/cli/introduction).

Prepare runtime dependencies without replacing either worker's `.env`:

```bash
cd /home/zalewko/lifeos
workers/university-sync/aitu-parser/.venv/bin/python -m pip install -r workers/university-sync/aitu-parser/requirements.txt
workers/university-sync/.venv/bin/python -m pip install -r workers/university-sync/requirements.txt
workers/university-sync/aitu-parser/.venv/bin/python -c 'import requests, bs4; print("Moodle validation dependencies ready")'
workers/university-sync/.venv/bin/python -c 'import requests, bs4, cryptography; print("LMS worker dependencies ready")'
corepack pnpm exec tsx scripts/check-lms-encryption.ts apps/bot/.env workers/university-sync/.env
bash scripts/build-tma-selfhost.sh
```

In the existing bot environment file, configure `LIFEOS_LMS_PYTHON=/home/zalewko/lifeos/workers/university-sync/aitu-parser/.venv/bin/python` and optionally `LIFEOS_LMS_SESSION_TTL_HOURS=24`. Verify the existing bot/worker encryption keys are valid and equal without displaying them. Preserve every existing LMS setting, including the legacy cookie. The Railway image now also includes Python/requests/BeautifulSoup and the validation bridge; its deployment is a separate approved operation.

Restart the legacy service **first** so it adopts the shared lease without being disabled. Then load the new multi-user worker and backend. Do this before entering/saving a fresh session in TMA:

```bash
sudo systemctl restart lifeos-university-sync.service
systemctl is-active lifeos-university-sync.service
sudo systemctl restart lifeos-lms-grades-worker.service
systemctl is-active lifeos-lms-grades-worker.service
sudo systemctl restart lifeos-bot.service
systemctl is-active lifeos-bot.service
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
```

Reconnect through TMA, trigger sync, and verify known grades, a visible assignment, submission state and real due dates against the browser. Check partial/unsupported warnings and preservation of manually entered deadlines. Validate a two-worker lease conflict in staging, rather than deliberately racing production writes. Keep the legacy service enabled until the new worker has been verified on live data; any later retirement requires separate approval.

## Verification

Security/regression coverage includes Telegram-only active-profile authentication, owner isolation, receipt expiry/replay, malformed/oversized sessions, request schemas/rate limits, fail-closed encryption, actual cross-language ciphertext compatibility, malicious redirects/forms, expired sessions, shared leases and rotation, stable module deduplication, partial HTML preservation, missing grades, unknown/ambiguous dates, manual work and old overdue deadlines.

Local verification passed: 556 JS/TS tests, 205 Python worker tests, all TypeScript checks, the TMA production build, disposable PostgreSQL ownership/lease assertions, and a packaged Node/Python bridge smoke test with networking disabled. Docker build exclusions were checked for the actual environment-file and virtualenv paths.

`scripts/test-lms-migration.sh` executes the original/new migrations and ownership/grant/lease assertions against disposable PostgreSQL 15. TypeScript/TMA tests and the Python worker suite are also in CI. No production database verification has been performed. Browser WebView interaction remains a manual smoke check after deployment.
