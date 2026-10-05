#!/usr/bin/env python3
"""Hide confirmed-deleted Imagine cards instead of rendering broken previews."""

from __future__ import annotations

import sys
from pathlib import Path


HELPERS = r'''function isImagineRemotePreviewUrl(url) {
  const value = String(url || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname === "/api/imagine/remote/media";
  } catch {
    return false;
  }
}

function removeUnavailableImaginePost(postPath, host = null) {
  const path = String(postPath || "").trim();
  if (!path || typeof library_state !== "object" || !library_state) return false;
  let removed = false;
  for (const key of [
    "imagineRemotePosts",
    "imagineDiscoverPosts",
    "imagineUnsavedPosts",
    "imagineSearchPosts",
  ]) {
    if (!Array.isArray(library_state[key])) continue;
    const before = library_state[key].length;
    library_state[key] = library_state[key].filter((post) => String(post?.folder_path || "") !== path);
    if (library_state[key].length !== before) removed = true;
  }
  library_state.sessionImagineT2iPaths?.delete?.(path);
  library_state.selectedItems?.delete?.(path);
  if (String(library_state.selectedPostPath || "") === path) {
    library_state.selectedPostPath = "";
    library_state.selectedDetailItemId = "";
  }
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
  host?.remove?.();
  window.setTimeout(() => {
    if (typeof screen_state === "object" && screen_state?.current_screen === "search_main") {
      if (typeof renderSearchResults === "function") renderSearchResults();
      return;
    }
    if (/^imagine_discover\//.test(path)) {
      if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
      return;
    }
    if (/^imagine_unsaved\//.test(path)) {
      if (typeof renderImagineUnsavedCards === "function") renderImagineUnsavedCards();
      return;
    }
    if (typeof renderImagineSourceCards === "function") renderImagineSourceCards();
  }, 0);
  return removed;
}

function handleUnavailableImagineCardPreview(host, url, postPath) {
  const key = String(url || "").trim();
  const path = String(postPath || "").trim();
  if (!path || !isImagineRemotePreviewUrl(key)) return Promise.resolve(false);
  if (missingImagineCardPreviewChecks.has(key)) return missingImagineCardPreviewChecks.get(key);
  const check = fetch(cardPreviewRetryUrl(key, `missing-${Date.now()}`), {
    method: "HEAD",
    cache: "no-store",
  }).then((response) => {
    if (![404, 410].includes(Number(response.status))) return false;
    removeUnavailableImaginePost(path, host);
    return true;
  }).catch(() => false).finally(() => {
    missingImagineCardPreviewChecks.delete(key);
  });
  missingImagineCardPreviewChecks.set(key, check);
  return check;
}

function cardPreviewLoadOptions(host, item, url) {
  const postPath = String(item?.card_remote_post_path || "").trim();
  return {
    retries: item?.card_preview_retries,
    onUnavailable: postPath
      ? () => handleUnavailableImagineCardPreview(host, url, postPath)
      : null,
  };
}
'''


def replace_count(text: str, old: str, new: str, count: int, label: str) -> str:
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"Expected {count} {label} block(s), found {actual}.")
    return text.replace(old, new)


def patch_detail(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "function handleUnavailableImagineCardPreview(" in text:
        print("DELETED_REMOTE_PREVIEW_DETAIL_ALREADY_PATCHED")
        return
    text = replace_count(
        text,
        '  : null;\nlet detailLastMediaAspect = "";\n',
        '  : null;\nconst missingImagineCardPreviewChecks = new Map();\nlet detailLastMediaAspect = "";\n',
        1,
        "preview check map",
    )
    text = replace_count(
        text,
        '\nfunction resolveLocalCardPreview(url) {\n',
        f'\n{HELPERS}\nfunction resolveLocalCardPreview(url) {{\n',
        1,
        "preview helper insertion",
    )
    text = replace_count(
        text,
        '  let retryCount = 0;\n  let retryPending = false;\n',
        '  let retryCount = 0;\n  let retryPending = false;\n  let terminalPending = false;\n',
        1,
        "terminal state",
    )
    text = replace_count(
        text,
        '''    if (retryCount >= maxRetries) {
      media.classList.add("card_media_failed");
      return;
    }
''',
        '''    if (retryCount >= maxRetries) {
      if (terminalPending) return;
      terminalPending = true;
      const unavailableHandler = typeof options.onUnavailable === "function" ? options.onUnavailable : null;
      if (!unavailableHandler) {
        media.classList.add("card_media_failed");
        return;
      }
      Promise.resolve(unavailableHandler()).then((handled) => {
        if (!handled && media.isConnected) media.classList.add("card_media_failed");
      }).catch(() => {
        if (media.isConnected) media.classList.add("card_media_failed");
      });
      return;
    }
''',
        1,
        "terminal preview failure",
    )
    text = replace_count(
        text,
        '''function appendCardImagePreview(media, preview, previewUrl, item) {
  bindCardPreviewLoadState(media, preview, previewUrl, { retries: item?.card_preview_retries });
''',
        '''function appendCardImagePreview(host, media, preview, previewUrl, item) {
  bindCardPreviewLoadState(media, preview, previewUrl, cardPreviewLoadOptions(host, item, previewUrl));
''',
        1,
        "image preview binding",
    )
    text = replace_count(
        text,
        'appendCardImagePreview(media, preview, previewUrl, item);',
        'appendCardImagePreview(host, media, preview, previewUrl, item);',
        2,
        "image preview call",
    )
    text = replace_count(
        text,
        'bindCardPreviewLoadState(media, preview, videoUrl, { retries: item?.card_preview_retries });',
        'bindCardPreviewLoadState(media, preview, videoUrl, cardPreviewLoadOptions(host, item, videoUrl));',
        1,
        "video preview binding",
    )
    path.write_text(text, encoding="utf-8", newline="\n")
    print("DELETED_REMOTE_PREVIEW_DETAIL_PATCHED")


def patch_card(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "card_remote_post_path" in text:
        print("DELETED_REMOTE_PREVIEW_CARD_ALREADY_PATCHED")
        return
    text = replace_count(
        text,
        '''  const media = document.createElement("div");
  media.className = `card_media card_${type}`;
  appendMediaPreview(article, media, representative, type);
''',
        '''  const media = document.createElement("div");
  media.className = `card_media card_${type}`;
  const previewItem = remoteOnly
    ? { ...representative, card_remote_post_path: String(post.folder_path || "") }
    : representative;
  appendMediaPreview(article, media, previewItem, type);
''',
        1,
        "remote card preview context",
    )
    path.write_text(text, encoding="utf-8", newline="\n")
    print("DELETED_REMOTE_PREVIEW_CARD_PATCHED")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch_deleted_remote_card_preview.py DETAIL_MEDIA_JS CARD_RENDER_JS")
    patch_detail(Path(sys.argv[1]))
    patch_card(Path(sys.argv[2]))


if __name__ == "__main__":
    main()
