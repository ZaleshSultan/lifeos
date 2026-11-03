# Android health integration

The source path is Xiaomi Watch 4 → Mi Fitness on Samsung Galaxy S23+ → authorized Health Connect reads → LifeOS bridge → `POST https://lifeos.zalewko.me/api/health/ingest` → Supabase → Health/Ideal Human. Upstream record availability must be confirmed on the phone. Other Health Connect writers can contribute measurements; LifeOS does not assume direct access to a watch or sensor.

## Delivered build and remaining device work

The Android project now contains encrypted personal-token storage, HTTPS-only transport with redirects refused, partial data permissions, separate background permission/feature checks, manual today/yesterday sync, seven-day backfill, persistent periodic work and private local result/last-success status. Reporting uses Asia/Almaty. Source math assigns completed sleep to the wake-up date and leaves asleep duration unknown when no sleep stages exist. Automatic projections preserve manual Ideal Human entries and identify stale/missing source data.

The production host has no Android toolchain. The standard free GitHub-hosted Ubuntu runner verified final PR #36 head `282d092` / tested merge `c8d8927` in [run 41624909371](https://github.com/ZaleshSultan/lifeos/actions/runs/41624909371): **22 JVM tests, zero failures/errors/skips; lint zero errors, 11 warnings and one hint; assembly/signature PASS**. The APK is 36,090,253 bytes, SHA256 `10d36d382dd4362e9f8d00d4180e21d25c9dbaa89cdc3ac74abf90dd56911bff`. The [hosted artifact](https://github.com/ZaleshSultan/lifeos/actions/runs/41624909371/artifacts/13225533384) expires November 4 at 11:11:36 UTC; its verified restricted local release copy persists. The artifact includes SHA256SUMS and BUILD-VERIFICATION.json. No personal token or backend credential is embedded. Remaining lint recommendations are visible; no zero-warning claim is made.

No physical Android phone was available. APK installation, Keystore behavior, actual Health Connect reads and Galaxy S23+ background synchronization remain **UNVERIFIED**. A successful hosted build does not prove device accuracy or timing. The artifact is debug-signed for testing; production signing and Play distribution are not configured. Static API review also checked the official Health Connect 1.1.0 source and [Android setup guidance](https://developer.android.com/health-and-fitness/health-connect/get-started), including the Android 13 rationale intent and Android 14 protected rationale alias.

Follow [the bridge README](../apps/health-bridge/README.md) for build prerequisites, exact commands and the handset verification sequence. Use a separate test identity for write/retry tests. Install a verified signed/debug build, obtain a personal token from Mini App Health, grant the desired measurement permissions, verify manual sync, then optionally permit supported background reading. A disabled upstream writer, missing permission or unsupported background feature cannot be repaired by backend deployment.

## Backend and privacy

The bridge sends normalized day metrics, stable workout IDs and bounded actual samples through the [health ingest contract](HEALTH_BRIDGE_CONTRACT.md). A per-user health credential, issued by authenticated Telegram Mini App access, determines the owner. The phone never sends a configurable user ID, shared ingest secret or Supabase key. Backend health data remains authoritative; Obsidian is a mirror.

Current automatic data comes from permitted recorded measurements, not estimates of nonexistent sensor access. Sleep stages are merged, ordinary and resting heart rate remain distinct, and null measurements stay unknown. WorkManager runs approximately near midnight and morning with network constraints/backoff; Android can delay it. [Android background reading requirements](https://developer.android.com/health-and-fitness/health-connect/read-data).

## Fallbacks and troubleshooting

- Missing metric: confirm it exists in Health Connect, then confirm that metric's read permission. A record shown only inside Mi Fitness is insufficient.
- Background unavailable: check the displayed feature/permission status and use manual sync while open. Do not bypass platform permission controls.
- HTTP 401/403: use Mini App Health to replace an expired/revoked personal token. Do not copy service-role credentials to the phone.
- HTTP 400/413/422: check bridge/API version and supported payload sizes/types. Raw server bodies are not displayed in local logs.
- Network/429/5xx: foreground errors retain the prior backend history; scheduled transient failures retry through WorkManager backoff. Repeated calls upsert stable identities.
- Keystore restore/failure: reissue and save the personal token. Android application backup is disabled and explicit legacy/cloud/device-transfer rules exclude every app-data domain, including encrypted/legacy token preferences, diagnostics and WorkManager state. The local encryption key is not an off-device credential backup. Android 12+ can otherwise permit some manufacturer device transfers despite `allowBackup=false`; see [official Android backup controls](https://developer.android.com/identity/data/autobackup).
- Phone installation or upstream sync unavailable: continue `/health_log steps:8000 sleep:7h rhr:62 weight:70.5 mood:7 energy:6` for actual observations, or the documented authorized JSON/CSV import. Manual measurements remain authoritative in the journal.
