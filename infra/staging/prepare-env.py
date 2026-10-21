#!/usr/bin/env python3
"""Create one private, disposable staging environment from the upstream sample."""

import base64
import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "docker/.env.example"
DESTINATION = Path(os.environ.get("SCHOLAR_STAGING_ENV_FILE", ROOT / "docker/.env")).resolve()
PORTS = {"SCHOLAR_WEB_PORT": "3130", "SCHOLAR_API_PORT": "8130", "SCHOLAR_S3_PORT": "9130", "SCHOLAR_S3_CONSOLE_PORT": "9131"}
UPSTREAM_IMAGE = "ghcr.io/readest/readest:sha-2d37bbf@sha256:56a28e655e9d7afe788b398354f01be8feee8f15c09058d08bd165de95a62a43"


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def jwt(role: str, secret: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({"role": role}, separators=(",", ":")).encode())
    body = f"{header}.{payload}"
    signature = b64url(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def main() -> None:
    secret = secrets.token_urlsafe(48)
    values = {
        "HOST_IP": "127.0.0.1",
        "READEST_IMAGE": UPSTREAM_IMAGE,
        "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
        "JWT_SECRET": secret,
        "ANON_KEY": jwt("anon", secret),
        "SERVICE_ROLE_KEY": jwt("service_role", secret),
        "MINIO_ROOT_PASSWORD": secrets.token_urlsafe(36),
        "KONG_HTTP_PORT": PORTS["SCHOLAR_API_PORT"],
        "API_EXTERNAL_URL": f"http://127.0.0.1:{PORTS['SCHOLAR_API_PORT']}",
        "SITE_URL": f"http://127.0.0.1:{PORTS['SCHOLAR_WEB_PORT']}",
        "ADDITIONAL_REDIRECT_URLS": (
            f"http://127.0.0.1:{PORTS['SCHOLAR_WEB_PORT']}/**,"
            f"http://127.0.0.1:{PORTS['SCHOLAR_API_PORT']}/**,"
            "readest://auth-callback,readest-scholar://auth-callback"
        ),
    }
    lines = SAMPLE.read_text().splitlines()
    found = set()
    for index, line in enumerate(lines):
        key = line.split("=", 1)[0]
        if key in values:
            lines[index] = f"{key}={values[key]}"
            found.add(key)
    if found != values.keys():
        raise RuntimeError(f"Sample env missing keys: {sorted(values.keys() - found)}")
    lines.extend(
        [
            "SUPABASE_PUBLIC_URL=" + values["API_EXTERNAL_URL"],
            "S3_PUBLIC_ENDPOINT=http://127.0.0.1:" + PORTS["SCHOLAR_S3_PORT"],
            *(f"{key}={value}" for key, value in PORTS.items()),
        ]
    )
    os.umask(0o077)
    descriptor = os.open(DESTINATION, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write("\n".join(lines) + "\n")
    print(f"Created private staging environment at {DESTINATION}")


if __name__ == "__main__":
    main()
