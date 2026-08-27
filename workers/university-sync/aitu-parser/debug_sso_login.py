#!/usr/bin/env python3
"""
Debug helper: walks the SSO cookie login flow step by step and prints each
redirect hop's URL/status plus a body snippet, WITHOUT ever printing the
cookie value itself. Any query-string param that looks like a token/code
gets redacted before printing.

Run from workers/university-sync/aitu-parser/ using its own venv:
    .venv/bin/python debug_sso_login.py
"""
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)

_load_env_file(Path(__file__).with_name(".env"))

import requests  # type: ignore
from bs4 import BeautifulSoup  # type: ignore

SSO_COOKIE = os.environ.get("UNIVERSITY_SSO_COOKIE", "").strip()
if not SSO_COOKIE:
    print("UNIVERSITY_SSO_COOKIE is empty in .env - nothing to test.")
    sys.exit(1)

print(f"Cookie present, length={len(SSO_COOKIE)} chars (value not printed).")

BASE_URL = "https://lms.astanait.edu.kz"
OIDC_LOGIN_URL = f"{BASE_URL}/auth/oidc/?source=loginpage"
REQUEST_TIMEOUT = 20

SENSITIVE_PARAM_RE = re.compile(r"code|token|assertion|secret", re.IGNORECASE)


def redact_url(url: str) -> str:
    if "?" not in url:
        return url
    base, _, query = url.partition("?")
    parts = []
    for kv in query.split("&"):
        if "=" in kv:
            k, _, v = kv.partition("=")
            if SENSITIVE_PARAM_RE.search(k):
                parts.append(f"{k}=<redacted len={len(v)}>")
            else:
                parts.append(kv)
        else:
            parts.append(kv)
    return base + "?" + "&".join(parts)


session = requests.Session()
session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
})
session.cookies.set("ESTSAUTHPERSISTENT", SSO_COOKIE, domain="login.microsoftonline.com")

print(f"\n>>> GET {OIDC_LOGIN_URL}")
r = session.get(OIDC_LOGIN_URL, timeout=REQUEST_TIMEOUT, allow_redirects=True)

print(f"\n--- Redirect chain ({len(r.history)} hops) ---")
for hop in r.history:
    print(f"  [{hop.status_code}] {redact_url(hop.url)}")
print(f"  [{r.status_code}] {redact_url(r.url)}  <- final")

print(f"\n--- Final page body (first 1500 chars) ---")
print(r.text[:1500])
print("--- end snippet ---")

soup = BeautifulSoup(r.text, "html.parser")
form = soup.find("form")
if form:
    print(f"\nFound a <form action={form.get('action')!r} method={form.get('method')!r}>")
    for inp in form.find_all("input"):
        name = inp.get("name")
        val = inp.get("value", "")
        if name and SENSITIVE_PARAM_RE.search(name):
            print(f"  input name={name!r} value=<redacted len={len(val)}>")
        else:
            print(f"  input name={name!r} value={val!r}")
else:
    print("\nNo <form> found on final page.")

    # Microsoft's "BssoInterrupt" page has no <form> - it's a JS config page
    # (window.$Config = {...}) with a "urlPost" field the client-side JS is
    # meant to navigate to next (often re-attempting silent SSO with
    # sso_reload=True). Try following it manually.
    m_page_id = re.search(r'"PageID"\s*content="([^"]+)"', r.text)
    m_urlpost = re.search(r'"urlPost"\s*:\s*"([^"]+)"', r.text)
    if m_page_id:
        print(f"\nPageID meta tag: {m_page_id.group(1)!r}")
    if m_urlpost:
        raw = m_urlpost.group(1)
        next_url = raw.encode().decode("unicode_escape")
        if next_url.startswith("/"):
            next_url = "https://login.microsoftonline.com" + next_url
        print(f"\nFound urlPost in page JS config -> following: {redact_url(next_url)}")
        r2 = session.get(next_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        print(f"\n--- Redirect chain for urlPost follow-up ({len(r2.history)} hops) ---")
        for hop in r2.history:
            print(f"  [{hop.status_code}] {redact_url(hop.url)}")
        print(f"  [{r2.status_code}] {redact_url(r2.url)}  <- final")
        print(f"\n--- urlPost follow-up body (first 1500 chars) ---")
        print(r2.text[:1500])
        print("--- end snippet ---")

        soup2 = BeautifulSoup(r2.text, "html.parser")
        form2 = soup2.find("form")
        if form2:
            print(f"\nFound a <form action={form2.get('action')!r} method={form2.get('method')!r}>")
            for inp in form2.find_all("input"):
                name = inp.get("name")
                val = inp.get("value", "")
                if name and SENSITIVE_PARAM_RE.search(name):
                    print(f"  input name={name!r} value=<redacted len={len(val)}>")
                else:
                    print(f"  input name={name!r} value={val!r}")
        m2 = re.search(r'"userid"\s*:\s*(\d+)', r2.text)
        print(f"\nuserid found after urlPost follow-up: {m2.group(1) if m2 else 'NO'}")
        sys.exit(0)
    else:
        print("\nNo urlPost found either - dumping full $Config block if present:")
        m_config = re.search(r"\$Config\s*=\s*(\{.*?\});", r.text, re.DOTALL)
        if m_config:
            snippet = m_config.group(1)[:2000]
            # redact anything that looks like a long opaque value
            snippet = re.sub(r'"(sCanaryTokenName|sCtx|sessionId|correlationId)"\s*:\s*"[^"]{20,}"',
                              r'"\1": "<redacted>"', snippet)
            print(snippet)

m = re.search(r'"userid"\s*:\s*(\d+)', r.text)
print(f"\nuserid found in final page: {m.group(1) if m else 'NO'}")
