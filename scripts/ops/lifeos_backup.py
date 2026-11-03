#!/usr/bin/env python3
"""Encrypted PostgreSQL backups and guarded, network-isolated restore drills.

The only hosted database operations are a read-only query and provisioning the
provider's short-lived READ-ONLY login. This program has no production restore.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid

from backup_crypto import decrypt, encrypt, key_bytes
from ops_common import (Management, OpsError, atomic_json, command, env_file,
                        load_config, lock, private_dir, read_json, sha256,
                        utcnow, utcstamp)

MANAGED_BY = "lifeos-ops-backup-v1"
FILE_PATTERN = re.compile(r"lifeos-v1-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump\.enc")
DATA_TABLES = {"auth.users", "public.profiles", "public.academic_records",
               "public.study_courses", "public.workouts", "public.finance_transactions"}


def ram_directory(config: dict) -> Path:
    root = private_dir(Path(config["runtime_dir"]))
    filesystem = command(["findmnt", "-n", "-o", "FSTYPE", "-T", str(root)], timeout=10).decode().strip()
    if filesystem not in {"tmpfs", "ramfs"}:
        raise OpsError("plaintext_runtime_must_be_ramfs")
    return root


def owner(config: dict) -> str:
    try:
        return str(uuid.UUID(config["canonical_user_id"]))
    except (ValueError, KeyError, TypeError):
        raise OpsError("canonical_owner_config_invalid") from None


def source_preflight(config: dict, management: Management) -> dict:
    identity = owner(config)
    environment = env_file(Path(config["bot_env_file"]))
    if environment.get("SUPABASE_URL", "").rstrip("/") != "https://" + config["project_ref"] + ".supabase.co":
        raise OpsError("configured_database_identity_mismatch")
    telegram = config.get("canonical_telegram_user_id")
    if not isinstance(telegram, int) or telegram <= 0:
        raise OpsError("canonical_telegram_config_invalid")
    query = """select jsonb_build_object(
      'auth_users',(select count(*) from auth.users),
      'profiles',(select count(*) from public.profiles),
      'academic_records',(select count(*) from public.academic_records),
      'study_courses',(select count(*) from public.study_courses),
      'workouts',(select count(*) from public.workouts),
      'finance_transactions',(select count(*) from public.finance_transactions),
      'migration_count',(select count(*) from supabase_migrations.schema_migrations),
      'profile_orphans',(select count(*) from public.profiles p left join auth.users u on u.id=p.user_id where u.id is null),
      'canonical_mapping',(select count(*) from public.profiles where user_id='%s'::uuid and telegram_user_id=%d and status='active')) result
    """ % (identity, telegram)
    facts = management.query(query)[0]["result"]
    if facts.get("canonical_mapping") != 1 or facts.get("profile_orphans") != 0:
        raise OpsError("canonical_identity_or_integrity_changed")
    for name, minimum in config["minimum_rows"].items():
        if not isinstance(minimum, int) or minimum < 0 or facts.get(name, -1) < minimum:
            raise OpsError("production_userdata_floor_failed")
    return facts


class PostgresClient:
    def __init__(self, config: dict):
        self.config = config
        self.image = config.get("client_image", "postgres:17")
        self.dump_timeout = config.get("dump_timeout_seconds", 360)
        if type(self.dump_timeout) is not int or not 60 <= self.dump_timeout <= 420:
            raise OpsError("invalid_dump_timeout_seconds")
        # Trusted operator config, but never accept command/volume fragments.
        if not re.fullmatch(r"[a-z0-9./:_-]+", self.image):
            raise OpsError("invalid_client_image")

    def run(self, executable: str, args: list[str], *, mounts=None, environment=None,
            network="none", timeout=120) -> bytes:
        name = "lifeos-backup-client-" + uuid.uuid4().hex
        # Dump/archive-inspection stdout contains private plaintext. Docker's
        # default json-file logger must not copy it out of the private RAMfs flow.
        argv = ["docker", "run", "--rm", "--pull=never", "--log-driver=none", "--name", name,
                "--label", "lifeos.ops=backup-client-v1", "--network=" + network,
                "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                "--pids-limit=32", "--memory=128m", "--user=" + str(os.getuid()) + ":" + str(os.getgid())]
        for local, remote in mounts or []:
            if "," in str(local) or local.is_symlink():
                raise OpsError("unsafe_client_mount")
            argv += ["--mount", "type=bind,src=" + str(local.resolve()) + ",dst=" + remote + ",readonly"]
        for key, value in (environment or {}).items():
            argv += ["--env", key + "=" + value]
        argv += ["--entrypoint=" + executable, self.image, *args]
        try:
            return command(argv, timeout=timeout)
        finally:
            # Only this invocation's unpredictable newly created client name.
            subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15)

    def dump(self, management: Management, directory: Path) -> bytes:
        poolers = management.request("/config/database/pooler")
        if not isinstance(poolers, list) or not poolers:
            raise OpsError("database_pooler_unavailable")
        host = poolers[0].get("db_host", "")
        if not re.fullmatch(r"aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com", host):
            raise OpsError("untrusted_database_pooler")
        # Official session-pooler endpoint; no malformed legacy DSN is read.
        port = "5432"
        role = management.request("/cli/login-role", {"read_only": True})
        if role.get("role") != "cli_login_supabase_read_only_user" or not 0 < role.get("ttl_seconds", 0) <= 600:
            raise OpsError("readonly_login_role_unavailable")
        username = role["role"] + "." + management.ref
        escape = lambda value: value.replace("\\", "\\\\").replace(":", "\\:")
        passfile = directory / "pgpass"
        passfile.write_text(":".join(map(escape, [host, port, "postgres", username, role["password"]])) + "\n")
        passfile.chmod(0o600)
        certificate = Path(self.config["database_ca_file"])
        from ops_common import secret
        if b"-----BEGIN CERTIFICATE-----" not in secret(certificate):
            raise OpsError("database_ca_unavailable")
        environment = {"PGHOST": host, "PGPORT": port, "PGDATABASE": "postgres", "PGUSER": username,
                       "PGPASSFILE": "/run/pgpass", "PGSSLMODE": "verify-full",
                       "PGSSLROOTCERT": "/run/database-ca.crt", "PGCONNECT_TIMEOUT": "10",
                       "PGAPPNAME": "lifeos-backup-v1",
                       "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=120000"}
        try:
            # A newly provisioned login can take a few seconds to reach the
            # pooler's authentication cache. Reuse the same short-lived password
            # for at most three bounded probes; never retry TLS verification.
            native_env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", **environment,
                          "PGPASSFILE": str(passfile), "PGSSLROOTCERT": str(certificate)}
            time.sleep(10)
            for attempt in range(3):
                try:
                    probe = command(["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-c",
                                     "SET ROLE supabase_read_only_user;BEGIN READ ONLY;"
                                     "SELECT current_user||'|'||current_setting('transaction_read_only');ROLLBACK;"],
                                    env=native_env, timeout=20)
                    if probe.strip() != b"supabase_read_only_user|on":
                        raise OpsError("readonly_login_assertion_failed")
                    break
                except OpsError as error:
                    if str(error) != "database_authentication_failed" or attempt == 2:
                        raise
                    time.sleep(3 * (attempt + 1))
            try:
                # pg_dump's default repeatable-read snapshot is already
                # consistent under concurrent application writes. Requiring a
                # serializable-deferrable snapshot can wait indefinitely for
                # unrelated writers before any archive bytes are produced.
                archive = self.run("pg_dump", ["--format=custom", "--compress=6", "--no-password",
                                   "--role=supabase_read_only_user", "--lock-wait-timeout=15000"],
                                   mounts=[(passfile, "/run/pgpass"), (certificate, "/run/database-ca.crt")],
                                   environment=environment, network="host", timeout=self.dump_timeout)
            except OpsError as error:
                raise OpsError("pg_dump_" + str(error)) from None
            if not archive.startswith(b"PGDMP") or len(archive) > self.config.get("max_archive_bytes", 128 * 1024 * 1024):
                raise OpsError("archive_invalid_or_size_limit")
            return archive
        finally:
            passfile.unlink(missing_ok=True)
            # The shared provider role is not blindly deleted: its password expires
            # in <=600s. Deleting it could revoke another operator's later login.

    def inspect_archive(self, archive: Path) -> tuple[dict, dict]:
        self.run("pg_restore", ["--list", "/run/archive"], mounts=[(archive, "/run/archive")])
        args = ["--data-only", "--no-owner", "--no-acl", "--file=-"]
        for table in sorted(DATA_TABLES):
            args += ["--table=" + table.split(".")[1]]
        raw = self.run("pg_restore", args + ["/run/archive"], mounts=[(archive, "/run/archive")])
        return archive_counts(raw.decode(), owner(self.config), self.config["canonical_telegram_user_id"])


def archive_counts(sql: str, canonical_user_id: str, telegram_user_id: int) -> tuple[dict, dict]:
    """Inspect actual archive COPY rows without logging any row or identifier."""
    counts = {table: 0 for table in DATA_TABLES}
    canonical = {table: 0 for table in DATA_TABLES}
    table = None
    columns = []
    # PostgreSQL COPY uses ASCII LF. str.splitlines also splits valid Unicode
    # separators inside notes, and would invent records in such a backup.
    for line in sql.split("\n"):
        match = re.fullmatch(r'COPY "?([a-z_]+)"?\."?([a-z_]+)"? \((.*?)\) FROM stdin;', line)
        if match:
            table = match[1] + "." + match[2]
            columns = [column.strip().strip('"') for column in match[3].split(",")]
            continue
        if table:
            if line == "\\.":
                table = None
                continue
            if table not in counts:
                continue
            values = dict(zip(columns, line.split("\t")))
            counts[table] += 1
            key = "id" if table == "auth.users" else "user_id"
            if values.get(key) == canonical_user_id:
                if table != "public.profiles" or (values.get("telegram_user_id") == str(telegram_user_id) and values.get("status") == "active"):
                    canonical[table] += 1
    return counts, canonical


def assert_archive_data(config: dict, counts: dict, canonical: dict) -> None:
    for name, minimum in config["minimum_rows"].items():
        table = "auth.users" if name == "auth_users" else "public." + name
        if counts.get(table, -1) < minimum:
            raise OpsError("archive_missing_real_userdata")
    if canonical.get("public.profiles") != 1 or canonical.get("auth.users") != 1:
        raise OpsError("archive_canonical_identity_missing")
    for table, minimum in config.get("canonical_minimum_rows", {}).items():
        if canonical.get(table, -1) < minimum:
            raise OpsError("archive_canonical_userdata_missing")


def verify_backup(config: dict, manifest_path: Path) -> dict:
    manifest = read_json(manifest_path)
    if not manifest or manifest.get("managed_by") != MANAGED_BY:
        raise OpsError("unrecognized_backup_manifest")
    filename = manifest.get("filename", "")
    if not FILE_PATTERN.fullmatch(filename):
        raise OpsError("invalid_backup_filename")
    archive = manifest_path.parent / filename
    if archive.is_symlink() or not archive.is_file():
        raise OpsError("unsafe_archive_file")
    if sha256(archive) != manifest.get("cipher_sha256"):
        raise OpsError("backup_checksum_failed")
    with tempfile.TemporaryDirectory(prefix="lifeos-verify-", dir=ram_directory(config)) as directory:
        plain = Path(directory) / "database.dump"
        result = decrypt(archive, plain, key_bytes(Path(config["key_file"])), expected_project=config["project_ref"])
        if result["plaintext_sha256"] != manifest.get("plaintext_sha256"):
            raise OpsError("backup_plaintext_checksum_failed")
        counts, canonical = PostgresClient(config).inspect_archive(plain)
        assert_archive_data(config, counts, canonical)
        return {"verified_at_utc": utcstamp(), "cipher_sha256": manifest["cipher_sha256"],
                "counts": counts, "canonical_owner_verified": True}


def offsite_copy(config: dict, files: list[Path]) -> dict:
    remote = config.get("offsite_remote")
    if not remote:
        return {"configured": False, "verified": False}
    if not re.fullmatch(r"[A-Za-z0-9_-]+:[A-Za-z0-9/_-]+", remote):
        raise OpsError("invalid_offsite_prefix")
    for file in files:
        destination = remote.rstrip("/") + "/" + file.name
        command(["rclone", "copyto", str(file), destination, "--immutable", "--checksum",
                 "--contimeout", "10s", "--timeout", "60s", "--retries", "1"], timeout=120)
        metadata = json.loads(command(["rclone", "lsjson", destination, "--stat", "--timeout", "30s"], timeout=45))
        if metadata.get("Size") != file.stat().st_size:
            raise OpsError("offsite_size_mismatch")
        downloaded = command(["rclone", "cat", destination, "--timeout", "60s", "--retries", "1"], timeout=90)
        import hashlib
        if hashlib.sha256(downloaded).hexdigest() != sha256(file):
            raise OpsError("offsite_checksum_failed")
    return {"configured": True, "verified": True, "file_count": len(files), "verified_at_utc": utcstamp()}


def retention_candidates(directory: Path, now: dt.datetime, *, days=30, minimum=7) -> list[tuple[Path, Path]]:
    """Only this format's verified pairs; never existing historical backups."""
    if days < 7 or minimum < 2 or directory.is_symlink():
        raise OpsError("unsafe_retention_policy")
    valid = []
    for path in directory.glob("lifeos-v1-*.manifest.json"):
        if path.is_symlink():
            continue
        value = read_json(path, {})
        name = value.get("filename", "")
        if value.get("managed_by") != MANAGED_BY or not value.get("verified") or not FILE_PATTERN.fullmatch(name):
            continue
        archive = directory / name
        if archive.is_symlink() or not archive.is_file() or sha256(archive) != value.get("cipher_sha256"):
            continue
        try:
            created = dt.datetime.fromisoformat(value["created_at_utc"])
            if created.tzinfo is None:
                continue
        except (KeyError, ValueError):
            continue
        valid.append((created, path, archive))
    valid.sort(reverse=True)
    return [(manifest, archive) for created, manifest, archive in valid[minimum:]
            if created < now - dt.timedelta(days=days)]


def run_backup(config: dict) -> dict:
    directory = private_dir(Path(config["backup_dir"]))
    state = private_dir(Path(config["state_dir"]))
    with lock(state / "backup.lock"):
        try:
            management = Management(config)
            facts = source_preflight(config, management)
            timestamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
            stem = "lifeos-v1-" + timestamp + "-" + uuid.uuid4().hex[:8]
            target = directory / (stem + ".dump.enc")
            manifest_path = directory / (stem + ".manifest.json")
            with tempfile.TemporaryDirectory(prefix="lifeos-backup-", dir=ram_directory(config)) as temporary:
                plain = Path(temporary) / "database.dump"
                plain.write_bytes(PostgresClient(config).dump(management, Path(temporary)))
                plain.chmod(0o600)
                counts, canonical = PostgresClient(config).inspect_archive(plain)
                assert_archive_data(config, counts, canonical)
                created = utcstamp()
                encrypted = encrypt(plain, target, key_bytes(Path(config["key_file"])),
                                    {"format": 1, "kind": "postgres-custom", "project_ref": config["project_ref"],
                                     "created_at_utc": created, "managed_by": MANAGED_BY})
                manifest = {"managed_by": MANAGED_BY, "format": 1, "filename": target.name,
                            "created_at_utc": created, "project_ref": config["project_ref"],
                            "cipher_sha256": sha256(target), **encrypted, "counts": counts,
                            "canonical_owner_verified": True, "migration_count": facts["migration_count"],
                            "verified": True, "offsite": {"configured": False, "verified": False}}
                atomic_json(manifest_path, manifest)
                verification = verify_backup(config, manifest_path)
                # A full remote account must never erase a verified local result.
                # Record local success before attempting optional off-site I/O.
                local_success = {"completed_at_utc": utcstamp(), "manifest": str(manifest_path),
                                 "cipher_sha256": manifest["cipher_sha256"], "verified": True,
                                 "counts": verification["counts"],
                                 "offsite": {"configured": bool(config.get("offsite_remote")), "verified": False}}
                atomic_json(state / "last-local-success.json", local_success)
                try:
                    offsite = offsite_copy(config, [target, manifest_path])
                except OpsError as error:
                    offsite = {"configured": True, "verified": False, "error": str(error)}
                manifest["offsite"] = offsite
                # Published offsite manifest remains the exact originally verified
                # immutable manifest; offsite result is operational state separately.
                success = {"completed_at_utc": utcstamp(), "manifest": str(manifest_path),
                           "cipher_sha256": manifest["cipher_sha256"], "verified": True,
                           "counts": verification["counts"], "offsite": offsite}
                atomic_json(state / "last-success.json", success)
                partial = offsite["configured"] and not offsite["verified"]
                atomic_json(state / "last-attempt.json", {"at_utc": utcstamp(), "status": "partial" if partial else "ok",
                                                          "offsite": offsite})
                # Retention is opt-in and touches only this job's verified local
                # pairs after a new success, preserving at least seven snapshots.
                removed = 0
                if config.get("retention_enabled", False) and not partial:
                    for old_manifest, old_archive in retention_candidates(directory, utcnow(), days=config.get("retention_days", 30)):
                        old_archive.unlink()
                        old_manifest.unlink()
                        removed += 1
                return {"status": "partial" if partial else "ok", "manifest": str(manifest_path), "verified": True,
                        "offsite_verified": offsite["verified"], "retained_policy_removed_pairs": removed,
                        "counts": counts, "offsite_error": offsite.get("error")}
        except Exception as error:
            code = str(error) if isinstance(error, OpsError) else "backup_internal_error"
            atomic_json(state / "last-attempt.json", {"at_utc": utcstamp(), "status": "failed", "error": code})
            raise OpsError(code) from None


def predeploy(config: dict) -> dict:
    success = read_json(Path(config["state_dir"]) / "last-success.json", {})
    if not success.get("verified"):
        raise OpsError("no_verified_backup")
    try:
        age = (utcnow() - dt.datetime.fromisoformat(success["completed_at_utc"])).total_seconds()
    except (ValueError, KeyError):
        raise OpsError("backup_timestamp_invalid") from None
    if not 0 <= age <= config.get("predeploy_max_age_hours", 24) * 3600:
        raise OpsError("predeploy_backup_stale")
    manifest_path = Path(success["manifest"])
    verify_backup(config, manifest_path)
    manifest = read_json(manifest_path)
    # A valid old archive and its matching drill do not cover a migration
    # applied since that archive was taken. Recheck the live identity/data
    # floors and require the schema actually in production to be protected.
    current = source_preflight(config, Management(config))
    if current.get("migration_count") != manifest.get("migration_count"):
        raise OpsError("predeploy_current_schema_backup_required")
    drill = read_json(Path(config["state_dir"]) / "last-restore-success.json", {})
    if not drill.get("success") or drill.get("migration_count") != manifest.get("migration_count"):
        raise OpsError("predeploy_matching_schema_restore_required")
    try:
        drill_age = (utcnow() - dt.datetime.fromisoformat(drill["finished_at_utc"])).total_seconds()
    except (KeyError, ValueError):
        raise OpsError("restore_timestamp_invalid") from None
    if not 0 <= drill_age <= 8 * 86400:
        raise OpsError("predeploy_restore_drill_stale")
    if config.get("require_offsite_for_deploy") and not success.get("offsite", {}).get("verified"):
        raise OpsError("predeploy_offsite_backup_unavailable")
    return {"status": "ok", "backup_age_seconds": round(age), "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "verify", "predeploy", "restore-drill"])
    parser.add_argument("--config", type=Path, default=Path.home() / ".config/lifeos/ops.json")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        config = load_config(args.config)
        if args.action == "backup":
            result = run_backup(config)
        elif args.action == "predeploy":
            result = predeploy(config)
        elif args.action == "verify":
            if not args.manifest:
                raise OpsError("manifest_required")
            result = verify_backup(config, args.manifest)
        else:
            from restore_drill import restore_drill
            result = restore_drill(config, args.manifest)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error) if isinstance(error, OpsError) else "ops_internal_error"}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
