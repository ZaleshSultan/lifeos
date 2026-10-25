# Obsidian mirror

See [recovery and safe rollout](../../docs/OBSIDIAN_SYNC_RECOVERY.md) for the
current queue protocol, filesystem guarantees, conflicts and migration order.

```bash
python obsidian_mirror.py status
python obsidian_mirror.py run-once
python obsidian_mirror.py run-loop
python obsidian_mirror.py render-test
python obsidian_mirror.py init-dashboards
```

Install the worker together with `workers/common/`; it uses the existing service
role environment only on the backend. Per-user queue processing requires active
profiles and enabled, active, connected local/Syncthing settings. Vault roots are
server-owned `/var/lifeos/vaults/<user_id>`. Disabled owners keep a pending backlog.

Legacy dashboard initialization requires explicit opt-in plus a valid
`LIFEOS_DEFAULT_USER_ID`; it is never a fallback for other owners. New generated
notes have a durable owner/path/hash binding. Existing differing unmanaged notes
require manual review. Never run old and new mirror versions concurrently.

The `status` command is read-only and does not touch any vault. `render-test`
prints synthetic Markdown without writing files. All automated filesystem tests
use temporary directories. See `.env.example` and the existing `systemd/` unit
for installation settings; deployment is a separate approved operation.
