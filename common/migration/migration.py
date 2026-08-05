#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import shutil
import sys
import time
from urllib.parse import unquote
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MEDIA_EXTENSIONS = {
    ".avif": "image",
    ".gif": "image",
    ".jpeg": "image",
    ".jpg": "image",
    ".png": "image",
    ".webp": "image",
    ".m4v": "video",
    ".mov": "video",
    ".mp4": "video",
    ".webm": "video",
}

ROOT_FOLDERS = ["created", "upload", "collection", "prompt", "account"]
ROOT_MEDIA_FOLDERS = {"Image": "created", "Video": "created"}
UPLOAD_FOLDERS = ["Upload Image", "i_upload"]
GALLERY_FOLDER = "Gallery"
PROMPT_FOLDER = "Prompt"
BUILD_OAUTH_STATE_KEYS = {
    "oauth_invalid",
    "requires_login",
    "oauth_error",
    "oauth_error_at",
    "oauth_error_detail",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def scrub_build_oauth_state(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: scrub_build_oauth_state(item)
            for key, item in value.items()
            if key not in BUILD_OAUTH_STATE_KEYS
        }
    if isinstance(value, list):
        return [scrub_build_oauth_state(item) for item in value]
    return value


def sanitize_build_account(account: dict[str, Any]) -> dict[str, Any]:
    cleaned = scrub_build_oauth_state(account)
    if not isinstance(cleaned, dict):
        return {}
    if str(cleaned.get("status") or "") in {"login_required", "oauth_error"}:
        cleaned["status"] = ""
    return cleaned


def safe_name(value: str, fallback: str = "post") -> str:
    cleaned = "".join(ch if ch not in "/:\\" else "-" for ch in str(value or "")).strip()
    cleaned = " ".join(cleaned.split())
    return cleaned or fallback


def file_stem(name: str) -> str:
    return Path(name).stem


def basename_from_path(value: Any) -> str:
    if not value:
        return ""
    text = str(value).split("?", 1)[0].split("#", 1)[0].replace("\\", "/")
    text = unquote(text)
    return text.rstrip("/").rsplit("/", 1)[-1]


def normalized_path_text(value: Any) -> str:
    if not value:
        return ""
    text = str(value).split("?", 1)[0].split("#", 1)[0].replace("\\", "/")
    if text.startswith("file://"):
        text = text[7:]
    return unquote(text)


def path_segments(value: Any) -> list[str]:
    text = normalized_path_text(value)
    return [part for part in text.split("/") if part]


def collection_parts_from_value(value: Any) -> tuple[str, str] | None:
    parts = path_segments(value)
    for index, part in enumerate(parts):
        if part != GALLERY_FOLDER:
            continue
        if len(parts) <= index + 3:
            continue
        first = parts[index + 1]
        second = parts[index + 2]
        media_folder = parts[index + 3]
        if first and second and media_folder in ROOT_MEDIA_FOLDERS:
            return first, second
    return None


def date_folder(value: Any) -> str:
    if isinstance(value, str) and value:
        try:
            text = value.replace("Z", "+00:00")
            return datetime.fromisoformat(text).strftime("%Y-%m-%d")
        except Exception:
            pass
    return datetime.now().strftime("%Y-%m-%d")


def media_type(path: Path | str) -> str:
    return MEDIA_EXTENSIONS.get(Path(path).suffix.lower(), "")


def media_files_in(path: Path) -> list[Path]:
    if not path.exists() or not path.is_dir():
        return []
    return sorted(
        [item for item in path.iterdir() if item.is_file() and media_type(item)],
        key=lambda item: item.name.lower(),
    )


def media_files_recursive(path: Path) -> list[Path]:
    if not path.exists() or not path.is_dir():
        return []
    files: list[Path] = []
    for current_root, dir_names, file_names in os.walk(path, followlinks=False):
        dir_names[:] = sorted(
            [name for name in dir_names if not name.startswith(".")],
            key=str.lower,
        )
        current = Path(current_root)
        for name in sorted(file_names, key=str.lower):
            if name.startswith(".") or name.startswith("._"):
                continue
            item = current / name
            if item.is_file() and media_type(item):
                files.append(item)
    return files


def txt_files_in(path: Path) -> list[Path]:
    if not path.exists() or not path.is_dir():
        return []
    return sorted(
        [item for item in path.iterdir() if item.is_file() and item.suffix.lower() == ".txt"],
        key=lambda item: item.name.lower(),
    )


def first_value(value: Any, keys: set[str], depth: int = 0) -> Any:
    if depth > 8:
        return None
    if isinstance(value, dict):
        for key in keys:
            if value.get(key) not in (None, ""):
                return value.get(key)
        for child in value.values():
            found = first_value(child, keys, depth + 1)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for child in value[:24]:
            found = first_value(child, keys, depth + 1)
            if found not in (None, ""):
                return found
    return None


MODEL_TEXT_KEYS = {
    "model",
    "modelName",
    "model_name",
    "generation_model",
    "generationModel",
    "image_model",
    "imageModel",
    "imageModelName",
    "video_model",
    "videoModel",
    "videoModelName",
    "video_gen_model",
    "videoGenModel",
}

MODEL_CONTAINER_KEYS = {
    "videoGenModelConfig",
    "model_config",
    "modelConfig",
    "options",
    "context",
    "request",
    "request_body",
    "body",
}


def legacy_model_value(*sources: Any, depth: int = 0, allow_plain: bool = False) -> str:
    if depth > 8:
        return ""
    for source in sources:
        if source in (None, ""):
            continue
        if isinstance(source, (str, int, float)):
            if not allow_plain:
                continue
            text = str(source).strip()
            if text:
                return text
            continue
        if isinstance(source, list):
            found = legacy_model_value(*source[:32], depth=depth + 1)
            if found:
                return found
            continue
        if not isinstance(source, dict):
            continue
        for key in MODEL_TEXT_KEYS:
            value = source.get(key)
            if value in (None, "") or isinstance(value, (dict, list)):
                continue
            found = legacy_model_value(value, depth=depth + 1, allow_plain=True)
            if found:
                return found
        for key in MODEL_CONTAINER_KEYS:
            if key not in source:
                continue
            found = legacy_model_value(source.get(key), depth=depth + 1)
            if found:
                return found
        nested_values = [value for value in source.values() if isinstance(value, (dict, list))]
        found = legacy_model_value(*nested_values, depth=depth + 1)
        if found:
            return found
    return ""


def legacy_group_id(item: dict[str, Any] | None, meta: dict[str, Any] | None) -> str:
    item_meta = item.get("metadata") if isinstance(item, dict) and isinstance(item.get("metadata"), dict) else {}
    return str(
        item_meta.get("group_id")
        or first_value(meta, {"group_id", "groupId", "imagine_group_id"})
        or ""
    )


def legacy_parent_id(item: dict[str, Any] | None, meta: dict[str, Any] | None) -> str:
    item_meta = item.get("metadata") if isinstance(item, dict) and isinstance(item.get("metadata"), dict) else {}
    return str(
        item_meta.get("parent_id")
        or first_value(meta, {"parent_id", "parentId", "parent_post_id", "parentPostId", "remote_parent_id"})
        or ""
    )


def legacy_gallery_folder_id(item: dict[str, Any] | None, meta: dict[str, Any] | None) -> str:
    item_meta = item.get("metadata") if isinstance(item, dict) and isinstance(item.get("metadata"), dict) else {}
    return str(
        item_meta.get("gallery_folder_id")
        or first_value(meta, {"gallery_folder_id", "galleryFolderId"})
        or ""
    )


def legacy_post_identity(item: dict[str, Any] | None, meta: dict[str, Any] | None, source_path: Path) -> tuple[str, str]:
    item = item or {}
    meta = meta or {}
    candidates = [
        ("group", legacy_group_id(item, meta)),
        ("root", first_value(meta, {"root_post_id", "rootPostId", "imagine_root_post_id"})),
        ("parent", legacy_parent_id(item, meta)),
        ("original", first_value(meta, {"original_post_id", "originalPostId"})),
        ("source", first_value(meta, {"source_post_id", "sourcePostId"})),
        ("request", item.get("request_id") or first_value(meta, {"request_id", "requestId"})),
        ("post", first_value(meta, {"post_id", "postId", "imagine_post_id", "imagine_video_post_id"})),
        ("item", item.get("id")),
        ("file", file_stem(source_path.name)),
    ]
    for kind, value in candidates:
        text = str(value or "").strip()
        if text:
            return f"{kind}:{text}", text
    return f"file:{file_stem(source_path.name)}", file_stem(source_path.name)


def legacy_item_id(item: dict[str, Any] | None, meta: dict[str, Any] | None, source_path: Path | str) -> str:
    item = item or {}
    meta = meta or {}
    return str(
        item.get("id")
        or first_value(meta, {"item_id", "itemId", "imagine_image_id", "imagine_video_post_id", "post_id", "postId"})
        or file_stem(str(source_path))
    )


def legacy_root_post_id(meta: dict[str, Any] | None) -> str:
    return str(first_value(meta or {}, {"root_post_id", "rootPostId", "imagine_root_post_id"}) or "")


def legacy_original_post_id(meta: dict[str, Any] | None) -> str:
    return str(first_value(meta or {}, {"original_post_id", "originalPostId"}) or "")


def legacy_source_post_id(meta: dict[str, Any] | None) -> str:
    return str(first_value(meta or {}, {"source_post_id", "sourcePostId"}) or "")


def legacy_item_quality(item: dict[str, Any], meta: dict[str, Any]) -> int:
    score = 0
    if legacy_group_id(item, meta):
        score += 100
    if legacy_parent_id(item, meta):
        score += 20
    if legacy_gallery_folder_id(item, meta):
        score += 20
    if item.get("remote_url"):
        score += 15
    if item.get("request_id"):
        score += 15
    if item.get("metadata_file"):
        score += 10
    if item.get("mode") and item.get("mode") != "import":
        score += 10
    if isinstance(meta, dict) and not meta.get("imported"):
        score += 5
    return score


def normalize_tier(value: Any) -> str:
    tier = str(value or "").lower()
    return tier if tier in {"free", "super", "heavy"} else "free"


def item_created_at(item: dict[str, Any] | None, meta: dict[str, Any] | None, file_path: Path) -> str:
    if item and item.get("created_at"):
        return str(item["created_at"])
    if meta:
        for key in ("created_at", "createTime", "createdAt"):
            value = first_value(meta, {key})
            if value:
                return str(value)
    try:
        return datetime.fromtimestamp(file_path.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return now_iso()


def default_library_json() -> dict[str, Any]:
    timestamp = now_iso()
    return {
        "library_version": 1,
        "created_at": timestamp,
        "updated_at": timestamp,
        "folders": {
            "created": "created",
            "upload": "upload",
            "collection": "collection",
            "prompt": "prompt",
            "account": "account",
        },
        "posts": [],
        "collections": [],
        "prompts": [],
        "settings": {
            "last_screen": "home_main",
            "sort": "created_desc",
        },
    }


@dataclass
class LegacyIndex:
    source_root: Path
    items: list[dict[str, Any]] = field(default_factory=list)
    by_file: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_stem: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_id_prefix: dict[str, dict[str, Any]] = field(default_factory=dict)
    metadata_paths: dict[str, Path] = field(default_factory=dict)

    @classmethod
    def load(cls, source_root: Path) -> "LegacyIndex":
        index = cls(source_root=source_root)
        studio = source_root / ".grok_studio"
        library = read_json(studio / "library.json") or read_json(source_root / "library.json") or {}
        index.items = list(library.get("items") or [])
        for item in index.items:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "")
            if item_id:
                index.by_id[item_id] = item
                if len(item_id) >= 8:
                    index.by_id_prefix.setdefault(item_id[:8].lower(), item)
            for field_name in ("file", "local_url", "remote_url", "url"):
                base = basename_from_path(item.get(field_name))
                if not base:
                    continue
                index.by_file.setdefault(base, item)
                index.by_stem.setdefault(file_stem(base), item)
        metadata_dir = studio / "metadata"
        if metadata_dir.exists():
            for path in metadata_dir.glob("*.json"):
                index.metadata_paths[path.stem] = path
        return index

    def match_item(self, file_path: Path) -> dict[str, Any] | None:
        name = file_path.name
        stem = file_path.stem
        if name in self.by_file:
            return self.by_file[name]
        if stem in self.by_stem:
            return self.by_stem[stem]
        # Legacy filenames commonly contain the first eight characters of an
        # item id.  Checking every id for every file made large scans O(n²).
        # A filename is short, so probe its eight-character windows instead.
        lower_name = name.lower()
        for offset in range(max(0, len(lower_name) - 7)):
            item = self.by_id_prefix.get(lower_name[offset:offset + 8])
            if item:
                return item
        return None

    def metadata_for(self, item: dict[str, Any] | None) -> dict[str, Any]:
        if not item:
            return {}
        merged: dict[str, Any] = {}
        metadata_name = basename_from_path(item.get("metadata_file"))
        if metadata_name:
            disk_meta = read_json(self.metadata_paths.get(file_stem(metadata_name), Path()))
            if isinstance(disk_meta, dict):
                merged.update(disk_meta)
        inline_meta = item.get("metadata")
        if isinstance(inline_meta, dict):
            merged.update(inline_meta)
        return merged


@dataclass
class FileRecord:
    source_path: Path
    target_name: str
    item: dict[str, Any] | None
    meta: dict[str, Any]
    role: str = "result"
    relation: str = ""


def record_created_at(record: FileRecord) -> str:
    return item_created_at(record.item, record.meta, record.source_path)


def representative_record(records: list[FileRecord]) -> FileRecord:
    candidates = [record for record in records if media_type(record.target_name) == "video"] or records
    return sorted(candidates, key=record_created_at)[-1]


class Migrator:
    def __init__(self, source_root: Path, target_root: Path, log=lambda message: None, progress=lambda done, total: None):
        self.source_root = source_root
        self.target_root = target_root
        self.log = log
        self.progress = progress
        self.index: LegacyIndex | None = None
        self.total_steps = 1
        self.done_steps = 0
        self.created_posts: list[dict[str, Any]] = []
        self.imported_item_ids: set[str] = set()
        self.imported_source_paths: set[str] = set()
        self.copied_files = 0
        self.existing_files_skipped = 0

    def ensure_target(self) -> None:
        self.target_root.mkdir(parents=True, exist_ok=True)
        for folder in ROOT_FOLDERS:
            (self.target_root / folder).mkdir(parents=True, exist_ok=True)
        (self.target_root / "cache" / "card-previews").mkdir(parents=True, exist_ok=True)

    def legacy_index(self) -> LegacyIndex:
        if not self.index:
            self.index = LegacyIndex.load(self.source_root)
        return self.index

    def remember_imported(self, item: dict[str, Any] | None, source_path: Path) -> None:
        item_id = str((item or {}).get("id") or "")
        if item_id:
            self.imported_item_ids.add(item_id)
        try:
            self.imported_source_paths.add(str(source_path.resolve()))
        except Exception:
            self.imported_source_paths.add(str(source_path))

    def source_key(self, source_path: Path) -> str:
        try:
            return str(source_path.resolve())
        except Exception:
            return str(source_path)

    def already_imported(self, item: dict[str, Any] | None, source_path: Path) -> bool:
        item_id = str((item or {}).get("id") or "")
        if item_id and item_id in self.imported_item_ids:
            return True
        return self.source_key(source_path) in self.imported_source_paths

    def candidate_paths_for_item(self, item: dict[str, Any]) -> list[Path]:
        candidates: list[Path] = []

        def add(path: Path) -> None:
            if path not in candidates:
                candidates.append(path)

        for field_name in ("file", "local_url"):
            text = normalized_path_text(item.get(field_name))
            if not text:
                continue
            if text.startswith("/media/"):
                add(self.source_root / text[len("/media/"):])
            for anchor in ("/Volumes/WORK/Grok/", "/Volumes/Work/Grok/"):
                if text.startswith(anchor):
                    add(self.source_root / text[len(anchor):])
            path = Path(text)
            add(path if path.is_absolute() else self.source_root / path)

        base_name = basename_from_path(item.get("file")) or basename_from_path(item.get("local_url"))
        if base_name:
            category = str(item.get("category") or "")
            if category in ROOT_MEDIA_FOLDERS:
                add(self.source_root / category / base_name)
            for folder_name in UPLOAD_FOLDERS:
                add(self.source_root / folder_name / base_name)
        return candidates

    def resolve_item_file(self, item: dict[str, Any]) -> Path | None:
        for candidate in self.candidate_paths_for_item(item):
            if candidate.exists() and candidate.is_file() and media_type(candidate):
                return candidate
        return None

    def resolve_media_reference(self, value: Any) -> Path | None:
        text = normalized_path_text(value)
        if not text:
            return None
        candidates: list[Path] = []

        def add(path: Path) -> None:
            if path not in candidates:
                candidates.append(path)

        if text.startswith("/media/"):
            add(self.source_root / text[len("/media/"):])
        for anchor in ("/Volumes/WORK/Grok/", "/Volumes/Work/Grok/", "/Volumes/WORK/Grok11/", "/Volumes/Work/Grok11/"):
            if text.startswith(anchor):
                add(self.source_root / text[len(anchor):])
        path = Path(text)
        add(path if path.is_absolute() else self.source_root / path)
        base_name = basename_from_path(text)
        if base_name:
            for folder_name in [*UPLOAD_FOLDERS, *ROOT_MEDIA_FOLDERS.keys()]:
                add(self.source_root / folder_name / base_name)
            gallery = self.source_root / GALLERY_FOLDER
            if gallery.exists():
                for found in gallery.rglob(base_name):
                    add(found)
        for candidate in candidates:
            if candidate.exists() and candidate.is_file() and media_type(candidate):
                return candidate
        return None

    def media_references_for_meta(self, meta: dict[str, Any]) -> list[tuple[str, str, Path]]:
        references: list[tuple[str, str, Path]] = []

        def add(role: str, value: Any) -> None:
            path = self.resolve_media_reference(value)
            if path:
                references.append((role, str(value or ""), path))

        original = first_value(meta, {"original_image", "originalImage", "input_image", "inputImage"})
        if original:
            add("original", original)
        legacy_input = meta.get("start_image") if isinstance(meta, dict) else None
        if isinstance(legacy_input, dict):
            add("input", legacy_input.get("url"))
        for source in meta.get("source_images") or []:
            if isinstance(source, dict):
                add("original", source.get("url"))
        for reference in meta.get("reference_images") or []:
            if isinstance(reference, dict):
                add("reference", reference.get("url"))
        return references

    def append_reference_records(self, group: dict[str, Any], meta: dict[str, Any], target_dir: Path) -> None:
        assert self.index
        for role, relation, reference_path in self.media_references_for_meta(meta):
            source_key = self.source_key(reference_path)
            if source_key in group["source_keys"]:
                continue
            reference_item = self.index.match_item(reference_path)
            reference_meta = self.index.metadata_for(reference_item)
            target_name = self.copy_file_unique(reference_path, target_dir)
            group["records"].append(FileRecord(reference_path, target_name, reference_item, reference_meta, role=role, relation=relation))
            group["source_keys"].add(source_key)
            if reference_item and str(reference_item.get("category") or "") in ROOT_MEDIA_FOLDERS:
                self.remember_imported(reference_item, reference_path)

    def collection_parts_for_item(self, item: dict[str, Any], source_path: Path) -> tuple[str, str] | None:
        for field_name in ("local_url", "file"):
            parts = collection_parts_from_value(item.get(field_name))
            if parts:
                return parts
        return collection_parts_from_value(str(source_path))

    def library_media_plan(self) -> list[tuple[dict[str, Any], dict[str, Any], Path, tuple[str, str] | None]]:
        index = self.legacy_index()
        by_source_path: dict[str, tuple[int, int, dict[str, Any], dict[str, Any], Path, tuple[str, str] | None]] = {}
        for item in index.items:
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or "")
            item_type = str(item.get("type") or "").lower()
            if category not in ROOT_MEDIA_FOLDERS and item_type not in {"image", "video"}:
                continue
            source_path = self.resolve_item_file(item)
            if not source_path:
                continue
            meta = index.metadata_for(item)
            try:
                source_key = str(source_path.resolve())
            except Exception:
                source_key = str(source_path)
            score = legacy_item_quality(item, meta)
            current = by_source_path.get(source_key)
            if not current or score > current[0]:
                sequence = current[1] if current else len(by_source_path)
                by_source_path[source_key] = (score, sequence, item, meta, source_path, self.collection_parts_for_item(item, source_path))
        return [
            (item, meta, source_path, collection_parts)
            for _score, _sequence, item, meta, source_path, collection_parts
            in sorted(by_source_path.values(), key=lambda row: row[1])
        ]

    def scan(self) -> dict[str, Any]:
        self.log("Scan: loading library index...")
        studio = self.source_root / ".grok_studio"
        library = read_json(studio / "library.json") or {}
        accounts = read_json(studio / "accounts.json") or {}
        plan = self.library_media_plan()
        self.log(f"Scan: indexed {len(plan)} library media items.")
        planned_item_ids = {str(item.get("id") or "") for item, _meta, _path, _parts in plan if item.get("id")}
        planned_paths = set()
        for _item, _meta, source_path, _parts in plan:
            try:
                planned_paths.add(str(source_path.resolve()))
            except Exception:
                planned_paths.add(str(source_path))

        gallery_groups = {parts for _item, _meta, _path, parts in plan if parts}
        gallery_media_count = sum(1 for _item, _meta, _path, parts in plan if parts)
        root_media_count = sum(1 for _item, _meta, _path, parts in plan if not parts)
        bytes_total = sum(source_path.stat().st_size for _item, _meta, source_path, _parts in plan)

        gallery = self.source_root / GALLERY_FOLDER
        self.log("Scan: checking collection folders...")
        if gallery.exists():
            for first in sorted([item for item in gallery.iterdir() if item.is_dir()], key=lambda item: item.name.lower()):
                for second in sorted([item for item in first.iterdir() if item.is_dir()], key=lambda item: item.name.lower()):
                    extras = []
                    for file_path in media_files_in(second):
                        try:
                            source_key = str(file_path.resolve())
                        except Exception:
                            source_key = str(file_path)
                        if source_key not in planned_paths:
                            extras.append(file_path)
                    if extras:
                        gallery_groups.add((first.name, second.name))
                        gallery_media_count += len(extras)
                        bytes_total += sum(path.stat().st_size for path in extras)

        extra_root_media_count = 0
        index = self.legacy_index()
        self.log("Scan: checking created media folders...")
        for folder in ROOT_MEDIA_FOLDERS:
            for file_path in media_files_in(self.source_root / folder):
                item = index.match_item(file_path)
                item_id = str((item or {}).get("id") or "")
                try:
                    source_key = str(file_path.resolve())
                except Exception:
                    source_key = str(file_path)
                if source_key in planned_paths or (item_id and item_id in planned_item_ids):
                    continue
                extra_root_media_count += 1
                bytes_total += file_path.stat().st_size
        root_media_count += extra_root_media_count

        upload_count = sum(len(media_files_in(self.source_root / folder)) for folder in UPLOAD_FOLDERS)
        self.log("Scan: checking uploads, prompts, and accounts...")
        prompt_count = len(txt_files_in(self.source_root / PROMPT_FOLDER))
        metadata_count = len(list((studio / "metadata").glob("*.json"))) if (studio / "metadata").exists() else 0
        auth_count = len(list((studio / "account_auth").glob("*.json"))) if (studio / "account_auth").exists() else 0
        for folder in UPLOAD_FOLDERS:
            for file_path in media_files_in(self.source_root / folder):
                bytes_total += file_path.stat().st_size
        result = {
            "source": str(self.source_root),
            "target": str(self.target_root),
            "library_items": len(library.get("items") or []),
            "metadata_json": metadata_count,
            "root_media": root_media_count,
            "upload_media": upload_count,
            "gallery_folders": len(gallery_groups),
            "gallery_media": gallery_media_count,
            "prompts": prompt_count,
            "build_accounts": len(accounts.get("accounts") or []),
            "imagine_accounts": len(accounts.get("imagine_accounts") or []),
            "account_auth_files": auth_count,
            "bytes": bytes_total,
        }
        self.log("Scan: complete.")
        return result

    def load_index(self) -> None:
        self.index = LegacyIndex.load(self.source_root)

    def step(self) -> None:
        self.done_steps += 1
        self.progress(self.done_steps, self.total_steps)

    def copy_file_unique(self, source_path: Path, target_dir: Path, preferred_name: str | None = None) -> str:
        target_dir.mkdir(parents=True, exist_ok=True)
        preferred = preferred_name or source_path.name
        target = target_dir / preferred
        if target.exists():
            try:
                if target.stat().st_size == source_path.stat().st_size:
                    self.existing_files_skipped += 1
                    return target.name
            except Exception:
                pass
            stem = target.stem
            suffix = target.suffix
            index = 2
            while True:
                candidate = target_dir / f"{stem}-{index}{suffix}"
                if not candidate.exists():
                    target = candidate
                    break
                index += 1
        shutil.copy2(source_path, target)
        self.copied_files += 1
        return target.name

    def reusable_post_dir(self, parent_dir: Path, preferred_name: str, post_id: str) -> Path:
        path = parent_dir / preferred_name
        if path.exists():
            existing = read_json(path / "post.json")
            if not post_id or not existing or existing.get("post_id") == post_id:
                return path
            index = 2
            while True:
                candidate = parent_dir / f"{preferred_name}-{index}"
                if not candidate.exists():
                    return candidate
                existing = read_json(candidate / "post.json")
                if existing and existing.get("post_id") == post_id:
                    return candidate
                index += 1
        return path

    def collection_post_dir(self, parent_dir: Path, preferred_name: str, post_id: str, used_names: set[str]) -> Path:
        base_name = safe_name(preferred_name, "item")
        index = 1
        while True:
            name = base_name if index == 1 else f"{base_name}-{index}"
            name_key = name.lower()
            path = parent_dir / name
            existing = read_json(path / "post.json") if path.exists() else None
            can_reuse = (
                name_key not in used_names
                and (
                    not path.exists()
                    or not existing
                    or not post_id
                    or str(existing.get("post_id") or "") == str(post_id)
                )
            )
            if can_reuse:
                used_names.add(name_key)
                return path
            index += 1

    def ensure_collection_item_folder(self, first: str, second: str) -> Path:
        first_name = safe_name(first, "Category")
        second_name = safe_name(second, "Item")
        item_dir = self.target_root / "collection" / first_name / second_name
        item_dir.mkdir(parents=True, exist_ok=True)
        folder_path = item_dir.relative_to(self.target_root).as_posix()
        existing = read_json(item_dir / "post.json")
        if not isinstance(existing, dict):
            existing = {}
        post = {
            **existing,
            "post_id": existing.get("post_id") or second_name,
            "source": existing.get("source") or "local",
            "mode": existing.get("mode") or "folder",
            "title": second,
            "prompt": existing.get("prompt") or "",
            "created_at": existing.get("created_at") or now_iso(),
            "updated_at": now_iso(),
            "folder_path": folder_path,
            "collection": first_name,
            "area": "collection",
            "folder_role": "container",
            "representative": "",
            "items": [],
        }
        write_json(item_dir / "post.json", post)
        return item_dir

    def source_for(self, item: dict[str, Any] | None, meta: dict[str, Any], fallback: str) -> str:
        provider = item.get("provider") if item else None
        provider = provider or first_value(meta, {"provider", "token_source"})
        category = item.get("category") if item else ""
        if provider == "imagine" or category == "Imagine" or first_value(meta, {"imagine_post_id", "imagine_image_id", "imagine_video_post_id"}):
            return "imagine"
        if fallback in {"build", "local"}:
            return fallback
        return "build"

    def post_json(self, *, area: str, folder_path: str, folder_name: str, collection: str | None, records: list[FileRecord], fallback_source: str, post_id_override: str = "") -> dict[str, Any]:
        first = records[0]
        item = first.item or {}
        meta = first.meta or {}
        created_at = item_created_at(item, meta, first.source_path)
        group_id = legacy_group_id(item, meta)
        parent_id = legacy_parent_id(item, meta)
        root_post_id = legacy_root_post_id(meta)
        original_post_id = legacy_original_post_id(meta)
        source_post_id = legacy_source_post_id(meta)
        post_id = str(post_id_override or item.get("id") or first_value(meta, {"post_id", "imagine_post_id", "imagine_video_post_id"}) or file_stem(first.target_name))
        source = self.source_for(item, meta, fallback_source)
        representative = representative_record(records)
        def prompt_for_record(record: FileRecord) -> str:
            record_item = record.item or {}
            record_meta = record.meta or {}
            return str(record_item.get("prompt") or first_value(record_meta, {"prompt", "full_prompt"}) or "")

        post_prompt = prompt_for_record(first) or next((prompt for prompt in (prompt_for_record(record) for record in records) if prompt), "")
        record_infos = []
        relation_target_ids: set[str] = set()
        for record in records:
            record_item = record.item or {}
            record_meta = record.meta or {}
            record_item_meta = record_item.get("metadata") if isinstance(record_item.get("metadata"), dict) else {}
            record_type = media_type(record.target_name)
            record_id = legacy_item_id(record_item, record_meta, record.source_path)
            record_group_id = legacy_group_id(record_item, record_meta)
            record_parent_id = legacy_parent_id(record_item, record_meta)
            record_root_post_id = legacy_root_post_id(record_meta)
            record_original_post_id = legacy_original_post_id(record_meta)
            record_source_post_id = legacy_source_post_id(record_meta)
            for relation_id in (record_parent_id, record_original_post_id, record_source_post_id):
                if relation_id and relation_id != record_id:
                    relation_target_ids.add(relation_id)
            record_infos.append({
                "record": record,
                "item": record_item,
                "meta": record_meta,
                "item_meta": record_item_meta,
                "type": record_type,
                "item_id": record_id,
                "group_id": record_group_id,
                "parent_id": record_parent_id,
                "root_post_id": record_root_post_id,
                "original_post_id": record_original_post_id,
                "source_post_id": record_source_post_id,
            })

        group_id = group_id or next((info["group_id"] for info in record_infos if info["group_id"]), "")
        parent_id = parent_id or next((info["parent_id"] for info in record_infos if info["parent_id"]), "")
        root_post_id = root_post_id or next((info["root_post_id"] for info in record_infos if info["root_post_id"]), "")
        original_post_id = original_post_id or next((info["original_post_id"] for info in record_infos if info["original_post_id"]), "")
        source_post_id = source_post_id or next((info["source_post_id"] for info in record_infos if info["source_post_id"]), "")
        post_model = legacy_model_value(item, meta)
        if not post_model:
            for info in record_infos:
                post_model = legacy_model_value(info["item"], info["meta"], info["item_meta"])
                if post_model:
                    break

        id_to_item_id = {info["item_id"]: info["item_id"] for info in record_infos if info["item_id"]}
        source_infos = [
            info for info in record_infos
            if info["item_id"] in relation_target_ids
            or (
                info["group_id"]
                and info["item_id"] == info["group_id"]
                and any(other["parent_id"] == info["group_id"] for other in record_infos if other is not info)
            )
            or str(info["record"].role or "").lower() in {"source", "original", "input", "start", "parent"}
        ]
        fallback_source_item_id = source_infos[0]["item_id"] if len(source_infos) == 1 else ""

        items = []
        for info in record_infos:
            record = info["record"]
            record_item = info["item"]
            record_meta = info["meta"]
            record_item_meta = info["item_meta"]
            record_type = info["type"]
            record_id = info["item_id"]
            record_remote_url = (
                record_item.get("remote_url")
                or first_value(record_meta, {"remote_url", "imagine_media_url", "imagine_video_media_url", "url"})
                or None
            )
            raw_role = "upload" if area == "upload" else (record.role or "result")
            if area != "upload" and raw_role == "result" and record_id in relation_target_ids:
                raw_role = "source"
            source_item_id = ""
            relation_id = info["parent_id"] or info["original_post_id"] or info["source_post_id"]
            if relation_id and relation_id in id_to_item_id and relation_id != record_id:
                source_item_id = id_to_item_id[relation_id]
            elif raw_role == "result" and fallback_source_item_id and fallback_source_item_id != record_id:
                source_item_id = fallback_source_item_id
            item_data = {
                "item_id": record_id,
                "type": record_type,
                "file": record.target_name,
                "mime_type": mimetypes.guess_type(record.target_name)[0] or record_item.get("mime") or "",
                "role": raw_role,
                "relation": record.relation,
                "url": record_remote_url,
                "title": record_item.get("title") or safe_name(file_stem(record.target_name)),
                "prompt": prompt_for_record(record) or post_prompt,
                "mode": record_item.get("mode") or first_value(record_meta, {"mode", "generation_mode"}) or "",
                "created_at": item_created_at(record_item, record_meta, record.source_path),
                "updated_at": record_item.get("updated_at") or "",
                "model": legacy_model_value(record_item, record_meta, record_item_meta),
                "group_id": info["group_id"],
                "parent_id": info["parent_id"],
                "root_post_id": info["root_post_id"],
                "original_post_id": info["original_post_id"],
                "source_post_id": info["source_post_id"],
                "gallery_folder_id": legacy_gallery_folder_id(record_item, record_meta),
                "request_id": record_item.get("request_id") or first_value(record_meta, {"request_id"}) or "",
                "duration": record_item_meta.get("duration") or record_meta.get("duration") or "",
                "aspect_ratio": record_item_meta.get("aspect_ratio") or record_meta.get("aspect_ratio") or "",
                "resolution": record_item_meta.get("resolution") or record_meta.get("resolution") or "",
                "local_url": record_item.get("local_url") or "",
                "remote_url": record_item.get("remote_url") or "",
                "metadata_file": basename_from_path(record_item.get("metadata_file")),
                "legacy": {
                    "category": record_item.get("category") or "",
                    "source_file_name": record.source_path.name,
                    "source_path": str(record.source_path),
                    "file": record_item.get("file") or "",
                    "mime": record_item.get("mime") or "",
                    "tags": record_item.get("tags") if isinstance(record_item.get("tags"), list) else [],
                },
            }
            if source_item_id:
                item_data["source_item_id"] = source_item_id
                item_data["parent_item_id"] = source_item_id
            if info["parent_id"]:
                item_data["parent_post_id"] = info["parent_id"]
            if info["original_post_id"]:
                item_data["original_item_id"] = info["original_post_id"]
            if info["root_post_id"]:
                item_data["root_item_id"] = info["root_post_id"]
            if record.relation:
                if raw_role in {"source", "original", "input", "start", "parent"}:
                    item_data["source_url"] = record.relation
                    item_data["original_url"] = record.relation
                elif raw_role == "reference":
                    item_data["reference_urls"] = [record.relation]
            items.append(item_data)
        return {
            "post_id": post_id,
            "source": source,
            "mode": item.get("mode") or first_value(meta, {"mode", "generation_mode"}) or "",
            "title": item.get("title") or safe_name(folder_name),
            "prompt": post_prompt,
            "original_prompt": first_value(meta, {"original_prompt", "originalPrompt"}) or "",
            "created_at": created_at,
            "updated_at": now_iso(),
            "imported_at": now_iso(),
            "model": post_model,
            "group_id": group_id or "",
            "parent_id": parent_id or "",
            "root_post_id": root_post_id or "",
            "original_post_id": original_post_id or "",
            "source_post_id": source_post_id or "",
            "account_id": first_value(meta, {"account_id", "imagine_account_id"}) or "",
            "account_email": first_value(meta, {"account_email", "imagine_account_email"}) or "",
            "folder_path": folder_path,
            "collection": collection,
            "area": area,
            "representative": representative.target_name,
            "items": items,
            "legacy": {
                "category": item.get("category") or "",
                "local_url": item.get("local_url") or "",
                "remote_url": item.get("remote_url") or "",
                "request_id": item.get("request_id") or first_value(meta, {"request_id"}) or "",
                "metadata_file_name": basename_from_path(item.get("metadata_file")),
                "source_file_name": first.source_path.name,
                "gallery_folder_id": legacy_gallery_folder_id(item, meta),
                "item_count": len(items),
            },
        }

    def import_library_media(self) -> dict[str, int]:
        collection_groups: dict[tuple[str, str, str], dict[str, Any]] = {}
        created_groups: dict[str, dict[str, Any]] = {}

        for item, meta, source_path, collection_parts in self.library_media_plan():
            if self.already_imported(item, source_path):
                continue
            if collection_parts:
                first, second = collection_parts
                identity_key, post_id = legacy_post_identity(item, meta, source_path)
                group = collection_groups.setdefault((first, second, identity_key), {
                    "first": first,
                    "second": second,
                    "post_id": post_id,
                    "entries": [],
                })
                group["entries"].append((item, meta, source_path))
                continue

            created_at = item_created_at(item, meta, source_path)
            date_dir = self.target_root / "created" / date_folder(created_at)
            group_id = legacy_group_id(item, meta)
            post_id = str(group_id or item.get("id") or file_stem(source_path.name))
            group_key = post_id or str(source_path)
            if group_key not in created_groups:
                post_dir = self.reusable_post_dir(date_dir, safe_name(post_id), post_id)
                created_groups[group_key] = {
                    "date_dir": date_dir,
                    "post_dir": post_dir,
                    "post_id": post_id,
                    "records": [],
                    "source_keys": set(),
                }
            group = created_groups[group_key]
            post_dir = group["post_dir"]
            target_name = self.copy_file_unique(source_path, post_dir)
            record = FileRecord(source_path, target_name, item, meta)
            group["records"].append(record)
            group["source_keys"].add(self.source_key(source_path))
            self.append_reference_records(group, meta, post_dir)
            self.remember_imported(item, source_path)
            self.step()

        for group in created_groups.values():
            date_dir = group["date_dir"]
            post_dir = group["post_dir"]
            post = self.post_json(
                area="created",
                folder_path=f"created/{date_dir.name}/{post_dir.name}",
                folder_name=post_dir.name,
                collection=None,
                records=group["records"],
                fallback_source="build",
                post_id_override=group["post_id"],
            )
            write_json(post_dir / "post.json", post)

        collection_dir_names: dict[str, set[str]] = {}
        collection_post_count = 0
        collection_media_count = 0
        for group in collection_groups.values():
            first = group["first"]
            second = group["second"]
            parent_dir = self.ensure_collection_item_folder(first, second)
            used_names = collection_dir_names.setdefault(str(parent_dir), set())
            target_dir = self.collection_post_dir(parent_dir, group["post_id"] or "card", group["post_id"], used_names)
            target_dir.mkdir(parents=True, exist_ok=True)
            copy_group = {"records": [], "source_keys": set()}
            for item, meta, source_path in group["entries"]:
                if self.already_imported(item, source_path):
                    continue
                target_name = self.copy_file_unique(source_path, target_dir)
                copy_group["records"].append(FileRecord(source_path, target_name, item, meta))
                copy_group["source_keys"].add(self.source_key(source_path))
                self.append_reference_records(copy_group, meta, target_dir)
                self.remember_imported(item, source_path)
                self.step()
            records = copy_group["records"]
            if not records:
                continue
            folder_path = target_dir.relative_to(self.target_root).as_posix()
            post = self.post_json(
                area="collection",
                folder_path=folder_path,
                folder_name=target_dir.name,
                collection=parent_dir.parent.name,
                records=records,
                fallback_source="local",
                post_id_override=group["post_id"],
            )
            write_json(target_dir / "post.json", post)
            collection_post_count += 1
            collection_media_count += len(records)

        return {
            "created": len(created_groups),
            "collection_posts": collection_post_count,
            "collection_media": collection_media_count,
        }

    def import_flat_media(self, folder_name: str, area: str, fallback_source: str) -> int:
        assert self.index
        source_dir = self.source_root / folder_name
        count = 0
        for source_path in media_files_in(source_dir):
            item = self.index.match_item(source_path)
            if self.already_imported(item, source_path):
                continue
            meta = self.index.metadata_for(item)
            created_at = item_created_at(item, meta, source_path)
            date_dir = self.target_root / area / date_folder(created_at)
            post_id = str((item or {}).get("id") or file_stem(source_path.name))
            post_dir = self.reusable_post_dir(date_dir, safe_name(post_id), post_id)
            target_name = self.copy_file_unique(source_path, post_dir)
            record = FileRecord(source_path, target_name, item, meta)
            post = self.post_json(
                area=area,
                folder_path=f"{area}/{date_dir.name}/{post_dir.name}",
                folder_name=post_dir.name,
                collection=None,
                records=[record],
                fallback_source=fallback_source,
            )
            write_json(post_dir / "post.json", post)
            self.remember_imported(item, source_path)
            count += 1
            self.step()
        return count

    def import_external_media(self, media_root: Path) -> dict[str, Any]:
        media_root = media_root.expanduser()
        if not media_root.is_dir():
            raise RuntimeError("Media folder does not exist.")
        media_root = media_root.resolve()
        target_root = self.target_root.expanduser().resolve()
        if media_root == target_root or media_root in target_root.parents or target_root in media_root.parents:
            raise RuntimeError("Media folder and New Library Folder cannot overlap.")

        self.ensure_target()
        media_files = media_files_recursive(media_root)
        self.total_steps = max(1, len(media_files) + 1)
        self.done_steps = 0
        total_bytes = sum(path.stat().st_size for path in media_files)
        self.log(f"Scanning other media: {media_root}")
        self.log(f"Found {len(media_files)} media files ({human_size(total_bytes)}).")

        imported_posts = 0
        for source_path in media_files:
            relative_path = source_path.relative_to(media_root).as_posix()
            stat = source_path.stat()
            identity = f"{relative_path}\0{stat.st_size}\0{stat.st_mtime_ns}"
            post_id = f"import-{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:16]}"
            created_at = item_created_at(None, None, source_path)
            date_dir = self.target_root / "created" / date_folder(created_at)
            post_dir = self.reusable_post_dir(
                date_dir,
                safe_name(file_stem(source_path.name), "media"),
                post_id,
            )
            target_name = self.copy_file_unique(source_path, post_dir)
            item = {
                "id": post_id,
                "title": safe_name(file_stem(source_path.name), "media"),
                "mode": "import",
            }
            record = FileRecord(source_path, target_name, item, {})
            post = self.post_json(
                area="created",
                folder_path=post_dir.relative_to(self.target_root).as_posix(),
                folder_name=post_dir.name,
                collection=None,
                records=[record],
                fallback_source="build",
                post_id_override=post_id,
            )
            post["import_source_root"] = str(media_root)
            post["import_source_relative_path"] = relative_path
            write_json(post_dir / "post.json", post)
            imported_posts += 1
            self.step()

        self.log("Updating library.json...")
        self.write_library_json()
        self.step()
        self.log("Import complete.")
        return {
            "source": str(media_root),
            "target": str(self.target_root),
            "found_media": len(media_files),
            "imported_posts": imported_posts,
            "copied_files": self.copied_files,
            "existing_files_skipped": self.existing_files_skipped,
            "bytes": total_bytes,
        }

    def import_gallery(self) -> int:
        assert self.index
        gallery = self.source_root / GALLERY_FOLDER
        if not gallery.exists():
            return 0
        count = 0
        collection_dir_names: dict[str, set[str]] = {}
        for first_dir in sorted([item for item in gallery.iterdir() if item.is_dir()], key=lambda item: item.name.lower()):
            for second_dir in sorted([item for item in first_dir.iterdir() if item.is_dir()], key=lambda item: item.name.lower()):
                media_files = media_files_in(second_dir)
                if not media_files:
                    continue
                gallery_groups: dict[str, dict[str, Any]] = {}
                for source_path in media_files:
                    item = self.index.match_item(source_path)
                    if self.already_imported(item, source_path):
                        continue
                    meta = self.index.metadata_for(item)
                    identity_key, post_id = legacy_post_identity(item, meta, source_path)
                    group = gallery_groups.setdefault(identity_key, {
                        "post_id": post_id,
                        "entries": [],
                    })
                    group["entries"].append((item, meta, source_path))
                for group in gallery_groups.values():
                    parent_dir = self.ensure_collection_item_folder(first_dir.name, second_dir.name)
                    used_names = collection_dir_names.setdefault(str(parent_dir), set())
                    target_dir = self.collection_post_dir(parent_dir, group["post_id"] or "card", group["post_id"], used_names)
                    target_dir.mkdir(parents=True, exist_ok=True)
                    copy_group = {"records": [], "source_keys": set()}
                    for item, meta, source_path in group["entries"]:
                        if self.already_imported(item, source_path):
                            continue
                        target_name = self.copy_file_unique(source_path, target_dir)
                        copy_group["records"].append(FileRecord(source_path, target_name, item, meta))
                        copy_group["source_keys"].add(self.source_key(source_path))
                        self.append_reference_records(copy_group, meta, target_dir)
                        self.remember_imported(item, source_path)
                        self.step()
                    records = copy_group["records"]
                    if not records:
                        continue
                    folder_path = target_dir.relative_to(self.target_root).as_posix()
                    post = self.post_json(
                        area="collection",
                        folder_path=folder_path,
                        folder_name=target_dir.name,
                        collection=parent_dir.parent.name,
                        records=records,
                        fallback_source="local",
                        post_id_override=group["post_id"],
                    )
                    write_json(target_dir / "post.json", post)
                    count += 1
        return count

    def import_prompts(self) -> int:
        source_dir = self.source_root / PROMPT_FOLDER
        target_dir = self.target_root / "prompt"
        count = 0
        for source_path in txt_files_in(source_dir):
            self.copy_file_unique(source_path, target_dir)
            count += 1
            self.step()
        return count

    def merge_accounts(self, existing: list[dict[str, Any]], imported: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged = list(existing)
        seen = {account.get("email") or account.get("id") or account.get("label") for account in merged}
        for account in imported:
            key = account.get("email") or account.get("id") or account.get("label")
            if key in seen:
                continue
            seen.add(key)
            merged.append(account)
        return merged

    def import_auth(self) -> dict[str, int]:
        studio = self.source_root / ".grok_studio"
        legacy = read_json(studio / "accounts.json") or {}
        account_auth_dir = studio / "account_auth"
        source_account = self.source_root / "account"
        source_build = read_json(source_account / "build_auth.json") or {}
        source_imagine = read_json(source_account / "imagine_auth.json") or {}
        target_account = self.target_root / "account"
        target_account.mkdir(parents=True, exist_ok=True)

        build_accounts: list[dict[str, Any]] = [
            sanitize_build_account(account) for account in list(source_build.get("accounts") or [])
            if isinstance(account, dict)
        ]
        for account in legacy.get("accounts") or []:
            auth_name = basename_from_path(account.get("auth_file"))
            auth_raw = read_json(account_auth_dir / auth_name) if auth_name else {}
            build_accounts.append({
                "id": str(account.get("id") or ""),
                "provider": "build",
                "label": str(account.get("label") or account.get("email") or "Build"),
                "email": str(account.get("email") or ""),
                "tier": normalize_tier(account.get("tier")),
                "source_name": auth_name,
                "registered_at": str(account.get("created_at") or now_iso()),
                "expires_at": "",
                "status": "ok",
                "auth": auth_raw if isinstance(auth_raw, dict) else {},
            })

        imagine_accounts: list[dict[str, Any]] = [
            account for account in list(source_imagine.get("accounts") or [])
            if isinstance(account, dict)
        ]
        for account in legacy.get("imagine_accounts") or []:
            if not isinstance(account, dict):
                continue
            imagine_accounts.append({
                "id": str(account.get("id") or ""),
                "provider": "imagine",
                "label": str(account.get("label") or account.get("email") or "Imagine"),
                "email": str(account.get("email") or ""),
                "tier": normalize_tier(account.get("tier")),
                "captured_at": str(account.get("captured_at") or now_iso()),
                "source_url": str(account.get("source_url") or ""),
                "status": "ok" if account.get("cookies") else "unknown",
                "cookies": list(account.get("cookies") or []),
                "identity_values": list(account.get("identity_values") or []),
            })

        existing_build = read_json(target_account / "build_auth.json") or {}
        existing_imagine = read_json(target_account / "imagine_auth.json") or {}
        existing_build_accounts = [
            sanitize_build_account(account) for account in list(existing_build.get("accounts") or [])
            if isinstance(account, dict)
        ]
        merged_build = self.merge_accounts(build_accounts, existing_build_accounts)
        merged_imagine = self.merge_accounts(imagine_accounts, list(existing_imagine.get("accounts") or []))

        source_build_active = str(source_build.get("active_id") or "")
        source_imagine_active = str(source_imagine.get("active_id") or "")
        legacy_build_active = str(legacy.get("active_id") or "")
        legacy_imagine_active = str(legacy.get("imagine_active_id") or "")
        build_active = (
            source_build_active if any(account.get("id") == source_build_active for account in merged_build)
            else legacy_build_active if any(account.get("id") == legacy_build_active for account in merged_build)
            else existing_build.get("active_id", "")
        )
        imagine_active = (
            source_imagine_active if any(account.get("id") == source_imagine_active for account in merged_imagine)
            else legacy_imagine_active if any(account.get("id") == legacy_imagine_active for account in merged_imagine)
            else existing_imagine.get("active_id", "")
        )

        write_json(target_account / "build_auth.json", {
            "version": 1,
            "provider": "build",
            "active_id": build_active or (merged_build[0].get("id") if merged_build else ""),
            "accounts": merged_build,
            "updated_at": now_iso(),
        })
        write_json(target_account / "imagine_auth.json", {
            "version": 1,
            "provider": "imagine",
            "active_id": imagine_active or (merged_imagine[0].get("id") if merged_imagine else ""),
            "accounts": merged_imagine,
            "updated_at": now_iso(),
        })
        return {"build": len(build_accounts), "imagine": len(imagine_accounts)}

    def scan_post_jsons(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        posts = []
        collections = []
        for area in ("created", "upload"):
            root = self.target_root / area
            if not root.exists():
                continue
            for post_json_path in root.rglob("post.json"):
                post = read_json(post_json_path)
                if isinstance(post, dict):
                    posts.append(post)
        collection_root = self.target_root / "collection"
        if collection_root.exists():
            for first_dir in sorted([item for item in collection_root.iterdir() if item.is_dir()], key=lambda item: item.name.lower()):
                collection_posts = []
                for post_json_path in first_dir.rglob("post.json"):
                    post = read_json(post_json_path)
                    if isinstance(post, dict):
                        posts.append(post)
                        collection_posts.append(post)
                collections.append({
                    "id": first_dir.name,
                    "name": first_dir.name,
                    "path": f"collection/{first_dir.name}",
                    "post_count": len(collection_posts),
                })
        return posts, collections

    def write_library_json(self) -> None:
        posts, collections = self.scan_post_jsons()
        prompts = []
        prompt_root = self.target_root / "prompt"
        if prompt_root.exists():
            for path in sorted(prompt_root.glob("*.txt"), key=lambda item: item.name.lower()):
                prompts.append({
                    "id": path.stem,
                    "title": path.stem,
                    "path": f"prompt/{path.name}",
                    "updated_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
                })
        library = default_library_json()
        existing = read_json(self.target_root / "library.json")
        if isinstance(existing, dict) and existing.get("created_at"):
            library["created_at"] = existing["created_at"]
        library["updated_at"] = now_iso()
        library["posts"] = [
            {
                "post_id": post.get("post_id", ""),
                "source": post.get("source", ""),
                "mode": post.get("mode", ""),
                "title": post.get("title", ""),
                "prompt": post.get("prompt", ""),
                "path": post.get("folder_path", ""),
                "collection": post.get("collection"),
                "representative": post.get("representative", ""),
                "created_at": post.get("created_at", ""),
                "group_id": post.get("group_id", ""),
                "parent_id": post.get("parent_id", ""),
                "root_post_id": post.get("root_post_id", ""),
                "original_post_id": post.get("original_post_id", ""),
                "source_post_id": post.get("source_post_id", ""),
                "item_count": len(post.get("items") or []),
            }
            for post in posts
        ]
        library["collections"] = collections
        library["prompts"] = prompts
        write_json(self.target_root / "library.json", library)

    def count_steps(self) -> int:
        scan = self.scan()
        return max(1, scan["root_media"] + scan["upload_media"] + scan["gallery_media"] + scan["prompts"] + 2)

    def convert(self) -> dict[str, Any]:
        self.ensure_target()
        self.total_steps = self.count_steps()
        self.done_steps = 0
        self.log("Loading legacy index...")
        self.load_index()
        stats = {
            "created": 0,
            "upload": 0,
            "collection_posts": 0,
            "collection_media": 0,
            "prompts": 0,
            "auth": {"build": 0, "imagine": 0},
            "copied_files": 0,
            "existing_files_skipped": 0,
        }
        self.log("Importing library media...")
        library_stats = self.import_library_media()
        stats["created"] += library_stats["created"]
        stats["collection_posts"] += library_stats["collection_posts"]
        stats["collection_media"] += library_stats["collection_media"]
        for folder_name, area in ROOT_MEDIA_FOLDERS.items():
            self.log(f"Importing extra {folder_name}...")
            stats["created"] += self.import_flat_media(folder_name, area, "build")
        for folder_name in UPLOAD_FOLDERS:
            self.log(f"Importing {folder_name}...")
            stats["upload"] += self.import_flat_media(folder_name, "upload", "local")
        self.log("Importing extra Gallery...")
        stats["collection_posts"] += self.import_gallery()
        self.log("Importing prompts...")
        stats["prompts"] = self.import_prompts()
        self.log("Importing auth...")
        stats["auth"] = self.import_auth()
        self.step()
        self.log("Writing library.json...")
        self.write_library_json()
        self.step()
        stats["copied_files"] = self.copied_files
        stats["existing_files_skipped"] = self.existing_files_skipped
        if self.existing_files_skipped:
            self.log(f"Existing files skipped: {self.existing_files_skipped}")
        self.log("Done.")
        return stats


def human_size(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{value} B"


def run_cli() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument("--scan", action="store_true")
    parser.add_argument("--convert", action="store_true")
    parser.add_argument("--import-media", action="store_true")
    parser.add_argument("--source")
    parser.add_argument("--target")
    args = parser.parse_args()

    if args.interactive or (not args.scan and not args.convert and not args.import_media and sys.stdin.isatty()):
        return run_interactive()

    if not args.scan and not args.convert and not args.import_media:
        parser.print_help()
        return 2
    if not args.source:
        raise SystemExit("--source is required")
    target = Path(args.target or "/tmp/grok-studio-library-migration-target")
    def log(message: str) -> None:
        print(message, flush=True)

    def print_progress(done: int, total_count: int) -> None:
        percent = int((done / max(1, total_count)) * 100)
        if percent == 100 or percent % 5 == 0:
            print(f"Progress: {percent}% ({done}/{total_count})", flush=True)

    migrator = Migrator(Path(args.source), target, log=log, progress=print_progress)
    if args.scan:
        print(json.dumps(migrator.scan(), ensure_ascii=False, indent=2))
        return 0
    if args.convert:
        if not args.target:
            raise SystemExit("--target is required for --convert")
        print(json.dumps(migrator.convert(), ensure_ascii=False, indent=2))
        return 0
    if args.import_media:
        if not args.target:
            raise SystemExit("--target is required for --import-media")
        print(json.dumps(migrator.import_external_media(Path(args.source)), ensure_ascii=False, indent=2))
        return 0
    return 0


def normalize_input_path(value: str) -> Path:
    text = value.strip()
    if not text:
        return Path()
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        text = text[1:-1]
    raw = Path(text).expanduser()
    if raw.exists():
        return raw
    try:
        import shlex

        parts = shlex.split(text)
        if len(parts) == 1:
            return Path(parts[0]).expanduser()
    except Exception:
        pass
    return raw


def prompt_folder(number: int, label: str, default: Path | None = None, must_exist: bool = False) -> Path:
    while True:
        print(f"\n{number}. {label}")
        if default:
            print(f"   Default: {default}")
        print("   Drag a folder here, paste a path, or press Return for default.")
        raw = input("> ").strip()
        folder = normalize_input_path(raw) if raw else Path(default or "")
        if not folder:
            print("   Folder path is required.")
            continue
        folder = folder.expanduser()
        if must_exist and not folder.is_dir():
            print("   Folder does not exist.")
            continue
        return folder


def print_scan_summary(scan: dict[str, Any]) -> None:
    print("\nScan Result")
    print(f"  Old Library Folder : {scan.get('source', '')}")
    print(f"  New Library Folder : {scan.get('target', '')}")
    print(f"  Library items      : {scan.get('library_items', 0)}")
    print(f"  Metadata JSON      : {scan.get('metadata_json', 0)}")
    print(f"  Created media      : {scan.get('root_media', 0)}")
    print(f"  Upload media       : {scan.get('upload_media', 0)}")
    print(f"  Collection folders : {scan.get('gallery_folders', 0)}")
    print(f"  Collection media   : {scan.get('gallery_media', 0)}")
    print(f"  Prompts            : {scan.get('prompts', 0)}")
    print(f"  Build accounts     : {scan.get('build_accounts', 0)}")
    print(f"  Imagine accounts   : {scan.get('imagine_accounts', 0)}")
    print(f"  Account auth files : {scan.get('account_auth_files', 0)}")
    print(f"  Copy size          : {human_size(int(scan.get('bytes', 0) or 0))}")


def ask_yes_no(label: str, default: bool = False) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    value = input(f"{label} {suffix} ").strip().lower()
    if not value:
        return default
    return value in {"y", "yes"}


def run_interactive() -> int:
    print("Grok Studio Library Migration")
    print("Original files are read only. Convert writes only to the New Library Folder.")

    default_source = Path("/Volumes/WORK/Grok") if Path("/Volumes/WORK/Grok").is_dir() else None
    source = prompt_folder(1, "Old Library Folder", default_source, must_exist=True)
    target = prompt_folder(2, "New Library Folder", None, must_exist=False)

    if source.resolve() == target.resolve():
        print("\nOld Library Folder and New Library Folder cannot be the same.")
        return 1

    migrator = Migrator(source, target, log=print, progress=lambda done, total: None)
    print("\n3. Scan")
    scan = migrator.scan()
    print_scan_summary(scan)

    print("\n4. Convert")
    if not ask_yes_no("Convert now?", default=False):
        print("Stopped before Convert.")
        return 0

    last_percent = {"value": -1}

    def progress(done: int, total: int) -> None:
        percent = int((done / max(1, total)) * 100)
        if percent != last_percent["value"] and (percent % 5 == 0 or percent == 100):
            last_percent["value"] = percent
            print(f"Progress: {percent}% ({done}/{total})")

    migrator = Migrator(source, target, log=print, progress=progress)
    result = migrator.convert()
    print("\nConvert Result")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\nNew Library Folder: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_cli())
