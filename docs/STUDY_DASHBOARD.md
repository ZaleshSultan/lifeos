# Study dashboard

The mini-app's study dashboard combines the existing LMS grade records, a weekly
timetable from `course_schedules`, and a manual grade scenario. Supabase remains
the source of truth. A scenario never overwrites a real Moodle score.

## Diagnose missing Moodle scores

From the repository root, run the read-only aggregate check with the AITU
worker environment:

```bash
workers/university-sync/aitu-parser/.venv/bin/python scripts/diagnose_moodle_scores.py
```

For a multi-user worker configuration, pass `--env-file workers/university-sync/.env`
and `--user-id <LifeOS user UUID>`. The command reads active Moodle source events,
their `academic_records` rows and the last ten university sync runs. It prints
only counts and statuses; it never prints grade text, titles, user IDs, error
messages or credentials. A successful recent run with `db_score_null > 0` means
those scores were already absent at the database boundary. The
`null_score_html_contains_digit` count flags rows for parser review; a digit in
a grade cell alone does not prove that Moodle displayed a numeric score.
Moodle can append an action menu to a numeric grade in the same HTML cell; the
scraper excludes that menu before reading the score. Existing rows receive the
correct score and percentage on the next successful sync. No database migration
is required.

## Import the supplied HTML

Save the supplied `расписание.html` locally, for example `~/lifeos/расписание.html`.
The HTML is an import input; do not publish it as a static mini-app asset or add it
to the repository. It contains a personal timetable and instructors' names.

Run from the repository root, using the existing university worker environment:

```bash
cd ~/lifeos
LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC=true \
  workers/university-sync/aitu-parser/.venv/bin/python \
  scripts/import_study_dashboard.py --html ./расписание.html
```

The default run previews changes without writing. To apply the import:

```bash
cd ~/lifeos
LIFEOS_ENABLE_LEGACY_SINGLE_USER_UNIVERSITY_SYNC=true \
  workers/university-sync/aitu-parser/.venv/bin/python \
  scripts/import_study_dashboard.py --html ./расписание.html --apply
```

Settings come from `workers/university-sync/aitu-parser/.env`; `--env-file PATH`
can select another file. The target is `LIFEOS_DEFAULT_USER_ID` in this explicitly
accepted single-user environment. No Moodle login or cookie is needed for this
import. Existing service credentials remain on the server.

The importer recognizes these five existing active course codes:

| HTML course | LifeOS course |
| --- | --- |
| OS 2207 | OS52-EN |
| SUBD 2217 | DMS52-EN |
| RL 2202 | K(RUSSIAN)L51-RU |
| CNC 2305 | CNC53-EN |
| DLD 2201 | DLD52-EN |

It reads the 25 timetable rows and the calculator formulas as text. It never
executes the HTML's scripts. It verifies all courses, coefficients and timetable
rows before the first write. Missing/ambiguous course matches or unexpected extra
timetable rows stop the import without deleting anything.

Existing slots match by owned course, day and start time. Two moves from the old
repository seed are recognized explicitly: networks Saturday 18:00 to Friday
14:00, and operating systems Saturday 17:00 to Thursday 17:00. Other unmatched
slots require review. The importer does not delete rows, create courses, change
course ownership or overwrite Moodle links.

Rerunning is idempotent. Saved scenario values, targets and unrelated course
metadata are preserved. A concurrent metadata edit causes the affected update to
stop rather than overwrite the edit. The REST requests are not a single database
transaction: a network error can leave some steps applied. Run the preview again
and repeat the import; successfully applied rows will not be duplicated.

## Calculator semantics

Each course's metadata contains `study_calculator_v1` with `definition`, `values`
and `target`. The definition comes from the imported HTML. The default target is
70. The supplied formula is:

`final = attestation 1 × 0.30 + attestation 2 × 0.30 + exam × 0.40`

Weights within each attestation are kept separate from final-grade weights:

| Subject | Components in each attestation |
| --- | --- |
| Operating systems | Four labs × 20%, midterm/endterm 20% |
| Database management | Three assignments × 20%, quiz 10%, midterm/endterm 30% |
| Language | Assignment 60%, midterm/endterm 40% |
| Computer networks | Practice/labs 60%, midterm/endterm 40% |
| Digital logic | Practice/labs 60%, midterm/endterm 40% |

Every input is a finite number from 0 to 100 or an unknown value. An empty input
remains unknown; an entered zero is a real zero. A complete attestation/final is
shown only when all its components are entered. Until then the scenario reports
the minimum and maximum possible final score. Once both attestations are complete,
it can calculate the exam score needed for the target, including an answer above
100 when the target cannot be reached.

The imported threshold of 25 is a rule supplied in the user's HTML, not a verified
university policy. Threshold status and mathematical target reachability are
separate. Unknown attestations do not count as failed. The UI does not automatically
map Moodle assignments to scenario inputs: assignment groups, scales and syllabus
coefficients can differ.

## Checks

```bash
pnpm typecheck
pnpm test
python3 scripts/import_study_dashboard_test.py
```

The importer tests use invented timetable labels and a fake database; they never
read user credentials or contact Moodle/Supabase.
