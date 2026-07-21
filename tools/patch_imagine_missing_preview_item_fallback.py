#!/usr/bin/env python3
"""Keep an Imagine post visible when only its representative media was deleted."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD = '''function removeUnavailableImaginePost(postPath, host = null) {
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
    if (/^imagine_discover\\//.test(path)) {
      if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
      return;
    }
    if (/^imagine_unsaved\\//.test(path)) {
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
'''


NEW = '''function imaginePreviewUrlKey(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    parsed.searchParams.delete("_card_retry");
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}`
      : parsed.toString();
  } catch {
    return value.replace(/([?&])_card_retry=[^&]*(&|$)/, (match, prefix, suffix) => (
      suffix ? prefix : ""
    ));
  }
}

function imagineItemUsesPreviewUrl(item, url) {
  const target = imaginePreviewUrlKey(url);
  if (!target || !item) return false;
  const candidates = [
    item.object_url,
    item.url,
    item.remote_url,
    item.thumbnail_url,
    item.poster_url,
    typeof mediaPreviewUrl === "function" ? mediaPreviewUrl(item) : "",
    typeof videoPreviewUrl === "function" ? videoPreviewUrl(item) : "",
  ];
  return candidates.some((candidate) => imaginePreviewUrlKey(candidate) === target);
}

function removeUnavailableImagineItem(postPath, url, host = null) {
  const path = String(postPath || "").trim();
  if (!path || typeof library_state !== "object" || !library_state) return false;
  let changed = false;
  let keptPost = null;
  for (const stateKey of [
    "imagineRemotePosts",
    "imagineDiscoverPosts",
    "imagineUnsavedPosts",
    "imagineSearchPosts",
  ]) {
    if (!Array.isArray(library_state[stateKey])) continue;
    library_state[stateKey] = library_state[stateKey].flatMap((post) => {
      if (String(post?.folder_path || "") !== path) return [post];
      const items = Array.isArray(post?.items) ? post.items : [];
      const remaining = items.filter((item) => !imagineItemUsesPreviewUrl(item, url));
      if (remaining.length === items.length) return [post];
      changed = true;
      if (!remaining.length) return [];
      const representative = representativeItem(remaining, { ...post, items: remaining }) || remaining[0];
      const nextPost = normalizeServerPost({
        ...post,
        items: remaining,
        representative: representative?.file || representative?.url || representative?.item_id || "",
        representative_item: representative,
      });
      keptPost = nextPost;
      return [nextPost];
    });
  }
  if (!changed) return false;
  if (!keptPost) {
    library_state.sessionImagineT2iPaths?.delete?.(path);
    library_state.selectedItems?.delete?.(path);
    if (String(library_state.selectedPostPath || "") === path) {
      library_state.selectedPostPath = "";
      library_state.selectedDetailItemId = "";
    }
  } else if (
    String(library_state.selectedPostPath || "") === path
    && !keptPost.items.some((item) => mediaItemKey(item) === String(library_state.selectedDetailItemId || ""))
  ) {
    library_state.selectedDetailItemId = mediaItemKey(keptPost.representative_item || keptPost.items[0]);
  }
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
  host?.remove?.();
  window.setTimeout(() => {
    if (typeof screen_state === "object" && screen_state?.current_screen === "search_main") {
      if (typeof renderSearchResults === "function") renderSearchResults();
      return;
    }
    if (/^imagine_discover\\//.test(path)) {
      if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
      return;
    }
    if (/^imagine_unsaved\\//.test(path)) {
      if (typeof renderImagineUnsavedCards === "function") renderImagineUnsavedCards();
      return;
    }
    if (typeof renderImagineSourceCards === "function") renderImagineSourceCards();
  }, 0);
  return true;
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
    return removeUnavailableImagineItem(path, key, host);
  }).catch(() => false).finally(() => {
    missingImagineCardPreviewChecks.delete(key);
  });
  missingImagineCardPreviewChecks.set(key, check);
  return check;
}
'''


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    completed_markers = (
        "function imaginePreviewUrlKey(url)",
        "function imagineItemUsesPreviewUrl(item, url)",
        "function removeUnavailableImagineItem(postPath, url, host = null)",
        "return removeUnavailableImagineItem(path, key, host);",
    )
    if all(marker in text for marker in completed_markers):
        print(f"IMAGINE_MISSING_PREVIEW_ITEM_FALLBACK_ALREADY_PATCHED {path}")
        return False
    old_count = text.count(OLD)
    new_count = text.count(NEW)
    if old_count == 1 and new_count == 0:
        text = text.replace(OLD, NEW, 1)
    elif old_count == 0 and new_count == 1:
        pass
    else:
        raise RuntimeError(
            f"Unexpected missing preview fallback counts old={old_count} new={new_count}."
        )
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_MISSING_PREVIEW_ITEM_FALLBACK_PATCHED {path}")
        return True
    print(f"IMAGINE_MISSING_PREVIEW_ITEM_FALLBACK_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("detail_media_js", type=Path)
    args = parser.parse_args()
    if args.detail_media_js.name != "detail_media.js":
        raise RuntimeError("Expected detail_media.js.")
    patch_file(args.detail_media_js)


if __name__ == "__main__":
    main()
