# LifeOS Health Bridge

Android app for syncing Xiaomi Watch 4 data into LifeOS through the
Samsung Galaxy S23+ and Android Health Connect:

```text
Xiaomi Watch 4 -> Mi Fitness -> Health Connect -> LifeOS bridge
```

This app does not use Samsung Health, scrape Mi Fitness/Mi account data, use
Xiaomi private APIs, or require firmware changes. Mi Fitness must publish a
metric to Health Connect before the bridge can read it.

## Scope

- Kotlin Android app
- Health Connect client structure
- WorkManager worker structure
- Russian Compose connection and sync screen
- Android Keystore AES-GCM token encryption (with migration from legacy plain preferences)
- Previous-day Health Connect aggregation in the phone's local timezone
- `LifeOsApiClient` for `POST /api/health/ingest`
- Schedules:
  - `00:01` nightly previous-day sync
  - WorkManager exponential retry on transient network failures
  - `06:00` morning reconcile
  - foreground manual sync for today and yesterday; foreground seven-day historical import
- in-app success/error status and Health Connect background-read permission

## Required Permissions

Declared Health Connect read permissions:

- `android.permission.health.READ_ACTIVE_CALORIES_BURNED`
- `android.permission.health.READ_DISTANCE`
- `android.permission.health.READ_EXERCISE`
- `android.permission.health.READ_HEART_RATE`
- `android.permission.health.READ_RESTING_HEART_RATE`
- `android.permission.health.READ_HEART_RATE_VARIABILITY`
- `android.permission.health.READ_OXYGEN_SATURATION`
- `android.permission.health.READ_SLEEP`
- `android.permission.health.READ_STEPS`
- `android.permission.health.READ_TOTAL_CALORIES_BURNED`
- `android.permission.health.READ_WEIGHT`
- `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND` (optional, only on supported devices)

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
./gradlew :app:testDebugUnitTest
./gradlew :app:lintDebug
```

The repository does not check in a Gradle wrapper. Generate one from a machine with Gradle installed:

```bash
gradle wrapper
```

## Runtime Setup

Open the app and save:

- LifeOS API base URL, for example `https://your-lifeos-backend.example.com`
- Health session token issued by the backend endpoint `POST /api/tma/health/ingest-token`

Then grant the desired Health Connect permissions and tap **Отправить данные за сегодня и вчера**. Check the in-app sync status with **Обновить результат**. Manual sync works without background access while the app is open. Automated background sync is best-effort, available only with permission and device support.

The bridge encrypts the per-user health session token in Android Keystore on the phone and sends it as `Authorization: Bearer <token>`. The APK no longer accepts or sends a user id; the backend binds ingested metrics only to the user encoded in that signed token.

## Xiaomi Watch 4 Verification

1. Confirm Mi Fitness shows the watch data.
2. In Android Health Connect, confirm Mi Fitness has write access.
3. Confirm records such as steps or sleep are visible from Mi Fitness.
4. Grant this bridge read access.
5. Tap **Отправить данные за сегодня и вчера** (keep the app open).
6. Check `/health` in Telegram and the TMA Health screen.

If Mi Fitness does not publish a metric to Health Connect, use `/health_log` or
the documented JSON/CSV import fallback.

## Data semantics

- Resting heart rate comes only from `RestingHeartRateRecord`; ordinary heart
  rate is stored separately as `average_heart_rate`. No resting reading means
  missing, never a substituted daily average.
- HRV is the mean of actual RMSSD records; oxygen saturation is the mean of
  actual SpO2 records. Both remain missing when Mi Fitness exports no readings.
- Every record query follows all page tokens. A failed page aborts the sync;
  a partial day is never silently submitted.
- Sleep uses published asleep/light/deep/REM stage intervals, clipped to the
  previous local day and merged to avoid duplicate overlap. Awake/unknown time
  is excluded. Sessions with no stages do not become fabricated sleep totals;
  `sleep_minutes` remains missing. Stage-specific totals stay missing if that
  stage is absent from the available records.
- Daily workout minutes merge overlapping sessions and clip to the day. The
  original session timestamps, title, source, type code and stable Health
  Connect record ID are retained in each workout.
- Heart rate detail sends at most one real reading per minute, choosing the
  earliest timestamp (then source) deterministically. Its original timestamp
  and value are preserved. Daily average HR still uses Health Connect's
  aggregate of all readings. This keeps a normal daily JSON request below the
  backend's 1 MiB limit without sending fabricated samples.
- The bridge sends one object payload with metrics, workouts, samples and
  missing flags. The signed token determines the owner; no client user ID is
  sent. Backend retries upsert workouts and samples instead of duplicating
  them, and mirror daily scalar metrics for the mini-app and weekly trends.

After installing an updated debug build, grant the new resting-heart-rate
permission again. Validate manual sync while the bridge is open on the phone;
scheduled background access remains a separate device/provider verification
step, and requires Android Health Connect background-read support/permission.

Reference: [Health Connect reads and pagination](https://developer.android.com/health-and-fitness/health-connect/read-data).

## TODOs Before Production

- Build/debug and install an APK on the actual Galaxy S23+ with Android Studio.
- Verify background sync runs with granted `READ_HEALTH_DATA_IN_BACKGROUND`, battery optimization and supported Health Connect version.
- Upgrade from one-record sync status to a rolling WorkManager history.
- Add instrumentation tests with fake Health Connect data.
- Verify exact record availability on target devices and Health Connect provider apps.
- Configure Play Console Health Connect data access declarations before release.

## Auth model

`x-lifeos-ingest-secret` is intentionally unsupported. Health ingest uses only a
per-user signed Bearer token issued by the authenticated TMA session. The Android
APK does not contain a shared backend secret and does not send a configurable
LifeOS user id.

## Functional updates

- Manual send now uploads **today so far plus yesterday**; seven-day backfill has a separate action.
- Automatic sync uses periodic WorkManager tasks; manual sync runs in the open Activity to support devices without Health Connect background-read support. The app must remain open during manual import. Exact delivery at 00:01 or 06:00 is **not guaranteed** by Android.
- An optional background Health Connect read permission is requested separately only on devices supporting it; otherwise manually run the app in foreground.
- API requires HTTPS and stores the per-user token encrypted with the Android Keystore. Invalid/expired tokens produce actionable 401/403 status.
- A zero-result sync is not reported as a successful upload. Open Mi Fitness and Health Connect permissions to confirm whether data is exported.

## Token renewal

Health tokens generated by the existing TMA endpoint expire after **30 days**. If the app shows HTTP 401/403, open LifeOS Mini App → Health → Connect watch, request a new token and paste it into this app. Never use a shared backend service-role key.
