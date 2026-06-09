# Old Projects Migration

This document is the staging plan for moving older notes, scripts, and trackers into LifeOS without polluting the kernel.

## Inventory First

For each old project, record:

- source location
- owner/user identity
- data type
- sensitive fields
- target LifeOS layer
- whether it should mirror to Obsidian

## Migration Targets

- Inbox text and notes -> `life_entities` as `capture` or `review`.
- Todo lists -> `tasks` plus optional `life_entities`.
- Deadline lists -> `life_entities` as `deadline`, with `due_at`.
- Health exports -> `health_daily`, `health_workouts`, and `health_samples` only after normalization.
- Spending logs -> finance tables or `life_entities` as `spend`.

## Rules

- Do not import duplicates without an external id or checksum.
- Preserve original timestamps when known.
- Keep raw imports in a temporary folder or staging table until validated.
- Never import secrets into Obsidian.
- Prefer small batches with manual review over one large blind import.

## Suggested Process

1. Export source data to a neutral format.
2. Create a one-off parser under a temporary migration folder.
3. Map rows to LifeOS contracts.
4. Dry-run and produce counts.
5. Import to Supabase.
6. Enqueue Obsidian sync only after spot-checking.
7. Archive the original source read-only.
