// Imagine source list filtering and rendering
const IMAGINE_VIRTUAL_LIST_KEY = "imagine-main";
const IMAGINE_DISCOVER_VIRTUAL_LIST_KEY = "imagine-discover";
const IMAGINE_UNSAVED_VIRTUAL_LIST_KEY = "imagine-unsaved";
const IMAGINE_SAVED_PAGE_SIZE = 40;
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
    const key = imagineSavedCardPathKey(post);
    if (key) merged.set(key, post);
  }
  for (const post of normalized) {
    const key = imagineSavedCardPathKey(post);
    if (key) merged.set(key, post);
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
    // Clear the submitted value before changing screens. The input is shared with the
    // main header, so relying on the later collapsed-input cleanup could leave an old
    // link visible when the user returns from the detail page.
    if (input) input.value = "";
    setImagineTab("i_link_btn");
    library_state.iMainView = imagineViewValue("LINK", "link");
    screen_state.detail_back.imagine = {
      screenId: "i_main",
      activeButtonId: screen_state.current_i_nav_btn || "i_imagine_nav_btn",
    };
    selectLibraryPost(targetPost);
    if (targetItem) library_state.selectedDetailItemId = mediaItemKey(targetItem);
    openScreen("i_detail", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
    setImagineLinkInputOpen(false, { clear: false });
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

function imagineSavedMetadataValue(source, key) {
  const metadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return source?.[key] || metadata[key] || imagine[key] || "";
}

// Saved, a link/local-heart reference, and an owned clone can legitimately point at
// the same Grok asset. They are separate top-level cards, so carry their provenance
// into every card-level identity used by the client.
function imagineSavedPostProvenance(post) {
  const explicit = String(imagineSavedMetadataValue(post, "saved_provenance") || "").trim().toLowerCase();
  const remoteView = String(imagineSavedMetadataValue(post, "remote_view") || "").toLowerCase();
  const structurallyReferenced = Boolean(
    imagineSavedMetadataValue(post, "link_source")
    || imagineSavedMetadataValue(post, "local_heart")
    || imagineSavedMetadataValue(post, "external_reference")
    || String(post?.mode || "").toLowerCase() === "link"
    || remoteView === "link"
  );
  const topLevelCloned = Boolean(
    imagineSavedMetadataValue(post, "cloned_copy")
    || imagineSavedMetadataValue(post, "cloned_from_asset_id")
    || imagineSavedMetadataValue(post, "official_clone_asset_id")
    || imagineSavedMetadataValue(post, "official_clone_source_asset_id")
  );
  const itemCloned = structurallyReferenced && (post?.items || []).some((item) => Boolean(
    imagineSavedMetadataValue(item, "cloned_copy")
    || imagineSavedMetadataValue(item, "cloned_from_asset_id")
    || imagineSavedMetadataValue(item, "official_clone_asset_id")
    || imagineSavedMetadataValue(item, "official_clone_source_asset_id")
  ));
  if (topLevelCloned || itemCloned) return "cloned-liked";
  if (structurallyReferenced) return "plain-liked";
  return ["normal-saved", "plain-liked", "cloned-liked"].includes(explicit)
    ? explicit
    : "normal-saved";
}

function imagineSavedScopedIdentity(post, value) {
  const identity = String(value || "").trim();
  return identity ? `${imagineSavedPostProvenance(post)}\u001f${identity}` : "";
}

function imagineSavedCardAnchor(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return String(metadata.saved_anchor_id || imagine.saved_anchor_id || "").trim();
}

function imagineSavedDisplayGroup(post) {
  if (imagineSavedPostProvenance(post) !== "normal-saved") return "";
  return String(imagineSavedMetadataValue(post, "saved_display_group_id") || "").trim();
}

function imagineSavedOfficialOrder(post) {
  const value = imagineSavedMetadataValue(post, "official_order");
  const order = Number(value);
  return Number.isInteger(order) && order >= 0 ? order : null;
}

function compareImagineSavedOfficialOrder(left, right) {
  const leftOrder = imagineSavedOfficialOrder(left);
  const rightOrder = imagineSavedOfficialOrder(right);
  if (leftOrder !== null || rightOrder !== null) {
    if (leftOrder === null) return 1;
    if (rightOrder === null) return -1;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  }
  // Main Saved is an ordered Grok feed. Asset-only fallbacks and temporary relation
  // cards do not have an official position, and their activity timestamps can vary
  // between equivalent refreshes. Returning zero keeps the stable input order instead
  // of letting a background Saved check reshuffle cards the user is already viewing.
  return 0;
}

function imagineSavedCardPathKey(post) {
  const displayGroup = imagineSavedDisplayGroup(post);
  const anchor = imagineSavedCardAnchor(post);
  return imagineSavedScopedIdentity(post, displayGroup || anchor || post?.folder_path);
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

function isImagineRemoteMainPost(post) {
  const path = String(post?.folder_path || "");
  return Boolean(
    post?.source === "imagine"
    && (
      post?.remote
      || post?.area === "imagine_remote"
      || /^imagine_(saved|generated)\//.test(path)
    )
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
    .filter(isImagineRemoteMainPost)
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

// The same generated result can be reported twice by Saved: once as an asset-only
// fallback and once on its conversation card with the input image.  Their display
// groups can differ, so preserve the group as the primary identity but also keep a
// provenance-scoped key for every non-source result asset.  A shared input image is
// deliberately excluded: separate edits may legitimately use that same source.
function imagineSavedExactResultKeys(post) {
  const keys = new Set();
  for (const item of post?.items || []) {
    if (!item || imagineSavedItemIsSource(item)) continue;
    const assetId = imagineSavedItemAssetId(item);
    const key = imagineSavedScopedIdentity(post, assetId ? `result:${assetId}` : "");
    if (key) keys.add(key);
  }
  return keys;
}

function mergeImagineRemotePosts(existingPosts, nextPosts) {
  const merged = [];
  const indexByKey = new Map();

  const rememberCard = (post, index) => {
    const pathKey = imagineSavedCardPathKey(post);
    if (pathKey) indexByKey.set(pathKey, index);
    for (const resultKey of imagineSavedExactResultKeys(post)) {
      if (!indexByKey.has(resultKey)) indexByKey.set(resultKey, index);
    }
  };

  const findExistingIndex = (post) => {
    const pathKey = imagineSavedCardPathKey(post);
    if (pathKey && indexByKey.has(pathKey)) return indexByKey.get(pathKey);
    for (const resultKey of imagineSavedExactResultKeys(post)) {
      if (indexByKey.has(resultKey)) return indexByKey.get(resultKey);
    }
    return -1;
  };

  for (const post of existingPosts || []) {
    if (!post?.folder_path) continue;
    const index = findExistingIndex(post);
    if (index < 0) {
      merged.push(post);
      rememberCard(post, merged.length - 1);
      continue;
    }
    // Existing callers normally pass reconciled cards, but retaining the same folding
    // path here makes an exact-asset duplicate safe even before reconciliation runs.
    const existing = merged[index];
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
    const combined = normalizeServerPost({
      ...primary,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
      metadata: {
        ...(primary.metadata || {}),
        flat_only: existingFlat && nextFlat,
      },
    });
    merged[index] = combined;
    rememberCard(combined, index);
  }
  for (const post of nextPosts || []) {
    if (!post?.folder_path) continue;
    const index = findExistingIndex(post);
    if (index < 0) {
      merged.push(post);
      rememberCard(post, merged.length - 1);
      continue;
    }
    const existing = merged[index];
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
    const combined = normalizeServerPost({
      ...primary,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
      metadata: {
        ...(primary.metadata || {}),
        flat_only: existingFlat && nextFlat,
      },
    });
    merged[index] = combined;
    rememberCard(combined, index);
  }
  return merged;
}

function imagineSavedPostMatchIndex(posts) {
  const byPath = new Map();
  const byKey = new Map();
  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    const path = imagineSavedCardPathKey(post);
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
  const path = imagineSavedCardPathKey(post);
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

function mergeImagineSyncedPosts(
  existingPosts,
  refreshedPosts,
  {
    replacesList = false,
    preserveMatchedAnchors = !replacesList,
    sortByRecentActivity = true,
  } = {},
) {
  const finish = (posts) => (
    sortByRecentActivity ? sortPostsIfNeeded(posts, comparePostsByRecentActivity) : posts
  );
  const existing = reconcileImagineSavedDisplayPosts(existingPosts || []);
  const refreshed = reconcileImagineSavedDisplayPosts(refreshedPosts || []);
  if (!existing.length) return finish([...refreshed]);
  if (!refreshed.length) {
    // A full reload that comes back empty means the account has nothing saved any more.
    if (replacesList) return [];
    return finish([...existing]);
  }

  const existingIndex = imagineSavedPostMatchIndex(existing);
  const matchedExistingIndexes = new Set();
  const refreshedForExistingIndex = new Map();
  const newPosts = [];
  const refreshedInReceivedOrder = [];

  for (const post of refreshed) {
    const matchedIndex = takeImagineSavedPostMatch(
      existingIndex,
      post,
      matchedExistingIndexes,
    );
    if (matchedIndex < 0) {
      newPosts.push(post);
      refreshedInReceivedOrder.push(post);
      continue;
    }
    matchedExistingIndexes.add(matchedIndex);
    const merged = preserveMatchedAnchors
      ? mergeImagineIncrementalSavedPost(existing[matchedIndex], post)
      : mergeImaginePreservedGeneratedRelations(existing[matchedIndex], post);
    refreshedForExistingIndex.set(matchedIndex, merged);
    refreshedInReceivedOrder.push(merged);
  }

  // A paged response is only a fragment of Saved. Keep the existing card as the
  // anchor when that fragment identifies one of its children, otherwise the card's
  // folder_path changes to the child id for one render and the virtual list flashes.
  // Reconciliation below can still fold newly returned children into that anchor.
  if (!replacesList) {
    return finish([
      ...existing.map((post, index) => refreshedForExistingIndex.get(index) || post),
      ...newPosts,
    ]);
  }

  // The first public page replaces an earlier screen snapshot.  When Saved is rendered
  // page-by-page, retain the order Grok returned rather than the old screen's order.
  if (!sortByRecentActivity) return refreshedInReceivedOrder;

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

  return finish([
    ...newPosts,
    ...existing
      .map((post, index) => (
        refreshedForExistingIndex.get(index)
        || (keepUnmatched(post) ? post : null)
      ))
      .filter(Boolean),
  ]);
}

function mergeImagineIncrementalSavedPost(existingPost, refreshedPost) {
  if (!existingPost) return refreshedPost;
  if (!refreshedPost) return existingPost;

  const stabilized = mergeImaginePreservedGeneratedRelations(existingPost, refreshedPost);
  const existingPostMetadata = existingPost.metadata && typeof existingPost.metadata === "object"
    ? existingPost.metadata
    : {};
  const refreshedPostMetadata = stabilized.metadata && typeof stabilized.metadata === "object"
    ? stabilized.metadata
    : {};
  const existingFlat = existingPostMetadata.flat_only === true;
  const refreshedFlat = refreshedPostMetadata.flat_only === true;
  const preferRefreshedStructure = existingFlat && !refreshedFlat;
  const basePost = preferRefreshedStructure ? stabilized : existingPost;
  const items = [...(existingPost.items || [])];
  const itemIndexByKey = new Map();
  const indexItem = (item, index) => {
    for (const key of imaginePostIdKeysForItem(item)) {
      if (!itemIndexByKey.has(key)) itemIndexByKey.set(key, index);
    }
  };
  items.forEach(indexItem);

  for (const refreshedItem of stabilized.items || []) {
    const matchedIndex = imaginePostIdKeysForItem(refreshedItem)
      .map((key) => itemIndexByKey.get(key))
      .find((index) => Number.isInteger(index));
    if (!Number.isInteger(matchedIndex)) {
      const nextIndex = items.length;
      items.push(refreshedItem);
      indexItem(refreshedItem, nextIndex);
      continue;
    }
    const existingItem = items[matchedIndex] || {};
    const existingMetadata = existingItem.metadata && typeof existingItem.metadata === "object"
      ? existingItem.metadata
      : {};
    const refreshedMetadata = refreshedItem.metadata && typeof refreshedItem.metadata === "object"
      ? refreshedItem.metadata
      : {};
    const existingImagineMetadata = existingMetadata.imagine && typeof existingMetadata.imagine === "object"
      ? existingMetadata.imagine
      : {};
    const refreshedImagineMetadata = refreshedMetadata.imagine && typeof refreshedMetadata.imagine === "object"
      ? refreshedMetadata.imagine
      : {};
    items[matchedIndex] = {
      ...existingItem,
      ...refreshedItem,
      created_at: existingItem.created_at || refreshedItem.created_at || "",
      metadata: {
        ...existingMetadata,
        ...refreshedMetadata,
        imagine: {
          ...existingImagineMetadata,
          ...refreshedImagineMetadata,
          ...(existingImagineMetadata.app_generated_relation === true
            ? { app_generated_relation: true }
            : {}),
        },
        ...(existingMetadata.app_generated_relation === true
          ? { app_generated_relation: true }
          : {}),
      },
    };
    indexItem(items[matchedIndex], matchedIndex);
  }

  const representative = representativeItem(items, { ...existingPost, items }) || items[0];
  const lowPriorityMetadata = preferRefreshedStructure ? existingPostMetadata : refreshedPostMetadata;
  const highPriorityMetadata = preferRefreshedStructure ? refreshedPostMetadata : existingPostMetadata;
  const lowPriorityImagine = lowPriorityMetadata.imagine && typeof lowPriorityMetadata.imagine === "object"
    ? lowPriorityMetadata.imagine
    : {};
  const highPriorityImagine = highPriorityMetadata.imagine && typeof highPriorityMetadata.imagine === "object"
    ? highPriorityMetadata.imagine
    : {};
  return normalizeServerPost({
    ...basePost,
    folder_path: existingPost.folder_path || basePost.folder_path || "",
    post_id: existingPost.post_id || basePost.post_id || "",
    created_at: existingPost.created_at || basePost.created_at || "",
    items,
    representative: representative?.file || representative?.url || representative?.item_id || "",
    representative_item: representative,
    metadata: {
      ...lowPriorityMetadata,
      ...highPriorityMetadata,
      imagine: {
        ...lowPriorityImagine,
        ...highPriorityImagine,
        ...(lowPriorityImagine.app_generated_relation === true
          ? { app_generated_relation: true }
          : {}),
      },
      ...((lowPriorityMetadata.app_generated_relation === true
        || lowPriorityMetadata.app_preserved_generated_relations === true)
        ? {
          ...(lowPriorityMetadata.app_generated_relation === true
            ? { app_generated_relation: true }
            : {}),
          ...(lowPriorityMetadata.app_preserved_generated_relations === true
            ? { app_preserved_generated_relations: true }
            : {}),
        }
        : {}),
      flat_only: existingFlat && refreshedFlat,
    },
  });
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

function imagineLikedExclusionCardKeys(post) {
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const membershipIds = Array.isArray(metadata.liked_membership_asset_ids)
    ? metadata.liked_membership_asset_ids
    : [];
  const folderTail = String(post?.folder_path || "").split("/").filter(Boolean).pop() || "";
  return new Set([
    imagineSavedCardAnchor(post),
    post?.post_id,
    folderTail,
    metadata.link_post_id,
    imagine.link_post_id,
    metadata.clone_batch_id,
    imagine.clone_batch_id,
    ...membershipIds,
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

function filterImagineMainLikedScopePosts(posts) {
  const excluded = library_state.imagineLikedExclusionIds instanceof Set
    ? library_state.imagineLikedExclusionIds
    : new Set();
  return (posts || []).flatMap((post) => {
    if (!post) return [];
    if (["plain-liked", "cloned-liked"].includes(imagineSavedPostProvenance(post))) return [];
    if (Array.from(imagineLikedExclusionCardKeys(post)).some((key) => excluded.has(key))) return [];
    const items = (post.items || []).filter((item) => {
      const assetId = imagineSavedItemAssetId(item);
      return !assetId || !excluded.has(assetId);
    });
    if (!items.length) return [];
    if (items.length === (post.items || []).length) return [post];
    const representative = representativeItem(items, { ...post, items }) || items[0];
    return [normalizeServerPost({
      ...post,
      items,
      representative_item: representative,
      representative: representative?.file || representative?.url || representative?.item_id || "",
    })];
  });
}

function applyImagineLikedExclusionSnapshot(data, accountId) {
  const payload = data?.liked_exclusion;
  if (!payload || !Array.isArray(payload.ids)) return false;
  const normalizedAccountId = String(accountId || "");
  const previousAccountId = String(library_state.imagineLikedExclusionAccountId || "");
  let nextIds = previousAccountId === normalizedAccountId && library_state.imagineLikedExclusionIds instanceof Set
    ? new Set(library_state.imagineLikedExclusionIds)
    : new Set();
  const incoming = new Set(payload.ids.map((value) => String(value || "").trim()).filter(Boolean));
  if (payload.complete === true) nextIds = incoming;
  else for (const value of incoming) nextIds.add(value);
  const previousSignature = Array.from(
    library_state.imagineLikedExclusionIds instanceof Set
      ? library_state.imagineLikedExclusionIds
      : [],
  ).sort().join("\u0000");
  const nextSignature = Array.from(nextIds).sort().join("\u0000");
  library_state.imagineLikedExclusionIds = nextIds;
  library_state.imagineLikedExclusionComplete = payload.complete === true
    || (previousAccountId === normalizedAccountId && library_state.imagineLikedExclusionComplete === true);
  library_state.imagineLikedExclusionRevision = String(
    payload.revision || library_state.imagineLikedExclusionRevision || "",
  );
  library_state.imagineLikedExclusionAccountId = normalizedAccountId;
  const before = library_state.imagineRemotePosts || [];
  const after = filterImagineMainLikedScopePosts(before);
  const changed = previousSignature !== nextSignature
    || after.length !== before.length
    || after.some((post, index) => post !== before[index]);
  if (changed) library_state.imagineRemotePosts = after;
  return changed;
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
      saved_anchor_id: conversationId,
      saved_provenance: imagineSavedPostProvenance(post),
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

function imagineSavedT2iBatchNeedsAssetFanout(post, items) {
  if (imagineSavedPostProvenance(post) !== "normal-saved") return false;
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const normalizedAction = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const isT2iAction = (value) => ["t2i", "texttoimage"].includes(normalizedAction(value));
  const explicitBatch = (
    isImagineT2iGroupContainer(post)
    || isT2iAction(post?.mode)
    || isT2iAction(metadata.root_generation_action)
  );
  let t2iRootCount = 0;
  let rootResultCount = 0;
  for (const item of items || []) {
    if (imagineSavedItemIsSource(item) || imagineSavedItemSourceId(item)) continue;
    rootResultCount += 1;
    const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const itemImagine = itemMetadata.imagine && typeof itemMetadata.imagine === "object"
      ? itemMetadata.imagine
      : {};
    if (isT2iAction(
      item?.generated_action
      || item?.relation
      || itemMetadata.generated_action
      || itemImagine.generated_action
    )) {
      t2iRootCount += 1;
    }
  }
  const declaredCount = Math.max(
    Number(metadata.root_generation_asset_count) || 0,
    Number(metadata.root_generation_requested_count) || 0,
  );
  return Math.max(declaredCount, t2iRootCount, explicitBatch ? rootResultCount : 0) > 1
    && (explicitBatch || t2iRootCount > 1);
}

function imagineSavedLineageCards(post) {
  if (!post) return [];
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const items = (post.items || []).filter((item) => imagineSavedItemAssetId(item));
  if (!items.length) return [post];
  // The official conversation row for a multi-result T2I request is only a transport
  // container.  The Imagine main view is asset-rooted: fan A/B/C/D out, then attach an
  // i2i/i2v/extend child only to the selected asset's card.  This must also repair an old
  // cached conversation container that already contains descendants.
  const forceT2iAssetFanout = imagineSavedT2iBatchNeedsAssetFanout(post, items);
  const uploadBundle = imagineUploadOriginBundleCard(post, items);
  if (uploadBundle && !forceT2iAssetFanout) return [uploadBundle];
  // Mirrors imagine_saved_lineage_cards: a link-sourced post is one grok.com conversation
  // and the site shows it as one grouped card, so leave it whole instead of splitting the
  // parent chain. Everything else, T2I batches included, still fans out below.
  const linkSourced = Boolean(metadata.link_source || post.link_source || metadata.remote_view === "link");
  // Clone-batch is app-only Liked: its owned source and descendants have already been
  // assembled into one card by the server.  Do not run the Saved root fan-out over that
  // card again, or a complete clone family is rendered as one card per root asset.
  const privateCloneLiked = (
    imagineSavedPostProvenance(post) === "cloned-liked"
    && metadata.liked_scope === "foreign-origin"
  );
  if (!forceT2iAssetFanout && (linkSourced || privateCloneLiked)) return [post];

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
        saved_anchor_id: rootId,
        // A flattened root is its own display card. Keeping the conversation-level display
        // group here makes mergeImagineRemotePosts immediately fold A/B/C/D back together.
        saved_display_group_id: rootId,
        saved_provenance: imagineSavedPostProvenance(post),
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
  const provenances = [];
  const lineageScopes = [];
  const rootOwnerById = new Map();
  active.forEach((card, index) => {
    const provenance = imagineSavedPostProvenance(card);
    const savedAnchor = imagineSavedCardAnchor(card);
    const lineageScope = `${provenance}\u001f${savedAnchor ? `anchor:${savedAnchor}` : "legacy"}`;
    const rootId = String(
      card?.metadata?.lineage_root_asset_id
      || card?.post_id
      || "",
    ).trim();
    provenances.push(provenance);
    lineageScopes.push(lineageScope);
    rootIds.push(rootId);
    // saved_anchor_id identifies the card row, not a boundary in the media lineage.
    // A normal i2i → i2v chain can cross conversations, so the child row is anchored to
    // its input image while the source row is anchored to an earlier root image.  Match
    // parent assets by provenance + globally unique asset id; Liked has its own reconciler.
    const scopedRootId = rootId ? `${provenance}\u001f${rootId}` : "";
    if (scopedRootId && !rootOwnerById.has(scopedRootId)) rootOwnerById.set(scopedRootId, index);
  });

  const ownerByItemId = new Map(rootOwnerById);
  const sourceOwnerById = new Map();
  const uploadBundleOwnerByItemId = new Map();
  active.forEach((card, index) => {
    const lineageScope = lineageScopes[index];
    const provenance = provenances[index];
    for (const item of card.items || []) {
      const itemId = imagineSavedItemAssetId(item);
      const scopedUploadItemId = itemId ? `${lineageScope}\u001f${itemId}` : "";
      const scopedItemId = itemId ? `${provenance}\u001f${itemId}` : "";
      if (card?.metadata?.upload_origin_bundle === true && scopedUploadItemId && !uploadBundleOwnerByItemId.has(scopedUploadItemId)) {
        uploadBundleOwnerByItemId.set(scopedUploadItemId, index);
      }
      if (imagineSavedItemIsSource(item)) {
        if (scopedItemId && !sourceOwnerById.has(scopedItemId)) sourceOwnerById.set(scopedItemId, index);
        continue;
      }
      if (scopedItemId && !ownerByItemId.has(scopedItemId)) ownerByItemId.set(scopedItemId, index);
    }
  });

  const parentIndexes = active.map((_, index) => index);
  active.forEach((candidate, index) => {
    const lineageScope = lineageScopes[index];
    const provenance = provenances[index];
    const rootId = rootIds[index];
    const duplicateOwner = rootId ? rootOwnerById.get(`${provenance}\u001f${rootId}`) : undefined;
    if (duplicateOwner !== undefined && duplicateOwner !== index) {
      parentIndexes[index] = duplicateOwner;
      return;
    }
    if (candidate?.metadata?.upload_origin_bundle !== true) {
      const uploadBundleOwner = (candidate.items || [])
        .map((item) => {
          const itemId = imagineSavedItemAssetId(item);
          return itemId ? uploadBundleOwnerByItemId.get(`${lineageScope}\u001f${itemId}`) : undefined;
        })
        .find((owner) => owner !== undefined);
      if (uploadBundleOwner !== undefined && uploadBundleOwner !== index) {
        parentIndexes[index] = uploadBundleOwner;
        return;
      }
    }
    const rootItem = (candidate.items || [])
      .find((item) => imagineSavedItemAssetId(item) === rootId);
    const parentId = imagineSavedItemSourceId(rootItem);
    const scopedParentId = parentId ? `${provenance}\u001f${parentId}` : "";
    const parentOwner = ownerByItemId.get(scopedParentId) ?? sourceOwnerById.get(scopedParentId);
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
      const scopedGenerationRootId = generationRootId ? `${provenance}\u001f${generationRootId}` : "";
      const generationOwner = ownerByItemId.get(scopedGenerationRootId)
        ?? sourceOwnerById.get(scopedGenerationRootId);
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

function reconcileImagineLikedLineagePosts(posts) {
  // Liked sources and their results can arrive from different endpoints. Group only through
  // explicit source_item_id, parent_post_id, or original_post_id -- never a conversation.
  const active = (posts || []).filter(Boolean).map((card) => normalizeServerPost({
    ...card,
    items: [...(card.items || [])],
    metadata: { ...(card.metadata || {}) },
  }));
  active.forEach((card) => {
    const provenance = imagineSavedPostProvenance(card);
    const anchor = imagineSavedCardAnchor(card);
    card.metadata = {
      ...(card.metadata || {}),
      saved_provenance: provenance,
      ...(anchor ? { saved_anchor_id: anchor } : {}),
    };
  });
  if (active.length < 2) return active;

  const ownerByAssetId = new Map();
  const ownerByCard = new Map();
  const cardAssetIds = (card) => new Set([
    card?.post_id,
    card?.metadata?.lineage_root_asset_id,
    ...(card?.items || []).map(imagineSavedItemAssetId),
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const rememberOwner = (index, owner, { replaceAssets = false } = {}) => {
    ownerByCard.set(index, owner);
    for (const assetId of cardAssetIds(active[index])) {
      if (replaceAssets || !ownerByAssetId.has(assetId)) ownerByAssetId.set(assetId, owner);
    }
  };

  active.forEach((card, index) => {
    const provenance = imagineSavedPostProvenance(card);
    const anchor = imagineSavedCardAnchor(card);
    if (["plain-liked", "cloned-liked"].includes(provenance) && anchor) {
      rememberOwner(index, { provenance, anchor });
    }
  });
  if (!ownerByCard.size) return active;

  let changed = true;
  while (changed) {
    changed = false;
    active.forEach((card, index) => {
      const currentOwner = ownerByCard.get(index);
      const sourceOwners = [];
      for (const item of card.items || []) {
        for (const sourceId of imagineSavedItemSourceIds(item)) {
          const owner = ownerByAssetId.get(sourceId);
          if (owner) sourceOwners.push(owner);
        }
      }
      // A copied i2i -> i2v card carries both its own immediate parent and that parent's
      // shared ancestor. Ignore its own match so the common copied root joins the direct
      // i2v branch as one Liked card.
      const owner = sourceOwners.find((candidate) => (
        candidate.provenance !== currentOwner?.provenance || candidate.anchor !== currentOwner?.anchor
      ));
      if (!owner || (owner.provenance === currentOwner?.provenance && owner.anchor === currentOwner?.anchor)) return;
      const metadata = card.metadata && typeof card.metadata === "object" ? card.metadata : {};
      card.metadata = {
        ...metadata,
        saved_provenance: owner.provenance,
        saved_anchor_id: owner.anchor,
        liked_lineage_owner_anchor: owner.anchor,
        liked: true,
      };
      card.liked = true;
      card.favorite = true;
      rememberOwner(index, owner, { replaceAssets: true });
      changed = true;
    });
  }

  const membersByOwner = new Map();
  active.forEach((_, index) => {
    const owner = ownerByCard.get(index);
    const key = owner
      ? `liked\u001f${owner.provenance}\u001f${owner.anchor}`
      : `standalone\u001f${index}`;
    if (!membersByOwner.has(key)) membersByOwner.set(key, []);
    membersByOwner.get(key).push(index);
  });
  return Array.from(membersByOwner.values()).map((memberIndexes) => {
    const anchor = active[memberIndexes[0]];
    if (memberIndexes.length === 1) return anchor;
    const knownItemIds = new Set();
    const items = [];
    for (const memberIndex of memberIndexes) {
      for (const item of active[memberIndex].items || []) {
        const itemId = imagineSavedItemAssetId(item);
        if (itemId && knownItemIds.has(itemId)) continue;
        items.push(item);
        if (itemId) knownItemIds.add(itemId);
      }
    }
    const owner = ownerByCard.get(memberIndexes[0]);
    const aliases = memberIndexes
      .map((index) => imagineSavedCardAnchor(active[index]))
      .filter(Boolean);
    const representative = representativeItem(items, { ...anchor, items }) || items[0];
    return normalizeServerPost({
      ...anchor,
      items,
      metadata: {
        ...(anchor.metadata || {}),
        ...(owner ? { saved_provenance: owner.provenance, saved_anchor_id: owner.anchor } : {}),
        ...(aliases.length ? { saved_anchor_aliases: [...new Set(aliases)].sort() } : {}),
      },
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

// Generated media reaches the browser stream before it necessarily reaches Grok's Saved
// endpoints.  Keep that acknowledgement separate from the app's card grouping: a group
// remains exactly as the app presents it, while only its new child item is pending.
// v1 persisted every just-generated asset indefinitely. If the user deleted one before
// Saved finished catching up, it could never be confirmed and blocked later generations
// even after an app restart. Start v2 with a clean acknowledgement set; successful
// in-app deletes below also release their own ids immediately.
const IMAGINE_GENERATED_SAVED_SYNC_STORAGE_PREFIX = "grok-chameleon:imagine-generated-saved-sync:v2:";
let imagineGeneratedSavedSyncAccountId = "";
const imagineGeneratedSavedSyncAssetIds = new Set();
const imagineGeneratedSavedOfficialAssetIds = new Set();
let imagineGeneratedSavedSyncRefreshTimer = 0;
let imagineGeneratedSavedSyncRefreshAttempt = 0;
let imagineGeneratedSavedSyncRestoredFromStorage = false;
let imagineSavedDisplayCacheWrite = Promise.resolve();
let imagineSavedDisplayCacheWriteRevision = 0;

function imaginePendingSavedAccountId() {
  return String(activeImagineSavedAccount()?.id || account_state.imagine?.active_id || "").trim();
}

function imaginePendingSavedStorageKey() {
  const accountId = imaginePendingSavedAccountId();
  return accountId ? `${IMAGINE_PENDING_SAVED_STORAGE_PREFIX}${accountId}` : "";
}

function imagineGeneratedSavedSyncStorageKey(accountId = imaginePendingSavedAccountId()) {
  return accountId ? `${IMAGINE_GENERATED_SAVED_SYNC_STORAGE_PREFIX}${accountId}` : "";
}

function imagineGeneratedSavedSyncInProgress() {
  const accountId = imaginePendingSavedAccountId();
  return Boolean(
    accountId
    && imagineGeneratedSavedSyncAccountId === accountId
    && imagineGeneratedSavedSyncAssetIds.size,
  );
}

function persistImagineGeneratedSavedSync() {
  const storageKey = imagineGeneratedSavedSyncStorageKey(imagineGeneratedSavedSyncAccountId);
  if (!storageKey) return;
  try {
    if (imagineGeneratedSavedSyncAssetIds.size) {
      localStorage.setItem(storageKey, JSON.stringify([...imagineGeneratedSavedSyncAssetIds]));
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // The current session can still reconcile if browser storage is unavailable.
  }
}

function saveImagineSavedDisplayCache() {
  const accountId = imaginePendingSavedAccountId();
  if (!accountId) return;
  const posts = (library_state.imagineRemotePosts || [])
    .filter((post) => (
      isImagineRemoteMainPost(post)
      && imagineSavedPostProvenance(post) === "normal-saved"
      && !imagineSavedPostIsPending(post)
    ));
  const revision = ++imagineSavedDisplayCacheWriteRevision;
  const snapshot = JSON.parse(JSON.stringify(posts));
  // Serialize writes. A slower, older refresh must never overwrite a newer completed view.
  imagineSavedDisplayCacheWrite = imagineSavedDisplayCacheWrite
    .catch(() => {})
    .then(async () => {
      if (revision !== imagineSavedDisplayCacheWriteRevision) return;
      await qApi("/api/imagine/saved/display-cache/save", {
        account_id: accountId,
        posts: snapshot,
      });
    })
    .catch((error) => console.warn("Imagine display cache save failed", error));
}

function releaseImagineGeneratedSavedSyncForDeletedItems(items = []) {
  if (!imagineGeneratedSavedSyncAssetIds.size) return false;
  const deletedIds = new Set();
  for (const candidate of (Array.isArray(items) ? items : [items])) {
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value) deletedIds.add(value);
      continue;
    }
    if (!candidate || typeof candidate !== "object") continue;
    const metadata = candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
    const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
    for (const value of [
      ...imaginePostIdKeysForItem(candidate),
      candidate.official_asset_id,
      metadata.official_asset_id,
      metadata.official_clone_asset_id,
      imagine.official_asset_id,
      imagine.official_clone_asset_id,
      candidate.id,
    ]) {
      const id = String(value || "").trim();
      if (id) deletedIds.add(id);
    }
  }
  const released = new Set(
    [...imagineGeneratedSavedSyncAssetIds].filter((assetId) => deletedIds.has(assetId)),
  );
  if (!released.size) return false;
  for (const assetId of released) {
    imagineGeneratedSavedSyncAssetIds.delete(assetId);
    imagineGeneratedSavedOfficialAssetIds.delete(assetId);
  }
  setImagineGeneratedSavedSyncItemState(released, false);
  if (!imagineGeneratedSavedSyncAssetIds.size) {
    clearImagineGeneratedSavedSync();
  } else {
    persistImagineGeneratedSavedSync();
  }
  return true;
}

function removeImagineConfirmedDeletedPendingItems(posts, assetIds) {
  if (!assetIds?.size) return Array.isArray(posts) ? posts : [];
  return (posts || []).map((post) => {
    const previousItems = Array.isArray(post?.items) ? post.items : [];
    const items = previousItems.filter((item) => {
      const assetId = imagineSavedItemAssetId(item);
      return !assetId || !assetIds.has(assetId);
    });
    if (items.length === previousItems.length) return post;
    if (!items.length) return null;
    const metadata = post?.metadata && typeof post.metadata === "object"
      ? { ...post.metadata }
      : {};
    if (!items.some((item) => item?.metadata?.saved_sync_pending === true)) {
      delete metadata.saved_sync_pending;
    }
    const representative = representativeItem(items, { ...post, items }) || items[0] || null;
    return {
      ...post,
      items,
      metadata,
      representative_item: representative,
      representative: representative?.url || representative?.remote_url || representative?.item_id || "",
    };
  }).filter(Boolean);
}

function applyImagineConfirmedDeletedPendingAssets(data) {
  const assetIds = new Set(
    (Array.isArray(data?.confirmed_deleted_pending_asset_ids)
      ? data.confirmed_deleted_pending_asset_ids
      : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  if (!assetIds.size) return;
  releaseImagineGeneratedSavedSyncForDeletedItems([...assetIds]);
  library_state.imagineRemotePosts = removeImagineConfirmedDeletedPendingItems(
    library_state.imagineRemotePosts,
    assetIds,
  );
  library_state.imagineLikedPosts = removeImagineConfirmedDeletedPendingItems(
    library_state.imagineLikedPosts,
    assetIds,
  );
  // releaseImagineGeneratedSavedSyncForDeletedItems clears the pending marker. Persist
  // that cleaned card set now, otherwise app restart would restore the deleted bundle.
  persistImaginePendingSavedPosts();
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
}

function imagineItemMatchesGeneratedSavedSync(item, assetIds) {
  if (!item || !assetIds?.size) return false;
  return imaginePostIdKeysForItem(item).some((key) => assetIds.has(String(key || "").trim()));
}

function setImagineGeneratedSavedSyncItemState(assetIds, pending) {
  if (!assetIds?.size) return;
  const updatePosts = (posts) => (posts || []).map((post) => {
    let changed = false;
    const items = (post?.items || []).map((item) => {
      if (!imagineItemMatchesGeneratedSavedSync(item, assetIds)) return item;
      const metadata = item?.metadata && typeof item.metadata === "object" ? { ...item.metadata } : {};
      if (pending) metadata.saved_sync_pending = true;
      else delete metadata.saved_sync_pending;
      changed = true;
      return { ...item, metadata };
    });
    if (!changed) return post;
    const postMetadata = post?.metadata && typeof post.metadata === "object"
      ? { ...post.metadata }
      : {};
    const hasPendingItem = items.some((item) => item?.metadata?.saved_sync_pending === true);
    if (pending) postMetadata.saved_sync_pending = true;
    else if (!hasPendingItem) delete postMetadata.saved_sync_pending;
    const representative = imagineItemMatchesGeneratedSavedSync(post?.representative_item, assetIds)
      ? (items.find((item) => imagineItemMatchesGeneratedSavedSync(item, assetIds)) || post.representative_item)
      : post.representative_item;
    return { ...post, items, representative_item: representative, metadata: postMetadata };
  });
  library_state.imagineRemotePosts = updatePosts(library_state.imagineRemotePosts);
  library_state.imagineLikedPosts = updatePosts(library_state.imagineLikedPosts);
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
}

function cancelImagineGeneratedSavedSyncRefresh() {
  if (imagineGeneratedSavedSyncRefreshTimer) {
    window.clearTimeout(imagineGeneratedSavedSyncRefreshTimer);
    imagineGeneratedSavedSyncRefreshTimer = 0;
  }
  imagineGeneratedSavedSyncRefreshAttempt = 0;
}

function scheduleImagineGeneratedSavedSyncRefresh() {
  if (imagineGeneratedSavedSyncRefreshTimer || !imagineGeneratedSavedSyncInProgress()) return;
  const delays = [2000, 4000, 8000, 12000];
  if (imagineGeneratedSavedSyncRefreshAttempt >= delays.length) return;
  const delay = delays[imagineGeneratedSavedSyncRefreshAttempt];
  imagineGeneratedSavedSyncRefreshAttempt += 1;
  imagineGeneratedSavedSyncRefreshTimer = window.setTimeout(() => {
    imagineGeneratedSavedSyncRefreshTimer = 0;
    loadImagineSavedCards({ force: true }).catch(() => {});
  }, delay);
}

function clearImagineGeneratedSavedSync() {
  const settled = new Set(imagineGeneratedSavedSyncAssetIds);
  imagineGeneratedSavedOfficialAssetIds.clear();
  imagineGeneratedSavedSyncAssetIds.clear();
  imagineGeneratedSavedSyncRestoredFromStorage = false;
  cancelImagineGeneratedSavedSyncRefresh();
  setImagineGeneratedSavedSyncItemState(settled, false);
  persistImagineGeneratedSavedSync();
  renderImagineSourceCards();
  if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
  renderDetailViews();
}

function resetImagineGeneratedSavedSyncForAccountChange(nextAccountId = "") {
  const previousAssetIds = new Set(imagineGeneratedSavedSyncAssetIds);
  // Preserve the old account's pending acknowledgement so it can be reconciled if that
  // account is selected again, but never let it affect the newly selected account's cards.
  persistImagineGeneratedSavedSync();
  setImagineGeneratedSavedSyncItemState(previousAssetIds, false);
  imagineGeneratedSavedOfficialAssetIds.clear();
  imagineGeneratedSavedSyncAssetIds.clear();
  imagineGeneratedSavedSyncRestoredFromStorage = false;
  imagineGeneratedSavedSyncAccountId = String(nextAccountId || "").trim();
  if (!imagineGeneratedSavedSyncAccountId) return;
  try {
    const restored = JSON.parse(
      localStorage.getItem(imagineGeneratedSavedSyncStorageKey(imagineGeneratedSavedSyncAccountId)) || "[]",
    );
    for (const assetId of Array.isArray(restored) ? restored : []) {
      const value = String(assetId || "").trim();
      if (value) imagineGeneratedSavedSyncAssetIds.add(value);
    }
    imagineGeneratedSavedSyncRestoredFromStorage = imagineGeneratedSavedSyncAssetIds.size > 0;
  } catch {
    // Ignore malformed old session data.
  }
  // This is only a local marker. It keeps a just-finished card visible if a manual
  // refresh reaches Grok before Saved has committed that result; it never starts polling.
}

function restoreImagineGeneratedSavedSync() {
  const accountId = imaginePendingSavedAccountId();
  if (!accountId || imagineGeneratedSavedSyncAccountId === accountId) return;
  resetImagineGeneratedSavedSyncForAccountChange(accountId);
  if (imagineGeneratedSavedSyncAssetIds.size) {
    setImagineGeneratedSavedSyncItemState(imagineGeneratedSavedSyncAssetIds, true);
  }
}

function beginImagineGeneratedSavedSync(result) {
  const items = Array.isArray(result?.items) && result.items.length
    ? result.items
    : [result?.item].filter(Boolean);
  const assetIds = new Set(items.map((item) => {
    const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
    return String(
      item?.asset_id
      || imagine.asset_id
      || metadata.asset_id
      || item?.item_id
      || item?.id
      || item?.post_id
      || imagine.post_id
      || metadata.post_id
      || "",
    ).trim();
  }).filter(Boolean));
  if (!assetIds.size) return;
  const accountId = imaginePendingSavedAccountId();
  if (!accountId) return;
  if (
    imagineGeneratedSavedSyncAccountId
    && imagineGeneratedSavedSyncAccountId !== accountId
  ) {
    resetImagineGeneratedSavedSyncForAccountChange(accountId);
  }
  imagineGeneratedSavedSyncAccountId = accountId;
  imagineGeneratedSavedSyncRestoredFromStorage = false;
  imagineGeneratedSavedOfficialAssetIds.clear();
  for (const assetId of assetIds) imagineGeneratedSavedSyncAssetIds.add(assetId);
  // applyImagineDirectResult() has already placed this result in the main view. Mark it
  // as pending so an early manual refresh cannot remove it, but do not request Saved here.
  setImagineGeneratedSavedSyncItemState(assetIds, true);
  persistImagineGeneratedSavedSync();
  cancelImagineGeneratedSavedSyncRefresh();
}

function imagineSavedPostIsPending(post) {
  return Boolean(
    post?.metadata?.saved_sync_pending === true
    && (post?.items || []).some((item) => item?.metadata?.saved_sync_pending === true),
  );
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
  const metadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const provenance = imagineSavedPostProvenance(post);
  const displayGroup = imagineSavedDisplayGroup(post);
  const keys = new Set(imagineSavedExactResultKeys(post));
  if (displayGroup) {
    keys.add(imagineSavedScopedIdentity(post, displayGroup));
    return keys;
  }
  const savedAnchor = imagineSavedCardAnchor(post);
  if (savedAnchor) {
    keys.add(imagineSavedScopedIdentity(post, savedAnchor));
    return keys;
  }
  const exactAnchors = provenance === "cloned-liked"
    ? [post?.folder_path, metadata.link_post_id, imagine.link_post_id]
    : [post?.folder_path, post?.post_id, metadata.imagine_root_post_id];
  const compatibleAnchors = provenance === "cloned-liked" ? [] : [
    metadata.local_saved_group_id,
    metadata.conversation_id,
    imagine.conversation_id,
    metadata.link_post_id,
    imagine.link_post_id,
  ];
  for (const value of [...exactAnchors, ...compatibleAnchors]) {
    const key = imagineSavedScopedIdentity(post, value);
    if (key) keys.add(key);
  }
  return keys;
}

// Pending save confirmation is the one place where an item URL may be used as a
// short-lived acknowledgement. It must not leak into top-level card matching.
function imaginePendingSavedConfirmationKeys(post) {
  const keys = new Set(imaginePostIdKeysForPost(post).map((value) => String(value || "").trim()).filter(Boolean));
  for (const item of post?.items || []) {
    for (const key of imaginePostIdKeysForItem(item)) keys.add(String(key || "").trim());
  }
  return keys;
}

function imaginePendingSavedExpectedKeys(post) {
  const entries = Array.isArray(post?.metadata?.saved_sync_items) ? post.metadata.saved_sync_items : [];
  const expected = entries.map((entry) => new Set([
    entry?.liked_id,
    entry?.media_url,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  // A direct generation does not always have a Saved-specific URL yet, but its result
  // asset id is enough to recognise the same card when Grok later returns it.
  for (const item of post?.items || []) {
    if (item?.metadata?.saved_sync_pending !== true) continue;
    const assetId = imagineSavedItemAssetId(item);
    if (assetId) expected.push(new Set([assetId]));
  }
  return expected.filter((keys) => keys.size > 0);
}

function reconcileImaginePendingSavedPosts(remotePosts, memoryPending = []) {
  const pendingByPath = new Map();
  for (const post of [...restoreImaginePendingSavedPosts(), ...memoryPending]) {
    if (post?.folder_path && imagineSavedPostIsPending(post)) pendingByPath.set(post.folder_path, post);
  }
  if (!pendingByPath.size) return remotePosts;
  const remoteWithKeys = (remotePosts || []).map((post) => ({
    post,
    provenance: imagineSavedPostProvenance(post),
    keys: imaginePendingSavedConfirmationKeys(post),
  }));
  const unresolved = [];
  for (const pending of pendingByPath.values()) {
    const expected = imaginePendingSavedExpectedKeys(pending);
    const pendingProvenance = imagineSavedPostProvenance(pending);
    const confirmed = expected.length > 0 && expected.every((candidateKeys) => (
      Array.from(candidateKeys).some((key) => remoteWithKeys.some((entry) => (
        entry.provenance === pendingProvenance && entry.keys.has(key)
      )))
    ));
    if (!confirmed) unresolved.push(pending);
  }
  if (!unresolved.length) return remotePosts;
  const unresolvedKeysByProvenance = new Map();
  for (const post of unresolved) {
    const provenance = imagineSavedPostProvenance(post);
    if (!unresolvedKeysByProvenance.has(provenance)) unresolvedKeysByProvenance.set(provenance, new Set());
    const keys = unresolvedKeysByProvenance.get(provenance);
    for (const expected of imaginePendingSavedExpectedKeys(post)) {
      for (const key of expected) keys.add(key);
    }
  }
  const withoutPartialDuplicates = remoteWithKeys
    .filter((entry) => {
      const unresolvedKeys = unresolvedKeysByProvenance.get(entry.provenance);
      return !unresolvedKeys || !Array.from(entry.keys).some((key) => unresolvedKeys.has(key));
    })
    .map((entry) => entry.post);
  return [...unresolved, ...withoutPartialDuplicates];
}

function newImagineSavedSyncToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  library_state.imagineRemoteLoading = false;
  library_state.imagineRemoteSyncing = false;
  library_state.imagineRemoteSyncPromise = null;
}

function beginImagineSavedRequest({ supersede = false } = {}) {
  if (supersede) {
    library_state.imagineRemoteRequestController?.abort?.();
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

function collectImagineSavedOfficialAssetIds(data, accountId) {
  if (
    !imagineGeneratedSavedSyncInProgress()
    || imagineGeneratedSavedSyncAccountId !== accountId
  ) return;
  for (const assetId of Array.isArray(data?.official_asset_ids) ? data.official_asset_ids : []) {
    const value = String(assetId || "").trim();
    if (value) imagineGeneratedSavedOfficialAssetIds.add(value);
  }
}

function applyImagineSavedOfficialPage(data, { replacesList = false } = {}) {
  applyImagineConfirmedDeletedPendingAssets(data);
  applyImagineLikedExclusionSnapshot(data, imaginePendingSavedAccountId());
  collectImagineSavedOfficialAssetIds(data, imaginePendingSavedAccountId());
  const remotePosts = normalizeImagineRemotePosts(
    Array.isArray(data.posts) ? data.posts : [],
  );
  const currentPosts = (library_state.imagineRemotePosts || [])
    .filter((post) => !imagineSavedPostIsPending(post));
  const pending = [
    ...restoreImaginePendingSavedPosts(),
    ...imaginePendingSavedPosts(),
  ];
  // Saved follows the same visual rule as Liked: keep matched cards anchored, merge the
  // refreshed snapshot, then put the cards in latest-activity order.
  library_state.imagineRemotePosts = filterImagineMainLikedScopePosts(reconcileImagineSavedDisplayPosts(
    reconcileImaginePendingSavedPosts(
      mergeImagineSyncedPosts(currentPosts, remotePosts, {
        replacesList,
        preserveMatchedAnchors: true,
        sortByRecentActivity: true,
      }),
      pending,
    ),
  ));
  library_state.imagineRemoteCursor = String(data.next_cursor || "");
  library_state.imagineRemoteSyncToken = String(
    data.sync_token || library_state.imagineRemoteSyncToken || "",
  );
  library_state.imagineRemoteHasMore = Boolean(
    data.has_more && library_state.imagineRemoteCursor,
  );
  // A complete initial or user-triggered refresh settles only the results Grok now
  // confirms. Unconfirmed generated cards remain in place, and a short background
  // retry (scheduleImagineGeneratedSavedSyncRefresh) gives Saved a few more chances
  // to catch up before leaving it to the next explicit refresh.
  if (data.has_more === false && imagineGeneratedSavedSyncInProgress()) {
    const confirmed = [...imagineGeneratedSavedSyncAssetIds].every((assetId) => (
      imagineGeneratedSavedOfficialAssetIds.has(assetId)
    ));
    if (confirmed) clearImagineGeneratedSavedSync();
    else {
      setImagineGeneratedSavedSyncItemState(imagineGeneratedSavedSyncAssetIds, true);
      scheduleImagineGeneratedSavedSyncRefresh();
    }
  }
  if (data.has_more === false) saveImagineSavedDisplayCache();
  syncImagineRemotePostsIntoLibrary();
  renderImagineSourceCards();
}

function combineImagineSavedOfficialPages(pages) {
  const completedPage = pages.at(-1) || {};
  const officialAssetIds = new Set();
  const confirmedDeletedPendingAssetIds = new Set();
  const posts = [];
  for (const page of pages || []) {
    for (const post of Array.isArray(page?.posts) ? page.posts : []) posts.push(post);
    for (const assetId of Array.isArray(page?.official_asset_ids) ? page.official_asset_ids : []) {
      const value = String(assetId || "").trim();
      if (value) officialAssetIds.add(value);
    }
    for (const assetId of Array.isArray(page?.confirmed_deleted_pending_asset_ids)
      ? page.confirmed_deleted_pending_asset_ids
      : []) {
      const value = String(assetId || "").trim();
      if (value) confirmedDeletedPendingAssetIds.add(value);
    }
  }
  return {
    ...completedPage,
    posts,
    official_asset_ids: [...officialAssetIds],
    confirmed_deleted_pending_asset_ids: [...confirmedDeletedPendingAssetIds],
    next_cursor: "",
    has_more: false,
  };
}

async function streamImagineSavedPages(context, { stage = false } = {}) {
  const seenCursors = new Set();
  const stagedPages = [];
  let cursor = "";
  let replacesList = true;
  library_state.imagineRemoteCursor = "";
  library_state.imagineRemoteSyncToken = newImagineSavedSyncToken();

  while (imagineSavedRequestIsCurrent(context) && canLoadImagineSavedList()) {
    const data = await qApi("/api/imagine/saved", {
      account_id: context.accountId,
      limit: IMAGINE_SAVED_PAGE_SIZE,
      cursor,
      sync_token: library_state.imagineRemoteSyncToken,
      pending_asset_ids: [...imagineGeneratedSavedSyncAssetIds],
      // A result made in this running session gets one complete Saved read before exact
      // deletion checks begin. Restored pending state has already crossed an app restart,
      // so it can be checked immediately without preserving a stale card for another pass.
      confirm_pending_asset_deletions: (
        imagineGeneratedSavedSyncRestoredFromStorage
        || imagineGeneratedSavedSyncRefreshAttempt > 0
      ),
    }, { signal: context.controller.signal });
    if (!imagineSavedResponseMatches(context, data)) return false;

    // A first-page exact 404/410 can remove a restored card immediately; the remaining
    // Saved pages are still staged and replace the list authoritatively when complete.
    applyImagineConfirmedDeletedPendingAssets(data);

    if (stage) stagedPages.push(data);
    else applyImagineSavedOfficialPage(data, { replacesList });
    if (data.has_more === false) {
      // Background confirmation requests used to replace the visible list with page one,
      // then append every later page. Keep the last complete Grok feed on screen and make
      // a single authoritative replacement only after this refresh has finished.
      if (stage) {
        applyImagineSavedOfficialPage(
          combineImagineSavedOfficialPages(stagedPages),
          { replacesList: true },
        );
      }
      return true;
    }
    const nextCursor = String(data.next_cursor || "");
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("Imagine Saved pagination did not complete.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    replacesList = false;
  }
  return false;
}

async function loadImagineSavedCards({ force = false, append = false } = {}) {
  if (force && (library_state.imagineRemoteLoading || library_state.imagineRemoteSyncing)) {
    library_state.imagineRemoteRequestController?.abort?.();
    library_state.imagineRemoteLoading = false;
    library_state.imagineRemoteSyncing = false;
    library_state.imagineRemoteSyncPromise = null;
  }
  if (library_state.imagineRemoteLoading || library_state.imagineRemoteSyncing) {
    return library_state.imagineRemoteSyncPromise || undefined;
  }
  if (!force && !append && library_state.imagineRemoteLoaded) return;
  // The cache is painted first. Keep it visible until the complete live Saved feed has
  // arrived, then merge it once using Liked's latest-activity ordering.
  if (append || !canLoadImagineSavedList()) return;

  restoreImagineGeneratedSavedSync();
  const context = beginImagineSavedRequest({ supersede: force });
  if (!context) return;
  library_state.imagineRemoteLoading = true;
  library_state.imagineRemoteSyncing = true;
  library_state.imagineRemoteError = "";
  library_state.imagineRemoteHasMore = false;
  let completed = false;
  // Saved is paged whereas Liked arrives as one response. Stage every Saved read so its
  // ordering changes only once, after the complete live snapshot has arrived.
  const stageRefresh = true;
  const syncPromise = streamImagineSavedPages(context, { stage: stageRefresh });
  library_state.imagineRemoteSyncPromise = syncPromise;
  try {
    completed = await syncPromise;
    if (!completed || !imagineSavedRequestIsCurrent(context)) return;
    library_state.imagineRemoteCacheLoaded = true;
    library_state.imagineRemoteCacheHasMore = false;
    library_state.imagineRemoteCacheOffset = 0;
    library_state.imagineRemoteLoaded = true;
    library_state.imagineRemoteCursor = "";
    library_state.imagineRemoteError = "";
    completed = true;
  } catch (error) {
    if (!imagineSavedRequestCancelled(error, context) && !library_state.imagineRemotePosts.length) {
      library_state.imagineRemoteError = error?.message || "Imagine saved list failed.";
    }
  } finally {
    if (imagineSavedRequestIsCurrent(context)) {
      library_state.imagineRemoteLoading = false;
      library_state.imagineRemoteSyncing = false;
      library_state.imagineRemoteHasMore = false;
      if (completed) {
        persistImaginePendingSavedPosts();
      }
      library_state.imagineRemoteSyncPromise = null;
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
    if (cachedPosts.length) {
      library_state.imagineDiscoverPosts = mergeImagineDiscoverRefreshedPosts(
        library_state.imagineDiscoverPosts || [],
        cachedPosts,
      );
    }
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
  // Every card here costs multiple round trips to grok.com. Paint the account cache only
  // when memory has no cards, then keep that stable view while the live page revalidates.
  if (!(library_state.imagineLikedPosts || []).length) {
    try {
      const cached = await qApi("/api/imagine/liked/cache", { account_id: accountId, limit: 5000 });
      if (imagineAccountResponseIsCurrent(accountId, requestEpoch, cached)) {
        applyImagineLikedExclusionSnapshot(cached, accountId);
        const cachedPosts = (Array.isArray(cached?.posts) ? cached.posts : []).map(normalizeServerPost);
        if (cachedPosts.length) {
          library_state.imagineLikedPosts = reconcileImagineLikedLineagePosts(
            mergeImagineSyncedPosts(
              library_state.imagineLikedPosts || [],
              cachedPosts,
              { replacesList: false, preserveMatchedAnchors: true },
            ),
          );
          syncImagineRemotePostsIntoLibrary();
          renderImagineSourceCards();
        }
      }
    } catch (error) {
      console.warn(error);
    }
  }
  try {
    const data = await qApi("/api/imagine/liked", { account_id: accountId, limit: 100 });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    applyImagineLikedExclusionSnapshot(data, accountId);
    const livePosts = (Array.isArray(data.posts) ? data.posts : []).map(normalizeServerPost);
    library_state.imagineLikedPosts = reconcileImagineLikedLineagePosts(
      mergeImagineSyncedPosts(
        library_state.imagineLikedPosts || [],
        livePosts,
        {
          replacesList: data.complete === true,
          preserveMatchedAnchors: true,
        },
      ),
    );
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

async function loadImagineSavedCacheCards() {
  if (library_state.imagineRemoteCacheLoaded || library_state.imagineRemoteCacheLoading) return;
  if (!canLoadImagineSavedCache()) return;
  const accountId = imaginePendingSavedAccountId();
  const requestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0);
  if (!accountId) return;
  library_state.imagineRemoteCacheLoading = true;
  renderImagineSourceCards();
  try {
    let data = await qApi("/api/imagine/saved/display-cache", { account_id: accountId });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    let cachedPosts = normalizeImagineRemotePosts(Array.isArray(data?.posts) ? data.posts : []);
    // The display cache is the previous complete, reconciled screen. If it is not available
    // yet, migrate once from the legacy page-fragment cache and let the live read create it.
    if (data?.found !== true) {
      data = await qApi("/api/imagine/saved/cache", { account_id: accountId, limit: 5000 });
      if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
      applyImagineLikedExclusionSnapshot(data, accountId);
      cachedPosts = normalizeImagineRemotePosts(Array.isArray(data?.posts) ? data.posts : []);
    }
    if (cachedPosts.length) {
      const pending = [
        ...restoreImaginePendingSavedPosts(),
        ...imaginePendingSavedPosts(),
      ];
      library_state.imagineRemotePosts = filterImagineMainLikedScopePosts(reconcileImagineSavedDisplayPosts(
        reconcileImaginePendingSavedPosts(
          mergeImagineSyncedPosts(library_state.imagineRemotePosts || [], cachedPosts, {
            replacesList: false,
            preserveMatchedAnchors: true,
            sortByRecentActivity: true,
          }),
          pending,
        ),
      ));
      syncImagineRemotePostsIntoLibrary();
    }
    library_state.imagineRemoteCacheOffset = data?.found === true ? 0 : Number(data?.next_offset || 0);
    library_state.imagineRemoteCacheHasMore = Boolean(
      data?.found !== true && data?.has_more && library_state.imagineRemoteCacheOffset,
    );
  } catch (_) {
    // An unavailable cache simply falls through to the live Saved read.
  } finally {
    if (imagineAccountResponseIsCurrent(accountId, requestEpoch)) {
      library_state.imagineRemoteCacheLoaded = true;
      library_state.imagineRemoteCacheLoading = false;
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
        .filter((post) => imagineSavedPostProvenance(post) === "normal-saved")
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
    && !library_state.imagineRemoteCacheLoaded
    && !library_state.imagineRemoteCacheLoading
    && canLoadImagineSavedCache()
  ) {
    loadImagineSavedCacheCards().catch(() => {});
  }
  if (
    library_state.iMainView === imagineViewValue("IMAGINE", "imagine")
    && library_state.imagineRemoteCacheLoaded
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
  const likedView = library_state.iMainView === imagineViewValue("LIKED", "liked");
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
    if (library_state.imagineLikedLoading && !posts.length && likedView) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (library_state.imagineLikedError && !posts.length && likedView) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(library_state.imagineLikedError));
    } else if (library_state.imagineUploadLoading && !posts.length && uploadView) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (library_state.imagineUploadError && !posts.length && uploadView) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(library_state.imagineUploadError));
    } else if ((library_state.imagineRemoteCacheLoading || library_state.imagineRemoteLoading) && !posts.length && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (library_state.imagineRemoteError && !posts.length && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(library_state.imagineRemoteError));
    } else if (
      imagineSavedAccountNeedsLogin()
      && (library_state.iMainView === imagineViewValue("IMAGINE", "imagine") || uploadView || likedView)
    ) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Imagine login expired. Register the account again."));
    } else if (!posts.length && !visibleJobs.length) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(
        t2iView ? "No T2I items." : (uploadView ? "No upload images." : (likedView ? "No liked items." : "")),
      ));
    } else if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine") || uploadView || likedView) {
      renderVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list, orderedMainGenerationCards(
        "imagine",
        [...mainJobEntries, ...mainPostEntries],
      ), {
        loading: likedView
          ? library_state.imagineLikedLoading
          : (uploadView
            ? library_state.imagineUploadLoading
            : (library_state.imagineRemoteCacheLoading || library_state.imagineRemoteLoading)),
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
  if (uploadView) {
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
      loading: library_state.imagineDiscoverLoading,
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
