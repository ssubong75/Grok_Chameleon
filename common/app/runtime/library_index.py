from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 2
STATE_DIRECTORY = "sql_data"
DATABASE_FILENAME = "library_index.sqlite3"
_LOCKS_GUARD = threading.Lock()
_LOCKS: dict[str, threading.RLock] = {}


def database_path(root: Path) -> Path:
    path = Path(root) / STATE_DIRECTORY / DATABASE_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _lock_for(root: Path) -> threading.RLock:
    key = str(database_path(root).resolve())
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


@contextmanager
def _connection(root: Path, *, write: bool = False):
    path = database_path(root)
    connection = sqlite3.connect(str(path), timeout=20.0)
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
            parent_path TEXT NOT NULL,
            area TEXT NOT NULL,
            collection_name TEXT NOT NULL,
            source TEXT NOT NULL,
            mode TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            created_at TEXT NOT NULL,
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
        CREATE INDEX IF NOT EXISTS library_posts_collection_idx
            ON library_posts(collection_name, parent_path, grid_slot, order_value, created_at, path);
        CREATE INDEX IF NOT EXISTS library_posts_parent_idx
            ON library_posts(area, parent_path, grid_slot, order_value, created_at, path);

        CREATE TABLE IF NOT EXISTS library_collections (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            order_value INTEGER NOT NULL DEFAULT 0,
            sort_mode TEXT NOT NULL,
            post_count INTEGER NOT NULL DEFAULT 0,
            data_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS library_collections_order_idx
            ON library_collections(order_value, name, path);
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


def _safe_int(value, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


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


def _post_list_summary(post: dict) -> dict:
    excluded = {
        "items",
        "representative_item",
        "raw_response",
        "response_body",
        "request_payload",
    }
    summary = {key: value for key, value in post.items() if key not in excluded}
    representative = _list_item(_representative_item(post))
    summary["items"] = [representative] if representative else []
    summary["item_count"] = len(post.get("items") or [])
    summary["_indexed_summary"] = True
    return summary


def _post_row(post: dict) -> tuple:
    path = str(post.get("folder_path") or "").replace("\\", "/").strip("/")
    return (
        path,
        _parent_path(path),
        str(post.get("area") or ""),
        str(post.get("collection") or ""),
        str(post.get("source") or ""),
        str(post.get("mode") or ""),
        str(post.get("title") or ""),
        str(post.get("prompt") or ""),
        str(post.get("created_at") or ""),
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
    return (
        str(collection.get("path") or "").replace("\\", "/").strip("/"),
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
            path, parent_path, area, collection_name, source, mode, title, prompt,
            created_at, build_visible, favorite, order_value, grid_slot, list_json, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            parent_path = excluded.parent_path,
            area = excluded.area,
            collection_name = excluded.collection_name,
            source = excluded.source,
            mode = excluded.mode,
            title = excluded.title,
            prompt = excluded.prompt,
            created_at = excluded.created_at,
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
                        path, name, order_value, sort_mode, post_count, data_json
                    ) VALUES (?, ?, ?, ?, ?, ?)
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
            return bool(
                version
                and complete
                and str(version["value"]) == str(SCHEMA_VERSION)
                and str(complete["value"]) == "1"
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
        str(path or "").replace("\\", "/").strip("/")
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
                        "DELETE FROM library_posts WHERE path = ? OR path LIKE ?",
                        (path, f"{path}/%"),
                    )
                else:
                    connection.execute("DELETE FROM library_posts WHERE path = ?", (path,))


def replace_collections(root: Path, collections: list[dict]) -> None:
    if not ready(root):
        return
    with _lock_for(root):
        with _connection(root, write=True) as connection:
            current_paths = {
                str(collection.get("path") or "").replace("\\", "/").strip("/")
                for collection in collections
                if str(collection.get("path") or "").strip()
            }
            if current_paths:
                placeholders = ",".join("?" for _ in current_paths)
                connection.execute(
                    f"DELETE FROM library_collections WHERE path NOT IN ({placeholders})",
                    tuple(current_paths),
                )
            else:
                connection.execute("DELETE FROM library_collections")
            for collection in collections:
                path = str(collection.get("path") or "").replace("\\", "/").strip("/")
                if not path:
                    continue
                row = connection.execute(
                    "SELECT COUNT(*) AS count FROM library_posts WHERE path = ? OR path LIKE ?",
                    (path, f"{path}/%"),
                ).fetchone()
                count = int(row["count"] if row else 0)
                connection.execute(
                    """
                    INSERT INTO library_collections(
                        path, name, order_value, sort_mode, post_count, data_json
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
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
    normalized = str(path or "").replace("\\", "/").strip("/")
    if not normalized:
        return None
    with _connection(root) as connection:
        row = connection.execute(
            "SELECT data_json FROM library_posts WHERE path = ?",
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
            "SELECT data_json FROM library_posts ORDER BY created_at DESC, path"
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
        if normalized_scope == "build_main":
            clauses.append("(NOT (source = 'build' AND LOWER(mode) = 't2i') OR favorite = 1)")
        if not include_collections:
            clauses.append("area != 'collection'")
    elif normalized_scope == "upload":
        clauses.append("area = 'upload'")
    elif normalized_scope == "created":
        clauses.append("area = 'created'")
    elif normalized_scope == "collection":
        clauses.append("area = 'collection'")
    collection_value = str(collection_path or "").replace("\\", "/").strip("/")
    if collection_value:
        clauses.append("(path = ? OR path LIKE ?)")
        parameters.extend((collection_value, f"{collection_value}/%"))
    parent_value = str(parent_path or "").replace("\\", "/").strip("/")
    if parent_value:
        if recursive:
            clauses.append("(path = ? OR path LIKE ?)")
            parameters.extend((parent_value, f"{parent_value}/%"))
        else:
            clauses.append("parent_path = ?")
            parameters.append(parent_value)
    search = str(query or "").strip().lower()
    if search:
        pattern = f"%{search}%"
        clauses.append(
            "(LOWER(title) LIKE ? OR LOWER(prompt) LIKE ? OR LOWER(path) LIKE ?)"
        )
        parameters.extend((pattern, pattern, pattern))
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    order = (
        "parent_path, grid_slot, order_value, created_at, path"
        if normalized_scope == "collection" or collection_value or parent_value
        else "created_at DESC, path"
    )
    safe_offset = max(0, int(offset or 0))
    safe_limit = min(500, max(1, int(limit or 60)))
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
                            AND (NOT (source = 'build' AND LOWER(mode) = 't2i') OR favorite = 1)
                        THEN 1 ELSE 0
                    END
                ) AS build_main_with_collections,
                SUM(
                    CASE
                        WHEN build_visible = 1
                            AND area != 'collection'
                            AND (NOT (source = 'build' AND LOWER(mode) = 't2i') OR favorite = 1)
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
