#!/usr/bin/env python3
"""Fail CI if a private Compose environment entered the Git index."""

import os
import subprocess
import sys


tracked = subprocess.check_output(["git", "ls-files", "-z"]).split(b"\0")
private = sorted(
    os.fsdecode(path)
    for path in tracked
    if path.startswith(b"docker/.env") and path != b"docker/.env.example"
)
if private:
    print("Private Compose environment files are tracked:", file=sys.stderr)
    for path in private:
        print(f"  {path}", file=sys.stderr)
    sys.exit(1)
print("No private Compose environment files are tracked")
