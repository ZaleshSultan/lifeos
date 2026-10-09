#!/usr/bin/env python3
"""Stress only the Unix-socket disposable cluster from test-study-postgres.sh."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: test-digest-concurrency.py /tmp/lifeos-study-sql-<id>")
    socket_dir = Path(sys.argv[1]).resolve()
    if socket_dir.parent != Path("/tmp") or not socket_dir.name.startswith("lifeos-study-sql-"):
        raise SystemExit("Refusing any database outside the disposable study cluster")
    if not (socket_dir / ".s.PGSQL.55491").exists():
        raise SystemExit("Disposable PostgreSQL socket missing")
    query = (
        "set role service_role; select coalesce(public.claim_daily_digest_delivery("
        "'cccccccc-cccc-4ccc-8ccc-cccccccccccc','2040-01-04',123456)::text,'not_claimed');"
    )

    def claim(_: int) -> str:
        result = subprocess.run(
            ["psql", "-XAtq", "-h", str(socket_dir), "-p", "55491", "-d", "postgres",
             "-v", "ON_ERROR_STOP=1", "-c", query],
            capture_output=True, text=True, check=True, timeout=30,
        )
        return result.stdout.strip()

    with ThreadPoolExecutor(max_workers=12) as pool:
        outcomes = list(pool.map(claim, range(48)))
    claimed = [result for result in outcomes if result != "not_claimed"]
    if len(claimed) != 1 or len(claimed[0]) != 36:
        raise SystemExit(f"Expected one acquired UUID claim, got {len(claimed)}")
    print("OK: 48 concurrent claim transactions, exactly one owner, no unique errors")


if __name__ == "__main__":
    main()
