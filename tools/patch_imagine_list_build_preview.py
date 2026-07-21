#!/usr/bin/env python3
from pathlib import Path
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    app_root = Path(sys.argv[1]).resolve()
    server_path = app_root / "runtime" / "server.py"
    render_path = app_root / "web" / "scripts" / "i_source_render.js"
    server = server_path.read_text(encoding="utf-8")
    render = render_path.read_text(encoding="utf-8")

    server = replace_once(
        server,
        "IMAGINE_DIRECT_LONG_I2V_CANDIDATE_STABILIZE_SECONDS = 30\n",
        "IMAGINE_DIRECT_LONG_I2V_CANDIDATE_STABILIZE_SECONDS = 30\n"
        "IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS = 45\n\n"
        "IMAGINE_SAVED_MEDIA_KEYS_CACHE: dict[str, tuple[float, set[str]]] = {}\n"
        "IMAGINE_SAVED_MEDIA_KEYS_CACHE_LOCK = threading.Lock()\n",
        "saved-key cache constants",
    )
    server = replace_once(
        server,
        "def imagine_apply_generated_relations(post: dict, root: Path, account: dict) -> dict:\n"
        "    if not isinstance(post, dict):\n"
        "        return post\n"
        "    post_id = str(post.get(\"post_id\") or \"\").strip()\n"
        "    if not post_id:\n"
        "        return post\n"
        "    library = merge_library_json(read_json(root / \"library.json\", {}))\n",
        "def imagine_apply_generated_relations(post: dict, root: Path, account: dict, library: dict | None = None) -> dict:\n"
        "    if not isinstance(post, dict):\n"
        "        return post\n"
        "    post_id = str(post.get(\"post_id\") or \"\").strip()\n"
        "    if not post_id:\n"
        "        return post\n"
        "    if not isinstance(library, dict):\n"
        "        library = merge_library_json(read_json(root / \"library.json\", {}))\n",
        "relation snapshot support",
    )
    server = replace_once(
        server,
        "    posts = [\n        imagine_apply_generated_relations(post, root, account)\n",
        "    library_snapshot = merge_library_json(read_json(root / \"library.json\", {}))\n"
        "    posts = [\n        imagine_apply_generated_relations(post, root, account, library_snapshot)\n",
        "saved relation snapshot use",
    )
    cache_function = '''\n\ndef imagine_saved_media_keys_cached(account: dict, max_posts: int = 160) -> set[str]:
    account_key = str(account.get("id") or account.get("email") or "").strip().lower()
    cache_key = f"{account_key}:{max_posts}"
    now = time.monotonic()
    with IMAGINE_SAVED_MEDIA_KEYS_CACHE_LOCK:
        cached = IMAGINE_SAVED_MEDIA_KEYS_CACHE.get(cache_key)
        if cached and now - cached[0] < IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS:
            return set(cached[1])
    keys = imagine_saved_media_keys(account, max_posts=max_posts)
    with IMAGINE_SAVED_MEDIA_KEYS_CACHE_LOCK:
        IMAGINE_SAVED_MEDIA_KEYS_CACHE[cache_key] = (time.monotonic(), set(keys))
        stale_keys = [
            key for key, value in IMAGINE_SAVED_MEDIA_KEYS_CACHE.items()
            if time.monotonic() - value[0] >= IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS
        ]
        for key in stale_keys:
            IMAGINE_SAVED_MEDIA_KEYS_CACHE.pop(key, None)
    return keys
'''
    server = replace_once(
        server,
        "\n\ndef imagine_asset_url_candidates(asset: dict) -> list[str]:\n",
        cache_function + "\n\ndef imagine_asset_url_candidates(asset: dict) -> list[str]:\n",
        "saved-key cache function",
    )
    server = replace_once(
        server,
        "    saved_keys = imagine_saved_media_keys(account, max_posts=160)\n",
        "    saved_keys = imagine_saved_media_keys_cached(account, max_posts=160)\n",
        "unsaved cached lookup",
    )
    apple_helper = '''\n\ndef is_apple_metadata_file_name(name: str) -> bool:
    """Return True for macOS AppleDouble sidecar files, never real media."""
    return Path(str(name or "")).name.startswith("._")
'''
    server = replace_once(
        server,
        "\n\ndef thumbnail_for_video(folder: Path, rel_folder: str, video_name: str) -> dict:\n",
        apple_helper + "\n\ndef thumbnail_for_video(folder: Path, rel_folder: str, video_name: str) -> dict:\n",
        "AppleDouble helper",
    )
    server = replace_once(
        server,
        "    video_names = [entry.name for entry in sorted_entries(folder) if entry.is_file() and media_type_for_name(entry.name) == \"video\"]\n",
        "    video_names = [\n"
        "        entry.name\n"
        "        for entry in sorted_entries(folder)\n"
        "        if entry.is_file()\n"
        "        and not is_apple_metadata_file_name(entry.name)\n"
        "        and media_type_for_name(entry.name) == \"video\"\n"
        "    ]\n",
        "AppleDouble thumbnail filter",
    )
    server = replace_once(
        server,
        "        if not entry.is_file():\n            continue\n        media_type = media_type_for_name(entry.name)\n",
        "        if not entry.is_file():\n            continue\n        if is_apple_metadata_file_name(entry.name):\n            continue\n        media_type = media_type_for_name(entry.name)\n",
        "AppleDouble local media filter",
    )
    server = replace_once(
        server,
        "        file_name = item.get(\"file\") or \"\"\n        media_type = item.get(\"type\") or media_type_for_name(file_name or url)\n",
        "        file_name = item.get(\"file\") or \"\"\n        if file_name and is_apple_metadata_file_name(file_name):\n            continue\n        media_type = item.get(\"type\") or media_type_for_name(file_name or url)\n",
        "AppleDouble metadata media filter",
    )
    for marker in (
        "IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS = 45",
        "imagine_saved_media_keys_cached(account, max_posts=160)",
        "def is_apple_metadata_file_name(name: str) -> bool:",
    ):
        if marker not in server:
            raise SystemExit(f"server verification failed: {marker}")

    sync_line = "    syncImagineRemotePostsIntoLibrary();\n"
    if render.count(sync_line) != 3:
        raise SystemExit(f"render sync removals: expected 3 matches, found {render.count(sync_line)}")
    render = render.replace(sync_line, "")

    server_path.write_text(server, encoding="utf-8", newline="\n")
    render_path.write_text(render, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
