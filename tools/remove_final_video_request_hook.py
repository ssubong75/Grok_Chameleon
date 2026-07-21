#!/usr/bin/env python3
"""Remove the obsolete final Imagine video request interception hook."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


HOOK_START = "  const finalVideoRequestPatchState = {\n"
HOOK_END = "  installPersistentFinalVideoRequestPatch();\n"

OFFICIAL_UI_DURATION_BLOCK = '''        if (name === "generateVideoForImage" && origin === "official_ui") {
          const active = finalVideoRequestPatchState.active;
          if (active && Date.now() <= active.expiresAt && args.length > 8) {
            const beforeDuration = args[8];
            args = args.slice();
            args[8] = active.duration;
            pushStoreTrace("official_video_duration_arg_applied", {
              requestId: active.requestId,
              variant: active.variant,
              before: { duration: beforeDuration },
              after: { duration: args[8] },
            });
          }
        }
'''

ARM_BLOCK = '''      const finalVideoRequestPatch = armFinalVideoRequestPatch({
        requestId,
        duration: durationSeconds,
        resolutionName,
        variant: variant.kind,
      });
'''

TRY_START = "      let resultEvents;\n      try {\n"
TRY_END = '''      } finally {
        finalVideoRequestPatch.disarm("finally");
      }
'''

WAIT_BLOCK = re.compile(
    r'''        const finalPatchAppliedCount = await finalVideoRequestPatch\.waitForApplied\(30000\);\n'''
    r'''        if \(finalPatchAppliedCount < 1\) \{\n'''
    r'''(?:.*\n)*?'''
    r'''        \}\n'''
    r'''        finalVideoRequestPatch\.disarm\(finalPatchAppliedCount > 0 \? "applied" : "not_seen"\);\n'''
)

FORBIDDEN_MARKERS = (
    "finalVideoRequestPatch",
    "installPersistentFinalVideoRequestPatch",
    "armFinalVideoRequestPatch",
    "video_request_final_patch",
    "official_video_duration_arg_applied",
    "Official Imagine final video request was not intercepted",
)


def remove_once(text: str, old: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label}; found {count}.")
    return text.replace(old, "", 1)


def validate(text: str) -> None:
    remaining = [marker for marker in FORBIDDEN_MARKERS if marker in text]
    if remaining:
        raise RuntimeError(f"Final video request hook markers remain: {remaining}")
    if "const resultEvents = await waitForStoreEvents(" not in text:
        raise RuntimeError("Video result event collection was not preserved.")
    if 'startStoreMethodCall("generateVideoForImage"' not in text:
        raise RuntimeError("Official video generation call was not preserved.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if HOOK_START not in text:
        validate(text)
        print(f"FINAL_VIDEO_REQUEST_HOOK_ALREADY_REMOVED {path}")
        return False

    hook_start = text.index(HOOK_START)
    hook_end = text.index(HOOK_END, hook_start) + len(HOOK_END)
    text = text[:hook_start] + text[hook_end:]

    text = remove_once(text, OFFICIAL_UI_DURATION_BLOCK, "official UI duration hook block")
    text = remove_once(text, ARM_BLOCK, "video request hook arm block")

    try_start = text.index(TRY_START)
    try_end = text.index(TRY_END, try_start)
    core = text[try_start + len(TRY_START):try_end]
    core, wait_count = WAIT_BLOCK.subn("", core, count=1)
    if wait_count != 1:
        raise RuntimeError(f"Expected one hook wait block; found {wait_count}.")
    core = core.replace(
        "        resultEvents = await waitForStoreEvents(",
        "        const resultEvents = await waitForStoreEvents(",
        1,
    )
    core = "\n".join(line[2:] if line.startswith("  ") else line for line in core.split("\n"))
    text = text[:try_start] + core + text[try_end + len(TRY_END):]

    validate(text)
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"FINAL_VIDEO_REQUEST_HOOK_REMOVED {path}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("preload_bridge_js", type=Path)
    args = parser.parse_args()
    patch_file(args.preload_bridge_js)


if __name__ == "__main__":
    main()
