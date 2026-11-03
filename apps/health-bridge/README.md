# LifeOS Health Bridge

Android source for the Samsung Galaxy S23+ to read permitted Health Connect records and send normalized measurements to the existing LifeOS backend. The current upstream route is Xiaomi Watch 4 → Mi Fitness → Health Connect → LifeOS. A metric must actually be published to Health Connect; no private Xiaomi API, sensor access or Samsung Health synchronization is assumed.

## Current implementation and verification

Source includes a Compose setup/status screen, partial read-permission handling, optional background-read permission, foreground manual sync, seven-day backfill, WorkManager scheduling, Android Keystore AES-GCM token storage and bounded HTTPS requests. These are implemented capabilities with hosted compilation/JVM/lint/APK evidence; handset behavior remains unverified.

The production Debian host has no Java/Android toolchain, so verification runs on the standard free GitHub-hosted Ubuntu runner for this public repository. [Run 41530287979](https://github.com/ZaleshSultan/lifeos/actions/runs/41530287979), source `dbff42005b036470fe9badcf379450687be44283`, passed 21 JVM tests (zero failures/errors/skips), Android lint (zero errors, 13 warnings), APK assembly and `apksigner verify`. The workflow uploads the debug APK, SHA256SUMS and a machine-readable BUILD-VERIFICATION.json; artifact retention is one day. The engineering release state retains a verified local copy after download. This debug build contains no configured personal token or backend credentials.

APK installation, Android Keystore execution, actual Health Connect reads, Galaxy S23+/Mi Fitness accuracy and background execution remain **UNVERIFIED**. No phone was available. The debug certificate is for testing, not a production signing identity. The repository still has no checked-in Gradle wrapper; CI uses pinned Gradle 8.13 without adding a toolchain to production.

## Build on an Android development machine

Use JDK 21, Android SDK Platform 36, Android Gradle Plugin 8.13.0 and its compatible Gradle distribution. On a machine with Gradle installed, from this directory:

```bash
gradle wrapper
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Review and commit the generated wrapper through the normal release process. A debug APK, if those checks succeed, is produced at `app/build/outputs/apk/debug/app-debug.apk`. Do not publish a release APK before configuring signing and any applicable Play Console Health Connect declarations. [Android build compatibility](https://developer.android.com/build/releases/past-releases/agp-8-13-0-release-notes).

## Connect and verify on the phone

1. Confirm that the actual sleep, steps, weight or workouts are visible in Health Connect from their upstream app.
2. Build/install the verified bridge. Open LifeOS Mini App → Health → Connect watch and issue a personal health token.
3. Enter `https://lifeos.zalewko.me` and that token in the bridge. URLs must use HTTPS, without user-info, query or fragment. Redirects are refused so tokens cannot be forwarded to another host.
4. Save the connection. Only the personal token is encrypted on the phone with Android Keystore AES-GCM; the bridge never contains a shared backend or Supabase key. A successful first read migrates the old plaintext preference to encrypted storage. Keystore failure leaves the connection unusable and requires reconnecting.
5. Grant only the read permissions you want. The bridge skips ungranted measurement types; it never writes Health Connect records.
6. Use **Send today and yesterday**, then inspect the latest result and retained last successful transmission time. Confirm the matching source/date in LifeOS Health and Ideal Human.
7. Optionally grant background reads when the device reports support. Without that grant, foreground manual sync remains available. Android decides background execution time; no precise alarm or delivery guarantee is made.
8. Repeat a manual sync and check that backend workout/sample counts do not duplicate. Test permission revocation, expired token, offline/retry and app/device restart using an isolated LifeOS test identity before relying on automation.

The source schedules approximate daily work near 00:01 and 06:00 in Asia/Almaty. WorkManager persists periodic work, requires network access and uses exponential retry starting at 15 minutes for transient failures. There is no separate exact 00:15 job. Existing obsolete one-shot names are cancelled on upgrade. Manual sync runs while the app is open; backfill covers today and the preceding six days. Background reading requires both device feature support and explicit permission. [Health Connect background reads](https://developer.android.com/health-and-fitness/health-connect/read-data).

## Measurement semantics

- Reporting uses Asia/Almaty civil dates; today ends at the current instant. Completed prior days use their full day.
- Completed sleep belongs to its local wake-up date. Asleep/light/deep/REM stages are clipped to their session and merged across overlapping records. Awake/unknown stages are excluded. A session without stages leaves asleep duration unknown; its time in bed is not substituted for sleep. Unavailable deep/REM/awake values stay null.
- Steps use Health Connect aggregation to reduce duplicate upstream counting. Resting heart rate comes only from resting-heart-rate records, separately from ordinary heart rate. Weight, RMSSD HRV and SpO2 remain absent when no permitted records exist.
- Record reads follow every page token. A failed/repeated page aborts that day's submission instead of publishing a partial record list.
- Workouts retain stable Health Connect record IDs, source and original timestamps; daily workout duration merges overlap and clips to the reporting day. Heart-rate detail keeps one actual reading per minute to bound payload size; the daily average uses the complete Health Connect aggregate.
- Empty days are skipped rather than replacing existing values with zero. Ungranted measurement types are omitted, including their missing/correction flags, so revoking one permission cannot erase previously synced source values while another type continues syncing. The backend owns identity, validation and deduplication. Verified automatic data is projected into Ideal Human without overwriting manual journal entries.
- Diagnostics retain the latest fixed status/message and last successful transmission time, without tokens or raw health records. These local diagnostics are separate from backend `health_sync_runs`.

Read permissions cover active/total energy, distance, workouts, heart/resting heart rate, RMSSD HRV, oxygen, sleep, steps and weight. The manifest contains rationale routes for both Android 13 and lower and Android 14+, plus a separately requested background-read permission. [Health Connect setup and manifest](https://developer.android.com/health-and-fitness/health-connect/get-started).

See [the HTTP contract](../../docs/HEALTH_BRIDGE_CONTRACT.md) and [device operations](../../docs/ANDROID_HEALTH_BRIDGE.md). Hosted Android build/lint/JVM tests and a debug-signed APK are available from the workflow above. Remaining work is fake-provider instrumentation, production release signing if distribution requires it, and real Galaxy S23+/Mi Fitness permission, accuracy, retries and background verification. Backend/browser checks cannot prove those device behaviors.
