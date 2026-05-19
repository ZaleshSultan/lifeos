# Health Bridge Contract

`POST /health/ingest` accepts trusted previous-day sync payloads from the Android Health Connect bridge.

## Headers

```text
content-type: application/json
x-lifeos-ingest-secret: $LIFEOS_INGEST_SECRET
```

The backend compares the header to `LIFEOS_INGEST_SECRET` with a timing-safe comparison.

## Sync Reasons

- `nightly_00_01`
- `retry_00_15`
- `morning_reconcile_06_00`
- `manual`
- `backfill`

## Payload Shape

```json
{
  "user_id": "00000000-0000-0000-0000-000000000000",
  "date": "2026-05-17",
  "sync_reason": "nightly_00_01",
  "source": "health_connect",
  "timezone": "Asia/Qyzylorda",
  "metrics": {
    "sleep_minutes": 480,
    "deep_sleep_minutes": 90,
    "rem_sleep_minutes": 80,
    "awake_minutes": 20,
    "steps": 9200,
    "active_energy_kcal": 620,
    "calories_burned": 2300,
    "resting_heart_rate": 58,
    "hrv_ms": 45,
    "spo2_avg": 97,
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

## Backend Effects

- Upsert `health_daily` by `user_id, log_date`.
- Calculate `recovery_mode`.
- Calculate `data_completeness_score` as a 0..100 availability score.
- Store explicit missing metric flags in `missing_metrics`.
- Insert `health_sync_runs`.
- Upsert `health_workouts` when `external_id` is present.
- Insert `health_samples`.
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
  -H "x-lifeos-ingest-secret: $LIFEOS_INGEST_SECRET" \
  -d @health-payload.json
```
