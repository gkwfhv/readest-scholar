"""Prefetch and verify BabelDOC assets with bounded concurrency for restricted networks."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import os
from pathlib import Path
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

def fetch(name, kind, url, expected):
    path = get_cache_file_path(name, kind)
    if path.is_file() and hashlib.sha3_256(path.read_bytes()).hexdigest() == expected:
        return "cached", name
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 5):
        temp = None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Readest-Scholar-asset-warmup/1.0"})
            with urllib.request.urlopen(req, timeout=120) as response:
                with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
                    temp = Path(output.name)
                    digest = hashlib.sha3_256()
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
            if digest.hexdigest() != expected:
                raise ValueError(f"SHA3-256 mismatch: {name}")
            temp.replace(path)
            return "downloaded", name
        except Exception as exc:
            if temp is not None:
                temp.unlink(missing_ok=True)
            if attempt == 4:
                return "FAILED", f"{name}: {exc}"
            time.sleep(attempt * 3)

items = []
for name, meta in EMBEDDING_FONT_METADATA.items():
    items.append((name, "fonts", FONT_URL_BY_UPSTREAM[UPSTREAM](name), meta["sha3_256"]))
for name, meta in CMAP_METADATA.items():
    items.append((name, "cmap", CMAP_URL_BY_UPSTREAM[UPSTREAM](name), meta["sha3_256"]))
items.append(("doclayout_yolo_docstructbench_imgsz1024.onnx", "models", DOC_LAYOUT_ONNX_MODEL_URL[UPSTREAM], DOCLAYOUT_YOLO_DOCSTRUCTBENCH_IMGSZ1024ONNX_SHA3_256))
from tiktoken import encoding_for_model
encoding_for_model("gpt-4o")
print(f"Checking {len(items)} BabelDOC assets with {MAX_WORKERS} workers", flush=True)
failed = []
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
    futures = [pool.submit(fetch, *item) for item in items]
    for index, future in enumerate(as_completed(futures), 1):
        state, name = future.result()
        if state == "FAILED":
            failed.append(name)
        if index % 10 == 0 or state == "FAILED" or index == len(items):
            print(f"{index}/{len(items)} {state}: {name}", flush=True)
if failed:
    raise SystemExit(f"{len(failed)} assets failed: {failed}")
print("All asset hashes verified", flush=True)
