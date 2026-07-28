#!/usr/bin/env python3
"""Apply the Windows-only SVG arrow rendering patch to an assembled app."""

from __future__ import annotations

import argparse
from pathlib import Path


RETURN_SVG = (
    '<svg class="detail_return_glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="M19 12H5"></path><path d="m10 7-5 5 5 5"></path></svg>'
)
BACK_SVG = (
    '<svg class="detail_nav_glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="m15 18-6-6 6-6"></path></svg>'
)
FORWARD_SVG = (
    '<svg class="detail_nav_glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="m9 6 6 6-6 6"></path></svg>'
)
UP_SVG = (
    '<svg class="i_detail_copy_arrow" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="M12 19V5"></path><path d="m7 10 5-5 5 5"></path></svg>'
)
MOVE_I_SVG = (
    '<svg class="i_detail_action_glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="M7 17 17 7"></path><path d="M10 7h7v7"></path></svg>'
)
MOVE_B_SVG = (
    '<svg class="b_detail_action_glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="M7 17 17 7"></path><path d="M10 7h7v7"></path></svg>'
)
DOWNLOAD_SVG = (
    '<svg class="detail_download_glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="M12 5v14"></path><path d="m7 14 5 5 5-5"></path></svg>'
)
CARD_DOWNLOAD_SVG = (
    '<svg class="media-card-action-glyph media-card-download-glyph" viewBox="0 0 24 24" '
    'aria-hidden="true" focusable="false"><path d="M12 5v14"></path>'
    '<path d="m7 14 5 5 5-5"></path></svg>'
)
CARD_MOVE_SVG = (
    '<svg class="media-card-action-glyph" viewBox="0 0 24 24" aria-hidden="true" '
    'focusable="false"><path d="M7 17 17 7"></path><path d="M10 7h7v7"></path></svg>'
)


def replacement(old: str, new: str, count: int = 1) -> tuple[str, str, int]:
    return old, new, count


INDEX_REPLACEMENTS = (
    replacement(
        '<span class="detail_return_glyph" aria-hidden="true">↓</span>',
        RETURN_SVG,
        3,
    ),
    replacement(
        '<button class="i_detail_back" type="button" aria-label="Back"><span aria-hidden="true">&lt;</span></button>',
        f'<button class="i_detail_back" type="button" aria-label="Back">{BACK_SVG}</button>',
    ),
    replacement(
        '<button class="b_detail_back" type="button" aria-label="Back"><span aria-hidden="true">&lt;</span></button>',
        f'<button class="b_detail_back" type="button" aria-label="Back">{BACK_SVG}</button>',
    ),
    replacement(
        '<button class="i_detail_forward" type="button" aria-label="Forward"><span aria-hidden="true">&gt;</span></button>',
        f'<button class="i_detail_forward" type="button" aria-label="Forward">{FORWARD_SVG}</button>',
    ),
    replacement(
        '<button class="b_detail_forward" type="button" aria-label="Forward"><span aria-hidden="true">&gt;</span></button>',
        f'<button class="b_detail_forward" type="button" aria-label="Forward">{FORWARD_SVG}</button>',
    ),
    replacement(
        '<button class="i_detail_action i_detail_copy_url" type="button" aria-label="Copy media address"><span class="i_detail_copy_arrow" aria-hidden="true">↓</span></button>',
        f'<button class="i_detail_action i_detail_copy_url" type="button" aria-label="Copy media address">{UP_SVG}</button>',
    ),
    replacement(
        '<span class="i_detail_action_glyph" aria-hidden="true">↗</span>',
        MOVE_I_SVG,
    ),
    replacement(
        '<span class="b_detail_action_glyph" aria-hidden="true">↗</span>',
        MOVE_B_SVG,
    ),
    replacement(
        '<button class="i_detail_action i_detail_download" type="button" aria-label="Download">↓</button>',
        f'<button class="i_detail_action i_detail_download" type="button" aria-label="Download">{DOWNLOAD_SVG}</button>',
    ),
    replacement(
        '<button class="b_detail_action b_detail_download" type="button" aria-label="Download">↓</button>',
        f'<button class="b_detail_action b_detail_download" type="button" aria-label="Download">{DOWNLOAD_SVG}</button>',
    ),
)

CARD_REPLACEMENTS = (
    replacement(
        '<span class="media-card-action-glyph media-card-download-glyph" aria-hidden="true">↓</span>',
        CARD_DOWNLOAD_SVG,
        2,
    ),
    replacement(
        '<span class="media-card-action-glyph" aria-hidden="true">↗</span>',
        CARD_MOVE_SVG,
        2,
    ),
)

CARD_STYLE_REPLACEMENTS = (
    replacement(
        """.media-card-action-glyph {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font: inherit;
  line-height: 1;
}""",
        """.media-card-action-glyph {
  display: block;
  width: 23px;
  height: 23px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}""",
    ),
)

DETAIL_STYLE_REPLACEMENTS = (
    replacement(
        """.i_detail_back span,
.b_detail_back span,
.i_detail_forward span,
.b_detail_forward span {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-weight: 580;
}

.i_detail_back span,
.b_detail_back span {
  transform: translate(-1px, -2px);
}

.i_detail_forward span,
.b_detail_forward span {
  transform: translate(1px, -2px);
}""",
        """.detail_return_glyph,
.detail_nav_glyph,
.i_detail_copy_arrow,
.i_detail_action_glyph,
.b_detail_action_glyph,
.detail_download_glyph {
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.detail_nav_glyph {
  width: 22px;
  height: 22px;
}""",
    ),
    replacement(
        """.detail_return_glyph {
  display: grid;
  place-items: center;
  line-height: 1;
  transform: rotate(90deg);
}""",
        """.detail_return_glyph {
  width: 22px;
  height: 22px;
}""",
    ),
    replacement(
        """.i_detail_copy_arrow {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 25px;
  line-height: 1;
  transform: rotate(180deg);
}""",
        """.i_detail_copy_arrow {
  width: 25px;
  height: 25px;
}""",
    ),
    replacement(
        """.i_detail_action_glyph,
.b_detail_action_glyph {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font: inherit;
  line-height: 1;
}""",
        """.i_detail_action_glyph,
.b_detail_action_glyph {
  width: 24px;
  height: 24px;
}""",
    ),
    replacement(
        """.i_detail_download,
.b_detail_download {
  font-size: 25px;
}
""",
        """.i_detail_download,
.b_detail_download {
  font-size: 25px;
}

.detail_download_glyph {
  width: 25px;
  height: 25px;
}
""",
    ),
)


def patch_file(path: Path, replacements: tuple[tuple[str, str, int], ...]) -> None:
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new, expected in replacements:
        old_count = text.count(old)
        new_count = text.count(new)
        if new_count == expected and (old_count == 0 or old in new):
            continue
        if old_count == expected and new_count == 0:
            text = text.replace(old, new)
        else:
            raise RuntimeError(
                f"Unexpected Windows SVG arrow replacement counts in {path}: "
                f"old={old_count}, new={new_count}, expected={expected}"
            )
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"WINDOWS_SVG_ARROWS_PATCHED {path}")
    else:
        print(f"WINDOWS_SVG_ARROWS_ALREADY_PATCHED {path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", required=True, type=Path)
    args = parser.parse_args()
    targets = (
        (args.app_root / "web" / "index.html", INDEX_REPLACEMENTS),
        (args.app_root / "web" / "scripts" / "card_render.js", CARD_REPLACEMENTS),
        (args.app_root / "web" / "styles" / "cards_prompt.css", CARD_STYLE_REPLACEMENTS),
        (args.app_root / "web" / "styles" / "detail.css", DETAIL_STYLE_REPLACEMENTS),
    )
    for path, replacements in targets:
        if not path.is_file():
            raise RuntimeError(f"Missing Windows SVG arrow target: {path}")
        patch_file(path, replacements)


if __name__ == "__main__":
    main()
