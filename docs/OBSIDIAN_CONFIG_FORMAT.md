# Obsidian Config Format

Obsidian may later provide structured local config for the Arch worker. Files should be read locally and synced to Supabase by backend/server-side code, not by Telegram or TMA.

## Academic Year

```yaml
type: academic_year
year: 2026
modes:
  - key: exam_war
    starts_on: 2026-05-25
    ends_on: 2026-06-06
  - key: summer_term
    starts_on: 2026-07-06
    ends_on: 2026-08-15
```

## Course

```yaml
type: course
code: DISCRETE-MATH-SUMMER-2026
title: Discrete Mathematics
term: Summer 2026
starts_on: 2026-07-06
ends_on: 2026-08-15
priority: critical
topics:
  - propositional logic
  - truth tables
  - sets and relations
  - induction
  - graph coloring
```

## Mode

```yaml
type: mode
key: exam_war
label: Exam War
explanation: Finals and urgent study first. Projects are reduced.
priorities:
  - finals
  - deadlines
  - study
avoid:
  - random projects
  - heavy distractions
```

## Fitness Plan

```yaml
type: fitness_plan
key: baseline_strength
days:
  - title: Push day
    exercises:
      - name: Push-up
        sets: 3
        reps: 10
        rest_seconds: 90
```

## Reminders

```yaml
type: reminders
items:
  - message: Discrete Mathematics starts today.
    remind_at: 2026-07-06T08:00:00+06:00
    channel: telegram
    source_key: obsidian_config
```
