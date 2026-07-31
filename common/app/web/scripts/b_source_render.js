// Build source list filtering and rendering
const BUILD_CARD_BATCH_SIZE = 20;
const BUILD_CARD_LOAD_THRESHOLD = 240;
const BUILD_VIRTUAL_LIST_KEY = "build-main";
const buildCardPagingState = {
  key: "",
  visiblePosts: BUILD_CARD_BATCH_SIZE,
};

function buildCardPagingKey() {
  const view = String(library_state.bMainView || "build");
  const query = String(library_state.searchQuery || "").trim().toLowerCase();
  const collectionMode = library_state.buildIncludeCollections ? "with-collection" : "without-collection";
  return `${view}\u001f${collectionMode}\u001f${query}`;
}

function pagedBuildPosts(posts, list = null) {
  if (library_state.libraryIndexEnabled) return posts;
  const key = buildCardPagingKey();
  if (buildCardPagingState.key !== key) {
    const hadPreviousPage = Boolean(buildCardPagingState.key);
    buildCardPagingState.key = key;
    buildCardPagingState.visiblePosts = BUILD_CARD_BATCH_SIZE;
    if (hadPreviousPage && list) list.scrollTop = 0;
  }
  return posts.slice(0, buildCardPagingState.visiblePosts);
}

function buildPostCardEntry(post, t2iView) {
  const className = t2iView ? "b_t2i_card" : "b_card";
  const backTarget = t2iView ? { screenId: "b_main", activeButtonId: "b_build_btn" } : null;
  if (typeof virtualCardRenderSpecForPost === "function") {
    return virtualCardRenderSpecForPost(post, className, backTarget);
  }
  return typeof cardRenderSpecForPost === "function"
    ? cardRenderSpecForPost(post, className, backTarget)
    : mediaCardForPost(post, className, backTarget);
}
function isCollectionContainerPost(post) {
  if (post?.area !== "collection") return false;
  const mode = String(post?.mode || "").toLowerCase();
  return post?.folder_role === "container" || (mode === "folder" && !(post.items || []).length);
}

function isBuildLocalMediaItem(item) {
  const status = String(item?.status || "").toLowerCase();
  if (item?.moderated || status === "moderated" || status === "failed") return true;
  if (typeof bDetailMediaUrl === "function" && bDetailMediaUrl(item)) return true;
  if (typeof bDetailPreviewUrl === "function" && bDetailPreviewUrl(item)) return true;
  return false;
}

function postHasBuildLocalMedia(post) {
  const items = Array.isArray(post?.items) ? post.items : [];
  return items.some(isBuildLocalMediaItem);
}

function isBuildPost(post) {
  if (isCollectionContainerPost(post)) return false;
  if (post.area === "collection") return postHasBuildLocalMedia(post);
  if (post.area === "upload") return false;
  if (post.source === "imagine") return false;
  if (!(post.source === "build" || post.area === "created")) return false;
  return postHasBuildLocalMedia(post);
}

function buildSourcePosts() {
  if (library_state.bMainView === "t2i") {
    const posts = library_state.posts.filter(
      typeof isSessionBuildT2iPost === "function" ? isSessionBuildT2iPost : isBuildT2iPost,
    );
    const sessionOrder = new Map(
      Array.from(library_state.sessionBuildT2iPaths || []).map((path, index) => [String(path || ""), index]),
    );
    return posts.sort((left, right) => (
      (sessionOrder.get(String(left?.folder_path || "")) ?? Number.MAX_SAFE_INTEGER)
      - (sessionOrder.get(String(right?.folder_path || "")) ?? Number.MAX_SAFE_INTEGER)
      || String(left?.created_at || "").localeCompare(String(right?.created_at || ""))
    ));
  }
  if (library_state.libraryIndexEnabled) {
    if (
      library_state.indexedBuildKey !== indexedBuildQueryKey()
      && !library_state.indexedBuildLoading
      && typeof loadIndexedBuildPosts === "function"
    ) {
      loadIndexedBuildPosts({ force: true }).catch((error) => console.warn(error));
      return [];
    }
    const indexedPosts = library_state.indexedBuildPosts || [];
    const byPath = new Map(indexedPosts.map((post) => [post?.folder_path, post]));
    for (const post of library_state.posts.filter(isSessionBuildT2iPost)) {
      if (post?.folder_path) byPath.set(post.folder_path, post);
    }
    return Array.from(byPath.values()).sort(comparePostsByRecentActivity);
  }
  return library_state.posts.filter(buildMainPostVisible).sort(comparePostsByRecentActivity);
}

function buildVisibleJobs() {
  return (library_state.jobs || []).filter((job) => (
    isRenderableBuildJob(job)
    && (typeof generationJobHasVisibleSlots !== "function" || generationJobHasVisibleSlots(job))
    && (library_state.bMainView === "t2i"
      ? isTextToImageBuildJob(job)
      : !(typeof generationJobHasSourcePost === "function" && generationJobHasSourcePost(job)))
  ));
}

function renderBuildSourceCards() {
  const posts = filterPostsBySearch(buildSourcePosts());
  const visibleJobs = buildVisibleJobs();
  const list = document.querySelector(".b_card_list");
  const t2iView = library_state.bMainView === "t2i";
  const visiblePosts = pagedBuildPosts(posts, list);
  const mainJobEntries = visibleJobs.map((job) => ({
    key: mainGenerationActivityKey("job", job?.id),
    cards: (
      isTextToImageBuildJob(job)
        ? visibleGenerationJobSlots(job).map((slotIndex) => mediaCardForBuildJob(job, slotIndex))
        : [mediaCardForBuildJob(job)]
    ).filter(Boolean),
  }));
  const mainPostEntries = visiblePosts.map((post) => ({
    key: mainGenerationActivityKey("post", post?.folder_path || post?.post_id),
    cards: [buildPostCardEntry(post, false)],
  }));
  if (list) {
    if (library_state.libraryIndexEnabled && library_state.indexedBuildLoading && !posts.length && !visibleJobs.length) {
      disableVirtualCardList(BUILD_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode("Loading . . ."));
    } else if (!posts.length && !visibleJobs.length) {
      disableVirtualCardList(BUILD_VIRTUAL_LIST_KEY, list);
      list.replaceChildren(emptyLibraryNode(t2iView ? "No T2I items." : "No build items."));
    } else {
      renderVirtualCardList(
        BUILD_VIRTUAL_LIST_KEY,
        list,
        t2iView
          ? [
            ...visiblePosts.map((post) => buildPostCardEntry(post, true)),
            ...visibleJobs.flatMap(mediaCardsForBuildJob),
          ]
          : orderedMainGenerationCards("build", [...mainJobEntries, ...mainPostEntries]),
      );
    }
  }
  document.getElementById("b_t2i_view_btn")?.classList.toggle("active", t2iView);
  const collectionButton = document.getElementById("b_collection_filter_btn");
  const collectionActive = !t2iView && Boolean(library_state.buildIncludeCollections);
  collectionButton?.classList.toggle("active", collectionActive);
  collectionButton?.setAttribute("aria-pressed", String(collectionActive));
  const count = document.querySelector(".b_main_header p");
  const jobSlots = visibleJobs.reduce((total, job) => total + (
    isTextToImageBuildJob(job)
      ? (typeof visibleGenerationJobSlots === "function" ? visibleGenerationJobSlots(job).length : buildJobT2iSlotCount(job))
      : 1
  ), 0);
  const postCount = library_state.libraryIndexEnabled && !t2iView
    ? Number(library_state.indexedBuildTotal || 0)
    : posts.length;
  if (count) count.textContent = `${postCount + jobSlots} items`;
}

function maybeLoadMoreBuildSourceCards() {
  const list = document.querySelector(".b_card_list");
  if (!list) return;
  if (library_state.libraryIndexEnabled) {
    if (!library_state.indexedBuildHasMore || library_state.indexedBuildLoading) return;
    const remaining = virtualCardListRemaining(list);
    if (remaining > BUILD_CARD_LOAD_THRESHOLD) return;
    loadIndexedBuildPosts({ append: true }).catch((error) => console.warn(error));
    return;
  }
  if (buildCardPagingState.key !== buildCardPagingKey()) return;
  const posts = filterPostsBySearch(buildSourcePosts());
  if (buildCardPagingState.visiblePosts >= posts.length) return;
  const remaining = virtualCardListRemaining(list);
  if (remaining > BUILD_CARD_LOAD_THRESHOLD) return;
  buildCardPagingState.visiblePosts = Math.min(
    posts.length,
    buildCardPagingState.visiblePosts + BUILD_CARD_BATCH_SIZE,
  );
  renderBuildSourceCards();
}

bindVirtualCardListScroll(
  BUILD_VIRTUAL_LIST_KEY,
  document.querySelector(".b_card_list"),
  maybeLoadMoreBuildSourceCards,
);
