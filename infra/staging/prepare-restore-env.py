#!/usr/bin/env python3
"""Copy disposable staging credentials to an independent loopback restore stack."""

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get("SCHOLAR_STAGING_ENV_FILE", ROOT / "docker/.env"))
DESTINATION = Path(os.environ.get("SCHOLAR_RESTORE_ENV_FILE", ROOT / "docker/.env.restore"))
PORTS = {
    "SCHOLAR_WEB_PORT": "3140",
    "SCHOLAR_API_PORT": "8140",
    "SCHOLAR_S3_PORT": "9140",
    "SCHOLAR_S3_CONSOLE_PORT": "9141",
}
VALUES = {
    **PORTS,
    "KONG_HTTP_PORT": PORTS["SCHOLAR_API_PORT"],
    "API_EXTERNAL_URL": f"http://127.0.0.1:{PORTS['SCHOLAR_API_PORT']}",
    "SITE_URL": f"http://127.0.0.1:{PORTS['SCHOLAR_WEB_PORT']}",
    "SUPABASE_PUBLIC_URL": f"http://127.0.0.1:{PORTS['SCHOLAR_API_PORT']}",
    "S3_PUBLIC_ENDPOINT": f"http://127.0.0.1:{PORTS['SCHOLAR_S3_PORT']}",
    "ADDITIONAL_REDIRECT_URLS": (
        f"http://127.0.0.1:{PORTS['SCHOLAR_WEB_PORT']}/**,"
        f"http://127.0.0.1:{PORTS['SCHOLAR_API_PORT']}/**,"
        "readest://auth-callback,readest-scholar://auth-callback"
    ),
}


def main() -> None:
    lines = SOURCE.read_text().splitlines()
    found = set()
    for index, line in enumerate(lines):
        key = line.split("=", 1)[0]
        if key in VALUES:
            lines[index] = f"{key}={VALUES[key]}"
            found.add(key)
    if found != VALUES.keys():
        raise RuntimeError(f"Staging env missing keys: {sorted(VALUES.keys() - found)}")
    os.umask(0o077)
    descriptor = os.open(DESTINATION, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write("\n".join(lines) + "\n")
    print("Created private restore environment with independent loopback ports")


if __name__ == "__main__":
    main()
