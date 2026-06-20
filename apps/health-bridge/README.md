# LifeOS Health Bridge

Android scaffold for syncing Xiaomi Watch 4 data into LifeOS through the
Samsung Galaxy S23+ and Android Health Connect:

```text
Xiaomi Watch 4 -> Mi Fitness -> Health Connect -> LifeOS bridge
```

This app does not use Samsung Health, scrape Mi Fitness/Mi account data, use
Xiaomi private APIs, or require firmware changes. Mi Fitness must publish a
metric to Health Connect before the bridge can read it.

## Scope

- Kotlin Android app scaffold
- Health Connect client structure
- WorkManager worker structure
- Basic Compose `MainActivity`
- `SecureConfigStore` placeholder implementation backed by private `SharedPreferences`
- Previous-day Health Connect aggregation in `Asia/Qyzylorda`
- `LifeOsApiClient` for `POST /api/health/ingest`
- Schedules:
  - `00:01` nightly previous-day sync
  - `00:15` retry
  - `06:00` morning reconcile
  - manual sync from UI

## Required Permissions

Declared Health Connect read permissions:

- `android.permission.health.READ_ACTIVE_CALORIES_BURNED`
- `android.permission.health.READ_DISTANCE`
- `android.permission.health.READ_EXERCISE`
- `android.permission.health.READ_HEART_RATE`
- `android.permission.health.READ_HEART_RATE_VARIABILITY`
- `android.permission.health.READ_OXYGEN_SATURATION`
- `android.permission.health.READ_SLEEP`
- `android.permission.health.READ_STEPS`
- `android.permission.health.READ_TOTAL_CALORIES_BURNED`
- `android.permission.health.READ_WEIGHT`

Network permission:

- `android.permission.INTERNET`

The app also declares a Health Connect permission rationale activity for `android.intent.action.VIEW_PERMISSION_USAGE`.

## Local Build

Install Android Studio or Android command-line tools with:

- JDK 21
- Android SDK Platform 36
- Android Gradle Plugin 8.13.0 compatible Gradle

Then from this folder:

```bash
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
```

This scaffold does not include a checked-in Gradle wrapper binary. Generate one from a machine with Gradle installed:

```bash
gradle wrapper
```

## Runtime Setup

Open the app and save:

- LifeOS API base URL, for example `https://your-lifeos-backend.example.com`
- Health session token issued by the backend endpoint `POST /api/tma/health/ingest-token`

Then grant Health Connect permissions and tap **Sync now** for a manual
previous-day sync. Start with manual sync; scheduled sync can be enabled after
record availability is verified on the Samsung Galaxy S23+.

The bridge stores only the per-user health session token on the Android phone and sends it as `Authorization: Bearer <token>`. The APK no longer accepts or sends a user id; the backend binds ingested metrics only to the user encoded in that signed token.

## Xiaomi Watch 4 Verification

1. Confirm Mi Fitness shows the watch data.
2. In Android Health Connect, confirm Mi Fitness has write access.
3. Confirm records such as steps or sleep are visible from Mi Fitness.
4. Grant this bridge read access.
5. Tap **Sync now**.
6. Check `/health` in Telegram and the TMA Health screen.

If Mi Fitness does not publish a metric to Health Connect, use `/health_log` or
the documented JSON/CSV import fallback.

## TODOs Before Production

- Replace `SharedPreferencesSecureConfigStore` with AndroidX Security or platform-backed encrypted storage.
- Add validation/error messages around backend config fields.
- Add user-visible WorkManager status history.
- Add instrumentation tests with fake Health Connect data.
- Verify exact record availability on target devices and Health Connect provider apps.
- Configure Play Console Health Connect data access declarations before release.

## Auth model

`x-lifeos-ingest-secret` is intentionally unsupported. Health ingest uses only a
per-user signed Bearer token issued by the authenticated TMA session. The Android
APK does not contain a shared backend secret and does not send a configurable
LifeOS user id.
