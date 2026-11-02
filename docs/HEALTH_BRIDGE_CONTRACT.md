# Health Bridge Contract

`POST /health/ingest` and its `/api/health/ingest` alias accept authenticated, validated daily sync payloads from the Android Health Connect bridge. All supplied fields remain untrusted until backend validation. The bridge can send completed prior days or today's partial measurements; it never sends future observations.

## Headers

```text
content-type: application/json
Authorization: Bearer $LIFEOS_HEALTH_SESSION_TOKEN
```

The backend verifies the personal HS256 Bearer token with `LIFEOS_HEALTH_INGEST_JWT_SECRET`, checks its maximum 30-day expiry and stored token-hash credential/revocation, then verifies the active owner. The backend resolves the owner; the bridge does not send a user ID or shared ingest secret. Issue/revoke personal credentials through authenticated Mini App Health, never by embedding a backend key in an APK.

## Sync Reasons

- `nightly_00_01`
- `retry_00_15`
- `morning_reconcile_06_00`
- `manual`
- `backfill`

These are accepted reason labels, not exact timer guarantees. The v2 Android source uses approximate WorkManager periodic requests near 00:01/06:00 and exponential transient retry; it has no separate exact 00:15 alarm. Device background feature support and permission are required. See [Android operations](ANDROID_HEALTH_BRIDGE.md).

## Payload Shape

```json
{
  "date": "2026-05-17",
  "sync_reason": "nightly_00_01",
  "source": "xiaomi_health_connect",
  "timezone": "Asia/Almaty",
  "metrics": {
    "sleep_minutes": 480,
    "deep_sleep_minutes": 90,
    "rem_sleep_minutes": 80,
    "awake_minutes": 20,
    "steps": 9200,
    "active_energy_kcal": 620,
    "calories_burned": 2300,
    "resting_heart_rate": 58,
    "average_heart_rate": 76,
    "hrv_ms": 45,
    "spo2_avg": 97,
    "distance_meters": 6200,
    "weight_kg": 70.5,
    "mood_score": 7,
    "energy_score": 6,
    "stress_score": 3
  },
  "workouts": [
    {
      "external_id": "health-connect-workout-1",
      "started_at": "2026-05-17T10:00:00.000Z",
      "ended_at": "2026-05-17T10:45:00.000Z",
      "workout_type": "strength",
      "duration_minutes": 45
    }
  ],
  "samples": [
    {
      "sample_type": "heart_rate",
      "sampled_at": "2026-05-17T10:15:00.000Z",
      "value": 110,
      "unit": "bpm"
    }
  ],
  "missing": {
    "stress": true,
    "sleep_stages": false
  },
  "raw": {}
}
```

The backend accepts both snake_case and camelCase field names for compatibility.

Example numbers illustrate the format and are not real observations. Missing numeric measurements stay absent/null, never zero-filled. Current Android source aggregates only granted types, assigns stage-derived sleep to its wake-up date and keeps sleep unknown when a session has no stages. Ordinary heart rate never substitutes for resting heart rate. Stable upstream workout/sample identities support retry deduplication.

## Backend Effects

- Upsert `health_daily` by `user_id, log_date`.
- Calculate `recovery_mode`.
- Calculate `data_completeness_score` as a 0..100 availability score.
- Store explicit missing metric flags in `missing_metrics`.
- Insert `health_sync_runs`.
- Upsert `health_workouts` when `external_id` is present.
- Upsert `health_samples` with stable identity by owner, source, sample type,
  instant and unit; retries preserve one row and corrected values update it.
- Mirror supported scalar metrics into `health_metrics` for mini-app daily
  and weekly summaries. `average_heart_rate` is separate from resting HR;
  `distance_meters` maps to the existing `distance_m` metric type.
- Create or update `life_entities` with `entity_type = health_daily`.
- Enqueue `obsidian_sync_queue`.

`/healthsync_status` reports `health_sync_runs`, not the Obsidian queue. Obsidian queue status remains a separate mirror concern.

## Health Mode Labels

Internal values and UI labels:

- `recovery` -> Recovery Mode
- `maintenance` -> Normal-Light
- `baseline` -> Normal
- `growth` -> High Performance

## Test Curl

```bash
curl -X POST "http://localhost:3000/health/ingest" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $LIFEOS_HEALTH_SESSION_TOKEN" \
  -d @health-payload.json
```
