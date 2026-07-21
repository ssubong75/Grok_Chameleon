#!/usr/bin/env python3
"""Reuse a fresh Imagine bridge session when submitting composer jobs."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD = '''      await prepareActiveImagineBridgeSession({ force: true, silent: false });
'''

NEW = '''      await prepareActiveImagineBridgeSession({ force: false, silent: false });
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
        raise RuntimeError(f"Unexpected Imagine bridge prepare counts old={old_count} new={new_count}.")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_CACHED_BRIDGE_PREPARE_PATCHED {path}")
        return True
    print(f"IMAGINE_CACHED_BRIDGE_PREPARE_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("i_composer_submit_js", type=Path)
    args = parser.parse_args()
    if args.i_composer_submit_js.name != "i_composer_submit.js":
        raise RuntimeError("Expected i_composer_submit.js.")
    patch_file(args.i_composer_submit_js)


if __name__ == "__main__":
    main()
