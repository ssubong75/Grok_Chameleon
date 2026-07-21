#!/usr/bin/env python3
"""Hand video completion tracking to REST polling without repeated store refreshes."""

from __future__ import annotations

import argparse
from pathlib import Path


TRACE_KEYS_OLD = '''        "inflightId", "trackedIds", "noCandidateMs", "sourceId", "targetId", "targets",
'''

TRACE_KEYS_NEW = '''        "inflightId", "trackedIds", "noCandidateMs", "sourceId", "targetId", "targets", "storeObservationMs",
'''

REFRESH_STATE_OLD = '''    let lastSnapshotKey = "";
    let videoRootRefreshCall = null;
    let lastVideoRootRefreshAt = 0;
'''

REFRESH_STATE_NEW = '''    let lastSnapshotKey = "";
'''

REFRESH_BLOCK_OLD = '''        const refreshState = videoRootRefreshCall ? videoRootRefreshCall.state() : null;
        const now = Date.now();
        if (
          tracking.ids?.size > 0
          && typeof state?.fetchMediaPost === "function"
          && (!refreshState || refreshState.state !== "pending")
          && now - lastVideoRootRefreshAt >= 3000
        ) {
          lastVideoRootRefreshAt = now;
          videoRootRefreshCall = startStoreMethodCall(
            "fetchMediaPost",
            state.fetchMediaPost.bind(state),
            [containerId],
          );
          pushStoreTrace("store_generation_video_root_refresh", {
            requestId,
            containerId,
            trackedIds: Array.from(tracking.ids).slice(0, 20),
          });
        }
'''

HANDOFF_ANCHOR = '''        if (!tracking.retainTrackedCandidateUntilDeadline && !hasInProgressCandidate && now - tracking.firstCandidateSeenAt >= Number(tracking.candidateStabilizeMs || 10000)) {
'''

HANDOFF_BLOCK = '''        const storeObservationMs = Number(tracking.storeObservationMs || 8000);
        if (hasInProgressCandidate && now - tracking.firstCandidateSeenAt >= storeObservationMs) {
          pushStoreTrace("store_generation_candidate_handoff", {
            requestId,
            containerId,
            observedMs: now - tracking.firstCandidateSeenAt,
            storeObservationMs,
            trackedIds: Array.from(tracking.ids || []).slice(0, 20),
          });
          return retainedEvents;
        }
'''

TRACKING_OLD = '''        candidateStabilizeMs,
        recoveryMs: videoRecoveryMs,
'''

TRACKING_NEW = '''        candidateStabilizeMs,
        storeObservationMs: 8000,
        recoveryMs: videoRecoveryMs,
'''

POLICY_TRACE_OLD = '''        candidateStabilizeMs: videoTracking.candidateStabilizeMs,
'''

POLICY_TRACE_NEW = '''        candidateStabilizeMs: videoTracking.candidateStabilizeMs,
        storeObservationMs: videoTracking.storeObservationMs,
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        return text
    raise RuntimeError(f"Unexpected {label} counts old={old_count} new={new_count}.")


def remove_once(text: str, old: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, "", 1)
    if count == 0:
        return text
    raise RuntimeError(f"Unexpected {label} count={count}.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    text = replace_once(text, TRACE_KEYS_OLD, TRACE_KEYS_NEW, "video handoff trace keys")
    if REFRESH_STATE_OLD in text:
        if text.count(REFRESH_STATE_OLD) != 1:
            raise RuntimeError("Repeated root refresh state was not found exactly once.")
        text = text.replace(REFRESH_STATE_OLD, REFRESH_STATE_NEW, 1)
    elif text.count(REFRESH_STATE_NEW) != 1:
        raise RuntimeError("Patched root refresh state was not found exactly once.")
    text = remove_once(text, REFRESH_BLOCK_OLD, "repeated root refresh block")
    if HANDOFF_BLOCK not in text:
        if text.count(HANDOFF_ANCHOR) != 1:
            raise RuntimeError("Video candidate handoff anchor was not found exactly once.")
        text = text.replace(HANDOFF_ANCHOR, HANDOFF_BLOCK + HANDOFF_ANCHOR, 1)
    text = replace_once(text, TRACKING_OLD, TRACKING_NEW, "video observation policy")
    if POLICY_TRACE_NEW not in text:
        if text.count(POLICY_TRACE_OLD) != 1:
            raise RuntimeError("Video observation trace anchor was not found exactly once.")
        text = text.replace(POLICY_TRACE_OLD, POLICY_TRACE_NEW, 1)

    required = (
        "store_generation_candidate_handoff",
        "storeObservationMs: 8000",
        "storeObservationMs: videoTracking.storeObservationMs",
        "const resultEvents = await waitForStoreEvents(",
    )
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise RuntimeError(f"Required video result handoff markers are missing: {missing}")
    forbidden = (
        "store_generation_video_root_refresh",
        "videoRootRefreshCall",
        "lastVideoRootRefreshAt",
    )
    remaining = [marker for marker in forbidden if marker in text]
    if remaining:
        raise RuntimeError(f"Repeated root refresh markers remain: {remaining}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_VIDEO_RESULT_HANDOFF_PATCHED {path}")
        return True
    print(f"IMAGINE_VIDEO_RESULT_HANDOFF_ALREADY_PATCHED {path}")
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
