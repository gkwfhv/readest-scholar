#!/usr/bin/env python3
"""Inventory the exact files shipped inside a Scholar DEB as CycloneDX."""
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_field(package: Path, field: str) -> str:
    value = subprocess.check_output(
        ["dpkg-deb", "--field", str(package), field], text=True
    ).strip()
    if not value:
        raise ValueError(f"Missing DEB field: {field}")
    return value


def inventory(package: Path) -> dict:
    name = package_field(package, "Package")
    version = package_field(package, "Version")
    architecture = package_field(package, "Architecture")
    if name != "readest-scholar":
        raise ValueError(f"Unexpected package: {name}")
    archive_hash = sha256_file(package)
    app_ref = f"package:sha256:{archive_hash}"
    components = []
    with tempfile.TemporaryDirectory(prefix="scholar-deb-payload-") as temp:
        root = Path(temp)
        subprocess.run(
            ["dpkg-deb", "--raw-extract", str(package), str(root)], check=True
        )
        for directory, dirs, files in os.walk(root, followlinks=False):
            base = Path(directory)
            for entry in sorted(dirs + files):
                path = base / entry
                if not (path.is_file() or path.is_symlink()):
                    continue
                relative = path.relative_to(root).as_posix()
                if relative.startswith("DEBIAN/"):
                    continue  # Control metadata is not installed payload.
                component = {
                    "type": "file",
                    "bom-ref": "file:sha256:" + hashlib.sha256(
                        relative.encode("utf-8")
                    ).hexdigest(),
                    "name": relative,
                }
                if path.is_symlink():
                    component["properties"] = [{
                        "name": "scholar:symlink-target",
                        "value": os.readlink(path),
                    }]
                else:
                    component["hashes"] = [{
                        "alg": "SHA-256",
                        "content": sha256_file(path),
                    }]
                components.append(component)
        components.sort(key=lambda component: component["name"])
    if not components:
        raise ValueError("DEB payload contained no files")
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, archive_hash)),
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "bom-ref": app_ref,
                "name": name,
                "version": version,
                "hashes": [{"alg": "SHA-256", "content": archive_hash}],
                "properties": [
                    {"name": "scholar:architecture", "value": architecture},
                    {"name": "scholar:inventory-scope", "value": "deb-payload-files"},
                ],
            }
        },
        "components": components,
        "dependencies": [{
            "ref": app_ref,
            "dependsOn": [component["bom-ref"] for component in components],
        }],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package = args.package.resolve(strict=True)
    bom = inventory(package)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bom, ensure_ascii=False, indent=2) + "\n")
    print(
        f"Inventoried {len(bom['components'])} payload files for "
        f"{bom['metadata']['component']['name']} "
        f"{bom['metadata']['component']['version']}"
    )


if __name__ == "__main__":
    main()
