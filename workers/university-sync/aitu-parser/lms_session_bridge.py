#!/usr/bin/env python3
"""Static validation bridge. Secrets arrive on stdin, never argv/env/stdout/logs."""
from __future__ import annotations

import json
import logging
import sys

from university_scraper import BaseSettings, MoodleClient, MoodleSessionError, Settings
from moodle_session_security import MAX_COOKIE_BYTES, valid_sso_cookie


def validate(cookie: object) -> dict:
    if not valid_sso_cookie(cookie):
        return {"ok": False, "errorCategory": "unsupported_auth_flow"}
    base = BaseSettings("https://invalid.example", "", "session-validation", "Asia/Almaty")
    client = MoodleClient(Settings(base, "", "", None, cookie, 3600, False))
    try:
        client.validate_sso_session()
        return {"ok": True}
    except MoodleSessionError as exc:
        return {"ok": False, "errorCategory": exc.category}
    except Exception:
        return {"ok": False, "errorCategory": "connection_failed"}
    finally:
        if client._session is not None:
            client._session.cookies.clear()
            client._session.close()
        client._sso_cookie = None


def main() -> None:
    logging.disable(logging.CRITICAL)
    result = {"ok": False, "errorCategory": "unsupported_auth_flow"}
    try:
        if sys.argv[1:] not in ([], ["validate"]):
            raise ValueError()
        raw = sys.stdin.buffer.read(MAX_COOKIE_BYTES + 256)
        if len(raw) >= MAX_COOKIE_BYTES + 256:
            raise ValueError()
        body = json.loads(raw)
        if not isinstance(body, dict) or set(body) != {"cookie"}:
            raise ValueError()
        result = validate(body["cookie"])
    except Exception:
        pass
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
