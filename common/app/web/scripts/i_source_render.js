// Imagine source list filtering and rendering
const IMAGINE_VIRTUAL_LIST_KEY = "imagine-main";
const IMAGINE_DISCOVER_VIRTUAL_LIST_KEY = "imagine-discover";
const IMAGINE_UNSAVED_VIRTUAL_LIST_KEY = "imagine-unsaved";
const IMAGINE_SAVED_BACKGROUND_SYNC_DELAY_MS = 900;
let imagineSavedDisplayPostsMemoSource = null;
let imagineSavedDisplayPostsMemoResult = [];
let imagineSavedVisiblePostsMemoResult = [];

function imagineViewValue(name, fallback) {
  return typeof IMAGINE_MAIN_VIEWS === "object" && IMAGINE_MAIN_VIEWS
    ? IMAGINE_MAIN_VIEWS[name] || fallback
    : fallback;
}

function isImaginePost(post) {
  return post.source === "imagine";
}

function activeImagineSavedAccount() {
  const activeId = account_state.imagine?.active_id || "";
  return (account_state.imagine?.accounts || []).find((item) => item.id === activeId)
    || account_state.imagine?.accounts?.[0];
}

function canLoadImagineSavedList() {
  const account = activeImagineSavedAccount();
  return Boolean(
    library_state.apiReady
    && library_state.rootPath
    && account_state.imagine?.accounts?.length
    && account?.status !== "expired"
    && account?.status !== "login_required"
    && account?.status !== "oauth_error"
  );
}

function canLoadImagineSavedCache() {
  return Boolean(
    library_state.apiReady
    && library_state.rootPath
    && account_state.imagine?.accounts?.length
    && activeImagineSavedAccount()
  );
}

function imagineSavedAccountNeedsLogin() {
  const account = activeImagineSavedAccount();
  return Boolean(account && ["expired", "login_required", "oauth_error"].includes(String(account.status || "")));
}

function imaginePostIdKeysForItem(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return [
    mediaItemKey(item),
    item?.item_id,
    item?.id,
    item?.post_id,
    metadata.post_id,
    imagine.post_id,
    item?.asset_id,
    metadata.asset_id,
    metadata.root_asset_id,
    imagine.asset_id,
    imagine.root_asset_id,
    item?.remote_url,
    item?.url,
    item?.object_url,
    item?.thumbnail_url,
    metadata.remote_url,
    metadata.media_url,
    imagine.media_url,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function imagineLinkPostIdFromValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  return text.match(new RegExp(`/imagine/post/(${uuidPattern})`))?.[1]
    || text.match(new RegExp(`^(${uuidPattern})$`))?.[1]
    || "";
}

function isImagineLinkSelected() {
  return Boolean(document.getElementById("i_link_btn")?.classList.contains("active"));
}

function setImagineLinkInputOpen(open, options = {}) {
  const button = document.getElementById("i_link_btn");
  const input = document.getElementById("i_link_input");
  if (!button || !input) return;
  if (typeof setTopbarCollapsedInput === "function") {
    if (open) setTopbarCollapsedInput("link");
    else setTopbarCollapsedInput("", { onlyIf: "link" });
  }
  input.hidden = false;
  if (open) {
    for (const navButton of navButtons) navButton.classList.remove("active");
  }
  button.classList.toggle("active", Boolean(open));
  button.setAttribute("aria-pressed", String(Boolean(open)));
  if (!open && typeof syncSearchState === "function") syncSearchState();
  if (!open && options.clear !== false) input.value = "";
  if (open && options.focus) {
    requestAnimationFrame(() => input.focus());
  }
}

function mergeImagineLinkPosts(posts) {
  const normalized = normalizeImagineRemotePosts(posts);
  if (!normalized.length) return [];
  const merged = new Map();
  for (const post of library_state.imagineRemotePosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  for (const post of normalized) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  library_state.imagineRemotePosts = Array.from(merged.values());
  syncImagineRemotePostsIntoLibrary();
  return normalized;
}

function preferredImagineLinkItem(post, postId) {
  const items = Array.isArray(post?.items) ? post.items : [];
  const targetPostId = String(postId || "").toLowerCase();
  const exact = items.find((item) => imaginePostIdKeysForItem(item)
    .some((key) => String(key || "").toLowerCase() === targetPostId));
  if (exact) return exact;
  return representativeItem(items, post) || post?.representative_item || items[0] || null;
}

async function openImagineLinkPost(value) {
  const rawValue = String(value || "").trim();
  const postId = imagineLinkPostIdFromValue(rawValue);
  if (!postId) {
    toastError("Enter a valid Grok Imagine post link.");
    return;
  }
  const button = document.getElementById("i_link_btn");
  const input = document.getElementById("i_link_input");
  if (button) button.disabled = true;
  if (input) input.disabled = true;
  try {
    const data = await qApi("/api/imagine/remote/link", {
      value: rawValue,
      post_id: postId,
    });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = mergeImagineLinkPosts(posts);
    const targetPost = normalized[0];
    if (!targetPost) throw new Error("Could not load the linked Imagine post.");
    const targetItem = preferredImagineLinkItem(targetPost, postId);
    setImagineTab("i_link_btn");
    library_state.iMainView = imagineViewValue("LINK", "link");
    screen_state.detail_back.imagine = {
      screenId: "i_main",
      activeButtonId: screen_state.current_i_nav_btn || "i_imagine_nav_btn",
    };
    selectLibraryPost(targetPost.folder_path);
    if (targetItem) library_state.selectedDetailItemId = mediaItemKey(targetItem);
    openScreen("i_detail", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
    setImagineLinkInputOpen(false);
  } catch (error) {
    showErrorPanel("Link failed", error?.message || "Could not open the linked Imagine post.");
  } finally {
    if (button) button.disabled = false;
    if (input) input.disabled = false;
  }
}

function imaginePostIdKeysForPost(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const flatOnly = metadata.flat_only === true;
  const representative = post?.representative_item || representativeItem(post?.items || [], post) || post?.items?.[0] || {};
  const representativeMetadata = representative?.metadata && typeof representative.metadata === "object" ? representative.metadata : {};
  const representativeImagine = representativeMetadata.imagine && typeof representativeMetadata.imagine === "object"
    ? representativeMetadata.imagine
    : {};
  return [
    post?.folder_path,
    post?.post_id,
    metadata.imagine_root_post_id,
    ...(flatOnly ? [] : [
      metadata.raw_root_post_id,
      representative?.root_post_id,
      representativeMetadata.root_post_id,
      representativeImagine.root_post_id,
    ]),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function rememberHiddenImaginePost(post) {
  if (!(library_state.imagineHiddenRemotePostIds instanceof Set)) {
    library_state.imagineHiddenRemotePostIds = new Set();
  }
  for (const key of imaginePostIdKeysForPost(post)) {
    library_state.imagineHiddenRemotePostIds.add(key);
  }
}

function forgetHiddenImaginePost(post) {
  const hidden = library_state.imagineHiddenRemotePostIds;
  if (!(hidden instanceof Set)) return;
  for (const key of imaginePostIdKeysForPost(post)) hidden.delete(key);
}

function imaginePostHidden(post) {
  const hidden = library_state.imagineHiddenRemotePostIds;
  if (!(hidden instanceof Set) || !hidden.size) return false;
  return imaginePostIdKeysForPost(post).some((key) => hidden.has(key));
}

function postUsesImagineRemoteHiddenFilter(post) {
  return Boolean(
    post?.remote
    || post?.area === "imagine_remote"
    || post?.area === "imagine_upload_remote"
    || String(post?.folder_path || "").startsWith("imagine_")
  );
}

function withoutHiddenImagineItems(post) {
  if (!post || !postUsesImagineRemoteHiddenFilter(post)) return normalizeServerPost(post);
  if (imaginePostHidden(post)) return null;
  return normalizeServerPost(post);
}

function normalizeImagineRemotePosts(posts) {
  return (posts || [])
    .map(normalizeServerPost)
    .map(withoutHiddenImagineItems)
    .filter(Boolean);
}

function normalizeImagineDiscoverPosts(posts) {
  return (posts || [])
    .map(normalizeServerPost)
    .map(withoutHiddenImagineItems)
    .filter(Boolean);
}

function normalizeImagineUnsavedPosts(posts) {
  return normalizeImagineDiscoverPosts(posts);
}

function normalizeImagineSearchPosts(posts) {
  return normalizeImagineDiscoverPosts(posts);
}

function isImagineT2iPost(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const mode = String(
    post?.mode
    || metadata.generated_action
    || metadata.mode
    || imagine.generated_action
    || imagine.mode
    || "",
  ).toLowerCase();
  return post?.source === "imagine" && mode === "t2i";
}

function isImagineT2iGroupContainer(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  return post?.t2i_group_container === true || metadata.t2i_group_container === true;
}

function isSessionImagineT2iPost(post) {
  return isImagineT2iPost(post) && library_state.sessionImagineT2iPaths?.has(post.folder_path || "");
}

function mergeImagineRemotePosts(existingPosts, nextPosts) {
  const merged = new Map();
  for (const post of existingPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  for (const post of nextPosts || []) {
    if (!post?.folder_path) continue;
    const existing = merged.get(post.folder_path);
    if (!existing) {
      merged.set(post.folder_path, post);
      continue;
    }
    const existingFlat = existing?.metadata?.flat_only === true;
    const nextFlat = post?.metadata?.flat_only === true;
    const primary = existingFlat && !nextFlat ? post : existing;
    const secondary = primary === existing ? post : existing;
    const known = new Set((primary.items || []).flatMap(imaginePostIdKeysForItem));
    const items = [...(primary.items || [])];
    for (const item of secondary.items || []) {
      const keys = imaginePostIdKeysForItem(item);
      if (keys.some((key) => known.has(key))) continue;
      items.push(item);
      for (const key of keys) known.add(key);
    }
    const representative = representativeItem(items, { ...primary, items }) || items[0];
    merged.set(post.folder_path, normalizeServerPost({
      ...primary,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
      metadata: {
        ...(primary.metadata || {}),
        flat_only: existingFlat && nextFlat,
      },
    }));
  }
  return Array.from(merged.values());
}

function imagineSavedPostMatchIndex(posts) {
  const byPath = new Map();
  const byKey = new Map();
  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    const path = String(post?.folder_path || "");
    if (path) {
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(index);
    }
    for (const key of imagineSavedPostMatchKeys(post)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(index);
    }
  }
  return { byPath, byKey };
}

function takeImagineSavedPostMatch(index, post, matchedIndexes, acceptKeyMatch = null) {
  const path = String(post?.folder_path || "");
  for (const candidateIndex of index.byPath.get(path) || []) {
    if (!matchedIndexes.has(candidateIndex)) return candidateIndex;
  }
  let matchedIndex = -1;
  for (const key of imagineSavedPostMatchKeys(post)) {
    for (const candidateIndex of index.byKey.get(key) || []) {
      if (matchedIndexes.has(candidateIndex)) continue;
      if (acceptKeyMatch && !acceptKeyMatch(candidateIndex)) continue;
      if (matchedIndex < 0 || candidateIndex < matchedIndex) matchedIndex = candidateIndex;
      break;
    }
  }
  return matchedIndex;
}

function imagineItemIsPreservedGeneratedRelation(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return Boolean(metadata.app_generated_relation || imagine.app_generated_relation);
}

function imaginePostHasPreservedGeneratedRelations(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  return Boolean(
    metadata.app_preserved_generated_relations
    || (post?.items || []).some(imagineItemIsPreservedGeneratedRelation)
  );
}

// Grok reports two different creation times for the same asset: the moment it was
// generated, and the moment it was saved. Which one arrives depends on the page and
// endpoint a refresh happens to hit. Card order is derived from these timestamps, so
// letting a later response replace an earlier one made cards jump around the list.
// Keep whichever time we already had for an asset we have seen before.
function stabilizeImagineItemTimestamps(existingPost, refreshedPost) {
  const existingItems = Array.isArray(existingPost?.items) ? existingPost.items : [];
  const refreshedItems = Array.isArray(refreshedPost?.items) ? refreshedPost.items : [];
  if (!existingItems.length || !refreshedItems.length) return refreshedPost;
  const createdByAsset = new Map();
  for (const item of existingItems) {
    const assetId = imagineSavedItemAssetId(item);
    const createdAt = String(item?.created_at || "");
    if (assetId && createdAt) createdByAsset.set(assetId, createdAt);
  }
  if (!createdByAsset.size) return refreshedPost;
  let changed = false;
  const items = refreshedItems.map((item) => {
    const assetId = imagineSavedItemAssetId(item);
    const createdAt = assetId ? createdByAsset.get(assetId) : "";
    if (!createdAt || String(item?.created_at || "") === createdAt) return item;
    changed = true;
    return { ...item, created_at: createdAt };
  });
  if (!changed) return refreshedPost;
  return normalizeServerPost({ ...refreshedPost, items });
}

function mergeImaginePreservedGeneratedRelations(existingPost, refreshedPost) {
  if (!existingPost || !refreshedPost) return refreshedPost || existingPost;
  refreshedPost = stabilizeImagineItemTimestamps(existingPost, refreshedPost);
  const preservedItems = (existingPost.items || []).filter(imagineItemIsPreservedGeneratedRelation);
  if (!preservedItems.length) return refreshedPost;
  const items = [...(refreshedPost.items || [])];
  const identityValues = (item) => new Set(
    (typeof imagineMergeItemIdentityValues === "function"
      ? imagineMergeItemIdentityValues(item)
      : [mediaItemKey(item), item?.item_id, item?.url, item?.remote_url, item?.object_url]
    ).map((value) => String(value || "")).filter(Boolean),
  );
  for (const preserved of preservedItems) {
    const preservedValues = identityValues(preserved);
    const exists = items.some((candidate) => {
      const candidateValues = identityValues(candidate);
      return [...preservedValues].some((value) => candidateValues.has(value));
    });
    if (!exists) items.push(preserved);
  }
  if (items.length === (refreshedPost.items || []).length) return refreshedPost;
  const metadata = refreshedPost?.metadata && typeof refreshedPost.metadata === "object"
    ? refreshedPost.metadata
    : {};
  return normalizeServerPost({
    ...refreshedPost,
    items,
    metadata: { ...metadata, app_preserved_generated_relations: true },
  });
}

function mergeImagineExternalRefreshedPosts(existingPosts, refreshedPosts) {
  const existingByPath = new Map(
    (existingPosts || [])
      .filter((post) => post?.folder_path)
      .map((post) => [post.folder_path, post]),
  );
  return (refreshedPosts || []).map((post) => (
    mergeImaginePreservedGeneratedRelations(existingByPath.get(post?.folder_path), post)
  ));
}

function mergeImagineRefreshedPosts(existingPosts, refreshedPosts) {
  const existing = reconcileImagineSavedDisplayPosts(existingPosts || []);
  const refreshed = reconcileImagineSavedDisplayPosts(refreshedPosts || []);
  if (!existing.length) return sortPostsIfNeeded([...refreshed], comparePostsByRecentActivity);
  if (!refreshed.length) return [];

  const existingIndex = imagineSavedPostMatchIndex(existing);
  const matchedExistingIndexes = new Set();
  const refreshedForExistingIndex = new Map();
  const newPosts = [];

  for (const post of refreshed) {
    const matchedIndex = takeImagineSavedPostMatch(
      existingIndex,
      post,
      matchedExistingIndexes,
      (index) => (
        !(
          isImagineT2iGroupContainer(post)
          && existing[index]?.metadata?.local_heart === true
        )
        && !(
          post?.metadata?.local_heart === true
          && isImagineT2iGroupContainer(existing[index])
        )
      ),
    );
    if (matchedIndex < 0) {
      newPosts.push(post);
      continue;
    }
    matchedExistingIndexes.add(matchedIndex);
    refreshedForExistingIndex.set(
      matchedIndex,
      mergeImaginePreservedGeneratedRelations(existing[matchedIndex], post),
    );
  }

  return sortPostsIfNeeded([
    ...newPosts,
    ...existing.map((post, index) => (
      refreshedForExistingIndex.get(index)
      || (imaginePostHasPreservedGeneratedRelations(post) ? post : null)
    )).filter(Boolean),
  ], comparePostsByRecentActivity);
}

function mergeImagineSyncedPosts(existingPosts, refreshedPosts, { replacesList = false } = {}) {
  const existing = reconcileImagineSavedDisplayPosts(existingPosts || []);
  const refreshed = reconcileImagineSavedDisplayPosts(refreshedPosts || []);
  if (!existing.length) return sortPostsIfNeeded([...refreshed], comparePostsByRecentActivity);
  if (!refreshed.length) {
    // A full reload that comes back empty means the account has nothing saved any more.
    if (replacesList) return [];
    return sortPostsIfNeeded([...existing], comparePostsByRecentActivity);
  }

  const existingIndex = imagineSavedPostMatchIndex(existing);
  const matchedExistingIndexes = new Set();
  const refreshedForExistingIndex = new Map();
  const newPosts = [];

  for (const post of refreshed) {
    const matchedIndex = takeImagineSavedPostMatch(
      existingIndex,
      post,
      matchedExistingIndexes,
    );
    if (matchedIndex < 0) {
      newPosts.push(post);
      continue;
    }
    matchedExistingIndexes.add(matchedIndex);
    refreshedForExistingIndex.set(
      matchedIndex,
      mergeImaginePreservedGeneratedRelations(existing[matchedIndex], post),
    );
  }

  // An unmatched card was not in this response. On a reload that starts from an empty cursor
  // the response is the authoritative head of the list, so the card is gone upstream — from a
  // delete on grok.com, or absorbed into another card — and keeping it left deletions on
  // screen until the app restarted. An append carries one page of many and proves nothing
  // about the rest, so there nothing is dropped.
  const refreshedItemIds = new Set();
  for (const post of refreshed) {
    for (const item of post?.items || []) {
      const assetId = imagineSavedItemAssetId(item);
      if (assetId) refreshedItemIds.add(assetId);
    }
  }
  const existingWasAbsorbed = (post) => {
    const items = (post?.items || []).filter(Boolean);
    return items.length > 0 && items.every((item) => {
      const assetId = imagineSavedItemAssetId(item);
      return Boolean(assetId) && refreshedItemIds.has(assetId);
    });
  };
  const keepUnmatched = (post) => (replacesList ? false : !existingWasAbsorbed(post));

  return sortPostsIfNeeded([
    ...newPosts,
    ...existing
      .map((post, index) => (
        refreshedForExistingIndex.get(index)
        || (keepUnmatched(post) ? post : null)
      ))
      .filter(Boolean),
  ], comparePostsByRecentActivity);
}

function imagineSavedItemAssetId(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return String(
    item?.asset_id
    || metadata.asset_id
    || imagine.asset_id
    || item?.item_id
    || item?.post_id
    || imagine.post_id
    || "",
  ).trim();
}

function imagineSavedItemSourceIds(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return [
    item?.source_item_id,
    item?.parent_post_id,
    item?.original_post_id,
    metadata.source_item_id,
    metadata.parent_post_id,
    metadata.original_post_id,
    imagine.source_item_id,
    imagine.parent_post_id,
    imagine.original_post_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function imagineSavedItemSourceId(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return String(
    item?.source_item_id
    || item?.parent_post_id
    || item?.original_post_id
    || metadata.source_item_id
    || metadata.parent_post_id
    || metadata.original_post_id
    || imagine.source_item_id
    || imagine.parent_post_id
    || imagine.original_post_id
    || "",
  ).trim();
}

function imagineSavedItemIsSource(item) {
  const role = String(item?.role || item?.relation || "").trim().toLowerCase();
  return role === "source" || role === "upload";
}


function imagineSavedItemIsUploadSource(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const role = String(item?.role || metadata.role || imagine.role || "").trim().toLowerCase();
  const relation = String(item?.relation || metadata.relation || imagine.relation || "").trim().toLowerCase();
  return Boolean(
    item?.official_upload_source
    || metadata.official_upload_source
    || imagine.official_upload_source
    || role === "source"
    || role === "upload"
    || relation === "upload"
  );
}

function imagineUploadOriginBundleCard(post, items) {
  if (!post || !items.length) return null;
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const sourceItem = items.find(imagineSavedItemIsUploadSource);
  const generatedItems = items.filter((item) => !imagineSavedItemIsUploadSource(item));
  if (!generatedItems.length || (!sourceItem && metadata.upload_origin_bundle !== true)) return null;
  const conversationId = String(
    metadata.conversation_id
    || generatedItems.map((item) => {
      const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object" ? itemMetadata.imagine : {};
      return item?.conversation_id || itemMetadata.conversation_id || itemImagine.conversation_id || item?.root_post_id || "";
    }).find(Boolean)
    || post.post_id
    || "",
  ).trim();
  if (!conversationId) return null;
  const representative = representativeItem(generatedItems, { ...post, items: generatedItems }) || generatedItems[generatedItems.length - 1];
  return normalizeServerPost({
    ...post,
    post_id: conversationId,
    mode: "saved",
    area: "imagine_remote",
    folder_path: `imagine_saved/${conversationId}`,
    representative: representative?.url || representative?.remote_url || representative?.item_id || "",
    representative_item: representative,
    items,
    t2i_group_container: false,
    metadata: {
      ...metadata,
      imagine_root_post_id: conversationId,
      raw_root_post_id: conversationId,
      conversation_id: conversationId,
      saved_content_view: "conversations",
      flat_only: false,
      grouped: true,
      t2i_group_container: false,
      upload_origin_bundle: true,
      upload_source_asset_id: String(
        metadata.upload_source_asset_id
        || imagineSavedItemAssetId(sourceItem)
        || "",
      ),
      lineage_root_asset_id: conversationId,
      lineage_source_post_id: conversationId,
    },
  });
}

function imagineSavedLineageCards(post) {
  if (!post) return [];
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const items = (post.items || []).filter((item) => imagineSavedItemAssetId(item));
  if (!items.length) return [post];
  const uploadBundle = imagineUploadOriginBundleCard(post, items);
  if (uploadBundle) return [uploadBundle];
  // Mirrors imagine_saved_lineage_cards: a link-sourced post is one grok.com conversation
  // and the site shows it as one grouped card, so leave it whole instead of splitting the
  // parent chain. Everything else, T2I batches included, still fans out below.
  const linkSourced = Boolean(metadata.link_source || post.link_source || metadata.remote_view === "link");
  if (linkSourced) return [post];

  const itemsById = new Map(items.map((item) => [imagineSavedItemAssetId(item), item]));
  const resultItems = items.filter((item) => !imagineSavedItemIsSource(item));
  const lineageItems = resultItems.length ? resultItems : items;
  const resultIds = new Set(lineageItems.map(imagineSavedItemAssetId));
  const rootById = new Map();
  for (const item of lineageItems) {
    const itemId = imagineSavedItemAssetId(item);
    let currentId = itemId;
    const seen = new Set();
    while (resultIds.has(currentId) && !seen.has(currentId)) {
      seen.add(currentId);
      const parentId = imagineSavedItemSourceId(itemsById.get(currentId));
      if (!resultIds.has(parentId)) break;
      currentId = parentId;
    }
    rootById.set(itemId, currentId);
  }
  const rootIds = lineageItems
    .map(imagineSavedItemAssetId)
    .filter((itemId) => rootById.get(itemId) === itemId);
  if (!rootIds.length) return [post];

  return rootIds.map((rootId) => {
    const memberIds = new Set(
      Array.from(rootById.entries())
        .filter(([, candidateRootId]) => candidateRootId === rootId)
        .map(([itemId]) => itemId),
    );
    const ancestorIds = new Set();
    const pendingIds = Array.from(memberIds);
    while (pendingIds.length) {
      const currentId = pendingIds.pop();
      const parentId = imagineSavedItemSourceId(itemsById.get(currentId));
      if (
        parentId
        && itemsById.has(parentId)
        && !memberIds.has(parentId)
        && !ancestorIds.has(parentId)
      ) {
        ancestorIds.add(parentId);
        pendingIds.push(parentId);
      }
    }
    const cardItems = items.filter((item) => {
      const itemId = imagineSavedItemAssetId(item);
      return memberIds.has(itemId) || ancestorIds.has(itemId);
    });
    const rootItem = cardItems.find((item) => imagineSavedItemAssetId(item) === rootId) || cardItems[0];
    const rootMetadata = rootItem?.metadata && typeof rootItem.metadata === "object" ? rootItem.metadata : {};
    const rootImagine = rootMetadata.imagine && typeof rootMetadata.imagine === "object" ? rootMetadata.imagine : {};
    const conversationId = String(
      rootItem?.conversation_id
      || rootMetadata.conversation_id
      || rootImagine.conversation_id
      || metadata.conversation_id
      || "",
    ).trim();
    const representative = representativeItem(cardItems, { ...post, items: cardItems }) || rootItem;
    const title = String(
      rootItem?.title
      || rootItem?.prompt
      || post.title
      || "Imagine",
    ).trim().split(/\r?\n/, 1)[0].slice(0, 80);
    return normalizeServerPost({
      ...post,
      post_id: rootId,
      mode: "saved",
      title: title || "Imagine",
      prompt: String(rootItem?.prompt || post.prompt || ""),
      created_at: String(rootItem?.created_at || post.created_at || ""),
      folder_path: `imagine_saved/${rootId}`,
      folderName: title || rootId,
      representative: representative?.url || representative?.remote_url || representative?.item_id || "",
      representative_item: representative,
      items: cardItems,
      t2i_group_container: false,
      metadata: {
        ...metadata,
        imagine_root_post_id: rootId,
        raw_root_post_id: rootId,
        conversation_id: conversationId,
        saved_content_view: "assets",
        flat_only: true,
        grouped: false,
        t2i_group_container: false,
        lineage_root_asset_id: rootId,
        lineage_source_post_id: String(post.post_id || ""),
      },
    });
  });
}

function mergeImagineSavedLineageCards(cards) {
  const active = (cards || []).filter(Boolean).map((card) => normalizeServerPost({
    ...card,
    items: [...(card.items || [])],
    metadata: { ...(card.metadata || {}) },
  }));
  if (active.length < 2) return active;

  const rootIds = [];
  const rootOwnerById = new Map();
  active.forEach((card, index) => {
    const rootId = String(
      card?.metadata?.lineage_root_asset_id
      || card?.post_id
      || "",
    ).trim();
    rootIds.push(rootId);
    if (rootId && !rootOwnerById.has(rootId)) rootOwnerById.set(rootId, index);
  });

  const ownerByItemId = new Map(rootOwnerById);
  const sourceOwnerById = new Map();
  const uploadBundleOwnerByItemId = new Map();
  active.forEach((card, index) => {
    for (const item of card.items || []) {
      const itemId = imagineSavedItemAssetId(item);
      if (card?.metadata?.upload_origin_bundle === true && itemId && !uploadBundleOwnerByItemId.has(itemId)) {
        uploadBundleOwnerByItemId.set(itemId, index);
      }
      if (imagineSavedItemIsSource(item)) {
        if (itemId && !sourceOwnerById.has(itemId)) sourceOwnerById.set(itemId, index);
        continue;
      }
      if (itemId && !ownerByItemId.has(itemId)) ownerByItemId.set(itemId, index);
    }
  });

  const parentIndexes = active.map((_, index) => index);
  active.forEach((candidate, index) => {
    const rootId = rootIds[index];
    const duplicateOwner = rootId ? rootOwnerById.get(rootId) : undefined;
    if (duplicateOwner !== undefined && duplicateOwner !== index) {
      parentIndexes[index] = duplicateOwner;
      return;
    }
    if (candidate?.metadata?.upload_origin_bundle !== true) {
      const uploadBundleOwner = (candidate.items || [])
        .map((item) => uploadBundleOwnerByItemId.get(imagineSavedItemAssetId(item)))
        .find((owner) => owner !== undefined);
      if (uploadBundleOwner !== undefined && uploadBundleOwner !== index) {
        parentIndexes[index] = uploadBundleOwner;
        return;
      }
    }
    const rootItem = (candidate.items || [])
      .find((item) => imagineSavedItemAssetId(item) === rootId);
    const parentId = imagineSavedItemSourceId(rootItem);
    const parentOwner = ownerByItemId.get(parentId) ?? sourceOwnerById.get(parentId);
    if (parentId && parentOwner !== undefined && parentOwner !== index) {
      parentIndexes[index] = parentOwner;
      return;
    }
    // clone-batch copies an asset but leaves the original owner's id as its parent, so a
    // cloned pair arrives with the chain cut: the video points at a foreign image this
    // account does not own and no owner matches. Grok still filed both under one generation
    // root, so fall back to that only when the parent is unreachable. This mirrors
    // merge_imagine_saved_lineage_cards on the server, which reruns the same grouping.
    if (parentId && parentOwner === undefined) {
      const generationRootId = String(candidate?.metadata?.root_generation_asset_id || "").trim();
      const generationOwner = ownerByItemId.get(generationRootId)
        ?? sourceOwnerById.get(generationRootId);
      if (generationRootId && generationOwner !== undefined && generationOwner !== index) {
        parentIndexes[index] = generationOwner;
      }
    }
  });

  const resolvedRoots = new Map();
  for (let startIndex = 0; startIndex < active.length; startIndex += 1) {
    if (resolvedRoots.has(startIndex)) continue;
    const path = [];
    const positions = new Map();
    let currentIndex = startIndex;
    while (
      !resolvedRoots.has(currentIndex)
      && parentIndexes[currentIndex] !== currentIndex
      && !positions.has(currentIndex)
    ) {
      positions.set(currentIndex, path.length);
      path.push(currentIndex);
      currentIndex = parentIndexes[currentIndex];
    }
    let rootIndex;
    if (resolvedRoots.has(currentIndex)) {
      rootIndex = resolvedRoots.get(currentIndex);
    } else if (positions.has(currentIndex)) {
      rootIndex = Math.min(...path.slice(positions.get(currentIndex)));
    } else {
      rootIndex = currentIndex;
    }
    resolvedRoots.set(currentIndex, rootIndex);
    for (let pathIndex = path.length - 1; pathIndex >= 0; pathIndex -= 1) {
      resolvedRoots.set(path[pathIndex], rootIndex);
    }
  }

  const membersByRoot = new Map();
  active.forEach((_, index) => {
    const rootIndex = resolvedRoots.get(index) ?? index;
    if (!membersByRoot.has(rootIndex)) membersByRoot.set(rootIndex, []);
    membersByRoot.get(rootIndex).push(index);
  });

  return Array.from(membersByRoot.keys()).sort((left, right) => left - right).map((rootIndex) => {
    const memberIndexes = membersByRoot.get(rootIndex);
    const anchor = active[rootIndex];
    if (memberIndexes.length === 1) return anchor;
    const knownItemIds = new Set();
    const items = [];
    const orderedIndexes = [
      rootIndex,
      ...memberIndexes.filter((index) => index !== rootIndex),
    ];
    for (const memberIndex of orderedIndexes) {
      for (const item of active[memberIndex].items || []) {
        const itemId = imagineSavedItemAssetId(item);
        if (itemId && knownItemIds.has(itemId)) continue;
        items.push(item);
        if (itemId) knownItemIds.add(itemId);
      }
    }
    const representative = representativeItem(items, { ...anchor, items }) || items[0];
    return normalizeServerPost({
      ...anchor,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  });
}

function reconcileImagineSavedDisplayPosts(posts) {
  return mergeImagineSavedLineageCards(
    mergeImagineRemotePosts(
      [],
      (posts || []).flatMap(imagineSavedLineageCards),
    ),
  );
}

const IMAGINE_PENDING_SAVED_STORAGE_PREFIX = "grok-chameleon:imagine-pending-saved:";
let imaginePendingSavedRefreshTimer = 0;
let imaginePendingSavedRefreshAttempt = 0;

function imaginePendingSavedAccountId() {
  return String(activeImagineSavedAccount()?.id || account_state.imagine?.active_id || "").trim();
}

function imaginePendingSavedStorageKey() {
  const accountId = imaginePendingSavedAccountId();
  return accountId ? `${IMAGINE_PENDING_SAVED_STORAGE_PREFIX}${accountId}` : "";
}

function imagineSavedPostIsPending(post) {
  return post?.metadata?.saved_sync_pending === true;
}

function imaginePendingSavedPosts() {
  return (library_state.imagineRemotePosts || []).filter(imagineSavedPostIsPending);
}

function persistImaginePendingSavedPosts() {
  const storageKey = imaginePendingSavedStorageKey();
  if (!storageKey) return;
  const pending = imaginePendingSavedPosts();
  try {
    if (pending.length) localStorage.setItem(storageKey, JSON.stringify(pending));
    else localStorage.removeItem(storageKey);
  } catch {
    // Pending cards remain available in memory when storage is unavailable.
  }
}

function restoreImaginePendingSavedPosts() {
  const storageKey = imaginePendingSavedStorageKey();
  if (!storageKey) return [];
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(stored) ? normalizeImagineRemotePosts(stored).filter(imagineSavedPostIsPending) : [];
  } catch {
    return [];
  }
}

function imagineSavedPostMatchKeys(post) {
  const keys = new Set(imaginePostIdKeysForPost(post).map((value) => String(value || "").trim()).filter(Boolean));
  for (const item of post?.items || []) {
    for (const key of imaginePostIdKeysForItem(item)) keys.add(String(key || "").trim());
  }
  return keys;
}

function imaginePendingSavedExpectedKeys(post) {
  const entries = Array.isArray(post?.metadata?.saved_sync_items) ? post.metadata.saved_sync_items : [];
  return entries.map((entry) => new Set([
    entry?.liked_id,
    entry?.media_url,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function reconcileImaginePendingSavedPosts(remotePosts, memoryPending = []) {
  const pendingByPath = new Map();
  for (const post of [...restoreImaginePendingSavedPosts(), ...memoryPending]) {
    if (post?.folder_path && imagineSavedPostIsPending(post)) pendingByPath.set(post.folder_path, post);
  }
  if (!pendingByPath.size) return remotePosts;
  const remoteWithKeys = (remotePosts || []).map((post) => ({
    post,
    keys: imagineSavedPostMatchKeys(post),
  }));
  const unresolved = [];
  for (const pending of pendingByPath.values()) {
    const expected = imaginePendingSavedExpectedKeys(pending);
    const confirmed = expected.length > 0 && expected.every((candidateKeys) => (
      Array.from(candidateKeys).some((key) => remoteWithKeys.some((entry) => entry.keys.has(key)))
    ));
    if (!confirmed) unresolved.push(pending);
  }
  if (!unresolved.length) return remotePosts;
  const unresolvedKeys = new Set(unresolved.flatMap((post) => (
    imaginePendingSavedExpectedKeys(post).flatMap((keys) => Array.from(keys))
  )));
  const withoutPartialDuplicates = remoteWithKeys
    .filter((entry) => !Array.from(entry.keys).some((key) => unresolvedKeys.has(key)))
    .map((entry) => entry.post);
  return [...unresolved, ...withoutPartialDuplicates];
}

function scheduleImaginePendingSavedRefresh() {
  if (imaginePendingSavedRefreshTimer || !imaginePendingSavedPosts().length) return;
  const delays = [1500, 4000, 10000, 30000];
  if (imaginePendingSavedRefreshAttempt >= delays.length) return;
  const delay = delays[imaginePendingSavedRefreshAttempt];
  imaginePendingSavedRefreshAttempt += 1;
  imaginePendingSavedRefreshTimer = window.setTimeout(() => {
    imaginePendingSavedRefreshTimer = 0;
    loadImagineSavedCards({ force: true }).catch(() => {});
  }, delay);
}

function beginImaginePendingSavedRefresh() {
  if (imaginePendingSavedRefreshTimer) {
    window.clearTimeout(imaginePendingSavedRefreshTimer);
    imaginePendingSavedRefreshTimer = 0;
  }
  imaginePendingSavedRefreshAttempt = 0;
}

function newImagineSavedSyncToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cancelScheduledImagineSavedSync() {
  const hadTimer = Boolean(library_state.imagineRemoteSyncTimer);
  if (hadTimer) {
    window.clearTimeout(library_state.imagineRemoteSyncTimer);
    library_state.imagineRemoteSyncTimer = 0;
  }
  library_state.imagineRemoteSyncTimerResolve?.();
  library_state.imagineRemoteSyncTimerResolve = null;
  if (hadTimer) library_state.imagineRemoteSyncing = false;
}

function invalidateImagineSavedRequestsForDelete() {
  const controller = library_state.imagineRemoteRequestController;
  controller?.abort?.();
  library_state.imagineRemoteRequestEpoch = Number(
    library_state.imagineRemoteRequestEpoch || 0,
  ) + 1;
  if (library_state.imagineRemoteRequestController === controller) {
    library_state.imagineRemoteRequestController = null;
  }
  cancelScheduledImagineSavedSync();
  library_state.imagineRemoteLoading = false;
  library_state.imagineRemoteSyncing = false;
  library_state.imagineRemoteSyncPromise = null;
}

function beginImagineSavedRequest({ supersede = false } = {}) {
  if (supersede) {
    library_state.imagineRemoteRequestController?.abort?.();
    cancelScheduledImagineSavedSync();
    library_state.imagineRemoteLoading = false;
    library_state.imagineRemoteSyncing = false;
    library_state.imagineRemoteSyncPromise = null;
  }
  const accountId = imaginePendingSavedAccountId();
  if (!accountId) return null;
  const controller = new AbortController();
  const context = {
    accountId,
    epoch: Number(library_state.imagineRemoteRequestEpoch || 0),
    controller,
  };
  library_state.imagineRemoteAccountId = accountId;
  library_state.imagineRemoteRequestController = controller;
  return context;
}

function imagineSavedRequestIsCurrent(context) {
  return Boolean(
    context
    && !context.controller.signal.aborted
    && Number(library_state.imagineRemoteRequestEpoch || 0) === context.epoch
    && String(library_state.imagineRemoteAccountId || "") === context.accountId
    && imaginePendingSavedAccountId() === context.accountId
  );
}

function imagineSavedResponseMatches(context, data) {
  const responseAccountId = String(data?.imagine?.id || "");
  return imagineSavedRequestIsCurrent(context)
    && (!responseAccountId || responseAccountId === context.accountId);
}

function imagineSavedRequestCancelled(error, context) {
  return error?.name === "AbortError" || !imagineSavedRequestIsCurrent(context);
}

function imagineAccountResponseIsCurrent(accountId, epoch, data = null) {
  const responseAccountId = String(data?.imagine?.id || "");
  return Boolean(
    accountId
    && Number(library_state.imagineRemoteRequestEpoch || 0) === epoch
    && imaginePendingSavedAccountId() === accountId
    && (!responseAccountId || responseAccountId === accountId)
  );
}

function finishImagineSavedRequest(context) {
  if (library_state.imagineRemoteRequestController === context?.controller) {
    library_state.imagineRemoteRequestController = null;
  }
}

function applyImagineSavedRemotePage(data, { updatePosts = true, replacesList = false } = {}) {
  if (updatePosts) {
    const normalized = normalizeImagineRemotePosts(
      Array.isArray(data.posts) ? data.posts : [],
    );
    const pending = [
      ...restoreImaginePendingSavedPosts(),
      ...imaginePendingSavedPosts(),
    ];
    const currentPosts = (library_state.imagineRemotePosts || [])
      .filter((post) => !imagineSavedPostIsPending(post));
    library_state.imagineRemotePosts = reconcileImagineSavedDisplayPosts(
      reconcileImaginePendingSavedPosts(
        mergeImagineSyncedPosts(currentPosts, normalized, { replacesList }),
        pending,
      ),
    );
  }
  library_state.imagineRemoteCursor = String(data.next_cursor || "");
  library_state.imagineRemoteSyncToken = String(
    data.sync_token || library_state.imagineRemoteSyncToken || "",
  );
}

async function syncImagineSavedCards(
  context,
  {
    append = false,
    force = false,
    showLoading = false,
    updatePosts = true,
  } = {},
) {
  if (!imagineSavedRequestIsCurrent(context) || !canLoadImagineSavedList()) return;
  library_state.imagineRemoteSyncing = true;
  if (showLoading) library_state.imagineRemoteLoading = true;
  try {
    if (!append || force || !library_state.imagineRemoteSyncToken) {
      library_state.imagineRemoteSyncToken = newImagineSavedSyncToken();
    }
    const data = await qApi("/api/imagine/saved", {
      account_id: context.accountId,
      limit: 20,
      cursor: force ? "" : (append ? (library_state.imagineRemoteCursor || "") : ""),
      sync_token: library_state.imagineRemoteSyncToken,
    }, { signal: context.controller.signal });
    if (!imagineSavedResponseMatches(context, data)) return;
    // A request that starts from an empty cursor answers with the whole first page, so
    // anything the list still holds from that range is gone upstream. Only then may the
    // merge drop it; an append is one page of many and says nothing about the rest.
    applyImagineSavedRemotePage(data, { updatePosts, replacesList: !append });
    library_state.imagineRemoteError = "";
  } catch (error) {
    if (!imagineSavedRequestCancelled(error, context) && !library_state.imagineRemotePosts.length) {
      library_state.imagineRemoteError = error?.message || "Imagine saved list failed.";
    }
  } finally {
    if (imagineSavedRequestIsCurrent(context)) {
      library_state.imagineRemoteSyncing = false;
      library_state.imagineRemoteLoading = false;
      library_state.imagineRemoteLoaded = true;
      library_state.imagineRemoteHasMore = Boolean(
        library_state.imagineRemoteCacheHasMore
        || library_state.imagineRemoteCursor,
      );
      persistImaginePendingSavedPosts();
      if (imaginePendingSavedPosts().length) scheduleImaginePendingSavedRefresh();
      else imaginePendingSavedRefreshAttempt = 0;
      library_state.imagineRemoteSyncPromise = null;
      if (updatePosts) renderImagineSourceCards();
    }
    finishImagineSavedRequest(context);
  }
}

function scheduleImagineSavedSync(context) {
  cancelScheduledImagineSavedSync();
  library_state.imagineRemoteSyncing = true;
  const syncPromise = new Promise((resolve) => {
    library_state.imagineRemoteSyncTimerResolve = resolve;
    library_state.imagineRemoteSyncTimer = window.setTimeout(() => {
      library_state.imagineRemoteSyncTimer = 0;
      library_state.imagineRemoteSyncTimerResolve = null;
      if (!imagineSavedRequestIsCurrent(context) || !canLoadImagineSavedList()) {
        library_state.imagineRemoteSyncing = false;
        finishImagineSavedRequest(context);
        resolve();
        return;
      }
      Promise.resolve(
        syncImagineSavedCards(context, {
          append: false,
          force: false,
          showLoading: false,
          updatePosts: false,
        }),
      ).then(resolve, resolve);
    }, IMAGINE_SAVED_BACKGROUND_SYNC_DELAY_MS);
  });
  library_state.imagineRemoteSyncPromise = syncPromise;
  return syncPromise;
}

async function loadImagineSavedCards({ force = false, append = false } = {}) {
  if (force && (library_state.imagineRemoteLoading || library_state.imagineRemoteSyncing)) {
    library_state.imagineRemoteRequestController?.abort?.();
    cancelScheduledImagineSavedSync();
    library_state.imagineRemoteLoading = false;
    library_state.imagineRemoteSyncing = false;
    library_state.imagineRemoteSyncPromise = null;
  }
  if (library_state.imagineRemoteLoading || library_state.imagineRemoteSyncing) {
    return library_state.imagineRemoteSyncPromise || undefined;
  }
  if (!force && !append && library_state.imagineRemoteLoaded) return;
  if (
    append
    && !library_state.imagineRemoteCacheHasMore
    && !library_state.imagineRemoteCursor
  ) return;
  if (!canLoadImagineSavedCache()) return;
  const context = beginImagineSavedRequest({ supersede: force });
  if (!context) return;
  const restoredPending = restoreImaginePendingSavedPosts();
  if (restoredPending.length) {
    library_state.imagineRemotePosts = mergeImagineRemotePosts(
      restoredPending,
      (library_state.imagineRemotePosts || []).filter((post) => !imagineSavedPostIsPending(post)),
    );
  }
  library_state.imagineRemoteLoading = true;
  library_state.imagineRemoteError = "";
  renderImagineSourceCards();
  let loadError = null;
  let loadedCachePage = false;
  let cachedPostCount = 0;
  try {
    const shouldLoadCache = (
      (append && library_state.imagineRemoteCacheHasMore)
      || (!append && !force && !library_state.imagineRemoteCacheLoaded)
    );
    if (shouldLoadCache) {
      try {
        const cacheData = await qApi("/api/imagine/saved/cache", {
          account_id: context.accountId,
          limit: 5000,
          offset: append ? library_state.imagineRemoteCacheOffset : 0,
        }, { signal: context.controller.signal });
        if (!imagineSavedResponseMatches(context, cacheData)) return;
        const cachedPosts = normalizeImagineRemotePosts(
          Array.isArray(cacheData.posts) ? cacheData.posts : [],
        );
        cachedPostCount = cachedPosts.length;
        const currentPosts = (library_state.imagineRemotePosts || [])
          .filter((post) => !imagineSavedPostIsPending(post));
        const pending = [
          ...restoreImaginePendingSavedPosts(),
          ...imaginePendingSavedPosts(),
        ];
        library_state.imagineRemotePosts = reconcileImagineSavedDisplayPosts(
          reconcileImaginePendingSavedPosts(
            mergeImagineSyncedPosts(currentPosts, cachedPosts),
            pending,
          ),
        );
        library_state.imagineRemoteCacheLoaded = true;
        library_state.imagineRemoteCacheOffset = Number(
          cacheData.next_offset || cachedPosts.length,
        );
        library_state.imagineRemoteCacheHasMore = Boolean(cacheData.has_more);
        loadedCachePage = true;
      } catch (error) {
        if (imagineSavedRequestCancelled(error, context)) return;
        loadError = error;
        library_state.imagineRemoteCacheLoaded = true;
        library_state.imagineRemoteCacheHasMore = false;
      }
    }

    library_state.imagineRemoteHasMore = Boolean(
      library_state.imagineRemoteCacheHasMore
      || library_state.imagineRemoteCursor,
    );
    library_state.imagineRemoteLoaded = true;
    const cachePageCompletedAppend = append && loadedCachePage && cachedPostCount > 0;
    if (cachePageCompletedAppend || !canLoadImagineSavedList()) {
      library_state.imagineRemoteLoading = false;
      if (loadError && !library_state.imagineRemotePosts.length) {
        library_state.imagineRemoteError = loadError?.message || "Imagine saved list failed.";
      }
      persistImaginePendingSavedPosts();
      finishImagineSavedRequest(context);
      renderImagineSourceCards();
      return;
    }

    const hasCachedCards = library_state.imagineRemotePosts.some(
      (post) => !imagineSavedPostIsPending(post),
    );
    const backgroundSync = !force && !append && hasCachedCards;
    if (backgroundSync) {
      library_state.imagineRemoteLoading = false;
      renderImagineSourceCards();
      const syncPromise = scheduleImagineSavedSync(context);
      syncPromise.catch(() => {});
      return;
    }

    await syncImagineSavedCards(context, { append, force, showLoading: true });
  } finally {
    if (
      imagineSavedRequestIsCurrent(context)
      && !library_state.imagineRemoteSyncing
      && library_state.imagineRemoteRequestController === context.controller
    ) {
      library_state.imagineRemoteLoading = false;
      finishImagineSavedRequest(context);
      renderImagineSourceCards();
    }
  }
}

function maybeLoadMoreImagineSavedCards() {
  const list = document.querySelector(".i_card_list");
  if (!list) return;
  if (library_state.iMainView !== imagineViewValue("IMAGINE", "imagine")) return;
  if (!library_state.imagineRemoteLoaded || !library_state.imagineRemoteHasMore) return;
  if (library_state.imagineRemoteLoading || library_state.imagineRemoteSyncing) return;
  const remaining = virtualCardListRemaining(list);
  if (remaining > virtualCardListPrefetchDistance(list, 1.5, 480)) return;
  loadImagineSavedCards({ append: true }).catch((error) => {
    library_state.imagineRemoteError = error?.message || "Imagine saved list failed.";
    library_state.imagineRemoteLoading = false;
    renderImagineSourceCards();
  });
}

function maybeLoadMoreImagineUploadCards() {
  const list = document.querySelector(".i_card_list");
  if (!list) return;
  if (library_state.iMainView !== imagineViewValue("UPLOAD", "upload")) return;
  if (!library_state.imagineUploadLoaded || !library_state.imagineUploadHasMore) return;
  if (library_state.imagineUploadLoading) return;
  const remaining = virtualCardListRemaining(list);
  if (remaining > virtualCardListPrefetchDistance(list, 1.5, 480)) return;
  loadImagineUploadCards({ append: true }).catch((error) => {
    library_state.imagineUploadError = error?.message || "Imagine uploads failed.";
    library_state.imagineUploadLoading = false;
    renderImagineSourceCards();
  });
}

function mergeImagineDiscoverPosts(existingPosts, nextPosts) {
  const merged = new Map();
  for (const post of existingPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  for (const post of nextPosts || []) {
    if (post?.folder_path) {
      merged.set(
        post.folder_path,
        mergeImaginePreservedGeneratedRelations(merged.get(post.folder_path), post),
      );
    }
  }
  return Array.from(merged.values());
}

function mergeImagineDiscoverRefreshedPosts(existingPosts, refreshedPosts) {
  const existingByPath = new Map(
    (existingPosts || [])
      .filter((post) => post?.folder_path)
      .map((post) => [post.folder_path, post]),
  );
  const refreshed = (refreshedPosts || []).map((post) => (
    mergeImaginePreservedGeneratedRelations(existingByPath.get(post?.folder_path), post)
  ));
  const refreshedPaths = new Set(refreshed.map((post) => String(post?.folder_path || "")).filter(Boolean));
  return [
    ...refreshed,
    ...(existingPosts || []).filter((post) => !refreshedPaths.has(String(post?.folder_path || ""))),
  ];
}

function mergeImagineUnsavedPosts(existingPosts, nextPosts) {
  const merged = new Map();
  for (const post of existingPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  for (const post of nextPosts || []) {
    if (post?.folder_path) {
      merged.set(
        post.folder_path,
        mergeImaginePreservedGeneratedRelations(merged.get(post.folder_path), post),
      );
    }
  }
  return Array.from(merged.values());
}

async function loadImagineDiscoverCacheCards() {
  if (library_state.imagineDiscoverCacheLoaded || library_state.imagineDiscoverCacheLoading) return;
  if (!canLoadImagineSavedCache()) return;
  const accountId = imaginePendingSavedAccountId();
  const requestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0);
  if (!accountId) return;
  library_state.imagineDiscoverCacheLoading = true;
  renderImagineDiscoverCards();
  try {
    const data = await qApi("/api/imagine/discover/cache", {
      account_id: accountId,
      limit: 5000,
    });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    const cachedPosts = normalizeImagineDiscoverPosts(Array.isArray(data.posts) ? data.posts : []);
    if (cachedPosts.length) library_state.imagineDiscoverPosts = cachedPosts;
    library_state.imagineDiscoverCursor = String(data.next_cursor || "");
    library_state.imagineDiscoverHasMore = Boolean(data.has_more && library_state.imagineDiscoverCursor);
  } catch (_) {
    // An empty or unavailable cache falls through to the live Discover refresh.
  } finally {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineDiscoverCacheLoaded = true;
      library_state.imagineDiscoverCacheLoading = false;
      renderImagineDiscoverCards();
    }
  }
}

async function loadImagineDiscoverCards({ force = false, append = false } = {}) {
  if (library_state.imagineDiscoverLoading) return;
  if (!force && !append && library_state.imagineDiscoverLoaded) return;
  if (append && !library_state.imagineDiscoverCursor) return;
  if (!canLoadImagineSavedList()) return;
  const accountId = imaginePendingSavedAccountId();
  const requestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0);
  if (!accountId) return;
  library_state.imagineDiscoverLoading = true;
  library_state.imagineDiscoverError = "";
  let backgroundCacheToken = "";
  renderImagineDiscoverCards();
  try {
    const data = await qApi("/api/imagine/discover", {
      account_id: accountId,
      limit: 60,
      cursor: force ? "" : (append ? (library_state.imagineDiscoverCursor || "") : ""),
      media_type: "video",
    });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = normalizeImagineDiscoverPosts(posts);
    library_state.imagineDiscoverPosts = append && !force
      ? mergeImagineDiscoverPosts(library_state.imagineDiscoverPosts || [], normalized)
      : mergeImagineDiscoverRefreshedPosts(library_state.imagineDiscoverPosts || [], normalized);
    library_state.imagineDiscoverCursor = String(data.next_cursor || "");
    library_state.imagineDiscoverHasMore = Boolean(data.has_more && library_state.imagineDiscoverCursor);
    library_state.imagineDiscoverLoaded = true;
    backgroundCacheToken = String(data.background_cache_token || "");
  } catch (error) {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineDiscoverError = error?.message || "Imagine Discover list failed.";
    }
  } finally {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineDiscoverLoading = false;
      renderImagineDiscoverCards();
    }
  }
  if (backgroundCacheToken && imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
    scheduleImagineDiscoverBackgroundSourceCache(backgroundCacheToken, accountId);
  }
}

function scheduleImagineDiscoverBackgroundSourceCache(token, accountId) {
  const start = () => {
    qApi("/api/imagine/discover/cache-sources", {
      token,
      account_id: accountId,
    }).catch(() => {});
  };
  const afterPaint = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start, { timeout: 2000 });
    } else {
      window.setTimeout(start, 250);
    }
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(afterPaint));
}

async function loadImagineUnsavedCards({ force = false, append = false } = {}) {
  if (library_state.imagineUnsavedLoading) return;
  if (!force && !append && library_state.imagineUnsavedLoaded) return;
  if (append && !library_state.imagineUnsavedCursor) return;
  if (!canLoadImagineSavedList()) return;
  const accountId = imaginePendingSavedAccountId();
  const requestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0);
  if (!accountId) return;
  library_state.imagineUnsavedLoading = true;
  library_state.imagineUnsavedError = "";
  renderImagineUnsavedCards();
  try {
    const data = await qApi("/api/imagine/unsaved", {
      account_id: accountId,
      limit: 20,
      cursor: force ? "" : (append ? (library_state.imagineUnsavedCursor || "") : ""),
    });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = normalizeImagineUnsavedPosts(posts);
    library_state.imagineUnsavedPosts = append && !force
      ? mergeImagineUnsavedPosts(library_state.imagineUnsavedPosts || [], normalized)
      : mergeImagineExternalRefreshedPosts(library_state.imagineUnsavedPosts || [], normalized);
    library_state.imagineUnsavedCursor = String(data.next_cursor || "");
    library_state.imagineUnsavedHasMore = Boolean(data.has_more && library_state.imagineUnsavedCursor);
    library_state.imagineUnsavedLoaded = true;
  } catch (error) {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineUnsavedError = error?.message || "Imagine Unsaved list failed.";
    }
  } finally {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineUnsavedLoading = false;
      renderImagineUnsavedCards();
    }
  }
}

async function loadImagineUploadCards({ force = false, append = false } = {}) {
  if (library_state.imagineUploadLoading) return;
  if (!force && !append && library_state.imagineUploadLoaded) return;
  if (append && !library_state.imagineUploadCursor) return;
  if (!canLoadImagineSavedList()) return;
  const accountId = imaginePendingSavedAccountId();
  const requestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0);
  if (!accountId) return;
  library_state.imagineUploadLoading = true;
  library_state.imagineUploadError = "";
  renderImagineSourceCards();
  try {
    const data = await qApi("/api/imagine/uploads", {
      account_id: accountId,
      limit: 50,
      cursor: force ? "" : (append ? (library_state.imagineUploadCursor || "") : ""),
    });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    const posts = (Array.isArray(data.posts) ? data.posts : []).map(normalizeServerPost);
    library_state.imagineUploadPosts = append && !force
      ? mergeImagineUnsavedPosts(library_state.imagineUploadPosts || [], posts)
      : posts;
    library_state.imagineUploadCursor = String(data.next_cursor || "");
    library_state.imagineUploadHasMore = Boolean(data.has_more && library_state.imagineUploadCursor);
    library_state.imagineUploadLoaded = true;
    syncImagineRemotePostsIntoLibrary();
  } catch (error) {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineUploadError = error?.message || "Imagine uploads failed.";
    }
  } finally {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineUploadLoading = false;
      renderImagineSourceCards();
      if (typeof renderComposerAttachments === "function") renderComposerAttachments();
    }
  }
}

// Liked is the account's default grok.com collection. It holds bare asset ids that stay
// under their original owner, so it cannot be filtered out of the saved list and needs its
// own fetch. No cursor: the collection call takes a limit and returns the lot.
async function loadImagineLikedCards({ force = false } = {}) {
  if (library_state.imagineLikedLoading) return;
  if (!force && library_state.imagineLikedLoaded) return;
  if (!canLoadImagineSavedList()) return;
  const accountId = imaginePendingSavedAccountId();
  const requestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0);
  if (!accountId) return;
  library_state.imagineLikedLoading = true;
  library_state.imagineLikedError = "";
  renderImagineSourceCards();
  try {
    const data = await qApi("/api/imagine/liked", { account_id: accountId, limit: 100 });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    library_state.imagineLikedPosts = (Array.isArray(data.posts) ? data.posts : []).map(normalizeServerPost);
    library_state.imagineLikedLoaded = true;
    syncImagineRemotePostsIntoLibrary();
  } catch (error) {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineLikedError = error?.message || "Imagine liked failed.";
    }
  } finally {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineLikedLoading = false;
      renderImagineSourceCards();
    }
  }
}

function imagineSourcePosts() {
  if (library_state.iMainView === imagineViewValue("LIKED", "liked")) {
    return library_state.imagineLikedPosts || [];
  }
  if (library_state.iMainView === imagineViewValue("UPLOAD", "upload")) {
    return library_state.imagineUploadPosts || [];
  }
  if (library_state.iMainView === imagineViewValue("UNSAVED", "unsaved")) {
    return library_state.posts.filter((post) => post.area === "unsaved");
  }
  if (library_state.iMainView === imagineViewValue("T2I", "t2i")) {
    const posts = [
      ...(library_state.imagineRemotePosts || []),
      ...(library_state.posts || []),
    ].filter(isSessionImagineT2iPost);
    const unique = typeof uniquePostsByPath === "function" ? uniquePostsByPath(posts) : posts;
    const sessionOrder = new Map(
      Array.from(library_state.sessionImagineT2iPaths || []).map((path, index) => [String(path || ""), index]),
    );
    return [...unique].sort((left, right) => (
      (sessionOrder.get(String(left?.folder_path || "")) ?? Number.MAX_SAFE_INTEGER)
      - (sessionOrder.get(String(right?.folder_path || "")) ?? Number.MAX_SAFE_INTEGER)
      || String(left?.created_at || "").localeCompare(String(right?.created_at || ""))
    ));
  }
  if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
    const sourcePosts = library_state.imagineRemotePosts || [];
    if (imagineSavedDisplayPostsMemoSource !== sourcePosts) {
      imagineSavedDisplayPostsMemoSource = sourcePosts;
      imagineSavedDisplayPostsMemoResult = reconcileImagineSavedDisplayPosts(sourcePosts)
        .sort(comparePostsByRecentActivity);
      imagineSavedVisiblePostsMemoResult = imagineSavedDisplayPostsMemoResult.filter((post) => (
        !isImagineT2iGroupContainer(post)
      ));
    }
    return imagineSavedVisiblePostsMemoResult;
  }
  return [];
}

function imagineVisibleJobs() {
  const jobs = (library_state.imagineJobs || []).filter((job) => isRenderableBuildJob(job) && (
    typeof generationJobHasVisibleSlots !== "function" || generationJobHasVisibleSlots(job)
  ));
  if (library_state.iMainView === imagineViewValue("T2I", "t2i")) {
    return jobs.filter((job) => typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job));
  }
  if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
    return jobs.filter((job) => !(
      typeof generationJobHasSourcePost === "function" && generationJobHasSourcePost(job)
    ));
  }
  return [];
}

function renderImagineSourceCards() {
  if (library_state.imagineRemotePosts?.length) syncImagineRemotePostsIntoLibrary();
  const uploadView = library_state.iMainView === imagineViewValue("UPLOAD", "upload");
  if (
    uploadView
    && !library_state.imagineUploadLoaded
    && !library_state.imagineUploadLoading
    && !library_state.imagineUploadError
    && canLoadImagineSavedList()
  ) {
    loadImagineUploadCards().catch((error) => {
      library_state.imagineUploadError = error?.message || "Imagine uploads failed.";
      library_state.imagineUploadLoading = false;
      renderImagineSourceCards();
    });
  }
  if (
    library_state.iMainView === imagineViewValue("IMAGINE", "imagine")
    && !library_state.imagineRemoteLoaded
    && !library_state.imagineRemoteLoading
    && !library_state.imagineRemoteError
    && canLoadImagineSavedList()
  ) {
    loadImagineSavedCards().catch((error) => {
      library_state.imagineRemoteError = error?.message || "Imagine saved list failed.";
      library_state.imagineRemoteLoading = false;
      renderImagineSourceCards();
    });
  }
  const posts = filterPostsBySearch(imagineSourcePosts());
  const visibleJobs = imagineVisibleJobs();
  const t2iView = library_state.iMainView === imagineViewValue("T2I", "t2i");
  const mainJobEntries = visibleJobs.map((job) => ({
    key: mainGenerationActivityKey("job", job?.id),
    cards: (
      typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job)
        ? visibleGenerationJobSlots(job).map((slotIndex) => mediaCardForBuildJob(
          job,
          slotIndex,
          null,
          { screenId: "i_main", activeButtonId: "i_imagine_nav_btn" },
        ))
        : [mediaCardForBuildJob(
          job,
          0,
          null,
          { screenId: "i_main", activeButtonId: "i_imagine_nav_btn" },
        )]
    ).filter(Boolean),
  }));
  const mainPostEntries = posts.map((post) => ({
    key: mainGenerationActivityKey("post", post?.folder_path || post?.post_id),
    cards: [virtualCardRenderSpecForPost(post, "i_card")],
  }));
  const list = document.querySelector(".i_card_list");
  if (list) {
    if (library_state.imagineUploadLoading && !posts.length && uploadView) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (library_state.imagineUploadError && !posts.length && uploadView) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(library_state.imagineUploadError));
    } else if (library_state.imagineRemoteLoading && !posts.length && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (library_state.imagineRemoteError && !posts.length && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(library_state.imagineRemoteError));
    } else if (
      imagineSavedAccountNeedsLogin()
      && (library_state.iMainView === imagineViewValue("IMAGINE", "imagine") || uploadView)
    ) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Imagine login expired. Register the account again."));
    } else if (!posts.length && !visibleJobs.length) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(
        t2iView ? "No T2I items." : (uploadView ? "No upload images." : ""),
      ));
    } else if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine") || uploadView) {
      renderVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list, orderedMainGenerationCards(
        "imagine",
        [...mainJobEntries, ...mainPostEntries],
      ), {
        loading: uploadView
          ? library_state.imagineUploadLoading
          : library_state.imagineRemoteLoading,
        remoteMedia: true,
      });
    } else {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      replaceCardListChildren(list, [
        ...(t2iView ? visibleJobs.flatMap(mediaCardsForBuildJob) : visibleJobs.map((job) => mediaCardForBuildJob(job))),
        ...posts.map((post) => mediaCardForPost(post, "i_card")),
      ]);
    }
  }
  document.getElementById("i_imagine_tab_btn")?.classList.toggle("active", library_state.iMainView === imagineViewValue("IMAGINE", "imagine"));
  // That button is Liked now, so it lights up for the Liked view, not the upload one.
  document.getElementById("i_upload_image_btn")?.classList.toggle(
    "active",
    library_state.iMainView === imagineViewValue("LIKED", "liked"),
  );
  document.getElementById("i_t2i_btn")?.classList.toggle("active", t2iView);
  const count = document.querySelector(".i_main_header p");
  const jobSlots = visibleJobs.reduce((total, job) => total + (
    typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job)
      ? (typeof visibleGenerationJobSlots === "function" ? visibleGenerationJobSlots(job).length : buildJobT2iSlotCount(job))
      : 1
  ), 0);
  if (count) count.textContent = `${posts.length + jobSlots} items`;
  if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
    requestAnimationFrame(maybeLoadMoreImagineSavedCards);
  } else if (uploadView) {
    requestAnimationFrame(maybeLoadMoreImagineUploadCards);
  }
}

function maybeLoadMoreImagineDiscoverCards() {
  const list = document.querySelector(".i_discover_card_list");
  if (!list) return;
  if (!library_state.imagineDiscoverLoaded || !library_state.imagineDiscoverHasMore) return;
  if (library_state.imagineDiscoverLoading) return;
  const remaining = virtualCardListRemaining(list);
  if (remaining > virtualCardListPrefetchDistance(list, 6, 960)) return;
  loadImagineDiscoverCards({ append: true }).catch((error) => {
    library_state.imagineDiscoverError = error?.message || "Imagine Discover list failed.";
    library_state.imagineDiscoverLoading = false;
    renderImagineDiscoverCards();
  });
}

function maybeLoadMoreImagineUnsavedCards() {
  const list = document.querySelector(".i_unsaved_card_list");
  if (!list) return;
  if (!library_state.imagineUnsavedLoaded || !library_state.imagineUnsavedHasMore) return;
  if (library_state.imagineUnsavedLoading) return;
  const remaining = virtualCardListRemaining(list);
  if (remaining > virtualCardListPrefetchDistance(list, 1.5, 480)) return;
  loadImagineUnsavedCards({ append: true }).catch((error) => {
    library_state.imagineUnsavedError = error?.message || "Imagine Unsaved list failed.";
    library_state.imagineUnsavedLoading = false;
    renderImagineUnsavedCards();
  });
}

function renderImagineDiscoverCards() {
  if (library_state.imagineDiscoverPosts?.length) syncImagineRemotePostsIntoLibrary();
  if (
    !library_state.imagineDiscoverCacheLoaded
    && !library_state.imagineDiscoverCacheLoading
    && canLoadImagineSavedCache()
  ) {
    loadImagineDiscoverCacheCards().catch(() => {});
  }
  if (
    screen_state.current_screen === "i_discover_main"
    && library_state.imagineDiscoverCacheLoaded
    && !library_state.imagineDiscoverLoaded
    && !library_state.imagineDiscoverLoading
    && canLoadImagineSavedList()
  ) {
    loadImagineDiscoverCards().catch((error) => {
      library_state.imagineDiscoverError = error?.message || "Imagine Discover list failed.";
      library_state.imagineDiscoverLoading = false;
      renderImagineDiscoverCards();
    });
  }
  const list = document.querySelector(".i_discover_card_list");
  if (!list) return;
  const posts = filterPostsBySearch(library_state.imagineDiscoverPosts || []);
  if ((library_state.imagineDiscoverCacheLoading || library_state.imagineDiscoverLoading) && !posts.length) {
    disableVirtualCardList(IMAGINE_DISCOVER_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode("Loading . . ."));
  } else if (library_state.imagineDiscoverError && !posts.length) {
    disableVirtualCardList(IMAGINE_DISCOVER_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode(library_state.imagineDiscoverError));
  } else if (!posts.length) {
    disableVirtualCardList(IMAGINE_DISCOVER_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode(""));
  } else {
    renderVirtualCardList(IMAGINE_DISCOVER_VIRTUAL_LIST_KEY, list, [
      ...posts.map((post) => virtualCardRenderSpecForPost(post, "i_card", {
        screenId: "i_discover_main",
        activeButtonId: "i_discover_nav_btn",
      })),
    ], {
      loading: false,
      remoteMedia: true,
    });
  }
  if (screen_state.current_screen === "i_discover_main") {
    requestAnimationFrame(maybeLoadMoreImagineDiscoverCards);
  }
}

function renderImagineUnsavedCards() {
  if (library_state.imagineUnsavedPosts?.length) syncImagineRemotePostsIntoLibrary();
  if (
    !library_state.imagineUnsavedLoaded
    && !library_state.imagineUnsavedLoading
    && !library_state.imagineUnsavedError
    && canLoadImagineSavedList()
  ) {
    loadImagineUnsavedCards().catch((error) => {
      library_state.imagineUnsavedError = error?.message || "Imagine Unsaved list failed.";
      library_state.imagineUnsavedLoading = false;
      renderImagineUnsavedCards();
    });
  }
  const list = document.querySelector(".i_unsaved_card_list");
  if (!list) return;
  const posts = filterPostsBySearch(library_state.imagineUnsavedPosts || []);
  if (library_state.imagineUnsavedLoading && !posts.length) {
    disableVirtualCardList(IMAGINE_UNSAVED_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode("Loading . . ."));
  } else if (library_state.imagineUnsavedError && !posts.length) {
    disableVirtualCardList(IMAGINE_UNSAVED_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode(library_state.imagineUnsavedError));
  } else if (!posts.length) {
    disableVirtualCardList(IMAGINE_UNSAVED_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode(""));
  } else {
    renderVirtualCardList(IMAGINE_UNSAVED_VIRTUAL_LIST_KEY, list, [
      ...posts.map((post) => virtualCardRenderSpecForPost(post, "i_card", {
        screenId: "i_unsaved_main",
        activeButtonId: "i_unsaved_nav_btn",
      })),
    ], {
      loading: library_state.imagineUnsavedLoading,
      remoteMedia: true,
    });
  }
  if (screen_state.current_screen === "i_unsaved_main") {
    requestAnimationFrame(maybeLoadMoreImagineUnsavedCards);
  }
}

bindVirtualCardListScroll(
  IMAGINE_DISCOVER_VIRTUAL_LIST_KEY,
  document.querySelector(".i_discover_card_list"),
  maybeLoadMoreImagineDiscoverCards,
);
bindVirtualCardListScroll(
  IMAGINE_VIRTUAL_LIST_KEY,
  document.querySelector(".i_card_list"),
  () => {
    maybeLoadMoreImagineSavedCards();
    maybeLoadMoreImagineUploadCards();
  },
);
