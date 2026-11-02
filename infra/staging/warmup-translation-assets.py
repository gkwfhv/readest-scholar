"""Prefetch and verify BabelDOC and tiktoken assets for offline PDF translation."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.request

from babeldoc.assets.embedding_assets_metadata import (
    CMAP_METADATA,
    EMBEDDING_FONT_METADATA,
    CMAP_URL_BY_UPSTREAM,
    FONT_URL_BY_UPSTREAM,
    DOC_LAYOUT_ONNX_MODEL_URL,
    DOCLAYOUT_YOLO_DOCSTRUCTBENCH_IMGSZ1024ONNX_SHA3_256,
)
from babeldoc.const import get_cache_file_path

UPSTREAM = os.getenv("BABELDOC_ASSET_UPSTREAM", "modelscope")
MAX_WORKERS = int(os.getenv("BABELDOC_ASSET_WORKERS", "3"))
TIKTOKEN_URL = "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken"
TIKTOKEN_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"
RANGE_BYTES = 64 * 1024


def verified_digest(path: Path, expected: str, algorithm: str) -> bool:
    digest = hashlib.new(algorithm)
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest() == expected


def fetch(
    name: str,
    kind: str,
    url: str,
    expected: str,
    algorithm: str = "sha3_256",
) -> tuple[str, str]:
    path = get_cache_file_path(name, kind)
    if path.is_file() and verified_digest(path, expected, algorithm):
        return "cached", name
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 5):
        temporary: Path | None = None
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "Readest-Scholar-asset-warmup/1.0"}
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
                    temporary = Path(output.name)
                    digest = hashlib.new(algorithm)
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
            if digest.hexdigest() != expected:
                raise ValueError(f"{algorithm} mismatch: {name}")
            temporary.replace(path)
            return "downloaded", name
        except Exception as exc:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            if attempt == 4:
                return "FAILED", f"{name}: {exc}"
            time.sleep(attempt * 3)
    raise AssertionError("unreachable")


def fetch_tiktoken() -> tuple[str, str]:
    cache_root = Path(
        os.environ.get(
            "TIKTOKEN_CACHE_DIR",
            Path.home() / ".cache" / "babeldoc" / "tiktoken",
        )
    )
    cache_path = cache_root / hashlib.sha1(TIKTOKEN_URL.encode()).hexdigest()
    if cache_path.is_file() and verified_digest(cache_path, TIKTOKEN_SHA256, "sha256"):
        return "cached", "o200k_base.tiktoken"

    cache_root.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 5):
        temporary: Path | None = None
        try:
            probe = urllib.request.Request(
                TIKTOKEN_URL,
                headers={
                    "Range": "bytes=0-0",
                    "User-Agent": "Readest-Scholar-asset-warmup/1.0",
                },
            )
            with urllib.request.urlopen(probe, timeout=30) as response:
                content_range = response.headers.get("Content-Range", "")
            match = re.fullmatch(r"bytes 0-0/(\d+)", content_range)
            if match is None:
                raise ValueError("tiktoken upstream does not support ranged downloads")
            size = int(match.group(1))

            with tempfile.NamedTemporaryFile(dir=cache_root, delete=False) as output:
                temporary = Path(output.name)
                for start in range(0, size, RANGE_BYTES):
                    end = min(start + RANGE_BYTES - 1, size - 1)
                    request = urllib.request.Request(
                        TIKTOKEN_URL,
                        headers={
                            "Range": f"bytes={start}-{end}",
                            "User-Agent": "Readest-Scholar-asset-warmup/1.0",
                        },
                    )
                    with urllib.request.urlopen(request, timeout=30) as response:
                        payload = response.read()
                    expected_size = end - start + 1
                    if len(payload) != expected_size:
                        raise ValueError(
                            f"short ranged download at {start}: {len(payload)} != {expected_size}"
                        )
                    output.write(payload)

            if not verified_digest(temporary, TIKTOKEN_SHA256, "sha256"):
                raise ValueError("SHA-256 mismatch: o200k_base.tiktoken")
            temporary.replace(cache_path)
            return "downloaded", "o200k_base.tiktoken"
        except Exception as exc:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            if attempt == 4:
                return "FAILED", f"o200k_base.tiktoken: {exc}"
            time.sleep(attempt * 3)
    raise AssertionError("unreachable")


items = []
for name, meta in EMBEDDING_FONT_METADATA.items():
    items.append((name, "fonts", FONT_URL_BY_UPSTREAM[UPSTREAM](name), meta["sha3_256"]))
for name, meta in CMAP_METADATA.items():
    items.append((name, "cmap", CMAP_URL_BY_UPSTREAM[UPSTREAM](name), meta["sha3_256"]))
items.append(
    (
        "doclayout_yolo_docstructbench_imgsz1024.onnx",
        "models",
        DOC_LAYOUT_ONNX_MODEL_URL[UPSTREAM],
        DOCLAYOUT_YOLO_DOCSTRUCTBENCH_IMGSZ1024ONNX_SHA3_256,
    )
)

print(f"Checking {len(items)} BabelDOC assets with {MAX_WORKERS} workers", flush=True)
failed = []
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
    futures = [pool.submit(fetch, *item) for item in items]
    futures.append(pool.submit(fetch_tiktoken))
    for index, future in enumerate(as_completed(futures), 1):
        state, name = future.result()
        if state == "FAILED":
            failed.append(name)
        if index % 10 == 0 or state == "FAILED" or index == len(futures):
            print(f"{index}/{len(futures)} {state}: {name}", flush=True)
if failed:
    raise SystemExit(f"{len(failed)} assets failed: {failed}")
print("All asset hashes verified", flush=True)
