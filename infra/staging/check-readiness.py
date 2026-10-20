#!/usr/bin/env python3
"""Probe all four staging routes using only the public anon key."""

import http.client
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = Path(os.environ.get("SCHOLAR_ENV_FILE", ROOT / "docker/.env"))
values = {}
for line in ENV_FILE.read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value.strip('"\'')

anon_key = values.get("ANON_KEY")
if not anon_key:
    raise RuntimeError("ANON_KEY is missing from the staging environment")

checks = [
    ("Web", int(values["SCHOLAR_WEB_PORT"]), "/", {}),
    ("Auth via Kong", int(values["SCHOLAR_API_PORT"]), "/auth/v1/health", {}),
    ("REST + database via Kong", int(values["SCHOLAR_API_PORT"]), "/rest/v1/", {"apikey": anon_key}),
    ("Object storage", int(values["SCHOLAR_S3_PORT"]), "/minio/health/live", {}),
]
failed = False
for name, port, path, headers in checks:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=6)
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        response.read()
        if response.status == 200:
            print(f"OK {name}")
        else:
            print(f"FAIL {name}: HTTP {response.status}", file=sys.stderr)
            failed = True
    except OSError as error:
        print(f"FAIL {name}: {error}", file=sys.stderr)
        failed = True
    finally:
        connection.close()

sys.exit(1 if failed else 0)
