"""Fail-closed transport for the two exact origins in AITU's Entra SSO flow."""
from __future__ import annotations

import re
import time
from urllib.parse import urljoin, urlsplit

from common.lifeos_sync import SyncError

MOODLE_HOST = "lms.astanait.edu.kz"
MICROSOFT_HOST = "login.microsoftonline.com"
ALLOWED_HOSTS = frozenset((MOODLE_HOST, MICROSOFT_HOST))
COOKIE_NAME = "ESTSAUTHPERSISTENT"
MAX_COOKIE_BYTES = 16_384
MAX_HTTP_REDIRECTS = 12
SSO_STAGES = frozenset((
    "cookie_validation", "http_redirect", "microsoft_login_page", "javascript_continuation",
    "oidc_form_post", "moodle_callback", "authenticated_moodle_session",
))
SSO_REASONS = frozenset((
    "started", "accepted", "rejected", "request", "followed", "target_rejected",
    "redirect_limit", "transition_limit", "deadline_exceeded", "network_error", "http_rejected",
    "response_too_large", "page_received", "interactive_required", "callback_missing",
    "callback_invalid", "callback_ambiguous", "callback_error", "session_expired", "identity_missing",
    "identity_verified", "continuation_missing", "continuation_invalid", "continuation_loop",
    "callback_method_invalid", "callback_controls_invalid", "callback_fields_invalid",
))


class SsoDiagnostics:
    """Allowlisted codes only. No values from an HTTP response enter diagnostics."""
    def __init__(self) -> None:
        self.events: list[dict[str, str]] = []
        self.redirects = 0
        self.record("cookie_validation", "started")

    def record(self, stage: str, reason: str) -> None:
        if stage not in SSO_STAGES or reason not in SSO_REASONS:
            raise ValueError("Invalid SSO diagnostic code")
        self.events.append({"stage": stage, "reason": reason})
        self.events = self.events[-32:]

    def snapshot(self) -> dict:
        return {**self.events[-1], "events": [dict(event) for event in self.events]}


class MoodleSessionError(SyncError):
    """Fixed public categories only; never embed URLs, cookie values or response bodies."""
    def __init__(self, category: str) -> None:
        if category not in {"session_expired", "interactive_login_required", "connection_failed", "unsupported_auth_flow"}:
            category = "unsupported_auth_flow"
        self.category = category
        super().__init__(category)


def valid_sso_cookie(value: object) -> bool:
    # RFC6265 cookie-octet, excluding separators/header syntax. '=' padding is valid.
    return (isinstance(value, str) and 0 < len(value) <= MAX_COOKIE_BYTES
            and re.fullmatch(r"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+", value) is not None
            and not value.lower().startswith(("cookie:", "estsauthpersistent=")))


def safe_url(value: str, base: str | None = None, *, moodle_only: bool = False) -> str:
    if not isinstance(value, str) or not value or re.search(r"[\x00-\x20\x7f\\]", value):
        raise MoodleSessionError("unsupported_auth_flow")
    url = urljoin(base, value) if base else value
    try:
        parsed = urlsplit(url)
        hosts = {MOODLE_HOST} if moodle_only else ALLOWED_HOSTS
        if (parsed.scheme != "https" or parsed.hostname not in hosts
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.fragment):
            raise MoodleSessionError("unsupported_auth_flow")
    except (ValueError, TypeError):
        raise MoodleSessionError("unsupported_auth_flow") from None
    return url


def _remove_persistent_cookies(session: object) -> None:
    # requests merges jars into a fresh permissive jar when preparing a request.
    # Remove this broadly privileged credential before *every* hop, then seed it
    # only for the exact Microsoft origin; never rely on suffix domain matching.
    for cookie in list(session.cookies):
        if cookie.name == COOKIE_NAME:
            session.cookies.clear(cookie.domain, cookie.path, cookie.name)


def secure_request(session: object, method: str, url: str, *, cookie: str | None = None,
                   data: dict | None = None, moodle_only: bool = False,
                   deadline: float | None = None, timeout: int = 20,
                   diagnostics: SsoDiagnostics | None = None, stage: str = "http_redirect") -> object:
    trace = diagnostics or SsoDiagnostics()
    trace.record(stage, "request")
    try:
        url = safe_url(url, moodle_only=moodle_only)
    except MoodleSessionError:
        trace.record(stage, "target_rejected")
        raise
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            trace.record(stage, "deadline_exceeded")
            raise MoodleSessionError("connection_failed")
        _remove_persistent_cookies(session)
        if cookie and urlsplit(url).hostname == MICROSOFT_HOST:
            session.cookies.set(COOKIE_NAME, cookie, domain=MICROSOFT_HOST, path="/", secure=True)
        response = None
        try:
            call = session.post if method == "POST" else session.get
            kwargs = {"timeout": min(timeout, max(1, deadline - time.monotonic())) if deadline else timeout,
                      "allow_redirects": False, "stream": True}
            if method == "POST":
                kwargs["data"] = data
            response = call(url, **kwargs)
            # requests has already processed Set-Cookie. Remove the persistent
            # credential immediately, including attacker-supplied domain variants.
            _remove_persistent_cookies(session)
            response_url = response.url if isinstance(response.url, str) else url
            try:
                safe_url(response_url, moodle_only=moodle_only)
            except MoodleSessionError:
                trace.record("http_redirect", "target_rejected")
                raise
            status = response.status_code if isinstance(response.status_code, int) else 200
            if status in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                if not isinstance(location, str):
                    trace.record("http_redirect", "target_rejected")
                    raise MoodleSessionError("unsupported_auth_flow")
                try:
                    target = safe_url(location, response_url, moodle_only=moodle_only)
                except MoodleSessionError:
                    trace.record("http_redirect", "target_rejected")
                    raise
                if method == "POST" and status in (307, 308) and urlsplit(target).hostname != urlsplit(url).hostname:
                    trace.record("http_redirect", "target_rejected")
                    raise MoodleSessionError("unsupported_auth_flow")
                if trace.redirects >= MAX_HTTP_REDIRECTS:
                    trace.record("http_redirect", "redirect_limit")
                    raise MoodleSessionError("unsupported_auth_flow")
                trace.redirects += 1
                trace.record("http_redirect", "followed")
                if status == 303 or (method == "POST" and status in (301, 302)):
                    method, data = "GET", None
                response.close()
                url = target
                continue
            if status in (401, 403):
                trace.record(stage, "http_rejected")
                raise MoodleSessionError("session_expired")
            response.raise_for_status()
            # Bound the actual download, not just the already-buffered string.
            import requests
            if isinstance(response, requests.Response):
                chunks, size = [], 0
                try:
                    for chunk in response.iter_content(16_384):
                        size += len(chunk)
                        if size > 2_000_000:
                            trace.record(stage, "response_too_large")
                            raise MoodleSessionError("unsupported_auth_flow")
                        if deadline is not None and time.monotonic() >= deadline:
                            trace.record(stage, "deadline_exceeded")
                            raise MoodleSessionError("connection_failed")
                        chunks.append(chunk)
                    response._content = b"".join(chunks)
                    response._content_consumed = True
                finally:
                    response.close()
            if isinstance(response.text, str) and len(response.text) > 2_000_000:
                trace.record(stage, "response_too_large")
                raise MoodleSessionError("unsupported_auth_flow")
            trace.record(stage, "page_received")
            return response
        except MoodleSessionError:
            _remove_persistent_cookies(session)
            if response is not None:
                response.close()
            raise
        except Exception:
            trace.record(stage, "network_error")
            _remove_persistent_cookies(session)
            if response is not None:
                response.close()
            raise MoodleSessionError("connection_failed") from None
