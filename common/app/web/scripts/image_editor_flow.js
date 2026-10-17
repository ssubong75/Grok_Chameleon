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

function sameImageEditorMediaUrl(left, right) {
  if (!left || !right) return false;
  try {
    return new URL(left, window.location.origin).href === new URL(right, window.location.origin).href;
  } catch (_) {
    return left === right;
  }
}

function detailImageEditorCandidate(prefix, post, selectedItem, sourceUrl) {
  const matches = item => detailItemType(item) === "image"
    && sameImageEditorMediaUrl(detailMediaUrlForItem(prefix, item, post), sourceUrl);
  if (selectedItem && matches(selectedItem)) return selectedItem;
  return (post?.items || []).find(matches) || null;
}

function detailImageEditorPost(prefix, sourceUrl) {
  const current = selectedLibraryPost();
  const lists = ["posts", "imagineRemotePosts", "imagineLikedPosts", "imagineDiscoverPosts", "imagineUnsavedPosts", "imagineSearchPosts", "imagineUploadPosts"];
  const candidates = [current, ...lists.flatMap(key => library_state[key] || [])].filter(post => (
    post?.folder_path === library_state.selectedPostPath
  ));
  return candidates.find(post => (post.items || []).some(item => (
    sameImageEditorMediaUrl(detailMediaUrlForItem(prefix, item, post), sourceUrl)
  ))) || current;
}

async function captureDetailImageEditorFrame(video, stillSelected, black = false) {
  video.pause();
  if (video.seeking || video.readyState < 2) {
    await new Promise((resolve, reject) => {
      let timer;
      const finish = error => {
        window.clearTimeout(timer);
        ["seeked", "loadeddata", "canplay"].forEach(name => video.removeEventListener(name, ready));
        video.removeEventListener("error", failed);
        error ? reject(error) : resolve();
      };
      const ready = () => { if (!video.seeking && video.readyState >= 2) finish(); };
      const failed = () => finish(new Error("영상 프레임을 읽지 못했습니다."));
      timer = window.setTimeout(failed, 10000);
      ["seeked", "loadeddata", "canplay"].forEach(name => video.addEventListener(name, ready));
      video.addEventListener("error", failed);
      ready();
    });
  }
  if (!stillSelected()) throw new Error("선택한 파일이 변경됐습니다. 다시 시도해 주세요.");
  if (!video.videoWidth || !video.videoHeight) throw new Error("영상 프레임의 해상도를 읽지 못했습니다.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("영상 프레임 캡처를 사용할 수 없습니다.");
  try {
    if (black) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => {
      blob ? resolve(blob) : reject(new Error("영상 프레임 캡처에 실패했습니다."));
    }, "image/png"));
  } catch (error) {
    if (error.name === "SecurityError") throw new Error("영상 접근 권한 때문에 현재 프레임을 캡처할 수 없습니다.");
    throw error;
  }
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
    let list = "";
    if (provider === "imagine" && screenId === "i_discover_main" && typeof normalizeImagineDiscoverPosts === "function") {
      normalized = normalizeImagineDiscoverPosts([snapshot])[0] || null;
      if (normalized) list = "discover";
    } else if (provider === "imagine" && screenId === "i_main" && typeof normalizeImagineRemotePosts === "function") {
      normalized = normalizeImagineRemotePosts([snapshot])[0] || null;
      if (normalized) list = "remote";
    }
    if (!normalized) {
      // Those two normalizers filter as well as normalize - isImagineRemoteMainPost drops a
      // locally held Imagine post, and the hidden-item filter drops a hidden one. Rejecting the
      // snapshot used to strand the editor return on an empty detail, so keep the plain shape
      // and put it in a list selectedLibraryPost() actually searches.
      normalized = typeof normalizeServerPost === "function" ? normalizeServerPost(snapshot) : snapshot;
      list = provider === "imagine" && screenId === "i_main" ? "remote" : "library";
    }
    if (!normalized || normalized.folder_path !== postPath) return null;
    if (list === "discover") {
      library_state.imagineDiscoverPosts = replaceImageEditorReturnPost(
        library_state.imagineDiscoverPosts,
        postPath,
        normalized,
      );
    } else if (list === "remote") {
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

function imageEditorBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

function clearImageEditorReturnKeys() {
  [
    IMAGE_EDITOR_SAVED_KEY,
    IMAGE_EDITOR_SAVE_TARGET_KEY,
    IMAGE_EDITOR_RETURN_PROVIDER_KEY,
    IMAGE_EDITOR_RETURN_POST_KEY,
    IMAGE_EDITOR_RETURN_ITEM_KEY,
    IMAGE_EDITOR_RETURN_BACK_KEY,
    IMAGE_EDITOR_RETURN_POST_SNAPSHOT_KEY,
    IMAGE_EDITOR_RETURN_CONTEXT_KEY,
  ].forEach((key) => sessionStorage.removeItem(key));
}

let detailImageEditorOpening = false;

async function openDetailImageEditor(provider = "build") {
  if (detailImageEditorOpening) return;
  detailImageEditorOpening = true;
  try {
  const normalizedProvider = provider === "imagine" ? "imagine" : "build";
  const prefix = normalizedProvider === "imagine" ? "i" : "b";
  const selectedId = library_state.selectedDetailItemId || "";
  const media = document.querySelector(`.${prefix}_detail_media`);
  const image = media?.querySelector("img.detail_image");
  const video = media?.querySelector("video.audio_edit_picture.is-shown") || media?.querySelector("video.custom-video");
  let sourceUrl = image ? (image.currentSrc || image.src) : (video?.currentSrc || video?.src || "");
  const post = detailImageEditorPost(prefix, sourceUrl);
  const selectedItem = (post?.items || []).find(item => mediaItemKey(item) === selectedId) || null;
  if (!post?.folder_path || (!image && !video)) throw new Error("현재 상세화면에서 편집할 파일을 찾지 못했습니다.");
  const stillSelected = () => library_state.selectedPostPath === post.folder_path
    && (library_state.selectedDetailItemId || "") === selectedId
    && document.querySelector(`.${prefix}_detail_media`) === media
    && screen_state.current_screen === `${prefix}_detail`;
  const target = image ? detailImageEditorCandidate(prefix, post, selectedItem, sourceUrl)
    : (detailItemType(selectedItem) === "video" ? selectedItem
      : (post.items || []).find(item => detailItemType(item) === "video"
        && sameImageEditorMediaUrl(detailMediaUrlForItem(prefix, item, post), sourceUrl)));
  if (!target || !sourceUrl) throw new Error("화면에 표시된 파일과 라이브러리 항목이 일치하지 않습니다. 다른 이미지로 대체하지 않고 편집을 중단했습니다.");
  let imageBase64 = "";
  let mime = "image/png";
  if (video && !image) {
    if (typeof detailAudioEditor !== "undefined" && detailAudioEditor?.player === media.querySelector(".video-player")) {
      stopDetailTimeline(detailAudioEditor);
    }
    const black = Boolean(media.querySelector(".audio_edit_black:not([hidden])"));
    const blob = await captureDetailImageEditorFrame(video, stillSelected, black);
    if (!stillSelected()) throw new Error("선택한 영상이 변경됐습니다. 다시 시도해 주세요.");
    imageBase64 = await imageEditorBlobToBase64(blob);
    mime = blob.type || "image/png";
    sourceUrl = detailMediaUrlForItem(prefix, target, post) || sourceUrl;
  } else {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error("편집할 이미지를 읽지 못했습니다.");
    const blob = await response.blob();
    if (!stillSelected()) throw new Error("선택한 파일이 변경됐습니다. 다시 시도해 주세요.");
    imageBase64 = await imageEditorBlobToBase64(blob);
    mime = blob.type || mime;
  }
  const saveTarget = normalizedProvider === "imagine" ? "upload" : "detail";
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_PROVIDER_KEY, normalizedProvider);
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_POST_KEY, post.folder_path || "");
  sessionStorage.setItem(IMAGE_EDITOR_RETURN_ITEM_KEY, mediaItemKey(target));
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
  if (!window.grokChameleonNative?.openPhotoEditor) throw new Error("Photo Editor를 찾지 못했습니다.");
  const opened = await window.grokChameleonNative.openPhotoEditor({
    image_base64: imageBase64,
    mime,
    item_id: `${post.folder_path}::${mediaItemKey(target)}`,
    source_url: sourceUrl,
    name: target.title || target.file || post.title || "Image",
    provider: normalizedProvider,
    save_target: saveTarget,
  });
  if (opened && opened.ok === false) throw new Error(opened.error || "Photo Editor를 열지 못했습니다.");
  } catch (error) {
    clearImageEditorReturnKeys();
    showErrorPanel("이미지 편집기를 열지 못했습니다", error?.message || "현재 파일을 전달하지 못했습니다.");
  } finally {
    detailImageEditorOpening = false;
  }
}

function openBuildDetailImageEditor() {
  return openDetailImageEditor("build");
}

function openImagineDetailImageEditor() {
  return openDetailImageEditor("imagine");
}

function selectImageEditorReturnPost(postPath, itemId) {
  library_state.selectedPostPath = postPath;
  // The identity left over from the library reload belongs to whatever was selected before the
  // editor, and selectedLibraryPost() returns null outright when it does not match. Clear it and
  // let the path lookup derive the identity again.
  library_state.selectedPostIdentity = "";
  if (itemId) library_state.selectedDetailItemId = itemId;
}

// The detail markup in index.html is placeholder content, so opening the detail screen on boot
// paints an empty card until consumeImageEditorReturn() catches up after the library reload.
// The snapshot the editor stashed is already available synchronously, so draw from it right
// away and let the consume pass reconcile afterwards.
function seedImageEditorReturnDetail() {
  const returnPostPath = sessionStorage.getItem(IMAGE_EDITOR_RETURN_POST_KEY) || "";
  if (!returnPostPath) return false;
  const returnProvider = sessionStorage.getItem(IMAGE_EDITOR_RETURN_PROVIDER_KEY) || "";
  const returnItemId = sessionStorage.getItem(IMAGE_EDITOR_RETURN_ITEM_KEY) || "";
  const returnBackTarget = imageEditorReturnBackTarget(
    sessionStorage.getItem(IMAGE_EDITOR_RETURN_BACK_KEY) || "",
    returnProvider,
  );
  const snapshotText = sessionStorage.getItem(IMAGE_EDITOR_RETURN_POST_SNAPSHOT_KEY) || "";
  if (!restoreImageEditorReturnPost(snapshotText, returnPostPath, returnProvider, returnBackTarget)) {
    return false;
  }
  selectImageEditorReturnPost(returnPostPath, returnItemId);
  renderDetailViews();
  return true;
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
    // Re-injecting the snapshot is best effort: the library reload may already carry the post.
    // Opening the detail must not hang on it, or a rejected snapshot leaves the placeholder
    // markup on screen as an empty card.
    restoreImageEditorReturnPost(returnPostSnapshot, returnPostPath, returnProvider, returnBackTarget);
    if (!returnPostPath) return;
    selectImageEditorReturnPost(returnPostPath, returnItemId);
    const detailType = returnProvider === "imagine" ? "imagine" : "build";
    const activeButtonId = returnBackTarget.activeButtonId
      || (detailType === "imagine" ? "i_imagine_nav_btn" : "b_build_btn");
    screen_state.detail_back[detailType] = returnBackTarget;
    openScreen(detailType === "imagine" ? "i_detail" : "b_detail", activeButtonId, { replaceHistory: true });
    renderDetailViews();
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

if (window.grokChameleonNative?.onPhotoEditorDone) {
  window.grokChameleonNative.onPhotoEditorDone((payload) => {
    const saved = payload?.saved;
    if (saved?.itemId) {
      sessionStorage.setItem(IMAGE_EDITOR_SAVED_KEY, saved.itemId);
      if (saved.saveTarget) sessionStorage.setItem(IMAGE_EDITOR_SAVE_TARGET_KEY, saved.saveTarget);
      else sessionStorage.removeItem(IMAGE_EDITOR_SAVE_TARGET_KEY);
      consumeImageEditorReturn().catch((error) => showErrorPanel("저장한 이미지를 열지 못했습니다", error?.message || "저장 결과를 반영하지 못했습니다."));
      return;
    }
    clearImageEditorReturnKeys();
  });
}
