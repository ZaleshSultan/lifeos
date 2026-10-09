#!/usr/bin/env python3
"""Check a deployed Mini App, HTTPS, deep links and its real JS/CSS assets."""
import argparse
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def check(url: str) -> None:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise ValueError("TMA_URL must use HTTPS (HTTP allowed only for loopback smoke tests)")
    if parts.username or parts.password:
        raise ValueError("Do not put credentials in TMA_URL")
    def fetch(target: str) -> tuple[str, bytes, str]:
        request = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0 LifeOS-TMA-smoke"})
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise ValueError(f"HTTP {response.status}")
            return response.headers.get("Content-Type", ""), response.read(), response.url
    query = dict(urllib.parse.parse_qsl(parts.query))
    query["screen"] = "study"
    for tab in ["today", "courses", "assignments", "deadlines", "schedule", "grades", "calculator", "syllabi", "map"]:
        query["studyTab"] = tab
        target = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), ""))
        content_type, body, final_url = fetch(target)
        if "text/html" not in content_type or b'id="root"' not in body:
            raise ValueError(f"{tab}: expected app HTML, got {content_type}")
        html = body.decode("utf-8")
        assets = re.findall(r'(?:src|href)="([^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"', html)
        if not assets:
            raise ValueError(f"{tab}: HTML has no built assets")
        for asset in assets:
            asset_url = urllib.parse.urljoin(final_url, asset)
            asset_type, data, _ = fetch(asset_url)
            if "text/html" in asset_type or not data:
                raise ValueError(f"{tab}: asset returned HTML/empty content")
            if ".js" in urllib.parse.urlsplit(asset_url).path and "javascript" not in asset_type:
                raise ValueError(f"{tab}: incorrect JavaScript content type {asset_type}")
        print(f"OK {tab}: text/html + {len(assets)} assets")
    api_url = urllib.parse.urljoin(final_url, "/api/tma/study")
    try:
        fetch(api_url)
    except urllib.error.HTTPError as error:
        if error.code not in {401, 503}:
            raise ValueError(f"Unauthenticated API returned HTTP {error.code}") from error
        print(f"OK protected API: HTTP {error.code}")
    else:
        raise ValueError("API returned success without Telegram initData")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default=os.environ.get("TMA_URL"))
    args = parser.parse_args()
    if not args.url:
        parser.error("Pass the real TMA_URL or set it in the environment")
    try:
        check(args.url)
    except Exception as error:
        # Never print request headers, signed initData or private env values.
        print(f"FAIL: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
