#!/usr/bin/env python3
"""
Debug helper v2: walks the FULL SSO cookie login flow (interrupt -> urlPost ->
form_post -> POST back to Moodle) and prints each hop plus the final Moodle
response, WITHOUT ever printing the cookie value or the OAuth code itself.

Run from workers/university-sync/aitu-parser/ using its own venv:
    .venv/bin/python debug_sso_login_v2.py
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


def redact_body(text: str, limit: int = 2000) -> str:
    # Redact any long opaque-looking value (likely a code/token) inline.
    text = re.sub(r'(name="(?:code|id_token|access_token)"\s+value=")[^"]{20,}(")',
                   r"\1<redacted>\2", text)
    return text[:limit]


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

print(f"\n>>> [1] GET {OIDC_LOGIN_URL}")
r = session.get(OIDC_LOGIN_URL, timeout=REQUEST_TIMEOUT, allow_redirects=True)
print(f"    -> [{r.status_code}] {redact_url(r.url)}")

hop = 1
while hop < 6:
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form")

    if form:
        action = form.get("action")
        inputs = {
            tag.get("name"): tag.get("value", "")
            for tag in soup.find_all("input")
            if tag.get("name")
        }
        print(f"\n>>> [{hop+1}] Found <form action={action!r}> with inputs: "
              f"{list(inputs.keys())} -> POSTing it")
        r = session.post(action, data=inputs, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        print(f"    -> [{r.status_code}] {redact_url(r.url)}")
        hop += 1
        continue

    m_urlpost = re.search(r'"urlPost"\s*:\s*"([^"]+)"', r.text)
    if m_urlpost:
        next_url = m_urlpost.group(1).encode().decode("unicode_escape")
        if next_url.startswith("/"):
            next_url = "https://login.microsoftonline.com" + next_url
        print(f"\n>>> [{hop+1}] Found urlPost -> GET {redact_url(next_url)}")
        r = session.get(next_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        print(f"    -> [{r.status_code}] {redact_url(r.url)}")
        hop += 1
        continue

    break

print(f"\n=== Final response after {hop} hop(s) ===")
print(f"URL: {redact_url(r.url)}")
print(f"Status: {r.status_code}")
print("--- Body (first 2500 chars, secrets redacted) ---")
print(redact_body(r.text, 2500))
print("--- end ---")

m = re.search(r'"userid"\s*:\s*(\d+)', r.text)
print(f"\nuserid found: {m.group(1) if m else 'NO'}")

# Look for common Moodle/OIDC error strings to explain a NO.
for needle in ["Invalid login", "error", "Error", "AADSTS", "exception", "denied", "Session has expired"]:
    if needle in r.text:
        idx = r.text.find(needle)
        print(f"Found {needle!r} in body near: ...{r.text[max(0,idx-80):idx+150]}...")