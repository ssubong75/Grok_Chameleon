// Unified sidebar search results
let imagineSearchDebounceTimer = null;

function searchQueryActive() {
  return Boolean(String(library_state.searchQuery || "").trim());
}

function searchBuildPosts() {
  if (library_state.libraryIndexEnabled) {
    return library_state.indexedSearchBuildPosts || [];
  }
  const posts = (library_state.posts || []).filter((post) => {
    if (typeof isBuildPost === "function") return isBuildPost(post);
    return post?.source !== "imagine";
  });
  return filterPostsBySearch(posts);
}

function searchImaginePosts() {
  const remotePosts = Array.isArray(library_state.imagineRemotePosts)
    ? library_state.imagineRemotePosts
    : [];
  const searchPosts = Array.isArray(library_state.imagineSearchPosts)
    ? library_state.imagineSearchPosts
    : [];
  const merged = new Map();
  for (const post of [...filterPostsBySearch(remotePosts), ...searchPosts]) {
    if (post?.folder_path) merged.set(post.folder_path, post);
  }
  return Array.from(merged.values());
}

function searchPromptItems() {
  return typeof filterPromptsBySearch === "function"
    ? filterPromptsBySearch(library_state.prompts || [])
    : [];
}

function maybeLoadImagineForSearch() {
  if (!searchQueryActive()) return;
  if (library_state.imagineRemoteLoaded || library_state.imagineRemoteLoading) return;
  if (typeof canLoadImagineSavedList !== "function" || !canLoadImagineSavedList()) return;
  loadImagineSavedCards({ force: false })
    .then(() => {
      if (screen_state.current_screen === "search_main") renderSearchResults();
    })
    .catch(() => {
      if (screen_state.current_screen === "search_main") renderSearchResults();
    });
}

function resetImagineSearchResults() {
  if (imagineSearchDebounceTimer) {
    clearTimeout(imagineSearchDebounceTimer);
    imagineSearchDebounceTimer = null;
  }
  library_state.imagineSearchPosts = [];
  library_state.imagineSearchQuery = "";
  library_state.imagineSearchScheduledQuery = "";
  library_state.imagineSearchLoaded = false;
  library_state.imagineSearchLoading = false;
  library_state.imagineSearchError = "";
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
}

async function loadImagineSearchResults(query) {
  const currentQuery = String(query || "").trim();
  if (!currentQuery || currentQuery !== String(library_state.searchQuery || "").trim()) return;
  library_state.imagineSearchScheduledQuery = "";
  library_state.imagineSearchLoading = true;
  library_state.imagineSearchLoaded = false;
  library_state.imagineSearchError = "";
  library_state.imagineSearchQuery = currentQuery;
  renderSearchResults();
  try {
    const data = await qApi("/api/imagine/search", {
      query: currentQuery,
      limit: 100,
      account_id: account_state.imagine?.active_id || "",
    });
    if (currentQuery !== String(library_state.searchQuery || "").trim()) return;
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const normalized = typeof normalizeImagineSearchPosts === "function"
      ? normalizeImagineSearchPosts(posts)
      : posts.map(normalizeServerPost);
    library_state.imagineSearchPosts = typeof mergeImagineExternalRefreshedPosts === "function"
      ? mergeImagineExternalRefreshedPosts(library_state.imagineSearchPosts || [], normalized)
      : normalized;
    library_state.imagineSearchLoaded = true;
    if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
  } catch (error) {
    if (currentQuery !== String(library_state.searchQuery || "").trim()) return;
    library_state.imagineSearchPosts = [];
    library_state.imagineSearchError = error?.message || "Imagine search failed.";
  } finally {
    if (currentQuery === String(library_state.searchQuery || "").trim()) {
      library_state.imagineSearchLoading = false;
      renderSearchResults();
    }
  }
}

function maybeLoadImagineSearchResults() {
  const query = String(library_state.searchQuery || "").trim();
  if (!query) {
    resetImagineSearchResults();
    return;
  }
  if (typeof canLoadImagineSavedList !== "function" || !canLoadImagineSavedList()) return;
  if (library_state.imagineSearchQuery === query && (library_state.imagineSearchLoaded || library_state.imagineSearchLoading)) return;
  if (library_state.imagineSearchScheduledQuery === query) return;
  library_state.imagineSearchPosts = [];
  library_state.imagineSearchError = "";
  library_state.imagineSearchLoaded = false;
  library_state.imagineSearchScheduledQuery = query;
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
  if (imagineSearchDebounceTimer) clearTimeout(imagineSearchDebounceTimer);
  imagineSearchDebounceTimer = setTimeout(() => {
    imagineSearchDebounceTimer = null;
    loadImagineSearchResults(query).catch((error) => {
      library_state.imagineSearchLoading = false;
      library_state.imagineSearchError = error?.message || "Imagine search failed.";
      renderSearchResults();
    });
  }, 250);
}

function renderSearchResults() {
  const list = document.querySelector(".search_card_list");
  const count = document.querySelector(".search_main_header .search_count");
  if (!list) return;
  const queryActive = searchQueryActive();
  if (!queryActive) {
    resetImagineSearchResults();
    list.replaceChildren(emptyLibraryNode(""));
    if (count) count.textContent = "0 items";
    return;
  }
  maybeLoadImagineForSearch();
  maybeLoadImagineSearchResults();
  if (
    library_state.libraryIndexEnabled
    && library_state.indexedSearchBuildQuery !== String(library_state.searchQuery || "").trim()
    && !library_state.indexedSearchBuildLoading
    && typeof loadIndexedSearchBuildPosts === "function"
  ) {
    loadIndexedSearchBuildPosts(library_state.searchQuery, { force: true }).catch((error) => console.warn(error));
  }
  const buildPosts = searchBuildPosts();
  const imaginePosts = searchImaginePosts();
  const prompts = searchPromptItems();
  const nodes = [
    ...buildPosts.map((post) => mediaCardForPost(post, "b_card", { screenId: "search_main", activeButtonId: "search_btn" })),
    ...imaginePosts.map((post) => mediaCardForPost(post, "i_card", { screenId: "search_main", activeButtonId: "search_btn" })),
    ...(typeof promptCardNode === "function" ? prompts.map((prompt) => promptCardNode(prompt)) : []),
  ];
  const loadingImagine = Boolean(library_state.imagineSearchLoading || library_state.imagineSearchScheduledQuery);
  const loadingLocal = Boolean(library_state.libraryIndexEnabled && library_state.indexedSearchBuildLoading);
  const imagineError = String(library_state.imagineSearchError || "");
  if (!nodes.length && (loadingImagine || loadingLocal)) {
    list.replaceChildren(emptyLibraryNode("Loading . . ."));
  } else if (!nodes.length) {
    list.replaceChildren(emptyLibraryNode(imagineError || "No matching items."));
  } else {
    replaceCardListChildren(list, nodes);
    if (loadingImagine || loadingLocal) {
      const loading = emptyLibraryNode("Loading . . .");
      loading.classList.add("discover_loading_more");
      list.append(loading);
    }
  }
  const resultCount = library_state.libraryIndexEnabled
    ? Number(library_state.indexedSearchBuildTotal || 0) + imaginePosts.length + prompts.length
    : nodes.length;
  if (count) count.textContent = `${resultCount} items`;
}

document.querySelector(".search_card_list")?.addEventListener("scroll", (event) => {
  const list = event.currentTarget;
  if (!library_state.libraryIndexEnabled || !library_state.indexedSearchBuildHasMore || library_state.indexedSearchBuildLoading) return;
  if (list.scrollHeight - list.scrollTop - list.clientHeight > 320) return;
  loadIndexedSearchBuildPosts(library_state.searchQuery, { append: true }).catch((error) => console.warn(error));
});
