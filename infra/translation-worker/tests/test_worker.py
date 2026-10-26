import hashlib
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from io import BytesIO
from pathlib import Path

from worker import JobFailure, build_cli_command, child_environment, engine_progress, find_output, output_key, prepare_asset_links, process_job, run_engine, verify_glossary_text, verify_source_bytes


class WorkerContractTests(unittest.TestCase):
    def test_cli_uses_local_engine_with_conservative_limits_and_no_secret_argument(self):
        args = build_cli_command(Path("/tmp/source.pdf"), Path("/tmp/out"), "dual")
        self.assertIn("--openaicompatible", args)
        self.assertIn("--no-mono", args)
        self.assertIn("--qps", args)
        self.assertIn("--no-auto-extract-glossary", args)
        self.assertEqual(args[args.index("--qps") + 1], "1")
        self.assertNotIn("--openai-compatible-api-key", args)
        self.assertNotIn("--openai-compatible-base-url", args)

    def test_sealed_worker_environment_is_not_readable_by_same_uid_child(self):
        probe = (
            "import os,time; "
            "from worker import seal_process_credentials; "
            "os.environ['S3_SECRET_ACCESS_KEY']='synthetic-secret'; "
            "seal_process_credentials(); print(os.getpid(),flush=True); time.sleep(10)"
        )
        child = subprocess.Popen(
            [sys.executable, "-c", probe],
            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            assert child.stdout is not None
            pid = int(child.stdout.readline().strip())
            with self.assertRaises(PermissionError):
                Path(f"/proc/{pid}/environ").read_bytes()
        finally:
            child.terminate()
            child.communicate(timeout=5)

    def test_glossary_hash_and_columns_are_verified_before_engine(self):
        csv = "source,target,tgt_lng\nBERT,双向编码器,zh-CN\n"
        digest = hashlib.sha256(csv.encode()).hexdigest()
        verify_glossary_text(csv, digest)
        args = build_cli_command(
            Path("/tmp/source.pdf"), Path("/tmp/out"), "dual", Path("/tmp/glossary.csv")
        )
        self.assertEqual(args[args.index("--glossaries") + 1], "/tmp/glossary.csv")
        with self.assertRaises(JobFailure):
            verify_glossary_text(csv, "0" * 64)
        with self.assertRaises(JobFailure):
            verify_glossary_text("source,target\nBERT,foo\n", digest)

    def test_cli_progress_is_bounded_before_output_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "engine.log"
            self.assertEqual(engine_progress(log), 20)
            log.write_bytes(b"translate:  50%|#####| 5/10\r")
            self.assertEqual(engine_progress(log), 48)
            log.write_bytes(log.read_bytes() + b"save: 100%|##########| 10/10\r")
            self.assertEqual(engine_progress(log), 75)
            log.write_bytes(b"@@SCHOLAR_PROGRESS:33\n")
            self.assertEqual(engine_progress(log), 38)
            log.write_bytes(log.read_bytes() + b"@@SCHOLAR_PROGRESS:100\n")
            self.assertEqual(engine_progress(log), 75)

    def test_finds_only_one_translation_output_under_own_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            derived = output / "source.zh-CN.dual.pdf"
            derived.write_bytes(b"%PDF-1.7\ntranslated")
            self.assertEqual(find_output(output, "dual"), derived)
            (output / "source-dual.pdf").write_bytes(b"%PDF-1.7\nother")
            with self.assertRaises(JobFailure):
                find_output(output, "dual")

    def test_account_cache_uses_only_read_only_shared_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root / "assets" / ".cache" / "babeldoc"
            for name in ("fonts", "cmap", "models", "tiktoken"):
                (assets / name).mkdir(parents=True)
            account = root / "cache" / "account" / "request"
            prepare_asset_links(account, root / "assets")
            for name in ("fonts", "cmap", "models", "tiktoken"):
                self.assertEqual((account / ".cache" / "babeldoc" / name).resolve(), assets / name)
            prepare_asset_links(account, root / "assets")
            (account / ".cache" / "babeldoc" / "models").unlink()
            (account / ".cache" / "babeldoc" / "models").symlink_to(root)
            with self.assertRaises(JobFailure):
                prepare_asset_links(account, root / "assets")

    def test_database_error_terminates_translation_child(self):
        class FailingDb:
            def canceled(self, _job):
                raise RuntimeError("database unavailable")

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output_dir = root / "output"
            output_dir.mkdir()
            with patch(
                "worker.build_cli_command",
                return_value=[sys.executable, "-c", "import time; time.sleep(30)"],
            ), patch("worker._terminate_process", wraps=__import__("worker")._terminate_process) as terminate:
                with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                    run_engine(
                        {"mode": "dual", "model": "local-model"},
                        root / "source.pdf", output_dir, FailingDb(),
                        "http://model.internal:3168/v1", "synthetic-key",
                        str(root / "cache"), 60,
                    )
                self.assertEqual(terminate.call_count, 1)

    def test_derived_key_stays_beneath_account_and_job(self):
        account = "00000000-0000-4000-8000-000000000001"
        job = "00000000-0000-4000-8000-000000000002"
        self.assertEqual(
            output_key(account, job, "dual"),
            f"{account}/Scholar/translations/{job}/dual.pdf",
        )
        with self.assertRaises(ValueError):
            output_key(account, job, "../source")

    def test_engine_child_does_not_receive_database_or_object_store_credentials(self):
        env = child_environment(
            "http://model.internal:3168/v1", "local-model", "synthetic-key", "/cache"
        )
        self.assertEqual(env["PDF2ZH_OPENAI_COMPATIBLE_API_KEY"], "synthetic-key")
        self.assertNotIn("DATABASE_URL", env)
        self.assertNotIn("S3_SECRET_ACCESS_KEY", env)
        self.assertNotIn("POSTGRES_PASSWORD", env)

    def test_cancel_stops_the_isolated_engine_process(self):
        class FakeDb:
            def canceled(self, _job):
                return True

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output_dir = root / "output"
            output_dir.mkdir()
            with patch(
                "worker.build_cli_command",
                return_value=[sys.executable, "-c", "import time; time.sleep(30)"],
            ):
                started = time.monotonic()
                with self.assertRaisesRegex(JobFailure, "canceled"):
                    run_engine(
                        {"mode": "dual", "model": "local-model"},
                        root / "source.pdf", output_dir, FakeDb(),
                        "http://model.internal:3168/v1", "synthetic-key",
                        str(root / "cache"), 60,
                    )
                self.assertLess(time.monotonic() - started, 8)

    def test_wrong_source_hash_never_runs_engine_or_uploads(self):
        account = "00000000-0000-4000-8000-000000000001"
        job = "00000000-0000-4000-8000-000000000002"
        content = b"%PDF-1.7\nprivate paper"

        class FakeDb:
            finished = None

            def source(self, _job):
                return {
                    "object_key": f"{account}/Scholar/versions/original.pdf",
                    "sha256": "a" * 64,
                    "file_size": len(content),
                }

            def canceled(self, _job):
                return False

            def finish(self, _job, state, error=None):
                self.finished = (state, error)
                return True

        class FakeS3:
            puts = 0

            def get_object(self, **_kwargs):
                return {"Body": BytesIO(content)}

            def put_object(self, **_kwargs):
                self.puts += 1

        db = FakeDb()
        s3 = FakeS3()
        result = process_job(
            {"id": job, "user_id": account, "source_sha256": "a" * 64,
             "source_size": len(content), "mode": "dual", "model": "local-model", "glossary_sha256": None},
            db, s3, bucket="books", base_url="http://model.internal:3168/v1",
            api_key="synthetic-key", cache_dir="/cache", timeout_seconds=60,
        )
        self.assertEqual(result, "source_integrity_failed")
        self.assertEqual(db.finished, ("failed", "source_integrity_failed"))
        self.assertEqual(s3.puts, 0)

    def test_failed_publication_removes_only_new_derived_object(self):
        account = "00000000-0000-4000-8000-000000000001"
        job_id = "00000000-0000-4000-8000-000000000002"
        content = b"%PDF-1.7\nsource"
        source_hash = hashlib.sha256(content).hexdigest()
        translated = b"%PDF-1.7\ntranslated"

        class FakeDb:
            finished = None

            def source(self, _job):
                return {"object_key": f"{account}/Scholar/versions/source.pdf"}

            def renew(self, _job, _progress):
                return True

            def canceled(self, _job):
                return False

            def publish(self, _job, _outputs, _version):
                return False

            def succeeded(self, _job):
                return False

            def finish(self, _job, state, error=None):
                self.finished = (state, error)
                return True

        class FakeS3:
            objects = {}
            deleted = []

            def get_object(self, *, Bucket, Key):
                if Key.endswith("/source.pdf"):
                    return {"Body": BytesIO(content)}
                return {"Body": BytesIO(self.objects[Key])}

            def put_object(self, *, Bucket, Key, Body, **_kwargs):
                self.objects[Key] = Body

            def delete_object(self, *, Bucket, Key):
                self.deleted.append(Key)
                self.objects.pop(Key, None)

        def fake_engine(_job, _source, output_dir, *_args):
            (output_dir / "source-dual.pdf").write_bytes(translated)

        db, s3 = FakeDb(), FakeS3()
        with tempfile.TemporaryDirectory() as cache, patch(
            "worker.prepare_asset_links"
        ), patch("worker.pdf_page_count", return_value=1), patch(
            "worker.run_engine", side_effect=fake_engine
        ):
            result = process_job(
                {"id": job_id, "user_id": account, "source_sha256": source_hash,
                 "source_size": len(content), "mode": "dual", "model": "local-model", "glossary_sha256": None},
                db, s3, bucket="books", base_url="http://model.internal:3168/v1",
                api_key="synthetic-key", cache_dir=cache, timeout_seconds=60,
            )
            self.assertEqual(list(Path(cache).iterdir()), [])
        self.assertEqual(result, "publish_rejected")
        self.assertEqual(db.finished, ("failed", "publish_rejected"))
        self.assertEqual(s3.deleted, [f"{account}/Scholar/translations/{job_id}/dual.pdf"])
        self.assertEqual(s3.objects, {})

    def test_lost_publish_reply_preserves_committed_output(self):
        account = "00000000-0000-4000-8000-000000000001"
        job_id = "00000000-0000-4000-8000-000000000002"
        content = b"%PDF-1.7\nsource"
        source_hash = hashlib.sha256(content).hexdigest()
        translated = b"%PDF-1.7\ntranslated"

        class FakeDb:
            def source(self, _job):
                return {"object_key": f"{account}/Scholar/versions/source.pdf"}

            def renew(self, _job, _progress):
                return True

            def canceled(self, _job):
                return False

            def publish(self, _job, _outputs, _version):
                raise ConnectionError("commit acknowledgement lost")

            def succeeded(self, _job):
                return True

            def finish(self, _job, _state, _error=None):
                raise AssertionError("committed job must not be failed")

        class FakeS3:
            def __init__(self):
                self.objects = {}
                self.deleted = []

            def get_object(self, *, Bucket, Key):
                if Key.endswith("/source.pdf"):
                    return {"Body": BytesIO(content)}
                return {"Body": BytesIO(self.objects[Key])}

            def put_object(self, *, Bucket, Key, Body, **_kwargs):
                self.objects[Key] = Body

            def delete_object(self, *, Bucket, Key):
                self.deleted.append(Key)

        def fake_engine(_job, _source, output_dir, *_args):
            (output_dir / "source-dual.pdf").write_bytes(translated)

        s3 = FakeS3()
        with tempfile.TemporaryDirectory() as cache, patch(
            "worker.prepare_asset_links"
        ), patch("worker.pdf_page_count", return_value=1), patch(
            "worker.run_engine", side_effect=fake_engine
        ):
            result = process_job(
                {"id": job_id, "user_id": account, "source_sha256": source_hash,
                 "source_size": len(content), "mode": "dual", "model": "local-model", "glossary_sha256": None},
                FakeDb(), s3, bucket="books", base_url="http://model.internal:3168/v1",
                api_key="synthetic-key", cache_dir=cache, timeout_seconds=60,
            )
        self.assertEqual(result, "succeeded")
        self.assertEqual(s3.deleted, [])
        self.assertIn(f"{account}/Scholar/translations/{job_id}/dual.pdf", s3.objects)

    def test_source_hash_is_checked_before_translation(self):
        content = b"%PDF-1.7\nprivate paper"
        digest = hashlib.sha256(content).hexdigest()
        verify_source_bytes(content, digest, len(content))
        with self.assertRaises(ValueError):
            verify_source_bytes(content, "0" * 64, len(content))


if __name__ == "__main__":
    unittest.main()
