#!/usr/bin/env python3
"""Persist Imagine child results against the app's selected individual card."""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_OLD = '''            "hidden_imagine_item_keys": [],
            "imagine_upload_asset_cache": {},
'''

DEFAULT_NEW = '''            "hidden_imagine_item_keys": [],
            "imagine_upload_asset_cache": {},
            "imagine_generated_relations": {},
'''

MERGE_OLD = '''    settings.setdefault("hidden_imagine_item_keys", [])
    settings.setdefault("imagine_upload_asset_cache", {})
'''

MERGE_NEW = '''    settings.setdefault("hidden_imagine_item_keys", [])
    settings.setdefault("imagine_upload_asset_cache", {})
    settings.setdefault("imagine_generated_relations", {})
'''

HELPERS_ANCHOR = '''def imagine_saved_post_from_root(root_post: dict, account: dict) -> dict | None:
'''

HELPERS = r'''def imagine_relation_source_id(source_post_path: str) -> str:
    value = str(source_post_path or "").strip().strip("/")
    if not value:
        return ""
    tail = value.rsplit("/", 1)[-1]
    return imagine_post_id_from_value(tail) or extract_imagine_post_id_from_text(tail) or tail


def imagine_relation_item_key(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("item_id") or item.get("id") or item.get("url") or item.get("remote_url") or "").strip()


def imagine_relation_stored_item(item: dict) -> dict:
    if not isinstance(item, dict):
        return {}
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    raw_url = str(item.get("remote_url") or item.get("url") or metadata.get("remote_url") or metadata.get("media_url") or imagine.get("media_url") or "").strip()
    if not raw_url or raw_url.startswith("data:"):
        return {}
    raw_thumb = str(metadata.get("thumbnail_url") or imagine.get("thumbnail_url") or "").strip()
    if not raw_thumb:
        candidate_thumb = str(item.get("thumbnail_url") or "").strip()
        if candidate_thumb.startswith("http://") or candidate_thumb.startswith("https://"):
            raw_thumb = candidate_thumb
    stored_imagine = {
        key: imagine.get(key)
        for key in (
            "post_id", "root_post_id", "media_type", "source_item_id",
            "original_post_id", "parent_post_id", "original_ref_type",
            "request_id", "action", "aspect_ratio",
        )
        if imagine.get(key) not in (None, "")
    }
    stored_imagine["media_url"] = raw_url
    stored_metadata = {
        "remote_url": raw_url,
        "media_url": raw_url,
        "thumbnail_url": raw_thumb,
        "imagine": stored_imagine,
    }
    if metadata.get("aspect_ratio"):
        stored_metadata["aspect_ratio"] = metadata.get("aspect_ratio")
    return {
        key: item.get(key)
        for key in (
            "item_id", "type", "mime_type", "role", "relation",
            "source_item_id", "original_post_id", "parent_post_id",
            "root_post_id", "original_ref_type", "prompt", "created_at",
            "width", "height", "aspect_ratio", "aspectRatio", "model",
            "resolution_name", "video_duration",
        )
        if item.get(key) not in (None, "")
    } | {
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "thumbnail_url": raw_thumb,
        "metadata": stored_metadata,
    }


def imagine_relation_materialized_item(item: dict, account: dict) -> dict:
    stored = imagine_relation_stored_item(item)
    if not stored:
        return {}
    raw_url = str(stored.get("remote_url") or stored.get("url") or "").strip()
    raw_thumb = str((stored.get("metadata") or {}).get("thumbnail_url") or stored.get("thumbnail_url") or "").strip()
    kind = "video" if str(stored.get("type") or "").lower() == "video" else "image"
    account_id_value = str(account.get("id") or "")
    metadata = dict(stored.get("metadata") or {})
    imagine = dict(metadata.get("imagine") or {})
    imagine.update({
        "media_url": raw_url,
        "media_type": kind,
        "account_id": account_id_value,
        "remote_view": "saved",
        "liked": True,
    })
    metadata.update({
        "remote_url": raw_url,
        "media_url": raw_url,
        "remote_view": "saved",
        "liked": True,
        "imagine": imagine,
    })
    stored.update({
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": imagine_saved_proxy_url(raw_url, kind, account_id_value),
        "thumbnail_url": (
            imagine_saved_proxy_url(raw_url, "image", account_id_value)
            if kind == "image"
            else (imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else "")
        ),
        "metadata": metadata,
        "liked": True,
        "favorite": True,
    })
    return stored


def imagine_persist_generated_relation(
    root: Path,
    source_post_path: str,
    source_item_id: str,
    items: list[dict],
    action: str,
    request_id: str,
) -> None:
    source_id = imagine_relation_source_id(source_post_path)
    stored_items = [stored for stored in (imagine_relation_stored_item(item) for item in items or []) if stored]
    if not source_id or not stored_items:
        return
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})
    relations = settings.get("imagine_generated_relations")
    if not isinstance(relations, dict):
        relations = {}
    record = relations.get(source_id) if isinstance(relations.get(source_id), dict) else {}
    merged: dict[str, dict] = {}
    for candidate in record.get("items") if isinstance(record.get("items"), list) else []:
        key = imagine_relation_item_key(candidate)
        if key:
            merged[key] = imagine_relation_stored_item(candidate)
    for candidate in stored_items:
        key = imagine_relation_item_key(candidate)
        if key:
            merged[key] = candidate
    relations[source_id] = {
        "source_post_id": source_id,
        "source_post_path": str(source_post_path or ""),
        "source_item_id": str(source_item_id or ""),
        "action": str(action or ""),
        "request_id": str(request_id or ""),
        "updated_at": now_iso(),
        "items": list(merged.values())[-120:],
    }
    if len(relations) > 500:
        ordered = sorted(
            relations.items(),
            key=lambda pair: str((pair[1] if isinstance(pair[1], dict) else {}).get("updated_at") or ""),
            reverse=True,
        )[:500]
        relations = dict(ordered)
    settings["imagine_generated_relations"] = relations
    library["updated_at"] = now_iso()
    write_json(library_path, library)
    imagine_debug_event("generated_relation_persisted", {
        "request_id": request_id,
        "action": action,
        "source_post_id": source_id,
        "source_item_id": source_item_id,
        "item_ids": [imagine_relation_item_key(item) for item in stored_items],
    })


def imagine_apply_generated_relations(post: dict, root: Path, account: dict) -> dict:
    if not isinstance(post, dict):
        return post
    post_id = str(post.get("post_id") or "").strip()
    if not post_id:
        return post
    library = merge_library_json(read_json(root / "library.json", {}))
    settings = library.get("settings") if isinstance(library.get("settings"), dict) else {}
    relations = settings.get("imagine_generated_relations") if isinstance(settings.get("imagine_generated_relations"), dict) else {}
    record = relations.get(post_id) if isinstance(relations.get(post_id), dict) else None
    if not record:
        return post
    hidden = {str(value) for value in settings.get("hidden_imagine_item_keys", []) if str(value)}
    existing_items = [dict(item) for item in post.get("items") or [] if isinstance(item, dict)]
    existing_keys = {imagine_relation_item_key(item) for item in existing_items}
    for stored in record.get("items") if isinstance(record.get("items"), list) else []:
        item = imagine_relation_materialized_item(stored, account)
        key = imagine_relation_item_key(item)
        if not key or key in existing_keys:
            continue
        if key in hidden or str(item.get("url") or "") in hidden or str(item.get("remote_url") or "") in hidden:
            continue
        existing_items.append(item)
        existing_keys.add(key)
    if len(existing_items) == len(post.get("items") or []):
        return post
    representative = imagine_representative_item(existing_items) or existing_items[0]
    post.update({
        "items": existing_items,
        "representative_item": representative,
        "representative": representative.get("url") or representative.get("item_id") or post.get("representative") or "",
    })
    metadata = post.get("metadata") if isinstance(post.get("metadata"), dict) else {}
    metadata["app_preserved_generated_relations"] = True
    post["metadata"] = metadata
    return post


'''

SAVED_OLD = '''    posts = [post for post in (imagine_saved_post_from_root(item, account) for item in root_posts) if post]
'''

SAVED_NEW = '''    posts = [
        imagine_apply_generated_relations(post, root, account)
        for post in (imagine_saved_post_from_root(item, account) for item in root_posts)
        if post
    ]
'''

LINK_OLD = '''    post = imagine_saved_post_from_root(raw_post, account)
    if not post:
'''

LINK_NEW = '''    post = imagine_saved_post_from_root(raw_post, account)
    if post:
        post = imagine_apply_generated_relations(post, root, account)
    if not post:
'''

PERSIST_OLD = '''    if not result["target_folder_path"]:
        result["post"] = imagine_direct_post_from_item(item, prompt, account, action)
        result["target_folder_path"] = result["post"]["folder_path"]
    imagine_debug_event("native_bridge_generate_result", {
'''

PERSIST_NEW = '''    if not result["target_folder_path"]:
        result["post"] = imagine_direct_post_from_item(item, prompt, account, action)
        result["target_folder_path"] = result["post"]["folder_path"]
    if source_post_path and action in attach_to_source_actions:
        root = library_root()
        if root:
            imagine_persist_generated_relation(
                root,
                source_post_path,
                str(payload.get("source_item_id") or source_info.get("source_item_id") or ""),
                direct_items or [item],
                action,
                request_id,
            )
    imagine_debug_event("native_bridge_generate_result", {
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if new_count == 1:
        return text
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    raise RuntimeError(f"Unexpected {label} counts old={old_count} new={new_count}.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    text = replace_once(text, DEFAULT_OLD, DEFAULT_NEW, "default relation setting")
    text = replace_once(text, MERGE_OLD, MERGE_NEW, "merged relation setting")
    if "def imagine_relation_source_id(" not in text:
        if text.count(HELPERS_ANCHOR) != 1:
            raise RuntimeError("Imagine saved post helper anchor was not found exactly once.")
        text = text.replace(HELPERS_ANCHOR, HELPERS + HELPERS_ANCHOR, 1)
    text = replace_once(text, SAVED_OLD, SAVED_NEW, "saved relation merge")
    text = replace_once(text, LINK_OLD, LINK_NEW, "linked relation merge")
    text = replace_once(text, PERSIST_OLD, PERSIST_NEW, "generation relation persistence")

    required = (
        '"imagine_generated_relations": {}',
        'settings.setdefault("imagine_generated_relations", {})',
        "def imagine_persist_generated_relation(",
        "def imagine_apply_generated_relations(",
        'imagine_debug_event("generated_relation_persisted"',
        "if source_post_path and action in attach_to_source_actions:",
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required persistent relation markers are missing: {missing}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_PERSISTENT_RELATIONS_PATCHED {path}")
        return True
    print(f"IMAGINE_PERSISTENT_RELATIONS_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("server_py", type=Path)
    args = parser.parse_args()
    if args.server_py.name != "server.py":
        raise RuntimeError("Expected runtime/server.py.")
    patch_file(args.server_py)


if __name__ == "__main__":
    main()
