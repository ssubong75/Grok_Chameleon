import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "common/app/runtime/sync_state.py"
sys.path.insert(0, str(MODULE.parent))
spec = importlib.util.spec_from_file_location("sync_state", MODULE)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class SyncStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.a, self.b, self.usb = [self.root / name for name in ("a", "b", "usb")]
        self.control = self.root / "control"

    def state(self, root):
        db = root / "sql_data/state.sqlite3"
        with closing(sqlite3.connect(db)) as conn, conn:
            return s.read_rows(conn, "main")

    def put(self, root, state):
        db = root / "sql_data/state.sqlite3"
        db.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(db)) as conn, conn:
            s.replace_rows(conn, "main", state)

    def initial(self):
        return {"imagine_generated_relations": {"source": {"items": [{"id": "base"}]}},
                "imagine_local_exclusions": {'["account","asset"]': {"reason": "external_unsave"}}}

    def sync(self, local=None, **kwargs):
        local = local or self.a
        return s.synchronize(local, self.usb, self.control / (local.name + ".json"), self.control, **kwargs)

    def test_merge_delete_multicomputer_and_noop(self):
        self.put(self.a, self.initial())
        self.sync()
        self.sync(self.b)
        a = self.state(self.a)
        a["imagine_generated_relations"]["source"]["items"].append({"id": "a"})
        a["imagine_local_exclusions"] = {}
        self.put(self.a, a)
        usb = self.state(self.usb)
        usb["imagine_generated_relations"]["source"]["items"].append({"id": "usb"})
        self.put(self.usb, usb)
        self.sync()
        result = self.state(self.a)
        self.assertEqual(result, self.state(self.usb))
        self.assertEqual({v["id"] for v in result["imagine_generated_relations"]["source"]["items"]}, {"base", "a", "usb"})
        self.assertEqual(result["imagine_local_exclusions"], {})
        self.sync(self.b)
        self.assertEqual(self.state(self.b), result)
        self.assertEqual(self.sync()["changed"], 0)

    def test_scalar_archive_and_order_independence(self):
        a, b = self.initial(), self.initial()
        a["imagine_generated_relations"]["source"]["title"] = "a"
        b["imagine_generated_relations"]["source"]["title"] = "b"
        self.put(self.a, a)
        self.put(self.usb, b)
        self.sync()
        conflicts = list((self.control / "state-conflicts").glob("*.json"))
        self.assertEqual(len(conflicts), 1)
        record = json.loads(conflicts[0].read_text())
        self.assertEqual(record["local"], a)
        self.assertEqual(record["external"], b)
        self.assertEqual(s.merge({}, a, b, "", []), s.merge({}, b, a, "", []))

    def test_missing_or_cleared_database_preserves_surviving_rows(self):
        self.put(self.a, self.initial())
        self.sync()
        for side in [self.a, self.usb]:
            for missing in [True, False]:
                with self.subTest(side=side.name, missing=missing):
                    if missing:
                        (side / "sql_data/state.sqlite3").unlink()
                    else:
                        self.put(side, {table: {} for table in s.TABLES})
                    self.sync()
                    self.assertEqual(self.state(self.a), self.initial())
                    self.assertEqual(self.state(self.usb), self.initial())
                    self.assertEqual(self.sync()["changed"], 0)

    def test_file_initialization_preserves_rows_even_if_app_recreated_some_state(self):
        self.put(self.a, self.initial())
        self.sync()
        recreated = {"imagine_generated_relations": {"new-source": {"items": [{"id": "new"}]}},
                     "imagine_local_exclusions": {}}
        self.put(self.usb, recreated)
        self.sync(initialize=True)
        expected = self.initial()
        expected["imagine_generated_relations"].update(recreated["imagine_generated_relations"])
        self.assertEqual(self.state(self.a), expected)
        self.assertEqual(self.state(self.usb), expected)
        self.assertEqual(self.sync()["changed"], 0)

    def test_excluded_tables_remain_local(self):
        self.put(self.a, self.initial())
        with closing(sqlite3.connect(self.a / "sql_data/state.sqlite3")) as conn, conn:
            conn.execute("CREATE TABLE account_registry (secret TEXT)")
            conn.execute("INSERT INTO account_registry VALUES ('local only')")
        self.sync()
        with closing(sqlite3.connect(self.a / "sql_data/state.sqlite3")) as conn, conn:
            self.assertEqual(conn.execute("SELECT secret FROM account_registry").fetchone()[0], "local only")
        with closing(sqlite3.connect(self.usb / "sql_data/state.sqlite3")) as conn, conn:
            self.assertIsNone(conn.execute("SELECT name FROM sqlite_master WHERE name='account_registry'").fetchone())

    def test_failure_rolls_back_and_next_run_recovers(self):
        self.put(self.a, self.initial())
        self.sync()
        before = self.state(self.usb)
        newer = self.initial()
        newer["imagine_generated_relations"]["other"] = {"items": [{"id": "new"}]}
        self.put(self.a, newer)
        original = s.replace_rows
        def fail(conn, schema, state):
            if schema == "peer":
                raise RuntimeError("simulated failure")
            return original(conn, schema, state)
        with patch.object(s, "replace_rows", fail):
            with self.assertRaises(RuntimeError):
                self.sync()
        self.assertEqual(self.state(self.usb), before)
        self.assertEqual(self.state(self.a), newer)
        self.sync()
        self.assertEqual(self.state(self.usb), newer)

    def test_receipt_failure_after_commit_recovers(self):
        self.put(self.a, self.initial())
        original = s.atomic_json
        def fail(filename, value):
            if Path(filename).name == "a.json":
                raise OSError("simulated receipt failure")
            return original(filename, value)
        with patch.object(s, "atomic_json", fail):
            with self.assertRaises(OSError):
                self.sync()
        self.assertTrue((self.control / "a.pending.json").exists())
        self.sync()
        self.assertEqual(self.state(self.usb), self.initial())
        self.assertFalse((self.control / "a.pending.json").exists())

    def test_malformed_database_errors_instead_of_erasing(self):
        self.put(self.a, self.initial())
        self.sync()
        before = self.state(self.usb)
        with closing(sqlite3.connect(self.a / "sql_data/state.sqlite3")) as conn, conn:
            conn.execute("UPDATE imagine_generated_relations SET relation_json='bad json'")
        with self.assertRaises(ValueError):
            self.sync()
        self.assertEqual(self.state(self.usb), before)

if __name__ == "__main__":
    unittest.main()
