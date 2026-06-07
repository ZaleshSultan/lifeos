# Xiaomi Watch 4 Android Health Bridge

## Architecture

```text
Xiaomi Watch 4
-> Mi Fitness on Samsung Galaxy S23+
-> Android Health Connect, when Mi Fitness publishes the record
-> LifeOS Android bridge or manual/import fallback
-> POST https://archlinux.tail2492c9.ts.net/api/health/ingest
-> Supabase health_metrics
-> TMA Health, Telegram /health, and Obsidian Health
```

LifeOS does not depend on Samsung Health and does not scrape the Mi account.
Health Connect permissions and the ingest secret stay on the phone. The
backend receives only normalized daily metrics.

## Health Connect Records

The bridge should request only the records the user grants:

- `StepsRecord`
- `SleepSessionRecord`
- `HeartRateRecord`
- `ExerciseSessionRecord`
- `TotalCaloriesBurnedRecord`
- `ActiveCaloriesBurnedRecord`
- `WeightRecord`
- `OxygenSaturationRecord`

Aggregate records per local day in `Asia/Qyzylorda`. Start with manual sync;
add scheduled WorkManager sync only after Xiaomi/Mi Fitness record availability
is verified on the Samsung Galaxy S23+.

## API Contract

```json
{
  "date": "2026-06-07",
  "source": "xiaomi_health_connect",
  "device": "Xiaomi Watch 4",
  "timezone": "Asia/Qyzylorda",
  "metrics": [
    { "type": "steps", "value": 8200, "unit": "steps" },
    { "type": "sleep_minutes", "value": 420, "unit": "min" },
    { "type": "resting_heart_rate", "value": 62, "unit": "bpm" },
    { "type": "active_energy_kcal", "value": 450, "unit": "kcal" }
  ],
  "raw": {}
}
```

Send the secret only in the `x-lifeos-health-secret` header:

```bash
curl -X POST "https://archlinux.tail2492c9.ts.net/api/health/ingest" \
  -H "content-type: application/json" \
  -H "x-lifeos-health-secret: $LIFEOS_INGEST_SECRET" \
  --data @health.json
```

The API validates metric types and source, then upserts idempotently by
`user_id, metric_date, metric_type, source`.

## Manual And Import Fallbacks

Telegram manual entry:

```text
/health_log steps:8000 sleep:7h rhr:62 weight:70.5 mood:7 energy:6
```

For exports that cannot be read through Health Connect, normalize JSON or CSV
locally and send with source `import_json` or `import_csv`. Do not upload phone
tokens or Mi account credentials to Supabase.

## Troubleshooting

- Mi Fitness has the metric but LifeOS does not: check whether Mi Fitness
  actually published that record to Health Connect.
- Empty TMA Health: use `/health_sources`, then test `/health_log`.
- HTTP 401: the phone secret does not match `LIFEOS_INGEST_SECRET` or
  `HEALTH_INGEST_SECRET` on the backend.
- HTTP 400: inspect the response for an unsupported source, metric type, date,
  or value.
