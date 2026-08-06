// Detail previous/next post navigation
function uniquePostsByPath(posts) {
  const seen = new Set();
  const result = [];
  for (const post of posts || []) {
    const path = post?.folder_path || "";
    if (!path || seen.has(path) || !post?.items?.length) continue;
    seen.add(path);
    result.push(post);
  }
  return result;
}

function detailTypeForScreen(screenId = screen_state.current_screen) {
  if (screenId === "i_detail") return "imagine";
  if (screenId === "b_detail") return "build";
  return "";
}

function detailTypeForPost(post, fallback = "build") {
  return (post?.remote || post?.area === "imagine_remote" || post?.area === "imagine_upload_remote")
    ? "imagine"
    : fallback;
}

function detailScreenForType(detailType) {
  return detailType === "imagine" ? "i_detail" : "b_detail";
}

function detailPrefixForType(detailType) {
  return detailType === "imagine" ? "i" : "b";
}

function detailBackTarget(detailType) {
  return screen_state.detail_back[detailType] || {
    screenId: detailType === "imagine" ? "i_main" : "b_main",
    activeButtonId: detailType === "imagine" ? screen_state.current_i_nav_btn : screen_state.current_b_nav_btn,
  };
}

function detailPostSequence(detailType = detailTypeForScreen()) {
  const target = detailBackTarget(detailType);
  if (target.screenId === "i_main") {
    return uniquePostsByPath(
      typeof imagineSourcePosts === "function"
        ? imagineSourcePosts()
        : library_state.posts.filter((post) => post?.remote || post?.area === "imagine_remote" || post?.area === "imagine_upload_remote"),
    );
  }
  if (target.screenId === "b_main") {
    const buildPosts = library_state.libraryIndexEnabled && library_state.bMainView !== "t2i"
      ? (library_state.indexedBuildPosts || [])
      : library_state.posts;
    return uniquePostsByPath(buildPosts.filter(
      library_state.bMainView === "t2i"
        ? (typeof isSessionBuildT2iPost === "function" ? isSessionBuildT2iPost : isBuildT2iPost)
        : buildMainPostVisible,
    ));
  }
  if (target.screenId === "b_t2i_view_main") {
    return uniquePostsByPath(library_state.posts.filter(
      typeof isSessionBuildT2iPost === "function" ? isSessionBuildT2iPost : isBuildT2iPost,
    ));
  }
  if (target.screenId === "search_main") {
    return uniquePostsByPath(detailType === "imagine"
      ? (typeof searchImaginePosts === "function" ? searchImaginePosts() : library_state.posts.filter(isImaginePost))
      : (typeof searchBuildPosts === "function" ? searchBuildPosts() : library_state.posts.filter(isBuildPost)));
  }
  if (target.screenId === "2nd_main") {
    const post = selectedCollectionPost();
    const posts = secondMainPostsFor(post);
    if (posts.length) return uniquePostsByPath(posts);
  }
  if (target.screenId === "collection_main") {
    const collection = library_state.collections.find((item) => item.path === library_state.selectedCollectionPath);
    if (collection?.posts?.length) return uniquePostsByPath(collectionDirectPosts(collection));
    return uniquePostsByPath(library_state.posts.filter((post) => post.area === "collection"));
  }
  if (target.screenId === "i_discover_main") return uniquePostsByPath(library_state.imagineDiscoverPosts || []);
  if (target.screenId === "i_unsaved_main") return uniquePostsByPath(library_state.imagineUnsavedPosts || []);
  return uniquePostsByPath(detailType === "imagine"
    ? library_state.posts.filter(isImaginePost)
    : library_state.posts.filter(isBuildPost));
}

function detailPostIndex(sequence, path = library_state.selectedPostPath) {
  return sequence.findIndex((post) => post.folder_path === path);
}

function updateDetailPostNavigationButtons() {
  for (const detailType of ["imagine", "build"]) {
    const prefix = detailPrefixForType(detailType);
    const sequence = detailPostSequence(detailType);
    const index = detailPostIndex(sequence);
    const previous = document.querySelector(`.${prefix}_detail_back`);
    const next = document.querySelector(`.${prefix}_detail_forward`);
    if (previous) {
      previous.disabled = index <= 0;
      previous.setAttribute("aria-label", "Previous post");
    }
    if (next) {
      const target = detailBackTarget(detailType);
      const indexedMore = library_state.libraryIndexEnabled && (
        (target.screenId === "b_main" && library_state.bMainView !== "t2i" && library_state.indexedBuildHasMore)
        || (target.screenId === "search_main" && detailType === "build" && library_state.indexedSearchBuildHasMore)
      );
      next.disabled = index < 0 || (index >= sequence.length - 1 && !indexedMore);
      next.setAttribute("aria-label", "Next post");
    }
  }
}

async function navigateDetailPost(offset) {
  const currentDetailType = detailTypeForScreen();
  if (!currentDetailType) return false;
  let sequence = detailPostSequence(currentDetailType);
  let index = detailPostIndex(sequence);
  let nextIndex = index + offset;
  const target = detailBackTarget(currentDetailType);
  if (
    offset > 0
    && library_state.libraryIndexEnabled
    && index >= 0
    && nextIndex >= sequence.length
  ) {
    if (
      target.screenId === "b_main"
      && library_state.bMainView !== "t2i"
      && library_state.indexedBuildHasMore
      && typeof loadIndexedBuildPosts === "function"
    ) {
      await loadIndexedBuildPosts({ append: true });
    } else if (
      target.screenId === "search_main"
      && currentDetailType === "build"
      && library_state.indexedSearchBuildHasMore
      && typeof loadIndexedSearchBuildPosts === "function"
    ) {
      await loadIndexedSearchBuildPosts(library_state.searchQuery, { append: true });
    }
    sequence = detailPostSequence(currentDetailType);
    index = detailPostIndex(sequence);
    nextIndex = index + offset;
  }
  if (index < 0 || nextIndex < 0 || nextIndex >= sequence.length) {
    updateDetailPostNavigationButtons();
    return false;
  }
  const nextPost = sequence[nextIndex];
  const nextDetailType = ["2nd_main", "collection_main", "i_discover_main", "i_unsaved_main"].includes(target.screenId)
    ? detailTypeForPost(nextPost, currentDetailType)
    : currentDetailType;
  screen_state.detail_back[nextDetailType] = target;
  if (target.screenId === "2nd_main" || target.screenId === "collection_main") {
    library_state.selectedCollectionPostPath = nextPost.folder_path;
    renderSecondMain(nextPost);
  }
  selectLibraryPost(nextPost.folder_path);
  openScreen(detailScreenForType(nextDetailType), target.activeButtonId || "", {
    replaceHistory: true,
  });
  updateDetailPostNavigationButtons();
  return true;
}

function returnFromDetailToSource() {
  const currentDetailType = detailTypeForScreen();
  if (!currentDetailType) return false;
  const target = detailBackTarget(currentDetailType);
  if (!target?.screenId) return false;
  openScreen(target.screenId, target.activeButtonId || "", {
    replaceHistory: true,
  });
  if (target.scrollState && typeof restoreLibraryCardListScroll === "function") {
    restoreLibraryCardListScroll(target.scrollState);
  } else if (
    currentDetailType === "imagine"
    && target.scrollTop !== null
    && target.scrollTop !== undefined
    && typeof restoreImagineListScrollForScreen === "function"
  ) {
    restoreImagineListScrollForScreen(target.screenId, target.scrollTop);
  }
  return true;
}
