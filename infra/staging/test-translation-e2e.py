"""Synthetic staging-only PDF translation end-to-end probe."""
import hashlib
import json
import os
import sys
import time
import uuid
from io import BytesIO
from pathlib import Path

import psycopg
from pypdf import PdfReader
from worker import _s3_client

BUCKET = os.environ["S3_BUCKET_NAME"]
MODEL = os.environ.get("SCHOLAR_TRANSLATION_MODEL", "Qwen3-0.6B-Q8_0")
DB = os.environ["SCHOLAR_TRANSLATION_DATABASE_URL"]
WHITE_BACKGROUND = os.environ.get("SCHOLAR_TRANSLATION_WHITE_BACKGROUND_COMPAT") == "true"
WHITE_PAGES = os.environ.get("SCHOLAR_TRANSLATION_WHITE_BACKGROUND_PAGES")


def source_pdf():
    content = Path("/input.pdf").read_bytes()
    assert content.startswith(b"%PDF-")
    assert len(PdfReader(BytesIO(content), strict=True).pages) == 2
    return content


def setup():
    content = source_pdf()
    digest = hashlib.sha256(content).hexdigest()
    file_id, doc_id, version_id, op_id, request_id = [uuid.uuid4() for _ in range(5)]
    s3 = _s3_client()
    with psycopg.connect(DB) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM auth.users WHERE email LIKE %s ORDER BY id LIMIT 1",
                ("%@example.%",),
            )
            row = cursor.fetchone()
            if not row:
                raise RuntimeError("synthetic staging account missing")
            user_id = row[0]
            key = f"{user_id}/Scholar/versions/{version_id}.pdf"
            s3.put_object(
                Bucket=BUCKET, Key=key, Body=content,
                ContentType="application/pdf", IfNoneMatch="*",
            )
            try:
                cursor.execute(
                    "INSERT INTO public.scholar_documents(user_id,id) VALUES (%s,%s)",
                    (user_id, doc_id),
                )
                cursor.execute(
                    """INSERT INTO public.files(user_id,id,file_key,file_size)
                       VALUES (%s,%s,%s,%s)""",
                    (user_id, file_id,
                     f"{user_id}/Scholar/translation-e2e-{file_id}.pdf", len(content)),
                )
                cursor.execute(
                    """INSERT INTO public.scholar_document_files
                       (user_id,document_id,file_id,role)
                       VALUES (%s,%s,%s,'original')""",
                    (user_id, doc_id, file_id),
                )
                cursor.execute(
                    """INSERT INTO public.scholar_file_versions
                       (user_id,file_id,version_id,op_id,object_key,sha256,file_size,state)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,'ready')""",
                    (user_id, file_id, version_id, op_id, key, digest, len(content)),
                )
                cursor.execute(
                    """SELECT id FROM public.enqueue_scholar_translation_job_v3(
                       %s,%s,%s,%s,'dual','zh-CN','openai-compatible',%s,NULL,%s,%s)""",
                    (user_id, file_id, version_id, request_id, MODEL, WHITE_BACKGROUND, WHITE_PAGES),
                )
                job_id = cursor.fetchone()[0]
                connection.commit()
            except Exception:
                connection.rollback()
                s3.delete_object(Bucket=BUCKET, Key=key)
                raise
    print(json.dumps({"jobId": str(job_id), "sourceSha256": digest}), flush=True)


def inspect(job_id):
    s3 = _s3_client()
    with psycopg.connect(DB) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT j.state,j.progress,j.error_code,j.source_sha256,
                          v.object_key,j.source_file_id
                   FROM public.scholar_translation_jobs j
                   JOIN public.scholar_file_versions v
                     ON v.user_id=j.user_id AND v.file_id=j.source_file_id
                    AND v.version_id=j.source_version_id
                   WHERE j.id=%s""",
                (job_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise RuntimeError("probe job missing")
            state, progress, error, source_sha, source_key, source_file_id = row
            source = s3.get_object(Bucket=BUCKET, Key=source_key)["Body"].read()
            assert hashlib.sha256(source).hexdigest() == source_sha
            cursor.execute(
                """SELECT o.kind,o.object_key,o.sha256,o.file_size,o.page_count,
                          o.file_id,src.document_id,derived.document_id,derived.role
                   FROM public.scholar_translation_outputs o
                   JOIN public.scholar_translation_jobs j
                     ON j.user_id=o.user_id AND j.id=o.job_id
                   JOIN public.scholar_document_files src
                     ON src.user_id=j.user_id AND src.file_id=j.source_file_id
                   JOIN public.scholar_document_files derived
                     ON derived.user_id=o.user_id AND derived.file_id=o.file_id
                   WHERE o.job_id=%s""",
                (job_id,),
            )
            outputs = cursor.fetchall()
            if state == "succeeded":
                assert len(outputs) == 1 and outputs[0][0] == "dual"
                for kind, key, digest, size, pages, derived_id, source_doc, derived_doc, role in outputs:
                    assert derived_id != source_file_id
                    assert source_doc == derived_doc and role == "translation"
                    content = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
                    assert len(content) == size
                    assert hashlib.sha256(content).hexdigest() == digest
                    assert len(PdfReader(BytesIO(content), strict=True).pages) == pages
                assert source_sha != outputs[0][2]
            print(json.dumps({
                "jobId": str(job_id), "state": state, "progress": progress,
                "errorCode": error, "sourceSha256": source_sha,
                "outputs": [{"kind": r[0], "sha256": r[2], "bytes": r[3],
                             "pages": r[4]} for r in outputs],
            }), flush=True)
            if state == "failed":
                raise SystemExit(1)




def repeat(job_id):
    with psycopg.connect(DB, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT user_id,source_file_id,source_version_id,mode,model,request_options
                   FROM public.scholar_translation_jobs WHERE id=%s AND state='succeeded'""",
                (job_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise RuntimeError("completed probe job missing")
            user_id, file_id, version_id, mode, model, options = row
            cursor.execute(
                """SELECT id FROM public.enqueue_scholar_translation_job_v3(
                   %s,%s,%s,%s,%s,'zh-CN','openai-compatible',%s,NULL,%s,%s)""",
                (user_id, file_id, version_id, uuid.uuid4(), mode, model,
                 options.get("whiteBackgroundCompatibility") is True,
                 options.get("whiteBackgroundPages")),
            )
            repeated = cursor.fetchone()[0]
            print(json.dumps({"repeatJobId": str(repeated)}), flush=True)
            return repeated


def progress_probe(job_id):
    repeated = repeat(job_id)
    seen = []
    with psycopg.connect(DB, autocommit=True) as connection:
        with connection.cursor() as cursor:
            deadline = time.monotonic() + 900
            while time.monotonic() < deadline:
                cursor.execute(
                    "SELECT state,progress,error_code FROM public.scholar_translation_jobs WHERE id=%s",
                    (repeated,),
                )
                state, progress, error = cursor.fetchone()
                sample = (state, progress)
                if not seen or seen[-1] != sample:
                    seen.append(sample)
                    print(json.dumps({"state": state, "progress": progress, "error": error}), flush=True)
                if state in ("succeeded", "failed", "canceled"):
                    break
                time.sleep(3)
            else:
                raise RuntimeError("progress probe timed out")
    if state != "succeeded" or not any(
        item[0] == "running" and 20 < item[1] < 100 for item in seen
    ):
        raise RuntimeError(f"no meaningful intermediate progress: {seen}")
    inspect(repeated)

def cancel_retry(job_id):
    with psycopg.connect(DB, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT user_id,source_file_id,source_version_id,model,request_options
                   FROM public.scholar_translation_jobs WHERE id=%s AND state='succeeded'""",
                (job_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise RuntimeError("completed probe job missing")
            user_id, file_id, version_id, model, options = row
            cursor.execute(
                """SELECT id FROM public.enqueue_scholar_translation_job_v3(
                   %s,%s,%s,%s,'dual','zh-CN','openai-compatible',%s,NULL,%s,%s)""",
                (user_id, file_id, version_id, uuid.uuid4(), model,
                 options.get("whiteBackgroundCompatibility") is True,
                 options.get("whiteBackgroundPages")),
            )
            canceled_job = cursor.fetchone()[0]
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                cursor.execute(
                    "SELECT state FROM public.scholar_translation_jobs WHERE id=%s",
                    (canceled_job,),
                )
                state = cursor.fetchone()[0]
                if state == "running":
                    break
                if state != "queued":
                    raise RuntimeError(f"unexpected state before cancellation: {state}")
                time.sleep(1)
            else:
                raise RuntimeError("worker did not claim cancellation probe")
            cursor.execute(
                "SELECT state FROM public.cancel_scholar_translation_job_v1(%s,%s)",
                (user_id, canceled_job),
            )
            assert cursor.fetchone()[0] == "running"
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                cursor.execute(
                    "SELECT state FROM public.scholar_translation_jobs WHERE id=%s",
                    (canceled_job,),
                )
                if cursor.fetchone()[0] == "canceled":
                    break
                time.sleep(1)
            else:
                raise RuntimeError("worker did not acknowledge cancellation")
            cursor.execute(
                "SELECT count(*) FROM public.scholar_translation_outputs WHERE job_id=%s",
                (canceled_job,),
            )
            assert cursor.fetchone()[0] == 0
            cursor.execute(
                "SELECT id FROM public.retry_scholar_translation_job_v3(%s,%s,%s)",
                (user_id, canceled_job, uuid.uuid4()),
            )
            retry_job = cursor.fetchone()[0]
            print(json.dumps({
                "canceledJobId": str(canceled_job),
                "retryJobId": str(retry_job),
                "canceledState": "canceled",
            }), flush=True)

def cleanup(job_id):
    s3 = _s3_client()
    with psycopg.connect(DB) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT j.user_id,j.source_file_id,df.document_id,v.object_key
                   FROM public.scholar_translation_jobs j
                   JOIN public.scholar_document_files df
                     ON df.user_id=j.user_id AND df.file_id=j.source_file_id
                   JOIN public.scholar_file_versions v
                     ON v.user_id=j.user_id AND v.file_id=j.source_file_id
                    AND v.version_id=j.source_version_id
                   WHERE j.id=%s""",
                (job_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise RuntimeError("probe job missing")
            user_id, file_id, doc_id, source_key = row
            cursor.execute(
                """SELECT DISTINCT o.file_id,o.object_key
                   FROM public.scholar_translation_outputs o
                   JOIN public.scholar_translation_jobs j
                     ON j.user_id=o.user_id AND j.id=o.job_id
                   WHERE j.user_id=%s AND j.source_file_id=%s""",
                (user_id, file_id),
            )
            derived = cursor.fetchall()
            cursor.execute(
                "DELETE FROM public.scholar_documents WHERE user_id=%s AND id=%s",
                (user_id, doc_id),
            )
            cursor.execute(
                "DELETE FROM public.files WHERE user_id=%s AND id = ANY(%s)",
                (user_id, [file_id, *[item[0] for item in derived]]),
            )
            connection.commit()
    for key in [source_key, *[item[1] for item in derived]]:
        s3.delete_object(Bucket=BUCKET, Key=key)
    print(json.dumps({"cleanedJobId": str(job_id), "objects": 1 + len(derived)}))


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "setup":
        setup()
    elif action == "inspect":
        inspect(uuid.UUID(sys.argv[2]))
    elif action == "repeat":
        repeat(uuid.UUID(sys.argv[2]))
    elif action == "progress":
        progress_probe(uuid.UUID(sys.argv[2]))
    elif action == "cancel-retry":
        cancel_retry(uuid.UUID(sys.argv[2]))
    elif action == "cleanup":
        cleanup(uuid.UUID(sys.argv[2]))
    else:
        raise SystemExit("expected setup, inspect, or cleanup")
