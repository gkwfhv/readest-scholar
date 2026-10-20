#!/usr/bin/env python3
"""Sample synthetic staging Auth/REST/S3 activity without printing credentials."""

import hashlib
import http.client
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(os.environ["SCHOLAR_ROOT"]) if "SCHOLAR_ROOT" in os.environ else Path(__file__).resolve().parents[2]
ENV_FILE = Path(os.environ.get("SCHOLAR_ENV_FILE", ROOT / "docker/.env"))
PROBE_FILE = Path.home() / "scholar-staging-backups/restore-probe-auth.json"
SAMPLE_PDF = ROOT / "apps/readest-app/src/__tests__/fixtures/data/sample-paper.pdf"
MC_IMAGE = (
    "docker.io/pgsty/mc:RELEASE.2026-10-18T00-00-00Z-amd64"
    "@sha256:335da4ff7b78b646de8aa3fecd6cbaab975afdfa25554089639e3f2ba9199166"
)
CONTAINERS = [f"scholar-staging-{name}" for name in (
    "client", "db", "kong", "minio", "auth", "rest"
)]


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def request(port, method, path, headers=None, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def sample(label):
    result = subprocess.run(
        ["docker", "stats", "--no-stream", "--format",
         "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.BlockIO}}|{{.NetIO}}",
         *CONTAINERS], capture_output=True, text=True, check=True,
    )
    print(f"{timestamp()}|{label}", flush=True)
    print(result.stdout.strip(), flush=True)


def main():
    values = dict(line.split("=", 1) for line in ENV_FILE.read_text().splitlines()
                  if "=" in line and not line.startswith("#"))
    probe = json.loads(PROBE_FILE.read_text())
    sample("idle_before")
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            sample("active")
            stop.wait(1)

    worker = threading.Thread(target=sampler, daemon=True)
    worker.start()
    started = time.monotonic()
    try:
        print(f"{timestamp()}|web_read_start", flush=True)
        for _ in range(60):
            status, _ = request(int(values["SCHOLAR_WEB_PORT"]), "GET", "/library")
            if status != 200:
                raise RuntimeError(f"Web library read returned HTTP {status}")
        print(f"{timestamp()}|60 Web library reads: OK", flush=True)
        api_port = int(values["SCHOLAR_API_PORT"])
        status, body = request(
            api_port, "POST", "/auth/v1/token?grant_type=password",
            {"Content-Type": "application/json", "apikey": values["ANON_KEY"]},
            json.dumps({"email": probe["email"], "password": probe["password"]}),
        )
        auth = json.loads(body)
        if status != 200 or auth.get("user", {}).get("id") != probe["user_id"]:
            raise RuntimeError("Synthetic account login failed")
        headers = {"apikey": values["ANON_KEY"],
                   "Authorization": f"Bearer {auth['access_token']}"}
        print(f"{timestamp()}|auth_rest_start", flush=True)
        for _ in range(200):
            status, _ = request(api_port, "GET", "/rest/v1/books?select=*&limit=1", headers)
            if status != 200:
                raise RuntimeError(f"Synthetic REST read returned HTTP {status}")
        print(f"{timestamp()}|Synthetic Auth login and 200 book metadata reads: OK", flush=True)

        # Use a distinct key and remove it on both success and failure. The
        # mounted fixture is public synthetic data; no user document is read.
        script = (
            'mc alias set probe http://scholar-staging-minio:9000 '
            '"$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
            'key="probe/phase0-resource-$$.pdf"; '
            'trap \'mc rm --quiet "probe/$S3_BUCKET_NAME/$key" >/dev/null 2>&1 || true\' EXIT; '
            'mc cp --quiet /fixture/sample-paper.pdf "probe/$S3_BUCKET_NAME/$key"; '
            'for i in $(seq 1 150); do '
            'mc cat "probe/$S3_BUCKET_NAME/$key" | sha256sum; done'
        )
        print(f"{timestamp()}|s3_start", flush=True)
        result = subprocess.run(
            ["docker", "run", "--rm", "--network", "scholar-staging_default",
             "--env-file", str(ENV_FILE),
             "-v", f"{SAMPLE_PDF}:/fixture/sample-paper.pdf:ro",
             "--entrypoint", "/bin/sh", MC_IMAGE, "-ec", script],
            capture_output=True, text=True, check=False,
        )
        expected = hashlib.sha256(SAMPLE_PDF.read_bytes()).hexdigest()
        hashes = [line.split()[0] for line in result.stdout.splitlines()
                  if re.match(r"^[0-9a-f]{64}\s", line)]
        if result.returncode != 0 or len(hashes) != 150 or any(h != expected for h in hashes):
            print(f"S3 diagnostic: exit={result.returncode}, reads={len(hashes)}, "
                  f"matching={sum(h == expected for h in hashes)}", flush=True)
            raise RuntimeError("Synthetic S3 write/read/hash verification failed")
        print(f"{timestamp()}|Synthetic PDF S3 write and 150 byte-verified reads: OK", flush=True)
    finally:
        stop.set()
        worker.join(timeout=15)
        sample("idle_after")
        print(f"Window seconds: {time.monotonic() - started:.1f}", flush=True)


if __name__ == "__main__":
    main()
