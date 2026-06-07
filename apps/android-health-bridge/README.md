# LifeOS Android Health Connect Bridge

Installable Android APK for manually syncing Xiaomi Watch 4 metrics from
Health Connect into LifeOS:

```text
Xiaomi Watch 4
-> Mi Fitness on Samsung Galaxy S23+
-> Android Health Connect
-> LifeOS Android Health Bridge
-> POST /api/health/ingest
-> LifeOS
```

The app does not use Samsung Health, scrape a Xiaomi/Mi account, contain
Supabase keys, or send anything automatically. Health data is read only after
the user taps **Sync Today** or **Sync Last 7 Days**. The app shows a local
metrics preview before a separate **Send Preview to LifeOS** action.

## Build

Requirements:

- JDK 21
- Android SDK Platform 36
- Android SDK Build Tools 36

From `apps/android-health-bridge`:

```bash
./gradlew :app:assembleDebug
```

Debug APK output:

```text
apps/android-health-bridge/app/build/outputs/apk/debug/app-debug.apk
```

Android Studio alternative:

1. Open `apps/android-health-bridge` as a project.
2. Allow Android Studio to install SDK Platform 36 and required build tools.
3. Select **Build > Build APK(s)**.

## Install On Samsung Galaxy S23+

Enable Developer options and USB debugging on the phone, connect it by USB,
accept the debugging prompt, then run:

```bash
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

You can also transfer `app-debug.apk` to the phone and open it. Android may ask
you to allow installs from the file-manager app.

## Configure And Sync

1. Open **LifeOS Android Health Bridge**.
2. Enter backend URL:

   ```text
   https://archlinux.tail2492c9.ts.net
   ```

3. Enter the backend health ingest secret and tap **Save encrypted config**.
   The URL and secret stay on the phone in Android Keystore-backed encrypted
   preferences. The secret is never logged or included in payload JSON.
4. Tap **Grant Health Connect permissions** and allow the available requested
   data types.
5. Tap **Sync Today** or **Sync Last 7 Days**. This only reads Health Connect
   and creates a local preview.
6. Review the metrics, then tap **Send Preview to LifeOS**.
7. Check Telegram `/health` and TMA Health.

## Health Connect Permissions

The app requests read-only access to:

- Steps
- Sleep sessions
- Heart rate
- Resting heart rate
- Exercise sessions
- Active calories burned
- Total calories burned
- Weight
- Oxygen saturation
- Distance

Daily metrics are aggregated in `Asia/Qyzylorda` and normalized to:

- `steps`
- `sleep_minutes`
- `resting_heart_rate`
- `average_heart_rate`
- `active_energy_kcal`
- `total_energy_kcal`
- `workout_minutes`
- `distance_m`
- `weight_kg`
- `spo2_percent`

## API Request

Each non-empty preview day is sent independently:

```http
POST https://archlinux.tail2492c9.ts.net/api/health/ingest
content-type: application/json
x-lifeos-health-secret: <local secret>
```

```json
{
  "date": "2026-06-07",
  "source": "xiaomi_health_connect",
  "device": "Xiaomi Watch 4",
  "timezone": "Asia/Qyzylorda",
  "metrics": [
    { "type": "steps", "value": 8000, "unit": "steps" }
  ],
  "raw": {}
}
```

## If Mi Fitness Does Not Write To Health Connect

The bridge can only read records that exist in Health Connect.

1. Confirm Xiaomi Watch 4 data appears in Mi Fitness.
2. On the S23+, open **Settings > Security and privacy > More privacy settings
   > Health Connect**. The exact path can vary by One UI version.
3. In Health Connect, verify Mi Fitness is connected and has permission to
   write the relevant data type.
4. Open Health Connect data and confirm the record is actually present.
5. Return to this app, grant its read permission, and create a fresh preview.

Mi Fitness may publish only a subset of its metrics, may publish them after a
delay, or may not support Health Connect export in a particular region/app
version. The bridge cannot recover metrics that Mi Fitness never writes.

## Limitations

- V1 is manual-only; no background or scheduled sync exists.
- Health Connect permissions can be revoked at any time.
- The last seven days are within Health Connect's normal recent-data access
  window; longer history may require additional history permission and is not
  implemented.
- The app reads the first page of sleep, exercise, and oxygen records for each
  day. This is sufficient for normal daily use but is not a bulk archive tool.
- Debug APKs are signed with the local Android debug key and are intended for
  personal sideloading.
- Publishing through Google Play would require Health Connect data-access
  declarations and a release signing configuration.
