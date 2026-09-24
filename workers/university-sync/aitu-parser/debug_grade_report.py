#!/usr/bin/env python3
"""
Debug helper: logs in via the SSO cookie (same flow used in production) and
dumps the RAW structure of the Moodle grade report table for one course, so
we can see exactly what _scrape_grade_report() is (mis)parsing.

Does NOT print the cookie value itself. Safe to share output.

Run from workers/university-sync/aitu-parser/ using its own venv:
    .venv/bin/python debug_grade_report.py [course_id]

Defaults to course_id=2278 (Database Management Systems, per the one
academic_records row already captured).
"""
import os
import re
import sys
import urllib.parse
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
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(Path(__file__).with_name(".env"))

import requests  # type: ignore
from bs4 import BeautifulSoup  # type: ignore

SSO_COOKIE = os.environ.get("UNIVERSITY_SSO_COOKIE", "").strip()
if not SSO_COOKIE:
    print("UNIVERSITY_SSO_COOKIE is empty in .env - nothing to test.")
    sys.exit(1)

COURSE_ID = int(sys.argv[1]) if len(sys.argv) > 1 else 2278

BASE_URL = "https://lms.astanait.edu.kz"
OIDC_LOGIN_URL = f"{BASE_URL}/auth/oidc/?source=loginpage"
GRADE_REPORT_URL = f"{BASE_URL}/grade/report/user/index.php"
REQUEST_TIMEOUT = 20

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

print(">>> Logging in via SSO cookie...")
r = session.get(OIDC_LOGIN_URL, timeout=REQUEST_TIMEOUT, allow_redirects=True)
for _ in range(4):
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form")
    if form:
        action = form.get("action")
        inputs = {t.get("name"): t.get("value", "") for t in soup.find_all("input") if t.get("name")}
        if not action or not inputs:
            break
        r = session.post(action, data=inputs, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        continue
    m_urlpost = re.search(r'"urlPost"\s*:\s*"([^"]+)"', r.text)
    if m_urlpost:
        next_url = m_urlpost.group(1).encode().decode("unicode_escape")
        if next_url.startswith("/"):
            next_url = "https://login.microsoftonline.com" + next_url
        r = session.get(next_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        continue
    break

m = re.search(r'"userId"\s*:\s*(\d+)', r.text, re.IGNORECASE)
user_id = m.group(1) if m else None
print(f"Logged in, userId={user_id}")
print()

params = {"id": COURSE_ID}
if user_id:
    params["userid"] = user_id
url = GRADE_REPORT_URL + "?" + urllib.parse.urlencode(params)
print(f">>> GET {url}")
resp = session.get(url, timeout=REQUEST_TIMEOUT)
print(f"Status: {resp.status_code}, length: {len(resp.text)} chars")
print()

soup = BeautifulSoup(resp.text, "html.parser")
table = soup.find("table", class_=lambda c: c and ("generaltable" in c or "user-grade" in c))
if not table:
    print("No table with class containing 'generaltable' or 'user-grade' found.")
    print("Dumping ALL <table> tags found on the page instead:")
    for i, t in enumerate(soup.find_all("table")):
        classes = t.get("class")
        print(f"  [{i}] <table class={classes!r}> - {len(t.find_all('tr'))} rows")
    sys.exit(0)

print(f"Found table with class={table.get('class')!r}")
rows = table.find_all("tr")
print(f"Total <tr> rows: {len(rows)}")
print()

for i, row in enumerate(rows):
    cells = row.find_all("td")
    ths = row.find_all("th")
    row_classes = row.get("class")
    print(f"--- Row {i} (class={row_classes}, {len(cells)} <td>, {len(ths)} <th>) ---")
    if ths:
        for j, th in enumerate(ths):
            print(f"  th[{j}]: {th.get_text(separator=' | ', strip=True)!r}")
    for j, cell in enumerate(cells):
        cell_classes = cell.get("class")
        text = cell.get_text(separator=" | ", strip=True)
        print(f"  td[{j}] (class={cell_classes}): {text!r}")
    print()
