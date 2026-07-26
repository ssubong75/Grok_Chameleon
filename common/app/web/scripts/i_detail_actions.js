// Imagine detail actions that must not use local Build deletion
function imagineActionPostIdForItem(item) {
  const metadata = iDetailItemMetadata(item);
  const imagine = iDetailImagineMetadata(item);
  return String(
    item?.post_id
    || metadata.post_id
    || imagine.post_id
    || item?.item_id
    || item?.id
    || ""
  ).trim();
}

function imagineActionPostIdForPost(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  return String(
    post?.post_id
    || metadata.imagine_root_post_id
    || metadata.raw_root_post_id
    || representative?.root_post_id
    || imagineActionPostIdForItem(representative)
    || ""
  ).trim();
}

function imagineLikeTargetForItem(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const mediaUrl = String(
    item?.remote_url
    || item?.url
    || metadata.media_url
    || metadata.remote_url
    || imagine.media_url
    || "",
  ).trim();
  return {
    type: item?.type || imagine.media_type || "image",
    media_url: mediaUrl,
    remote_url: mediaUrl,
    metadata,
  };
}

function applyImagineLikeResultPostId(post, item, data) {
  const likedPostId = String(data?.id || data?.ids?.[0] || "").trim();
  if (!post || !likedPostId) return;
  post.post_id = likedPostId;
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.imagine_root_post_id = likedPostId;
  post.metadata.imagine = post.metadata.imagine && typeof post.metadata.imagine === "object" ? post.metadata.imagine : {};
  post.metadata.imagine.post_id = likedPostId;
  post.metadata.imagine.root_post_id = likedPostId;
  if (!item) return;
  item.post_id = likedPostId;
  item.root_post_id = likedPostId;
  item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
  item.metadata.imagine.post_id = likedPostId;
  item.metadata.imagine.root_post_id = likedPostId;
}

function imaginePostActionMetadata(source) {
  const metadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return { metadata, imagine };
}

function isImagineDiscoverPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.mode === "discover"
    || post?.folder_path?.startsWith?.("imagine_discover/")
    || postMeta.metadata.remote_view === "discover"
    || postMeta.imagine.remote_view === "discover"
    || itemMeta.metadata.remote_view === "discover"
    || itemMeta.imagine.remote_view === "discover"
  );
}

function isImagineUnsavedPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.mode === "unsaved"
    || post?.folder_path?.startsWith?.("imagine_unsaved/")
    || postMeta.metadata.remote_view === "unsaved"
    || postMeta.imagine.remote_view === "unsaved"
    || itemMeta.metadata.remote_view === "unsaved"
    || itemMeta.imagine.remote_view === "unsaved"
  );
}

function isImagineSearchPost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.mode === "search"
    || post?.folder_path?.startsWith?.("imagine_search/")
    || postMeta.metadata.remote_view === "search"
    || postMeta.imagine.remote_view === "search"
    || itemMeta.metadata.remote_view === "search"
    || itemMeta.imagine.remote_view === "search"
  );
}

function imaginePostLiked(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    post?.liked === true
    || post?.favorite === true
    || postMeta.metadata.liked === true
    || postMeta.imagine.liked === true
    || item?.liked === true
    || item?.favorite === true
    || itemMeta.metadata.liked === true
    || itemMeta.imagine.liked === true
  );
}

function markImaginePostLiked(post, liked) {
  if (!post) return;
  post.liked = liked;
  post.favorite = liked;
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.liked = liked;
  post.metadata.imagine = post.metadata.imagine && typeof post.metadata.imagine === "object" ? post.metadata.imagine : {};
  post.metadata.imagine.liked = liked;
  for (const item of post.items || []) {
    item.liked = liked;
    item.favorite = liked;
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.liked = liked;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
    item.metadata.imagine.liked = liked;
  }
}

function savedImaginePostFromLocalPost(post) {
  if (!post) return null;
  const postId = imagineActionPostIdForPost(post);
  if (!postId) return null;
  const representative = representativeItem(post.items || [], post) || post.representative_item || post.items?.[0] || {};
  const metadata = post.metadata && typeof post.metadata === "object" ? { ...post.metadata } : {};
  metadata.liked = true;
  metadata.remote_view = "saved";
  metadata.imagine = metadata.imagine && typeof metadata.imagine === "object" ? { ...metadata.imagine } : {};
  metadata.imagine.liked = true;
  metadata.imagine.remote_view = "saved";
  return normalizeServerPost({
    ...post,
    post_id: postId,
    source: "imagine",
    mode: "saved",
    area: "imagine_remote",
    remote: true,
    liked: true,
    favorite: true,
    folder_path: `imagine_saved/${postId}`,
    folderName: post.title || post.folderName || postId,
    representative: representative?.url || representative?.remote_url || representative?.item_id || post.representative || "",
    representative_item: representative,
    items: (post.items || []).map((item) => {
      const itemMetadata = item?.metadata && typeof item.metadata === "object" ? { ...item.metadata } : {};
      itemMetadata.liked = true;
      itemMetadata.remote_view = "saved";
      itemMetadata.imagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? { ...itemMetadata.imagine } : {};
      itemMetadata.imagine.liked = true;
      itemMetadata.imagine.remote_view = "saved";
      return {
        ...item,
        liked: true,
        favorite: true,
        metadata: itemMetadata,
      };
    }),
    metadata,
  });
}

function addImaginePostToSavedView(post) {
  const savedPost = savedImaginePostFromLocalPost(post);
  if (!savedPost) return;
  if (typeof upsertImagineRemotePost === "function") {
    upsertImagineRemotePost(savedPost);
  } else {
    const list = Array.isArray(library_state.imagineRemotePosts) ? library_state.imagineRemotePosts : [];
    const index = list.findIndex((candidate) => candidate?.folder_path === savedPost.folder_path);
    if (index >= 0) list.splice(index, 1, savedPost);
    else list.unshift(savedPost);
    library_state.imagineRemotePosts = list;
    syncImagineRemotePostsIntoLibrary();
  }
  library_state.imagineRemoteLoaded = true;
}

function refreshImagineRemoteViews() {
  syncImagineRemotePostsIntoLibrary();
  renderImagineSourceCards();
  if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
  if (typeof renderImagineUnsavedCards === "function") renderImagineUnsavedCards();
  renderDetailViews();
}

function moveImagineT2iPostOutOfSessionView(post) {
  if (!(typeof isImagineT2iPost === "function" && isImagineT2iPost(post))) return false;
  const folderPath = String(post?.folder_path || "");
  if (folderPath) library_state.sessionImagineT2iPaths?.delete(folderPath);
  return true;
}

function returnToImagineT2iMain() {
  library_state.selectedPostPath = "";
  library_state.selectedDetailItemId = "";
  library_state.selectedImagineJobId = "";
  library_state.iMainView = typeof imagineViewValue === "function" ? imagineViewValue("T2I", "t2i") : "t2i";
  if (typeof setImagineTab === "function") setImagineTab("i_t2i_btn");
  openScreen("i_main", "i_imagine_nav_btn");
}

function returnToImagineUnsavedMain() {
  library_state.selectedPostPath = "";
  library_state.selectedDetailItemId = "";
  library_state.selectedImagineJobId = "";
  library_state.iMainView = typeof imagineViewValue === "function" ? imagineViewValue("UNSAVED", "unsaved") : "unsaved";
  if (typeof setImagineTab === "function") setImagineTab("i_unsaved_nav_btn");
  openScreen("i_unsaved_main", "i_unsaved_nav_btn");
}

function imagineListElementForScreen(screenId = screen_state.current_screen) {
  if (screenId === "i_unsaved_main") return document.querySelector(".i_unsaved_card_list");
  if (screenId === "i_discover_main") return document.querySelector(".i_discover_card_list");
  if (screenId === "i_main") return document.querySelector(".i_card_list");
  if (screenId === "search_main") return document.querySelector(".search_card_list");
  return null;
}

function imagineListScrollTopForScreen(screenId = screen_state.current_screen) {
  const list = imagineListElementForScreen(screenId);
  if (!list) return null;
  if (typeof virtualCardListUsesDocumentScroll === "function" && virtualCardListUsesDocumentScroll()) {
    return Math.max(0, Number(window.scrollY || document.documentElement?.scrollTop || 0));
  }
  return Math.max(0, Number(list.scrollTop || 0));
}

function restoreImagineListScrollForScreen(screenId, scrollTop) {
  if (scrollTop === null || scrollTop === undefined) return;
  const list = imagineListElementForScreen(screenId);
  if (!list) return;
  const top = Math.max(0, Number(scrollTop) || 0);
  const applyScroll = () => {
    if (typeof virtualCardListUsesDocumentScroll === "function" && virtualCardListUsesDocumentScroll()) {
      window.scrollTo(0, top);
    } else {
      list.scrollTop = top;
    }
  };
  applyScroll();
  requestAnimationFrame(applyScroll);
}

function renderImagineListForScreen(screenId = screen_state.current_screen, scrollTop = null) {
  if (screenId === "i_unsaved_main" && typeof renderImagineUnsavedCards === "function") {
    renderImagineUnsavedCards();
  } else if (screenId === "i_discover_main" && typeof renderImagineDiscoverCards === "function") {
    renderImagineDiscoverCards();
  } else if (screenId === "search_main" && typeof renderSearchResults === "function") {
    renderSearchResults();
  } else {
    renderImagineSourceCards();
  }
  restoreImagineListScrollForScreen(screenId, scrollTop);
}

function removeImagineItemsFromPost(post, removedItems, options = {}) {
  const itemsToRemove = (Array.isArray(removedItems) ? removedItems : [removedItems]).filter(Boolean);
  if (!post?.folder_path || !itemsToRemove.length) return false;
  const screenId = options.screenId || screen_state.current_screen;
  const keepListScreen = Boolean(options.keepListScreen);
  const scrollTop = options.scrollTop;
  for (const item of itemsToRemove) rememberHiddenImagineItem(item);
  const removedKeys = new Set(itemsToRemove.flatMap((item) => imaginePostIdKeysForItem(item)));
  const stripPost = (candidate) => {
    if (!candidate || candidate.folder_path !== post.folder_path) return candidate;
    const items = (candidate.items || []).filter((item) => {
      const keys = imaginePostIdKeysForItem(item);
      return !keys.some((key) => removedKeys.has(key));
    });
    if (!items.length) return null;
    const representative = representativeItem(items, { ...candidate, items }) || items[0];
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  for (const listName of ["imagineRemotePosts", "imagineDiscoverPosts", "imagineUnsavedPosts", "imagineSearchPosts", "imagineUploadPosts", "posts"]) {
    if (!Array.isArray(library_state[listName])) continue;
    library_state[listName] = library_state[listName].map(stripPost).filter(Boolean);
  }
  syncImagineRemotePostsIntoLibrary();
  const current = selectedLibraryPost();
  if (!current) {
    library_state.selectedPostPath = "";
    library_state.selectedDetailItemId = "";
    if (keepListScreen) {
      renderImagineListForScreen(screenId, scrollTop);
      renderDetailViews();
      return true;
    }
    const backTarget = typeof detailBackTarget === "function" ? detailBackTarget("imagine") : null;
    const returnScreenId = backTarget?.screenId || "i_main";
    const returnButtonId = backTarget?.activeButtonId || screen_state.current_i_nav_btn;
    const returnScrollTop = backTarget?.scrollTop ?? scrollTop;
    openScreen(returnScreenId, returnButtonId);
    renderImagineListForScreen(returnScreenId, returnScrollTop);
    return true;
  }
  const nextSelected = current.items.find((item) => mediaItemKey(item) === library_state.selectedDetailItemId)
    || detailDefaultSelectedItem(current)
    || current.items[0];
  library_state.selectedDetailItemId = mediaItemKey(nextSelected);
  renderImagineListForScreen(screenId, scrollTop);
  renderDetailViews();
  return true;
}

function removeImagineItemFromPost(post, removedItem) {
  return removeImagineItemsFromPost(post, removedItem);
}

function imagineDeletePayloadForItem(post, item) {
  const postId = imagineActionPostIdForItem(item);
  if (!postId) {
    return null;
  }
  return {
    id: postId,
    post_id: postId,
    item_id: item?.item_id || "",
    type: item?.type || "",
    media_url: item?.remote_url || item?.url || item?.metadata?.media_url || item?.metadata?.remote_url || item?.metadata?.imagine?.media_url || "",
    remote_url: item?.remote_url || item?.url || "",
    metadata: item?.metadata || {},
    account_id: iDetailAccountId(item, post),
  };
}

async function deleteImagineRemoteItem(post, item) {
  const deletePayload = imagineDeletePayloadForItem(post, item);
  if (!deletePayload) {
    throw new Error("This Imagine item has no post id.");
  }
  try {
    await qApi("/api/imagine/post/delete", deletePayload);
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("Media post not found") && !message.includes("HTTP 404")) throw error;
  }
  const hiddenKeys = imaginePostIdKeysForItem(item);
  if (hiddenKeys.length) {
    await qApi("/api/imagine/item/hide", { keys: hiddenKeys });
  }
  return true;
}

async function deleteImagineSelectedDetailItem() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item) {
    showErrorPanel("Delete unavailable", "Select an Imagine thumbnail to delete.");
    return;
  }
  if (!imagineDeletePayloadForItem(post, item)) {
    showErrorPanel("Delete unavailable", "This Imagine item has no post id.");
    return;
  }
  const ok = await confirmAction({
    title: "Delete Item",
    message: "Delete this Imagine Item?",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  await deleteImagineRemoteItem(post, item);
  removeImagineItemFromPost(post, item);
  toast("Deleted Imagine item.");
}

async function deleteImagineCardPost(post, button = null) {
  const items = (post?.items || []).filter((item) => imagineDeletePayloadForItem(post, item));
  if (!post || !items.length) {
    showErrorPanel("Delete unavailable", "This Imagine card has no post id.");
    return;
  }
  const screenId = screen_state.current_screen;
  const scrollTop = imagineListScrollTopForScreen(screenId);
  const ok = await confirmAction({
    title: "Delete Post",
    message: items.length > 1 ? `Delete this Imagine post and ${items.length} media item(s)?` : "Delete this Imagine post?",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  button?.setAttribute("aria-busy", "true");
  try {
    for (const item of items) {
      await deleteImagineRemoteItem(post, item);
    }
    removeImagineItemsFromPost(post, items, {
      keepListScreen: true,
      screenId,
      scrollTop,
    });
    toast("Deleted Imagine post.");
  } catch (error) {
    showErrorPanel("Delete failed", error?.message || "Delete failed.");
  } finally {
    button?.removeAttribute("aria-busy");
  }
}

async function likeImagineCardPost(post) {
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  if (!post || !representative || !postId) {
    showErrorPanel("Save unavailable", "This Imagine card has no post id.");
    return;
  }
  const returnScreenId = screen_state.current_screen === "i_unsaved_main" ? "i_unsaved_main" : "";
  const returnScrollTop = returnScreenId ? imagineListScrollTopForScreen(returnScreenId) : null;
  const t2iPost = typeof isImagineT2iPost === "function" && isImagineT2iPost(post);
  const payload = {
    id: postId,
    account_id: iDetailAccountId(representative, post),
  };
  if (t2iPost) {
    Object.assign(payload, imagineLikeTargetForItem(representative));
  } else {
    payload.items = (post.items || []).map((item) => ({
      id: imagineActionPostIdForItem(item),
      post_id: imagineActionPostIdForItem(item),
      item_id: item?.item_id || "",
      type: item?.type || "",
      media_url: item?.remote_url || item?.url || item?.metadata?.media_url || item?.metadata?.remote_url || item?.metadata?.imagine?.media_url || "",
      remote_url: item?.remote_url || item?.url || "",
      metadata: item?.metadata || {},
    }));
  }
  const data = await qApi("/api/imagine/post/like", payload);
  if (t2iPost) applyImagineLikeResultPostId(post, representative, data);
  markImaginePostLiked(post, true);
  addImaginePostToSavedView(post);
  const movedFromT2i = moveImagineT2iPostOutOfSessionView(post);
  if (isImagineUnsavedPost(post)) {
    library_state.imagineUnsavedPosts = (library_state.imagineUnsavedPosts || [])
      .filter((candidate) => candidate?.folder_path !== post.folder_path);
    library_state.imagineRemoteLoaded = false;
  }
  if (movedFromT2i) {
    renderImagineSourceCards();
    renderDetailViews();
  } else {
    refreshImagineRemoteViews();
  }
  if (returnScreenId) restoreImagineListScrollForScreen(returnScreenId, returnScrollTop);
  toast("Saved Imagine post.");
}

async function unsaveImagineDiscoverPost(post) {
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  if (!post || !representative || !postId) {
    showErrorPanel("Unsave unavailable", "This Imagine post has no post id.");
    return;
  }
  const ok = await confirmAction({
    title: "Unsave post",
    message: "This will remove the post from Saved.",
    confirmLabel: "Unsave",
  });
  if (!ok) return;
  await qApi("/api/imagine/post/unsave", {
    id: postId,
    account_id: iDetailAccountId(representative, post),
  });
  markImaginePostLiked(post, false);
  refreshImagineRemoteViews();
  toast("Unsaved Imagine post.");
}

async function unsaveImagineCardPost(post) {
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  if (!post || !representative) {
    showErrorPanel("Unsave unavailable", "Select an Imagine card to unsave.");
    return;
  }
  const postId = imagineActionPostIdForPost(post);
  if (!postId) {
    showErrorPanel("Unsave unavailable", "This Imagine card has no post id.");
    return;
  }
  const ok = await confirmAction({
    title: "Unsave post",
    message: "This will remove the post from Saved.",
    confirmLabel: "Unsave",
  });
  if (!ok) return;
  await qApi("/api/imagine/post/unsave", {
    id: postId,
    account_id: iDetailAccountId(representative, post),
  });
  rememberHiddenImaginePost(post);
  library_state.imagineRemotePosts = (library_state.imagineRemotePosts || [])
    .filter((candidate) => candidate?.folder_path !== post.folder_path);
  syncImagineRemotePostsIntoLibrary();
  if (library_state.selectedPostPath === post.folder_path) {
    library_state.selectedPostPath = "";
    library_state.selectedDetailItemId = "";
  }
  renderImagineSourceCards();
  renderDetailViews();
  toast("Unsaved Imagine post.");
}

async function unsaveImagineSelectedDetailPost() {
  const post = selectedLibraryPost();
  if (!post) {
    showErrorPanel("Unsave unavailable", "Select an Imagine post to unsave.");
    return;
  }
  const postId = imagineActionPostIdForPost(post);
  if (!postId) {
    showErrorPanel("Unsave unavailable", "This Imagine post has no post id.");
    return;
  }
  const ok = await confirmAction({
    title: "Unsave post",
    message: "This will remove the post from Saved.",
    confirmLabel: "Unsave",
  });
  if (!ok) return;
  await qApi("/api/imagine/post/unsave", {
    id: postId,
    account_id: post.account_id || iDetailAccountId(post.representative_item || post.items?.[0], post),
  });
  rememberHiddenImaginePost(post);
  library_state.imagineRemotePosts = (library_state.imagineRemotePosts || [])
    .filter((candidate) => candidate?.folder_path !== post.folder_path);
  syncImagineRemotePostsIntoLibrary();
  library_state.selectedPostPath = "";
  library_state.selectedDetailItemId = "";
  renderImagineSourceCards();
  renderDetailViews();
  openScreen("i_main", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
  toast("Unsaved Imagine post.");
}

async function likeImagineSelectedDetailPost() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  if (!post || !item || !postId) {
    showErrorPanel("Save unavailable", "This Imagine post has no post id.");
    return;
  }
  const t2iPost = typeof isImagineT2iPost === "function" && isImagineT2iPost(post);
  const payload = {
    id: postId,
    account_id: post.account_id || iDetailAccountId(item, post),
  };
  if (t2iPost) {
    Object.assign(payload, imagineLikeTargetForItem(item));
  } else {
    payload.items = (post.items || []).map((candidate) => ({
      id: imagineActionPostIdForItem(candidate),
      post_id: imagineActionPostIdForItem(candidate),
      item_id: candidate?.item_id || "",
      type: candidate?.type || "",
      media_url: candidate?.remote_url || candidate?.url || candidate?.metadata?.media_url || candidate?.metadata?.remote_url || candidate?.metadata?.imagine?.media_url || "",
      remote_url: candidate?.remote_url || candidate?.url || "",
      metadata: candidate?.metadata || {},
    }));
  }
  const data = await qApi("/api/imagine/post/like", payload);
  if (t2iPost) applyImagineLikeResultPostId(post, item, data);
  markImaginePostLiked(post, true);
  addImaginePostToSavedView(post);
  const movedFromT2i = moveImagineT2iPostOutOfSessionView(post);
  const movedFromUnsaved = isImagineUnsavedPost(post, item);
  if (movedFromUnsaved) {
    library_state.imagineUnsavedPosts = (library_state.imagineUnsavedPosts || [])
      .filter((candidate) => candidate?.folder_path !== post.folder_path);
    library_state.imagineUnsavedLoaded = true;
    library_state.imagineRemoteLoaded = false;
  }
  if (movedFromT2i) {
    returnToImagineT2iMain();
    renderImagineSourceCards();
    renderDetailViews();
  } else {
    if (movedFromUnsaved) returnToImagineUnsavedMain();
    refreshImagineRemoteViews();
  }
  toast("Saved Imagine post.");
}

function imagineUpscaleMediaUrlFromResult(data) {
  return String(
    data?.hd1080_media_url
    || data?.hd_media_url
    || data?.media_url
    || data?.post?.hd1080MediaUrl
    || data?.post?.hdMediaUrl
    || data?.result?.hd1080MediaUrl
    || data?.result?.hdMediaUrl
    || ""
  ).trim();
}

function imagineDetailAccountTier(item, post) {
  const store = account_state?.imagine;
  const accountId = iDetailAccountId(item, post);
  const activeId = String(store?.active_id || "");
  const account = (accountId
    ? store?.accounts?.find((candidate) => String(candidate?.id || "") === accountId)
    : null)
    || (activeId
      ? store?.accounts?.find((candidate) => String(candidate?.id || "") === activeId)
      : null);
  return normalizeAccountTier(account?.tier);
}

function imagineUpscaleTargetResolution(item, post) {
  const current = normalizeMediaResolutionLabel(mediaResolutionLabelForItem(item, post));
  if (current === "480") return "720p";
  if (current === "720" && imagineDetailAccountTier(item, post) === "heavy") return "1080p";
  return "";
}

function applyImagineUpscaleResultToItem(item, data) {
  if (!item || !data) return false;
  const mediaUrl = imagineUpscaleMediaUrlFromResult(data);
  if (!mediaUrl) return false;
  const resolution = String(data.resolution || "").toLowerCase() === "1080p" ? "1080" : "720";
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  if (resolution === "1080") {
    item.hd1080_media_url = mediaUrl;
    item.hd1080MediaUrl = mediaUrl;
    metadata.hd1080_media_url = mediaUrl;
    metadata.hd1080MediaUrl = mediaUrl;
    imagine.hd1080_media_url = mediaUrl;
    imagine.hd1080MediaUrl = mediaUrl;
  } else {
    item.hd_media_url = mediaUrl;
    item.hdMediaUrl = mediaUrl;
    metadata.hd_media_url = mediaUrl;
    metadata.hdMediaUrl = mediaUrl;
    imagine.hd_media_url = mediaUrl;
    imagine.hdMediaUrl = mediaUrl;
  }
  item.resolution_name = `${resolution}p`;
  item.resolution = `${resolution}p`;
  metadata.resolution_name = `${resolution}p`;
  metadata.resolution = `${resolution}p`;
  imagine.resolution_name = `${resolution}p`;
  imagine.resolution = `${resolution}p`;
  metadata.imagine = imagine;
  item.metadata = metadata;
  return true;
}

function updateImagineUpscaleItemInPost(post, itemKey, postId, data) {
  if (!post?.items?.length) return false;
  let changed = false;
  for (const candidate of post.items) {
    const candidateId = imagineActionPostIdForItem(candidate);
    if (mediaItemKey(candidate) === itemKey || (postId && candidateId === postId)) {
      changed = applyImagineUpscaleResultToItem(candidate, data) || changed;
    }
  }
  const representative = representativeItem(post.items, post) || post.items[0];
  post.representative_item = representative;
  post.representative = representative?.file || representative?.url || representative?.item_id || post.representative || "";
  return changed;
}

function applyImagineUpscaleResult(post, item, data) {
  const itemKey = mediaItemKey(item);
  const postId = imagineActionPostIdForItem(item);
  let changed = updateImagineUpscaleItemInPost(post, itemKey, postId, data);
  for (const listName of ["imagineRemotePosts", "imagineDiscoverPosts", "imagineUnsavedPosts"]) {
    const list = Array.isArray(library_state[listName]) ? library_state[listName] : [];
    for (const candidatePost of list) {
      if (candidatePost?.folder_path === post?.folder_path) {
        changed = updateImagineUpscaleItemInPost(candidatePost, itemKey, postId, data) || changed;
      }
    }
  }
  if (changed) syncImagineRemotePostsIntoLibrary();
  return changed;
}

async function upscaleImagineSelectedDetailVideo(button = null) {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "video") {
    showErrorPanel("Upscale unavailable", "Select an Imagine video thumbnail.");
    return;
  }
  const postId = imagineActionPostIdForItem(item);
  if (!postId) {
    showErrorPanel("Upscale unavailable", "This Imagine video has no post id.");
    return;
  }
  const targetResolution = imagineUpscaleTargetResolution(item, post);
  if (!targetResolution) {
    showErrorPanel("Upscale unavailable", "This video cannot be upscaled for the selected Imagine account.");
    return;
  }
  const payload = {
    provider: "imagine",
    mode: "upscale",
    prompt: "",
    preview_url: detailPreviewUrlForItem("i", item, post) || detailVideoPreviewUrlForItem("i", item, post) || "",
    preview_type: "video",
    source_post_path: post.folder_path || "",
    source_item_id: mediaItemKey(item),
    options: {
      resolution: targetResolution,
    },
    account_id: iDetailAccountId(item, post),
    id: postId,
    post_id: postId,
    item_id: item.item_id || mediaItemKey(item),
    type: "video",
    resolution: targetResolution,
    metadata: item.metadata || {},
  };
  if (button) button.disabled = true;
  try {
    const data = await qApi("/api/imagine/start", payload);
    if (!data?.job) throw new Error("Upscale job was not created.");
    upsertImagineJob(data.job);
    selectImagineJob(data.job.id, {
      keepDetailPost: true,
      focusJobThumb: true,
    });
    scheduleImagineJobPoll(data.job.id);
  } finally {
    if (button) button.disabled = false;
  }
}

function imagineDetailAspectValue(value) {
  const text = String(value || "").trim();
  const normalized = typeof detailAspectFromValue === "function" ? detailAspectFromValue(text) : "";
  const match = String(normalized || text).match(/(\d+(?:\.\d+)?)\s*(?:\/|:|x|\u00d7)\s*(\d+(?:\.\d+)?)/i);
  return match ? `${match[1]}:${match[2]}` : "";
}

function rawImagineDetailMediaUrl(item) {
  if (typeof composerRawMediaUrlForItem === "function") return composerRawMediaUrlForItem(item);
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const candidates = [
    item?.remote_url,
    item?.url,
    item?.media_url,
    item?.mediaUrl,
    item?.object_url,
    item?.source_url,
    metadata.remote_url,
    metadata.media_url,
    imagine.media_url,
    imagine.asset_url,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    try {
      const parsed = new URL(text, window.location.origin);
      if (parsed.pathname === "/api/imagine/remote/media") return parsed.searchParams.get("url") || text;
      return text;
    } catch {
      return text;
    }
  }
  return "";
}

function imagineDetailAspectAttachment(post, item) {
  const metadata = typeof composerAttachmentMetadataForItem === "function"
    ? composerAttachmentMetadataForItem(post, item)
    : {};
  const rawUrl = rawImagineDetailMediaUrl(item);
  const mimeType = String(item?.mime_type || item?.mime || "").toLowerCase();
  return {
    name: item?.file || item?.title || `${item?.item_id || "imagine-aspect-source"}.jpg`,
    type: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
    role: "source",
    raw_url: rawUrl,
    remote_url: rawUrl,
    url: rawUrl,
    aspect_ratio: typeof detailAspectFromItem === "function" ? detailAspectFromItem(item).replace(/\s*\/\s*/g, ":") : "",
    detail_auto: true,
    detail_key: typeof mediaItemKey === "function" ? mediaItemKey(item) : "",
    ...metadata,
  };
}

async function startImagineDetailAspectRatio(label, button = null) {
  const aspectRatio = imagineDetailAspectValue(label);
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!aspectRatio) {
    showErrorPanel("Aspect Ratio unavailable", "Choose an aspect ratio.");
    return;
  }
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Aspect Ratio unavailable", "Select an Imagine image thumbnail.");
    return;
  }
  const sourcePostId = imagineActionPostIdForItem(item);
  const rawUrl = rawImagineDetailMediaUrl(item);
  if (!sourcePostId || !rawUrl) {
    showErrorPanel("Aspect Ratio unavailable", "This Imagine image has no source post.");
    return;
  }
  const payload = {
    provider: "imagine",
    mode: "aspect",
    prompt: detailPromptFor(post, item) || post.prompt || "",
    preview_url: detailPreviewUrlForItem("i", item, post) || detailMediaUrlForItem("i", item, post) || "",
    preview_type: "image",
    source_post_path: post.folder_path || "",
    source_item_id: mediaItemKey(item),
    options: {
      aspect_ratio: aspectRatio,
      target_aspect_ratio: aspectRatio,
    },
    attachments: [imagineDetailAspectAttachment(post, item)],
    account_id: iDetailAccountId(item, post),
    id: sourcePostId,
    post_id: sourcePostId,
    item_id: item.item_id || mediaItemKey(item),
    type: "image",
    aspect_ratio: aspectRatio,
    target_aspect_ratio: aspectRatio,
    metadata: item.metadata || {},
  };
  if (button) button.disabled = true;
  try {
    if (typeof prepareActiveImagineBridgeSession === "function") {
      await prepareActiveImagineBridgeSession({ force: false, silent: true, accountId: payload.account_id });
    }
    const data = await qApi("/api/imagine/start", payload);
    if (!data?.job) throw new Error("Aspect Ratio job was not created.");
    upsertImagineJob(data.job);
    selectImagineJob(data.job.id, {
      keepDetailPost: true,
      focusJobThumb: true,
    });
    scheduleImagineJobPoll(data.job.id);
  } finally {
    if (button) button.disabled = false;
  }
}

let imagineCropOverlayState = null;

function ensureImagineCropOverlay() {
  let overlay = document.querySelector(".i_crop_overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "i_crop_overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="i_crop_panel" role="dialog" aria-modal="true" aria-label="Crop image">
      <div class="i_crop_image_frame">
        <img class="i_crop_image" alt="Crop image" draggable="false" />
        <div class="i_crop_box" data-crop-drag="move">
          <span class="i_crop_grid i_crop_grid_v i_crop_grid_v1"></span>
          <span class="i_crop_grid i_crop_grid_v i_crop_grid_v2"></span>
          <span class="i_crop_grid i_crop_grid_h i_crop_grid_h1"></span>
          <span class="i_crop_grid i_crop_grid_h i_crop_grid_h2"></span>
          <span class="i_crop_side i_crop_side_n" data-crop-handle="n"></span>
          <span class="i_crop_side i_crop_side_e" data-crop-handle="e"></span>
          <span class="i_crop_side i_crop_side_s" data-crop-handle="s"></span>
          <span class="i_crop_side i_crop_side_w" data-crop-handle="w"></span>
          <span class="i_crop_handle i_crop_handle_nw" data-crop-handle="nw"></span>
          <span class="i_crop_handle i_crop_handle_ne" data-crop-handle="ne"></span>
          <span class="i_crop_handle i_crop_handle_sw" data-crop-handle="sw"></span>
          <span class="i_crop_handle i_crop_handle_se" data-crop-handle="se"></span>
        </div>
      </div>
      <div class="i_crop_controls">
        <button class="i_crop_cancel" type="button"><span aria-hidden="true">×</span><span>Cancel</span></button>
        <button class="i_crop_confirm" type="button"><span aria-hidden="true">✓</span><span>Crop</span></button>
      </div>
    </div>`;
  document.body.append(overlay);
  overlay.querySelector(".i_crop_cancel")?.addEventListener("click", closeImagineCropOverlay);
  overlay.querySelector(".i_crop_confirm")?.addEventListener("click", () => {
    submitImagineCropOverlay().catch((error) => {
      console.warn(error);
      showErrorPanel("Crop failed", error?.message || "Crop failed.");
    });
  });
  overlay.querySelector(".i_crop_box")?.addEventListener("pointerdown", beginImagineCropPointer);
  overlay.querySelectorAll("[data-crop-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", beginImagineCropPointer);
  });
  window.addEventListener("resize", () => {
    if (!imagineCropOverlayState || overlay.hidden) return;
    layoutImagineCropOverlay();
  });
  document.addEventListener("keydown", (event) => {
    if (overlay.hidden || event.key !== "Escape") return;
    closeImagineCropOverlay();
  });
  return overlay;
}

function closeImagineCropOverlay() {
  const overlay = document.querySelector(".i_crop_overlay");
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("i_crop_open");
  if (imagineCropOverlayState?.objectUrl) URL.revokeObjectURL(imagineCropOverlayState.objectUrl);
  imagineCropOverlayState = null;
}

function imagineCropClampRect(rect, frame) {
  const minWidth = Math.max(48, frame.width * 0.08);
  const minHeight = Math.max(48, frame.height * 0.08);
  const width = Math.min(Math.max(rect.width, minWidth), frame.width);
  const height = Math.min(Math.max(rect.height, minHeight), frame.height);
  const x = Math.min(Math.max(rect.x, 0), frame.width - width);
  const y = Math.min(Math.max(rect.y, 0), frame.height - height);
  return { x, y, width, height };
}

function setImagineCropRect(rect) {
  if (!imagineCropOverlayState) return;
  const box = document.querySelector(".i_crop_box");
  const frame = document.querySelector(".i_crop_image_frame");
  if (!box || !frame) return;
  const next = imagineCropClampRect(rect, imagineCropOverlayState.frame);
  imagineCropOverlayState.rect = next;
  box.style.left = `${next.x}px`;
  box.style.top = `${next.y}px`;
  box.style.width = `${next.width}px`;
  box.style.height = `${next.height}px`;
}

function layoutImagineCropOverlay() {
  if (!imagineCropOverlayState) return;
  const frame = document.querySelector(".i_crop_image_frame");
  const image = document.querySelector(".i_crop_image");
  if (!frame || !image) return;
  const naturalWidth = imagineCropOverlayState.naturalWidth || image.naturalWidth || 1;
  const naturalHeight = imagineCropOverlayState.naturalHeight || image.naturalHeight || 1;
  const maxWidth = Math.min(window.innerWidth * 0.72, 980);
  const maxHeight = Math.max(260, window.innerHeight - 190);
  let width = maxWidth;
  let height = width * (naturalHeight / naturalWidth);
  if (height > maxHeight) {
    height = maxHeight;
    width = height * (naturalWidth / naturalHeight);
  }
  width = Math.max(220, Math.round(width));
  height = Math.max(220, Math.round(height));
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  imagineCropOverlayState.frame = { width, height };
  const previous = imagineCropOverlayState.rect;
  if (previous) {
    setImagineCropRect({
      x: previous.x * (width / Math.max(1, imagineCropOverlayState.previousFrame?.width || width)),
      y: previous.y * (height / Math.max(1, imagineCropOverlayState.previousFrame?.height || height)),
      width: previous.width * (width / Math.max(1, imagineCropOverlayState.previousFrame?.width || width)),
      height: previous.height * (height / Math.max(1, imagineCropOverlayState.previousFrame?.height || height)),
    });
  } else {
    setImagineCropRect({
      x: 0,
      y: 0,
      width,
      height,
    });
  }
  imagineCropOverlayState.previousFrame = { width, height };
}

function beginImagineCropPointer(event) {
  if (!imagineCropOverlayState || !(event.currentTarget instanceof Element)) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget.dataset.cropHandle || "";
  const box = document.querySelector(".i_crop_box");
  if (!box) return;
  box.setPointerCapture?.(event.pointerId);
  imagineCropOverlayState.drag = {
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    rect: { ...imagineCropOverlayState.rect },
  };
  window.addEventListener("pointermove", moveImagineCropPointer);
  window.addEventListener("pointerup", endImagineCropPointer, { once: true });
}

function moveImagineCropPointer(event) {
  const drag = imagineCropOverlayState?.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  let { x, y, width, height } = drag.rect;
  if (!drag.handle) {
    setImagineCropRect({ x: x + dx, y: y + dy, width, height });
    return;
  }
  if (drag.handle.includes("e")) width += dx;
  if (drag.handle.includes("s")) height += dy;
  if (drag.handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (drag.handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  setImagineCropRect({ x, y, width, height });
}

function endImagineCropPointer() {
  if (imagineCropOverlayState) imagineCropOverlayState.drag = null;
  window.removeEventListener("pointermove", moveImagineCropPointer);
}

async function loadImagineCropImage(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Crop image could not be loaded.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const image = document.querySelector(".i_crop_image");
  if (!(image instanceof HTMLImageElement)) throw new Error("Crop image view is missing.");
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Crop image could not be loaded."));
    image.src = objectUrl;
  });
  return {
    objectUrl,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  };
}

async function openImagineDetailCropOverlay() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Crop unavailable", "Select an Imagine image thumbnail.");
    return;
  }
  const sourcePostId = imagineActionPostIdForItem(item);
  const mediaUrl = detailMediaUrlForItem("i", item, post);
  if (!sourcePostId || !mediaUrl) {
    showErrorPanel("Crop unavailable", "This Imagine image has no source media.");
    return;
  }
  const overlay = ensureImagineCropOverlay();
  overlay.hidden = false;
  document.body.classList.add("i_crop_open");
  let loaded;
  try {
    loaded = await loadImagineCropImage(mediaUrl);
  } catch (error) {
    closeImagineCropOverlay();
    throw error;
  }
  imagineCropOverlayState = {
    post,
    item,
    sourcePostId,
    objectUrl: loaded.objectUrl,
    naturalWidth: loaded.naturalWidth,
    naturalHeight: loaded.naturalHeight,
    frame: { width: 1, height: 1 },
    previousFrame: null,
    rect: null,
    drag: null,
  };
  requestAnimationFrame(layoutImagineCropOverlay);
}

function imagineCropDataUrl() {
  const state = imagineCropOverlayState;
  const image = document.querySelector(".i_crop_image");
  if (!state || !(image instanceof HTMLImageElement) || !state.rect) {
    throw new Error("Crop selection is missing.");
  }
  const scaleX = state.naturalWidth / state.frame.width;
  const scaleY = state.naturalHeight / state.frame.height;
  const sourceX = Math.round(state.rect.x * scaleX);
  const sourceY = Math.round(state.rect.y * scaleY);
  const sourceWidth = Math.round(state.rect.width * scaleX);
  const sourceHeight = Math.round(state.rect.height * scaleY);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sourceWidth);
  canvas.height = Math.max(1, sourceHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Crop canvas is unavailable.");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function applyImagineCropResult(post, data) {
  const item = data?.item || data?.items?.[0];
  if (!post || !item) return false;
  const targetPath = String(data.source_post_path || post.folder_path || "");
  const updatePost = (candidate) => {
    if (!candidate || candidate.folder_path !== targetPath) return candidate;
    if (typeof mergeImagineGeneratedItems === "function") return mergeImagineGeneratedItems(candidate, [item]);
    const items = [...(candidate.items || [])];
    const itemKey = mediaItemKey(item);
    if (!items.some((existing) => mediaItemKey(existing) === itemKey)) items.push(item);
    const representative = representativeItem(items, { ...candidate, items }) || item;
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  for (const listName of ["imagineRemotePosts", "imagineDiscoverPosts", "imagineUnsavedPosts"]) {
    const list = Array.isArray(library_state[listName]) ? library_state[listName] : [];
    library_state[listName] = list.map(updatePost);
  }
  syncImagineRemotePostsIntoLibrary();
  library_state.selectedPostPath = targetPath || library_state.selectedPostPath;
  library_state.selectedDetailItemId = mediaItemKey(item);
  refreshImagineRemoteViews();
  return true;
}

async function submitImagineCropOverlay() {
  const state = imagineCropOverlayState;
  if (!state?.post || !state?.item) return;
  const confirmButton = document.querySelector(".i_crop_confirm");
  if (confirmButton) confirmButton.disabled = true;
  try {
    const imageData = imagineCropDataUrl();
    const aspectRatio = "1:1";
    const data = await qApi("/api/imagine/image/crop", {
      image_data: imageData,
      account_id: iDetailAccountId(state.item, state.post),
      id: state.sourcePostId,
      post_id: state.sourcePostId,
      item_id: state.item.item_id || mediaItemKey(state.item),
      source_item_id: mediaItemKey(state.item),
      source_post_path: state.post.folder_path || "",
      prompt: detailPromptFor(state.post, state.item) || state.post.prompt || "",
      aspect_ratio: aspectRatio,
      metadata: state.item.metadata || {},
    });
    closeImagineCropOverlay();
    if (!applyImagineCropResult(state.post, data)) {
      throw new Error("Crop response did not include an image.");
    }
    toast("Cropped image.");
  } finally {
    if (confirmButton) confirmButton.disabled = false;
  }
}

function applyImagineUpscaleJobResult(result) {
  if (!result) return false;
  const sourcePostPath = String(result.source_post_path || "");
  const sourceItemId = String(result.source_item_id || result.selected_item_id || "");
  const post = (library_state.posts || []).find((candidate) => candidate?.folder_path === sourcePostPath)
    || selectedLibraryPost();
  const item = post?.items?.find((candidate) => mediaItemKey(candidate) === sourceItemId || imagineActionPostIdForItem(candidate) === String(result.id || ""))
    || selectedDetailItem(post);
  if (!post || !item) return false;
  return applyImagineUpscaleResult(post, item, result);
}

async function upscaleImagineSelectedDetailVideoDirect(button = null) {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "video") {
    showErrorPanel("Upscale unavailable", "Select an Imagine video thumbnail.");
    return;
  }
  const postId = imagineActionPostIdForItem(item);
  if (!postId) {
    showErrorPanel("Upscale unavailable", "This Imagine video has no post id.");
    return;
  }
  const targetResolution = imagineUpscaleTargetResolution(item, post);
  if (!targetResolution) {
    showErrorPanel("Upscale unavailable", "This video cannot be upscaled for the selected Imagine account.");
    return;
  }
  if (button) button.disabled = true;
  try {
    const data = await qApi("/api/imagine/video/upscale", {
      id: postId,
      post_id: postId,
      item_id: item.item_id || "",
      type: "video",
      resolution: targetResolution,
      account_id: iDetailAccountId(item, post),
      metadata: item.metadata || {},
    });
    if (!applyImagineUpscaleResult(post, item, data)) {
      throw new Error("Upscale response did not include a video URL.");
    }
    library_state.selectedDetailItemId = mediaItemKey(item);
    refreshImagineRemoteViews();
    toast("Upscaled video.");
  } finally {
    if (button) button.disabled = false;
  }
}

function bindImagineDetailActions() {
  const heart = document.querySelector(".i_detail_heart");
  heart?.addEventListener("click", () => {
    const post = selectedLibraryPost();
    const item = selectedDetailItem(post);
    const saved = heart.classList.contains("saved") || heart.getAttribute("aria-pressed") === "true";
    const action = isImagineDiscoverPost(post, item)
      || isImagineUnsavedPost(post, item)
      || isImagineSearchPost(post, item)
      || (typeof isImagineT2iPost === "function" && isImagineT2iPost(post))
      ? (saved ? unsaveImagineDiscoverPost(post) : likeImagineSelectedDetailPost())
      : (saved ? unsaveImagineSelectedDetailPost() : Promise.resolve());
    action.catch((error) => {
      console.warn(error);
      showErrorPanel(saved ? "Unsave failed" : "Save failed", error?.message || (saved ? "Unsave failed." : "Save failed."));
    });
  });
  document.querySelector(".i_detail_delete")?.addEventListener("click", () => {
    deleteImagineSelectedDetailItem().catch((error) => {
      console.warn(error);
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    });
  });
  document.querySelector(".i_detail_edit")?.addEventListener("click", () => {
    openImagineDetailImageEditor();
  });
  document.querySelector(".i_detail_crop_btn")?.addEventListener("click", () => {
    openImagineDetailCropOverlay().catch((error) => {
      console.warn(error);
      showErrorPanel("Crop failed", error?.message || "Crop failed.");
    });
  });
  document.querySelector(".i_detail_upscale_btn")?.addEventListener("click", (event) => {
    upscaleImagineSelectedDetailVideo(event.currentTarget).catch((error) => {
      console.warn(error);
      showErrorPanel("Upscale failed", error?.message || "Upscale failed.");
    });
  });
  const aspectPicker = document.querySelector(".i_detail_aspect_picker");
  const aspectButton = aspectPicker?.querySelector(".i_detail_aspect_btn");
  aspectButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (aspectPicker.hidden) return;
    aspectPicker.classList.toggle("open");
  });
  aspectPicker?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const option = event.target.closest(".custom_select_option");
    if (!option || !aspectPicker.contains(option)) return;
    event.preventDefault();
    event.stopPropagation();
    aspectPicker.classList.remove("open");
    startImagineDetailAspectRatio(option.textContent || "", option).catch((error) => {
      console.warn(error);
      showErrorPanel("Aspect Ratio failed", error?.message || "Aspect Ratio failed.");
    });
  });
  document.addEventListener("click", (event) => {
    if (!aspectPicker?.classList.contains("open")) return;
    if (event.target instanceof Element && aspectPicker.contains(event.target)) return;
    aspectPicker.classList.remove("open");
  });
}

bindImagineDetailActions();
