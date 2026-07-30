// Image editor open/return flow

const IMAGE_EDITOR_SAVED_KEY = "grokStudioImageEditorSavedItemId";
const IMAGE_EDITOR_SAVE_TARGET_KEY = "grokStudioImageEditorSaveTarget";
const IMAGE_EDITOR_RETURN_PROVIDER_KEY = "grokStudioImageEditorReturnProvider";
const IMAGE_EDITOR_RETURN_POST_KEY = "grokStudioImageEditorReturnPost";
const IMAGE_EDITOR_RETURN_ITEM_KEY = "grokStudioImageEditorReturnItem";
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
  sessionStorage.setItem(IMAGE_EDITOR_INTERNAL_NAVIGATION_KEY, "editor");
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
  sessionStorage.removeItem(IMAGE_EDITOR_SAVED_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_SAVE_TARGET_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_PROVIDER_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_POST_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_RETURN_ITEM_KEY);
  if (!savedId) return;
  const { postPath, itemId } = imageEditorSavedReference(savedId);
  const data = await qApi("/api/state");
  applyLibrarySnapshot(data);
  const loadPath = postPath || returnPostPath;
  if (loadPath && library_state.libraryIndexEnabled && typeof loadIndexedPost === "function") {
    await loadIndexedPost(loadPath);
  }
  if (saveTarget === "upload") {
    if (returnPostPath) {
      library_state.selectedPostPath = returnPostPath;
      if (returnItemId) library_state.selectedDetailItemId = returnItemId;
    }
    const detailType = returnProvider === "imagine" ? "imagine" : "build";
    const screenId = detailType === "imagine" ? "i_detail" : "b_detail";
    const activeButtonId = detailType === "imagine" ? "i_imagine_nav_btn" : "b_build_btn";
    if (selectedLibraryPost()) {
      screen_state.detail_back[detailType] = {
        screenId: detailType === "imagine" ? "i_main" : "b_main",
        activeButtonId,
      };
      openScreen(screenId, activeButtonId, { replaceHistory: true });
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
  const detailType = post.source === "imagine" ? "imagine" : "build";
  const activeButtonId = detailType === "imagine" ? "i_imagine_nav_btn" : "b_build_btn";
  screen_state.detail_back[detailType] = {
    screenId: detailType === "imagine" ? "i_main" : "b_main",
    activeButtonId,
  };
  openScreen(detailType === "imagine" ? "i_detail" : "b_detail", activeButtonId, { replaceHistory: true });
  renderDetailViews();
  if (typeof renderComposerAttachments === "function") renderComposerAttachments();
}
