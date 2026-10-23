#!/usr/bin/env python3
"""Probe PDF annotation geometry through the isolated staging sync API.

Uses one synthetic account, loopback URLs, and deletes its temporary note.
"""
import argparse
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--auth-file", type=pathlib.Path, required=True)
parser.add_argument("--runtime-env", type=pathlib.Path, required=True)
parser.add_argument("--candidate-url", default="http://127.0.0.1:3148")
parser.add_argument("--supabase-url", default="http://127.0.0.1:8130")
args = parser.parse_args()
for url in (args.candidate_url, args.supabase_url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        parser.error("probe URLs must use loopback HTTP")

account = json.loads(args.auth_file.read_text())
account_id = str(uuid.UUID(account["user_id"]))
env = dict(
    line.split("=", 1)
    for line in args.runtime_env.read_text().splitlines()
    if "=" in line and not line.startswith("#")
)
key = env["SUPABASE_ANON_KEY"]
book_hash = "phase4-pdf-anchor-" + uuid.uuid4().hex
note_id = "page-2-left-column"
cfi = "epubcfi(/6/4!/4/2,/1:0,/1:12)"
anchor = {
    "version": 1,
    "pageIndex": 1,
    "cfi": cfi,
    "rects": [[0.12, 0.19, 0.43, 0.23], [0.12, 0.24, 0.31, 0.28]],
}


def request(url, method="GET", body=None, token=None):
    headers = {"apikey": key, "content-type": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"{method} {urllib.parse.urlsplit(url).path} HTTP {exc.code}: "
            f"{exc.read()[:250]!r}"
        ) from exc


def cleanup():
    statement = (
        "DELETE FROM public.book_notes "
        f"WHERE user_id='{account_id}'::uuid AND book_hash='{book_hash}'"
    )
    subprocess.run(
        ["docker", "exec", "scholar-staging-db", "psql", "-v", "ON_ERROR_STOP=1",
         "-U", "supabase_admin", "-d", "postgres", "-c", statement],
        check=True, capture_output=True,
    )


try:
    _, auth = request(
        args.supabase_url + "/auth/v1/token?grant_type=password",
        "POST",
        {"email": account["email"], "password": account["password"]},
    )
    token = auth["access_token"]
    stamp = int(time.time() * 1000)
    note = {
        "bookHash": book_hash,
        "id": note_id,
        "type": "annotation",
        "cfi": cfi,
        "page": 2,
        "text": "Synthetic left-column passage",
        "style": "highlight",
        "color": "yellow",
        "note": "Source-linked research note",
        "pdfAnchor": anchor,
        "createdAt": stamp,
        "updatedAt": stamp,
    }
    status, posted = request(
        args.candidate_url + "/api/sync", "POST", {"notes": [note]}, token
    )
    assert status == 200 and len(posted["notes"]) == 1, posted
    saved = posted["notes"][0]
    assert saved["pdf_anchor"] == anchor, saved
    url = args.candidate_url + "/api/sync?" + urllib.parse.urlencode({
        "since": 0, "type": "notes", "book": book_hash
    })
    status, pulled = request(url, token=token)
    assert status == 200 and len(pulled["notes"]) == 1, pulled
    assert pulled["notes"][0]["pdf_anchor"] == anchor, pulled
    rest_url = args.supabase_url + "/rest/v1/book_notes?" + urllib.parse.urlencode({
        "user_id": "eq." + account_id, "book_hash": "eq." + book_hash,
        "id": "eq." + note_id, "select": "pdf_anchor,page,cfi"
    })
    status, rows = request(rest_url, token=token)
    assert status == 200 and len(rows) == 1, rows
    assert rows[0]["pdf_anchor"] == anchor and rows[0]["page"] == 2, rows
    legacy = {key: value for key, value in note.items() if key != "pdfAnchor"}
    legacy["note"] = "Edited by an older client"
    legacy["updatedAt"] = stamp + 60_000
    _, updated = request(
        args.candidate_url + "/api/sync", "POST", {"notes": [legacy]}, token
    )
    assert updated["notes"][0]["pdf_anchor"] == anchor, updated
    _, preserved = request(rest_url, token=token)
    assert preserved[0]["pdf_anchor"] == anchor, preserved

    cleared = {**note, "note": "Selection recaptured without geometry",
               "pdfAnchor": None, "updatedAt": stamp + 120_000}
    _, cleared_result = request(
        args.candidate_url + "/api/sync", "POST", {"notes": [cleared]}, token
    )
    assert cleared_result["notes"][0]["pdf_anchor"] is None, cleared_result
    _, cleared_rows = request(rest_url, token=token)
    assert cleared_rows[0]["pdf_anchor"] is None, cleared_rows
    print("PDF anchor POST, independent GET, legacy update, and explicit clear: OK")
finally:
    cleanup()
