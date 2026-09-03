// Build detail actions: source, split, edit, and local delete
function selectedDetailSourceImage(post = selectedLibraryPost()) {
  const item = selectedDetailItem(post);
  return detailItemType(item) === "image" ? item : null;
}

async function splitDetailItem(item) {
  const post = selectedLibraryPost();
  if (!post?.folder_path || !item) {
    showErrorPanel("Split unavailable", "Select a local detail item.");
    return;
  }
  if ((post.items || []).length <= 1) {
    showErrorPanel("Split unavailable", "This card has only one item.");
    return;
  }
  if (!library_state.apiReady) {
    setLibraryMessage("Split needs the local app launcher.");
    return;
  }
  const data = await qApi("/api/library/split-item", {
    post_path: post.folder_path,
    item_key: mediaItemKey(item),
  });
  library_state.splitPickPending = false;
  library_state.sourcePickPending = false;
  applyLibrarySnapshot(data);
  toast("Item split.");
}

async function setDetailSourceImage(sourceItem) {
  const post = selectedLibraryPost();
  if (!post?.folder_path || !sourceItem) {
    showErrorPanel("Source unavailable", "Select an image thumbnail.");
    return;
  }
  if (detailItemType(sourceItem) !== "image") {
    library_state.sourcePickPending = true;
    library_state.splitPickPending = false;
    renderDetailViews();
    toast("Select an image thumbnail.");
    return;
  }
  if (!library_state.apiReady) {
    setLibraryMessage("Source setup needs the local app launcher.");
    return;
  }
  const sourceKey = mediaItemKey(sourceItem);
  const data = await qApi("/api/library/set-source", {
    post_path: post.folder_path,
    source_item_key: sourceKey,
  });
  library_state.sourcePickPending = false;
  library_state.splitPickPending = false;
  applyLibrarySnapshot(data);
  toast("Source image set.");
}

function startDetailSplitPick() {
  const post = selectedLibraryPost();
  if (screen_state.current_screen !== "b_detail" || !post?.items?.length || selectedBuildJob()) {
    showErrorPanel("Split unavailable", "Select a local Build detail item.");
    return;
  }
  if ((post.items || []).length <= 1) {
    showErrorPanel("Split unavailable", "This card has only one item.");
    return;
  }
  library_state.sourcePickPending = false;
  library_state.splitPickPending = !library_state.splitPickPending;
  renderDetailViews();
  if (library_state.splitPickPending) toast("Select a thumbnail to split.");
}

function startDetailSourcePick() {
  const post = selectedLibraryPost();
  if (screen_state.current_screen !== "b_detail" || !post?.items?.length || selectedBuildJob()) {
    showErrorPanel("Source unavailable", "Select a local Build detail item.");
    return;
  }
  library_state.splitPickPending = false;
  const selected = selectedDetailSourceImage(post);
  if (selected) {
    setDetailSourceImage(selected).catch((error) => showErrorPanel("Source failed", error?.message || "Source failed."));
    return;
  }
  library_state.sourcePickPending = true;
  renderDetailViews();
  toast("Select an image thumbnail.");
}

function handleBuildDetailThumbAction(thumb) {
  if (screen_state.current_screen !== "b_detail") return false;
  if (!library_state.sourcePickPending && !library_state.splitPickPending) return false;
  const post = selectedLibraryPost();
  const key = thumb.dataset.libraryItemId || "";
  const item = post?.items?.find((candidate) => mediaItemKey(candidate) === key);
  if (library_state.sourcePickPending) {
    const itemType = item?.type || mediaTypeForName(item?.file || item?.url || "") || "";
    if (itemType !== "image") {
      toast("Select an image thumbnail.");
      return true;
    }
    library_state.selectedDetailItemId = key;
    setDetailSourceImage(item).catch((error) => showErrorPanel("Source failed", error?.message || "Source failed."));
    return true;
  }
  if (library_state.splitPickPending) {
    if (!item) return true;
    library_state.selectedDetailItemId = key;
    splitDetailItem(item).catch((error) => showErrorPanel("Split failed", error?.message || "Split failed."));
    return true;
  }
  return false;
}

async function deleteBuildSelectedDetailItemFromLibrary() {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  const job = selectedBuildJob();
  const jobSourceItem = job ? generationJobSourceItem(job, post, null) : null;
  if (job && jobSourceItem && mediaItemKey(jobSourceItem) === mediaItemKey(item)) {
    showErrorPanel("Delete unavailable", "Cancel or dismiss the current generation first.");
    return;
  }
  if (!post?.folder_path || !item) {
    showErrorPanel("Delete unavailable", "Select a Library thumbnail to delete.");
    return;
  }
  if (!library_state.apiReady) {
    setLibraryMessage("Delete needs the local app launcher.");
    return;
  }
  const ok = await confirmDeleteAction({
    title: "Delete item",
    message: "Delete this local item?",
  });
  if (!ok) return;
  const currentDetailType = detailTypeForScreen() || detailTypeForPost(post, "build");
  const backTarget = detailBackTarget(currentDetailType);
  try {
    const data = await qApi("/api/library/delete-item", {
      post_path: post.folder_path,
      item_key: mediaItemKey(item),
    });
    const hasRemainingPost = Boolean(data?.selected_path);
    applyLibrarySnapshot(data);
    if (!hasRemainingPost) {
      openScreen(backTarget.screenId, backTarget.activeButtonId || "");
    }
    toast("Deleted local item.");
  } catch (error) {
    showErrorPanel("Delete failed", error?.message || "Delete failed.");
  }
}

function bindBuildDetailActions() {
  document.querySelector(".b_detail_heart")?.addEventListener("click", () => {
    const post = selectedLibraryPost();
    const button = document.querySelector(".b_detail_heart");
    if (!(typeof isBuildT2iPost === "function" && isBuildT2iPost(post))) return;
    if (typeof toggleBuildFavorite !== "function") {
      showErrorPanel("Favorite unavailable", "Favorite is not ready.");
      return;
    }
    toggleBuildFavorite(post, button);
  });
  document.querySelector(".b_detail_source_btn")?.addEventListener("click", () => {
    startDetailSourcePick();
  });
  document.querySelector(".b_detail_split_btn")?.addEventListener("click", () => {
    startDetailSplitPick();
  });
  document.querySelector(".b_detail_delete")?.addEventListener("click", () => {
    deleteBuildSelectedDetailItemFromLibrary().catch((error) => {
      console.warn(error);
      showErrorPanel("Delete failed", error?.message || "Delete failed.");
    });
  });
  document.querySelector(".b_detail_spicy")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    startBuildDetailSpicyVideo(button).catch((error) => {
      console.warn(error);
      showErrorPanel("Spicy failed", error?.message || "Spicy failed.");
    });
  });
  document.querySelector(".b_detail_edit")?.addEventListener("click", () => {
    openBuildDetailImageEditor();
  });
}

// Build drives the same Imagine video model through api.x.ai, so send the mode the site
// names and let the API answer rather than deciding here which sources may use it.
const BUILD_SPICY_VIDEO_MODE = "extremely-spicy-or-crazy";

async function startBuildDetailSpicyVideo(button = null) {
  if (composerState.mode !== "video") {
    showErrorPanel("Spicy unavailable", "Select Video mode first.");
    return;
  }
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Spicy unavailable", "Select a Build image thumbnail.");
    return;
  }
  const sourceUrl = detailMediaUrlForItem("b", item, post);
  if (!sourceUrl) {
    showErrorPanel("Spicy unavailable", "This Build image has no source file.");
    return;
  }
  const composerOptions = typeof composerRequestOptions === "function" ? composerRequestOptions() : {};
  // The composer tray carries this metadata for every detail-sourced request, and it is
  // what ties the result to the card it came from. Building the attachment by hand
  // without it left the video standing alone on Build main.
  const sourceMetadata = typeof composerAttachmentMetadataForItem === "function"
    ? composerAttachmentMetadataForItem(post, item)
    : {};
  const attachment = {
    name: item.file || item.title || `${mediaItemKey(item) || "build-spicy-source"}.jpg`,
    type: String(item.mime_type || item.mime || "image/jpeg"),
    role: "source",
    url: sourceUrl,
    raw_url: sourceUrl,
    source_url: sourceUrl,
    aspect_ratio: typeof composerAttachmentAspectForItem === "function"
      ? composerAttachmentAspectForItem(item)
      : "",
    detail_auto: true,
    detail_key: mediaItemKey(item),
    detail_post_path: post.folder_path || "",
    detail_item_id: mediaItemKey(item),
    ...sourceMetadata,
  };
  if (button) button.disabled = true;
  try {
    await ensureComposerAttachmentDataUrl(attachment);
    const data = await qApi("/api/build/start", {
      provider: "build",
      mode: "video",
      prompt: "",
      options: { ...composerOptions, video_mode: BUILD_SPICY_VIDEO_MODE },
      attachments: [attachment],
      preview_url: detailPreviewUrlForItem("b", item, post) || sourceUrl,
      preview_type: "image",
      source_post_path: post.folder_path || "",
      source_item_id: mediaItemKey(item),
    });
    if (!data?.job) throw new Error("Spicy job was not created.");
    upsertBuildJob(data.job);
    // Without the poll the card sits at its first percent forever: the job runs to
    // completion on the server and nothing ever asks for the result.
    selectBuildJob(data.job.id, {
      keepDetailPost: screen_state.current_screen === "b_detail",
      focusJobThumb: true,
    });
    scheduleBuildJobPoll(data.job.id);
  } finally {
    if (button) button.disabled = false;
  }
}

bindBuildDetailActions();
