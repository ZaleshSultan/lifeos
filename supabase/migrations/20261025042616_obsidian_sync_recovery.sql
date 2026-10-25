-- Keep enum additions in a separate migration/transaction before using them.
alter type public.obsidian_sync_status add value if not exists 'retry';
alter type public.obsidian_sync_status add value if not exists 'conflict';
