"""Synchronize only durable Imagine rows; called after the app server stops."""
import json
import os
import sqlite3
import sys
import time
import uuid
from pathlib import Path

# The packaged Windows Python runs in isolated mode, so it does not automatically add the
# script directory to sys.path. Keep this helper able to import its sibling runtime module.
RUNTIME_DIRECTORY = str(Path(__file__).resolve().parent)
if RUNTIME_DIRECTORY not in sys.path:
    sys.path.insert(0, RUNTIME_DIRECTORY)

import imagine_state

TABLES = {
    "imagine_generated_relations": (
        "source_id TEXT PRIMARY KEY, relation_json TEXT NOT NULL, updated_at REAL NOT NULL",
        ("source_id", "relation_json", "updated_at")),
    "imagine_local_exclusions": (
        "account_key TEXT NOT NULL, asset_id TEXT NOT NULL, reason TEXT NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(account_key, asset_id)",
        ("account_key", "asset_id", "reason", "created_at")),
}
MISSING = object()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def atomic_json(filename, value):
    filename = Path(filename)
    filename.parent.mkdir(parents=True, exist_ok=True)
    temporary = filename.with_name(filename.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, filename)
    finally:
        temporary.unlink(missing_ok=True)

def equal(a, b):
    if a is MISSING or b is MISSING:
        return a is b
    return canonical(a) == canonical(b)

def merge(base, a, b, location, conflicts):
    if equal(a, b):
        return a
    if equal(a, base):
        return b
    if equal(b, base):
        return a
    if a is MISSING or b is MISSING:
        # A simultaneous edit survives deletion; untouched deletions took the branches above.
        return b if a is MISSING else a
    if isinstance(a, dict) and isinstance(b, dict):
        old = base if isinstance(base, dict) else {}
        result = {}
        for key in sorted(set(old) | set(a) | set(b)):
            value = merge(old.get(key, MISSING), a.get(key, MISSING),
                          b.get(key, MISSING), location + "/" + key, conflicts)
            if value is not MISSING:
                result[key] = value
        return result
    if isinstance(a, list) and isinstance(b, list):
        def keyed(values):
            result = {}
            for value in values:
                identity = next((str(value[k]) for k in ("item_id", "id", "url", "remote_url", "asset_id", "file")
                                 if isinstance(value, dict) and value.get(k)), None)
                key = "id:" + identity if identity else "value:" + canonical(value)
                if key in result and not equal(result[key], value):
                    raise ValueError("Duplicate array identity at " + location)
                result[key] = value
            return result
        old = keyed(base) if isinstance(base, list) else {}
        joined = merge(old, keyed(a), keyed(b), location, conflicts)
        return [joined[key] for key in sorted(joined)]
    # Scalar fields cannot represent two values. Preserve both permanently, and choose by
    # canonical content so swapping the initiating computer never changes the outcome.
    conflicts.append({"path": location, "values": sorted([a, b], key=canonical)})
    return min([a, b], key=canonical)

def read_rows(connection, schema):
    result = {}
    metadata = connection.execute(
        f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name='state_metadata'").fetchone()
    if metadata:
        version = connection.execute(f"SELECT value FROM {schema}.state_metadata WHERE key='schema_version'").fetchone()
        if version and int(version[0]) > imagine_state.SCHEMA_VERSION:
            raise ValueError("SQLite schema is newer than this app")
    for table, (_, fields) in TABLES.items():
        exists = connection.execute(
            f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        rows = connection.execute(f"SELECT {','.join(fields)} FROM {schema}.{table}").fetchall() if exists else []
        records = {}
        for row in rows:
            record = dict(zip(fields, row))
            if table == "imagine_generated_relations":
                value = json.loads(record["relation_json"])
                if not isinstance(value, dict):
                    raise ValueError("Invalid relation object")
                key = record["source_id"]
            else:
                value = {"reason": record["reason"]}
                key = canonical([record["account_key"], record["asset_id"]])
            records[key] = value
        result[table] = records
    return result

def replace_rows(connection, schema, state):
    for table, (definition, fields) in TABLES.items():
        connection.execute(f"CREATE TABLE IF NOT EXISTS {schema}.{table} ({definition})")
        existing = read_rows(connection, schema)[table]
        target = state.get(table, {})
        for key in set(existing) - set(target):
            if table == "imagine_generated_relations":
                connection.execute(f"DELETE FROM {schema}.{table} WHERE source_id=?", (key,))
            else:
                connection.execute(f"DELETE FROM {schema}.{table} WHERE account_key=? AND asset_id=?", json.loads(key))
        for key, value in target.items():
            if key in existing and equal(existing[key], value):
                continue
            if table == "imagine_generated_relations":
                args = (key, canonical(value), time.time())
                suffix = "source_id) DO UPDATE SET relation_json=excluded.relation_json, updated_at=excluded.updated_at"
            else:
                args = (*json.loads(key), value["reason"], time.time())
                suffix = "account_key,asset_id) DO UPDATE SET reason=excluded.reason, created_at=excluded.created_at"
            connection.execute(
                f"INSERT INTO {schema}.{table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)}) ON CONFLICT({suffix}", args)

def advance_generation(connection, schema, root):
    connection.execute(f"CREATE TABLE IF NOT EXISTS {schema}.state_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    identity = imagine_state.library_id(root)
    existing = connection.execute(f"SELECT value FROM {schema}.state_metadata WHERE key='library_id'").fetchone()
    if existing and existing[0] != identity:
        raise ValueError("SQLite library identity mismatch")
    for key, value in (("library_id", identity), ("schema_version", str(imagine_state.SCHEMA_VERSION))):
        connection.execute(f"INSERT OR IGNORE INTO {schema}.state_metadata VALUES (?,?)", (key, value))
    connection.execute(f"INSERT INTO {schema}.state_metadata VALUES ('generation','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)")

def publish_snapshot(root, db):
    # Match the app backup format without invoking its unrelated legacy-storage cleanup.
    snapshot = imagine_state._consistent_database_copy(db)
    try:
        metadata = imagine_state._read_database_metadata(snapshot)
        backup, manifest = imagine_state._snapshot_paths(root)
        imagine_state._atomic_copy(snapshot, backup)
        atomic_json(manifest, {
            "version": 2, "schema_version": int(metadata["schema_version"]),
            "library_id": imagine_state.library_id(root),
            "generation": int(metadata["generation"]),
            "sha256": imagine_state._sha256_file(snapshot), "updated_at": time.time(),
        })
    finally:
        snapshot.unlink(missing_ok=True)

def synchronize(local, external, baseline_path, control):
    local, external = Path(local).resolve(), Path(external).resolve()
    if local == external:
        raise ValueError("Same database roots")
    baseline_path, control = Path(baseline_path), Path(control)
    pending = baseline_path.with_suffix(".pending.json")
    paths = [root / "sql_data" / "state.sqlite3" for root in (local, external)]
    for db in paths:
        db.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(paths[0], timeout=30, isolation_level=None)
    try:
        connection.execute("ATTACH DATABASE ? AS peer", (str(paths[1]),))
        if pending.exists():
            recovery = json.loads(pending.read_text(encoding="utf-8"))
            if recovery["roots"] != [str(local), str(external)]:
                raise ValueError("Pending SQLite recovery belongs to different roots")
            connection.execute("BEGIN IMMEDIATE")
            try:
                replace_rows(connection, "main", recovery["local"])
                replace_rows(connection, "peer", recovery["external"])
                advance_generation(connection, "main", local)
                advance_generation(connection, "peer", external)
                connection.execute("COMMIT")
                atomic_json(baseline_path, recovery["baseline"])
                pending.unlink()
            except BaseException:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        connection.execute("BEGIN IMMEDIATE")
        before_local = read_rows(connection, "main")
        before_external = read_rows(connection, "peer")
        baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else {}
        conflicts = []
        result = merge(baseline, before_local, before_external, "", conflicts)
        changed = sum(not equal(before_local[t].get(k, MISSING), result[t].get(k, MISSING))
                      or not equal(before_external[t].get(k, MISSING), result[t].get(k, MISSING))
                      for t in TABLES for k in set(before_local[t]) | set(before_external[t]) | set(result[t]))
        atomic_json(pending, {"roots": [str(local), str(external)], "local": before_local,
                             "external": before_external, "baseline": baseline})
        if conflicts:
            atomic_json(control / "state-conflicts" / (uuid.uuid4().hex + ".json"),
                        {"local": before_local, "external": before_external, "conflicts": conflicts})
        replace_rows(connection, "main", result)
        replace_rows(connection, "peer", result)
        if changed or not baseline:
            advance_generation(connection, "main", local)
            advance_generation(connection, "peer", external)
        if read_rows(connection, "main") != result or read_rows(connection, "peer") != result:
            raise ValueError("SQLite verification failed")
        connection.execute("COMMIT")
        # Publish fresh backups through the application's own snapshot format. Otherwise
        # a subsequent app launch could recover an old backup over newly synced rows.
        if changed or not baseline:
            for root, db in zip((local, external), paths):
                publish_snapshot(root, db)
        atomic_json(baseline_path, result)
        pending.unlink()
        return {"changed": changed, "conflicts_preserved": len(conflicts)}
    except BaseException:
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()

if __name__ == "__main__":
    print(canonical(synchronize(*sys.argv[1:5])))
