# Android Health Bridge Plan

The Android bridge uses Health Connect only. It does not scrape Mi Fitness, use Xiaomi private APIs, or require firmware changes.

## Components

- `MainActivity` - basic configuration/status UI.
- `HealthConnectBridge` - Health Connect client structure.
- `HealthAggregator` - previous-day range aggregation.
- `HealthSyncWorker` - WorkManager sync worker.
- `HealthSyncScheduler` - schedules nightly, retry, reconcile, and manual work.
- `SecureConfigStore` - placeholder secure storage boundary.
- `LifeOsApiClient` - posts to `POST /health/ingest`.

## Schedule

- `00:01` nightly previous-day sync.
- `00:15` retry.
- `06:00` morning reconcile.
- Manual sync from UI.

## Required Permissions

The exact Health Connect permission list should match the implemented metrics. Expected categories:

- sleep sessions
- heart rate
- resting heart rate
- heart rate variability
- steps
- active calories
- exercise sessions
- weight, if enabled

## Production TODOs

- Finalize the Health Connect permission request UX.
- Validate background scheduling on target Android versions.
- Harden secure config storage.
- Add instrumentation tests on a device with Health Connect.
- Confirm timezone behavior around DST and travel.
