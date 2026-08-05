#!/usr/bin/env python3
"""Persist removal of an unavailable Imagine item so relation overlays do not restore it."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD_DECLARATIONS = '''  let changed = false;
  let keptPost = null;
'''

NEW_DECLARATIONS = '''  let changed = false;
  let keptPost = null;
  const removedKeys = new Set();
'''

OLD_FILTER = '''      const items = Array.isArray(post?.items) ? post.items : [];
      const remaining = items.filter((item) => !imagineItemUsesPreviewUrl(item, url));
      if (remaining.length === items.length) return [post];
'''

NEW_FILTER = '''      const items = Array.isArray(post?.items) ? post.items : [];
      const remaining = items.filter((item) => {
        if (!imagineItemUsesPreviewUrl(item, url)) return true;
        if (typeof imaginePostIdKeysForItem === "function") {
          for (const key of imaginePostIdKeysForItem(item)) removedKeys.add(String(key || ""));
        }
        return false;
      });
      if (remaining.length === items.length) return [post];
'''

OLD_PERSIST = '''  if (!changed) return false;
  if (!keptPost) {
'''

NEW_PERSIST = '''  if (!changed) return false;
  if (removedKeys.size && typeof qApi === "function") {
    Promise.resolve(qApi("/api/imagine/item/hide", {
      keys: Array.from(removedKeys).filter(Boolean),
    })).catch(() => {});
  }
  if (!keptPost) {
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
    text = replace_once(text, OLD_DECLARATIONS, NEW_DECLARATIONS, "declaration")
    text = replace_once(text, OLD_FILTER, NEW_FILTER, "filter")
    text = replace_once(text, OLD_PERSIST, NEW_PERSIST, "persistence")
    required = [
        "const removedKeys = new Set();",
        'qApi("/api/imagine/item/hide"',
        "for (const key of imaginePostIdKeysForItem(item))",
    ]
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required cleanup markers are missing: {missing}")
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_MISSING_RELATION_CLEANUP_PATCHED {path}")
        return True
    print(f"IMAGINE_MISSING_RELATION_CLEANUP_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("detail_media_js", type=Path)
    args = parser.parse_args()
    if args.detail_media_js.name != "detail_media.js":
        raise RuntimeError("Expected detail_media.js.")
    patch_file(args.detail_media_js)


if __name__ == "__main__":
    main()
