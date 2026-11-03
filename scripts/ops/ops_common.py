"""Small, fail-closed helpers for LifeOS operations. Never emit raw exceptions."""
from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.error
import urllib.request


class OpsError(Exception):
    """A fixed public error code; no provider response/credential interpolation."""


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Privileged operations have fixed destinations. A redirect cannot
        # authorize forwarding bearer credentials, signed headers or payloads.
        return None


def fixed_destination_request(request, *, timeout):
    return urllib.request.build_opener(RejectRedirects()).open(request, timeout=timeout)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def utcstamp() -> str:
    return utcnow().isoformat()


def private_dir(path: Path) -> Path:
    if path.is_symlink():
        raise OpsError("unsafe_directory")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_uid != os.getuid():
        raise OpsError("directory_owner_mismatch")
    path.chmod(0o700)
    return path


def secret(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise OpsError("secret_file_missing_or_unsafe")
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise OpsError("secret_file_permissions")
    return path.read_bytes()


def atomic_json(path: Path, value: object) -> None:
    private_dir(path.parent)
    fd, temporary = tempfile.mkstemp(prefix=".lifeos-state-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    if path.is_symlink():
        raise OpsError("unsafe_state_file")
    try:
        return json.loads(path.read_text())
    except (ValueError, OSError):
        raise OpsError("invalid_state_file") from None


@contextlib.contextmanager
def lock(path: Path):
    private_dir(path.parent)
    if path.is_symlink():
        raise OpsError("unsafe_lock_file")
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OpsError("job_already_running") from None
        yield
    finally:
        os.close(fd)


def command(args: list[str], *, input=None, timeout=60, env=None) -> bytes:
    """No shell, bounded execution, no raw child stderr/provider exceptions."""
    try:
        result = subprocess.run(args, input=input, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise OpsError("command_timeout") from None
    except OSError:
        raise OpsError("command_unavailable") from None
    if result.returncode:
        # Codes are intentionally broad. Keep private process output in memory.
        lower = result.stderr.lower()
        code = ("offsite_storage_quota_exceeded" if b"storagequotaexceeded" in lower else
                "tls_verification_failed" if b"certificate" in lower else
                "database_authentication_failed" if b"authentication failed" in lower else
                "database_permission_denied" if b"permission denied" in lower else
                "command_failed")
        raise OpsError(code)
    return result.stdout


def load_config(path: Path) -> dict:
    config = json.loads(secret(path))
    if not isinstance(config, dict) or not re.fullmatch(r"[a-z]{20}", config.get("project_ref", "")):
        raise OpsError("invalid_ops_config")
    return config


def env_file(path: Path) -> dict[str, str]:
    """Read this repository's simple KEY=value files; never execute shell syntax."""
    output = {}
    for line in secret(path).decode().splitlines():
        match = re.fullmatch(r"\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*", line)
        if match:
            value = match[2]
            if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            output[match[1]] = value
    return output


class Management:
    def __init__(self, config: dict):
        self.ref = config["project_ref"]
        self.token = secret(Path(config["management_token_file"])).decode().strip()
        self.base = "https://api.supabase.com/v1/projects/" + self.ref

    def request(self, path: str, body=None):
        request = urllib.request.Request(
            self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.token,
                     "Content-Type": "application/json"},
            method="GET" if body is None else "POST",
        )
        try:
            with fixed_destination_request(request, timeout=45) as response:
                raw = response.read(64 * 1024 * 1024 + 1)
            if len(raw) > 64 * 1024 * 1024:
                raise OpsError("management_response_too_large")
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            raise OpsError("management_http_" + str(error.code)) from None
        except (OSError, ValueError, TimeoutError):
            raise OpsError("management_unavailable") from None

    def query(self, sql: str):
        # Deliberately cannot execute mutating SQL; backup/monitor code never uses
        # the privileged general query endpoint.
        return self.request("/database/query/read-only", {"query": sql})


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
