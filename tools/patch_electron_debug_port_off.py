#!/usr/bin/env python3
"""Disable Electron remote debugging unless a user explicitly opts in with an environment value."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD = 'const CDP_PORT = String(process.env.GROK_CHAMELEON_CDP_PORT || "9237");'
NEW = 'const CDP_PORT = String(process.env.GROK_CHAMELEON_CDP_PORT || "0");'


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    old_count = text.count(OLD)
    new_count = text.count(NEW)
    if new_count == 1:
        pass
    elif old_count == 1 and new_count == 0:
        text = text.replace(OLD, NEW, 1)
    else:
        raise RuntimeError(f"Unexpected Electron debug port counts old={old_count} new={new_count}.")
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"ELECTRON_DEBUG_PORT_OFF_PATCHED {path}")
        return True
    print(f"ELECTRON_DEBUG_PORT_OFF_ALREADY_PATCHED {path}")
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
