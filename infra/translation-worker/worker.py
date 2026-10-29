"""Isolated pdf2zh Next worker for owned Scholar translation jobs."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def build_cli_command(
    source: Path, destination: Path, mode: str, glossary: Path | None = None,
    *, white_background_compat: bool = False, pages: str | None = None,
) -> list[str]:
    if mode not in {"mono", "dual", "both"}:
        raise ValueError("invalid translation mode")
    args = [
        sys.executable, "/app/engine.py", str(source), "--output", str(destination),
        "--openaicompatible", "--lang-in", "en", "--lang-out", "zh-CN",
        "--qps", "1", "--pool-max-workers", "1", "--report-interval", "5",
        "--no-auto-extract-glossary",
    ]
    if glossary is not None:
        args.extend(["--glossaries", str(glossary)])
    if white_background_compat:
        args.append("--ocr-workaround")
    if pages is not None:
        args.extend(["--pages", pages, "--only-include-translated-page"])
    if mode == "mono":
        args.append("--no-dual")
    elif mode == "dual":
        args.append("--no-mono")
    return args


def parse_page_selection(spec: str, page_count: int) -> list[int]:
    """Validate a human page list and return zero-based page indexes."""
    if not isinstance(spec, str) or len(spec) > 120 or not re.fullmatch(
        r"[1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*", spec
    ):
        raise JobFailure("invalid_pages")
    selected: set[int] = set()
    for part in spec.split(","):
        bounds = [int(item) for item in part.split("-")]
        first, last = (bounds[0], bounds[0]) if len(bounds) == 1 else bounds
        if last < first or last > page_count or last - first > 499:
            raise JobFailure("invalid_pages")
        for page in range(first, last + 1):
            if page in selected:
                raise JobFailure("invalid_pages")
            selected.add(page)
    return [page - 1 for page in sorted(selected)]


def merge_page_outputs(
    original: Path, compatibility: Path, destination: Path, selected: list[int],
    expected_pages: int | None = None,
) -> None:
    """Replace only selected bilingual/mono pages; keep other vector pages intact."""
    from pypdf import PdfReader, PdfWriter

    base = PdfReader(original, strict=True)
    alternate = PdfReader(compatibility, strict=True)
    if (not selected or max(selected) >= len(base.pages)
        or len(alternate.pages) != len(selected)
        or (expected_pages is not None and len(base.pages) != expected_pages)):
        raise JobFailure("invalid_compatibility_output")
    replacement = dict(zip(selected, alternate.pages, strict=True))
    writer = PdfWriter()
    for index, page in enumerate(base.pages):
        writer.add_page(replacement.get(index, page))
    with destination.open("wb") as stream:
        writer.write(stream)


def output_key(account: str, job: str, kind: str) -> str:
    if not UUID.fullmatch(account) or not UUID.fullmatch(job) or kind not in {"mono", "dual"}:
        raise ValueError("invalid translation identity")
    return f"{account}/Scholar/translations/{job}/{kind}.pdf"


def verify_source_bytes(content: bytes, expected_sha256: str, expected_size: int) -> None:
    if not content.startswith(b"%PDF-") or not 0 < len(content) <= 100 * 1024 * 1024:
        raise ValueError("source is not a bounded PDF")
    if len(content) != expected_size or hashlib.sha256(content).hexdigest() != expected_sha256:
        raise ValueError("source PDF hash or size mismatch")


def child_environment(base_url: str, model: str, api_key: str, cache_dir: str) -> dict[str, str]:
    """Pass only the model connection to untrusted PDF processing."""
    if not base_url.startswith(("http://", "https://")) or not model or not api_key:
        raise ValueError("translation model is unavailable")
    return {
        "PATH": f"{Path(sys.executable).parent}:/usr/local/bin:/usr/bin:/bin",
        "HOME": cache_dir,
        "XDG_CACHE_HOME": cache_dir,
        "XDG_CONFIG_HOME": cache_dir,
        "PYTHONUNBUFFERED": "1",
        "PDF2ZH_OPENAI_COMPATIBLE_BASE_URL": base_url,
        "PDF2ZH_OPENAI_COMPATIBLE_MODEL": model,
        "PDF2ZH_OPENAI_COMPATIBLE_API_KEY": api_key,
    }


def _validate_model_profile(payload: object, job: dict) -> tuple[str, str]:
    """Accept only a public HTTPS OpenAI-compatible endpoint for the leased job."""
    import ipaddress
    import socket
    from urllib.parse import urlsplit, urlunsplit

    if not isinstance(payload, dict):
        raise JobFailure("model_config_unavailable")
    base_url = payload.get("baseUrl")
    model = payload.get("model")
    api_key = payload.get("apiKey")
    if (
        not isinstance(base_url, str) or not isinstance(model, str) or not isinstance(api_key, str)
        or model != job.get("model") or not 1 <= len(model) <= 120
        or not 1 <= len(api_key) <= 4096 or any(char in api_key for char in "\r\n\x00")
    ):
        raise JobFailure("model_config_unavailable")
    try:
        parsed = urlsplit(base_url)
        if (
            parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or len(base_url) > 2048
        ):
            raise ValueError("invalid endpoint")
        port = parsed.port or 443
        addresses = {
            result[4][0] for result in socket.getaddrinfo(
                parsed.hostname, port, type=socket.SOCK_STREAM
            )
        }
        if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise ValueError("non-public endpoint")
    except (OSError, ValueError):
        raise JobFailure("model_config_unavailable") from None
    canonical = urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))
    return canonical, api_key


def fetch_model_profile(internal_base_url: str, worker_token: str, job: dict) -> tuple[str, str]:
    """Read one profile from the Web API after the database lease is acquired."""
    import json as json_module
    from urllib.error import HTTPError, URLError
    from urllib.parse import quote, urlsplit
    from urllib.request import Request, urlopen

    try:
        internal = urlsplit(internal_base_url)
        if (
            internal.scheme != "http" or not internal.hostname or internal.username
            or internal.password or internal.query or internal.fragment
        ):
            raise ValueError("invalid internal endpoint")
        endpoint = (
            internal_base_url.rstrip("/")
            + "/api/internal/scholar/translation-model/"
            + quote(str(job["id"]), safe="")
        )
        request = Request(
            endpoint,
            headers={
                "X-Scholar-Translation-Worker-Token": worker_token,
                "X-Scholar-Translation-Lease-Token": str(job["lease_token"]),
            },
            method="GET",
        )
        with urlopen(request, timeout=20) as response:
            payload = json_module.loads(response.read(16385))
    except (HTTPError, URLError, OSError, ValueError, json_module.JSONDecodeError):
        raise JobFailure("model_config_unavailable") from None
    return _validate_model_profile(payload, job)


def prepare_asset_links(account_cache: Path, asset_root: Path) -> None:
    """Use verified read-only BabelDOC assets with an account-specific text cache."""
    source = asset_root / ".cache" / "babeldoc"
    target = account_cache / ".cache" / "babeldoc"
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ("fonts", "cmap", "models", "tiktoken"):
        asset = source / name
        if not asset.is_dir():
            raise JobFailure("translation_assets_missing")
        link = target / name
        if link.is_symlink():
            if link.resolve() != asset.resolve():
                raise JobFailure("translation_assets_invalid")
        elif link.exists():
            raise JobFailure("translation_assets_invalid")
        else:
            link.symlink_to(asset, target_is_directory=True)


def verify_glossary_text(content: str, expected_sha256: str) -> None:
    import csv
    from io import StringIO

    raw = content.encode("utf-8")
    if not 22 <= len(raw) <= 65536 or hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise JobFailure("glossary_integrity_failed")
    if "\x00" in content:
        raise JobFailure("invalid_glossary")
    try:
        reader = csv.DictReader(StringIO(content), strict=True)
        if reader.fieldnames != ["source", "target", "tgt_lng"]:
            raise ValueError("invalid glossary columns")
        rows = list(reader)
        if not 1 <= len(rows) <= 500:
            raise ValueError("invalid glossary row count")
        if any(
            None in row or not row["source"] or not row["target"]
            or row["tgt_lng"] != "zh-CN"
            or len(row["source"]) > 200 or len(row["target"]) > 500
            for row in rows
        ):
            raise ValueError("invalid glossary row")
    except (csv.Error, ValueError) as exc:
        raise JobFailure("invalid_glossary") from exc


class JobFailure(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def pdf_page_count(content: bytes, *, limit: int) -> int:
    from io import BytesIO
    from pypdf import PdfReader

    try:
        reader = PdfReader(BytesIO(content), strict=True)
        count = len(reader.pages)
    except Exception as exc:
        raise JobFailure("invalid_pdf") from exc
    if count < 1 or count > limit:
        raise JobFailure("pdf_page_limit")
    return count


def count_raw_style_markers(content: bytes) -> int:
    """Count visible HTML style tags in a PDF's extracted text."""
    import fitz

    try:
        with fitz.open(stream=content, filetype="pdf") as document:
            return sum(page.get_text().lower().count("<style") for page in document)
    except Exception as exc:
        raise JobFailure("invalid_output_pdf") from exc


def inspect_output(
    path: Path, source_sha256: str, source_pages: int, source_content: bytes,
) -> dict[str, int | str]:
    if path.is_symlink() or not path.is_file():
        raise JobFailure("missing_output")
    if path.stat().st_size > 200 * 1024 * 1024:
        raise JobFailure("output_size_limit")
    content = path.read_bytes()
    if not content.startswith(b"%PDF-"):
        raise JobFailure("invalid_output_pdf")
    digest = hashlib.sha256(content).hexdigest()
    if digest == source_sha256:
        raise JobFailure("untranslated_output")
    pages = pdf_page_count(content, limit=min(1000, 2 * source_pages + 2))
    # A paper about HTML may legitimately contain style tags in its source.
    if count_raw_style_markers(content) and count_raw_style_markers(source_content) == 0:
        raise JobFailure("invalid_translation_markup")
    return {"sha256": digest, "fileSize": len(content), "pageCount": pages}


def find_output(directory: Path, kind: str) -> Path:
    candidates = [
        p for p in directory.rglob("*.pdf")
        if p.name.endswith((f"-{kind}.pdf", f".{kind}.pdf"))
        and p.is_file()
        and not p.is_symlink()
        and directory.resolve() in p.resolve().parents
    ]
    if len(candidates) != 1:
        raise JobFailure("missing_output")
    return candidates[0]


def engine_progress(log_path: Path) -> int:
    """Map the CLI's tqdm percentage to the queue's processing range."""
    if not log_path.exists():
        return 20
    with log_path.open("rb") as log:
        log.seek(0, 2)
        log.seek(max(0, log.tell() - 32768))
        tail = log.read()
    structured = re.findall(rb"@@SCHOLAR_PROGRESS:([0-9]{1,3})", tail)
    if structured:
        percent = min(100, int(structured[-1]))
        return 20 + round(percent * 0.55)
    readings = re.findall(rb"(?<![0-9])([0-9]{1,3})%\|", tail)
    if not readings:
        return 20
    percent = min(100, int(readings[-1]))
    return 20 + round(percent * 0.55)


def _grant_engine_access(path: Path) -> None:
    """Allow the less-privileged PDF engine to use one temporary workspace."""
    import os

    if os.geteuid() != 0 or path.is_symlink():
        return
    for root, directories, files in os.walk(path, followlinks=False):
        current = Path(root)
        os.chown(current, 1000, 1000)
        os.chmod(current, 0o700)
        for name in directories:
            candidate = current / name
            if not candidate.is_symlink():
                os.chown(candidate, 1000, 1000)
                os.chmod(candidate, 0o700)
        for name in files:
            candidate = current / name
            if not candidate.is_symlink():
                os.chown(candidate, 1000, 1000)
                os.chmod(candidate, 0o600)


def _drop_engine_privileges() -> None:
    """The pdf2zh child does not inherit the worker's secret-file access."""
    import os

    if os.geteuid() == 0:
        os.setgroups([])
        os.setgid(1000)
        os.setuid(1000)


def _terminate_process(process) -> None:
    import os
    import signal
    import subprocess

    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


class Database:
    def __init__(self, dsn: str):
        import psycopg
        from psycopg.rows import dict_row

        self.connection = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)

    def one(self, sql: str, params: tuple = ()):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()

    def claim(self, worker_id: str):
        row = self.one(
            "SELECT * FROM public.claim_scholar_translation_job_v1(%s,%s)",
            (worker_id, 90),
        )
        return row if row and row.get("id") else None

    def source(self, job):
        return self.one(
            """SELECT object_key,sha256,file_size FROM public.scholar_file_versions
               WHERE user_id=%s AND file_id=%s AND version_id=%s AND state='ready'""",
            (job["user_id"], job["source_file_id"], job["source_version_id"]),
        )

    def glossary(self, job) -> str | None:
        row = self.one(
            """SELECT csv_text FROM public.scholar_translation_glossaries
               WHERE user_id=%s AND sha256=%s""",
            (job["user_id"], job["glossary_sha256"]),
        )
        return row["csv_text"] if row else None

    def canceled(self, job) -> bool:
        row = self.one(
            "SELECT cancel_requested,state FROM public.scholar_translation_jobs WHERE id=%s",
            (job["id"],),
        )
        return bool(row and row["cancel_requested"])

    def renew(self, job, progress: int) -> bool:
        row = self.one(
            "SELECT public.renew_scholar_translation_lease_v1(%s,%s,%s,%s) AS ok",
            (job["id"], job["lease_token"], progress, 90),
        )
        return bool(row and row["ok"])

    def finish(self, job, state: str, error_code: str | None = None) -> bool:
        row = self.one(
            "SELECT public.finish_scholar_translation_job_v1(%s,%s,%s,%s) AS ok",
            (job["id"], job["lease_token"], state, error_code),
        )
        return bool(row and row["ok"])

    def publish(self, job, outputs: list[dict], engine_version: str) -> bool:
        row = self.one(
            "SELECT public.publish_scholar_translation_outputs_v1(%s,%s,%s::jsonb,%s) AS ok",
            (job["id"], job["lease_token"], json.dumps(outputs), engine_version),
        )
        return bool(row and row["ok"])

    def succeeded(self, job) -> bool:
        row = self.one(
            "SELECT state FROM public.scholar_translation_jobs WHERE id=%s",
            (job["id"],),
        )
        return bool(row and row["state"] == "succeeded")


def run_engine(
    job, source: Path, output_dir: Path, db: Database, base_url: str,
    api_key: str, cache_dir: str, timeout_seconds: int,
    glossary: Path | None = None, *,
    white_background_compat: bool | None = None,
    pages: str | None = None,
    progress_start: int = 20,
    progress_end: int = 75,
) -> None:
    import subprocess
    import time

    if white_background_compat is None:
        white_background_compat = (
            job.get("request_options", {}).get("whiteBackgroundCompatibility") is True
        )
    command = build_cli_command(
        source, output_dir, job["mode"], glossary,
        white_background_compat=white_background_compat, pages=pages,
    )
    if job["model"].lower().startswith("qwen3"):
        command.extend([
            "--custom-system-prompt",
            "/no_think Translate English academic prose into fluent Chinese. "
            "Preserve equations, citations, symbols and terminology. Return only the translation.",
        ])
    if __import__("os").geteuid() == 0:
        _grant_engine_access(source.parent)
        _grant_engine_access(Path(cache_dir))
        _grant_engine_access(output_dir)
        if glossary is not None:
            _grant_engine_access(glossary)
            __import__("os").chmod(glossary, 0o400)
        __import__("os").chmod(source, 0o400)
    log_path = output_dir.parent / ("engine-pages.log" if pages else "engine.log")
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            cwd=output_dir.parent, start_new_session=True,
            preexec_fn=_drop_engine_privileges if __import__("os").geteuid() == 0 else None,
            env=child_environment(base_url, job["model"], api_key, cache_dir),
        )
        started = time.monotonic()
        last_renewal = started
        try:
            while process.poll() is None:
                time.sleep(3)
                if db.canceled(job):
                    raise JobFailure("canceled")
                if time.monotonic() - started > timeout_seconds:
                    raise JobFailure("engine_timeout")
                if time.monotonic() - last_renewal >= 25:
                    stage_progress = engine_progress(log_path)
                    scaled = progress_start + round(
                        (stage_progress - 20) * (progress_end - progress_start) / 55
                    )
                    if not db.renew(job, scaled):
                        raise JobFailure("lease_lost")
                    last_renewal = time.monotonic()
            if process.returncode != 0:
                raise JobFailure("engine_failed")
        finally:
            if process.poll() is None:
                _terminate_process(process)


def _s3_client():
    import boto3
    import os

    return boto3.client(
        "s3", endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )


def process_job(job, db: Database, s3, *, bucket: str, base_url: str,
                api_key: str, cache_dir: str, timeout_seconds: int) -> str:
    import os
    import tempfile

    uploaded: list[str] = []
    publication_uncertain = False
    try:
        source = db.source(job)
        if not source or not source["object_key"].startswith(f"{job['user_id']}/Scholar/versions/"):
            raise JobFailure("source_missing")
        response = s3.get_object(Bucket=bucket, Key=source["object_key"])
        body = response["Body"]
        try:
            content = body.read(100 * 1024 * 1024 + 1)
        finally:
            body.close()
        try:
            verify_source_bytes(content, job["source_sha256"], job["source_size"])
        except ValueError as exc:
            raise JobFailure("source_integrity_failed") from exc
        pages = pdf_page_count(content, limit=500)
        if not db.renew(job, 10):
            raise JobFailure("lease_lost")

        with tempfile.TemporaryDirectory(prefix="scholar-translate-", dir=cache_dir) as folder:
            work = Path(folder)
            job_cache = work / "cache"
            job_cache.mkdir(mode=0o700)
            asset_root = Path(os.environ.get("SCHOLAR_TRANSLATION_ASSET_DIR", "/assets"))
            prepare_asset_links(job_cache, asset_root)
            input_path = work / "source.pdf"
            output_dir = work / "output"
            output_dir.mkdir()
            input_path.write_bytes(content)
            input_path.chmod(0o444)
            glossary_path = None
            if job["glossary_sha256"]:
                glossary_text = db.glossary(job)
                if glossary_text is None:
                    raise JobFailure("glossary_missing")
                verify_glossary_text(glossary_text, job["glossary_sha256"])
                glossary_path = work / "glossary.csv"
                glossary_path.write_text(glossary_text, encoding="utf-8")
                glossary_path.chmod(0o444)
            page_spec = job.get("request_options", {}).get("whiteBackgroundPages")
            selected_pages = parse_page_selection(page_spec, pages) if page_spec else None
            if selected_pages and not (
                job.get("request_options", {}).get("whiteBackgroundCompatibility") is True
            ):
                raise JobFailure("invalid_pages")
            if selected_pages:
                run_engine(
                    job, input_path, output_dir, db, base_url,
                    api_key, str(job_cache), timeout_seconds, glossary_path,
                    white_background_compat=False, progress_end=55,
                )
            else:
                run_engine(
                    job, input_path, output_dir, db, base_url,
                    api_key, str(job_cache), timeout_seconds, glossary_path,
                )
            if selected_pages:
                compatibility_dir = work / "compatibility"
                compatibility_dir.mkdir()
                normalized_pages = ",".join(str(index + 1) for index in selected_pages)
                run_engine(
                    job, input_path, compatibility_dir, db, base_url,
                    api_key, str(job_cache), timeout_seconds, glossary_path,
                    white_background_compat=True, pages=normalized_pages,
                    progress_start=55, progress_end=78,
                )
                merged_dir = work / "merged"
                merged_dir.mkdir()
                kinds = ("mono", "dual") if job["mode"] == "both" else (job["mode"],)
                for kind in kinds:
                    normal = find_output(output_dir, kind)
                    alternate = find_output(compatibility_dir, kind)
                    merge_page_outputs(
                        normal, alternate, merged_dir / normal.name, selected_pages, pages
                    )
                output_dir = merged_dir
            if not db.renew(job, 80):
                raise JobFailure("lease_lost")
            kinds = ("mono", "dual") if job["mode"] == "both" else (job["mode"],)
            outputs = []
            for kind in kinds:
                path = find_output(output_dir, kind)
                metadata = inspect_output(path, job["source_sha256"], pages, content)
                key = output_key(str(job["user_id"]), str(job["id"]), kind)
                data = path.read_bytes()
                s3.put_object(
                    Bucket=bucket, Key=key, Body=data, ContentType="application/pdf",
                    IfNoneMatch="*",
                )
                uploaded.append(key)
                readback = s3.get_object(Bucket=bucket, Key=key)["Body"]
                try:
                    observed = readback.read(200 * 1024 * 1024 + 1)
                finally:
                    readback.close()
                if hashlib.sha256(observed).hexdigest() != metadata["sha256"]:
                    raise JobFailure("output_upload_mismatch")
                outputs.append({"kind": kind, "objectKey": key, **metadata})
            if not db.renew(job, 95):
                raise JobFailure("lease_lost")
            publication_uncertain = True
            published = db.publish(job, outputs, "pdf2zh-next/2.9.0")
            if not published:
                if db.succeeded(job):
                    return "succeeded"
                publication_uncertain = False
                raise JobFailure("publish_rejected")
            return "succeeded"
    except JobFailure as failure:
        if failure.code == "canceled" or db.canceled(job):
            db.finish(job, "canceled")
            result = "canceled"
        else:
            db.finish(job, "failed", failure.code)
            result = failure.code
    except Exception as exc:
        # File text, model credentials and engine logs stay in the private
        # temporary directory; only the failure class is exposed.
        print(f"translation job {job['id']} failed: {type(exc).__name__}", flush=True)
        if publication_uncertain:
            try:
                if db.succeeded(job):
                    return "succeeded"
            except Exception:
                pass
        try:
            db.finish(job, "failed", "worker_internal")
        except Exception:
            pass
        result = "worker_internal"
    for key in ([] if publication_uncertain else uploaded):
        try:
            s3.delete_object(Bucket=bucket, Key=key)
        except Exception:
            pass
    return result


def seal_process_credentials() -> None:
    """Prevent the PDF engine (same UID) from reading this process via /proc."""
    import ctypes
    import os

    # PR_SET_DUMPABLE=4. A same-UID child cannot ptrace or read /proc/PID/environ
    # after this call. Keep credentials only in the worker's memory.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(4, 0, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "could not seal worker credentials")
    for name in (
        "SCHOLAR_TRANSLATION_DATABASE_URL",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "SCHOLAR_TRANSLATION_WORKER_TOKEN_FILE",
    ):
        os.environ.pop(name, None)


def main() -> None:
    import os
    import socket
    import time

    dsn = os.environ["SCHOLAR_TRANSLATION_DATABASE_URL"]
    bucket = os.environ["S3_BUCKET_NAME"]
    internal_base_url = os.environ["SCHOLAR_TRANSLATION_INTERNAL_BASE_URL"]
    worker_token = Path(os.environ["SCHOLAR_TRANSLATION_WORKER_TOKEN_FILE"]).read_text().strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", worker_token):
        raise ValueError("invalid translation worker token")
    cache_dir = os.environ.get("SCHOLAR_TRANSLATION_CACHE_DIR", "/tmp")
    timeout_seconds = int(os.environ.get("SCHOLAR_TRANSLATION_TIMEOUT_SECONDS", "1800"))
    if not 60 <= timeout_seconds <= 3600:
        raise ValueError("invalid translation timeout")
    db = Database(dsn)
    s3 = _s3_client()
    seal_process_credentials()
    worker_id = socket.gethostname()[:120]
    while True:
        job = db.claim(worker_id)
        if not job:
            time.sleep(5)
            continue
        try:
            base_url, api_key = fetch_model_profile(internal_base_url, worker_token, job)
        except JobFailure as failure:
            try:
                db.finish(job, "failed", failure.code)
            except Exception:
                pass
            print(f"translation job {job['id']}: {failure.code}", flush=True)
            continue
        result = process_job(
            job, db, s3, bucket=bucket, base_url=base_url, api_key=api_key,
            cache_dir=cache_dir, timeout_seconds=timeout_seconds,
        )
        print(f"translation job {job['id']}: {result}", flush=True)


if __name__ == "__main__":
    main()
