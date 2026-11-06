"""Actual restore verification, with no production connection or target option."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid

from backup_crypto import decrypt, key_bytes
from ops_common import OpsError, atomic_json, command, lock, private_dir, read_json, sha256, utcstamp


def assert_isolated(info: dict, *, container: str, identifier: str, database: str) -> None:
    """Refuse existing containers, host networking, ports, volumes and real DBs."""
    if not re.fullmatch(r"lifeos-restore-v1-[a-f0-9]{32}", container):
        raise OpsError("restore_container_name_rejected")
    if container != "lifeos-restore-v1-" + identifier:
        raise OpsError("restore_container_identity_rejected")
    if database != "lifeos_restore_" + identifier or not re.fullmatch(r"lifeos_restore_[a-f0-9]{32}", database):
        raise OpsError("restore_database_name_rejected")
    if info.get("Name", "").lstrip("/") != container:
        raise OpsError("restore_container_identity_rejected")
    config = info.get("Config", {})
    host = info.get("HostConfig", {})
    if config.get("Labels", {}).get("lifeos.ops.restore_id") != identifier:
        raise OpsError("restore_container_label_rejected")
    if host.get("NetworkMode") != "none" or host.get("PortBindings"):
        raise OpsError("restore_network_must_be_isolated")
    if "/var/lib/postgresql/data" not in host.get("Tmpfs", {}):
        raise OpsError("restore_storage_must_be_disposable")
    for mount in info.get("Mounts", []):
        if mount.get("Type") == "tmpfs" and mount.get("Destination") == "/var/lib/postgresql/data":
            continue
        if mount.get("Type") != "bind" or mount.get("Destination") != "/backup.dump" or mount.get("RW") is not False:
            raise OpsError("restore_unexpected_host_mount")


def restore_drill(config: dict, manifest_path: Path | None = None, *, verification_sql_files=(),
                  verification_user: str | None = None, expected_verification_role: dict | None = None) -> dict:
    from lifeos_backup import PostgresClient, assert_archive_data, ram_directory, verify_backup

    verification_sql_files = tuple(verification_sql_files)
    if verification_sql_files:
        # Database dumps preserve object ownership/ACLs, not cluster IAM. Never
        # present administrator execution as a rehearsal of a production caller.
        if verification_user is None or expected_verification_role is None:
            raise OpsError("verification_caller_required")
        if not isinstance(verification_user, str) or not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", verification_user):
            raise OpsError("verification_user_invalid")
        if (not isinstance(expected_verification_role, dict)
                or set(expected_verification_role) != {"superuser", "bypassrls", "inherit"}
                or any(type(value) is not bool for value in expected_verification_role.values())):
            raise OpsError("verification_role_invalid")
    elif verification_user is not None or expected_verification_role is not None:
        raise OpsError("verification_profile_without_sql")

    state = private_dir(Path(config["state_dir"]))
    if manifest_path is None:
        success = read_json(state / "last-success.json", {})
        if not success.get("verified"):
            raise OpsError("no_verified_backup")
        manifest_path = Path(success["manifest"])
    verify_backup(config, manifest_path)
    manifest = read_json(manifest_path)
    identity = uuid.uuid4().hex
    container = "lifeos-restore-v1-" + identity
    database = "lifeos_restore_" + identity
    image = config.get("restore_image", "supabase/postgres:17.6.1.173")
    if not re.fullmatch(r"[a-z0-9./:_-]+", image):
        raise OpsError("invalid_restore_image")
    result = {"started_at_utc": utcstamp(), "network": "none", "production_target_available": False,
              "source_backup_sha256": manifest["cipher_sha256"], "success": False}
    created = False

    def guard():
        info = json.loads(command(["docker", "inspect", container], timeout=15))[0]
        assert_isolated(info, container=container, identifier=identity, database=database)

    def psql(sql: str, db=database, user="supabase_admin"):
        guard()
        if db not in {database, "postgres"}:
            raise OpsError("restore_database_name_rejected")
        if user not in {"supabase_admin", verification_user}:
            raise OpsError("restore_database_user_rejected")
        return command(["docker", "exec", "-i", container, "psql", "-h", "127.0.0.1",
                        "-U", user, "-d", db, "-XqAt", "-v", "ON_ERROR_STOP=1"],
                       input=sql.encode(), timeout=60)

    with lock(state / "restore-drill.lock"):
        try:
            with tempfile.TemporaryDirectory(prefix="lifeos-drill-", dir=ram_directory(config)) as directory:
                archive = Path(directory) / "database.dump"
                decrypt(manifest_path.parent / manifest["filename"], archive,
                        key_bytes(Path(config["key_file"])), expected_project=config["project_ref"])
                command(["docker", "run", "--rm", "--pull=never", "-d", "--name", container,
                         "--label", "lifeos.ops.restore_id=" + identity, "--network=none",
                         "--memory=512m", "--pids-limit=96",
                         "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
                         "--mount", "type=bind,src=" + str(archive) + ",dst=/backup.dump,readonly",
                         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image], timeout=45)
                created = True
                guard()
                for _ in range(90):
                    check = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1",
                                            "-U", "supabase_admin"], stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, timeout=10)
                    if check.returncode == 0:
                        break
                    time.sleep(0.5)
                else:
                    raise OpsError("restore_database_start_timeout")
                # New randomly named empty DB; no DROP/clean, no remote DSN, no
                # service-role/bot/management secrets enter this container.
                # pg_dump is database-local and does not create cluster roles.
                # Newer hosted platform owner roles can be absent from the local
                # Supabase image. Create only named owners from the authenticated
                # archive TOC as NOLOGIN, with no elevated attributes/passwords.
                listing = command(["docker", "exec", container, "pg_restore", "--list", "/backup.dump"], timeout=30).decode()
                required_roles = set(re.findall(r"^\d+;.*\s([a-z_][a-z0-9_]*)$", listing, re.MULTILINE))
                existing_roles = set(psql("select rolname from pg_catalog.pg_roles;", db="postgres").decode().splitlines())
                created_roles = sorted(required_roles - existing_roles)
                for role in created_roles:
                    psql('CREATE ROLE "' + role + '" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;', db="postgres")
                result["isolated_nologin_owner_roles_created"] = len(created_roles)
                psql('CREATE DATABASE "' + database + '" TEMPLATE template0;', db="postgres")
                guard()
                command(["docker", "exec", container, "pg_restore", "-h", "127.0.0.1", "-U", "supabase_admin",
                         "-d", database, "--exit-on-error", "/backup.dump"], timeout=180)
                result["schema_and_data_restored"] = True
                raw = command(["docker", "exec", container, "pg_dump", "-h", "127.0.0.1", "-U", "supabase_admin",
                               "-d", database, "--data-only", "--no-owner", "--no-acl"], timeout=120)
                from lifeos_backup import archive_counts, owner
                counts, canonical = archive_counts(raw.decode(), owner(config), config["canonical_telegram_user_id"])
                assert_archive_data(config, counts, canonical)
                if counts != manifest["counts"]:
                    raise OpsError("restore_archive_row_counts_differ")
                # Release tests may additionally validate reviewed migrations on
                # this disposable restored copy. The scheduled drill supplies no
                # SQL files, and the public CLI exposes no arbitrary SQL option.
                if verification_sql_files:
                    raw_identity = psql("""select jsonb_build_object(
                      'current_user',current_user,'session_user',session_user,
                      'superuser',rolsuper,'bypassrls',rolbypassrls,'inherit',rolinherit)
                      from pg_catalog.pg_roles where rolname=current_user;""", user=verification_user)
                    try:
                        verification_identity = json.loads(raw_identity)
                    except (ValueError, TypeError):
                        raise OpsError("verification_identity_invalid") from None
                    expected_identity = {"current_user": verification_user, "session_user": verification_user,
                                         **expected_verification_role}
                    if verification_identity != expected_identity:
                        raise OpsError("verification_role_mismatch")
                    result["release_verification"] = verification_identity
                for sql_file in verification_sql_files:
                    # Direct authentication keeps session_user equal to the
                    # declared caller; SET ROLE from the restorer would not.
                    psql(Path(sql_file).read_text(), user=verification_user)
                if verification_sql_files:
                    result["isolated_release_sql_checks"] = [Path(path).name for path in verification_sql_files]
                result.update(counts=counts, canonical_owner_verified=True, row_counts_match_archive=True,
                              migration_count=manifest["migration_count"], success=True)
        except Exception as error:
            result["error"] = str(error) if isinstance(error, OpsError) else "restore_internal_error"
        finally:
            if created:
                # The guard is also required before cleanup; never delete some
                # other pre-existing rescue/database container.
                try:
                    guard()
                    command(["docker", "rm", "-f", container], timeout=30)
                    result["isolated_container_removed"] = True
                except Exception:
                    result["isolated_container_removed"] = False
                    result["success"] = False
            result["finished_at_utc"] = utcstamp()
            atomic_json(state / "last-restore-attempt.json", result)
            if result["success"]:
                atomic_json(state / "last-restore-success.json", result)
        if not result["success"]:
            raise OpsError(result.get("error", "restore_cleanup_failed"))
        return result
