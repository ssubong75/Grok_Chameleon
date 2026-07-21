#!/usr/bin/env python3
"""Patch a packaged Grok Chameleon server with i2i result recovery fixes."""

from __future__ import annotations

import sys
from pathlib import Path


OLD_RECHECK = '''    if not item and expected_type == "image" and post_candidates:
        candidate_recheck_seconds = 5 if action in {"i2i", "aspect"} else max_wait
'''

NEW_RECHECK = '''    if not item and expected_type == "image" and (post_candidates or action in {"i2i", "aspect"}):
        candidate_recheck_seconds = 15 if action in {"i2i", "aspect"} else max_wait
'''

OLD_FAILURE = '''        imagine_debug_event("native_bridge_no_media_moderated", {
            "request_id": request_id,
            "action": action,
            "expected_type": expected_type,
            "max_progress": max_progress,
            "post_candidate_count": len(post_candidates),
        })
        raise RuntimeError("Imagine moderated the request.")
'''

NEW_FAILURE = '''        imagine_debug_event("native_bridge_no_media_failed", {
            "request_id": request_id,
            "action": action,
            "expected_type": expected_type,
            "max_progress": max_progress,
            "post_candidate_count": len(post_candidates),
        })
        raise RuntimeError("Imagine did not return a final image.")
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label} block, found {count}.")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_imagine_i2i_result_recovery.py SERVER_PY")

    source = Path(sys.argv[1])
    text = source.read_text(encoding="utf-8")
    already_patched = NEW_RECHECK in text and NEW_FAILURE in text
    if already_patched:
        if OLD_RECHECK in text or OLD_FAILURE in text:
            raise SystemExit("Mixed old and patched i2i recovery blocks found.")
        print("I2I_RESULT_RECOVERY_ALREADY_PATCHED")
        return

    text = replace_once(text, OLD_RECHECK, NEW_RECHECK, "i2i recheck")
    text = replace_once(text, OLD_FAILURE, NEW_FAILURE, "image failure")
    source.write_text(text, encoding="utf-8", newline="\n")
    print("I2I_RESULT_RECOVERY_PATCHED")


if __name__ == "__main__":
    main()
