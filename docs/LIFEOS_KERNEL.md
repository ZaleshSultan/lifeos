# LifeOS Kernel

The kernel is the smallest durable model that the rest of LifeOS builds on.

## Core Concepts

- `profiles` maps external identities, such as Telegram users, to a LifeOS `user_id`.
- `life_entities` stores capture, task, deadline, health, review, finance, spend, and workout events in a common timeline.
- `obsidian_sync_queue` records Markdown mirror work for the Arch worker.
- `tasks`, `daily_logs`, `workouts`, and layer-specific tables hold structured state when a life entity needs more than timeline text.

## Entity Contract

A life entity has:

- `user_id` for tenant isolation.
- `entity_type` for domain routing.
- `title` and optional `body`.
- `occurred_at` and optional `due_at`.
- source fields such as Telegram command or health ingest.
- optional `linked_table` and `linked_id`.
- `metadata` for small structured facts that do not deserve a table yet.

## Rules

- Every user-facing capture should become either a structured domain row, a `life_entities` row, or both.
- Anything that should appear in Obsidian should enqueue `obsidian_sync_queue`.
- Service-role writes stay in trusted backend or worker processes.
- RLS remains enabled on user data tables; public read/write policies are not used.
- Health mode internal values are `recovery`, `maintenance`, `baseline`, and `growth`; UI labels are Recovery Mode, Normal-Light, Normal, and High Performance.

## Evolution

Add specialized tables only when query shape, integrity, or reporting needs exceed `life_entities.metadata`. Keep `packages/core` pure so Telegram, web, Android, and workers can share behavior without importing runtime services.
