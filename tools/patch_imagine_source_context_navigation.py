#!/usr/bin/env python3
"""Load the selected Imagine detail only when the reusable bridge lacks its source context."""

from __future__ import annotations

import argparse
from pathlib import Path


HELPER_ANCHOR = '''async function bridgeMediaContext(win, ids = []) {
'''

HELPER = '''function commandSourceContextId(command) {
  const payload = command?.request_payload || {};
  const modelMap = payload.responseMetadata?.modelConfigOverride?.modelMap || {};
  const videoConfig = modelMap.videoGenModelConfig || {};
  const imageConfig = modelMap.imageEditModelConfig || {};
  for (const value of [
    imageConfig.rootPostId,
    imageConfig.containerPostId,
    videoConfig.rootPostId,
    videoConfig.originalPostId,
    command?.source_container_id,
    imageConfig.parentPostId,
    videoConfig.parentPostId,
    command?.source_post_id,
    ...commandMediaIds(command),
  ]) {
    const id = String(value || "").trim();
    if (id) return id;
  }
  return "";
}


'''

READY_OLD = '''async function waitForBridgeStoreReady(win, command) {
  const ids = commandMediaIds(command);
  const needIdMatch = command.type === "crop_image" && ids.length > 0;
  const timeoutMs = needIdMatch ? 12000 : 8000;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await bridgeMediaContext(win, ids);
    if (last?.hasMediaStore && (!needIdMatch || last.matchedBy)) return last;
    await sleep(250);
  }
  return last;
}
'''

READY_NEW = '''async function waitForBridgeStoreReady(win, command, options = {}) {
  const ids = commandMediaIds(command);
  const needIdMatch = (Boolean(options.requireIdMatch) || command.type === "crop_image") && ids.length > 0;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || (needIdMatch ? 12000 : 8000)));
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await bridgeMediaContext(win, ids);
    if (last?.hasMediaStore && (!needIdMatch || last.matchedBy)) return last;
    await sleep(250);
  }
  return last;
}
'''

ENSURE_OLD = '''  let probe = await loginProbe(win);
  if (probe?.ok) {
    await waitForBridgeStoreReady(win, command);
    return win;
  }
'''

ENSURE_NEW = '''  let probe = await loginProbe(win);
  if (probe?.ok) {
    let context = await waitForBridgeStoreReady(win, command);
    const sourceId = command.type === "fetch_stream" ? commandSourceContextId(command) : "";
    if (sourceId && !context?.matchedBy) {
      const sourceUrl = `https://grok.com/imagine/post/${encodeURIComponent(sourceId)}`;
      await waitForLoad(win, sourceUrl, { forceTarget: true, timeoutMs: 10000 });
      context = await waitForBridgeStoreReady(win, command, { requireIdMatch: true, timeoutMs: 6000 });
      if (!context?.matchedBy) {
        throw new Error(`Imagine source card could not be prepared: ${sourceId}`);
      }
    }
    return win;
  }
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if new_count == 1:
        return text
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    raise RuntimeError(f"Unexpected {label} counts old={old_count} new={new_count}.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    if "function commandSourceContextId(" not in text:
        if text.count(HELPER_ANCHOR) != 1:
            raise RuntimeError("Bridge media context anchor was not found exactly once.")
        text = text.replace(HELPER_ANCHOR, HELPER + HELPER_ANCHOR, 1)
    text = replace_once(text, READY_OLD, READY_NEW, "bridge readiness options")
    text = replace_once(text, ENSURE_OLD, ENSURE_NEW, "source context preparation")

    required = (
        "function commandSourceContextId(command)",
        "Boolean(options.requireIdMatch)",
        'command.type === "fetch_stream" ? commandSourceContextId(command)',
        "Imagine source card could not be prepared",
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required source context markers are missing: {missing}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_SOURCE_CONTEXT_NAVIGATION_PATCHED {path}")
        return True
    print(f"IMAGINE_SOURCE_CONTEXT_NAVIGATION_ALREADY_PATCHED {path}")
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
