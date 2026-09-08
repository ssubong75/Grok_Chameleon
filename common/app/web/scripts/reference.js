// Local Reference cards saved from Imagine Liked. Remote membership is never changed.
let referenceLoadEpoch = 0;
let referenceSaveQueue = Promise.resolve();

function referencePosts() {
  return (library_state.posts || []).filter((post) => post.area === "reference")
    .sort(comparePostsByRecentActivity);
}

function renderReferenceCards() {
  const list = document.querySelector(".reference_card_list");
  if (!list) return;
  const posts = referencePosts();
  const backTarget = { screenId: "reference_main", activeButtonId: "reference_nav_btn" };
  if (!posts.length) {
    disableVirtualCardList("reference-main", list);
    list.replaceChildren(emptyLibraryNode("No reference items."));
    return;
  }
  renderVirtualCardList("reference-main", list, posts.map((post) => (
    virtualCardRenderSpecForPost(post, "b_card", backTarget)
  )));
}

async function loadReferenceCards() {
  const epoch = ++referenceLoadEpoch;
  const rootPath = library_state.rootPath;
  if (!library_state.apiReady) {
    renderReferenceCards();
    return;
  }
  const data = await qApi("/api/reference/list", {});
  if (epoch !== referenceLoadEpoch || library_state.rootPath !== rootPath) return;
  library_state.posts = [
    ...(library_state.posts || []).filter((post) => post.area !== "reference"),
    ...(data.posts || []).map(normalizeServerPost),
  ];
  renderReferenceCards();
}

function isLikedReferenceSaveContext(posts) {
  const fromLiked = library_state.iMainView === imagineViewValue("LIKED", "liked")
    && (screen_state.current_screen === "i_main"
      || (screen_state.current_screen === "i_detail"
        && screen_state.detail_back.imagine?.screenId === "i_main"));
  return fromLiked && posts.length > 0 && posts.every((post) => (
    post?.source === "imagine"
    && (post.remote || ["imagine_remote", "imagine_upload_remote"].includes(post.area))
  ));
}

function saveLikedCardsToReference(posts) {
  const rootPath = library_state.rootPath;
  const task = referenceSaveQueue.then(() => performLikedReferenceSave(posts, rootPath));
  referenceSaveQueue = task.catch(() => {});
  return task;
}

async function performLikedReferenceSave(posts, rootPath) {
  if (!library_state.apiReady) throw new Error("Reference saving needs the local app launcher.");
  let saved = 0;
  try {
    toast("Saving to Reference . . .");
    for (const post of posts) {
      if (library_state.rootPath !== rootPath) throw new Error("Library path changed during saving.");
      const data = await qApi("/api/reference/save", { source_post: post });
      saved += 1;
      // Invalidate an older list request so it cannot remove the newly saved card.
      referenceLoadEpoch += 1;
      if (library_state.rootPath !== rootPath) throw new Error("Library path changed during saving.");
      if (data.post) {
        const localPost = normalizeServerPost(data.post);
        library_state.posts = [
          ...(library_state.posts || []).filter((entry) => entry.folder_path !== localPost.folder_path),
          localPost,
        ];
      }
    }
    renderReferenceCards();
    toast(`Saved ${saved} card${saved === 1 ? "" : "s"} to Reference.`);
  } catch (error) {
    renderReferenceCards();
    throw new Error(`${saved ? `${saved} card(s) saved. ` : ""}${error?.message || "Reference save failed."}`);
  }
}

bindVirtualCardListScroll("reference-main", document.querySelector(".reference_card_list"));
