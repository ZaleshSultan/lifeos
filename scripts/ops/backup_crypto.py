"""Versioned authenticated backup envelopes; plaintext exists only in private RAMfs."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import struct
import tempfile

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from ops_common import OpsError, private_dir, secret

MAGIC = b"LIFEOSBKP1\n"
CHUNK = 1024 * 1024
MAX_HEADER = 16384


def key_bytes(path: Path) -> bytes:
    value = secret(path)
    if len(value) != 32:
        raise OpsError("invalid_backup_key")
    return value


def encrypt(source: Path, target: Path, key: bytes, metadata: dict) -> dict:
    if len(key) != 32 or source.is_symlink() or target.exists() or target.is_symlink():
        raise OpsError("unsafe_encryption_target")
    private_dir(target.parent)
    header = json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()
    if len(header) > MAX_HEADER:
        raise OpsError("backup_header_too_large")
    aad = MAGIC + struct.pack(">I", len(header)) + header
    nonce = secrets.token_bytes(12)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(aad)
    digest = hashlib.sha256()
    size = 0
    fd, name = tempfile.mkstemp(prefix=".lifeos-encrypted-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output, source.open("rb") as incoming:
            output.write(aad + nonce)
            for block in iter(lambda: incoming.read(CHUNK), b""):
                size += len(block)
                digest.update(block)
                output.write(encryptor.update(block))
            output.write(encryptor.finalize())
            output.write(encryptor.tag)
            output.flush()
            os.fsync(output.fileno())
        # Atomic publication; no valid success manifest exists until verification.
        os.link(name, target, follow_symlinks=False)
        return {"plaintext_sha256": digest.hexdigest(), "plaintext_bytes": size}
    finally:
        Path(name).unlink(missing_ok=True)


def decrypt(source: Path, target: Path, key: bytes, *, expected_project: str,
            max_bytes: int = 128 * 1024 * 1024) -> dict:
    if len(key) != 32 or source.is_symlink() or not source.is_file():
        raise OpsError("invalid_encrypted_backup")
    if target.exists() or target.is_symlink():
        raise OpsError("unsafe_decryption_target")
    if source.stat().st_size > max_bytes + MAX_HEADER + 64:
        raise OpsError("backup_size_limit")
    try:
        with source.open("rb") as incoming:
            if incoming.read(len(MAGIC)) != MAGIC:
                raise OpsError("unknown_backup_format")
            packed = incoming.read(4)
            if len(packed) != 4:
                raise OpsError("truncated_backup")
            length = struct.unpack(">I", packed)[0]
            if length > MAX_HEADER:
                raise OpsError("backup_header_too_large")
            header = incoming.read(length)
            aad = MAGIC + packed + header
            nonce = incoming.read(12)
            remaining = source.stat().st_size - len(aad) - 12 - 16
            if len(header) != length or len(nonce) != 12 or remaining < 0:
                raise OpsError("truncated_backup")
            incoming.seek(-16, os.SEEK_END)
            tag = incoming.read(16)
            incoming.seek(len(aad) + 12)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(aad)
            digest = hashlib.sha256()
            with target.open("xb") as output:
                target.chmod(0o600)
                while remaining:
                    block = incoming.read(min(CHUNK, remaining))
                    if not block:
                        raise OpsError("truncated_backup")
                    remaining -= len(block)
                    plain = decryptor.update(block)
                    digest.update(plain)
                    output.write(plain)
                end = decryptor.finalize()
                digest.update(end)
                output.write(end)
            # Header assertions are trusted only after GCM authenticated it.
            metadata = json.loads(header)
            if not isinstance(metadata, dict):
                raise OpsError("backup_header_invalid")
            if metadata.get("project_ref") != expected_project or metadata.get("kind") != "postgres-custom":
                raise OpsError("backup_identity_mismatch")
            with target.open("rb") as check:
                if check.read(5) != b"PGDMP":
                    raise OpsError("invalid_pg_dump_archive")
            return {"metadata": metadata, "plaintext_sha256": digest.hexdigest(),
                    "plaintext_bytes": target.stat().st_size}
    except (InvalidTag, ValueError, TypeError, AttributeError, OSError, OpsError) as error:
        target.unlink(missing_ok=True)
        if isinstance(error, OpsError):
            raise
        raise OpsError("backup_authentication_failed") from None
