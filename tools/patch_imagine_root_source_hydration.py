#!/usr/bin/env python3
"""Hydrate selected child media through its root card before generation."""

from __future__ import annotations

import argparse
from pathlib import Path


SIGNATURE_OLD = '''  async function hydrateGenerationSource(storeContext, sourceId, requestId, variant, timeoutMs = 8000) {
'''

SIGNATURE_NEW = '''  async function hydrateGenerationSource(storeContext, sourceId, requestId, variant, rootSourceId = "", timeoutMs = 8000) {
'''

TARGETS_OLD = '''    addTarget(value);
    addTarget(containerPostIdFor(state, value));
'''

TARGETS_NEW = '''    addTarget(rootSourceId);
    addTarget(containerPostIdFor(state, value));
    addTarget(value);
'''

IMAGE_CALL_OLD = '''      state = await hydrateGenerationSource(
        storeContext,
        parentPostId || inputIds[0] || containerId,
        requestId,
        variant.kind,
      );
'''

IMAGE_CALL_NEW = '''      state = await hydrateGenerationSource(
        storeContext,
        parentPostId || inputIds[0] || containerId,
        requestId,
        variant.kind,
        containerId,
      );
'''

VIDEO_CALL_OLD = '''      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
      );
'''

VIDEO_CALL_NEW = '''      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
        containerId,
      );
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        return text
    raise RuntimeError(f"Unexpected {label} counts old={old_count} new={new_count}.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    text = replace_once(text, SIGNATURE_OLD, SIGNATURE_NEW, "source hydration signature")
    text = replace_once(text, TARGETS_OLD, TARGETS_NEW, "root-first hydration targets")
    text = replace_once(text, IMAGE_CALL_OLD, IMAGE_CALL_NEW, "image root hydration call")
    text = replace_once(text, VIDEO_CALL_OLD, VIDEO_CALL_NEW, "video root hydration call")

    required = (
        'rootSourceId = ""',
        "addTarget(rootSourceId);",
        "store_generation_source_hydration_start",
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required root hydration markers are missing: {missing}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_ROOT_SOURCE_HYDRATION_PATCHED {path}")
        return True
    print(f"IMAGINE_ROOT_SOURCE_HYDRATION_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("preload_bridge_js", type=Path)
    args = parser.parse_args()
    if args.preload_bridge_js.name != "preload-bridge.js":
        raise RuntimeError("Expected preload-bridge.js.")
    patch_file(args.preload_bridge_js)


if __name__ == "__main__":
    main()
