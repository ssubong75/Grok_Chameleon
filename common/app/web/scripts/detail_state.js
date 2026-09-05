// Detail selection state and prompt sync
function selectLibraryPost(pathOrPost, { loadFull = true, identity = "" } = {}) {
  library_state.selectedJobId = "";
  library_state.selectedImagineJobId = "";
  const explicitPost = pathOrPost && typeof pathOrPost === "object" ? pathOrPost : null;
  const path = typeof libraryPostServerPath === "function"
    ? libraryPostServerPath(pathOrPost)
    : String(explicitPost?.folder_path || pathOrPost || "");
  const nextIdentity = String(
    identity
    || (explicitPost && typeof libraryPostStableIdentity === "function"
      ? libraryPostStableIdentity(explicitPost)
      : ""),
  );
  const previousPath = library_state.selectedPostPath;
  const previousIdentity = String(library_state.selectedPostIdentity || "");
  library_state.selectedPostPath = path || "";
  library_state.selectedPostIdentity = nextIdentity;
  const postChanged = previousPath !== library_state.selectedPostPath
    || previousIdentity !== library_state.selectedPostIdentity;
  if (postChanged && typeof clearComposerAttachmentsForPostChange === "function") {
    clearComposerAttachmentsForPostChange();
  }
  const post = selectedLibraryPost();
  if (
    loadFull
    && (!post || post._indexed_summary)
    && path
    && library_state.libraryIndexEnabled
    && typeof loadIndexedPost === "function"
  ) {
    loadIndexedPost(path).then((loadedPost) => {
      if (
        loadedPost
        && library_state.selectedPostPath === path
        && (!nextIdentity || library_state.selectedPostIdentity === nextIdentity)
      ) selectLibraryPost(loadedPost);
    }).catch((error) => console.warn(error));
  }
  if (post) {
    if (!library_state.selectedPostIdentity && typeof libraryPostStableIdentity === "function") {
      library_state.selectedPostIdentity = libraryPostStableIdentity(post);
    }
    const samePost = previousPath === library_state.selectedPostPath
      && previousIdentity === library_state.selectedPostIdentity;
    const visibleItems = detailVisibleItems(post);
    const selectedStillValid = visibleItems.some((item) => mediaItemKey(item) === library_state.selectedDetailItemId);
    if (!samePost || !selectedStillValid) {
      library_state.selectedDetailItemId = mediaItemKey(detailDefaultSelectedItem(post));
    }
  }
  for (const card of document.querySelectorAll("[data-library-post-path]")) {
    const cardIdentity = String(card.dataset.libraryPostIdentity || "");
    const selected = cardIdentity
      ? cardIdentity === library_state.selectedPostIdentity
      : card.dataset.libraryPostPath === library_state.selectedPostPath;
    card.classList.toggle("library_selected", selected);
    if (card.classList.contains("collection_2nd_card")) card.classList.toggle("active", selected);
  }
  renderDetailViews();
  if (typeof renderComposerOptions === "function") renderComposerOptions();
  if ((screen_state.current_screen === "i_detail" || screen_state.current_screen === "b_detail") && typeof syncDetailAttachmentForComposerTray === "function") {
    syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
  }
}

function selectedLibraryPost() {
  const selectedPath = String(library_state.selectedPostPath || "");
  if (!selectedPath) {
    library_state.selectedPostIdentity = "";
    return null;
  }
  const posts = [
    ...(library_state.posts || []),
    ...(library_state.imagineRemotePosts || []),
  ];
  if (library_state.selectedPostIdentity && typeof libraryPostMatchesIdentity === "function") {
    const matched = posts.find((post) => (
      post?.folder_path === selectedPath
      && libraryPostMatchesIdentity(post, library_state.selectedPostIdentity)
    ));
    if (matched) return matched;
    return null;
  }
  const fallback = posts.find((item) => item.folder_path === selectedPath) || null;
  if (fallback && typeof libraryPostStableIdentity === "function") {
    library_state.selectedPostIdentity = libraryPostStableIdentity(fallback);
  }
  return fallback;
}

function selectedDetailItem(post = selectedLibraryPost()) {
  if (!post?.items?.length) return null;
  const visibleItems = detailVisibleItems(post);
  return visibleItems.find((item) => mediaItemKey(item) === library_state.selectedDetailItemId)
    || detailDefaultSelectedItem(post)
    || visibleItems[0]
    || post.items[0];
}

function selectedDetailSourceContext(post = selectedLibraryPost()) {
  const selectedItemId = String(library_state.selectedDetailItemId || "");
  const selectedBaseItem = post?.items?.find((item) => mediaItemKey(item) === selectedItemId) || null;
  if (selectedBaseItem) return { post, item: selectedBaseItem };

  const job = screen_state.current_screen === "b_detail"
    ? (typeof selectedBuildJob === "function" ? selectedBuildJob() : null)
    : (screen_state.current_screen === "i_detail" && typeof selectedImagineJob === "function" ? selectedImagineJob() : null);
  // Only borrow the job's source when the job belongs to the post being viewed. A job left
  // selected from another card used to hand its own source over here, so a generation started
  // from this card attached its result to that other card instead.
  if (
    job
    && typeof generationJobMatchesPost === "function"
    && generationJobMatchesPost(job, post)
    && typeof generationJobSourcePost === "function"
    && typeof generationJobSourceItem === "function"
  ) {
    const sourcePost = generationJobSourcePost(job, post);
    const sourceItem = generationJobSourceItem(job, sourcePost, null);
    if (sourcePost && sourceItem) return { post: sourcePost, item: sourceItem };
  }

  return { post, item: selectedDetailItem(post) };
}

function detailItemRoleRank(item) {
  const role = String(item?.role || item?.relation || item?.source_type || item?.kind || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  return type === "image" && /(original|source|start|input|parent)/.test(role) ? 0 : 1;
}

function detailItemLooksLikeTransientInput(item) {
  return false;
}

function detailVisibleItems(post) {
  const items = Array.isArray(post?.items) ? post.items : [];
  return items;
}

function detailItemTimeValue(item, fallbackIndex = 0) {
  const candidates = [
    item?.created_at,
    item?.createdAt,
    item?.timestamp,
    item?.updated_at,
    item?.updatedAt,
    item?.last_modified,
    item?.lastModified,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  const file = String(item?.file || item?.url || item?.item_id || "");
  const stamp = file.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_T ]?(\d{2})?[-_]?(\d{2})?[-_]?(\d{2})?/);
  if (stamp) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = stamp;
    const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackIndex;
}

function detailOrderedItems(post) {
  return [...detailVisibleItems(post)]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      return (
        detailItemRoleRank(a.item) - detailItemRoleRank(b.item)
        || detailItemTimeValue(a.item, a.index) - detailItemTimeValue(b.item, b.index)
        || a.index - b.index
      );
    })
    .map(({ item }) => item);
}

function detailDefaultSelectedItem(post) {
  const ordered = detailOrderedItems(post);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (detailItemRoleRank(ordered[index]) > 0) return ordered[index];
  }
  return ordered[ordered.length - 1] || post?.items?.[0] || null;
}

function detailItemPrompt(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return item?.prompt
    || item?.original_prompt
    || item?.originalPrompt
    || metadata.prompt
    || metadata.original_prompt
    || metadata.originalPrompt
    || imagine.prompt
    || imagine.original_prompt
    || imagine.originalPrompt
    || "";
}

function detailPromptFor(post, item = selectedDetailItem(post)) {
  const itemPrompt = detailItemPrompt(item);
  if (itemPrompt) return itemPrompt;
  const linkSource = typeof detailIsImagineLinkSource === "function"
    && detailIsImagineLinkSource(post, item);
  if (item && post?.source === "imagine" && !linkSource) return "";
  const postPrompt = detailItemPrompt(post);
  if (postPrompt) return postPrompt;
  if (linkSource) return "";
  return item?.title
    || post?.title
    || "";
}

function currentDetailPromptPost() {
  const basePost = selectedLibraryPost();
  const selectedBaseItem = basePost?.items?.find((item) => (
    mediaItemKey(item) === String(library_state.selectedDetailItemId || "")
  ));
  if (selectedBaseItem) return basePost;
  if (screen_state.current_screen === "b_detail") {
    const job = typeof selectedBuildJob === "function" ? selectedBuildJob() : null;
    if (job) {
      return typeof buildJobDetailPost === "function"
        ? buildJobDetailPost(job, basePost)
        : { prompt: job.prompt || "", items: [{ prompt: job.prompt || "" }] };
    }
  }
  if (screen_state.current_screen === "i_detail") {
    const job = typeof selectedImagineJob === "function" ? selectedImagineJob() : null;
    if (job) {
      return typeof imagineJobDetailPost === "function"
        ? imagineJobDetailPost(job, basePost)
        : { prompt: job.prompt || "", items: [{ prompt: job.prompt || "" }] };
    }
  }
  return basePost;
}

function syncComposerPromptFromDetail() {
  if (screen_state.current_screen !== "i_detail" && screen_state.current_screen !== "b_detail") return;
  const prompt = detailPromptFor(currentDetailPromptPost());
  const input = document.getElementById("composer_input");
  if (input) {
    input.value = prompt || "";
    autoSizeComposerPromptInput(input);
  }
}

function setSelectedDetailItem(itemId) {
  const nextItemId = itemId || "";
  if ((library_state.selectedDetailItemId || "") === nextItemId) {
    syncComposerPromptFromDetail();
    return false;
  }
  library_state.selectedDetailItemId = nextItemId;
  const selectingInDetail = screen_state.current_screen === "i_detail" || screen_state.current_screen === "b_detail";
  renderDetailViews(selectingInDetail ? { activeOnly: true, preserveThumbScroll: true } : {});
  if (typeof renderComposerOptions === "function") renderComposerOptions();
  if (composerState.mode === "extend") {
    prepareDetailExtendFromCurrentVideo();
    clampActiveDetailExtendStart();
  }
  syncComposerPromptFromDetail();
  playActiveDetailVideoIfSelected();
  return true;
}
