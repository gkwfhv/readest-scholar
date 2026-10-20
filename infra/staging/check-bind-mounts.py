#!/usr/bin/env python3
"""Check that non-secret Compose bind mounts are readable by container users."""

import stat
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FILES = (
    "docker/volumes/api/kong.yml",
    "docker/volumes/db/roles.sql",
    "docker/volumes/db/jwt.sql",
    "docker/volumes/db/init/schema.sql",
    "docker/volumes/db/apply-migrations.sh",
)
MIGRATIONS = ROOT / "docker/volumes/db/migrations"


def check(path: Path, required: int) -> bool:
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        print(f"Missing staging bind mount: {path.relative_to(ROOT)}", file=sys.stderr)
        return False
    if mode & required != required:
        print(f"Container user cannot read staging bind mount: {path.relative_to(ROOT)}", file=sys.stderr)
        return False
    return True


def main() -> int:
    valid = True
    for name in FILES:
        required = stat.S_IROTH
        if name.endswith(".sh"):
            required |= stat.S_IXOTH
        valid = check(ROOT / name, required) and valid

    valid = check(MIGRATIONS, stat.S_IROTH | stat.S_IXOTH) and valid
    if MIGRATIONS.is_dir():
        for path in MIGRATIONS.rglob("*"):
            required = stat.S_IROTH | stat.S_IXOTH if path.is_dir() else stat.S_IROTH
            valid = check(path, required) and valid

    if not valid:
        print(
            "Make only the tracked docker/volumes static files and migration tree readable; "
            "keep docker/.env at mode 0600.",
            file=sys.stderr,
        )
        return 1
    print("Staging static bind mounts are readable by container users.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
