// Image editor open/return flow

const IMAGE_EDITOR_SAVED_KEY = "grokStudioImageEditorSavedItemId";
const IMAGE_EDITOR_SAVE_TARGET_KEY = "grokStudioImageEditorSaveTarget";
const IMAGE_EDITOR_RETURN_PROVIDER_KEY = "grokStudioImageEditorReturnProvider";
const IMAGE_EDITOR_RETURN_POST_KEY = "grokStudioImageEditorReturnPost";
const IMAGE_EDITOR_RETURN_ITEM_KEY = "grokStudioImageEditorReturnItem";
const IMAGE_EDITOR_RETURN_BACK_KEY = "grokStudioImageEditorReturnBack";
const IMAGE_EDITOR_RETURN_POST_SNAPSHOT_KEY = "grokStudioImageEditorReturnPostSnapshot";
const IMAGE_EDITOR_RETURN_CONTEXT_KEY = "grokStudioImageEditorReturnContext";
const IMAGE_EDITOR_INTERNAL_NAVIGATION_KEY = "grokChameleonInternalNavigation";

function imageEditorSavedReference(value) {
  const text = String(value || "");
  if (!text.includes("::")) return { postPath: text, itemId: "" };
  const [postPath, itemId] = text.split("::", 2);
  return { postPath, itemId };
}

function detailItemSourceLike(item) {
  const role = String(item?.role || item?.relation || item?.source_type || item?.kind || "").toLowerCase();
  return /(original|source|start|input|parent)/.test(role);
}

function detailImageEditorCandidate(prefix, post, selectedItem) {
  if (!post || !selectedItem) return null;
  const selectedType = detailItemType(selectedItem);
  if (selectedType === "image" && detailMediaUrlForItem(prefix, selectedItem, post)) return selectedItem;
  const sourceKeys = new Set([
    selectedItem.source_item_id,
    selectedItem.parent_item_id,
    selectedItem.original_item_id,
    selectedItem.root_item_id,
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const ordered = detailOrderedItems(post);
  const matchedSource = ordered.find((item) => (
    detailItemType(item) === "image"
    && detailMediaUrlForItem(prefix, item, post)
    && sourceKeys.has(mediaItemKey(item))
  ));
  if (matchedSource) return matchedSource;
  const explicitSource = ordered.find((item) => (
    detailItemType(item) === "image"
    && detailMediaUrlForItem(prefix, item, post)
    && detailItemSourceLike(item)
  ));
  return explicitSource || null;
}

function imageEditorReturnBackTarget(value, provider = "imagine") {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (parsed && typeof parsed === "object" && String(parsed.screenId || "")) return parsed;
  } catch (_) {
    // Ignore stale or invalid editor return state.
  }
  return {
    screenId: provider === "imagine" ? "i_main" : "b_main",
    activeButtonId: provider === "imagine" ? "i_imagine_nav_btn" : "b_build_btn",
  };
}

function imageEditorReturnContext(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function restoreImageEditorReturnContext(context) {
  if (!context || typeof context !== "object") return;
  if ("selectedCollectionPath" in context) {
    library_state.selectedCollectionPath = String(context.selectedCollectionPath || "");
  }
  if ("selectedCollectionPostPath" in context) {
    library_state.selectedCollectionPostPath = String(context.selectedCollectionPostPath || "");
  }
  if ("iMainView" in context) library_state.iMainView = String(context.iMainView || "");
  if ("bMainView" in context) library_state.bMainView = String(context.bMainView || "");
  if ("searchQuery" in context) library_state.searchQuery = String(context.searchQuery || "");
}

function replaceImageEditorReturnPost(list, postPath, post) {
  return [...(list || []).filter((candidate) => candidate?.folder_path !== postPath), post];
}

function restoreImageEditorReturnPost(snapshotText, postPath, provider, returnBackTarget) {
  if (!snapshotText || !postPath) return null;
  try {
    const snapshot = JSON.parse(snapshotText);
    const screenId = String(returnBackTarget?.screenId || "");
    let normalized = null;
    if (provider === "imagine" && screenId === "i_discover_main" && typeof normalizeImagineDiscoverPosts === "function") {
      normalized = normalizeImagineDiscoverPosts([snapshot])[0];
    } else if (provider === "imagine" && screenId === "i_main" && typeof normalizeImagineRemotePosts === "function") {
      normalized = normalizeImagineRemotePosts([snapshot])[0];
    } else {
      normalized = typeof normalizeServerPost === "function" ? normalizeServerPost(snapshot) : snapshot;
    }
    if (!normalized || normalized.folder_path !== postPath) return null;
    if (provider === "imagine" && screenId === "i_discover_main") {
      library_state.imagineDiscoverPosts = replaceImageEditorReturnPost(
        library_state.imagineDiscoverPosts,
        postPath,
        normalized,
      );
    } else if (provider === "imagine" && screenId === "i_main") {
      library_state.imagineRemotePosts = replaceImageEditorReturnPost(
        library_state.imagineRemotePosts,
        postPath,
        normalized,
      );
    } else {
      library_state.posts = replaceImageEditorReturnPost(library_state.posts, postPath, normalized);
      for (const collection of library_state.collections || []) {
        if ((collection.posts || []).some((post) => post?.folder_path === postPath)) {
          collection.posts = replaceImageEditorReturnPost(collection.posts, postPath, normalized);
        }
      }
    }
    if (
      provider === "imagine"
      && ["i_main", "i_discover_main"].includes(screenId)
      && typeof syncImagineRemotePostsIntoLibrary === "function"
    ) {
      syncImagineRemotePostsIntoLibrary();
    }
    return normalized;
  } catch (_) {
    return null;
  }
}

function openDetailImageEditor(provider = "build") {
  const normalizedProvider = provider === "imagine" ? "imagine" : "build";
  const prefix = normalizedProvider === "imagine" ? "i" : "b";
  const post = selectedLibraryPost();
  const selectedItem = selectedDetailItem(post);
  const target = detailImageEditorCandidate(prefix, post, selectedItem);
  const sourceUrl = detailMediaUrlForItem(prefix, target, post);
  if (!post?.folder_path || !sourceUrl) {
    showErrorPanel("Edit unavailable", "This detail item does not have an editable source image.");
    return;
  }
  const saveTarget = normalizedProvider === "imagine" ? "upload" : "detail";
  const url = new URL("/editor.html", window.location.origin);
  url.searchParams.set("item_id", `${post.folder_path}::${mediaItemKey(target)}`);
  url.searchParams.set("source", sourceUrl);
  url.searchParams.set("name", target.title || target.file || post.title || "Image");
  url.searchParams.set("provider", normalizedProvider);
  url.searchParams.set("save_target", saveTarget);
  const returnUrl = new URL(window.location.href);
  returnUrl.hash = `${prefix}_detail`;
  url.searchParams.set("return", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_PROVIDER_KEY, normalizedProvider);
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_POST_KEY, post.folder_path || "");
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_ITEM_KEY, mediaItemKey(selectedItem || target));
  const returnBackTarget = screen_state.detail_back?.[normalizedProvider] || null;
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_BACK_KEY, JSON.stringify(returnBackTarget || {}));
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_POST_SNAPSHOT_KEY, JSON.stringify(post));
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_CONTEXT_KEY, JSON.stringify({
    selectedCollectionPath: library_state.selectedCollectionPath || "",
    selectedCollectionPostPath: library_state.selectedCollectionPostPath || "",
    iMainView: library_state.iMainView || "",
    bMainView: library_state.bMainView || "",
    searchQuery: library_state.searchQuery || "",
  }));
  sessionStorage.setItem(IMAGE_EDITOR_INTERNAL_NAVIGATION_KEY, "editor");
  if (typeof browserHistoryCursor === "number") {
    sessionStorage.setItem(IMAGE_EDITOR_HISTORY_CURSOR_KEY, String(browserHistoryCursor));
    sessionStorage.setItem(IMAGE_EDITOR_HISTORY_TAIL_KEY, String(browserHistoryTail));
  }
  window.location.replace(url.toString());
}

function openBuildDetailImageEditor() {
  openDetailImageEditor("build");
}

function openImagineDetailImageEditor() {
  openDetailImageEditor("imagine");
}

async function consumeImageEditorReturn() {
  const savedId = sessionStorage.getItem(IMAGE_EDITOR_SAVED_KEY) || "";
  const saveTarget = sessionStorage.getItem(IMAGE_EDITOR_SAVE_TARGET_KEY) || "";
  const returnProvider = sessionStorage.getItem(IMAGE_EDITOR_RETURN_PROVIDER_KEY) || "";
  const returnPostPath = sessionStorage.getItem(IMAGE_EDITOR_RETURN_POST_KEY) || "";
  const returnItemId = sessionStorage.getItem(IMAGE_EDITOR_RETURN_ITEM_KEY) || "";
  const returnBackValue = sessionStorage.getItem(IMAGE_EDITOR_RETURN_BACK_KEY) || "";
  const returnPostSnapshot = sessionStorage.getItem(IMAGE_EDITOR_RETURN_POST_SNAPSHOT_KEY) || "";
  const returnContextValue = sessionStorage.getItem(IMAGE_EDITOR_RETURN_CONTEXT_KEY) || "";
  sessionStorage.removeItem(IMAGE_EDITOR_SAVED_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_SAVE_TARGET_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_PROVIDER_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_POST_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_ITEM_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_BACK_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_POST_SNAPSHOT_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_CONTEXT_KEY);
  const returnBackTarget = imageEditorReturnBackTarget(returnBackValue, returnProvider);
  restoreImageEditorReturnContext(imageEditorReturnContext(returnContextValue));
  if (!savedId) {
    if (restoreImageEditorReturnPost(returnPostSnapshot, returnPostPath, returnProvider, returnBackTarget)) {
      library_state.selectedPostPath = returnPostPath;
      if (returnItemId) library_state.selectedDetailItemId = returnItemId;
      const detailType = returnProvider === "imagine" ? "imagine" : "build";
      const activeButtonId = returnBackTarget.activeButtonId
        || (detailType === "imagine" ? "i_imagine_nav_btn" : "b_build_btn");
      screen_state.detail_back[detailType] = returnBackTarget;
      openScreen(detailType === "imagine" ? "i_detail" : "b_detail", activeButtonId, { replaceHistory: true });
      renderDetailViews();
    }
    return;
  }
  const { postPath, itemId } = imageEditorSavedReference(savedId);
  const data = await qApi("/api/state");
  applyLibrarySnapshot(data);
  restoreImageEditorReturnContext(imageEditorReturnContext(returnContextValue));
  const loadPath = postPath || returnPostPath;
  if (loadPath && library_state.libraryIndexEnabled && typeof loadIndexedPost === "function") {
    await loadIndexedPost(loadPath);
  }
  if (saveTarget === "upload") {
    const restoredReturnPost = restoreImageEditorReturnPost(
      returnPostSnapshot,
      returnPostPath,
      returnProvider,
      returnBackTarget,
    );
    if (returnPostPath) {
      library_state.selectedPostPath = returnPostPath;
      if (returnItemId) library_state.selectedDetailItemId = returnItemId;
    }
    const detailType = returnProvider === "imagine" ? "imagine" : "build";
    const screenId = detailType === "imagine" ? "i_detail" : "b_detail";
    const activeButtonId = detailType === "imagine" ? "i_imagine_nav_btn" : "b_build_btn";
    if (selectedLibraryPost()) {
      screen_state.detail_back[detailType] = restoredReturnPost
        ? returnBackTarget
        : { screenId: detailType === "imagine" ? "i_main" : "b_main", activeButtonId };
      openScreen(
        screenId,
        restoredReturnPost ? (returnBackTarget.activeButtonId || activeButtonId) : activeButtonId,
        { replaceHistory: true },
      );
      renderDetailViews();
    }
    if (typeof renderComposerAttachments === "function") renderComposerAttachments();
    return;
  }
  if (!postPath) return;
  const post = library_state.posts.find((item) => item.folder_path === postPath);
  if (!post) return;
  selectLibraryPost(postPath);
  if (itemId) library_state.selectedDetailItemId = itemId;
  // The screen the editor was opened from decides where the save lands. post.source says
  // where the media came from, not which screen the user was on, so a Build card holding
  // imagine media used to hand the save to the Imagine detail. Fall back to post.source
  // only when the provider is missing, which means this return did not come from the editor.
  const detailType = returnProvider
    ? (returnProvider === "imagine" ? "imagine" : "build")
    : (post.source === "imagine" ? "imagine" : "build");
  const activeButtonId = detailType === "imagine" ? "i_imagine_nav_btn" : "b_build_btn";
  screen_state.detail_back[detailType] = returnBackTarget;
  openScreen(
    detailType === "imagine" ? "i_detail" : "b_detail",
    returnBackTarget.activeButtonId || activeButtonId,
    { replaceHistory: true },
  );
  renderDetailViews();
  if (typeof renderComposerAttachments === "function") renderComposerAttachments();
}
