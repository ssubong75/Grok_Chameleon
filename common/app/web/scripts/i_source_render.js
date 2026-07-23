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

function rememberHiddenImagineItem(item) {
  if (!(library_state.imagineHiddenPostIds instanceof Set)) {
    library_state.imagineHiddenPostIds = new Set();
  }
  const settings = library_state.library?.settings && typeof library_state.library.settings === "object"
    ? library_state.library.settings
    : {};
  const stored = new Set(Array.isArray(settings.hidden_imagine_item_keys)
    ? settings.hidden_imagine_item_keys.map((value) => String(value || "")).filter(Boolean)
    : []);
  for (const key of imaginePostIdKeysForItem(item)) {
    library_state.imagineHiddenPostIds.add(key);
    stored.add(key);
  }
  settings.hidden_imagine_item_keys = Array.from(stored);
  library_state.library = library_state.library && typeof library_state.library === "object" ? library_state.library : {};
  library_state.library.settings = settings;
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

function imaginePostHidden(post) {
  const hidden = library_state.imagineHiddenRemotePostIds;
  if (!(hidden instanceof Set) || !hidden.size) return false;
  return imaginePostIdKeysForPost(post).some((key) => hidden.has(key));
}

function imagineItemHidden(item) {
  const hidden = library_state.imagineHiddenPostIds;
  if (!(hidden instanceof Set) || !hidden.size) return false;
  return imaginePostIdKeysForItem(item).some((key) => hidden.has(key));
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
  const items = (post.items || []).filter((item) => !imagineItemHidden(item));
  if (!items.length) return null;
  const representative = representativeItem(items, { ...post, items }) || items[0];
  return normalizeServerPost({
    ...post,
    items,
    representative: representative?.file || representative?.url || representative?.item_id || "",
    representative_item: representative,
  });
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
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  return Array.from(merged.values());
}

async function loadImagineSavedCards({ force = false, append = false } = {}) {
  if (library_state.imagineRemoteLoading) return;
  if (!force && !append && library_state.imagineRemoteLoaded) return;
  if (append && !library_state.imagineRemoteCursor) return;
  if (!canLoadImagineSavedList()) return;
  library_state.imagineRemoteLoading = true;
  library_state.imagineRemoteError = "";
  renderImagineSourceCards();
  try {
    const data = await qApi("/api/imagine/saved", {
      limit: 20,
      cursor: force ? "" : (append ? (library_state.imagineRemoteCursor || "") : ""),
    });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = normalizeImagineRemotePosts(posts);
    library_state.imagineRemotePosts = append && !force
      ? mergeImagineRemotePosts(library_state.imagineRemotePosts || [], normalized)
      : normalized;
    library_state.imagineRemoteCursor = String(data.next_cursor || "");
    library_state.imagineRemoteHasMore = Boolean(data.has_more && library_state.imagineRemoteCursor);
    library_state.imagineRemoteLoaded = true;
  } catch (error) {
    library_state.imagineRemoteError = error?.message || "Imagine saved list failed.";
  } finally {
    library_state.imagineRemoteLoading = false;
    renderImagineSourceCards();
  }
}

function maybeLoadMoreImagineSavedCards() {
  const list = document.querySelector(".i_card_list");
  if (!list) return;
  if (library_state.iMainView !== imagineViewValue("IMAGINE", "imagine")) return;
  if (!library_state.imagineRemoteLoaded || !library_state.imagineRemoteHasMore) return;
  if (library_state.imagineRemoteLoading) return;
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
  library_state.imagineDiscoverLoading = true;
  library_state.imagineDiscoverError = "";
  renderImagineDiscoverCards();
  try {
    const data = await qApi("/api/imagine/discover", {
      limit: 20,
      cursor: force ? "" : (append ? (library_state.imagineDiscoverCursor || "") : ""),
      media_type: "video",
    });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = normalizeImagineDiscoverPosts(posts);
    library_state.imagineDiscoverPosts = append && !force
      ? mergeImagineDiscoverPosts(library_state.imagineDiscoverPosts || [], normalized)
      : normalized;
    library_state.imagineDiscoverCursor = String(data.next_cursor || "");
    library_state.imagineDiscoverHasMore = Boolean(data.has_more && library_state.imagineDiscoverCursor);
    library_state.imagineDiscoverLoaded = true;
  } catch (error) {
    library_state.imagineDiscoverError = error?.message || "Imagine Discover list failed.";
  } finally {
    library_state.imagineDiscoverLoading = false;
    renderImagineDiscoverCards();
  }
}

async function loadImagineUnsavedCards({ force = false, append = false } = {}) {
  if (library_state.imagineUnsavedLoading) return;
  if (!force && !append && library_state.imagineUnsavedLoaded) return;
  if (append && !library_state.imagineUnsavedCursor) return;
  if (!canLoadImagineSavedList()) return;
  library_state.imagineUnsavedLoading = true;
  library_state.imagineUnsavedError = "";
  renderImagineUnsavedCards();
  try {
    const data = await qApi("/api/imagine/unsaved", {
      limit: 20,
      cursor: force ? "" : (append ? (library_state.imagineUnsavedCursor || "") : ""),
    });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = normalizeImagineUnsavedPosts(posts);
    library_state.imagineUnsavedPosts = append && !force
      ? mergeImagineUnsavedPosts(library_state.imagineUnsavedPosts || [], normalized)
      : normalized;
    library_state.imagineUnsavedCursor = String(data.next_cursor || "");
    library_state.imagineUnsavedHasMore = Boolean(data.has_more && library_state.imagineUnsavedCursor);
    library_state.imagineUnsavedLoaded = true;
  } catch (error) {
    library_state.imagineUnsavedError = error?.message || "Imagine Unsaved list failed.";
  } finally {
    library_state.imagineUnsavedLoading = false;
    renderImagineUnsavedCards();
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
    return (library_state.imagineRemotePosts || []).filter((post) => (
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
    } else if (library_state.imagineRemoteError && !visibleJobs.length && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) {
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
  document.getElementById("i_unsaved_nav_btn")?.classList.toggle("active", library_state.iMainView === imagineViewValue("UNSAVED", "unsaved"));
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
}

bindVirtualCardListScroll(
  IMAGINE_DISCOVER_VIRTUAL_LIST_KEY,
  document.querySelector(".i_discover_card_list"),
  maybeLoadMoreImagineDiscoverCards,
);
bindVirtualCardListScroll(
  IMAGINE_UNSAVED_VIRTUAL_LIST_KEY,
  document.querySelector(".i_unsaved_card_list"),
  maybeLoadMoreImagineUnsavedCards,
);
bindVirtualCardListScroll(
  IMAGINE_VIRTUAL_LIST_KEY,
  document.querySelector(".i_card_list"),
  maybeLoadMoreImagineSavedCards,
);
document.getElementById("i_unsaved_refresh_btn")?.addEventListener("click", () => {
  library_state.imagineUnsavedLoaded = false;
  library_state.imagineUnsavedCursor = "";
  loadImagineUnsavedCards({ force: true }).catch((error) => {
    library_state.imagineUnsavedError = error?.message || "Imagine Unsaved list failed.";
    library_state.imagineUnsavedLoading = false;
    renderImagineUnsavedCards();
  });
});

function openImagineUnsaved() {
  library_state.iMainView = imagineViewValue("UNSAVED", "unsaved");
  setImagineTab("i_unsaved_nav_btn");
  setImagineLinkInputOpen(false);
  openScreen("i_unsaved_main", "i_unsaved_nav_btn");
  renderImagineUnsavedCards();
}
