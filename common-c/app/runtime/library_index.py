from __future__ import annotations

import json
import sqlite3
import threading
import time
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 7
LIST_SUMMARY_VERSION = 2
STATE_DIRECTORY = "sql_data"
DATABASE_FILENAME = "library_index.sqlite3"
_LOCKS_GUARD = threading.Lock()
_LOCKS: dict[str, threading.RLock] = {}


def database_path(root: Path) -> Path:
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _lock_for(root: Path) -> threading.RLock:
    key = str((Path(root) / STATE_DIRECTORY / DATABASE_FILENAME).resolve())
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


@contextmanager
def _connection(root: Path, *, write: bool = False):
    path = (
        database_path(root)
        if write
        else Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    )
    if write:
        connection = sqlite3.connect(str(path), timeout=20.0)
    else:
        connection = sqlite3.connect(
            path.resolve().as_uri() + "?mode=ro",
            uri=True,
            timeout=5.0,
        )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 20000")
    connection.execute("PRAGMA foreign_keys = ON")
    if write:
        connection.execute("PRAGMA journal_mode = DELETE")
        connection.execute("PRAGMA synchronous = NORMAL")
    try:
        yield connection
        if write:
            connection.commit()
    except Exception:
        if write:
            connection.rollback()
        raise
    finally:
        connection.close()


def _create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS index_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS library_posts (
            path TEXT PRIMARY KEY,
            path_key TEXT NOT NULL,
            parent_path TEXT NOT NULL,
            parent_path_key TEXT NOT NULL,
            area TEXT NOT NULL,
            collection_name TEXT NOT NULL,
            source TEXT NOT NULL,
            mode TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            created_at TEXT NOT NULL,
            activity_at TEXT NOT NULL DEFAULT '',
            build_visible INTEGER NOT NULL DEFAULT 0,
            favorite INTEGER NOT NULL DEFAULT 0,
            order_value INTEGER NOT NULL DEFAULT 0,
            grid_slot INTEGER NOT NULL DEFAULT 0,
            list_json TEXT NOT NULL,
            data_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS library_posts_created_idx
            ON library_posts(created_at DESC, path);
        CREATE INDEX IF NOT EXISTS library_posts_area_idx
            ON library_posts(area, created_at DESC, path);
        CREATE INDEX IF NOT EXISTS library_posts_build_idx
            ON library_posts(build_visible, area, created_at DESC, path);
        CREATE INDEX IF NOT EXISTS library_posts_path_key_idx
            ON library_posts(path_key);
        CREATE INDEX IF NOT EXISTS library_posts_collection_idx
            ON library_posts(collection_name, parent_path_key, grid_slot, order_value, created_at, path);
        CREATE INDEX IF NOT EXISTS library_posts_parent_idx
            ON library_posts(area, parent_path_key, grid_slot, order_value, created_at, path);

        CREATE TABLE IF NOT EXISTS library_collections (
            path TEXT PRIMARY KEY,
            path_key TEXT NOT NULL,
            name TEXT NOT NULL,
            order_value INTEGER NOT NULL DEFAULT 0,
            sort_mode TEXT NOT NULL,
            post_count INTEGER NOT NULL DEFAULT 0,
            data_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS library_collections_order_idx
            ON library_collections(order_value, name, path);
        CREATE INDEX IF NOT EXISTS library_collections_path_key_idx
            ON library_collections(path_key);

        CREATE TABLE IF NOT EXISTS imagine_remote_posts (
            account_key TEXT NOT NULL,
            post_key TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT '',
            activity_at TEXT NOT NULL DEFAULT '',
            post_json TEXT NOT NULL,
            refreshed_at REAL NOT NULL,
            sync_token TEXT NOT NULL DEFAULT '',
            official_order INTEGER,
            PRIMARY KEY (account_key, post_key)
        );

        CREATE INDEX IF NOT EXISTS imagine_remote_posts_order_idx
            ON imagine_remote_posts(account_key, created_at DESC, post_key);

        CREATE TABLE IF NOT EXISTS imagine_remote_assets (
            account_key TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            post_key TEXT NOT NULL,
            PRIMARY KEY (account_key, asset_id, post_key),
            FOREIGN KEY (account_key, post_key)
                REFERENCES imagine_remote_posts(account_key, post_key)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS imagine_remote_assets_post_idx
            ON imagine_remote_assets(account_key, post_key);

        CREATE TABLE IF NOT EXISTS imagine_discover_posts (
            account_key TEXT NOT NULL,
            post_key TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            post_json TEXT NOT NULL,
            refreshed_at REAL NOT NULL,
            PRIMARY KEY (account_key, post_key)
        );

        CREATE INDEX IF NOT EXISTS imagine_discover_posts_order_idx
            ON imagine_discover_posts(account_key, position, post_key);

        CREATE TABLE IF NOT EXISTS imagine_discover_state (
            account_key TEXT PRIMARY KEY,
            next_cursor TEXT NOT NULL DEFAULT '',
            refreshed_at REAL NOT NULL
        );
        """
    )
    imagine_remote_columns = {
        str(row["name"])
        for row in connection.execute("PRAGMA table_info(imagine_remote_posts)").fetchall()
    }
    imagine_remote_asset_pk = [
        str(row["name"])
        for row in sorted(
            connection.execute("PRAGMA table_info(imagine_remote_assets)").fetchall(),
            key=lambda row: int(row["pk"] or 0),
        )
        if int(row["pk"] or 0) > 0
    ]
    if imagine_remote_asset_pk == ["account_key", "asset_id"]:
        # A source/result may legitimately be visible on more than one provenance-scoped
        # card. The old one-card-per-asset index deleted whichever card was cached first.
        connection.executescript(
            """
            ALTER TABLE imagine_remote_assets RENAME TO imagine_remote_assets_legacy;
            CREATE TABLE imagine_remote_assets (
                account_key TEXT NOT NULL,
                asset_id TEXT NOT NULL,
                post_key TEXT NOT NULL,
                PRIMARY KEY (account_key, asset_id, post_key),
                FOREIGN KEY (account_key, post_key)
                    REFERENCES imagine_remote_posts(account_key, post_key)
                    ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO imagine_remote_assets(account_key, asset_id, post_key)
            SELECT account_key, asset_id, post_key FROM imagine_remote_assets_legacy;
            DROP TABLE imagine_remote_assets_legacy;
            CREATE INDEX IF NOT EXISTS imagine_remote_assets_post_idx
                ON imagine_remote_assets(account_key, post_key);
            """
        )
    library_post_columns = {
        str(row["name"])
        for row in connection.execute("PRAGMA table_info(library_posts)").fetchall()
    }
    if "activity_at" not in library_post_columns:
        connection.execute(
            "ALTER TABLE library_posts ADD COLUMN activity_at TEXT NOT NULL DEFAULT ''"
        )
        rows = connection.execute(
            "SELECT path, created_at, data_json FROM library_posts"
        ).fetchall()
        connection.executemany(
            "UPDATE library_posts SET activity_at = ? WHERE path = ?",
            [
                (
                    post_activity_at(_json_dict(row["data_json"])) or str(row["created_at"] or ""),
                    str(row["path"]),
                )
                for row in rows
            ],
        )
    if "sync_token" not in imagine_remote_columns:
        connection.execute(
            "ALTER TABLE imagine_remote_posts ADD COLUMN sync_token TEXT NOT NULL DEFAULT ''"
        )
    if "activity_at" not in imagine_remote_columns:
        connection.execute(
            "ALTER TABLE imagine_remote_posts ADD COLUMN activity_at TEXT NOT NULL DEFAULT ''"
        )
        rows = connection.execute(
            "SELECT account_key, post_key, created_at, post_json FROM imagine_remote_posts"
        ).fetchall()
        connection.executemany(
            """
            UPDATE imagine_remote_posts
            SET activity_at = ?
            WHERE account_key = ? AND post_key = ?
            """,
            [
                (
                    post_activity_at(_json_dict(row["post_json"])) or str(row["created_at"] or ""),
                    str(row["account_key"]),
                    str(row["post_key"]),
                )
                for row in rows
            ],
        )
    if "official_order" not in imagine_remote_columns:
        connection.execute(
            "ALTER TABLE imagine_remote_posts ADD COLUMN official_order INTEGER"
        )
    connection.executescript(
        """
        CREATE INDEX IF NOT EXISTS library_posts_activity_idx
            ON library_posts(activity_at DESC, path);
        CREATE INDEX IF NOT EXISTS library_posts_area_activity_idx
            ON library_posts(area, activity_at DESC, path);
        CREATE INDEX IF NOT EXISTS library_posts_build_activity_idx
            ON library_posts(build_visible, area, activity_at DESC, path);
        CREATE INDEX IF NOT EXISTS imagine_remote_posts_activity_idx
            ON imagine_remote_posts(account_key, activity_at DESC, post_key);
        CREATE INDEX IF NOT EXISTS imagine_remote_posts_official_order_idx
            ON imagine_remote_posts(account_key, official_order, created_at DESC, post_key);
        """
    )
    connection.execute(
        """
        INSERT INTO index_metadata(key, value) VALUES('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (str(SCHEMA_VERSION),),
    )


def _json_text(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_dict(value: str) -> dict:
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _parent_path(path: str) -> str:
    value = str(path or "").replace("\\", "/").strip("/")
    return value.rsplit("/", 1)[0] if "/" in value else ""


def _path_key(path: str) -> str:
    value = str(path or "").replace("\\", "/").strip("/")
    return unicodedata.normalize("NFC", value)


def _safe_int(value, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _normalized_activity_time(value) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        seconds = float(value)
        if abs(seconds) > 10_000_000_000:
            seconds /= 1000
        try:
            return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError):
            return ""
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        numeric = float(text)
    except ValueError:
        numeric = None
    if numeric is not None:
        return _normalized_activity_time(numeric)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        return text


def post_activity_at(post: dict) -> str:
    values = [
        post.get("activity_at"),
        post.get("last_activity_at"),
        post.get("created_at"),
        post.get("createdAt"),
        post.get("timestamp"),
    ]
    for item in post.get("items") or []:
        if not isinstance(item, dict):
            continue
        values.extend((
            item.get("created_at"),
            item.get("createdAt"),
            item.get("updated_at"),
            item.get("updatedAt"),
            item.get("timestamp"),
            item.get("last_modified"),
            item.get("lastModified"),
        ))
    normalized = [_normalized_activity_time(value) for value in values]
    return max((value for value in normalized if value), default="")


def _is_collection_container(post: dict) -> bool:
    if str(post.get("area") or "") != "collection":
        return False
    mode = str(post.get("mode") or "").lower()
    return bool(post.get("folder_role") == "container" or (mode == "folder" and not (post.get("items") or [])))


def _item_has_build_media(item: dict) -> bool:
    status = str(item.get("status") or "").lower()
    if item.get("moderated") or status in {"moderated", "failed"}:
        return True
    item_type = str(item.get("type") or "").lower()
    if item_type not in {"image", "video"}:
        return False
    return any(
        str(item.get(key) or "").strip()
        for key in (
            "file",
            "url",
            "object_url",
            "media_url",
            "mediaUrl",
            "remote_url",
            "source_url",
            "thumbnail_url",
            "thumbnailUrl",
            "poster_url",
            "posterUrl",
            "preview_url",
            "previewUrl",
        )
    )


def _is_build_visible(post: dict) -> bool:
    if _is_collection_container(post):
        return False
    area = str(post.get("area") or "")
    source = str(post.get("source") or "")
    if area == "collection":
        return any(_item_has_build_media(item) for item in (post.get("items") or []) if isinstance(item, dict))
    if area == "upload" or source == "imagine":
        return False
    if source != "build" and area != "created":
        return False
    return any(_item_has_build_media(item) for item in (post.get("items") or []) if isinstance(item, dict))


def _list_item(item: dict | None) -> dict:
    if not isinstance(item, dict):
        return {}
    excluded = {
        "data_url",
        "dataUrl",
        "base64",
        "bytes",
        "raw_response",
        "response_body",
    }
    return {key: value for key, value in item.items() if key not in excluded}


def _representative_item(post: dict) -> dict:
    items = [item for item in (post.get("items") or []) if isinstance(item, dict)]
    explicit = post.get("representative_item")
    if isinstance(explicit, dict):
        return explicit
    representative = str(post.get("representative") or "")
    if representative:
        for item in items:
            if representative in {
                str(item.get("file") or ""),
                str(item.get("url") or ""),
                str(item.get("object_url") or ""),
                str(item.get("item_id") or ""),
            }:
                return item
    for item in items:
        role = str(item.get("role") or item.get("relation") or item.get("source_type") or "").lower()
        if not any(token in role for token in ("source", "original", "start", "input", "parent")):
            return item
    return items[0] if items else {}


def _item_identifier_values(item: dict) -> set[str]:
    return {
        str(item.get(key) or "").strip()
        for key in ("item_id", "itemId", "asset_id", "assetId", "id")
        if str(item.get(key) or "").strip()
    }


def _linked_image_poster(post: dict, representative: dict) -> str:
    if str(representative.get("type") or "").lower() != "video":
        return ""
    if any(
        str(representative.get(key) or "").strip()
        for key in (
            "thumbnail_url",
            "thumbnailUrl",
            "poster_url",
            "posterUrl",
            "preview_url",
            "previewUrl",
        )
    ):
        return ""
    linked_ids = {
        str(representative.get(key) or "").strip()
        for key in ("source_item_id", "sourceItemId", "parent_item_id", "parentItemId")
        if str(representative.get(key) or "").strip()
    }
    if not linked_ids:
        return ""
    for item in post.get("items") or []:
        if not isinstance(item, dict) or str(item.get("type") or "").lower() != "image":
            continue
        if not (_item_identifier_values(item) & linked_ids):
            continue
        for key in (
            "thumbnail_url",
            "thumbnailUrl",
            "poster_url",
            "posterUrl",
            "preview_url",
            "previewUrl",
            "object_url",
            "media_url",
            "mediaUrl",
            "local_url",
            "localUrl",
            "url",
            "remote_url",
            "source_url",
            "file",
        ):
            value = str(item.get(key) or "").strip()
            if value:
                return value
    return ""


def _post_list_summary(post: dict) -> dict:
    excluded = {
        "items",
        "representative_item",
        "raw_response",
        "response_body",
        "request_payload",
    }
    summary = {key: value for key, value in post.items() if key not in excluded}
    representative_source = _representative_item(post)
    representative = _list_item(representative_source)
    poster_url = _linked_image_poster(post, representative_source)
    if poster_url:
        representative["thumbnail_url"] = poster_url
        representative["poster_url"] = poster_url
    summary["items"] = [representative] if representative else []
    summary["item_count"] = len(post.get("items") or [])
    summary["activity_at"] = post_activity_at(post)
    summary["_indexed_summary"] = True
    return summary


def _post_row(post: dict) -> tuple:
    path = str(post.get("folder_path") or "").replace("\\", "/").strip("/")
    parent_path = _parent_path(path)
    return (
        path,
        _path_key(path),
        parent_path,
        _path_key(parent_path),
        str(post.get("area") or ""),
        str(post.get("collection") or ""),
        str(post.get("source") or ""),
        str(post.get("mode") or ""),
        str(post.get("title") or ""),
        str(post.get("prompt") or ""),
        str(post.get("created_at") or ""),
        post_activity_at(post),
        1 if _is_build_visible(post) else 0,
        1 if (post.get("build_favorite") or post.get("favorite") or post.get("liked")) else 0,
        _safe_int(post.get("order"), 0),
        _safe_int(post.get("grid_slot"), 0),
        _json_text(_post_list_summary(post)),
        _json_text(post),
    )


def _collection_row(collection: dict, post_count: int | None = None) -> tuple:
    summary = {key: value for key, value in collection.items() if key != "posts"}
    count = len(collection.get("posts") or []) if post_count is None else max(0, int(post_count))
    summary["post_count"] = count
    path = str(collection.get("path") or "").replace("\\", "/").strip("/")
    return (
        path,
        _path_key(path),
        str(collection.get("name") or ""),
        _safe_int(collection.get("order"), 0),
        str(collection.get("sort_mode") or ""),
        count,
        _json_text(summary),
    )


def _insert_posts(connection: sqlite3.Connection, posts: list[dict]) -> None:
    rows = [_post_row(post) for post in posts if str(post.get("folder_path") or "").strip()]
    if not rows:
        return
    connection.executemany(
        """
        INSERT INTO library_posts(
            path, path_key, parent_path, parent_path_key,
            area, collection_name, source, mode, title, prompt,
            created_at, activity_at, build_visible, favorite, order_value, grid_slot, list_json, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            path_key = excluded.path_key,
            parent_path = excluded.parent_path,
            parent_path_key = excluded.parent_path_key,
            area = excluded.area,
            collection_name = excluded.collection_name,
            source = excluded.source,
            mode = excluded.mode,
            title = excluded.title,
            prompt = excluded.prompt,
            created_at = excluded.created_at,
            activity_at = excluded.activity_at,
            build_visible = excluded.build_visible,
            favorite = excluded.favorite,
            order_value = excluded.order_value,
            grid_slot = excluded.grid_slot,
            list_json = excluded.list_json,
            data_json = excluded.data_json
        """,
        rows,
    )


def rebuild(root: Path, posts: list[dict], collections: list[dict], *, updated_at: str = "") -> None:
    def rebuild_once() -> None:
        with _connection(root, write=True) as connection:
            connection.executescript(
                """
                DROP TABLE IF EXISTS library_posts;
                DROP TABLE IF EXISTS library_collections;
                DROP TABLE IF EXISTS index_metadata;
                """
            )
            _create_schema(connection)
            _insert_posts(connection, posts)
            if collections:
                connection.executemany(
                    """
                    INSERT INTO library_collections(
                        path, path_key, name, order_value, sort_mode, post_count, data_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [_collection_row(collection) for collection in collections],
                )
            connection.execute(
                """
                INSERT INTO index_metadata(key, value) VALUES('complete', '1')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """
            )
            connection.execute(
                """
                INSERT INTO index_metadata(key, value) VALUES('updated_at', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(updated_at or ""),),
            )
            connection.execute(
                """
                INSERT INTO index_metadata(key, value) VALUES('list_summary_version', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(LIST_SUMMARY_VERSION),),
            )

    with _lock_for(root):
        try:
            rebuild_once()
        except sqlite3.DatabaseError:
            path = database_path(root)
            for candidate in (
                path,
                path.with_name(f"{path.name}-journal"),
                path.with_name(f"{path.name}-wal"),
                path.with_name(f"{path.name}-shm"),
            ):
                try:
                    candidate.unlink()
                except FileNotFoundError:
                    pass
            rebuild_once()


def ready(root: Path) -> bool:
    path = database_path(root)
    if not path.is_file():
        return False
    try:
        with _connection(root) as connection:
            version = connection.execute(
                "SELECT value FROM index_metadata WHERE key = 'schema_version'"
            ).fetchone()
            complete = connection.execute(
                "SELECT value FROM index_metadata WHERE key = 'complete'"
            ).fetchone()
            summary_version = connection.execute(
                "SELECT value FROM index_metadata WHERE key = 'list_summary_version'"
            ).fetchone()
        if version and str(version["value"]) != str(SCHEMA_VERSION):
            with _lock_for(root):
                with _connection(root, write=True) as connection:
                    _create_schema(connection)
            with _connection(root) as connection:
                version = connection.execute(
                    "SELECT value FROM index_metadata WHERE key = 'schema_version'"
                ).fetchone()
                complete = connection.execute(
                    "SELECT value FROM index_metadata WHERE key = 'complete'"
                ).fetchone()
        return bool(
            version
            and complete
            and summary_version
            and str(version["value"]) == str(SCHEMA_VERSION)
            and str(complete["value"]) == "1"
            and str(summary_version["value"]) == str(LIST_SUMMARY_VERSION)
        )
    except sqlite3.Error:
        return False


def replace_posts(root: Path, posts: list[dict]) -> None:
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            _insert_posts(connection, posts)


def delete_paths(root: Path, paths: list[str], *, recursive: bool = False) -> None:
    normalized = [
        _path_key(path)
        for path in paths
        if str(path or "").strip()
    ]
    if not normalized or not ready(root):
        return
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            for path in normalized:
                if recursive:
                    connection.execute(
                        "DELETE FROM library_posts WHERE path_key = ? OR path_key LIKE ?",
                        (path, f"{path}/%"),
                    )
                else:
                    connection.execute("DELETE FROM library_posts WHERE path_key = ?", (path,))


def replace_collections(root: Path, collections: list[dict]) -> None:
    if not ready(root):
        return
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            current_paths = {
                _path_key(collection.get("path"))
                for collection in collections
                if str(collection.get("path") or "").strip()
            }
            if current_paths:
                placeholders = ",".join("?" for _ in current_paths)
                connection.execute(
                    f"DELETE FROM library_collections WHERE path_key NOT IN ({placeholders})",
                    tuple(current_paths),
                )
            else:
                connection.execute("DELETE FROM library_collections")
            for collection in collections:
                path = str(collection.get("path") or "").replace("\\", "/").strip("/")
                if not path:
                    continue
                path_key = _path_key(path)
                row = connection.execute(
                    "SELECT COUNT(*) AS count FROM library_posts WHERE path_key = ? OR path_key LIKE ?",
                    (path_key, f"{path_key}/%"),
                ).fetchone()
                count = int(row["count"] if row else 0)
                connection.execute(
                    """
                    INSERT INTO library_collections(
                        path, path_key, name, order_value, sort_mode, post_count, data_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        path_key = excluded.path_key,
                        name = excluded.name,
                        order_value = excluded.order_value,
                        sort_mode = excluded.sort_mode,
                        post_count = excluded.post_count,
                        data_json = excluded.data_json
                    """,
                    _collection_row(collection, count),
                )


def get_post(root: Path, path: str) -> dict | None:
    if not ready(root):
        return None
    normalized = _path_key(path)
    if not normalized:
        return None
    with _connection(root) as connection:
        row = connection.execute(
            "SELECT data_json FROM library_posts WHERE path_key = ?",
            (normalized,),
        ).fetchone()
    if not row:
        return None
    post = _json_dict(row["data_json"])
    return post or None


def all_posts(root: Path) -> list[dict]:
    if not ready(root):
        return []
    with _connection(root) as connection:
        rows = connection.execute(
            "SELECT data_json FROM library_posts ORDER BY activity_at DESC, path"
        ).fetchall()
    return [post for row in rows if (post := _json_dict(row["data_json"]))]


def collections(root: Path) -> list[dict]:
    if not ready(root):
        return []
    with _connection(root) as connection:
        rows = connection.execute(
            """
            SELECT data_json, post_count
            FROM library_collections
            ORDER BY order_value, name COLLATE NOCASE, path
            """
        ).fetchall()
    result = []
    for row in rows:
        collection = _json_dict(row["data_json"])
        if not collection:
            continue
        collection["post_count"] = int(row["post_count"])
        collection["posts"] = []
        result.append(collection)
    return result


def query_posts(
    root: Path,
    *,
    scope: str = "all",
    query: str = "",
    collection_path: str = "",
    parent_path: str = "",
    recursive: bool = True,
    include_collections: bool = False,
    recent_first: bool = False,
    full: bool = False,
    offset: int = 0,
    limit: int = 60,
) -> dict:
    if not ready(root):
        return {"posts": [], "total": 0, "offset": 0, "limit": max(1, limit), "has_more": False}
    clauses: list[str] = []
    parameters: list[object] = []
    normalized_scope = str(scope or "all").lower()
    if normalized_scope in {"build", "build_main"}:
        clauses.append("build_visible = 1")
        if not include_collections:
            clauses.append("area != 'collection'")
    elif normalized_scope == "upload":
        clauses.append("area = 'upload'")
    elif normalized_scope == "created":
        clauses.append("area = 'created'")
    elif normalized_scope == "collection":
        clauses.append("area = 'collection'")
    collection_value = _path_key(collection_path)
    if collection_value:
        clauses.append("(path_key = ? OR path_key LIKE ?)")
        parameters.extend((collection_value, f"{collection_value}/%"))
    parent_value = _path_key(parent_path)
    if parent_value:
        if recursive:
            clauses.append("(path_key = ? OR path_key LIKE ?)")
            parameters.extend((parent_value, f"{parent_value}/%"))
        else:
            clauses.append("parent_path_key = ?")
            parameters.append(parent_value)
    search = str(query or "").strip().lower()
    if search:
        pattern = f"%{search}%"
        clauses.append(
            "(LOWER(title) LIKE ? OR LOWER(prompt) LIKE ? OR LOWER(path_key) LIKE ?)"
        )
        parameters.extend((pattern, pattern, pattern))
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    if recent_first:
        order = "activity_at DESC, path"
    elif normalized_scope == "collection" or collection_value or parent_value:
        order = "parent_path_key, grid_slot, order_value, created_at, path"
    else:
        order = "activity_at DESC, path"
    safe_offset = max(0, int(offset or 0))
    safe_limit = min(5000, max(1, int(limit or 60)))
    with _connection(root) as connection:
        count_row = connection.execute(
            f"SELECT COUNT(*) AS count FROM library_posts{where}",
            tuple(parameters),
        ).fetchone()
        json_column = "data_json" if full else "list_json"
        rows = connection.execute(
            f"""
            SELECT {json_column} AS post_json
            FROM library_posts
            {where}
            ORDER BY {order}
            LIMIT ? OFFSET ?
            """,
            (*parameters, safe_limit, safe_offset),
        ).fetchall()
    posts = [post for row in rows if (post := _json_dict(row["post_json"]))]
    total = int(count_row["count"] if count_row else 0)
    return {
        "posts": posts,
        "total": total,
        "offset": safe_offset,
        "limit": safe_limit,
        "next_offset": safe_offset + len(posts),
        "has_more": safe_offset + len(posts) < total,
    }


def counts(root: Path) -> dict:
    if not ready(root):
        return {
            "posts": 0,
            "build": 0,
            "build_main": 0,
            "build_main_with_collections": 0,
            "upload": 0,
            "collection": 0,
        }
    with _connection(root) as connection:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS posts,
                SUM(CASE WHEN build_visible = 1 THEN 1 ELSE 0 END) AS build,
                SUM(
                    CASE
                        WHEN build_visible = 1
                        THEN 1 ELSE 0
                    END
                ) AS build_main_with_collections,
                SUM(
                    CASE
                        WHEN build_visible = 1
                            AND area != 'collection'
                        THEN 1 ELSE 0
                    END
                ) AS build_main,
                SUM(CASE WHEN area = 'upload' THEN 1 ELSE 0 END) AS upload,
                SUM(CASE WHEN area = 'collection' THEN 1 ELSE 0 END) AS collection_count
            FROM library_posts
            """
        ).fetchone()
    return {
        "posts": int(row["posts"] or 0),
        "build": int(row["build"] or 0),
        "build_main": int(row["build_main"] or 0),
        "build_main_with_collections": int(row["build_main_with_collections"] or 0),
        "upload": int(row["upload"] or 0),
        "collection": int(row["collection_count"] or 0),
    }


def query_imagine_remote_posts(
    root: Path,
    account_key: str,
    *,
    offset: int = 0,
    limit: int = 60,
) -> dict:
    normalized_account = str(account_key or "").strip().lower()
    safe_offset = max(0, int(offset or 0))
    safe_limit = min(5000, max(1, int(limit or 60)))
    if not normalized_account:
        return {
            "posts": [],
            "total": 0,
            "offset": safe_offset,
            "limit": safe_limit,
            "next_offset": safe_offset,
            "has_more": False,
            "refreshed_at": 0,
        }
    empty_result = {
        "posts": [],
        "total": 0,
        "offset": safe_offset,
        "limit": safe_limit,
        "next_offset": safe_offset,
        "has_more": False,
        "refreshed_at": 0,
    }
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    if not path.is_file():
        return empty_result
    try:
        with _lock_for(root):
            with _connection(root) as connection:
                count_row = connection.execute(
                    """
                    SELECT COUNT(*) AS count, MAX(refreshed_at) AS refreshed_at
                    FROM imagine_remote_posts
                    WHERE account_key = ?
                    """,
                    (normalized_account,),
                ).fetchone()
                rows = connection.execute(
                    """
                    SELECT post_json
                    FROM imagine_remote_posts
                    WHERE account_key = ?
                    ORDER BY
                        official_order IS NULL,
                        official_order ASC,
                        created_at DESC,
                        post_key
                    LIMIT ? OFFSET ?
                    """,
                    (normalized_account, safe_limit, safe_offset),
                ).fetchall()
    except sqlite3.Error:
        return empty_result
    posts = [post for row in rows if (post := _json_dict(row["post_json"]))]
    total = int(count_row["count"] if count_row else 0)
    next_offset = safe_offset + len(rows)
    return {
        "posts": posts,
        "total": total,
        "offset": safe_offset,
        "limit": safe_limit,
        "next_offset": next_offset,
        "has_more": next_offset < total,
        "refreshed_at": float(count_row["refreshed_at"] or 0) if count_row else 0,
    }


def imagine_remote_asset_account_keys(root: Path, asset_ids: set[str]) -> set[str]:
    """Return accounts that currently index any of the exact remote asset ids."""
    normalized_ids = sorted({
        str(asset_id).strip()
        for asset_id in (asset_ids or set())
        if str(asset_id).strip()
    })
    if not normalized_ids:
        return set()
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    if not path.is_file():
        return set()
    try:
        with _lock_for(root):
            with _connection(root) as connection:
                placeholders = ",".join("?" for _ in normalized_ids)
                rows = connection.execute(
                    f"""
                    SELECT DISTINCT account_key
                    FROM imagine_remote_assets
                    WHERE asset_id IN ({placeholders})
                    """,
                    normalized_ids,
                ).fetchall()
    except sqlite3.Error:
        return set()
    return {str(row["account_key"]).strip().lower() for row in rows if str(row["account_key"] or "").strip()}


def query_imagine_discover_posts(
    root: Path,
    account_key: str,
    *,
    limit: int = 5000,
) -> dict:
    normalized_account = str(account_key or "").strip().lower()
    safe_limit = min(5000, max(1, int(limit or 5000)))
    empty_result = {
        "posts": [],
        "total": 0,
        "next_cursor": "",
        "refreshed_at": 0,
    }
    if not normalized_account:
        return empty_result
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    if not path.is_file():
        return empty_result
    try:
        with _lock_for(root):
            with _connection(root) as connection:
                count_row = connection.execute(
                    """
                    SELECT COUNT(*) AS count, MAX(refreshed_at) AS refreshed_at
                    FROM imagine_discover_posts
                    WHERE account_key = ?
                    """,
                    (normalized_account,),
                ).fetchone()
                state_row = connection.execute(
                    """
                    SELECT next_cursor, refreshed_at
                    FROM imagine_discover_state
                    WHERE account_key = ?
                    """,
                    (normalized_account,),
                ).fetchone()
                rows = connection.execute(
                    """
                    SELECT post_json
                    FROM imagine_discover_posts
                    WHERE account_key = ?
                    ORDER BY position ASC, post_key ASC
                    LIMIT ?
                    """,
                    (normalized_account, safe_limit),
                ).fetchall()
    except sqlite3.Error:
        return empty_result
    posts = [post for row in rows if (post := _json_dict(row["post_json"]))]
    refreshed_at = max(
        float(count_row["refreshed_at"] or 0) if count_row else 0,
        float(state_row["refreshed_at"] or 0) if state_row else 0,
    )
    return {
        "posts": posts,
        "total": int(count_row["count"] if count_row else 0),
        "next_cursor": str(state_row["next_cursor"] or "") if state_row else "",
        "refreshed_at": refreshed_at,
    }


def replace_imagine_discover_posts(
    root: Path,
    account_key: str,
    records: list[dict],
    *,
    next_cursor: str = "",
) -> int:
    normalized_account = str(account_key or "").strip().lower()
    if not normalized_account:
        return 0
    normalized_records: list[tuple[str, dict]] = []
    seen_keys: set[str] = set()
    for record in records if isinstance(records, list) else []:
        if not isinstance(record, dict):
            continue
        post_key = str(record.get("post_key") or "").strip()
        post = record.get("post")
        if not post_key or post_key in seen_keys or not isinstance(post, dict):
            continue
        seen_keys.add(post_key)
        normalized_records.append((post_key, post))
        if len(normalized_records) >= 5000:
            break
    refreshed_at = time.time()
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            connection.execute(
                "DELETE FROM imagine_discover_posts WHERE account_key = ?",
                (normalized_account,),
            )
            if normalized_records:
                connection.executemany(
                    """
                    INSERT INTO imagine_discover_posts(
                        account_key, post_key, position, post_json, refreshed_at
                    ) VALUES(?, ?, ?, ?, ?)
                    """,
                    [
                        (normalized_account, post_key, position, _json_text(post), refreshed_at)
                        for position, (post_key, post) in enumerate(normalized_records)
                    ],
                )
            connection.execute(
                """
                INSERT INTO imagine_discover_state(account_key, next_cursor, refreshed_at)
                VALUES(?, ?, ?)
                ON CONFLICT(account_key) DO UPDATE SET
                    next_cursor = excluded.next_cursor,
                    refreshed_at = excluded.refreshed_at
                """,
                (normalized_account, str(next_cursor or ""), refreshed_at),
            )
    return len(normalized_records)


def upsert_imagine_remote_posts(
    root: Path,
    account_key: str,
    records: list[dict],
    *,
    sync_token: str = "",
) -> int:
    normalized_account = str(account_key or "").strip().lower()
    normalized_sync_token = str(sync_token or "").strip()
    normalized_records = []
    for record in records if isinstance(records, list) else []:
        if not isinstance(record, dict):
            continue
        post_key = str(record.get("post_key") or "").strip()
        post = record.get("post")
        if not post_key or not isinstance(post, dict):
            continue
        asset_ids = sorted({
            str(asset_id).strip()
            for asset_id in (record.get("asset_ids") or [])
            if str(asset_id).strip()
        })
        legacy_post_keys = sorted({
            str(value).strip()
            for value in (record.get("legacy_post_keys") or [])
            if str(value or "").strip() and str(value).strip() != post_key
        })
        normalized_records.append((
            post_key,
            str(record.get("created_at") or post.get("created_at") or ""),
            str(record.get("activity_at") or post_activity_at(post)),
            post,
            asset_ids,
            legacy_post_keys,
            (
                max(0, int(record.get("official_order")))
                if record.get("official_order") is not None
                else None
            ),
        ))
    if not normalized_account or not normalized_records:
        return 0
    refreshed_at = time.time()
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            for post_key, created_at, activity_at, post, asset_ids, legacy_post_keys, official_order in normalized_records:
                if legacy_post_keys:
                    placeholders = ",".join("?" for _ in legacy_post_keys)
                    connection.execute(
                        f"""
                        DELETE FROM imagine_remote_posts
                        WHERE account_key = ? AND post_key IN ({placeholders})
                        """,
                        (normalized_account, *legacy_post_keys),
                    )
                connection.execute(
                    """
                    INSERT INTO imagine_remote_posts(
                        account_key, post_key, created_at, activity_at, post_json, refreshed_at,
                        sync_token, official_order
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(account_key, post_key) DO UPDATE SET
                        created_at = excluded.created_at,
                        activity_at = excluded.activity_at,
                        post_json = excluded.post_json,
                        refreshed_at = excluded.refreshed_at,
                        sync_token = CASE
                            WHEN excluded.sync_token != '' THEN excluded.sync_token
                            ELSE imagine_remote_posts.sync_token
                        END,
                        official_order = CASE
                            WHEN excluded.sync_token != '' THEN excluded.official_order
                            WHEN excluded.official_order IS NOT NULL THEN excluded.official_order
                            ELSE imagine_remote_posts.official_order
                        END
                    """,
                    (
                        normalized_account,
                        post_key,
                        created_at,
                        activity_at,
                        _json_text(post),
                        refreshed_at,
                        normalized_sync_token,
                        official_order,
                    ),
                )
                connection.execute(
                    """
                    DELETE FROM imagine_remote_assets
                    WHERE account_key = ? AND post_key = ?
                    """,
                    (normalized_account, post_key),
                )
                if asset_ids:
                    connection.executemany(
                        """
                        INSERT INTO imagine_remote_assets(account_key, asset_id, post_key)
                        VALUES(?, ?, ?)
                        ON CONFLICT(account_key, asset_id, post_key) DO NOTHING
                        """,
                        [
                            (normalized_account, asset_id, post_key)
                            for asset_id in asset_ids
                        ],
                    )
    return len(normalized_records)


def finalize_imagine_remote_sync(
    root: Path,
    account_key: str,
    sync_token: str,
) -> int:
    normalized_account = str(account_key or "").strip().lower()
    normalized_sync_token = str(sync_token or "").strip()
    if not normalized_account or not normalized_sync_token:
        return 0
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            cursor = connection.execute(
                """
                DELETE FROM imagine_remote_posts
                WHERE account_key = ? AND sync_token != ?
                """,
                (normalized_account, normalized_sync_token),
            )
            return max(0, int(cursor.rowcount or 0))


def delete_imagine_remote_assets(
    root: Path,
    account_key: str,
    asset_ids: set[str],
) -> int:
    normalized_account = str(account_key or "").strip().lower()
    normalized_ids = sorted({
        str(asset_id).strip()
        for asset_id in (asset_ids or set())
        if str(asset_id).strip()
    })
    if not normalized_account or not normalized_ids:
        return 0
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            placeholders = ",".join("?" for _ in normalized_ids)
            rows = connection.execute(
                f"""
                SELECT DISTINCT post_key
                FROM imagine_remote_assets
                WHERE account_key = ? AND asset_id IN ({placeholders})
                """,
                (normalized_account, *normalized_ids),
            ).fetchall()
            post_keys = sorted({str(row["post_key"]) for row in rows if str(row["post_key"])})
            if not post_keys:
                return 0
            placeholders = ",".join("?" for _ in post_keys)
            connection.execute(
                f"""
                DELETE FROM imagine_remote_posts
                WHERE account_key = ? AND post_key IN ({placeholders})
                """,
                (normalized_account, *post_keys),
            )
    return len(post_keys)


def prune_imagine_remote_assets(
    root: Path,
    account_key: str,
    asset_ids: set[str],
) -> int:
    normalized_account = str(account_key or "").strip().lower()
    normalized_ids = sorted({
        str(asset_id).strip()
        for asset_id in (asset_ids or set())
        if str(asset_id).strip()
    })
    if not normalized_account or not normalized_ids:
        return 0

    def item_asset_id(item: dict) -> str:
        if not isinstance(item, dict):
            return ""
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
        return str(
            item.get("asset_id")
            or metadata.get("asset_id")
            or imagine.get("asset_id")
            or item.get("item_id")
            or item.get("post_id")
            or ""
        ).strip()

    changed_posts = 0
    target_ids = set(normalized_ids)
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            placeholders = ",".join("?" for _ in normalized_ids)
            rows = connection.execute(
                f"""
                SELECT DISTINCT assets.post_key, posts.post_json
                FROM imagine_remote_assets AS assets
                JOIN imagine_remote_posts AS posts
                  ON posts.account_key = assets.account_key
                 AND posts.post_key = assets.post_key
                WHERE assets.account_key = ?
                  AND assets.asset_id IN ({placeholders})
                """,
                (normalized_account, *normalized_ids),
            ).fetchall()
            for row in rows:
                post_key = str(row["post_key"] or "").strip()
                if not post_key:
                    continue
                try:
                    post = json.loads(str(row["post_json"] or ""))
                except (TypeError, ValueError, json.JSONDecodeError):
                    post = None
                items = post.get("items") if isinstance(post, dict) and isinstance(post.get("items"), list) else []
                remaining = [
                    item
                    for item in items
                    if isinstance(item, dict) and item_asset_id(item) not in target_ids
                ]
                if not isinstance(post, dict) or not items:
                    connection.execute(
                        """
                        DELETE FROM imagine_remote_posts
                        WHERE account_key = ? AND post_key = ?
                        """,
                        (normalized_account, post_key),
                    )
                    changed_posts += 1
                    continue
                if len(remaining) == len(items):
                    connection.execute(
                        f"""
                        DELETE FROM imagine_remote_assets
                        WHERE account_key = ?
                          AND post_key = ?
                          AND asset_id IN ({placeholders})
                        """,
                        (normalized_account, post_key, *normalized_ids),
                    )
                    continue
                if not remaining:
                    connection.execute(
                        """
                        DELETE FROM imagine_remote_posts
                        WHERE account_key = ? AND post_key = ?
                        """,
                        (normalized_account, post_key),
                    )
                    changed_posts += 1
                    continue
                current_representative = post.get("representative_item")
                current_representative_id = item_asset_id(current_representative)
                representative = next(
                    (
                        item
                        for item in remaining
                        if current_representative_id and item_asset_id(item) == current_representative_id
                    ),
                    remaining[-1],
                )
                post["items"] = remaining
                post["representative_item"] = representative
                post["representative"] = str(
                    representative.get("url")
                    or representative.get("remote_url")
                    or representative.get("object_url")
                    or representative.get("item_id")
                    or ""
                )
                metadata = post.get("metadata") if isinstance(post.get("metadata"), dict) else {}
                primary_ids = metadata.get("local_heart_primary_asset_ids")
                if isinstance(primary_ids, list):
                    metadata["local_heart_primary_asset_ids"] = [
                        value for value in primary_ids if str(value or "").strip() not in target_ids
                    ]
                    post["metadata"] = metadata
                connection.execute(
                    """
                    UPDATE imagine_remote_posts
                    SET post_json = ?
                    WHERE account_key = ? AND post_key = ?
                    """,
                    (
                        json.dumps(post, ensure_ascii=False, separators=(",", ":")),
                        normalized_account,
                        post_key,
                    ),
                )
                connection.execute(
                    f"""
                    DELETE FROM imagine_remote_assets
                    WHERE account_key = ?
                      AND post_key = ?
                      AND asset_id IN ({placeholders})
                    """,
                    (normalized_account, post_key, *normalized_ids),
                )
                changed_posts += 1
    return changed_posts


def delete_imagine_remote_post_keys(
    root: Path,
    account_key: str,
    post_keys: set[str],
) -> int:
    normalized_account = str(account_key or "").strip().lower()
    normalized_keys = sorted({
        str(post_key).strip()
        for post_key in (post_keys or set())
        if str(post_key).strip()
    })
    if not normalized_account or not normalized_keys:
        return 0
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            _create_schema(connection)
            placeholders = ",".join("?" for _ in normalized_keys)
            cursor = connection.execute(
                f"""
                DELETE FROM imagine_remote_posts
                WHERE account_key = ? AND post_key IN ({placeholders})
                """,
                (normalized_account, *normalized_keys),
            )
            return max(0, int(cursor.rowcount or 0))
