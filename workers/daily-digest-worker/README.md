# Daily digest worker

Sends a morning Telegram briefing only for active users who explicitly opt in
through saved Daily Life preferences. Missing preferences and first-run defaults
send nothing. The editable default clock is `08:00` in a valid profile timezone.
The deterministic briefing uses current LifeOS facts; its saved study fallback contains:

- LifeOS tasks/deadlines due today plus tasks captured today without a due date;
- today's university timetable from `study_courses` + `course_schedules`;
- university/manual deadlines in the next 7 days;
- buttons for the Study Mini App and the AITU main-campus map.

The worker polls once per minute in each profile's timezone. The configured
window uses elapsed UTC time across daylight-saving changes and stays anchored
to the current local date; it does not send yesterday's digest after midnight.
For a scheduled time skipped by a DST jump, delivery starts at the first valid
local minute. A repeated hour uses its first occurrence.

`daily_digest_deliveries` retains the unique `(user_id, local_date)` guard and a
recoverable, owner-scoped lease. Preparation and Telegram sending are separate
states. The database checks the current active profile and Telegram link again
immediately before sending; a stale worker cannot finish a newer worker's claim.

- A crash during preparation is safely recoverable after lease expiry.
- A definite Telegram rejection can be retried with bounded backoff; rate limits
  respect `retry_after`. Three send attempts or preparation failures are terminal.
- A network timeout, ambiguous response, or expired sending lease becomes
  `unknown` and is **not automatically resent**. A crash between marking
  `sending` and the HTTP request can therefore omit a digest.
- An acknowledged response is recorded as `sent` with its Telegram message ID.
  If that database write fails, the row is retained and recovered conservatively
  as `unknown`, rather than deleting it and risking a duplicate.
- Confirmed `sent` dates are never automatically scheduled again.

Telegram delivery and a database commit are not atomic. These policies avoid
blind automatic duplicates but cannot guarantee exactly-once delivery. An
operator should investigate unknown outcomes and explicitly decide whether a
new message is appropriate. Historical `sending` rows are treated as unknown,
not silently reset. Do not clear delivery history to retry them.

Database outages are logged using fixed codes and retried on the next poll.
Logs contain aggregate counters, outcomes and processing duration without message
contents, Telegram IDs, credentials or raw API responses. The poll's acknowledged
count includes Telegram success whose database confirmation could not be saved.
Inspect safe aggregate queue state without sending messages:

```bash
python3 daily_digest_worker.py --status
```

Stop old worker instances, apply the additive notification lifecycle, Daily Life
logs/preferences and `20261103030000_daily_life_notifications.sql` migrations in
order, then start the updated workers. Mixing old insert/delete workers with the new
lease protocol is unsupported. Keep the send window at its default 12 hours
unless a shorter catch-up period is intended.

Copy `.env.example` to `.env`, apply migrations, then install the example systemd
service. Users choose morning/evening times and quiet hours in Daily Life.
`DAILY_DIGEST_TIME` remains a legacy compatibility setting; saved user preferences
govern live scheduling. The same existing worker queues opted-in evening reviews
and at most two gentle hydration nudges into the existing reminders queue.
See [consent and delivery](../../docs/DAILY_LIFE_NOTIFICATIONS.md) for final-send
authorization, cancellation, bounded rendering and rollback details.

## Systemd install

```bash
cd /home/zalewko/lifeos/workers/daily-digest-worker
cp .env.example .env
chmod 600 .env
$EDITOR .env
sudo cp lifeos-daily-digest.service.example /etc/systemd/system/lifeos-daily-digest.service
sudo systemctl daemon-reload
sudo systemctl enable --now lifeos-daily-digest.service
sudo systemctl status lifeos-daily-digest.service
```

The service uses only the Python standard library; no extra pip dependencies are
required. Set `TMA_URL` to the public Mini App URL so the digest buttons open the
LifeOS Study screen and the embedded campus map.
