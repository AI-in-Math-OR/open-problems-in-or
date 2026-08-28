"""Local tests for the Clear-list (archive) endpoint (no Railway / httpx required)."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path


def _minimal_pdf_bytes() -> bytes:
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


class ArchiveUploadsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmpdir = tempfile.TemporaryDirectory()
        root = Path(cls._tmpdir.name)
        os.environ["DATA_DIR"] = str(root / "data")
        os.environ["UPLOAD_DIR"] = str(root / "data" / "uploads")
        os.environ["SESSION_SECRET"] = "test-session-secret-for-archive"
        os.environ["UPLOAD_SEED_USERNAME"] = "pete"
        os.environ["UPLOAD_SEED_PASSWORD"] = "westbrook"
        os.environ["WORKER_API_TOKEN"] = "test-worker-token"
        os.environ["CORS_ORIGINS"] = "http://test"
        os.environ["HOST"] = "127.0.0.1"
        os.environ["RELOAD"] = "0"

        from importlib import reload

        from app import auth
        from app import config
        from app import db as db_mod
        from app import main

        reload(config)
        reload(db_mod)
        reload(auth)
        reload(main)

        cls.db_mod = db_mod
        cls.auth = auth
        cls.main = main
        cls.db_mod.init_db()
        cls.auth.seed_admin_user_if_needed()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmpdir.cleanup()

    def _user(self):
        user = self.db_mod.get_user_by_username("pete")
        assert user is not None
        return dict(user)

    def _insert(self, *, kind: str = "source", parent_upload_id=None):
        user = self._user()
        row = self.db_mod.insert_upload(
            user_id=int(user["id"]),
            filename=f"{kind}.pdf",
            stored_name=f"{os.urandom(4).hex()}_{kind}.pdf",
            content_type="application/pdf",
            size_bytes=12,
            sha256="a" * 64,
            kind=kind,
            parent_upload_id=parent_upload_id,
        )
        Path(self.db_mod.storage_path(row["stored_name"])).write_bytes(_minimal_pdf_bytes())
        return row

    def _listed_ids(self):
        user = self._user()
        return {int(i["id"]) for i in self.db_mod.list_uploads_for_user(int(user["id"]), limit=50)}

    def test_archive_sources_hides_idle_keeps_active(self) -> None:
        idle = self._insert(kind="source")
        active = self._insert(kind="source")
        self.db_mod.create_job(upload_id=int(active["id"]), kind="pipeline")
        claimed = self.db_mod.claim_next_job(kind="pipeline")
        assert claimed is not None and int(claimed["upload_id"]) == int(active["id"])

        body = self.main.archive_uploads(
            body=self.main.ArchiveUploadsRequest(scope="sources"),
            user=self._user(),
        )
        self.assertEqual(body["scope"], "sources")
        self.assertGreaterEqual(body["archived"], 1)
        self.assertEqual(body["skipped_active"], 1)

        listed = self._listed_ids()
        self.assertNotIn(int(idle["id"]), listed)
        self.assertIn(int(active["id"]), listed)

        # File still on disk (archive is not delete).
        self.assertTrue(Path(self.db_mod.storage_path(idle["stored_name"])).is_file())

    def test_archive_results_hides_outputs_not_sources(self) -> None:
        src = self._insert(kind="source")
        art = self._insert(kind="extraction", parent_upload_id=int(src["id"]))

        body = self.main.archive_uploads(
            body=self.main.ArchiveUploadsRequest(scope="results"),
            user=self._user(),
        )
        self.assertEqual(body["scope"], "results")
        self.assertGreaterEqual(body["archived"], 1)

        listed = self._listed_ids()
        self.assertNotIn(int(art["id"]), listed)
        self.assertIn(int(src["id"]), listed)

    def test_job_on_archived_source_unarchives_it(self) -> None:
        src = self._insert(kind="source")
        self.main.archive_uploads(
            body=self.main.ArchiveUploadsRequest(scope="sources"),
            user=self._user(),
        )
        self.assertNotIn(int(src["id"]), self._listed_ids())

        # Queue a job from a "stale tab": the source must resurface.
        self.main.create_upload_job(
            upload_id=int(src["id"]),
            body=self.main.CreateJobRequest(kind="extract"),
            user=self._user(),
        )
        self.assertIn(int(src["id"]), self._listed_ids())

    def test_archive_results_keeps_active_run_outputs(self) -> None:
        src = self._insert(kind="source")
        job = self.db_mod.create_job(upload_id=int(src["id"]), kind="pipeline")
        claimed = self.db_mod.claim_next_job(kind="pipeline")
        assert claimed is not None
        art = self._insert(kind="extraction", parent_upload_id=int(src["id"]))
        self.db_mod.add_job_artifact(
            job_id=int(job["id"]), upload_id=int(art["id"]), artifact_kind="extraction"
        )

        body = self.main.archive_uploads(
            body=self.main.ArchiveUploadsRequest(scope="results"),
            user=self._user(),
        )
        self.assertGreaterEqual(body["skipped_active"], 1)
        self.assertIn(int(art["id"]), self._listed_ids())

        # Once the job finishes, the same clear archives it.
        self.db_mod.mark_job_done(job_id=int(job["id"]), result_upload_id=int(art["id"]))
        self.main.archive_uploads(
            body=self.main.ArchiveUploadsRequest(scope="results"),
            user=self._user(),
        )
        self.assertNotIn(int(art["id"]), self._listed_ids())

    def test_bad_scope_rejected(self) -> None:
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            self.main.archive_uploads(
                body=self.main.ArchiveUploadsRequest(scope="everything"),
                user=self._user(),
            )
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
