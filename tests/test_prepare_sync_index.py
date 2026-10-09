"""Offline regression checks. All library/runtime writes stay in a temporary folder."""
import json
from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

RUNTIME = Path(sys.argv.pop(1)).resolve() / "runtime"
sys.path.insert(0, str(RUNTIME))


class SyncIndexTest(unittest.TestCase):
    def test_round_trip_and_deletion(self):
        with tempfile.TemporaryDirectory(prefix="grok-sync-index-test-") as temporary:
            base = Path(temporary)
            env = {
                **os.environ,
                "GROK_CHAMELEON_RUNTIME_DIR": str(base / "runtime"),
                "GROK_CHAMELEON_PORTABLE_ROOT": str(base),
                "GROK_CHAMELEON_LIBRARY_POINTER_PATH": str(base / ".library_path.json"),
                "GROK_CHAMELEON_PLATFORM_KEY": "macos",
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            left, right = base / "mac", base / "usb"
            for root in (left, right):
                root.mkdir()
                (root / "library.json").write_text('{"version":1}', encoding="utf-8")
                for area in ("created", "upload", "reference", "collection/한글"):
                    folder = root / area / "card"
                    folder.mkdir(parents=True)
                    (folder / "sample.jpg").write_bytes(b"test-media")
                    (folder / "post.json").write_text(
                        json.dumps({"title": "initial", "source": "build"}), encoding="utf-8")

            def prepare(platform):
                result = subprocess.run(
                    [sys.executable, "-B", str(RUNTIME / "prepare_sync_index.py"), str(left), str(right)],
                    env={**env, "GROK_CHAMELEON_PLATFORM_KEY": platform},
                    capture_output=True, text=True, check=True,
                )
                self.assertEqual(json.loads(result.stdout)["prepared"], 2)

            original = (left / "library.json").read_bytes()
            prepare("macos")
            import library_index
            self.assertTrue(library_index.ready(right))
            self.assertEqual(len(library_index.all_posts(right)), 4)
            for root in (left, right):
                with closing(sqlite3.connect(root / "sql_data/library_index.sqlite3")) as db, db:
                    db.execute("INSERT INTO imagine_discover_posts(account_key, post_key, position, post_json, refreshed_at) VALUES ('test', 'keep', 0, '{}', 1)")
                shutil.rmtree(root / "created/card")
                (root / "reference/card/post.json").write_text('{"title":"updated"}', encoding="utf-8")
                (root / "sql_data/.library-index-rebuild.json").write_text('{}', encoding="utf-8")
            prepare("windows")
            for root in (left, right):
                self.assertTrue(library_index.ready(root))
                posts = library_index.all_posts(root)
                self.assertEqual(len(posts), 3)
                self.assertFalse(any(p["folder_path"].startswith("created/") for p in posts))
                self.assertEqual(next(p for p in posts if p["area"] == "reference")["title"], "updated")
                self.assertTrue(all(str(root) not in p["items"][0]["object_url"] for p in posts))
                with closing(sqlite3.connect(root / "sql_data/library_index.sqlite3")) as db:
                    self.assertEqual(db.execute("SELECT post_key FROM imagine_discover_posts").fetchall(), [("keep",)])
                self.assertEqual((root / "library.json").read_bytes(), original)
            # Opening a prepared library on the other platform must not scan its cards.
            check = (
                "import sys; sys.path.insert(0, sys.argv[1]); import server; from pathlib import Path; "
                "server.scan_library=lambda *a, **k: (_ for _ in ()).throw(AssertionError('unexpected scan')); "
                "snapshot=server.startup_library_snapshot(Path(sys.argv[2])); "
                "assert snapshot['library_index']['enabled']; assert snapshot['scan_pending'] is False"
            )
            subprocess.run([sys.executable, "-B", "-c", check, str(RUNTIME), str(right)],
                           env={**env, "GROK_CHAMELEON_PLATFORM_KEY": "windows"}, check=True)
            # A missing source folder cannot silently produce a valid empty index.
            result = subprocess.run([sys.executable, "-B", str(RUNTIME / "prepare_sync_index.py"), str(base / "missing")],
                                    env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
