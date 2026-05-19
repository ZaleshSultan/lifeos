# LifeOS Health Bridge

Android scaffold for syncing previous-day Health Connect data into LifeOS.

This app uses only Android Health Connect. It does not scrape Mi Fitness, use Xiaomi private APIs, or require firmware changes.

## Scope

- Kotlin Android app scaffold
- Health Connect client structure
- WorkManager worker structure
- Basic Compose `MainActivity`
- `SecureConfigStore` placeholder implementation backed by private `SharedPreferences`
- Previous-day Health Connect aggregation
- `LifeOsApiClient` for `POST /health/ingest`
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
- LifeOS user id
- LifeOS ingest secret matching backend `LIFEOS_INGEST_SECRET`

Then grant Health Connect permissions and tap **Sync now** for a manual previous-day sync.

## TODOs Before Production

- Replace `SharedPreferencesSecureConfigStore` with AndroidX Security or platform-backed encrypted storage.
- Add validation/error messages around backend config fields.
- Add user-visible WorkManager status history.
- Add instrumentation tests with fake Health Connect data.
- Verify exact record availability on target devices and Health Connect provider apps.
- Configure Play Console Health Connect data access declarations before release.
