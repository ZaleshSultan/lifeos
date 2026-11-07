# Certifi remediation prepared for LMS maintenance

Status: **READY_FOR_AUTHORIZED_MAINTENANCE** — preparation only, 2026-11-07 UTC.
**Explicit owner approval is required before installing the override, reloading
systemd, or restarting the LMS worker. None of those actions was performed.**

The isolated replacement resolves GHSA-6q48-6c7w-9gw2 for the tested LMS process
configuration. The running worker still uses the affected trust configuration
until an approved switch.
Other affected environments and the host CA store remain unchanged. This report
does not clear the LifeOS 6.0 merge/deployment hold.

## Reviewed baseline and affected environment

The complete `docs/LIFEOS_V6_FINAL_MERGE_REPORT.md` from PR #78 was read before
preparation. Production health and the clean production checkout report
`066374876a0c7d086965ccdfd6cec1d1fe435ba8`; the read-only database check reports
58 migrations. The accepted release branch remains
`codex/overnight-stabilization-20261031` at
`949905a57c293061eb0c42379da36a2d3ddee2b9`. PRs #76, #77 and #78 remain unmerged.
No application, migration, notification or external AI activation was performed.

| Item                        | Observed value                                                               |
| --------------------------- | ---------------------------------------------------------------------------- |
| System unit                 | `lifeos-lms-grades-worker.service`, active/running                           |
| Unit fragment               | `/etc/systemd/system/lifeos-lms-grades-worker.service`                       |
| Fragment SHA-256            | `241522e5efef5103b4baa50dd726c177fac7534714e79dc529a23fa98afd42d7`           |
| Existing drop-ins           | None                                                                         |
| Configured interpreter      | `/home/zalewko/lifeos/workers/university-sync/.venv/bin/python`              |
| Live executable resolves to | `/usr/bin/python3.11`                                                        |
| Python / OpenSSL            | 3.11.2 / 3.0.20                                                              |
| Working directory           | `/home/zalewko/lifeos/workers/university-sync`                               |
| Worker command              | Existing interpreter, `-u`, existing `lms_grades_worker.py`, `run-loop`      |
| Protected configuration     | Existing worker `.env`, inspected without emitting values                    |
| Installed certifi           | 2026.7.22, affected anchor present                                           |
| requests / urllib3          | 2.34.2 / 2.8.0                                                               |
| Live CA overrides           | No `SSL_CERT_FILE`, `SSL_CERT_DIR`, `REQUESTS_CA_BUNDLE` or `CURL_CA_BUNDLE` |

The original environment is also referenced by **user** services
`lifeos-backup.service`, `lifeos-monitor.service` and
`lifeos-restore-drill.service`, and their timers. Replacing that shared directory
would affect operations outside this mission. The proposed switch changes only
the LMS unit's interpreter and two process-scoped trust paths. The original
environment, base unit, configuration, unrelated services and timers are retained.

Visible release-lock inspection found no held inspected lock. Process metadata
cannot establish the absence of external or queued Codex work. Preparation used
separate worktrees and did not modify another task's checkout or recovery worker.
Repeat coordination and state checks immediately before any authorized switch.

## Isolated replacement and provenance

Prepared environment:
`/home/zalewko/lifeos-runtime-envs/lms-certifi-20261107/venv`.
It uses a copied Python 3.11.2 executable, excludes system site-packages, and has
no path or symlink into the original environment. It is not a live service target.

| Distribution           | Original          | Replacement    | Reason                                                                                 |
| ---------------------- | ----------------- | -------------- | -------------------------------------------------------------------------------------- |
| certifi                | 2026.7.22         | **2026.10.23** | Remove affected trust anchor                                                           |
| pip                    | 23.0.1            | **26.2.2**     | Remove the separate affected vendored certifi bundle; new vendor version is 2026.10.19 |
| Other 11 distributions | Existing versions | Unchanged      | Preserve runtime compatibility and existing downstream fixes                           |

The unchanged versions are beautifulsoup4 4.15.0, cffi 2.1.1,
charset-normalizer 3.5.2, cryptography 50.0.2, idna 3.20, pycparser 3.11,
requests 2.34.2, setuptools 66.1.1, soupsieve 2.10, typing_extensions 4.16.0
and urllib3 2.8.0. Requests' existing certifi lower bound accepts the replacement;
`pip check` passes. Existing project requirement files were not changed.

Artifacts came from official PyPI release metadata and `files.pythonhosted.org`.
The first certifi wheel was checked against an independently reviewed SHA-256
before extraction. Subsequent downloads used only that verified new CA bundle,
with hostname and certificate verification enabled. The pip wheel also had an
independently reviewed hash. Installation into the new environment was offline,
binary-only, exactly pinned, with hashes required and dependency resolution disabled.
No old pip performed network installation; no source builds or install hooks ran.

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| certifi 2026.10.23 wheel    | `e9b54de76e530bb6cf0ccd036787103acb58fd42ba930ea8bf948ddbaa2f61d1` |
| pip 26.2.2 wheel            | `fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70` |
| Installed certifi CA bundle | `2ef52ad56b4803e264045c915e55c236cbfa045b84b81efefc218a19eb44bd2b` |

Six original setuptools files differ from plain PyPI 66.1.1. They exactly match
the installed Debian `66.1.1-1+deb12u2` seed wheel, including existing security
backports. Those six files were copied into the **candidate only**, without
hardlinks; its RECORD was updated. All 498 library files across the 11 unchanged
distributions are byte-identical to the original. Fresh candidate entry points
were retained. This is a retained Debian-patched payload, not an unmodified
PyPI setuptools wheel. Local Debian package verification passed; no fresh APT
signature-chain verification is claimed.

Setuptools metadata has benign header-order differences and omits the original
phantom `debian` top-level entry; neither environment contains such a module.
Dependency metadata is semantically unchanged. No all-metadata byte identity is
claimed. All 13 original-environment RECORD files still match their initial
baselines using normalized text (CRLF to LF); the final seal separately uses
raw bytes. Candidate RECORDs intentionally differ after installation and patch
retention.

The exact wheel inventory, hash lock, retained-file hashes, build script, RECORD
provenance and final environment seal are kept outside Git in the protected
evidence directory. Rebuilding from the PyPI lock alone is insufficient: retain
the six documented Debian files and regenerate the candidate RECORD before
repeating validation. Do not reinstall or move the sealed candidate casually.

## Trust-anchor proof and required process settings

The affected public root is **emSign ECC Root CA - G3**, DER SHA-256:

`86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b`.

It is present in the original certifi bundle and the host default CA store.
It is absent from the candidate certifi, Requests-selected and pip-vendored
bundles. Offline OpenSSL verification accepts the public root under the old
bundle and host defaults, and rejects it under the candidate bundle and proposed
process defaults. Unaffected emSign roots can remain; text searches for the
company name are not a valid advisory test.

An interpreter-only switch is insufficient. The Moodle Requests session has
`trust_env=False` and uses certifi, while
`workers/common/lifeos_sync.py` uses `urllib.request.urlopen` with the default
SSL context. The latter would still load the affected host root. The proposed
LMS override therefore sets both:

```ini
SSL_CERT_FILE=/home/zalewko/lifeos-runtime-envs/lms-certifi-20261107/venv/lib/python3.11/site-packages/certifi/cacert.pem
SSL_CERT_DIR=/home/zalewko/lifeos-runtime-envs/lms-certifi-20261107/trust-empty
```

The second directory exists and is sealed empty, excluding lazy hashed-directory
fallback to host roots. With both settings, the default SSL context excludes
the affected fingerprint, retains `CERT_REQUIRED` and requires hostname checks.
No global CA store or TLS verification policy was changed. Existing EnvironmentFile
keys and dotenv precedence were reviewed; the protected file has neither SSL
setting nor Requests/Curl bundle overrides. Recheck this at maintenance time.

Upstream references: [certifi advisory](https://github.com/certifi/python-certifi/security/advisories/GHSA-6q48-6c7w-9gw2),
[Python security incident guidance](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576),
[certifi release metadata](https://pypi.org/pypi/certifi/2026.10.23/json).

## Completed validation

Tests ran sequentially, with bytecode writes disabled, from an isolated copy of
the **deployed production source** at `0663748`, without a copied `.env`.
External sockets were blocked during compatibility tests. The worker's main
loop and `sync-once` were never executed.

| Check                                                   | Actual result                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Original-environment production-source worker suite     | 410 passed, zero failures/errors/skips                                                                                                  |
| Final candidate worker suite, after patch retention     | 410 passed, zero failures/errors/skips                                                                                                  |
| Final candidate operations suite, after patch retention | 47 passed, zero failures/errors/skips                                                                                                   |
| Dependency consistency                                  | `pip check`: no broken requirements                                                                                                     |
| Dependency and isolated worker imports                  | 14 passed; no credentials or network                                                                                                    |
| Fingerprint/context checks                              | Affected root absent from all three candidate bundle selections and proposed default context                                            |
| Offline OpenSSL trust decisions                         | Four expected outcomes: old stores accept; new bundle and process defaults reject                                                       |
| Loopback TLS handshakes                                 | Eight passed: Requests and urllib each accept valid owned lab CA/hostname and reject unknown CA, wrong hostname and expired certificate |
| Combined trust/TLS checks                               | 12 passed; verification enabled; zero external connections                                                                              |
| Live preservation                                       | Original unit, process identity/start/restart count, argv, source and original bundle preserved                                         |

These are synthetic compatibility/trust results, not a live authenticated Moodle
or Supabase smoke test and not a forged-compromised-chain exploitation test.
Public package metadata/security queries transmitted package names and versions
only. No private LMS data or provider requests were sent.

OSV queries covered the exact 13 installed versions plus pip's vendored certifi.
No advisories were returned for replacement certifi, pip, pip-vendored certifi
or the other runtime dependencies. Setuptools 66.1.1 still produces four distinct
version-based matches: two HIGH, one MODERATE and one LOW. The retained Debian
payload includes documented backports for the two HIGH matches:
[CVE-2024-6345](https://security-tracker.debian.org/tracker/CVE-2024-6345) and
[CVE-2025-47273](https://security-tracker.debian.org/tracker/CVE-2025-47273).
The other two concern macOS source-distribution and Windows legacy-wheel cases;
their applicability was not fully tested. No all-dependency or whole-host clean
security result is claimed. An unrelated setuptools upgrade was intentionally
excluded from this minimal CA remediation.

## Other copies and remaining exposure

Read-only inventory covered nine known project virtualenvs, standard system
package locations and six running containers:

- Separate active google-sync, obsidian-mirror and legacy university-sync parser
  environments contain certifi **2026.6.17**, an affected upstream version. They
  need separately scoped remediation; live trust-path selection was not proven
  for every service.
- The project-root environment has direct certifi 2026.10.23, but old pip-vendored
  certifi copies also exist in existing environments. Updating a direct certifi
  package does not automatically update a vendored copy.
- System certifi and Debian-patched packaging copies require effective-trust and
  downstream-patch assessment; package version alone is insufficient. The host
  default SSL context was directly confirmed to trust the affected root.
- Bounded running-container probes found no Python executables or certifi
  metadata in standard locations. Immutable layers, stopped images and
  nonstandard paths remain unverified. No image was pulled, rebuilt, started,
  stopped or removed; the six running container identities were preserved.

An LMS-only switch leaves those exposures and the original shared environment
intact. This report establishes readiness for that bounded maintenance action.
It does not establish full incident closure or approve subsequent merges.

## Exact maintenance procedure — NOT EXECUTED

Only after explicit owner approval, confirm no competing maintenance/deployment
or recovery work, review current locks, and rerun the read-only preflight below.
Any state/seal mismatch is a stop condition requiring renewed review. The guard
checks source, original/candidate file hashes and modes, unit fragment, exact
process argv, existing configuration, empty trust directory and drop-in ownership
without printing credentials. The original process may naturally renew leases;
do not force-clear them.

The prepared file exists only in the protected evidence directory. Its SHA-256
is `8c9b452398683e3180ddbe1e40e64765f6571239c353092f98f6c6543604c1c9`.
Its complete proposed contents are:

```ini
# PREPARED ONLY: install solely after explicit owner approval.
[Service]
ExecStart=
ExecStart=/home/zalewko/lifeos-runtime-envs/lms-certifi-20261107/venv/bin/python -u /home/zalewko/lifeos/workers/university-sync/lms_grades_worker.py run-loop
Environment="SSL_CERT_FILE=/home/zalewko/lifeos-runtime-envs/lms-certifi-20261107/venv/lib/python3.11/site-packages/certifi/cacert.pem"
Environment="SSL_CERT_DIR=/home/zalewko/lifeos-runtime-envs/lms-certifi-20261107/trust-empty"
```

Run in a shell with failure propagation, only after that approval:

```bash
set -euo pipefail
STATE=/home/zalewko/lifeos-release-state/certifi-remediation-20261107
DROPIN=/etc/systemd/system/lifeos-lms-grades-worker.service.d/90-certifi-20261107.conf
python3 -I -B -S "$STATE/maintenance_guard.py" before
sudo install -d -o root -g root -m 0755 "$(dirname "$DROPIN")"
sudo test ! -e "$DROPIN"
sudo install -o root -g root -m 0644 "$STATE/90-certifi-20261107.conf" "$DROPIN"
sudo systemctl daemon-reload
sudo systemctl restart lifeos-lms-grades-worker.service
python3 -I -B -S "$STATE/maintenance_guard.py" after
systemctl is-active lifeos-lms-grades-worker.service
```

Preserve the current EnvironmentFile, user, working directory, restart policy,
arguments, notification flags and all unrelated unit directives. Do not repoint
the shared `.venv`, modify system CAs or run pip against the live environment.
After an approved restart, verify the new process's candidate argv and both
trust paths; `/proc/PID/exe` alone is insufficient to identify a virtualenv.
Observe only sanitized error categories and aggregate health. Never print raw
journal payloads, environment values or private grade records. Do not invoke
`sync-once`, reconnect credentials, send test notifications or clear receipts.

An interrupted sync can leave a database lease for up to **900 seconds** because
the current worker has no explicit SIGTERM cleanup handler. Allow expiry and
normal polling; do not create a second worker or force-clear its lease. Live
endpoint compatibility remains to be observed after the authorized switch.

## Rollback — only after an approved switch

The original environment and base unit are retained. Remove only the newly owned
drop-in, after validating its exact content, then restart only this LMS worker:

```bash
set -euo pipefail
STATE=/home/zalewko/lifeos-release-state/certifi-remediation-20261107
DROPIN=/etc/systemd/system/lifeos-lms-grades-worker.service.d/90-certifi-20261107.conf
python3 -I -B -S "$STATE/maintenance_guard.py" rollback-ready
printf '%s  %s\n' 8c9b452398683e3180ddbe1e40e64765f6571239c353092f98f6c6543604c1c9 "$DROPIN" | sudo sha256sum --check --status
sudo rm -- "$DROPIN"
sudo systemctl daemon-reload
sudo systemctl restart lifeos-lms-grades-worker.service
python3 -I -B -S "$STATE/maintenance_guard.py" rollback
```

If the new process cannot start, `after` intentionally fails. `rollback-ready`
permits a failed/inactive process while still checking the owned override and
the original/candidate/configuration seals. Inspect failures without printing
secrets and do not bypass an unexplained integrity mismatch. Do not use `systemctl revert`,
remove unrelated drop-ins, restore a database backup or discard newer records.
Rollback restores the **vulnerable original trust store** and must be recorded
as a security regression, not successful remediation.

## Evidence and next owner action

Protected evidence: `/home/zalewko/lifeos-release-state/certifi-remediation-20261107`
(outside Git), including build/retention manifests, package audit, final worker
and operations logs, TLS/import results, live-integrity review,
`maintenance-seal.json` and read-only `maintenance_guard.py`. Synthetic lab
private keys and protected configuration were not published.

Only this documentation is proposed for review. Production remains on
`066374876a0c7d086965ccdfd6cec1d1fe435ba8`, schema 58; the LMS still uses its
original environment. **Next action: explicitly approve the bounded LMS-only
environment/trust-path switch and its rollback procedure.** Until then, stop
before any live service or systemd modification. PRs #76, #77 and #78 stay on hold.
