# Direct Telegram voice recognition

The bot can transcribe private Telegram `message.voice` OGG/Opus messages with a local `faster-whisper` worker. Ordinary `message.audio` files work when they also contain OGG/Opus; MP3/WAV and document attachments are outside this profile. No cloud STT credentials, Supabase migration, assistant model, or capture AI feature is needed. `LIFEOS_VOICE_ENABLED=false` is the default; the existing optional inbox capture behavior remains available when direct voice is disabled.

The worker uses multilingual `tiny`, CPU `int8`, two CPU threads, and one persistent inference subprocess. Only `tiny`, `base`, and `small` are accepted; English-only and larger models are rejected. On a shared 4 GB host, start with `tiny` and measure resource use before changing models. The implementation follows the [faster-whisper CPU and transcription API](https://github.com/SYSTRAN/faster-whisper) and the [Telegram getFile API](https://core.telegram.org/bots/api#getfile).

## Behavior

1. Existing webhook-secret verification runs before voice handling. Only the active linked Telegram owner in a private chat can submit a job.
2. The bot reserves one job, acknowledges the webhook promptly, calls the existing `getFileUrl()`, and downloads from the fixed Telegram file origin with redirects disabled. Other concurrent voice requests receive a busy response; there is no waiting queue.
3. The worker authenticates the loopback request, writes a private temporary OGG file, decodes it incrementally, then runs local STT. Actual decoded duration is checked independently of Telegram metadata. The subprocess is killed on timeout. Temporary files are removed on success, error, timeout, and graceful SIGINT/SIGTERM shutdown.
4. The bot rechecks authorization and sends the escaped transcript to the same private chat. No audio, transcript, Telegram token, or token-bearing download URL is logged. Audio is not stored in Supabase or the capture inbox by this flow.
5. A pure, deterministic grammar maps supported speech to existing slash command handlers. Unknown or ambiguous speech receives a request to repeat or use a text command. It cannot fall through to automatic capture/assistant writes.
6. Commands that change data receive a preview and explicit **Подтвердить / Отмена** buttons. All slash commands require confirmation except a narrow allowlist of proven reads. Confirmation rechecks the active owner and timezone, is single-use, and expires after five minutes. It invokes the existing command handler and owner-scoped store methods.

Examples:

- «Какие у меня завтра пары?» → `/study schedule YYYY-MM-DD` → existing `getTmaStudySummary()` course schedules filtered for that day.
- «Напомни завтра в 9 утра подготовиться к DBMS» → transcript, reminder title/date/time/timezone preview → confirmation → existing `/remind` and `createReminder()`.
- “What classes do I have tomorrow?” and «Ертең қандай сабақтар?» use the same dated schedule path.
- “Remind me tomorrow at 9 am to review DBMS” and «Еске сал ертең сағат 9 DBMS дайындау» create a confirmation draft.
- «Создай задачу подготовиться к экзамену» → confirmed `/task`.

`tomorrow` is resolved using the profile timezone from Supabase, including near UTC midnight. Reminder previews freeze the local date/time before confirmation; a timezone change invalidates the draft. Existing past-date validation remains in force at execution. Recognition supports Russian, Kazakh and English, but the supported command grammar is intentionally bounded. For commands outside the spoken grammar, send an existing slash command as text.

Small-model quality, especially short Kazakh recordings, varies with the speaker and noise. Set `LIFEOS_VOICE_LANGUAGE=ru`, `kk`, or `en` in the bot environment if auto-detection rejects valid speech. `auto` is the default. Forced language does not bypass segment confidence, silence, repetition, or length checks. This setting applies to all voice users of that bot process; there is no new per-user database field.

## Configuration

| Variable                              | Default                            | Where / constraint                                                          |
| ------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `LIFEOS_VOICE_ENABLED`                | `false`                            | Bot; only explicit `true` enables direct voice                              |
| `LIFEOS_VOICE_WORKER_URL`             | `http://127.0.0.1:8091/transcribe` | Bot; HTTP literal loopback, exact path, no credentials/query/redirects      |
| `LIFEOS_VOICE_WORKER_SECRET`          | unset                              | Both; same random 32–256 character URL-safe secret                          |
| `LIFEOS_VOICE_LANGUAGE`               | `auto`                             | Bot/worker; `auto`, `ru`, `kk`, `en`; bot sends the setting on each request |
| `LIFEOS_VOICE_MAX_BYTES`              | `4194304`                          | Both; hard ceiling 4 MiB; bot rejects metadata and streamed bytes           |
| `LIFEOS_VOICE_MAX_SECONDS`            | `90`                               | Both; hard ceiling 90 seconds                                               |
| `LIFEOS_VOICE_TIMEOUT_MS`             | `135000`                           | Bot; whole job deadline, hard ceiling 180000 ms                             |
| `LIFEOS_VOICE_WORKER_PORT`            | `8091`                             | Worker; always listens on `127.0.0.1`                                       |
| `LIFEOS_VOICE_MODEL`                  | `tiny`                             | Worker; multilingual `tiny`, `base`, `small` only                           |
| `LIFEOS_VOICE_CPU_THREADS`            | `2`                                | Worker; 1–4; inference concurrency stays one                                |
| `LIFEOS_VOICE_WORKER_TIMEOUT_SECONDS` | `60`                               | Worker; hard subprocess deadline, maximum 120 seconds                       |
| `LIFEOS_VOICE_MODEL_CACHE`            | library cache                      | Worker; directory containing the pre-downloaded model                       |

Telegram getFile/download have their existing independent 10-second deadlines. The worker bounds HTTP header/body reads to 10 seconds and admitted HTTP connections to four; only one authenticated request can upload/decode/infer at a time. Silence, low-confidence language/segments, excessive repetition, control characters, empty text, and output over 1500 characters are rejected. Auto language probability must be at least 0.55 at the worker. The worker returns only fixed error codes; the bot asks the user to repeat without echoing diagnostics.

Pending commands live only in bounded process memory (maximum 100 drafts). A restart discards them, so old buttons fail closed. Process-local deduplication remembers at most 1000 voice messages for 24 hours; new jobs are refused when full. Messages older than ten minutes are not processed. This is not a durable exactly-once delivery guarantee across process restarts. An uncertain command failure must be checked in LifeOS before retrying; the bot never automatically retries a mutation. SIGKILL or power loss cannot run Python cleanup handlers; use graceful shutdown and normal OS temporary-directory hygiene for crash remnants.

## Debian setup and manual launch

These are operator instructions, not an applied deployment. Existing production services/configuration and webhook registration do not change automatically. Use Python 3.10+ and the repository's existing Node/pnpm setup.

From the repository root:

```bash
sudo apt-get update
sudo apt-get install -y python3-venv
python3 -m venv workers/voice-stt/.venv
workers/voice-stt/.venv/bin/python -m pip install -r workers/voice-stt/requirements.txt
cp workers/voice-stt/.env.example workers/voice-stt/.env
chmod 600 workers/voice-stt/.env
```

Generate a secret locally with `openssl rand -hex 32`. Put the same value in `LIFEOS_VOICE_WORKER_SECRET` in the worker `.env` and the bot's existing private environment. Do not paste it into chat or commit it. Set `LIFEOS_VOICE_MODEL_CACHE` in the worker file to an absolute private cache directory writable by the worker account. Download the selected model once, before accepting audio:

```bash
set -a
. workers/voice-stt/.env
set +a
workers/voice-stt/.venv/bin/python - <<'PY'
import os
from faster_whisper.utils import download_model
download_model(os.environ.get('LIFEOS_VOICE_MODEL', 'tiny'),
               cache_dir=os.environ.get('LIFEOS_VOICE_MODEL_CACHE') or None)
PY
workers/voice-stt/.venv/bin/python workers/voice-stt/voice_stt_worker.py
```

Runtime model loading is `local_files_only=True`; there is no model download during personal-audio processing. PyAV supplies decoding through its binary wheels; there is no PyTorch, HTTP framework, or separate system FFmpeg dependency in the worker. The STT worker receives neither the bot token nor Supabase credentials. Keep the worker loopback-only and exclude its temporary/model directories from public serving and audio backups.

In a second terminal, after filling the existing bot environment and setting `LIFEOS_VOICE_ENABLED=true` plus its worker secret/language/URL:

```bash
set -a
. apps/bot/.env
set +a
corepack pnpm --filter @lifeos/bot start
```

Only use that manual bot command where the configured port is available; it does not replace a running production service. For a later reviewed service deployment, use the repository's existing operational workflow; no production systemd unit or deployment script is changed by this feature.

## Verification

```bash
corepack pnpm typecheck
corepack pnpm run test --maxWorkers=1 --no-file-parallelism --testTimeout=30000
workers/voice-stt/.venv/bin/python -m unittest discover -s workers/voice-stt -p '*_test.py' -v
```

TypeScript tests use mock Telegram and STT transports through the actual authenticated HTTP webhook. Python tests cover quality checks, bounded real OGG/Opus decoding when dependencies are installed, HTTP authentication/concurrency, child reuse/kill/restart, timeout cleanup, and graceful termination. Model-quality claims require representative real recordings; mocked STT and synthetic codec checks do not establish recognition accuracy on a user's voice.

The sequential test command allows 30 seconds per test because the existing campus PNG integrity test can exceed its default five-second deadline on a constrained host. It does not skip tests.

## Changed files

- Configuration: `.env.example`, `apps/bot/.env.example`, `apps/bot/src/config.ts`.
- Bot transport and dispatch: `apps/bot/src/server.ts`, `apps/bot/src/telegram/types.ts`, `apps/bot/src/telegram/client.ts`, `apps/bot/src/telegram/commands.ts`, `apps/bot/src/telegram/capture.ts`, `apps/bot/src/telegram/local-voice.ts`.
- Command planning: `packages/core/src/voice-command.ts`, `packages/core/src/index.ts`.
- Private error handling reachable from voice commands: `apps/bot/src/telegram/alerts.ts`, `packages/db/src/lifeos-store.ts`.
- TypeScript tests: `apps/bot/src/telegram/local-voice.test.ts`, `apps/bot/src/telegram/local-voice.integration.test.ts`, `apps/bot/src/telegram/study-date.test.ts`, `apps/bot/src/telegram/client.test.ts`, `apps/bot/src/telegram/alerts.test.ts`, `packages/core/src/voice-command.test.ts`, `packages/db/src/lifeos-store.test.ts`.
- Worker: `workers/voice-stt/voice_stt_worker.py`, `workers/voice-stt/voice_stt_worker_test.py`, `workers/voice-stt/requirements.txt`, `workers/voice-stt/.env.example`, `workers/test_worker_suite.py`.
- Documentation: `docs/TELEGRAM_VOICE.md`.
