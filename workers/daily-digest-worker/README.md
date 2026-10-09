# Daily digest worker

Sends one Telegram briefing per active user each day. The default send time is
`06:00` in the profile timezone (fallback `Asia/Almaty`). The message contains:

- LifeOS tasks/deadlines due today plus tasks captured today without a due date;
- today's university timetable from `study_courses` + `course_schedules`, with
  the first online class and the first campus class highlighted separately;
- personalized weather from the user's saved location;
- university/manual deadlines in the next 7 days;
- buttons for the Study Mini App and the AITU main-campus map.

The worker polls once per minute to respect each profile's timezone. Atomic
service-role RPCs use `INSERT ... ON CONFLICT DO NOTHING`, so an ordinary repeated
check returns no claim without generating PostgreSQL `23505` errors. The RPC
checks that the active profile belongs to the requested Telegram chat. A claim
token fences concurrent workers and preparation leases expire after five minutes.

Preparation failures and explicit Telegram rejections (for example a validated
`429` response) become `retry` and can be claimed again during the send window.
Successful messages become `sent`, including Telegram's message ID. Completion
is safe to repeat using the same claim. By default the send window is 12 hours
after 06:00, so a morning restart can catch up; change
`DAILY_DIGEST_SEND_WINDOW_MINUTES` to shorten it.

Once the outbound phase is committed, a network timeout or a crash may mean that
Telegram already accepted the message. Such `sending`/`uncertain` claims are never
automatically resent, including when Telegram succeeded but the database failed
while recording completion. Inspect these rows and the actual chat before any
manual retry. Telegram does not provide a transaction shared with PostgreSQL,
so both guaranteed delivery and guaranteed absence of duplicates cannot be
promised for this gap. Historical `sent` and `sending` rows are preserved; old
`sending` rows also require review rather than automatic retry.

Check migration history before deployment. The LifeOS production project already
has `20261008000400_daily_digest_claims.sql`; do not reapply it. For a separate
database where it is missing, apply it once after
`20261005000100_daily_digest_deliveries.sql`, with the old worker stopped. The
updated code intentionally has no fallback to duplicate-generating INSERTs if
its RPCs are missing.

Copy `.env.example` to `.env`, apply migrations, then install the example systemd
service. Change `DAILY_DIGEST_TIME` to any `HH:MM` value if 06:00 is not desired.

Read-only delivery diagnostics:

```sql
select local_date,status,count(*)
from public.daily_digest_deliveries
group by local_date,status order by local_date desc,status;
```

Run local tests without sending Telegram messages:

```bash
cd /home/zalewko/lifeos
python3 -m unittest discover -s workers/daily-digest-worker -p '*_test.py'
LIFEOS_TEST_PG_BIN=/path/to/postgresql/bin bash scripts/test-study-postgres.sh
```


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
