#!/usr/bin/env python3
"""Apply requested video settings through Grok's official Imagine mode store."""

from __future__ import annotations

import argparse
from pathlib import Path


GLOBAL_OLD = '''  let capturedStoreV2MethodsModule = "";
  let nextMediaStoreId = 1;
'''

GLOBAL_NEW = '''  let capturedStoreV2MethodsModule = "";
  let capturedImagineModeStore = null;
  let capturedImagineModeStorePath = "";
  let capturedImagineModeStoreModule = "";
  let nextMediaStoreId = 1;
'''

TRACE_OLD = '''        "duration", "videoLength", "resolutionName", "aspectRatio", "mode", "source", "location",
'''

TRACE_NEW = '''        "duration", "videoLength", "resolutionName", "aspectRatio", "mode", "source", "location", "requestedResolution", "allowedResolution", "appliedResolution",
        "requestedAspectRatio", "appliedAspectRatio", "requestedDuration", "appliedDuration",
        "imagineModeStorePath", "imagineModeStoreModule",
'''

CAPTURE_ANCHOR = '''  function inspectExportProperties(value, path, moduleId = "", depth = 0, seen = new Set()) {
'''

CAPTURE_BLOCK = '''  function captureImagineModeStore(value, path, moduleId = "") {
    if (!value || typeof value.getState !== "function") return false;
    let state = null;
    try {
      state = value.getState();
    } catch (_) {
      return false;
    }
    if (
      !state
      || typeof state.setResolution !== "function"
      || typeof state.allowedVideoResolution !== "function"
      || typeof state.setAspectRatio !== "function"
      || typeof state.setVideoLength !== "function"
      || !("resolution" in state)
    ) {
      return false;
    }
    if (!capturedImagineModeStore) {
      capturedImagineModeStore = value;
      capturedImagineModeStorePath = path || "";
      capturedImagineModeStoreModule = moduleId || "";
      pushStoreTrace("imagine_mode_store_captured", {
        imagineModeStorePath: capturedImagineModeStorePath,
        imagineModeStoreModule: capturedImagineModeStoreModule,
        resolutionName: state.resolution || "",
        aspectRatio: state.aspectRatio,
        videoLength: state.videoLength,
      });
    }
    return true;
  }

'''

PROPERTY_CAPTURE_OLD = '''      captureMediaStore(candidate, candidatePath, moduleId);
      try {
        if (candidate.getStoreV2Methods) captureStoreV2Methods(candidate.getStoreV2Methods, `${candidatePath}.getStoreV2Methods`, moduleId);
'''

PROPERTY_CAPTURE_NEW = '''      captureMediaStore(candidate, candidatePath, moduleId);
      captureImagineModeStore(candidate, candidatePath, moduleId);
      try {
        if (candidate.getStoreV2Methods) captureStoreV2Methods(candidate.getStoreV2Methods, `${candidatePath}.getStoreV2Methods`, moduleId);
'''

PROPERTY_EXPLICIT_OLD = '''      try {
        if (candidate.useMediaStore) captureMediaStore(candidate.useMediaStore, `${candidatePath}.useMediaStore`, moduleId);
      } catch (_) {}
      try {
        if (candidate.default) captureMediaStore(candidate.default, `${candidatePath}.default`, moduleId);
'''

PROPERTY_EXPLICIT_NEW = '''      try {
        if (candidate.useMediaStore) captureMediaStore(candidate.useMediaStore, `${candidatePath}.useMediaStore`, moduleId);
      } catch (_) {}
      try {
        if (candidate.useImagineModeStore) captureImagineModeStore(candidate.useImagineModeStore, `${candidatePath}.useImagineModeStore`, moduleId);
      } catch (_) {}
      try {
        if (candidate.default) captureMediaStore(candidate.default, `${candidatePath}.default`, moduleId);
'''

EXPORTS_OLD = '''    captureMediaStore(value, path, moduleId);
    try {
      if (value.getStoreV2Methods) captureStoreV2Methods(value.getStoreV2Methods, `${path}.getStoreV2Methods`, moduleId);
'''

EXPORTS_NEW = '''    captureMediaStore(value, path, moduleId);
    captureImagineModeStore(value, path, moduleId);
    try {
      if (value.getStoreV2Methods) captureStoreV2Methods(value.getStoreV2Methods, `${path}.getStoreV2Methods`, moduleId);
'''

EXPORTS_EXPLICIT_OLD = '''    try {
      if (value.useMediaStore) captureMediaStore(value.useMediaStore, `${path}.useMediaStore`, moduleId);
    } catch (_) {}
    try {
      if (value.default) captureMediaStore(value.default, `${path}.default`, moduleId);
'''

EXPORTS_EXPLICIT_NEW = '''    try {
      if (value.useMediaStore) captureMediaStore(value.useMediaStore, `${path}.useMediaStore`, moduleId);
    } catch (_) {}
    try {
      if (value.useImagineModeStore) captureImagineModeStore(value.useImagineModeStore, `${path}.useImagineModeStore`, moduleId);
    } catch (_) {}
    try {
      if (value.default) captureMediaStore(value.default, `${path}.default`, moduleId);
'''

READY_OLD = "capturedMediaStore && capturedStoreV2Methods"
READY_NEW = "capturedMediaStore && capturedStoreV2Methods && capturedImagineModeStore"

SETTINGS_ANCHOR = '''  function generationSourceReady(state, sourceId) {
'''

SETTINGS_BLOCK = '''  function normalizedAspectRatioTuple(value) {
    if (Array.isArray(value) && value.length >= 2) {
      const width = Number(value[0]);
      const height = Number(value[1]);
      if (width > 0 && height > 0) return [width, height];
    }
    const match = String(value || "").trim().match(/^(\\d+(?:\\.\\d+)?)\\s*[:/]\\s*(\\d+(?:\\.\\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? [width, height] : null;
  }

  function sameAspectRatio(left, right) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length >= 2
      && right.length >= 2
      && Number(left[0]) === Number(right[0])
      && Number(left[1]) === Number(right[1]);
  }

  async function applyOfficialVideoGenerationSettings({
    requestId,
    variant,
    resolutionName,
    aspectRatio,
    durationSeconds,
  }) {
    scanAllRuntimes();
    if (!capturedImagineModeStore || typeof capturedImagineModeStore.getState !== "function") {
      throw new Error("Official Imagine mode store was not captured.");
    }
    let state = capturedImagineModeStore.getState();
    const requestedResolution = ["480p", "720p", "1080p"].includes(String(resolutionName || "").toLowerCase())
      ? String(resolutionName).toLowerCase()
      : "";
    const requestedAspectRatio = normalizedAspectRatioTuple(aspectRatio);
    const requestedDuration = Number(durationSeconds || 0) || 0;
    const before = {
      resolutionName: String(state?.resolution || ""),
      aspectRatio: Array.isArray(state?.aspectRatio) ? state.aspectRatio.slice(0, 2) : state?.aspectRatio,
      videoLength: Number(state?.videoLength || 0) || 0,
    };

    let allowedResolution = requestedResolution;
    if (requestedResolution) {
      allowedResolution = String(state.allowedVideoResolution(requestedResolution) || "").toLowerCase();
      if (allowedResolution !== requestedResolution) {
        throw new Error(`Official Imagine does not allow requested video resolution ${requestedResolution}; allowed=${allowedResolution || "none"}.`);
      }
      state = capturedImagineModeStore.getState();
      state.setResolution(requestedResolution);
    }
    state = capturedImagineModeStore.getState();
    if (requestedAspectRatio && !sameAspectRatio(state.aspectRatio, requestedAspectRatio)) {
      state.setAspectRatio(requestedAspectRatio);
    }
    state = capturedImagineModeStore.getState();
    if (requestedDuration > 0 && Number(state.videoLength || 0) !== requestedDuration) {
      state.setVideoLength(requestedDuration);
    }
    await sleep(0);
    state = capturedImagineModeStore.getState();
    const after = {
      resolutionName: String(state?.resolution || "").toLowerCase(),
      aspectRatio: Array.isArray(state?.aspectRatio) ? state.aspectRatio.slice(0, 2) : state?.aspectRatio,
      videoLength: Number(state?.videoLength || 0) || 0,
    };
    if (requestedResolution && after.resolutionName !== requestedResolution) {
      throw new Error(`Official Imagine video resolution was not applied: requested=${requestedResolution} actual=${after.resolutionName || "none"}.`);
    }
    if (requestedAspectRatio && !sameAspectRatio(after.aspectRatio, requestedAspectRatio)) {
      throw new Error(`Official Imagine video aspect ratio was not applied: requested=${requestedAspectRatio.join(":")}.`);
    }
    pushStoreTrace("store_generation_official_video_settings_applied", {
      requestId,
      variant,
      requestedResolution,
      allowedResolution,
      appliedResolution: after.resolutionName,
      requestedAspectRatio,
      appliedAspectRatio: after.aspectRatio,
      requestedDuration,
      appliedDuration: after.videoLength,
      before,
      after,
      imagineModeStorePath: capturedImagineModeStorePath,
      imagineModeStoreModule: capturedImagineModeStoreModule,
    });
    return after;
  }

'''

VIDEO_CALL_OLD = '''      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
      );
      if (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension") {
'''

VIDEO_CALL_NEW = '''      state = await hydrateGenerationSource(
        storeContext,
        videoInputAsset || parentPostId || extendPostId || containerId,
        requestId,
        variant.kind,
      );
      await applyOfficialVideoGenerationSettings({
        requestId,
        variant: variant.kind,
        resolutionName,
        aspectRatio: params.aspectRatio || videoConfig.aspectRatio,
        durationSeconds,
      });
      if (variant.kind === "imageToVideo" || variant.kind === "referenceToVideo" || variant.kind === "videoExtension") {
'''

STATUS_OLD = '''        storeV2MethodsModule: capturedStoreV2MethodsModule,
        mediaStores: capturedMediaStores.slice(0, 12).map((record) => ({
'''

STATUS_NEW = '''        storeV2MethodsModule: capturedStoreV2MethodsModule,
        hasImagineModeStore: Boolean(capturedImagineModeStore),
        imagineModeStorePath: capturedImagineModeStorePath,
        imagineModeStoreModule: capturedImagineModeStoreModule,
        mediaStores: capturedMediaStores.slice(0, 12).map((record) => ({
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
        "captureImagineModeStore",
        "useImagineModeStore",
        "applyOfficialVideoGenerationSettings",
        "store_generation_official_video_settings_applied",
        "state.setResolution(requestedResolution)",
        "state.setAspectRatio(requestedAspectRatio)",
        "state.setVideoLength(requestedDuration)",
        "hasImagineModeStore",
    )
    removed_markers = (
        "finalVideoRequestPatch",
        "video_request_final_patch",
        "Official Imagine final video request was not intercepted",
    )
    if all(marker in text for marker in completed_markers) and not any(marker in text for marker in removed_markers):
        print(f"IMAGINE_OFFICIAL_VIDEO_SETTINGS_ALREADY_PATCHED {path}")
        return False
    text = replace_once(text, GLOBAL_OLD, GLOBAL_NEW, "Imagine mode store globals")
    text = replace_once(text, TRACE_OLD, TRACE_NEW, "Imagine settings trace keys")
    if "  function captureImagineModeStore(value, path, moduleId = \"\") {\n" not in text:
      if text.count(CAPTURE_ANCHOR) != 1:
          raise RuntimeError("Imagine mode store capture anchor was not found exactly once.")
      text = text.replace(CAPTURE_ANCHOR, CAPTURE_BLOCK + CAPTURE_ANCHOR, 1)
    text = replace_once(text, PROPERTY_CAPTURE_OLD, PROPERTY_CAPTURE_NEW, "nested store capture")
    text = replace_once(text, PROPERTY_EXPLICIT_OLD, PROPERTY_EXPLICIT_NEW, "nested Imagine mode export capture")
    text = replace_once(text, EXPORTS_OLD, EXPORTS_NEW, "root store capture")
    text = replace_once(text, EXPORTS_EXPLICIT_OLD, EXPORTS_EXPLICIT_NEW, "root Imagine mode export capture")

    old_ready_count = text.count(READY_OLD)
    new_ready_count = text.count(READY_NEW)
    if new_ready_count == 0:
        if old_ready_count != 5:
            raise RuntimeError(f"Unexpected store-ready condition count old={old_ready_count}.")
        text = text.replace(READY_OLD, READY_NEW)
    elif old_ready_count != new_ready_count or new_ready_count != 5:
        raise RuntimeError(
            f"Unexpected patched store-ready condition counts old={old_ready_count} new={new_ready_count}."
        )

    if "  async function applyOfficialVideoGenerationSettings({\n" not in text:
        if text.count(SETTINGS_ANCHOR) != 1:
            raise RuntimeError("Official video settings anchor was not found exactly once.")
        text = text.replace(SETTINGS_ANCHOR, SETTINGS_BLOCK + SETTINGS_ANCHOR, 1)
    text = replace_once(text, VIDEO_CALL_OLD, VIDEO_CALL_NEW, "official video settings call")
    text = replace_once(text, STATUS_OLD, STATUS_NEW, "Imagine mode store bridge status")

    required = (
        "captureImagineModeStore",
        "useImagineModeStore",
        "applyOfficialVideoGenerationSettings",
        "store_generation_official_video_settings_applied",
        "state.setResolution(requestedResolution)",
        "state.setAspectRatio(requestedAspectRatio)",
        "state.setVideoLength(requestedDuration)",
        "hasImagineModeStore",
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required official video settings markers are missing: {missing}")
    remaining = [marker for marker in removed_markers if marker in text]
    if remaining:
        raise RuntimeError(f"Removed final request hook markers returned: {remaining}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_OFFICIAL_VIDEO_SETTINGS_PATCHED {path}")
        return True
    print(f"IMAGINE_OFFICIAL_VIDEO_SETTINGS_ALREADY_PATCHED {path}")
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
