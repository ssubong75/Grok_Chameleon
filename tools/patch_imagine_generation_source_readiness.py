#!/usr/bin/env python3
"""Hydrate official Imagine source media before store generation calls."""

from __future__ import annotations

import argparse
from pathlib import Path


HELPER_ANCHOR = '''  async function ensureContainerFromInput(state, expectedType, prompt, inputIds, urls, mimeType) {
'''

HELPER_BLOCK = '''  function generationSourceReady(state, sourceId) {
    const value = resolvedMediaId(state, sourceId);
    if (!value) return false;
    if (state?.byId?.[value]) return true;
    for (const collection of [state?.imageByMediaId, state?.videoByMediaId]) {
      for (const items of Object.values(collection || {})) {
        if (Array.isArray(items) && items.some((item) => storeItemId(item) === value)) return true;
      }
    }
    return false;
  }

  async function hydrateGenerationSource(storeContext, sourceId, requestId, variant, timeoutMs = 8000) {
    const value = String(sourceId || "").trim();
    let state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
    if (!value || generationSourceReady(state, value)) return state;
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(1000, Number(timeoutMs) || 8000);
    const targets = [];
    const addTarget = (candidate) => {
      const id = String(candidate || "").trim();
      if (id && !targets.includes(id)) targets.push(id);
    };
    addTarget(value);
    addTarget(containerPostIdFor(state, value));
    pushStoreTrace("store_generation_source_hydration_start", {
      requestId,
      variant,
      sourceId: value,
      targets,
    });
    for (const targetId of targets) {
      state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      const fetchMethod = resolveStoreMethod(state, storeContext.record, "fetchMediaPost");
      if (!fetchMethod.fn) break;
      const callState = startStoreMethodCall("fetchMediaPost", fetchMethod.fn, [targetId]);
      await Promise.race([
        callState.promise,
        sleep(Math.max(250, Math.min(4000, deadline - Date.now()))),
      ]);
      state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      if (generationSourceReady(state, value)) {
        pushStoreTrace("store_generation_source_hydration_ready", {
          requestId,
          variant,
          sourceId: value,
          targetId,
          elapsedMs: Date.now() - startedAt,
        });
        return state;
      }
      if (Date.now() >= deadline) break;
    }
    while (Date.now() < deadline) {
      state = storeContext.record ? mediaStoreStateForRecord(storeContext.record) : getMediaStoreState();
      if (generationSourceReady(state, value)) {
        pushStoreTrace("store_generation_source_hydration_ready", {
          requestId,
          variant,
          sourceId: value,
          elapsedMs: Date.now() - startedAt,
        });
        return state;
      }
      await sleep(100);
    }
    pushStoreTrace("store_generation_source_hydration_timeout", {
      requestId,
      variant,
      sourceId: value,
      elapsedMs: Date.now() - startedAt,
    });
    return state;
  }

'''

TRACE_KEYS_OLD = '''        "inflightId", "trackedIds", "noCandidateMs",
'''

TRACE_KEYS_NEW = '''        "inflightId", "trackedIds", "noCandidateMs", "sourceId", "targetId", "targets",
'''

IMAGE_OLD = '''      if (!containerId) throw new Error("Official image edit container could not be resolved.");
      syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      state = ensureStoreLoginState(state, storeContext.record, requestId, "fetchGenerateImageEdits", [containerId].concat(inputIds));
      syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      const beforeIds = currentIds(state, containerId, "image");
      if (typeof state.fetchGenerateImageEdits !== "function") throw new Error("Official fetchGenerateImageEdits is missing.");
      const parentPostId = imageConfig.parentPostId || inputIds[0] || containerId;
'''

IMAGE_NEW = '''      if (!containerId) throw new Error("Official image edit container could not be resolved.");
      const parentPostId = imageConfig.parentPostId || inputIds[0] || containerId;
      state = await hydrateGenerationSource(
        storeContext,
        parentPostId || inputIds[0] || containerId,
        requestId,
        variant.kind,
      );
      syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      state = ensureStoreLoginState(state, storeContext.record, requestId, "fetchGenerateImageEdits", [containerId].concat(inputIds));
      syncCurrentRootContainer(state, requestId, variant.kind, containerId);
      const beforeIds = currentIds(state, containerId, "image");
      if (typeof state.fetchGenerateImageEdits !== "function") throw new Error("Official fetchGenerateImageEdits is missing.");
'''

VIDEO_OLD = '''      if (!containerId) throw new Error("Official video container could not be resolved.");
      if (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension") {
'''

VIDEO_NEW = '''      if (!containerId) throw new Error("Official video container could not be resolved.");
      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
      );
      if (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension") {
'''

VIDEO_HYDRATION_MARKER = '''      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
      );
'''

RETRY_ANCHOR = '''  async function waitForStoreEvents(containerId, expectedType, requestId, prompt, beforeIds, timeoutMs, callState = null, record = null, tracking = null) {
'''

RETRY_BLOCK = '''  function isRateLimitedStoreCall(info) {
    return Boolean(info && ["rejected", "threw"].includes(info.state) && /rate\\s*limited/i.test(String(info.error || "")));
  }

  async function retryRateLimitedStoreCall(name, fn, args, requestId, callState, maxRetries = 2) {
    let current = callState;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const checkDeadline = Date.now() + 3000;
      let info = current ? current.state() : null;
      while (Date.now() < checkDeadline) {
        info = current ? current.state() : null;
        if (isRateLimitedStoreCall(info)) break;
        if (info && info.state !== "pending") return current;
        await sleep(250);
      }
      if (!isRateLimitedStoreCall(info)) return current;
      const delayMs = attempt === 1 ? 12000 : 25000;
      pushStoreTrace("store_generation_call_retry", {
        requestId,
        name,
        attempt,
        delayMs,
        error: info?.error || "",
      });
      await sleep(delayMs);
      current = startStoreMethodCall(name, fn, args);
    }
    return current;
  }

'''

RETRY_CALL_OLD = '''        callState = startStoreMethodCall("generateVideoForImage", generateVideoMethod.fn, args);
'''

RETRY_CALL_NEW = '''        callState = startStoreMethodCall("generateVideoForImage", generateVideoMethod.fn, args);
        callState = await retryRateLimitedStoreCall("generateVideoForImage", generateVideoMethod.fn, args, requestId, callState, 2);
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
    if "  function generationSourceReady(state, sourceId) {\n" not in text:
        if text.count(HELPER_ANCHOR) != 1:
            raise RuntimeError("Generation source helper anchor was not found exactly once.")
        text = text.replace(HELPER_ANCHOR, HELPER_BLOCK + HELPER_ANCHOR, 1)
    text = replace_once(text, TRACE_KEYS_OLD, TRACE_KEYS_NEW, "generation trace keys")
    text = replace_once(text, IMAGE_OLD, IMAGE_NEW, "image source hydration")
    # A later official-settings patch intentionally inserts code between this
    # hydration call and the following variant branch.  Detect the stable call
    # itself so rerunning this patch remains safe after both patches are applied.
    if VIDEO_HYDRATION_MARKER not in text:
        text = replace_once(text, VIDEO_OLD, VIDEO_NEW, "video source hydration")

    if "  function isRateLimitedStoreCall(info) {\n" not in text:
        if text.count(RETRY_ANCHOR) != 1:
            raise RuntimeError("Rate-limit retry anchor was not found exactly once.")
        text = text.replace(RETRY_ANCHOR, RETRY_BLOCK + RETRY_ANCHOR, 1)
    if RETRY_CALL_NEW not in text:
        if text.count(RETRY_CALL_OLD) != 1:
            raise RuntimeError(
                f"Unexpected video rate-limit retry call count old={text.count(RETRY_CALL_OLD)}."
            )
        text = text.replace(RETRY_CALL_OLD, RETRY_CALL_NEW, 1)

    required = (
        "store_generation_source_hydration_start",
        "store_generation_source_hydration_ready",
        "store_generation_source_hydration_timeout",
        "retryRateLimitedStoreCall",
        'const resultEvents = await waitForStoreEvents(',
        'startStoreMethodCall("generateVideoForImage"',
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required generation markers are missing: {missing}")
    forbidden = (
        "finalVideoRequestPatch",
        "video_request_final_patch",
        "official_video_duration_arg_applied",
        "Official Imagine final video request was not intercepted",
    )
    remaining = [marker for marker in forbidden if marker in text]
    if remaining:
        raise RuntimeError(f"Removed final request hook markers returned: {remaining}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_GENERATION_SOURCE_READINESS_PATCHED {path}")
        return True
    print(f"IMAGINE_GENERATION_SOURCE_READINESS_ALREADY_PATCHED {path}")
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
