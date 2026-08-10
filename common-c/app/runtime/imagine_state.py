from __future__ import annotations

import json
import hashlib
import os
import shutil
import sqlite3
import sys
import threading
import time
import unicodedata
import uuid
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 4
STATE_DIRECTORY = "sql_data"
DATABASE_FILENAME = "state.sqlite3"
BACKUP_FILENAME = "state.backup.sqlite3"
BACKUP_MANIFEST_FILENAME = "state.backup.json"
LEGACY_STATE_DIRECTORY = ".grok"
LEGACY_SNAPSHOT_FILENAME = "state.snapshot.sqlite3"
LEGACY_SNAPSHOT_MANIFEST_FILENAME = "state.snapshot.json"
_SCHEMA_LOCK = threading.Lock()
_INITIALIZED_DATABASES: set[str] = set()
_LIBRARY_LOCKS_LOCK = threading.Lock()
_LIBRARY_LOCKS: dict[str, threading.RLock] = {}
_PREPARED_LIBRARIES: set[str] = set()
_LAST_SYNC_ERRORS: dict[str, str] = {}


def _normalized_text(value) -> str:
    return unicodedata.normalize("NFC", str(value or "").strip())


def _library_json(root: Path) -> dict:
    try:
        data = json.loads((Path(root) / "library.json").read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def library_id(root: Path) -> str:
    data = _library_json(root)
    explicit = _normalized_text(data.get("library_id"))
    if explicit:
        return explicit
    seed = "|".join((
        _normalized_text(data.get("created_at")),
        _normalized_text(data.get("version")),
        _normalized_text(Path(root).name),
    ))
    if not seed.replace("|", ""):
        seed = _normalized_text(Path(root).name) or "grok-library"
    return "library_" + uuid.uuid5(uuid.NAMESPACE_URL, f"grok-chameleon:{seed}").hex


def _platform_state_root() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Grok Chameleon" / "libraries"
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if base:
            return Path(base) / "Grok Chameleon" / "libraries"
        return Path.home() / "AppData" / "Local" / "Grok Chameleon" / "libraries"
    base = os.environ.get("XDG_STATE_HOME")
    return (Path(base) if base else Path.home() / ".local" / "state") / "grok-chameleon" / "libraries"


def working_database_path(root: Path) -> Path:
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _snapshot_paths(root: Path) -> tuple[Path, Path]:
    state_directory = Path(root) / STATE_DIRECTORY
    return (
        state_directory / BACKUP_FILENAME,
        state_directory / BACKUP_MANIFEST_FILENAME,
    )


def _legacy_local_database_path(root: Path) -> Path:
    return _platform_state_root() / library_id(root) / DATABASE_FILENAME


def _legacy_snapshot_paths(root: Path) -> tuple[Path, Path]:
    state_directory = Path(root) / LEGACY_STATE_DIRECTORY
    return (
        state_directory / LEGACY_SNAPSHOT_FILENAME,
        state_directory / LEGACY_SNAPSHOT_MANIFEST_FILENAME,
    )


def _legacy_external_database_path(root: Path) -> Path:
    return Path(root) / LEGACY_STATE_DIRECTORY / DATABASE_FILENAME


def _library_lock(root: Path) -> threading.RLock:
    key = library_id(root)
    with _LIBRARY_LOCKS_LOCK:
        lock = _LIBRARY_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _LIBRARY_LOCKS[key] = lock
        return lock


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_manifest_path(manifest_path: Path) -> dict:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return {}
    return manifest if isinstance(manifest, dict) else {}


def _read_manifest(root: Path) -> dict:
    _, manifest_path = _snapshot_paths(root)
    return _read_manifest_path(manifest_path)


def _read_database_metadata(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    try:
        uri = path.resolve().as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            rows = connection.execute("SELECT key, value FROM state_metadata").fetchall()
        finally:
            connection.close()
    except sqlite3.Error:
        return {}
    return {str(key): str(value) for key, value in rows}


def _atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(
        f".{destination.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    try:
        with source.open("rb") as input_file, temp_path.open("wb") as output_file:
            shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
            output_file.flush()
            os.fsync(output_file.fileno())
        os.replace(temp_path, destination)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    try:
        with temp_path.open("w", encoding="utf-8", newline="\n") as output_file:
            json.dump(data, output_file, ensure_ascii=False, indent=2)
            output_file.write("\n")
            output_file.flush()
            os.fsync(output_file.fileno())
        os.replace(temp_path, path)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _consistent_database_copy(database_path: Path) -> Path:
    snapshot_path = database_path.with_name(
        f".{database_path.name}.{os.getpid()}.{threading.get_ident()}.snapshot"
    )
    snapshot_path.unlink(missing_ok=True)
    source = sqlite3.connect(database_path, timeout=10)
    destination = sqlite3.connect(snapshot_path, timeout=10)
    try:
        source.execute("PRAGMA busy_timeout = 10000")
        source.backup(destination)
        destination.execute("PRAGMA journal_mode = DELETE")
        destination.commit()
    finally:
        destination.close()
        source.close()
    return snapshot_path


def _validated_snapshot_generation(
    root: Path,
    snapshot_path: Path,
    manifest_path: Path,
) -> int:
    identity = library_id(root)
    manifest = _read_manifest_path(manifest_path)
    if not (
        snapshot_path.is_file()
        and manifest.get("library_id") == identity
        and str(manifest.get("sha256") or "")
    ):
        return -1
    try:
        if _sha256_file(snapshot_path) != str(manifest.get("sha256")):
            return -1
    except OSError:
        return -1
    metadata = _read_database_metadata(snapshot_path)
    generation = int(metadata.get("generation") or -1)
    if (
        metadata.get("library_id") != identity
        or generation != int(manifest.get("generation") or -2)
    ):
        return -1
    return generation


def _database_generation(root: Path, path: Path) -> int:
    metadata = _read_database_metadata(path)
    if metadata.get("library_id") != library_id(root):
        return -1
    return int(metadata.get("generation") or -1)


def _database_sidecars(path: Path) -> tuple[Path, Path, Path]:
    return tuple(
        path.with_name(path.name + suffix)
        for suffix in ("-journal", "-wal", "-shm")
    )


def _cleanup_legacy_storage(root: Path, database_path: Path) -> None:
    live_generation = _database_generation(root, database_path)
    backup_path, backup_manifest_path = _snapshot_paths(root)
    backup_generation = _validated_snapshot_generation(
        root,
        backup_path,
        backup_manifest_path,
    )
    if live_generation < 0 or backup_generation != live_generation:
        return

    legacy_local_database = _legacy_local_database_path(root)
    legacy_snapshot_path, legacy_manifest_path = _legacy_snapshot_paths(root)
    legacy_external_database = _legacy_external_database_path(root)
    removable = [
        legacy_local_database,
        *_database_sidecars(legacy_local_database),
        legacy_snapshot_path,
        legacy_manifest_path,
        legacy_external_database,
        *_database_sidecars(legacy_external_database),
    ]
    for path in removable:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    for directory in (
        legacy_local_database.parent,
        _platform_state_root(),
        Path(root) / LEGACY_STATE_DIRECTORY,
    ):
        try:
            directory.rmdir()
        except OSError:
            pass


def _publish_snapshot(root: Path, database_path: Path) -> None:
    if not database_path.is_file() or not Path(root).is_dir():
        return
    snapshot_path, manifest_path = _snapshot_paths(root)
    consistent_copy = _consistent_database_copy(database_path)
    try:
        metadata = _read_database_metadata(consistent_copy)
        generation = int(metadata.get("generation") or 0)
        checksum = _sha256_file(consistent_copy)
        _atomic_copy(consistent_copy, snapshot_path)
        _atomic_write_json(manifest_path, {
            "version": 2,
            "schema_version": int(metadata.get("schema_version") or SCHEMA_VERSION),
            "library_id": library_id(root),
            "generation": generation,
            "sha256": checksum,
            "updated_at": time.time(),
        })
        _cleanup_legacy_storage(root, database_path)
        _LAST_SYNC_ERRORS.pop(library_id(root), None)
    finally:
        try:
            consistent_copy.unlink(missing_ok=True)
        except OSError:
            pass


def _prepare_library_database(root: Path, database_path: Path) -> None:
    identity = library_id(root)
    if identity in _PREPARED_LIBRARIES and database_path.is_file():
        return
    _PREPARED_LIBRARIES.discard(identity)
    with _SCHEMA_LOCK:
        _INITIALIZED_DATABASES.discard(str(database_path.resolve()))

    database_path.parent.mkdir(parents=True, exist_ok=True)
    live_generation = _database_generation(root, database_path)
    backup_path, backup_manifest_path = _snapshot_paths(root)
    backup_generation = _validated_snapshot_generation(
        root,
        backup_path,
        backup_manifest_path,
    )
    legacy_snapshot_path, legacy_manifest_path = _legacy_snapshot_paths(root)
    legacy_snapshot_generation = _validated_snapshot_generation(
        root,
        legacy_snapshot_path,
        legacy_manifest_path,
    )
    legacy_local_database = _legacy_local_database_path(root)
    legacy_local_generation = _database_generation(root, legacy_local_database)
    legacy_external_database = _legacy_external_database_path(root)
    legacy_external_generation = _database_generation(root, legacy_external_database)

    candidates = [
        (legacy_local_generation, legacy_local_database),
        (backup_generation, backup_path),
        (legacy_snapshot_generation, legacy_snapshot_path),
        (legacy_external_generation, legacy_external_database),
    ]
    source_generation, source_path = max(candidates, key=lambda item: item[0])
    if source_generation >= 0 and source_generation > live_generation:
        candidate = database_path.with_name(
            f".{database_path.name}.{os.getpid()}.{threading.get_ident()}.import"
        )
        try:
            _atomic_copy(source_path, candidate)
            candidate_metadata = _read_database_metadata(candidate)
            if (
                candidate_metadata.get("library_id") == identity
                and int(candidate_metadata.get("generation") or -1) == source_generation
            ):
                os.replace(candidate, database_path)
                live_generation = source_generation
        finally:
            try:
                candidate.unlink(missing_ok=True)
            except OSError:
                pass

    if database_path.is_file() and live_generation < 0:
        raise RuntimeError(f"Library state database is invalid: {database_path}")
    if database_path.is_file() and live_generation != backup_generation:
        try:
            _publish_snapshot(root, database_path)
        except (OSError, sqlite3.Error) as exc:
            _LAST_SYNC_ERRORS[identity] = str(exc)
    elif database_path.is_file():
        _cleanup_legacy_storage(root, database_path)
    _PREPARED_LIBRARIES.add(identity)


def sync_snapshot(root: Path) -> bool:
    root = Path(root)
    with _library_lock(root):
        database_path = working_database_path(root)
        _prepare_library_database(root, database_path)
        if not database_path.is_file():
            return False
        try:
            _publish_snapshot(root, database_path)
        except (OSError, sqlite3.Error) as exc:
            _LAST_SYNC_ERRORS[library_id(root)] = str(exc)
            return False
        manifest = _read_manifest(root)
        metadata = _read_database_metadata(database_path)
        return bool(
            manifest.get("library_id") == library_id(root)
            and int(manifest.get("generation") or -1)
            == int(metadata.get("generation") or -2)
        )


@contextmanager
def _connect(
    root: Path,
    *,
    write: bool = False,
    publish_snapshot: bool = True,
):
    root = Path(root)
    with _library_lock(root):
        database_path = working_database_path(root)
        _prepare_library_database(root, database_path)
        connection = sqlite3.connect(database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA synchronous = FULL")
        database_key = str(database_path.resolve())
        with _SCHEMA_LOCK:
            if database_key not in _INITIALIZED_DATABASES:
                connection.execute("PRAGMA journal_mode = DELETE")
                connection.executescript(
                    """
        CREATE TABLE IF NOT EXISTS state_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imagine_saved_posts (
            account_key TEXT NOT NULL,
            group_id TEXT NOT NULL,
            post_json TEXT NOT NULL,
            updated_at REAL NOT NULL,
            PRIMARY KEY (account_key, group_id)
        );

        CREATE TABLE IF NOT EXISTS imagine_saved_assets (
            account_key TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            group_id TEXT NOT NULL,
            external_reference INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (account_key, asset_id),
            FOREIGN KEY (account_key, group_id)
                REFERENCES imagine_saved_posts(account_key, group_id)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS imagine_saved_assets_group_idx
            ON imagine_saved_assets(account_key, group_id);

        CREATE TABLE IF NOT EXISTS imagine_generated_relations (
            source_id TEXT PRIMARY KEY,
            relation_json TEXT NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imagine_upload_cache (
            cache_key TEXT PRIMARY KEY,
            record_json TEXT NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imagine_pending_actions (
            account_key TEXT NOT NULL,
            action TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            PRIMARY KEY (account_key, action, asset_id)
        );

        CREATE TABLE IF NOT EXISTS imagine_local_exclusions (
            account_key TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at REAL NOT NULL,
            PRIMARY KEY (account_key, asset_id)
        );

        CREATE TABLE IF NOT EXISTS account_registry (
            provider TEXT NOT NULL,
            account_key TEXT NOT NULL,
            account_id TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            label TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            registered_at TEXT NOT NULL DEFAULT '',
            present INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 0,
            updated_at REAL NOT NULL,
            PRIMARY KEY (provider, account_key)
        );

        CREATE INDEX IF NOT EXISTS account_registry_email_idx
            ON account_registry(email, provider);
        """
                )
                connection.execute(
                    """
        INSERT INTO state_metadata(key, value)
        VALUES('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
                    (str(SCHEMA_VERSION),),
                )
                connection.execute(
                    """
        INSERT INTO state_metadata(key, value)
        VALUES('library_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
                    (library_id(root),),
                )
                connection.execute(
                    "INSERT OR IGNORE INTO state_metadata(key, value) VALUES('generation', '0')"
                )
                connection.commit()
                _INITIALIZED_DATABASES.add(database_key)
        committed = False
        try:
            yield connection
            if write:
                connection.execute(
                    """
                    INSERT INTO state_metadata(key, value)
                    VALUES('generation', '1')
                    ON CONFLICT(key) DO UPDATE SET
                        value = CAST(CAST(state_metadata.value AS INTEGER) + 1 AS TEXT)
                    """
                )
            connection.commit()
            committed = True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        if write and committed and publish_snapshot:
            try:
                _publish_snapshot(root, database_path)
            except (OSError, sqlite3.Error) as exc:
                _LAST_SYNC_ERRORS[library_id(root)] = str(exc)


def metadata_value(root: Path, key: str) -> str:
    with _connect(root) as connection:
        row = connection.execute(
            "SELECT value FROM state_metadata WHERE key = ?",
            (str(key),),
        ).fetchone()
    return str(row["value"]) if row else ""


def set_metadata_value(root: Path, key: str, value: str) -> None:
    with _connect(root, write=True) as connection:
        connection.execute(
            """
            INSERT INTO state_metadata(key, value)
            VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (str(key), str(value)),
        )


def sync_account_registry(
    root: Path,
    provider: str,
    accounts: list[dict],
    active_id: str = "",
) -> bool:
    provider = _normalized_text(provider).lower()
    if not provider:
        raise ValueError("Account provider is required.")
    active_id = str(active_id or "")
    normalized: list[tuple[str, str, str, str, str, str, str, int, int]] = []
    for account in accounts if isinstance(accounts, list) else []:
        if not isinstance(account, dict):
            continue
        account_id = _normalized_text(account.get("id"))
        account_key = account_id or _normalized_text(account.get("email")).lower()
        if not account_key:
            continue
        normalized.append((
            provider,
            account_key.lower(),
            account_id,
            _normalized_text(account.get("email")).lower(),
            _normalized_text(account.get("label")),
            _normalized_text(account.get("status")),
            _normalized_text(account.get("captured_at") or account.get("registered_at")),
            1,
            int(bool(active_id and account_id == active_id)),
        ))
    expected = {
        row[1]: row[2:]
        for row in normalized
    }
    with _connect(root) as connection:
        current_rows = connection.execute(
            """
            SELECT account_key, account_id, email, label, status,
                   registered_at, present, active
            FROM account_registry
            WHERE provider = ?
            """,
            (provider,),
        ).fetchall()
    current = {
        str(row["account_key"]): (
            str(row["account_id"]),
            str(row["email"]),
            str(row["label"]),
            str(row["status"]),
            str(row["registered_at"]),
            int(row["present"]),
            int(row["active"]),
        )
        for row in current_rows
    }
    next_state = {
        **{
            key: (*value[:5], 0, 0)
            for key, value in current.items()
            if key not in expected
        },
        **expected,
    }
    if current == next_state:
        return False
    now = time.time()
    with _connect(root, write=True, publish_snapshot=False) as connection:
        connection.execute(
            """
            UPDATE account_registry
            SET present = 0, active = 0, updated_at = ?
            WHERE provider = ?
            """,
            (now, provider),
        )
        connection.executemany(
            """
            INSERT INTO account_registry(
                provider, account_key, account_id, email, label, status,
                registered_at, present, active, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, account_key) DO UPDATE SET
                account_id = excluded.account_id,
                email = excluded.email,
                label = excluded.label,
                status = excluded.status,
                registered_at = excluded.registered_at,
                present = excluded.present,
                active = excluded.active,
                updated_at = excluded.updated_at
            """,
            [(*row, now) for row in normalized],
        )
        connection.execute(
            """
            INSERT INTO state_metadata(key, value)
            VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (f"active_{provider}_account_key", active_id.lower()),
        )
    return True


def account_registry(
    root: Path,
    *,
    provider: str = "",
    present_only: bool = False,
) -> list[dict]:
    query = """
        SELECT provider, account_key, account_id, email, label, status,
               registered_at, present, active, updated_at
        FROM account_registry
    """
    conditions: list[str] = []
    parameters: list[str | int] = []
    if provider:
        conditions.append("provider = ?")
        parameters.append(_normalized_text(provider).lower())
    if present_only:
        conditions.append("present = 1")
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY provider ASC, active DESC, updated_at DESC, account_key ASC"
    with _connect(root) as connection:
        rows = connection.execute(query, parameters).fetchall()
    return [dict(row) for row in rows]


def load_saved_posts(root: Path, account_key: str) -> list[dict]:
    with _connect(root) as connection:
        rows = connection.execute(
            """
            SELECT post_json
            FROM imagine_saved_posts
            WHERE account_key = ?
            ORDER BY updated_at ASC, group_id ASC
            """,
            (str(account_key),),
        ).fetchall()
    posts: list[dict] = []
    for row in rows:
        try:
            post = json.loads(str(row["post_json"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(post, dict):
            posts.append(post)
    return posts


def replace_saved_posts(root: Path, account_key: str, records: list[dict]) -> None:
    account_key = str(account_key)
    now = time.time()
    with _connect(root, write=True) as connection:
        connection.execute(
            "DELETE FROM imagine_saved_posts WHERE account_key = ?",
            (account_key,),
        )
        for record in records:
            group_id = str(record.get("group_id") or "").strip()
            post = record.get("post")
            if not group_id or not isinstance(post, dict):
                continue
            connection.execute(
                """
                INSERT INTO imagine_saved_posts(
                    account_key, group_id, post_json, updated_at
                ) VALUES(?, ?, ?, ?)
                """,
                (
                    account_key,
                    group_id,
                    json.dumps(post, ensure_ascii=False, separators=(",", ":")),
                    now,
                ),
            )
            external_ids = {
                str(value).strip()
                for value in (record.get("external_asset_ids") or [])
                if str(value).strip()
            }
            for asset_id in {
                str(value).strip()
                for value in (record.get("asset_ids") or [])
                if str(value).strip()
            }:
                connection.execute(
                    """
                    INSERT INTO imagine_saved_assets(
                        account_key, asset_id, group_id, external_reference
                    ) VALUES(?, ?, ?, ?)
                    ON CONFLICT(account_key, asset_id) DO UPDATE SET
                        group_id = excluded.group_id,
                        external_reference = excluded.external_reference
                    """,
                    (account_key, asset_id, group_id, int(asset_id in external_ids)),
                )


def external_reference_ids(root: Path, account_key: str) -> set[str]:
    with _connect(root) as connection:
        rows = connection.execute(
            """
            SELECT asset_id
            FROM imagine_saved_assets
            WHERE account_key = ? AND external_reference = 1
            """,
            (str(account_key),),
        ).fetchall()
    return {str(row["asset_id"]) for row in rows}


def update_external_reference_ids(
    root: Path,
    account_key: str,
    *,
    add: set[str] | None = None,
    remove: set[str] | None = None,
) -> set[str]:
    account_key = str(account_key)
    add_ids = {str(value).strip() for value in (add or set()) if str(value).strip()}
    remove_ids = {str(value).strip() for value in (remove or set()) if str(value).strip()}
    with _connect(root, write=True) as connection:
        if add_ids:
            connection.executemany(
                """
                UPDATE imagine_saved_assets
                SET external_reference = 1
                WHERE account_key = ? AND asset_id = ?
                """,
                [(account_key, asset_id) for asset_id in sorted(add_ids)],
            )
        if remove_ids:
            connection.executemany(
                """
                UPDATE imagine_saved_assets
                SET external_reference = 0
                WHERE account_key = ? AND asset_id = ?
                """,
                [(account_key, asset_id) for asset_id in sorted(remove_ids)],
            )
    return external_reference_ids(root, account_key)


def load_generated_relations(root: Path) -> dict[str, dict]:
    with _connect(root) as connection:
        rows = connection.execute(
            """
            SELECT source_id, relation_json
            FROM imagine_generated_relations
            ORDER BY updated_at ASC, source_id ASC
            """
        ).fetchall()
    relations: dict[str, dict] = {}
    for row in rows:
        try:
            relation = json.loads(str(row["relation_json"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(relation, dict):
            relations[str(row["source_id"])] = relation
    return relations


def load_card_view_state_readonly(root: Path, account_key: str) -> dict:
    result = {
        "hidden_ids": set(),
        "relations": {},
    }
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    if not path.is_file():
        return result
    try:
        connection = sqlite3.connect(
            path.resolve().as_uri() + "?mode=ro",
            uri=True,
            timeout=2.0,
        )
        connection.row_factory = sqlite3.Row
        try:
            pending_rows = connection.execute(
                """
                SELECT asset_id
                FROM imagine_pending_actions
                WHERE account_key = ? AND action = 'delete' AND expires_at > ?
                """,
                (str(account_key), time.time()),
            ).fetchall()
            exclusion_rows = connection.execute(
                """
                SELECT asset_id
                FROM imagine_local_exclusions
                WHERE account_key = ?
                """,
                (str(account_key),),
            ).fetchall()
            relation_rows = connection.execute(
                """
                SELECT source_id, relation_json
                FROM imagine_generated_relations
                ORDER BY updated_at ASC, source_id ASC
                """
            ).fetchall()
        finally:
            connection.close()
    except sqlite3.Error:
        return result
    hidden_ids = {
        str(row["asset_id"])
        for row in (*pending_rows, *exclusion_rows)
    }
    relations: dict[str, dict] = {}
    for row in relation_rows:
        try:
            relation = json.loads(str(row["relation_json"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(relation, dict):
            relations[str(row["source_id"])] = relation
    return {
        "hidden_ids": hidden_ids,
        "relations": relations,
    }


def replace_generated_relations(root: Path, relations: dict[str, dict]) -> None:
    now = time.time()
    with _connect(root, write=True) as connection:
        connection.execute("DELETE FROM imagine_generated_relations")
        connection.executemany(
            """
            INSERT INTO imagine_generated_relations(
                source_id, relation_json, updated_at
            ) VALUES(?, ?, ?)
            """,
            [
                (
                    str(source_id),
                    json.dumps(relation, ensure_ascii=False, separators=(",", ":")),
                    now + (index / 1000000),
                )
                for index, (source_id, relation) in enumerate(relations.items())
                if str(source_id).strip() and isinstance(relation, dict)
            ],
        )


def upsert_generated_relation(root: Path, source_id: str, relation: dict) -> None:
    source_id = str(source_id).strip()
    if not source_id or not isinstance(relation, dict):
        return
    with _connect(root, write=True) as connection:
        connection.execute(
            """
            INSERT INTO imagine_generated_relations(
                source_id, relation_json, updated_at
            ) VALUES(?, ?, ?)
            ON CONFLICT(source_id) DO UPDATE SET
                relation_json = excluded.relation_json,
                updated_at = excluded.updated_at
            """,
            (
                source_id,
                json.dumps(relation, ensure_ascii=False, separators=(",", ":")),
                time.time(),
            ),
        )
        connection.execute(
            """
            DELETE FROM imagine_generated_relations
            WHERE source_id IN (
                SELECT source_id
                FROM imagine_generated_relations
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET 500
            )
            """
        )


def load_upload_cache(root: Path) -> dict[str, dict]:
    with _connect(root) as connection:
        rows = connection.execute(
            """
            SELECT cache_key, record_json
            FROM imagine_upload_cache
            ORDER BY updated_at ASC, cache_key ASC
            """
        ).fetchall()
    cache: dict[str, dict] = {}
    for row in rows:
        try:
            record = json.loads(str(row["record_json"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(record, dict):
            cache[str(row["cache_key"])] = record
    return cache


def replace_upload_cache(root: Path, cache: dict[str, dict]) -> None:
    now = time.time()
    records = [
        (str(cache_key), record)
        for cache_key, record in cache.items()
        if str(cache_key).strip() and isinstance(record, dict)
    ][-500:]
    with _connect(root, write=True) as connection:
        connection.execute("DELETE FROM imagine_upload_cache")
        connection.executemany(
            """
            INSERT INTO imagine_upload_cache(cache_key, record_json, updated_at)
            VALUES(?, ?, ?)
            """,
            [
                (
                    cache_key,
                    json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                    now + (index / 1000000),
                )
                for index, (cache_key, record) in enumerate(records)
            ],
        )


def upsert_upload_cache(root: Path, cache_key: str, record: dict) -> None:
    cache_key = str(cache_key).strip()
    if not cache_key or not isinstance(record, dict):
        return
    with _connect(root, write=True) as connection:
        connection.execute(
            """
            INSERT INTO imagine_upload_cache(cache_key, record_json, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                record_json = excluded.record_json,
                updated_at = excluded.updated_at
            """,
            (
                cache_key,
                json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                time.time(),
            ),
        )
        connection.execute(
            """
            DELETE FROM imagine_upload_cache
            WHERE cache_key IN (
                SELECT cache_key
                FROM imagine_upload_cache
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET 500
            )
            """
        )


def add_pending_deletes(
    root: Path,
    account_key: str,
    asset_ids: set[str],
    *,
    lifetime_seconds: int = 21600,
) -> None:
    now = time.time()
    expires_at = now + max(60, int(lifetime_seconds))
    rows = [
        (str(account_key), "delete", str(asset_id).strip(), now, expires_at)
        for asset_id in sorted(asset_ids)
        if str(asset_id).strip()
    ]
    if not rows:
        return
    with _connect(root, write=True) as connection:
        connection.execute(
            "DELETE FROM imagine_pending_actions WHERE expires_at <= ?",
            (now,),
        )
        connection.executemany(
            """
            INSERT INTO imagine_pending_actions(
                account_key, action, asset_id, created_at, expires_at
            ) VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(account_key, action, asset_id) DO UPDATE SET
                created_at = excluded.created_at,
                expires_at = excluded.expires_at
            """,
            rows,
        )


def pending_delete_ids(root: Path, account_key: str) -> set[str]:
    now = time.time()
    with _connect(root) as connection:
        rows = connection.execute(
            """
            SELECT asset_id
            FROM imagine_pending_actions
            WHERE account_key = ? AND action = 'delete' AND expires_at > ?
            """,
            (str(account_key), now),
        ).fetchall()
    return {str(row["asset_id"]) for row in rows}


def add_local_exclusions(
    root: Path,
    account_key: str,
    asset_ids: set[str],
    *,
    reason: str = "external_unsave",
) -> None:
    rows = [
        (
            str(account_key),
            str(asset_id).strip(),
            str(reason or "external_unsave"),
            time.time(),
        )
        for asset_id in sorted(asset_ids)
        if str(asset_id).strip()
    ]
    if not rows:
        return
    with _connect(root, write=True) as connection:
        connection.executemany(
            """
            INSERT INTO imagine_local_exclusions(
                account_key, asset_id, reason, created_at
            ) VALUES(?, ?, ?, ?)
            ON CONFLICT(account_key, asset_id) DO UPDATE SET
                reason = excluded.reason,
                created_at = excluded.created_at
            """,
            rows,
        )


def remove_local_exclusions(
    root: Path,
    account_key: str,
    asset_ids: set[str],
) -> None:
    rows = [
        (str(account_key), str(asset_id).strip())
        for asset_id in sorted(asset_ids)
        if str(asset_id).strip()
    ]
    if not rows:
        return
    with _connect(root, write=True) as connection:
        connection.executemany(
            """
            DELETE FROM imagine_local_exclusions
            WHERE account_key = ? AND asset_id = ?
            """,
            rows,
        )


def local_exclusion_ids(root: Path, account_key: str) -> set[str]:
    with _connect(root) as connection:
        rows = connection.execute(
            """
            SELECT asset_id
            FROM imagine_local_exclusions
            WHERE account_key = ?
            """,
            (str(account_key),),
        ).fetchall()
    return {str(row["asset_id"]) for row in rows}


def resolve_pending_deletes(root: Path, account_key: str, asset_ids: set[str]) -> None:
    rows = [
        (str(account_key), str(asset_id).strip())
        for asset_id in sorted(asset_ids)
        if str(asset_id).strip()
    ]
    if not rows:
        return
    with _connect(root, write=True) as connection:
        connection.executemany(
            """
            DELETE FROM imagine_pending_actions
            WHERE account_key = ? AND action = 'delete' AND asset_id = ?
            """,
            rows,
        )
