#!/usr/bin/env python3
"""Synthetic staging probe for two logical metadata devices.

Requires a private staging env file and an existing example.invalid account ID.
Only loopback Web/API endpoints are accepted. The unique probe row and its
history are removed in finally; it never touches books or user files.
"""

import argparse
import base64
import hashlib
import hmac
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwt_for(user_id: str, secret: str) -> str:
    header = b64(b'{"alg":"HS256","typ":"JWT"}')
    now = int(time.time())
    payload = b64(
        json.dumps(
            {"aud": "authenticated", "sub": user_id, "role": "authenticated",
             "iat": now, "exp": now + 1800},
            separators=(",", ":"),
        ).encode()
    )
    signed = header + "." + payload
    signature = b64(hmac.new(secret.encode(), signed.encode(), hashlib.sha256).digest())
    return signed + "." + signature


def request(url: str, token: str, body=None, api_key=None):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    headers = {"Authorization": "Bearer " + token}
    if api_key:
        headers["apikey"] = api_key
    if data is not None:
        headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, data=data, headers=headers), timeout=25
        ) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code} at {urllib.parse.urlsplit(url).path}") from error


def db_query(sql: str) -> str:
    return subprocess.check_output(
        ["docker", "exec", "scholar-staging-db", "psql", "-U", "postgres",
         "-d", "postgres", "-Atc", sql],
        text=True,
    ).strip()


def hlc(milliseconds: int, node: str) -> str:
    return f"{milliseconds:013x}-00000000-{node}"


def expect(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--user-id-file", required=True, type=Path)
    parser.add_argument("--web-url", required=True)
    parser.add_argument("--restart-candidate", action="store_true")
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.web_url)
    if origin.scheme != "http" or origin.hostname not in ("127.0.0.1", "localhost"):
        parser.error("web-url must be a loopback HTTP origin")
    env = dict(
        line.split("=", 1) for line in args.env_file.read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    user_id = str(uuid.UUID(args.user_id_file.read_text().strip()))
    email = db_query(f"SELECT email FROM auth.users WHERE id = '{user_id}'::uuid")
    expect(email.endswith("@example.invalid"), "Refusing a non-synthetic account")
    token = jwt_for(user_id, env["JWT_SECRET"])
    api_key = env["ANON_KEY"]
    replica_id = "phase3-two-device-" + uuid.uuid4().hex[:12]
    kind = "translation_prompt"
    base_url = args.web_url.rstrip("/")
    current_ms = int(time.time() * 1000)
    base_clock = hlc(current_ms - 2 * 86400000, "device-a")
    offline_clock = hlc(current_ms - 86400000, "device-a")
    online_clock = hlc(current_ms - 1000, "device-b")

    def row(value: str, clock: str, node: str):
        return {
            "user_id": user_id, "kind": kind, "replica_id": replica_id,
            "fields_jsonb": {"name": {"v": value, "t": clock, "s": node}},
            "manifest_jsonb": None, "deleted_at_ts": None,
            "reincarnation": None, "updated_at_ts": clock, "schema_version": 1,
        }

    def push(value: str, clock: str, node: str):
        status, payload = request(
            base_url + "/api/sync/replicas", token,
            {"protocolVersion": 2, "rows": [row(value, clock, node)]},
        )
        expect(status == 200 and len(payload["rows"]) == 1, "push failed")
        return payload["rows"][0]

    def pull(after: str):
        query = urllib.parse.urlencode({"kind": kind, "after": after, "limit": "100"})
        status, payload = request(
            base_url + "/api/sync/replica-changes?" + query, token,
        )
        expect(status == 200, "change pull failed")
        return payload

    try:
        a_initial = push("base", base_clock, "device-a")
        initial_seq = str(a_initial["change_seq"])
        b_initial = pull("0")
        expect(
            any(change["row"]["replica_id"] == replica_id
                and change["row"]["fields_jsonb"]["name"]["v"] == "base"
                for change in b_initial["changes"]),
            "device B did not receive the initial value",
        )

        # A edits while offline; B commits a newer value first.
        b_winner = push("online-B", online_clock, "device-b")
        winner_seq = str(b_winner["change_seq"])
        expect(int(winner_seq) > int(initial_seq), "new winner did not advance cursor")
        b_delta = pull(initial_seq)
        expect(
            any(change["row"]["replica_id"] == replica_id
                and change["row"]["fields_jsonb"]["name"]["v"] == "online-B"
                for change in b_delta["changes"]),
            "device B did not receive the new value",
        )

        # A resumes. Treat the first successful response as lost, then retry
        # the exact same offline request. No change sequence or history growth.
        first_loser = push("offline-A", offline_clock, "device-a")
        expect(first_loser["fields_jsonb"]["name"]["v"] == "online-B",
               "old offline field replaced the newer edit")
        history_sql = (
            "SELECT count(*) FROM public.replica_conflict_versions "
            f"WHERE user_id='{user_id}'::uuid AND kind='{kind}' "
            f"AND replica_id='{replica_id}'"
        )
        history_before = int(db_query(history_sql))
        if args.restart_candidate:
            subprocess.run(
                ["docker", "restart", "scholar-phase3-recovery-candidate"],
                check=True, stdout=subprocess.DEVNULL,
            )
            for _ in range(20):
                try:
                    with urllib.request.urlopen(base_url + "/", timeout=2) as response:
                        if response.status == 200:
                            break
                except (OSError, urllib.error.URLError):
                    time.sleep(1)
            else:
                raise RuntimeError("candidate Web did not recover after restart")
        second_loser = push("offline-A", offline_clock, "device-a")
        expect(str(first_loser["change_seq"]) == winner_seq, "losing replay moved cursor")
        expect(str(second_loser["change_seq"]) == winner_seq, "retry moved cursor")
        expect(int(db_query(history_sql)) == history_before,
               "retry duplicated conflict history")

        a_delta = pull(initial_seq)
        expect(
            any(change["row"]["replica_id"] == replica_id
                and change["row"]["fields_jsonb"]["name"]["v"] == "online-B"
                for change in a_delta["changes"]),
            "device A did not converge to B's value",
        )
        status, history = request(
            "http://127.0.0.1:" + env["SCHOLAR_API_PORT"]
            + "/rest/v1/replica_conflict_versions?"
            + urllib.parse.urlencode({
                "select": "source,row_data",
                "user_id": "eq." + user_id,
                "kind": "eq." + kind,
                "replica_id": "eq." + replica_id,
            }),
            token, api_key=api_key,
        )
        expect(status == 200, "history GET failed")
        expect(
            any(item["source"] == "incoming"
                and item["row_data"]["fields_jsonb"]["name"]["v"] == "offline-A"
                for item in history),
            "losing offline branch was not archived",
        )
    finally:
        db_query(
            "BEGIN; "
            "DELETE FROM public.replica_conflict_versions "
            f"WHERE user_id='{user_id}'::uuid AND kind='{kind}' "
            f"AND replica_id='{replica_id}'; "
            "DELETE FROM public.replicas "
            f"WHERE user_id='{user_id}'::uuid AND kind='{kind}' "
            f"AND replica_id='{replica_id}'; COMMIT;"
        )
        remaining = db_query(
            "SELECT "
            "(SELECT count(*) FROM public.replicas "
            f"WHERE user_id='{user_id}'::uuid AND kind='{kind}' "
            f"AND replica_id='{replica_id}') + "
            "(SELECT count(*) FROM public.replica_conflict_versions "
            f"WHERE user_id='{user_id}'::uuid AND kind='{kind}' "
            f"AND replica_id='{replica_id}');"
        )
        expect(remaining == "0", "probe cleanup left rows")
    print(
        "two_device_metadata=PASS; offline_replay=PASS; "
        "lost_response_retry=PASS; cursor_convergence=PASS; "
        "losing_branch_archived=PASS; cleanup=PASS"
    )


if __name__ == "__main__":
    main()
