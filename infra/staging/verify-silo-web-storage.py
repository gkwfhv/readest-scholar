#!/usr/bin/env python3
"""Exercise the restored Web app's signed PDF upload and download on Silo."""

import hashlib
import http.client
import json
import os
from pathlib import Path
from urllib.parse import quote, urlsplit


ROOT = Path(os.environ["SCHOLAR_ROOT"]) if "SCHOLAR_ROOT" in os.environ else Path(__file__).resolve().parents[2]
ENV_FILE = Path(os.environ.get("SCHOLAR_ENV_FILE", ROOT / "docker/.env.restore"))
PROBE_FILE = Path(os.environ.get(
    "SCHOLAR_PROBE_FILE", Path.home() / "scholar-staging-backups/restore-probe-auth.json"
))
PDF = ROOT / "apps/readest-app/src/__tests__/fixtures/data/sample-paper.pdf"


def request(port, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def signed_path(url, s3_port):
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != s3_port:
        raise RuntimeError("Signed URL points outside the isolated S3 endpoint")
    return parsed.path + ("?" + parsed.query if parsed.query else "")


def main():
    values = dict(line.split("=", 1) for line in ENV_FILE.read_text().splitlines()
                  if "=" in line and not line.startswith("#"))
    probe = json.loads(PROBE_FILE.read_text())
    api_port = int(values["SCHOLAR_API_PORT"])
    web_port = int(values["SCHOLAR_WEB_PORT"])
    s3_port = int(values["SCHOLAR_S3_PORT"])
    pdf = PDF.read_bytes()
    status, payload = request(
        api_port, "POST", "/auth/v1/token?grant_type=password",
        json.dumps({"email": probe["email"], "password": probe["password"]}),
        {"Content-Type": "application/json", "apikey": values["ANON_KEY"]},
    )
    auth = json.loads(payload)
    if status != 200 or auth.get("user", {}).get("id") != probe["user_id"]:
        raise RuntimeError("Synthetic account login failed")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    status, payload = request(
        web_port, "POST", "/api/storage/upload",
        json.dumps({"fileName": "scholar-silo-acceptance.pdf", "fileSize": len(pdf)}),
        {**headers, "Content-Type": "application/json"},
    )
    upload = json.loads(payload)
    if status != 200 or not upload.get("uploadUrl") or not upload.get("fileKey"):
        raise RuntimeError(f"Web signed upload failed: HTTP {status}")
    status, _ = request(
        s3_port, "PUT", signed_path(upload["uploadUrl"], s3_port), pdf,
        {"Content-Length": str(len(pdf))},
    )
    if status not in (200, 204):
        raise RuntimeError(f"Signed S3 PDF upload failed: HTTP {status}")
    status, payload = request(web_port, "GET", "/api/storage/list?page=1&pageSize=20", headers=headers)
    listing = json.loads(payload)
    if status != 200 or upload["fileKey"] not in [f["file_key"] for f in listing.get("files", [])]:
        raise RuntimeError("Uploaded PDF missing from restored Web file listing")
    status, payload = request(
        web_port, "GET", "/api/storage/download?fileKey=" + quote(upload["fileKey"], safe=""),
        headers=headers,
    )
    download = json.loads(payload)
    if status != 200 or not download.get("downloadUrl"):
        raise RuntimeError(f"Web signed download failed: HTTP {status}")
    status, restored_pdf = request(s3_port, "GET", signed_path(download["downloadUrl"], s3_port))
    if status != 200 or hashlib.sha256(restored_pdf).digest() != hashlib.sha256(pdf).digest():
        raise RuntimeError("Downloaded PDF differs from the synthetic source")
    print("Restored Web Auth, signed PDF upload, listing, and SHA256 download: OK")


if __name__ == "__main__":
    main()
