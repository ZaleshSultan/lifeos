#!/usr/bin/env python3
"""LifeOS disaster-recovery rehearsal: LOCAL Docker only, never remote Supabase.

The input is a trusted Supabase CLI plain-SQL dump. Do not commit the dump,
its contents, database credentials, or logs. This tool neither calls the
Supabase remote API nor accepts a database URL or project reference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

LOCAL_CONTAINER = "supabase_db_lifeos_rescue_rehearsal"
REQUIRED_INSERTS = {
    '"auth"."users"',
    '"auth"."identities"',
    '"public"."profiles"',
    '"public"."life_entities"',
}
IDENT = rb'(?:"[^"]+"|[A-Za-z_][A-Za-z_0-9]*)'
INSERT_PATTERN = re.compile(rb'^INSERT INTO (' + IDENT + rb'\.' + IDENT + rb')(?=\s)')
MAX_BACKUP_BYTES = 2 * 1024**3
COMPLETION_MARKER = b"PostgreSQL database dump complete"

VERIFY_SQL = """
select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.tasks', count(*) from public.tasks
union all select 'public.finance_transactions', count(*) from public.finance_transactions
union all select 'public.study_courses', count(*) from public.study_courses
union all select 'public.life_entities', count(*) from public.life_entities
union all select 'public.reminders', count(*) from public.reminders
union all select 'storage.buckets', count(*) from storage.buckets
union all select 'storage.objects (metadata only)', count(*) from storage.objects
union all select 'orphan auth.identities', count(*) from auth.identities i
  where not exists (select 1 from auth.users u where u.id = i.user_id)
union all select 'orphan public.profiles', count(*) from public.profiles p
  where not exists (select 1 from auth.users u where u.id = p.user_id)
union all select 'orphan public.tasks', count(*) from public.tasks t
  where not exists (select 1 from auth.users u where u.id = t.user_id)
union all select 'orphan public.life_entities', count(*) from public.life_entities e
  where not exists (select 1 from auth.users u where u.id = e.user_id)
union all select 'orphan public.finance_transactions', count(*) from public.finance_transactions f
  where not exists (select 1 from auth.users u where u.id = f.user_id)
order by 1;
"""


class RescueError(Exception):
    pass


def backup_file(directory: Path, name: str) -> Path:
    path = directory / name
    if path.is_symlink() or not path.is_file():
        raise RescueError(f"Missing or symlinked backup: {name}")
    if path.stat().st_size == 0 or path.stat().st_size > MAX_BACKUP_BYTES:
        raise RescueError(f"Unexpected backup size for {name}")
    return path


def digest_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def inventory(directory: Path) -> dict[str, object]:
    schema = backup_file(directory, "schema.sql")
    data = backup_file(directory, "data.sql")
    inserts: dict[str, int] = {}
    with data.open("rb") as f:
        for line in f:
            match = INSERT_PATTERN.match(line)
            if match:
                name = match.group(1).decode("ascii", errors="replace")
                inserts[name] = inserts.get(name, 0) + 1
    with data.open("rb") as f:
        f.seek(max(0, data.stat().st_size - 16384))
        complete = COMPLETION_MARKER in f.read()
    if not complete:
        raise RescueError("data.sql lacks the pg_dump completion marker")
    missing = sorted(REQUIRED_INSERTS - set(inserts))
    return {
        "schema_bytes": schema.stat().st_size,
        "data_bytes": data.stat().st_size,
        "schema_sha256": digest_file(schema),
        "data_sha256": digest_file(data),
        "insert_statement_count": sum(inserts.values()),
        "insert_table_names": sorted(inserts),
        "missing_required_insert_tables": missing,
        "data_complete": complete,
        "warning": "An INSERT statement may contain many rows; statement counts are not row counts.",
    }


def docker(*args: str, input_path: Path | None = None, logfile: Path | None = None) -> str:
    command = ["docker", *args]
    try:
        if input_path is not None:
            if logfile is None:
                raise RescueError("A private logfile is required for restore")
            logfile.touch(mode=0o600, exist_ok=True)
            os.chmod(logfile, 0o600)
            with input_path.open("rb") as source, logfile.open("wb") as log:
                result = subprocess.run(command, stdin=source, stdout=log, stderr=subprocess.STDOUT, check=False)
            if result.returncode:
                raise RescueError(f"Local SQL import failed (exit {result.returncode}). Examine private log: {logfile}")
            return ""
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        raise RescueError("Docker executable not found") from exc
    if result.returncode:
        # Do not echo raw PostgreSQL errors: they can contain private values.
        raise RescueError(f"Local Docker operation failed (exit {result.returncode}); command: {args[0]}")
    return result.stdout.strip()


def check_local_container() -> None:
    image = docker("inspect", "--format", "{{.Config.Image}}", LOCAL_CONTAINER)
    running = docker("inspect", "--format", "{{.State.Running}}", LOCAL_CONTAINER)
    if "supabase/postgres" not in image or running != "true":
        raise RescueError(f"{LOCAL_CONTAINER} is not a running Supabase PostgreSQL container")
    # The exact name comes from a NEW UNLINKED local CLI workspace, not a
    # container supplied by user input. No postgres host/network URLs are accepted.


def query(sql: str) -> str:
    return docker(
        "exec", LOCAL_CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "|", "-c", sql,
    )


def assert_pristine_local() -> None:
    check_local_container()
    value = query("""
        select current_database(), to_regclass('auth.users') is not null,
               to_regclass('storage.objects') is not null,
               to_regclass('public.profiles') is not null;
    """)
    if value.strip() != "postgres|t|t|f":
        raise RescueError(
            "Local database is not a pristine Supabase CLI instance with Auth/Storage "
            "tables and no existing LifeOS public.profiles. Do not overwrite it."
        )
    if query("select count(*) from auth.users;").strip() != "0":
        raise RescueError("Local auth.users is not empty. Abort to avoid collisions.")


def private_logdir(directory: Path) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    return directory


def import_sql(path: Path, logfile: Path, *, data: bool = False) -> None:
    command = [
        "exec", "-i", LOCAL_CONTAINER,
        "psql", "-X", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "--single-transaction",
    ]
    if data:
        # Official Supabase SQL-restore guidance: suppress restore-time
        # triggers, including hooks that might encrypt a payload twice.
        command += ["-c", "SET session_replication_role = replica;"]
    command += ["-f", "-"]
    docker(*command, input_path=path, logfile=logfile)


def parse_verification(text: str) -> dict[str, int]:
    counts = {}
    for line in text.splitlines():
        if "|" not in line:
            raise RescueError("Malformed local verification response")
        table, count = line.rsplit("|", 1)
        try:
            counts[table] = int(count)
        except ValueError as exc:
            raise RescueError("Malformed local verification count") from exc
    return counts


def verify() -> dict[str, int]:
    check_local_container()
    counts = parse_verification(query(VERIFY_SQL))
    problems = {k: v for k, v in counts.items() if k.startswith("orphan ") and v}
    if problems:
        raise RescueError(f"Orphan relationships found in local rehearsal: {problems}")
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "restore-local", "verify-local"))
    parser.add_argument("--backup-dir", type=Path, default=Path.home() / "lifeos-rescue")
    parser.add_argument("--confirm-local-restore", action="store_true",
                        help="required acknowledgment for changing ONLY the isolated local Docker database")
    args = parser.parse_args()
    try:
        if args.command == "verify-local":
            print(json.dumps(verify(), indent=2, sort_keys=True))
            return 0

        directory = args.backup_dir.expanduser().resolve(strict=True)
        result = inventory(directory)
        print(json.dumps(result, indent=2, sort_keys=True))
        if result["missing_required_insert_tables"]:
            raise RescueError("Required Auth/LifeOS INSERT statements are absent")
        if args.command == "inspect":
            return 0
        if not args.confirm_local_restore:
            raise RescueError("Pass --confirm-local-restore after checking the target is local-only")
        assert_pristine_local()
        before = {name: digest_file(backup_file(directory, name))
                  for name in ("schema.sql", "data.sql")}
        logs = private_logdir(directory / "local-restore-logs")
        import_sql(directory / "schema.sql", logs / "schema.log")
        if digest_file(directory / "schema.sql") != before["schema.sql"]:
            raise RescueError("Schema dump changed during restoration. Abort.")
        import_sql(directory / "data.sql", logs / "data.log", data=True)
        if any(digest_file(directory / name) != value for name, value in before.items()):
            raise RescueError("Backup files changed during restoration. Investigate before proceeding.")
        print("Local-only restore finished. Aggregate verification:")
        print(json.dumps(verify(), indent=2, sort_keys=True))
        print("Storage SQL rows are METADATA only, not actual object bytes.")
        print("No changes have been made to any hosted Supabase database.")
        return 0
    except (RescueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
