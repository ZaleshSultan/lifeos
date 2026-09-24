# Workout programs and recorded sessions

The TMA saves one custom program per authenticated user in `user_settings.settings.workout_program`. A program contains named training days. Saving a program preserves other settings; it does not change sets in an already started workout. No database migration is required.

```json
{
  "title": "My program",
  "days": [
    {
      "id": "day-a",
      "title": "Day A",
      "exercises": [
        {
          "name": "Squat",
          "sets": [{ "reps": 8, "weightKg": 40, "restSeconds": 120 }]
        }
      ]
    }
  ]
}
```

Limits: 14 days, 30 exercises per day, 20 sets per exercise. Day IDs are unique strings of 1–80 ASCII letters, numbers, underscores or hyphens. Titles and exercise names contain 1–120 characters. Exercise names must be unique within a day. Repetitions are integers from 1 to 1000, weight is `null` when not recorded or 0–2000 kg, rest is an integer from 0 to 3600 seconds.

All endpoints require the existing TMA authentication and return `{ "data": ... }` on success. The authenticated user determines ownership; payload user IDs are ignored.

| Method and path                           | Request                                              | Data                                                 |
| ----------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| GET `/api/tma/workout/program`            | —                                                    | Program or `null`                                    |
| PUT `/api/tma/workout/program`            | Program                                              | Saved program                                        |
| POST `/api/tma/workout/start`             | `{ "programDayId": "day-a" }` or `{}`                | Current workout                                      |
| GET `/api/tma/workout/current`            | —                                                    | Current workout or `null`                            |
| PATCH `/api/tma/workout/sets/:id`         | `{ "reps": 8, "weightKg": 42.5, "restSeconds": 90 }` | Updated current workout                              |
| POST `/api/tma/workout/sets/:id/complete` | —                                                    | Updated current workout                              |
| POST `/api/tma/workout/sets/:id/undo`     | —                                                    | Updated current workout                              |
| POST `/api/tma/workout/:id/complete`      | —                                                    | Completed workout                                    |
| GET `/api/tma/workout/history`            | —                                                    | Up to 50 completed sessions, newest completion first |

Starting without a day retains the existing life-mode template. Starting while a session is active resumes that session. A saved day is copied into session sets when starting; subsequent set edits affect that session only.

Set responses retain the existing API field names `targetReps` and `targetWeightKg`; after editing these are the recorded values, with the program retaining the plan. `restSeconds` is included for each set. An omitted weight preserves `null`, distinct from an explicit weight of zero. The TMA saves changed values before marking a set complete, reloads after a failed request, and prevents finishing while the visible sets have unsaved edits. The rest timer is calculated from the server deadline and current wall time so it catches up after Telegram resumes.

History sessions include the current workout fields plus `endedAt` and `volumeKg`. Volume sums `repetitions × kilograms` for completed sets only. Sets without a recorded weight and unfinished sets contribute zero; this is external load volume, not a measurement of total physical work. Completed sessions have no running rest timer. The TMA groups progress by exercise name and displays performed sets, total repetitions, maximum recorded weight and external load volume by date.

Invalid input returns 400, unavailable program days or sets return 404, and set edits/complete/undo on an ended workout return 409. All persistent reads and changes are scoped to `user_id`, including exercise names. The legacy single-user server mode must not be treated as multi-user authentication.
