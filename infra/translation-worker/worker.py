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
    source: Path, destination: Path, mode: str, glossary: Path | None = None
) -> list[str]:
    if mode not in {"mono", "dual", "both"}:
        raise ValueError("invalid translation mode")
    args = [
        "pdf2zh_next", str(source), "--output", str(destination),
        "--openaicompatible", "--lang-in", "en", "--lang-out", "zh-CN",
        "--qps", "1", "--pool-max-workers", "1", "--report-interval", "5",
        "--no-auto-extract-glossary",
    ]
    if glossary is not None:
        args.extend(["--glossaries", str(glossary)])
    if mode == "mono":
        args.append("--no-dual")
    elif mode == "dual":
        args.append("--no-mono")
    return args


def output_key(account: str, job: str, kind: str) -> str:
    if not UUID.fullmatch(account) or not UUID.fullmatch(job) or kind not in {"mono", "dual"}:
        raise ValueError("invalid translation identity")
    return f"{account}/Scholar/translations/{job}/{kind}.pdf"


def request_cache_key(
    source_sha256: str,
    target_language: str,
    mode: str,
    engine_version: str,
    model: str,
    glossary_sha256: str | None,
) -> str:
    if not SHA256.fullmatch(source_sha256):
        raise ValueError("invalid source hash")
    payload = {
        "source": source_sha256,
        "target": target_language,
        "mode": mode,
        "engine": engine_version,
        "model": model,
        "glossary": glossary_sha256,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


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


def inspect_output(path: Path, source_sha256: str, source_pages: int) -> dict[str, int | str]:
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
    return {"sha256": digest, "fileSize": len(content), "pageCount": pages}


def find_output(directory: Path, kind: str) -> Path:
    candidates = [
        p for p in directory.rglob(f"*-{kind}.pdf")
        if p.is_file() and not p.is_symlink() and directory.resolve() in p.resolve().parents
    ]
    if len(candidates) != 1:
        raise JobFailure("missing_output")
    return candidates[0]


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
    glossary: Path | None = None,
) -> None:
    import subprocess
    import time

    command = build_cli_command(source, output_dir, job["mode"], glossary)
    if job["model"].lower().startswith("qwen3"):
        command.extend([
            "--custom-system-prompt",
            "/no_think Translate English academic prose into fluent Chinese. "
            "Preserve equations, citations, symbols and terminology. Return only the translation.",
        ])
    log_path = output_dir.parent / "engine.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            cwd=output_dir.parent, start_new_session=True,
            env=child_environment(base_url, job["model"], api_key, cache_dir),
        )
        started = time.monotonic()
        last_renewal = started
        while process.poll() is None:
            time.sleep(3)
            if db.canceled(job):
                _terminate_process(process)
                raise JobFailure("canceled")
            if time.monotonic() - started > timeout_seconds:
                _terminate_process(process)
                raise JobFailure("engine_timeout")
            if time.monotonic() - last_renewal >= 25:
                if not db.renew(job, 20):
                    _terminate_process(process)
                    raise JobFailure("lease_lost")
                last_renewal = time.monotonic()
        if process.returncode != 0:
            raise JobFailure("engine_failed")


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
    import tempfile

    uploaded: list[str] = []
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

        cache_identity = request_cache_key(
            job["source_sha256"], "zh-CN", job["mode"], "pdf2zh-next/2.9.0",
            job["model"], job["glossary_sha256"],
        )
        account_cache = Path(cache_dir) / str(job["user_id"]) / cache_identity
        account_cache.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="scholar-translate-") as folder:
            work = Path(folder)
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
            run_engine(
                job, input_path, output_dir, db, base_url,
                api_key, str(account_cache), timeout_seconds, glossary_path,
            )
            if not db.renew(job, 80):
                raise JobFailure("lease_lost")
            kinds = ("mono", "dual") if job["mode"] == "both" else (job["mode"],)
            outputs = []
            for kind in kinds:
                path = find_output(output_dir, kind)
                metadata = inspect_output(path, job["source_sha256"], pages)
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
            if not db.publish(job, outputs, "pdf2zh-next/2.9.0"):
                if db.succeeded(job):
                    return "succeeded"
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
        db.finish(job, "failed", "worker_internal")
        result = "worker_internal"
    for key in uploaded:
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
        "SCHOLAR_TRANSLATION_API_KEY_FILE",
    ):
        os.environ.pop(name, None)


def main() -> None:
    import os
    import socket
    import time

    dsn = os.environ["SCHOLAR_TRANSLATION_DATABASE_URL"]
    bucket = os.environ["S3_BUCKET_NAME"]
    base_url = os.environ["SCHOLAR_TRANSLATION_BASE_URL"]
    key_file = Path(os.environ["SCHOLAR_TRANSLATION_API_KEY_FILE"])
    api_key = key_file.read_text().strip()
    cache_dir = os.environ.get("SCHOLAR_TRANSLATION_CACHE_DIR", "/cache")
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
        result = process_job(
            job, db, s3, bucket=bucket, base_url=base_url, api_key=api_key,
            cache_dir=cache_dir, timeout_seconds=timeout_seconds,
        )
        print(f"translation job {job['id']}: {result}", flush=True)


if __name__ == "__main__":
    main()
