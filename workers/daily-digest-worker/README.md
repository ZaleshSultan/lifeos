# Daily digest worker

Sends one Telegram briefing per active user each day. The default send time is
`08:00` in the profile timezone (fallback `Asia/Almaty`). The message contains:

- LifeOS tasks/deadlines due today plus tasks captured today without a due date;
- today's university timetable from `study_courses` + `course_schedules`;
- university/manual deadlines in the next 7 days;
- buttons for the Study Mini App and the AITU main-campus map.

The worker polls once per minute only to respect each profile's timezone. It uses
`daily_digest_deliveries` as an idempotency guard, so restarts inside the send
window do not duplicate a successful message. A failed Telegram send releases
the claim and is retried during the configured send window. By default that
window is 12 hours after 08:00, so a morning server restart does not silently
skip the briefing; `DAILY_DIGEST_SEND_WINDOW_MINUTES` can make it shorter.

Copy `.env.example` to `.env`, apply migrations, then install the example systemd
service. Change `DAILY_DIGEST_TIME` to any `HH:MM` value if 08:00 is not desired.


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
