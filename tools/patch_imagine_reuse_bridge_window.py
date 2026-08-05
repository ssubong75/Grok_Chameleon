#!/usr/bin/env python3
"""Reuse the prepared Imagine bridge window instead of loading a new page per job."""

from __future__ import annotations

import argparse
from pathlib import Path


PARALLEL_OLD = '''function bridgeCommandCanRunInParallel(command) {
  return ["fetch_stream", "t2i_ws"].includes(String(command?.type || ""));
}
'''

PARALLEL_NEW = '''function bridgeCommandCanRunInParallel(command) {
  return ["t2i_ws"].includes(String(command?.type || ""));
}
'''

ID_MATCH_OLD = '''  const needIdMatch = ["fetch_stream", "crop_image"].includes(command.type) && ids.length > 0;
'''

ID_MATCH_NEW = '''  const needIdMatch = command.type === "crop_image" && ids.length > 0;
'''

TARGET_OLD = '''  const targetUrl = command.type === "t2i_ws"
    ? "https://grok.com/imagine/saved"
    : (command.url || "https://grok.com/imagine");
  await applyBridgeCookies(win, command);
  await waitForLoad(win, targetUrl, { forceTarget: ["t2i_ws", "fetch_stream", "crop_image", "open_page"].includes(command.type) });
'''

TARGET_NEW = '''  const targetUrl = command.type === "t2i_ws"
    ? "https://grok.com/imagine/saved"
    : command.type === "fetch_stream"
      ? "https://grok.com/imagine"
      : (command.url || "https://grok.com/imagine");
  await applyBridgeCookies(win, command);
  await waitForLoad(win, targetUrl, { forceTarget: ["t2i_ws", "crop_image", "open_page"].includes(command.type) });
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
    completed_markers = (
        'return ["t2i_ws"].includes',
        'command.type === "fetch_stream"',
        'forceTarget: ["t2i_ws", "crop_image", "open_page"]',
    )
    if all(marker in text for marker in completed_markers) and (
        'const needIdMatch = command.type === "crop_image"' in text
        or "Boolean(options.requireIdMatch)" in text
    ):
        print(f"IMAGINE_REUSE_BRIDGE_WINDOW_ALREADY_PATCHED {path}")
        return False
    text = replace_once(text, PARALLEL_OLD, PARALLEL_NEW, "fetch-stream serialization")
    text = replace_once(text, ID_MATCH_OLD, ID_MATCH_NEW, "bridge source readiness")
    text = replace_once(text, TARGET_OLD, TARGET_NEW, "persistent bridge target")

    required = (
        'return ["t2i_ws"].includes',
        'const needIdMatch = command.type === "crop_image"',
        'command.type === "fetch_stream"',
        'forceTarget: ["t2i_ws", "crop_image", "open_page"]',
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required persistent bridge markers are missing: {missing}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_REUSE_BRIDGE_WINDOW_PATCHED {path}")
        return True
    print(f"IMAGINE_REUSE_BRIDGE_WINDOW_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("main_js", type=Path)
    args = parser.parse_args()
    if args.main_js.name != "main.js":
        raise RuntimeError("Expected Electron main.js.")
    patch_file(args.main_js)


if __name__ == "__main__":
    main()
