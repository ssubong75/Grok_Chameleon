#!/usr/bin/env python3
"""Size the detail progress percentage for the common two-digit case."""

from __future__ import annotations

import argparse
from pathlib import Path


REPLACEMENTS = {
    "detail.css": (
        (
            '''.detail_generation_percent {
  display: inline-block;
  width: 4ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}''',
            '''.detail_generation_percent {
  display: inline-block;
  width: 3ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}''',
        ),
    ),
    "build_main.js": (
        (
            '      progressEl.textContent = `Creating ${Math.max(1, buildJobSlotProgress(job, slotIndex))}%`;',
            '      progressEl.innerHTML = `Creating <span class="detail_generation_percent">${Math.max(1, buildJobSlotProgress(job, slotIndex))}%</span>`;',
        ),
        (
            '          <span class="detail_generation_progress" ${dataAttr} data-job-slot-index="${selectedJobSlotIndex || 0}">Creating ${progress}%</span>',
            '          <span class="detail_generation_progress" ${dataAttr} data-job-slot-index="${selectedJobSlotIndex || 0}">Creating <span class="detail_generation_percent">${progress}%</span></span>',
        ),
    ),
}


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new in REPLACEMENTS[path.name]:
        old_count = text.count(old)
        new_count = text.count(new)
        if old_count == 1 and new_count == 0:
            text = text.replace(old, new, 1)
        elif old_count == 0 and new_count == 1:
            continue
        else:
            raise RuntimeError(
                f"Unexpected {path.name} replacement counts old={old_count} new={new_count}."
            )
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"DETAIL_PROGRESS_WIDTH_PATCHED {path}")
        return True
    print(f"DETAIL_PROGRESS_WIDTH_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("detail_css", type=Path)
    parser.add_argument("build_main_js", type=Path)
    args = parser.parse_args()
    if args.detail_css.name != "detail.css" or args.build_main_js.name != "build_main.js":
        raise RuntimeError("Expected detail.css followed by build_main.js.")
    patch_file(args.detail_css)
    patch_file(args.build_main_js)


if __name__ == "__main__":
    main()
