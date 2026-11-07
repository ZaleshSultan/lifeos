# Remaining TLS security remediation preparation

Status: **READY_FOR_AUTHORIZED_MAINTENANCE — three named workers and Debian host trust only**.
Live state: **PREPARED_NOT_ACTIVATED**. V6 source-security gate: **BLOCKED**.

All named candidate environments, isolated TLS/rollback tests and preflight guards
passed. No live environment, unit, service, system CA, credential or record was
changed. The already remediated LMS grades worker was left unchanged.

**Important residual:** an additional read-only assessment found emSign G3 in the
bot/web Node executable's fresh default/bundled CA pool. The host proposal cannot
be assumed to repair that separate pool or cached contexts. Those applications
are outside this task's targets. These procedures therefore do not establish
whole-host incident closure or permission to resume #76/#77 merges. Further
Node-specific assessment/remediation needs its own scope and authorization.

## Actual affected worker identities

| Service                          | Original environment under `/home/zalewko/lifeos` | Original PID / restart count | Original certifi / pip |
| -------------------------------- | ------------------------------------------------- | ---------------------------- | ---------------------- |
| `lifeos-google-sync.service`     | `workers/google-sync/.venv`                       | 916 / 0                      | 2026.6.17 / 23.0.1     |
| `lifeos-obsidian-mirror.service` | `workers/obsidian-mirror/.venv`                   | 969 / 0                      | 2026.6.17 / 23.0.1     |
| `lifeos-university-sync.service` | `workers/university-sync/aitu-parser/.venv`       | 973 / 0                      | 2026.6.17 / 23.0.1     |

All three are active/running, Python 3.11.2. Their direct certifi bundles contain
the affected emSign G3 root; their older pip-vendored certifi also retains incident
trust material. Metadata-only recent journals show activity, not independently
verified successful synchronization. No private source data was read.

The bounded system/user unit inventory found each of these environments referenced
only by its corresponding worker. No CA override, custom ca_certs_locater or
HTTP/HTTPS/ALL/NO_PROXY environment key was found in the live processes/configs.
Original argv, start identity, unit/config/source hashes and package inventories
are frozen privately; no environment values or credential files were copied to tests.

## Trust selection and independent candidates

Each candidate has a copied interpreter, separate package files and its own empty
trust directory. No candidate links into an original environment, another candidate
or the LMS environment. The normal system Python standard-library base remains shared.
All paths below start with `/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/`.

| Candidate prefix       | Unchanged distributions / retained payload files | Updated packages               |
| ---------------------- | ------------------------------------------------ | ------------------------------ |
| `google-sync/venv`     | 23 / 1,907                                       | certifi 2026.10.23; pip 26.2.2 |
| `obsidian-mirror/venv` | 6 / 374                                          | certifi 2026.10.23; pip 26.2.2 |
| `university-sync/venv` | 8 / 397                                          | certifi 2026.10.23; pip 26.2.2 |

Only certifi and pip versions change. Pip's vendored certifi is 2026.10.19.
Other package-owned bytes were copied from the exact original distributions,
with raw-file hash provenance, fresh declared entry points and regenerated RECORDs.
Editable/external dependencies, unowned files, old bytecode and original wrappers
were excluded. Independent full retained-file/RECORD checks passed without mode,
hash, hardlink, cross-candidate or old/LMS-prefix issues.

All six Debian-patched setuptools files in each candidate exactly match the
reviewed local Debian `66.1.1-1+deb12u2` seed-wheel payload. Existing backports were
preserved rather than replaced with plain PyPI 66.1.1. This is local provenance,
not a new APT signature-chain verification.

The two updated official PyPI wheels were independently hash-verified, copied
into this preparation's cache, and installed offline with exact hash pins, no
resolver, source builds or live pip execution:

| Artifact                  | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| certifi 2026.10.23 wheel  | `e9b54de76e530bb6cf0ccd036787103acb58fd42ba930ea8bf948ddbaa2f61d1` |
| pip 26.2.2 wheel          | `fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70` |
| Each selected certifi PEM | `2ef52ad56b4803e264045c915e55c236cbfa045b84b81efefc218a19eb44bd2b` |

Transport controls were selected from actual code:

- Google credential refresh uses Requests; Google API calls use httplib2, whose
  explicit CA-file selection is independent of SSL_CERT_FILE. Google therefore
  also binds HTTPLIB2_CA_CERTS to its own patched bundle. Shared Supabase urllib
  uses the two stdlib settings.
- Obsidian's actual REST transport is urllib; its installed Requests package is
  not its primary transport. SSL_CERT_FILE plus an empty SSL_CERT_DIR exclude
  system-file and lazy hashed-directory fallback.
- Legacy university Requests explicitly sets trust_env=False, so Requests/Curl
  bundle environment variables cannot repair that session. Its own patched
  certifi fixes that path; its shared Supabase urllib needs both stdlib settings.

REQUESTS_CA_BUNDLE and CURL_CA_BUNDLE were not added. Existing credentials,
configuration files, authentication, legacy opt-ins, owners, notification settings
and all non-TLS unit directives stay unchanged.

The unchanged httplib2 fallback `cacerts.txt` still contains the related AAA root.
It is not selected by the reviewed HTTPLIB2_CA_CERTS binding. Retaining that
binding and checking actual CA selection after each switch are necessary; no
claim is made that every dormant certificate file is free of incident material.

## Exact proposed overrides — private files only, NOT installed

### lifeos-google-sync.service

Owned future file: `/etc/systemd/system/lifeos-google-sync.service.d/90-tls-20261107.conf`. SHA-256: `daa3b7143b6a79ca67838fae0085a151396aea1a91ca8ac61606aa048b04681e`.

```ini
# PREPARED ONLY: install solely after explicit service-specific owner approval.
[Service]
ExecStart=
ExecStart=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/google-sync/venv/bin/python -u /home/zalewko/lifeos/workers/google-sync/google_sync.py run-loop
Environment="SSL_CERT_FILE=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/google-sync/venv/lib/python3.11/site-packages/certifi/cacert.pem"
Environment="SSL_CERT_DIR=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/google-sync/trust-empty"
Environment="HTTPLIB2_CA_CERTS=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/google-sync/venv/lib/python3.11/site-packages/certifi/cacert.pem"
```

### lifeos-obsidian-mirror.service

Owned future file: `/etc/systemd/system/lifeos-obsidian-mirror.service.d/90-tls-20261107.conf`. SHA-256: `b6982c866753b5cebdc19ddfd0092807338afff694f00d607262653a03f608c6`.

```ini
# PREPARED ONLY: install solely after explicit service-specific owner approval.
[Service]
ExecStart=
ExecStart=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/obsidian-mirror/venv/bin/python -u /home/zalewko/lifeos/workers/obsidian-mirror/obsidian_mirror.py run-loop
Environment="SSL_CERT_FILE=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/obsidian-mirror/venv/lib/python3.11/site-packages/certifi/cacert.pem"
Environment="SSL_CERT_DIR=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/obsidian-mirror/trust-empty"
```

### lifeos-university-sync.service

Owned future file: `/etc/systemd/system/lifeos-university-sync.service.d/90-tls-20261107.conf`. SHA-256: `3fa167cc5f2e7e4a8a730a430d02f17b6ffbb318e2c7f1831cea771db4d190ed`.

```ini
# PREPARED ONLY: install solely after explicit service-specific owner approval.
[Service]
ExecStart=
ExecStart=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/university-sync/venv/bin/python -u /home/zalewko/lifeos/workers/university-sync/aitu-parser/university_scraper.py run-loop
Environment="SSL_CERT_FILE=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/university-sync/venv/lib/python3.11/site-packages/certifi/cacert.pem"
Environment="SSL_CERT_DIR=/home/zalewko/lifeos-runtime-envs/remaining-tls-20261107/university-sync/trust-empty"
```

## Validation actually completed

Tests used an isolated production-source checkout at
`066374876a0c7d086965ccdfd6cec1d1fe435ba8`, without .env files or live credentials.
Heavy work ran sequentially; no production build or real worker sync was started.

| Check                                                           | Actual result                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google complete worker suite                                    | Original 2 / candidate 2 PASS; no failures/skips                                                                                                             |
| Obsidian complete worker and shared filesystem suites           | Original 84 / candidate 84 PASS; no failures/skips                                                                                                           |
| Legacy university scraper, pipeline and session-security suites | Original 100 / candidate 100 PASS; no failures/skips                                                                                                         |
| Imports, pip check, selected trust contexts, CLI dispatch       | All three candidates PASS                                                                                                                                    |
| Synthetic startup                                               | All three PASS: real CLI and one fully mocked poll, network/writes blocked; no systemd service started                                                       |
| Candidate loopback TLS                                          | 24 PASS across six transport/service pairs: six verified local HTTP responses, 18 expected certificate failures                                              |
| Candidate public TLS-only probes                                | Five PASS: Google OAuth/Google API, AITU, Microsoft and Supabase public hosts; no HTTP/auth/sync                                                             |
| Maintenance switch/rollback rehearsal                           | 13 mock-only tests PASS, including three complete flows, failed candidate fallback and partial-install cleanup without restarting the still-original process |
| Sealed worker preflights                                        | Google 4,914 files, Obsidian 1,813, university 1,862; five symlinks each; all `before` guards PASS                                                           |
| Integrity rejection checks                                      | Three corrupted private worker manifests and one modified private host proposal rejected; real artifacts untouched                                           |
| Host rehearsal                                                  | 150 → 148 → 150 roots; exact unaffected-root preservation, original bundle and ordinary incremental directory-state rollback                                 |
| Host TLS                                                        | Four loopback cases and two unauthenticated public TLS handshakes PASS                                                                                       |
| Host sealed preflight                                           | `before` PASS, including its 13 prepared-artifact hashes                                                                                                     |

For every candidate transport, valid owned test CA/hostname was accepted;
unknown CA, wrong hostname and expired certificate were rejected with actual
SSLCertVerificationError semantics. The unknown-CA cases used the actual proposed
candidate defaults; the other lab cases used an explicit test CA to isolate
chain, expiry and hostname behavior. Certificate/hostname verification stayed on.
Loopback clients/server also had loopback-only DNS/socket restrictions.

The fixed public probes performed TLS handshakes only. They do not establish
private account access, source freshness or successful synchronization. Same-prefix
probes do not inspect an already-running worker's Python/SSLContext heap.

Thirty exact package/version OSV queries returned no advisories for the new direct
certifi, pip or pip-vendored certifi. No returned severity was Critical. **Other
retained advisories remain:** alias-deduplicated totals are Google 20, Obsidian 7,
university 9. These are not new CA findings and were not silently upgraded:

- Google: HIGH matches include httplib2 response decompression, urllib3 proxy TLS/
  response handling, pyasn1 decoders, OAuthlib and cryptography PKCS7 behavior.
- Obsidian: installed urllib3 HIGH/MODERATE findings remain; its reviewed active
  REST path uses urllib instead.
- University: urllib3 HIGH/MODERATE and Soup Sieve MODERATE findings remain.
- All three: four setuptools version matches remain; the two known HIGH cases
  have preserved Debian backport evidence. The other platform/build cases are
  not asserted universally mitigated.

Proxy keys/explicit proxy configuration were absent and the future guards pin
that key-presence baseline. No PKCS7 use was found in reviewed worker/client code;
Google uses OAuth client flows, not a configured OAuth server. These are bounded
applicability observations, not blanket proof of unreachability. httplib2 response
DoS may be active; pyasn1 decoder reachability is unresolved. Full vulnerability
clearance is not claimed, and no exploit traffic was sent.

## Debian host proposal and isolated proof

The host has Debian-managed `ca-certificates 20250419~deb12u1`; the official
bookworm incident fix is `20250419~deb12u2`. This preparation does not run APT or
claim that changing local selection updates package metadata.

| Enabled source under `/usr/share/ca-certificates` | Current config line | Incident DER SHA-256                                               |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `mozilla/emSign_ECC_Root_CA_-_G3.crt`             | 62                  | `86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b` |
| `mozilla/Comodo_AAA_Services_root.crt`            | 43                  | `d7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef4` |

Both sources are distribution-owned, not locally added. There were zero local
.crt anchors and zero update hooks. Debian's incident fix covers both roots
because of the related cross-signing path; deleting G3 alone is insufficient for
that path. The smallest proposal prefixes `!` to exactly those two active lines
in `/etc/ca-certificates.conf`, then runs the installed update-ca-certificates tool.
It neither deletes source files nor replaces the system bundle with certifi.

| Host artifact                   | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| Original config                 | `dcff5b2e3909d9057813ac9a57e3dd1238a1044976f65bf403213bebc92e5bed` |
| Proposed config                 | `42fb7e07e18a58e98028091842f71bb09b1200412c215f6ac94f6b569a6a8aa3` |
| Original 150-root bundle        | `2bcdfd0b3724b2bc309dfd2af809c6f734cc7b12ee5d1878f03dea2b09a89708` |
| Proposed 148-root bundle        | `8393d2f4593213f970873d9ca1d11834c3a874e47c1cfe8f408280c3416e3058` |
| Prepared host-artifact manifest | `a382d92954992838b7697ba121e0085198ab5ca1695707b19f3365316007e2e1` |

The installed Debian updater was rehearsed only with private source/config/output/
local/hook/TMPDIR paths. Both fresh and ordinary incremental update/rollback passed.
Control and rollback reproduced the original bundle byte for byte; only the two
incident-related roots disappeared in the proposal, with all other roots intact.
Fresh OpenSSL/context checks rejected both roots in the proposal, including hashed
CA-directory fallback, and reaccepted both in the rollback fixture.

Official sources: [Debian update-ca-certificates manual](https://manpages.debian.org/bookworm/ca-certificates/update-ca-certificates.8.en.html),
[Debian DLA tracker](https://security-tracker.debian.org/tracker/DLA-4845-1),
[Debian incident/fix discussion](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1151446),
[certifi advisory](https://github.com/certifi/python-certifi/security/advisories/GHSA-6q48-6c7w-9gw2),
and [Python security guidance](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576).
The direct DLA announcement page returned HTTP 403; the official tracker and bug were
retrieved independently. Package metadata/provenance and effective trust are
separate evidence.

## Future maintenance order and approval boundary

**These commands are prepared, not authorized or executed by this task.** One explicit owner grant may cover all three named worker steps; execute them
sequentially with verification between steps, without repeated approval prompts.
The host operation requires its own explicitly approved scope.
Use an owner terminal with ordinary interactive sudo; never change sudoers or
share passwords. Establish an exclusive maintenance window, inspect current release/
APT/dpkg activity, competing tasks and pending unrelated unit changes. Stop for
any seal, literal PID/start/restart, unit, source, config, hook or trust drift.

Set `TLS_STATE=/home/zalewko/lifeos-release-state/remaining-tls-remediation-20261107`.
The read-only guard can run without a live-change grant:

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_guard.py" before --service obsidian
```

**1. Obsidian first**, to validate the simplest transport. Only after its explicit
approval, execute the single-service wrapper below. It installs only the reviewed
owned override, reloads systemd and restarts only this service, then runs `after`.

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_maintenance.py" switch --service obsidian --owner-authorized
```

Stop and observe normal polling and sanitized error categories before proceeding.
The existing crash/idempotency protocol must recover naturally; do not modify a
vault, clear jobs/leases or generate a test capture.

**2. Google**, under that grant and after the preceding step passes, verifying all three selected TLS
paths and normal polling without invoking auth, sync-once or reconnecting OAuth:

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_maintenance.py" switch --service google --owner-authorized
```

**3. Legacy university**, after the prior service is accepted, verifying its own
Requests bundle and Supabase stdlib path without a forced LMS sync:

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_maintenance.py" switch --service university --owner-authorized
```

Each invocation requires its own stable original identity and unchanged seals;
there is no batch restart/automatic rollback. The wrapper records only sanitized
outcomes and compares the unrelated long-running process identities, including LMS.
After each switch, run the selected `after --service ...` guard, verify actual
argv/trust settings, compare matching-interpreter selected CAs, and observe ordinary
service logs. A fresh child probe is not a live-process memory inspection. Natural
lease expiry, cached sessions, existing auth failures and poll intervals may limit
what can be observed; no forced data operation is permitted as a smoke test.

Rollback commands, **only when authorized and necessary for that service**:

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_maintenance.py" rollback --service obsidian --owner-authorized
```

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_maintenance.py" rollback --service google --owner-authorized
```

```bash
python3 -I -B -S "$TLS_STATE/remaining_tls_maintenance.py" rollback --service university --owner-authorized
```

Rollback checks the exact owned drop-in and original/candidate seals, removes only
that file, reloads and restarts only the selected original worker. For a narrowly
proved partial installation while the literal original process is still healthy,
it removes/reloads the owned override **without restarting** that original process.
An unexplained integrity mismatch stops for review. No systemctl revert, shared
venv repoint, database restore or credential change is used. Original-env rollback
reintroduces affected trust and restores **BLOCKED security status**.

## Separate future host operation

The complete sealed host procedure is in
`$TLS_STATE/host/FUTURE_HOST_MAINTENANCE.md`. Its approved execution is distinct from
all worker restarts. Exact backup/apply commands, not executed here:

```bash
set -euo pipefail
TLS_STATE=/home/zalewko/lifeos-release-state/remaining-tls-remediation-20261107
HOST_STATE="$TLS_STATE/host"
HOST_BACKUP=/var/backups/lifeos-host-ca-20261107
python3 -I -B -S "$HOST_STATE/host_ca_guard.py" before
sudo test ! -e "$HOST_BACKUP"
sudo install -d -o root -g root -m 0700 "$HOST_BACKUP"
sudo tar --acls --xattrs --numeric-owner -C / -cpf "$HOST_BACKUP/host-trust.tar" etc/ca-certificates.conf etc/ssl/certs usr/share/ca-certificates
sudo cp --preserve=mode,ownership,timestamps -- /etc/ca-certificates.conf "$HOST_BACKUP/ca-certificates.conf.original"
sudo sh -c 'set -eu; umask 077; cd "$1"; sha256sum host-trust.tar ca-certificates.conf.original > SHA256SUMS; sha256sum --check --status SHA256SUMS' sh "$HOST_BACKUP"
sudo tar -tf "$HOST_BACKUP/host-trust.tar" >/dev/null
python3 -I -B -S "$HOST_STATE/host_ca_guard.py" before
sudo install -o root -g root -m 0644 "$HOST_STATE/ca-certificates.conf.proposed" /etc/ca-certificates.conf
sudo /usr/sbin/update-ca-certificates
python3 -I -B -S "$HOST_STATE/host_ca_guard.py" after
```

Rollback restores only the exact saved config and regenerates from unchanged sealed
sources; the backup archive is an offline recovery artifact, not permission to
extract over a subsequently changed host:

```bash
set -euo pipefail
TLS_STATE=/home/zalewko/lifeos-release-state/remaining-tls-remediation-20261107
HOST_STATE="$TLS_STATE/host"
HOST_BACKUP=/var/backups/lifeos-host-ca-20261107
python3 -I -B -S "$HOST_STATE/host_ca_guard.py" rollback-ready
sudo sh -c 'set -eu; cd "$1"; sha256sum --check --status SHA256SUMS' sh "$HOST_BACKUP"
printf '%s  %s\n' dcff5b2e3909d9057813ac9a57e3dd1238a1044976f65bf403213bebc92e5bed "$HOST_BACKUP/ca-certificates.conf.original" | sudo sha256sum --check --status
sudo cp --preserve=mode,ownership,timestamps -- "$HOST_BACKUP/ca-certificates.conf.original" /etc/ca-certificates.conf
sudo /usr/sbin/update-ca-certificates
python3 -I -B -S "$HOST_STATE/host_ca_guard.py" rollback
```

Rollback retrusts the incident roots and is a security regression. Never bypass a
failed guard or restore user/database records. No blanket service restart is part
of the host operation.

## Adoption limits and remaining scope

Disk trust changes affect newly loaded contexts. A new TCP connection can still use
a cached SSLContext/root pool or resumed session; a fresh external probe does not
prove every daemon adopted the change. The three future, separately approved worker restarts would create
new processes with their independent reviewed trust paths. The LMS remains on its
already remediated independent environment and must not be restarted by this plan.

Reminder/digest source creates default urllib connections; subsequent new contexts
should load new host defaults, while in-flight/cached contexts are not retroactively
changed. Operations callers, container/JVM/NSS/browser stores and custom clients
need their own applicability checks. Cloudflared process inspection was permission-
limited; no connector restart or blanket adoption claim is prepared.

The bot/web use the same inspected Node 22.23.2 executable. A fresh Node TLS probe
reported 145 default/bundled roots including exact emSign G3 (AAA absent), with no
observed startup CA-selection flag/override. This is a concrete default-pool
inventory concern, not a live heap/custom-agent or exploitation claim. Host edits
must not be assumed to fix Node's bundled pool. **Global V6 security remains
BLOCKED pending separate Node assessment/remediation and a fresh applicability audit.**
Original shared/dormant certifi and vendor copies also remain separately recorded.

## Preserved production and evidence

Production remains healthy at `066374876a0c7d086965ccdfd6cec1d1fe435ba8`, schema 58;
accepted source remains `949905a57c293061eb0c42379da36a2d3ddee2b9`. #76/#77 were not
merged, no migrations 59/60 were applied, and no bot/web/LMS restart, credential/data
change, private import, Telegram message or AI/academic activation occurred.
Existing worktrees and production containers were preserved. Candidate packages,
fixture keys, protected config hashes and raw inventories remain outside Git.

Private evidence: `/home/zalewko/lifeos-release-state/remaining-tls-remediation-20261107`.
Worker seal SHA-256 values:

- Google: `baa7281b3c8510bf8db242604d96541bf4361deffdd661314619757e0e3830e4`.
- Obsidian: `d191c4e08d7e632318c7162ba2872782bf99d2ae3be2511f6d5fedecd2e66454`.
- University: `4e43b93880a6ec8fb9f1a6b68e1630e0536e4042df5534ea161d38b01fe6d710`.

These seals include exact original/candidate files, source/configuration, unit,
prepared guard/action code and updated wheel hashes. They are integrity inventories,
not publisher signatures. **No live switch or host update is authorized by this
preparation.** Owner review/approval of the clearly scoped maintenance sequence is the final
prerequisite; it does not authorize Node changes or source integration.
