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
  const assetId = String(
    item?.asset_id
    || metadata.asset_id
    || imagine.asset_id
    || item?.item_id
    || item?.post_id
    || imagine.post_id
    || "",
  ).trim();
  return {
    id: assetId,
    asset_id: assetId,
    item_id: item?.item_id || assetId,
    post_id: item?.post_id || assetId,
    type: item?.type || imagine.media_type || "image",
    media_url: mediaUrl,
    remote_url: mediaUrl,
    external_reference: Boolean(
      metadata.external_reference
      || imagine.external_reference
      || metadata.link_source
      || imagine.link_source
      || ["discover", "link", "search"].includes(String(metadata.remote_view || imagine.remote_view || "").toLowerCase())
    ),
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

function isImagineLinkSourcePost(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  return Boolean(
    postMeta.metadata.link_source
    || postMeta.imagine.link_source
    || itemMeta.metadata.link_source
    || itemMeta.imagine.link_source
    || postMeta.metadata.remote_view === "link"
    || postMeta.imagine.remote_view === "link"
    || itemMeta.metadata.remote_view === "link"
    || itemMeta.imagine.remote_view === "link"
  );
}

function isImagineExternalReferenceItem(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  const target = item ? imagineLikeTargetForItem(item) : {};
  return Boolean(
    target.external_reference
    || postMeta.metadata.external_reference
    || postMeta.imagine.external_reference
    || itemMeta.metadata.external_reference
    || itemMeta.imagine.external_reference
    || itemMeta.metadata.local_heart_companion
    || itemMeta.imagine.local_heart_companion
    || isImagineLinkSourcePost(post, item)
  );
}

function imagineLinkBundleItems(post, fallbackItems = []) {
  const fallback = (fallbackItems || []).filter(Boolean);
  if (!isImagineLinkSourcePost(post, fallback[0])) return fallback;
  const items = (post?.items || []).filter(Boolean);
  return items.length ? items : fallback;
}

function imagineLinkRegistrationItem(post, fallbackItem = null) {
  const postMeta = imaginePostActionMetadata(post);
  const fallbackMeta = imaginePostActionMetadata(fallbackItem);
  const linkPostId = String(
    postMeta.metadata.link_post_id
    || postMeta.imagine.link_post_id
    || fallbackMeta.metadata.link_post_id
    || fallbackMeta.imagine.link_post_id
    || "",
  ).trim();
  const items = (post?.items || []).filter(Boolean);
  if (linkPostId) {
    const linkedItem = items.find((item) => imagineLikeTargetForItem(item).id === linkPostId);
    if (linkedItem) return linkedItem;
  }
  return fallbackItem || representativeItem(items, post) || items[0] || null;
}

function isUnsavedImagineLinkPost(post, item = null) {
  if (!isImagineLinkSourcePost(post, item)) return false;
  const registrationItem = imagineLinkRegistrationItem(post, item);
  return !registrationItem || !imaginePostLiked(post, registrationItem);
}

function imaginePostLiked(post, item = null) {
  const postMeta = imaginePostActionMetadata(post);
  const itemMeta = imaginePostActionMetadata(item);
  if (item) {
    return Boolean(
      item?.liked === true
      || item?.favorite === true
      || itemMeta.metadata.liked === true
      || itemMeta.imagine.liked === true
    );
  }
  return Boolean(
    post?.liked === true
    || post?.favorite === true
    || postMeta.metadata.liked === true
    || postMeta.imagine.liked === true
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

function markImagineItemLiked(item, liked) {
  if (!item) return;
  item.liked = liked;
  item.favorite = liked;
  item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  item.metadata.liked = liked;
  item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
  item.metadata.imagine.liked = liked;
}

function imagineSavedGroupIdForPost(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const folderPath = String(post?.folder_path || "");
  return String(
    metadata.local_saved_group_id
    || metadata.group_id
    || (folderPath.startsWith("imagine_unsaved/") ? folderPath.slice("imagine_unsaved/".length) : "")
    || imagineActionPostIdForPost(post)
    || "",
  ).trim();
}

function imagineLikeResultMappings(data) {
  const explicit = Array.isArray(data?.mappings)
    ? data.mappings
      .filter((mapping) => mapping && typeof mapping === "object")
      .map((mapping) => ({
        source_id: String(mapping.source_id || "").trim(),
        source_item_id: String(mapping.source_item_id || "").trim(),
        liked_id: String(mapping.liked_id || mapping.id || "").trim(),
        media_url: String(mapping.media_url || "").trim(),
        external_reference: Boolean(mapping.external_reference),
      }))
      .filter((mapping) => mapping.liked_id)
    : [];
  if (explicit.length) return explicit;
  return (Array.isArray(data?.ids) ? data.ids : [data?.id])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((likedId) => ({
      source_id: "",
      source_item_id: "",
      liked_id: likedId,
      media_url: "",
      external_reference: false,
    }));
}

function applyImagineLikedIdToItem(item, likedId) {
  if (!item || !likedId) return;
  item.post_id = likedId;
  item.root_post_id = likedId;
  item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  item.metadata.post_id = likedId;
  item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
  item.metadata.imagine.post_id = likedId;
  item.metadata.imagine.root_post_id = likedId;
}

function applyImagineUnsavedLikeResult(post, data) {
  const items = (post?.items || []).filter(Boolean);
  const mappings = imagineLikeResultMappings(data);
  if (!post || !items.length || mappings.length < items.length) {
    throw new Error(`Only ${mappings.length} of ${items.length} Unsaved media item(s) were saved.`);
  }
  const unusedItems = new Set(items);
  const applied = [];
  for (const mapping of mappings) {
    let item = items.find((candidate) => {
      if (!unusedItems.has(candidate)) return false;
      const keys = typeof imaginePostIdKeysForItem === "function"
        ? imaginePostIdKeysForItem(candidate)
        : [imagineActionPostIdForItem(candidate), candidate?.remote_url, candidate?.url];
      return (mapping.source_item_id && keys.includes(mapping.source_item_id))
        || (mapping.source_id && keys.includes(mapping.source_id))
        || (mapping.media_url && keys.includes(mapping.media_url));
    });
    if (!item) item = Array.from(unusedItems)[0];
    if (!item) continue;
    unusedItems.delete(item);
    applyImagineLikedIdToItem(item, mapping.liked_id);
    if (mapping.external_reference) {
      item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      item.metadata.external_reference = true;
      item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
      item.metadata.imagine.external_reference = true;
    }
    applied.push({
      source_id: mapping.source_id,
      source_item_id: mapping.source_item_id,
      liked_id: mapping.liked_id,
      media_url: mapping.media_url || item.remote_url || item.url || item.metadata?.media_url || "",
      external_reference: Boolean(mapping.external_reference),
    });
  }
  if (applied.length < items.length) {
    throw new Error(`Only ${applied.length} of ${items.length} Unsaved media item(s) were saved.`);
  }
  const groupId = imagineSavedGroupIdForPost(post);
  const firstLikedId = applied[0]?.liked_id || "";
  post.post_id = firstLikedId;
  post.metadata = post.metadata && typeof post.metadata === "object" ? post.metadata : {};
  post.metadata.local_saved_group_id = groupId || firstLikedId;
  post.metadata.saved_sync_pending = false;
  post.metadata.saved_sync_items = applied;
  delete post.metadata.saved_sync_pending_at;
  post.metadata.imagine_root_post_id = firstLikedId;
  post.metadata.imagine = post.metadata.imagine && typeof post.metadata.imagine === "object" ? post.metadata.imagine : {};
  post.metadata.imagine.post_id = firstLikedId;
  post.metadata.imagine.root_post_id = firstLikedId;
}

function savedImagineSingleItemPost(post, item, data, savedItems = [item]) {
  const mapping = imagineLikeResultMappings(data)[0];
  if (!post || !item || !mapping?.liked_id) {
    throw new Error("The selected Imagine media item was not confirmed in Saved.");
  }
  applyImagineLikedIdToItem(item, mapping.liked_id);
  if (mapping.external_reference) {
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.external_reference = true;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
    item.metadata.imagine.external_reference = true;
  }
  item.liked = true;
  item.favorite = true;
  const items = (savedItems || []).filter(Boolean);
  for (const savedItem of items) {
    savedItem.liked = true;
    savedItem.favorite = true;
    savedItem.metadata = savedItem.metadata && typeof savedItem.metadata === "object" ? savedItem.metadata : {};
    savedItem.metadata.liked = true;
    savedItem.metadata.imagine = savedItem.metadata.imagine && typeof savedItem.metadata.imagine === "object"
      ? savedItem.metadata.imagine
      : {};
    savedItem.metadata.imagine.liked = true;
  }
  const representative = representativeItem(items, { ...post, items }) || item;
  const groupId = imagineSavedGroupIdForPost(post) || mapping.liked_id;
  const metadata = post.metadata && typeof post.metadata === "object" ? { ...post.metadata } : {};
  metadata.local_saved_group_id = groupId;
  metadata.saved_sync_pending = false;
  metadata.saved_sync_items = [{
    source_id: mapping.source_id,
    source_item_id: mapping.source_item_id,
    liked_id: mapping.liked_id,
    media_url: mapping.media_url || item.remote_url || item.url || item.metadata?.media_url || "",
    external_reference: Boolean(mapping.external_reference),
  }];
  metadata.imagine_root_post_id = mapping.liked_id;
  return {
    ...post,
    post_id: mapping.liked_id,
    items,
    representative: representative?.url || representative?.remote_url || representative?.item_id || "",
    representative_item: representative,
    metadata,
  };
}

function savedImaginePostFromLocalPost(post) {
  if (!post) return null;
  const postId = imagineActionPostIdForPost(post);
  if (!postId) return null;
  const groupId = imagineSavedGroupIdForPost(post) || postId;
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
    folder_path: `imagine_saved/${groupId}`,
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

function imagineLocalHeartSnapshot(post, items) {
  const selectedItems = (items || []).filter(Boolean);
  if (!post || !selectedItems.length) return null;
  const representative = representativeItem(selectedItems, { ...post, items: selectedItems }) || selectedItems[0];
  const snapshot = savedImaginePostFromLocalPost({
    ...post,
    items: selectedItems,
    representative: representative?.url || representative?.remote_url || representative?.item_id || "",
    representative_item: representative,
  });
  if (!snapshot) return null;
  snapshot.metadata = snapshot.metadata && typeof snapshot.metadata === "object" ? snapshot.metadata : {};
  snapshot.metadata.local_heart = true;
  snapshot.metadata.saved_sync_pending = false;
  for (const item of snapshot.items || []) {
    item.metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    item.metadata.local_heart = true;
    item.metadata.imagine = item.metadata.imagine && typeof item.metadata.imagine === "object" ? item.metadata.imagine : {};
    item.metadata.imagine.local_heart = true;
  }
  return snapshot;
}

function addImaginePostToSavedView(post) {
  const savedPost = savedImaginePostFromLocalPost(post);
  if (!savedPost) return;
  if (typeof upsertImagineRemotePost === "function") {
    const existing = (library_state.imagineRemotePosts || [])
      .find((candidate) => candidate?.folder_path === savedPost.folder_path);
    const merged = existing && typeof mergeImagineRemotePosts === "function"
      ? mergeImagineRemotePosts([existing], [savedPost])[0]
      : savedPost;
    upsertImagineRemotePost(merged || savedPost);
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
  renderDetailViews();
}

function moveImagineT2iPostOutOfSessionView(post) {
  if (!(typeof isImagineT2iPost === "function" && isImagineT2iPost(post))) return false;
  const folderPath = String(post?.folder_path || "");
  if (folderPath) library_state.sessionImagineT2iPaths?.delete(folderPath);
  return true;
}

function imagineItemsRemoveWholePost(post, removedItems) {
  const postItems = (post?.items || []).filter(Boolean);
  const removedKeys = new Set(
    (removedItems || []).filter(Boolean).flatMap((item) => imaginePostIdKeysForItem(item)),
  );
  return Boolean(postItems.length) && postItems.every((item) => (
    imaginePostIdKeysForItem(item).some((key) => removedKeys.has(key))
  ));
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
  library_state.iMainView = typeof imagineViewValue === "function" ? imagineViewValue("IMAGINE", "imagine") : "imagine";
  if (typeof setImagineTab === "function") setImagineTab("i_imagine_tab_btn");
  openScreen("i_main", "i_imagine_nav_btn");
}

function imagineListElementForScreen(screenId = screen_state.current_screen) {
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
  if (screenId === "i_discover_main" && typeof renderImagineDiscoverCards === "function") {
    renderImagineDiscoverCards();
  } else if (screenId === "search_main" && typeof renderSearchResults === "function") {
    renderSearchResults();
  } else {
    renderImagineSourceCards();
  }
  restoreImagineListScrollForScreen(screenId, scrollTop);
}

const imaginePostListNames = [
  "imagineRemotePosts",
  "imagineDiscoverPosts",
  "imagineUnsavedPosts",
  "imagineSearchPosts",
  "imagineUploadPosts",
  "posts",
];

function isImagineUploadPagePost(post) {
  return Boolean(
    post?.area === "imagine_upload_remote"
    || String(post?.folder_path || "").startsWith("imagine_uploads/")
  );
}

function isImagineUploadOriginBundlePost(post) {
  return Boolean(
    post?.metadata?.upload_origin_bundle === true
    && !isImagineUploadPagePost(post)
  );
}

function isImagineUploadBundleSourceItem(post, item) {
  if (!isImagineUploadOriginBundlePost(post) || !item) return false;
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const role = String(item?.role || metadata.role || imagine.role || "").trim().toLowerCase();
  const relation = String(item?.relation || metadata.relation || imagine.relation || "").trim().toLowerCase();
  const sourceId = String(post?.metadata?.upload_source_asset_id || "").trim();
  const itemId = imagineDeleteAssetIdForItem(item);
  return Boolean(
    item?.official_upload_source
    || metadata.official_upload_source
    || imagine.official_upload_source
    || role === "source"
    || role === "upload"
    || relation === "upload"
    || (sourceId && itemId === sourceId)
  );
}

function captureImaginePostRemovalSnapshot(post) {
  const folderPath = String(post?.folder_path || "");
  if (!folderPath) return null;
  return {
    folderPath,
    selectedPostPath: library_state.selectedPostPath,
    selectedDetailItemId: library_state.selectedDetailItemId,
    screenId: screen_state.current_screen,
    activeButtonId: screen_state.current_i_nav_btn,
    lists: imaginePostListNames.map((listName) => ({
      listName,
      entries: (library_state[listName] || []).flatMap((candidate, index) => (
        candidate?.folder_path === folderPath ? [{ index, post: candidate }] : []
      )),
    })).filter((snapshot) => snapshot.entries.length),
  };
}

function restoreImaginePostRemovalSnapshot(snapshot, optimisticState = {}) {
  if (!snapshot?.folderPath) return;
  for (const listSnapshot of snapshot.lists || []) {
    const current = Array.isArray(library_state[listSnapshot.listName])
      ? library_state[listSnapshot.listName].filter((candidate) => candidate?.folder_path !== snapshot.folderPath)
      : [];
    for (const entry of [...listSnapshot.entries].sort((left, right) => left.index - right.index)) {
      current.splice(Math.min(entry.index, current.length), 0, entry.post);
    }
    library_state[listSnapshot.listName] = current;
  }
  syncImagineRemotePostsIntoLibrary();
  const selectionUnchanged = (
    screen_state.current_screen === optimisticState.screenId
    && library_state.selectedPostPath === optimisticState.selectedPostPath
    && library_state.selectedDetailItemId === optimisticState.selectedDetailItemId
  );
  if (selectionUnchanged) {
    library_state.selectedPostPath = snapshot.selectedPostPath;
    library_state.selectedDetailItemId = snapshot.selectedDetailItemId;
  }
  if (
    selectionUnchanged
    && snapshot.screenId === "i_detail"
    && screen_state.current_screen !== "i_detail"
  ) {
    openScreen("i_detail", snapshot.activeButtonId);
  }
  renderImagineListForScreen(snapshot.screenId);
  renderDetailViews();
}

function removeImagineItemsFromPost(post, removedItems, options = {}) {
  const itemsToRemove = (Array.isArray(removedItems) ? removedItems : [removedItems]).filter(Boolean);
  if (!post?.folder_path || !itemsToRemove.length) return false;
  const screenId = options.screenId || screen_state.current_screen;
  const keepListScreen = Boolean(options.keepListScreen);
  const scrollTop = options.scrollTop;
  const removedKeys = new Set(itemsToRemove.flatMap((item) => imaginePostIdKeysForItem(item)));
  const removeSharedSavedItems = !isImagineUploadPagePost(post);
  const stripPost = (candidate, matchSavedItems = false) => {
    if (!candidate) return candidate;
    const candidateItems = candidate.items || [];
    const samePath = candidate.folder_path === post.folder_path;
    const hasDeletedSavedItem = matchSavedItems && candidateItems.some((item) => (
      imaginePostIdKeysForItem(item).some((key) => removedKeys.has(key))
    ));
    if (!samePath && !hasDeletedSavedItem) return candidate;
    const items = candidateItems.filter((item) => {
      const keys = imaginePostIdKeysForItem(item);
      return !keys.some((key) => removedKeys.has(key));
    });
    if (items.length === candidateItems.length) return candidate;
    if (!items.length) return null;
    const representative = representativeItem(items, { ...candidate, items }) || items[0];
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  for (const listName of imaginePostListNames) {
    if (!Array.isArray(library_state[listName])) continue;
    library_state[listName] = library_state[listName]
      .map((candidate) => stripPost(
        candidate,
        listName === "imagineRemotePosts" && removeSharedSavedItems,
      ))
      .filter(Boolean);
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

function imagineDeleteAssetIdForItem(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return String(
    item?.asset_id
    || metadata.asset_id
    || imagine.asset_id
    || item?.item_id
    || item?.id
    || item?.post_id
    || imagine.post_id
    || "",
  ).trim();
}

function imagineDeleteConversationIdForPost(post, item = null) {
  const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
  const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const postImagine = postMetadata.imagine && typeof postMetadata.imagine === "object" ? postMetadata.imagine : {};
  const explicitId = String(
    item?.conversation_id
    || itemMetadata.conversation_id
    || itemImagine.conversation_id
    || post?.conversation_id
    || postMetadata.conversation_id
    || postImagine.conversation_id
    || "",
  ).trim();
  if (explicitId) return explicitId;
  if (isImagineUnsavedPost(post, item)) return "";
  return String(
    postMetadata.imagine_root_post_id
    || postMetadata.raw_root_post_id
    || post?.root_post_id
    || post?.post_id
    || "",
  ).trim();
}

function imagineDeletePayloadForItem(post, item) {
  const postId = imagineActionPostIdForItem(item);
  const assetId = imagineDeleteAssetIdForItem(item);
  if (!postId && !assetId) {
    return null;
  }
  const uploadPage = isImagineUploadPagePost(post);
  const bundleSourceOnly = isImagineUploadBundleSourceItem(post, item);
  return {
    id: assetId || postId,
    asset_id: assetId,
    post_id: postId,
    item_id: item?.item_id || "",
    detail_post_id: imagineActionPostIdForPost(post),
    conversation_id: imagineDeleteConversationIdForPost(post, item),
    type: item?.type || "",
    media_url: item?.remote_url || item?.url || item?.metadata?.media_url || item?.metadata?.remote_url || item?.metadata?.imagine?.media_url || "",
    remote_url: item?.remote_url || item?.url || "",
    metadata: item?.metadata || {},
    account_id: iDetailAccountId(item, post),
    source_scope: uploadPage ? "upload_page" : (isImagineUploadOriginBundlePost(post) ? "imagine_bundle" : ""),
    bundle_source_only: bundleSourceOnly,
    bundle_post_id: bundleSourceOnly
      ? String(post?.metadata?.conversation_id || post?.post_id || "").trim()
      : "",
  };
}

function imagineConversationDeletePayloadForPost(post) {
  const items = (post?.items || []).filter(Boolean);
  const ownedItem = items.find((item) => !isImagineExternalReferenceItem(post, item));
  const representative = ownedItem || representativeItem(items, post) || post?.representative_item || items[0];
  const payload = imagineDeletePayloadForItem(post, representative);
  if (!payload) return null;
  return {
    ...payload,
    conversation_id: imagineDeleteConversationIdForPost(post, representative),
  };
}

function imagineDeleteItemIsRecoveredStartFrame(item) {
  return Boolean(
    typeof isImagineRecoveredStartFrame === "function"
    && isImagineRecoveredStartFrame(item)
  );
}

function imagineRecoveredDeleteCompanions(post, item) {
  if (!post || !item || imagineDeleteItemIsRecoveredStartFrame(item)) return [];
  const sourceKey = String(mediaItemKey(item) || "");
  if (!sourceKey) return [];
  return (post.items || []).filter((candidate) => (
    imagineDeleteItemIsRecoveredStartFrame(candidate)
    && typeof imagineRecoveredStartFrameSourceKey === "function"
    && imagineRecoveredStartFrameSourceKey(candidate) === sourceKey
  ));
}

function discardImagineRecoveredDeleteItems(post, items) {
  if (typeof discardImagineRecoveredStartFrame !== "function") return;
  for (const item of items || []) {
    if (imagineDeleteItemIsRecoveredStartFrame(item)) discardImagineRecoveredStartFrame(post, item);
  }
}

async function deleteImagineRemoteItem(post, item) {
  const deletePayload = imagineDeletePayloadForItem(post, item);
  if (!deletePayload) {
    throw new Error("This Imagine item has no asset id.");
  }
  if (isImagineExternalReferenceItem(post, item) && !isImagineUnsavedPost(post, item)) {
    const unsaved = await unsaveImagineExternalItems(post, [item], { wholeCard: false });
    return {
      deletedItems: unsaved.removedItems,
      failures: [],
      data: unsaved.data,
      action: "external-unsave",
    };
  }
  const endpoint = isImagineUnsavedPost(post, item)
    ? "/api/imagine/asset-metadata/delete"
    : "/api/imagine/asset/delete";
  const data = await qApi(endpoint, deletePayload);
  return {
    deletedItems: [item],
    failures: [],
    data,
    action: endpoint.includes("asset-metadata") ? "asset-metadata-delete" : "asset-delete",
  };
}

function isImagineConversationDeleteFallbackError(error) {
  const message = String(error?.message || error || "");
  return (
    (/\bHTTP 404\b/i.test(message) && /Conversation(?:' with ID)?[^]*not found/i.test(message))
    || (
      /\bHTTP 500\b/i.test(message)
      && /GetAssetMetadataForDelete|unexpected database error/i.test(message)
    )
  );
}

async function deleteImagineCardAssets(post, items) {
  const deletedItems = [];
  const failures = [];
  const candidates = (items || []).filter(Boolean);
  const externalItems = candidates.filter((item) => isImagineExternalReferenceItem(post, item));
  const ownedItems = candidates.filter((item) => !isImagineExternalReferenceItem(post, item));
  if (externalItems.length) {
    try {
      const unsaved = await unsaveImagineExternalItems(post, externalItems);
      deletedItems.push(...unsaved.removedItems);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const item of ownedItems) {
    const payload = imagineDeletePayloadForItem(post, item);
    if (!payload) {
      failures.push(new Error("This Imagine item has no asset id."));
      continue;
    }
    try {
      await qApi("/api/imagine/asset/delete", payload);
      deletedItems.push(item);
    } catch (error) {
      failures.push(error);
    }
  }
  return { deletedItems, failures };
}

async function unsaveImagineExternalItems(post, items, { wholeCard = true } = {}) {
  const selectedItems = (items || []).filter(Boolean);
  const linkSource = isImagineLinkSourcePost(post, selectedItems[0]);
  const registrationItems = linkSource && wholeCard
    ? [imagineLinkRegistrationItem(post, selectedItems[0])].filter(Boolean)
    : selectedItems;
  const targets = registrationItems
    .map((item) => ({ item, target: imagineLikeTargetForItem(item) }))
    .filter((entry) => entry.target.id);
  if (!targets.length || targets.length !== registrationItems.length) {
    throw new Error("This external Imagine post has no asset id.");
  }
  const data = await qApi("/api/imagine/post/unsave", {
    account_id: post?.account_id || iDetailAccountId(targets[0].item, post),
    scope: wholeCard ? "card" : "item",
    items: targets.map(({ item, target }) => ({
      ...target,
      external_reference: true,
      detail_post_id: imagineActionPostIdForPost(post),
      conversation_id: imagineDeleteConversationIdForPost(post, item),
    })),
  });
  return {
    data,
    removedItems: linkSource && wholeCard ? imagineLinkBundleItems(post, selectedItems) : selectedItems,
  };
}

async function deleteImagineRemoteCard(post) {
  const items = (post?.items || []).filter(Boolean);
  if (
    items.some((item) => (
      !imagineDeleteItemIsRecoveredStartFrame(item)
      && imagineDeletePayloadForItem(post, item)
    ))
    && typeof invalidateImagineSavedRequestsForDelete === "function"
  ) {
    invalidateImagineSavedRequestsForDelete();
  }
  if (isImagineUnsavedPost(post)) {
    const results = await Promise.allSettled(items.map((item) => {
      const payload = imagineDeletePayloadForItem(post, item);
      if (!payload) throw new Error("This Unsaved item has no asset id.");
      return qApi("/api/imagine/asset-metadata/delete", payload);
    }));
    const deletedItems = [];
    const failures = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === "fulfilled") deletedItems.push(items[index]);
      else failures.push(result.reason);
    }
    return { deletedItems, failures };
  }
  const result = await deleteImagineCardAssets(post, items);
  return {
    ...result,
    data: {
      ok: result.failures.length === 0,
      action: items.every((item) => isImagineExternalReferenceItem(post, item))
        ? "external-unsave"
        : "asset-delete",
    },
  };
}

function imagineCardHasDeleteTarget(post) {
  return (post?.items || []).some((item) => imagineDeletePayloadForItem(post, item));
}

async function deleteImagineSelectedDetailItem() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item) {
    showErrorPanel("Delete unavailable", "Select an Imagine thumbnail to delete.");
    return;
  }
  const localLinkOnly = isUnsavedImagineLinkPost(post, item);
  if (!localLinkOnly && !imagineDeletePayloadForItem(post, item)) {
    showErrorPanel("Delete unavailable", "This Imagine item has no asset id.");
    return;
  }
  const ok = await confirmAction({
    title: "Delete Item",
    message: localLinkOnly
      ? "Remove this temporary link item from the app?"
      : isImagineExternalReferenceItem(post, item)
      ? "Remove this external Imagine item from your list? The original will not be deleted."
      : "Delete this Imagine Item?",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  if (localLinkOnly) {
    removeImagineItemsFromPost(post, [item]);
    toast("Removed temporary link item.");
    return;
  }
  if (
    !imagineDeleteItemIsRecoveredStartFrame(item)
    && typeof invalidateImagineSavedRequestsForDelete === "function"
  ) {
    invalidateImagineSavedRequestsForDelete();
  }
  const localDeleteItems = [item, ...imagineRecoveredDeleteCompanions(post, item)];
  const deleteButton = document.querySelector(".i_detail_delete");
  const deleteButtonWasDisabled = Boolean(deleteButton?.disabled);
  if (deleteButton) deleteButton.disabled = true;
  deleteButton?.setAttribute("aria-busy", "true");
  try {
    const result = await deleteImagineRemoteItem(post, item);
    removeImagineItemsFromPost(post, localDeleteItems);
    discardImagineRecoveredDeleteItems(post, localDeleteItems);
    toast(result.action === "external-unsave" ? "Removed external Imagine item." : "Deleted Imagine item.");
  } finally {
    if (deleteButton) deleteButton.disabled = deleteButtonWasDisabled;
    deleteButton?.removeAttribute("aria-busy");
  }
}

async function deleteImagineCardPost(post, button = null) {
  const items = (post?.items || []).filter(Boolean);
  if (!post || !items.length || !imagineCardHasDeleteTarget(post)) {
    showErrorPanel("Delete unavailable", "This Imagine card has no deletion target.");
    return;
  }
  const screenId = screen_state.current_screen;
  const scrollTop = imagineListScrollTopForScreen(screenId);
  const ok = await confirmAction({
    title: "Delete Post",
    message: items.every((item) => isImagineExternalReferenceItem(post, item))
      ? "Remove this external Imagine post from your list? The original will not be deleted."
      : (items.length > 1 ? `Delete this Imagine post and ${items.length} media item(s)?` : "Delete this Imagine post?"),
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const pendingCard = button?.closest?.(".card") || null;
  if (pendingCard) {
    pendingCard.hidden = true;
    pendingCard.setAttribute("aria-busy", "true");
  }
  button?.setAttribute("aria-busy", "true");
  try {
    const result = await deleteImagineRemoteCard(post);
    const fullyDeleted = result.deletedItems.length > 0
      && result.failures.length === 0
      && imagineItemsRemoveWholePost(post, result.deletedItems);
    if (result.deletedItems.length) {
      removeImagineItemsFromPost(post, result.deletedItems, {
        keepListScreen: true,
        screenId,
        scrollTop,
      });
      toast(result.data?.action === "external-unsave" ? "Removed external Imagine post." : "Deleted Imagine post.");
    }
    if (!fullyDeleted && pendingCard) pendingCard.hidden = false;
    if (result.failures.length) {
      if (!result.deletedItems.length && pendingCard) {
        pendingCard.hidden = false;
        renderImagineListForScreen(screenId, scrollTop);
      }
      showErrorPanel(
        "Delete failed",
        `${result.failures.length} media item(s) could not be deleted. ${result.failures[0]?.message || ""}`.trim(),
      );
    }
  } catch (error) {
    if (pendingCard) {
      pendingCard.hidden = false;
      renderImagineListForScreen(screenId, scrollTop);
    }
    showErrorPanel("Delete failed", error?.message || "Delete failed.");
  } finally {
    pendingCard?.removeAttribute("aria-busy");
    button?.removeAttribute("aria-busy");
  }
}

async function likeImagineCardPost(post) {
  const representative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  const unsavedPost = Boolean(post && typeof isImagineUnsavedPost === "function" && isImagineUnsavedPost(post));
  if (!post || !representative || (!postId && !unsavedPost)) {
    showErrorPanel("Save unavailable", "This Imagine card has no post id.");
    return;
  }
  const returnScreenId = screen_state.current_screen === "i_unsaved_main" ? "i_unsaved_main" : "";
  const returnScrollTop = returnScreenId ? imagineListScrollTopForScreen(returnScreenId) : null;
  const t2iPost = typeof isImagineT2iPost === "function" && isImagineT2iPost(post);
  const linkSource = isImagineLinkSourcePost(post, representative);
  const payload = { account_id: iDetailAccountId(representative, post) };
  const selectedItems = t2iPost ? [representative] : (post.items || []);
  const localItems = linkSource ? imagineLinkBundleItems(post, selectedItems) : selectedItems;
  const registrationItems = linkSource
    ? [imagineLinkRegistrationItem(post, representative)].filter(Boolean)
    : selectedItems;
  payload.items = registrationItems
    .map(imagineLikeTargetForItem)
    .filter((target) => target.id);
  payload.local_group_id = imagineSavedGroupIdForPost(post);
  payload.local_post = imagineLocalHeartSnapshot(post, localItems);
  if (post.__imagineSavePending) return;
  post.__imagineSavePending = true;
  let data;
  try {
    data = await qApi("/api/imagine/post/like", payload);
  } finally {
    post.__imagineSavePending = false;
  }
  if (t2iPost) applyImagineLikeResultPostId(post, representative, data);
  else if (unsavedPost) applyImagineUnsavedLikeResult(post, data);
  if (typeof forgetHiddenImaginePost === "function") forgetHiddenImaginePost(post);
  markImaginePostLiked(post, true);
  addImaginePostToSavedView(post);
  const movedFromT2i = moveImagineT2iPostOutOfSessionView(post);
  if (unsavedPost) {
    library_state.imagineUnsavedPosts = (library_state.imagineUnsavedPosts || [])
      .filter((candidate) => candidate?.folder_path !== post.folder_path);
  }
  if (!linkSource) library_state.imagineRemoteLoaded = false;
  if (movedFromT2i) {
    renderImagineSourceCards();
    renderDetailViews();
  } else {
    refreshImagineRemoteViews();
  }
  if (returnScreenId) restoreImagineListScrollForScreen(returnScreenId, returnScrollTop);
  toast("Saved Imagine post.");
}

function removeImagineSavedItemsOnly(post, removedItems, scrollTop = null) {
  const removedKeys = new Set((removedItems || []).flatMap((item) => imaginePostIdKeysForItem(item)));
  const updatePost = (candidate) => {
    if (!candidate || candidate.folder_path !== post.folder_path) return candidate;
    const items = (candidate.items || []).filter((item) => (
      !imaginePostIdKeysForItem(item).some((key) => removedKeys.has(key))
    ));
    if (!items.length) return null;
    const representative = representativeItem(items, { ...candidate, items }) || items[0];
    return normalizeServerPost({
      ...candidate,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  };
  library_state.imagineRemotePosts = (library_state.imagineRemotePosts || [])
    .map(updatePost)
    .filter(Boolean);
  syncImagineRemotePostsIntoLibrary();
  const current = selectedLibraryPost();
  if (library_state.selectedPostPath === post.folder_path && !current) {
    library_state.selectedPostPath = "";
    library_state.selectedDetailItemId = "";
    openScreen("i_main", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
  } else if (current) {
    const nextItem = current.items?.[0] || current.representative_item;
    if (nextItem) library_state.selectedDetailItemId = mediaItemKey(nextItem);
  }
  renderImagineSourceCards();
  renderDetailViews();
  if (scrollTop !== null) restoreImagineListScrollForScreen("i_main", scrollTop);
}

async function unsaveImaginePost(post, { item = null } = {}) {
  const selectedTargets = (item ? [item] : (post?.items || [])).filter(Boolean);
  if (!post || !selectedTargets.length) {
    showErrorPanel("Unsave unavailable", "This Imagine post has no media item.");
    return;
  }
  const linkSource = isImagineLinkSourcePost(post, selectedTargets[0]);
  const localTargets = linkSource ? imagineLinkBundleItems(post, selectedTargets) : selectedTargets;
  const registrationTargets = linkSource
    ? [imagineLinkRegistrationItem(post, selectedTargets[0])].filter(Boolean)
    : selectedTargets;
  const targetEntries = registrationTargets
    .map((targetItem) => ({ item: targetItem, payload: imagineLikeTargetForItem(targetItem) }))
    .filter((entry) => entry.payload.id);
  if (!targetEntries.length || targetEntries.length !== registrationTargets.length) {
    showErrorPanel("Unsave unavailable", "This Imagine post has no asset id.");
    return;
  }
  const ok = await confirmAction({
    title: "Unsave post",
    message: localTargets.length > 1 ? `Remove ${localTargets.length} media item(s) from Saved?` : "Remove this media item from Saved?",
    confirmLabel: "Unsave",
  });
  if (!ok) return;
  const accountId = post.account_id || iDetailAccountId(registrationTargets[0], post);
  await qApi("/api/imagine/post/unsave", {
    account_id: accountId,
    items: targetEntries.map((entry) => ({
      ...entry.payload,
      detail_post_id: imagineActionPostIdForPost(post),
      conversation_id: imagineDeleteConversationIdForPost(post, entry.item),
    })),
  });
  for (const target of localTargets) {
    target.liked = false;
    target.favorite = false;
  }
  const scrollTop = screen_state.current_screen === "i_main"
    ? imagineListScrollTopForScreen("i_main")
    : null;
  removeImagineSavedItemsOnly(post, localTargets, scrollTop);
  library_state.imagineUnsavedLoaded = false;
  toast("Unsaved Imagine post.");
}

async function unsaveImagineDiscoverPost(post, item = null) {
  return unsaveImaginePost(post, { item });
}

async function unsaveImagineCardPost(post) {
  return unsaveImaginePost(post);
}

async function unsaveImagineSelectedDetailPost() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post) || post?.representative_item || post?.items?.[0];
  return unsaveImaginePost(post, { item });
}

async function likeImagineSelectedDetailPost() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post) || post?.representative_item || post?.items?.[0];
  const postId = imagineActionPostIdForPost(post);
  const unsavedPost = Boolean(post && typeof isImagineUnsavedPost === "function" && isImagineUnsavedPost(post, item));
  if (!post || !item || (!postId && !unsavedPost)) {
    showErrorPanel("Save unavailable", "This Imagine post has no post id.");
    return;
  }
  const t2iPost = typeof isImagineT2iPost === "function" && isImagineT2iPost(post);
  const linkSource = isImagineLinkSourcePost(post, item);
  const localItems = linkSource ? imagineLinkBundleItems(post, [item]) : [item];
  const registrationItem = linkSource ? imagineLinkRegistrationItem(post, item) : item;
  const payload = { account_id: post.account_id || iDetailAccountId(registrationItem, post) };
  payload.items = [imagineLikeTargetForItem(registrationItem)].filter((target) => target.id);
  payload.local_group_id = imagineSavedGroupIdForPost(post);
  payload.local_post = imagineLocalHeartSnapshot(post, localItems);
  if (post.__imagineSavePending) return;
  post.__imagineSavePending = true;
  let data;
  try {
    data = await qApi("/api/imagine/post/like", payload);
  } finally {
    post.__imagineSavePending = false;
  }
  const savedItemPost = savedImagineSingleItemPost(post, registrationItem, data, localItems);
  if (t2iPost) applyImagineLikeResultPostId(savedItemPost, registrationItem, data);
  if (linkSource) markImaginePostLiked(post, true);
  else markImagineItemLiked(registrationItem, true);
  if (typeof forgetHiddenImaginePost === "function") forgetHiddenImaginePost(post);
  addImaginePostToSavedView(savedItemPost);
  const movedFromT2i = moveImagineT2iPostOutOfSessionView(post);
  const movedFromUnsaved = unsavedPost;
  if (movedFromUnsaved) {
    const selectedKeys = new Set(imaginePostIdKeysForItem(item));
    library_state.imagineUnsavedPosts = (library_state.imagineUnsavedPosts || [])
      .map((candidate) => {
        if (candidate?.folder_path !== post.folder_path) return candidate;
        const items = (candidate.items || []).filter((candidateItem) => (
          !imaginePostIdKeysForItem(candidateItem).some((key) => selectedKeys.has(key))
        ));
        if (!items.length) return null;
        const representative = representativeItem(items, { ...candidate, items }) || items[0];
        return normalizeServerPost({
          ...candidate,
          items,
          representative: representative?.file || representative?.url || representative?.item_id || "",
          representative_item: representative,
        });
      })
      .filter(Boolean);
    library_state.imagineUnsavedLoaded = true;
  }
  if (!linkSource) library_state.imagineRemoteLoaded = false;
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
    if (typeof prepareActiveImagineBridgeSession === "function") {
      await prepareActiveImagineBridgeSession({ force: false, silent: true, accountId: payload.account_id });
    }
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

function imagineDetailPostIdFromAddress(address) {
  const text = String(address || "").trim();
  if (!text) return "";
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  try {
    const url = new URL(text, window.location.origin);
    const match = url.pathname.match(new RegExp(`/imagine/post/(${uuid})(?:/|$)`, "i"))
      || url.pathname.match(new RegExp(`/generated/(${uuid})(?:/|-part-)`, "i"))
      || url.pathname.match(new RegExp(`/users/${uuid}/(${uuid})(?:/|$)`, "i"));
    return match?.[1] || "";
  } catch {
    const match = text.match(new RegExp(`/imagine/post/(${uuid})(?:[/?#]|$)`, "i"))
      || text.match(new RegExp(`/generated/(${uuid})(?:/|-part-)`, "i"))
      || text.match(new RegExp(`/users/${uuid}/(${uuid})(?:[/?#]|$)`, "i"));
    return match?.[1] || "";
  }
}

function imagineDetailConversationId(post, item, address = "") {
  const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
  const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const postImagine = postMetadata.imagine && typeof postMetadata.imagine === "object" ? postMetadata.imagine : {};
  let addressConversation = "";
  try {
    addressConversation = new URL(String(address || ""), window.location.origin).searchParams.get("conversation") || "";
  } catch {
    addressConversation = "";
  }
  return String(
    addressConversation
    || item?.conversation_id
    || itemMetadata.conversation_id
    || itemImagine.conversation_id
    || post?.conversation_id
    || postMetadata.conversation_id
    || postImagine.conversation_id
    || item?.root_post_id
    || itemMetadata.root_post_id
    || itemImagine.root_post_id
    || itemMetadata.root_asset_id
    || itemImagine.root_asset_id
    || post?.root_post_id
    || postMetadata.imagine_root_post_id
    || postMetadata.raw_root_post_id
    || post?.post_id
    || ""
  ).trim();
}

async function copyImagineSelectedDetailMediaAddress() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item) {
    throw new Error("Select an Imagine media item.");
  }
  const address = typeof iDetailRawMediaUrl === "function"
    ? String(iDetailRawMediaUrl(item) || "").trim()
    : "";
  if (!address) {
    throw new Error("This media has no address.");
  }
  const postId = imagineDetailPostIdFromAddress(address)
    || String(item?.asset_id || imagineActionPostIdForItem(item) || "").trim();
  const conversationId = imagineDetailConversationId(post, item, address);
  if (!postId || !conversationId) {
    throw new Error("This media has no Imagine post address.");
  }
  const postAddress = `https://grok.com/imagine/post/${encodeURIComponent(postId)}?conversation=${encodeURIComponent(conversationId)}`;
  const copied = typeof copyText === "function" && await copyText(postAddress);
  if (!copied) {
    throw new Error("Copy failed.");
  }
  toast("Imagine post address copied.");
}

function bindImagineDetailActions() {
  const heart = document.querySelector(".i_detail_heart");
  heart?.addEventListener("click", () => {
    if (heart.getAttribute("aria-busy") === "true") return;
    const post = selectedLibraryPost();
    const item = selectedDetailItem(post);
    const canSave = typeof detailCanSaveImaginePost === "function"
      && detailCanSaveImaginePost(post, item);
    const saved = typeof imaginePostLiked === "function"
      && (imaginePostLiked(post, item) || imaginePostLiked(post));
    if (!canSave || saved) {
      syncImagineDetailHeartState(post, item);
      return;
    }
    heart.classList.add("saved");
    heart.setAttribute("aria-pressed", "true");
    heart.setAttribute("aria-label", "Saving");
    heart.setAttribute("aria-busy", "true");
    likeImagineSelectedDetailPost()
      .catch((error) => {
        console.warn(error);
        showErrorPanel("Save failed", error?.message || "Save failed.");
      })
      .finally(() => {
        heart.removeAttribute("aria-busy");
        const currentPost = selectedLibraryPost();
        syncImagineDetailHeartState(currentPost, selectedDetailItem(currentPost));
      });
  });
  document.querySelector(".i_detail_copy_url")?.addEventListener("click", () => {
    copyImagineSelectedDetailMediaAddress().catch((error) => {
      console.warn(error);
      showErrorPanel("Copy failed", error?.message || "Copy failed.");
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
