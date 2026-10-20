#!/usr/bin/env python3
"""Verify a restored synthetic Auth account and sample PDF object."""

import hashlib
import http.client
import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "docker/.env.restore"
PROBE_FILE = Path(
    os.environ.get(
        "SCHOLAR_RESTORE_PROBE_FILE",
        Path.home() / "scholar-staging-backups/restore-probe-auth.json",
    )
)
SAMPLE_PDF = ROOT / "apps/readest-app/src/__tests__/fixtures/data/sample-paper.pdf"
MC_IMAGE = (
    "docker.io/pgsty/mc:RELEASE.2026-10-18T00-00-00Z-amd64"
    "@sha256:335da4ff7b78b646de8aa3fecd6cbaab975afdfa25554089639e3f2ba9199166"
)


def main() -> None:
    values = dict(
        line.split("=", 1)
        for line in ENV_FILE.read_text().splitlines()
        if "=" in line and not line.startswith("#")
    )
    probe = json.loads(PROBE_FILE.read_text())
    connection = http.client.HTTPConnection(
        "127.0.0.1", int(values["SCHOLAR_API_PORT"]), timeout=10
    )
    try:
        connection.request(
            "POST",
            "/auth/v1/token?grant_type=password",
            json.dumps({"email": probe["email"], "password": probe["password"]}),
            {"Content-Type": "application/json", "apikey": values["ANON_KEY"]},
        )
        response = connection.getresponse()
        result = json.loads(response.read())
    finally:
        connection.close()
    if (
        response.status != 200
        or result.get("user", {}).get("id") != probe["user_id"]
        or not result.get("access_token")
    ):
        raise RuntimeError("Restored synthetic account login failed")
    print("Restored synthetic account login and user ID verified")

    command = [
        "docker", "run", "--rm",
        "--network", "scholar-restore-rehearsal_default",
        "--env-file", str(ENV_FILE),
        "--entrypoint", "/bin/sh", MC_IMAGE,
        "-ec",
        'mc alias set restore http://scholar-restore-minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
        'mc cat restore/"$S3_BUCKET_NAME"/scholar-restore-probe/sample-paper.pdf',
    ]
    object_result = subprocess.run(command, capture_output=True, check=False)
    if object_result.returncode != 0:
        raise RuntimeError("Cannot read restored sample PDF object")
    actual = hashlib.sha256(object_result.stdout).digest()
    expected = hashlib.sha256(SAMPLE_PDF.read_bytes()).digest()
    if actual != expected:
        raise RuntimeError("Restored PDF object SHA256 differs from source")
    print("Restored sample PDF object SHA256 verified")


if __name__ == "__main__":
    main()
