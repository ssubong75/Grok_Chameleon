#!/usr/bin/env python3
"""Exclude the source image from I2I completion events."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD = '''      const beforeIds = currentIds(state, containerId, "image");
      if (typeof state.fetchGenerateImageEdits !== "function") throw new Error("Official fetchGenerateImageEdits is missing.");
'''

NEW = '''      const beforeIds = currentIds(state, containerId, "image");
      for (const sourceId of [containerId, parentPostId, inputIds[0]]) {
        const value = String(sourceId || "").trim();
        if (value) beforeIds.add(value);
      }
      if (typeof state.fetchGenerateImageEdits !== "function") throw new Error("Official fetchGenerateImageEdits is missing.");
'''


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    old_count = text.count(OLD)
    new_count = text.count(NEW)
    if old_count == 1 and new_count == 0:
        text = text.replace(OLD, NEW, 1)
    elif old_count == 0 and new_count == 1:
        pass
    else:
        raise RuntimeError(f"Unexpected I2I source baseline counts old={old_count} new={new_count}.")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_I2I_SOURCE_BASELINE_PATCHED {path}")
        return True
    print(f"IMAGINE_I2I_SOURCE_BASELINE_ALREADY_PATCHED {path}")
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
