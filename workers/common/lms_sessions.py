"""Fail-closed LMS credential decryption compatible with @lifeos/db/crypto-at-rest.

Session ciphertext contains an authenticated JSON envelope binding it to its
LifeOS owner and platform. Neither credentials nor underlying crypto failures
are included in exceptions. No decrypted session is persisted or cached here.
"""
from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from typing import Mapping

from common.lifeos_sync import SyncError


class LmsSessionError(SyncError):
    def __init__(self, category: str, state: str = "reauthentication_required") -> None:
        self.category = category
        self.state = state
        super().__init__(category)


def load_encryption_key(environ: Mapping[str, str] | None = None) -> bytes:
    env = os.environ if environ is None else environ
    raw = next((env[name] for name in (
        "ENCRYPTION_KEY", "LIFEOS_ENCRYPTION_KEY", "LIFEOS_OAUTH_TOKEN_ENCRYPTION_KEY", "OAUTH_TOKEN_ENCRYPTION_KEY",
    ) if name in env), "").strip()
    if re.fullmatch(r"[a-fA-F0-9]{64}", raw):
        return bytes.fromhex(raw)
    try:
        key = base64.b64decode(raw, validate=True)
        if len(key) == 32 and base64.b64encode(key).decode("ascii") == raw:
            return key
    except (ValueError, UnicodeError):
        pass
    key = raw.encode("utf-8")
    if len(key) == 32:
        return key
    raise LmsSessionError("encryption_unavailable", "error") from None


def _base64url(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]*", value):
        raise ValueError("Invalid encoded component")
    decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != value:
        raise ValueError("Invalid encoded component")
    return decoded


def decrypt_secret(ciphertext: str, environ: Mapping[str, str] | None = None, *, allow_legacy_packed: bool = True) -> str:
    key = load_encryption_key(environ)
    if not isinstance(ciphertext, str) or not ciphertext.startswith("enc:v1:") or len(ciphertext) > 50_000:
        raise LmsSessionError("invalid_session")
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise LmsSessionError("encryption_unavailable", "error") from None
    try:
        parts = ciphertext.split(":")
        if len(parts) == 5:
            iv, tag, body = (_base64url(value) for value in parts[2:])
            if len(iv) != 12 or len(tag) != 16:
                raise ValueError("Invalid encrypted component length")
            payload = body + tag
        elif len(parts) == 3 and allow_legacy_packed:
            # Retain authenticated historic password/WS-token ciphertext only.
            packed = base64.b64decode(parts[2], validate=True)
            if len(packed) < 28 or base64.b64encode(packed).decode("ascii") != parts[2]:
                raise ValueError("Invalid encrypted payload")
            iv, payload = packed[:12], packed[12:]
        else:
            raise ValueError("Invalid encrypted format")
        return AESGCM(key).decrypt(iv, payload, None).decode("utf-8")
    except Exception:
        raise LmsSessionError("invalid_session") from None


def validate_cookie(value: object) -> str:
    # RFC 6265 cookie-octets; this is a value, never a Cookie header or URL.
    if not isinstance(value, str) or not 1 <= len(value) <= 16_384 or value.startswith("ESTSAUTHPERSISTENT=") or not re.fullmatch(r"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+", value):
        raise LmsSessionError("invalid_session")
    return value


def decrypt_lms_session(
    ciphertext: str,
    user_id: str,
    platform_type: str = "aitu_moodle",
    *,
    expires_at: str | None,
    now: datetime | None = None,
    environ: Mapping[str, str] | None = None,
) -> str:
    current = now or datetime.now(timezone.utc)
    try:
        expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        if expires.tzinfo is None or current.tzinfo is None or expires <= current:
            raise ValueError("Invalid expiry")
    except (TypeError, ValueError, OverflowError):
        raise LmsSessionError("session_expired", "session_expired") from None
    plaintext = decrypt_secret(ciphertext, environ, allow_legacy_packed=False)
    try:
        envelope = json.loads(plaintext)
    except (ValueError, TypeError):
        raise LmsSessionError("invalid_session") from None
    if (not isinstance(envelope, dict) or set(envelope) != {"version", "userId", "platform", "cookie"}
            or type(envelope.get("version")) is not int or envelope["version"] != 1
            or envelope.get("userId") != user_id or envelope.get("platform") != platform_type):
        raise LmsSessionError("invalid_session")
    return validate_cookie(envelope["cookie"])
