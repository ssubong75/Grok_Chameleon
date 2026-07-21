#!/usr/bin/env python3
"""Tune Imagine progress display to the official 480p/6s completion time."""

from __future__ import annotations

import argparse
from pathlib import Path


REPLACEMENTS = (
    (
        'IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS = 98',
        'IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS = 94',
        'T2I progress ceiling',
    ),
    (
        'IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS = 98',
        'IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS = 94',
        'I2I progress ceiling',
    ),
    (
        'IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS = 98',
        'IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS = 94',
        'I2V progress ceiling',
    ),
    (
        'IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS = 90',
        'IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS = 94',
        'T2V progress ceiling',
    ),
    (
        'IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS = 98',
        'IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS = 94',
        'Extend progress ceiling',
    ),
)

OLD_PROGRESS_CLAMP = '''        if action == "i2v" and status_text == "running":
            numeric_progress = numeric_percentage(progress_value)
            if numeric_progress is not None:
                next_progress = min(numeric_progress, IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS)
'''

NEW_PROGRESS_CLAMP = '''        if status_text == "running":
            numeric_progress = numeric_percentage(progress_value)
            running_progress_limit = {
                "t2i": IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS,
                "i2i": IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS,
                "i2v": IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS,
                "t2v": IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS,
                "extend": IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS,
            }.get(action, 98)
            if numeric_progress is not None:
                next_progress = min(numeric_progress, running_progress_limit)
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        return text
    raise RuntimeError(f"Unexpected {label} counts old={old_count} new={new_count}.")


def replace_variant(text: str, old_values: tuple[str, ...], new: str, label: str) -> str:
    new_count = text.count(new)
    old_counts = [text.count(value) for value in old_values]
    if new_count == 1 and not any(old_counts):
        return text
    if new_count == 0 and sum(old_counts) == 1:
        old = old_values[old_counts.index(1)]
        return text.replace(old, new, 1)
    raise RuntimeError(f"Unexpected {label} counts old={old_counts} new={new_count}.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new, label in REPLACEMENTS:
        text = replace_once(text, old, new, label)
    text = replace_variant(
        text,
        ('("i2v", "480p", 6): 20,', '("i2v", "480p", 6): 46,'),
        '("i2v", "480p", 6): 13,',
        "I2V 480p/6s display time",
    )
    text = replace_variant(
        text,
        ('("t2v", "480p", 6): 20,', '("t2v", "480p", 6): 46,'),
        '("t2v", "480p", 6): 13,',
        "T2V 480p/6s display time",
    )
    text = replace_once(text, OLD_PROGRESS_CLAMP, NEW_PROGRESS_CLAMP, "Imagine running progress clamp")

    required = (
        'IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS = 94',
        'IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS = 94',
        'IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS = 94',
        'IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS = 94',
        'IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS = 94',
        '("i2v", "480p", 6): 13,',
        '("t2v", "480p", 6): 13,',
        'running_progress_limit = {',
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required Imagine progress markers are missing: {missing}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_PROGRESS_TIMING_PATCHED {path}")
        return True
    print(f"IMAGINE_PROGRESS_TIMING_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("server_py", type=Path)
    args = parser.parse_args()
    if args.server_py.name != "server.py":
        raise RuntimeError("Expected server.py.")
    patch_file(args.server_py)


if __name__ == "__main__":
    main()
