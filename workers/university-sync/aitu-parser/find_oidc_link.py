#!/usr/bin/env python3
"""
Safe, read-only diagnostic v2: fetches the public AITU Moodle login page with
a realistic browser User-Agent, prints response headers (to identify any WAF)
and a body snippet, then looks for OpenID Connect / SSO links.
Does NOT touch any cookies, credentials, or send any auth data.
"""
import re
import sys

import requests

LOGIN_URL = "https://lms.astanait.edu.kz/login/index.php"

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
}

session = requests.Session()
session.headers.update(BROWSER_HEADERS)

resp = session.get(LOGIN_URL, timeout=15, allow_redirects=True)

print(f"GET {LOGIN_URL}")
print(f"Final URL after redirects: {resp.url}")
print(f"Status: {resp.status_code}")
print("--- Response headers ---")
for k, v in resp.headers.items():
    print(f"  {k}: {v}")
print("--- Body (first 800 chars) ---")
print(resp.text[:800])
print("--- End body snippet ---")

if resp.status_code != 200:
    print("\nNon-200 status - stopping here, no point parsing for links.")
    sys.exit(0)

try:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(resp.text, "html.parser")
except ImportError:
    print("bs4 not installed; run with the aitu-parser .venv instead of system python.")
    sys.exit(1)

print("\nCandidate SSO/OpenID links found on the page:")
found = False
for a in soup.find_all("a", href=True):
    href = a["href"]
    text = a.get_text(strip=True)
    if re.search(r"oidc|openid|sso|microsoft|auth/", href, re.IGNORECASE) or \
       re.search(r"openid|sso", text, re.IGNORECASE):
        print(f"  text={text!r}  href={href!r}")
        found = True
if not found:
    print("  (none found via <a href> — dumping all <form> actions instead)")
    for form in soup.find_all("form"):
        print(f"  <form action={form.get('action')!r} method={form.get('method')!r}>")
