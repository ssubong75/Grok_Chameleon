// Imagine source list filtering and rendering
const IMAGINE_VIRTUAL_LIST_KEY = "imagine-main";
const IMAGINE_DISCOVER_VIRTUAL_LIST_KEY = "imagine-discover";
const IMAGINE_UNSAVED_VIRTUAL_LIST_KEY = "imagine-unsaved";

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
  const representative = post?.representative_item || representativeItem(post?.items || [], post) || post?.items?.[0] || {};
  const representativeMetadata = representative?.metadata && typeof representative.metadata === "object" ? representative.metadata : {};
  const representativeImagine = representativeMetadata.imagine && typeof representativeMetadata.imagine === "object"
    ? representativeMetadata.imagine
    : {};
  return [
    post?.folder_path,
    post?.post_id,
    metadata.imagine_root_post_id,
    metadata.raw_root_post_id,
    representative?.root_post_id,
    representativeMetadata.root_post_id,
    representativeImagine.root_post_id,
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

function mergeImagineRefreshedPosts(existingPosts, refreshedPosts) {
  const existing = reconcileImagineSavedDisplayPosts(existingPosts || []);
  const refreshed = reconcileImagineSavedDisplayPosts(refreshedPosts || []);
  if (!existing.length) return refreshed;
  if (!refreshed.length) return [];

  const existingKeys = existing.map(imagineSavedPostMatchKeys);
  const matchedExistingIndexes = new Set();
  const refreshedForExistingIndex = new Map();
  const newPosts = [];

  for (const post of refreshed) {
    const exactIndex = existing.findIndex((candidate, index) => (
      !matchedExistingIndexes.has(index)
      && candidate?.folder_path
      && candidate.folder_path === post?.folder_path
    ));
    const postKeys = imagineSavedPostMatchKeys(post);
    const matchedIndex = exactIndex >= 0
      ? exactIndex
      : existingKeys.findIndex((keys, index) => (
        !matchedExistingIndexes.has(index)
        && !(
          isImagineT2iGroupContainer(post)
          && existing[index]?.metadata?.local_heart === true
        )
        && !(
          post?.metadata?.local_heart === true
          && isImagineT2iGroupContainer(existing[index])
        )
        && Array.from(postKeys).some((key) => keys.has(key))
      ));
    if (matchedIndex < 0) {
      newPosts.push(post);
      continue;
    }
    matchedExistingIndexes.add(matchedIndex);
    refreshedForExistingIndex.set(matchedIndex, post);
  }

  return [
    ...newPosts,
    ...existing.map((post, index) => refreshedForExistingIndex.get(index)).filter(Boolean),
  ];
}

function mergeImagineSyncedPosts(existingPosts, refreshedPosts) {
  const existing = reconcileImagineSavedDisplayPosts(existingPosts || []);
  const refreshed = reconcileImagineSavedDisplayPosts(refreshedPosts || []);
  if (!existing.length) return refreshed;
  if (!refreshed.length) return existing;

  const existingKeys = existing.map(imagineSavedPostMatchKeys);
  const matchedExistingIndexes = new Set();
  const refreshedForExistingIndex = new Map();
  const newPosts = [];

  for (const post of refreshed) {
    const exactIndex = existing.findIndex((candidate, index) => (
      !matchedExistingIndexes.has(index)
      && candidate?.folder_path
      && candidate.folder_path === post?.folder_path
    ));
    const postKeys = imagineSavedPostMatchKeys(post);
    const matchedIndex = exactIndex >= 0
      ? exactIndex
      : existingKeys.findIndex((keys, index) => (
        !matchedExistingIndexes.has(index)
        && Array.from(postKeys).some((key) => keys.has(key))
      ));
    if (matchedIndex < 0) {
      newPosts.push(post);
      continue;
    }
    matchedExistingIndexes.add(matchedIndex);
    refreshedForExistingIndex.set(matchedIndex, post);
  }

  return [
    ...newPosts,
    ...existing.map((post, index) => refreshedForExistingIndex.get(index) || post),
  ].sort((left, right) => (
    String(right?.created_at || "").localeCompare(String(left?.created_at || ""))
    || String(left?.folder_path || "").localeCompare(String(right?.folder_path || ""))
  ));
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

function reconcileImagineSavedDisplayPosts(posts) {
  const merged = mergeImagineRemotePosts([], posts || []);
  const groupedPosts = merged.filter((post) => post?.metadata?.flat_only !== true);
  const groupedAssetIds = new Set(groupedPosts.flatMap((post) => (
    (post.items || []).map(imagineSavedItemAssetId).filter(Boolean)
  )));
  const groupedSourceIds = new Set(groupedPosts.flatMap((post) => (
    (post.items || []).flatMap(imagineSavedItemSourceIds)
  )));
  return merged.map((post) => {
    if (post?.metadata?.flat_only !== true) return post;
    const items = (post.items || []).filter((item) => {
      const assetId = imagineSavedItemAssetId(item);
      return assetId && !groupedAssetIds.has(assetId) && !groupedSourceIds.has(assetId);
    });
    if (!items.length) return null;
    const representative = representativeItem(items, { ...post, items }) || items[0];
    return normalizeServerPost({
      ...post,
      items,
      representative: representative?.file || representative?.url || representative?.item_id || "",
      representative_item: representative,
    });
  }).filter(Boolean);
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

function applyImagineSavedRemotePage(data) {
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
      mergeImagineSyncedPosts(currentPosts, normalized),
      pending,
    ),
  );
  library_state.imagineRemoteCursor = String(data.next_cursor || "");
  library_state.imagineRemoteSyncToken = String(
    data.sync_token || library_state.imagineRemoteSyncToken || "",
  );
}

async function syncImagineSavedCards(context, { append = false, force = false, showLoading = false } = {}) {
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
    applyImagineSavedRemotePage(data);
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
      renderImagineSourceCards();
    }
    finishImagineSavedRequest(context);
  }
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
          limit: 60,
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
        renderImagineSourceCards();
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
      library_state.imagineRemoteSyncing = true;
      renderImagineSourceCards();
      const syncPromise = syncImagineSavedCards(context, { append: false, force: false, showLoading: false });
      library_state.imagineRemoteSyncPromise = syncPromise;
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
  if (remaining > 240) return;
  loadImagineSavedCards({ append: true }).catch((error) => {
    library_state.imagineRemoteError = error?.message || "Imagine saved list failed.";
    library_state.imagineRemoteLoading = false;
    renderImagineSourceCards();
  });
}

function mergeImagineDiscoverPosts(existingPosts, nextPosts) {
  const merged = new Map();
  for (const post of existingPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  for (const post of nextPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  return Array.from(merged.values());
}

function mergeImagineUnsavedPosts(existingPosts, nextPosts) {
  const merged = new Map();
  for (const post of existingPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  for (const post of nextPosts || []) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  return Array.from(merged.values());
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
  renderImagineDiscoverCards();
  try {
    const data = await qApi("/api/imagine/discover", {
      account_id: accountId,
      limit: 20,
      cursor: force ? "" : (append ? (library_state.imagineDiscoverCursor || "") : ""),
      media_type: "video",
    });
    if (!imagineAccountResponseIsCurrent(accountId, requestEpoch, data)) return;
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = normalizeImagineDiscoverPosts(posts);
    library_state.imagineDiscoverPosts = append && !force
      ? mergeImagineDiscoverPosts(library_state.imagineDiscoverPosts || [], normalized)
      : normalized;
    library_state.imagineDiscoverCursor = String(data.next_cursor || "");
    library_state.imagineDiscoverHasMore = Boolean(data.has_more && library_state.imagineDiscoverCursor);
    library_state.imagineDiscoverLoaded = true;
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
      : normalized;
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

function imagineSourcePosts() {
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
    return reconcileImagineSavedDisplayPosts(library_state.imagineRemotePosts || []).filter((post) => (
      !isImagineT2iPost(post) && !isImagineT2iGroupContainer(post)
    ));
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
    return jobs.filter((job) => (
      !(typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job))
      && !(typeof generationJobHasSourcePost === "function" && generationJobHasSourcePost(job))
    ));
  }
  return [];
}

function renderImagineSourceCards() {
  if (library_state.imagineRemotePosts?.length) syncImagineRemotePostsIntoLibrary();
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
  const list = document.querySelector(".i_card_list");
  if (list) {
    if (library_state.imagineRemoteLoading && !posts.length && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (library_state.imagineRemoteError && !posts.length && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(library_state.imagineRemoteError));
    } else if (imagineSavedAccountNeedsLogin() && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Imagine login expired. Register the account again."));
    } else if (!posts.length && !visibleJobs.length) {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(t2iView ? "No T2I items." : ""));
    } else if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
      renderVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list, [
        ...visibleJobs.map((job) => mediaCardForBuildJob(job)),
        ...posts.map((post) => virtualCardRenderSpecForPost(post, "i_card")),
      ], {
        loading: library_state.imagineRemoteLoading,
        remoteMedia: true,
      });
    } else {
      disableVirtualCardList(IMAGINE_VIRTUAL_LIST_KEY, list);
      replaceCardListChildren(list, [
        ...(t2iView ? posts.map((post) => mediaCardForPost(post, "i_card")) : visibleJobs.map((job) => mediaCardForBuildJob(job))),
        ...(t2iView ? visibleJobs.flatMap(mediaCardsForBuildJob) : []),
        ...(!t2iView ? posts.map((post) => mediaCardForPost(post, "i_card")) : []),
      ]);
    }
  }
  document.getElementById("i_imagine_tab_btn")?.classList.toggle("active", library_state.iMainView === imagineViewValue("IMAGINE", "imagine"));
  document.getElementById("i_t2i_btn")?.classList.toggle("active", t2iView);
  const count = document.querySelector(".i_main_header p");
  const jobSlots = t2iView
    ? visibleJobs.reduce((total, job) => total + (typeof visibleGenerationJobSlots === "function" ? visibleGenerationJobSlots(job).length : buildJobT2iSlotCount(job)), 0)
    : visibleJobs.length;
  if (count) count.textContent = `${posts.length + jobSlots} items`;
  if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
    requestAnimationFrame(maybeLoadMoreImagineSavedCards);
  }
}

function maybeLoadMoreImagineDiscoverCards() {
  const list = document.querySelector(".i_discover_card_list");
  if (!list) return;
  if (!library_state.imagineDiscoverLoaded || !library_state.imagineDiscoverHasMore) return;
  if (library_state.imagineDiscoverLoading) return;
  const remaining = virtualCardListRemaining(list);
  if (remaining > 240) return;
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
  if (remaining > 240) return;
  loadImagineUnsavedCards({ append: true }).catch((error) => {
    library_state.imagineUnsavedError = error?.message || "Imagine Unsaved list failed.";
    library_state.imagineUnsavedLoading = false;
    renderImagineUnsavedCards();
  });
}

function renderImagineDiscoverCards() {
  if (library_state.imagineDiscoverPosts?.length) syncImagineRemotePostsIntoLibrary();
  if (
    !library_state.imagineDiscoverLoaded
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
  if (library_state.imagineDiscoverLoading && !posts.length) {
    disableVirtualCardList(IMAGINE_DISCOVER_VIRTUAL_LIST_KEY, list);
    list.replaceChildren(emptyLibraryNode("Loading . . ."));
  } else if (library_state.imagineDiscoverError) {
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
  maybeLoadMoreImagineSavedCards,
);
