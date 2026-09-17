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

function buildDetailScreenWorkArea() {
  const activeScreen = window.screen || {};
  return {
    left: Number(activeScreen.availLeft) || 0,
    top: Number(activeScreen.availTop) || 0,
    width: Number(activeScreen.availWidth) || 0,
    height: Number(activeScreen.availHeight) || 0,
  };
}

async function openBuildSelectedDetailItemFolder(button = null) {
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (screen_state.current_screen !== "b_detail" || !post?.folder_path || !item) {
    showErrorPanel("Folder unavailable", "Select a saved Build item.");
    return;
  }
  if (!library_state.apiReady) {
    setLibraryMessage("Open folder needs the local app launcher.");
    return;
  }
  if (button) button.disabled = true;
  try {
    await qApi("/api/open-library-folder", {
      post_path: post.folder_path,
      item_key: mediaItemKey(item),
      screen_work_area: buildDetailScreenWorkArea(),
    });
    toast("Opened containing folder.");
  } finally {
    if (button) button.disabled = false;
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
  document.querySelector(".b_detail_open_folder")?.addEventListener("click", (event) => {
    openBuildSelectedDetailItemFolder(event.currentTarget).catch((error) => {
      console.warn(error);
      showErrorPanel("Folder open failed", error?.message || "Folder open failed.");
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
  const selectedItem = selectedDetailItem(post);
  const item = detailItemType(selectedItem) === "image"
    ? selectedItem
    : (typeof detailImageForComposer === "function" ? detailImageForComposer(post, selectedItem) : null);
  if (!post || !item || detailItemType(item) !== "image") {
    showErrorPanel("Spicy unavailable", "This Build video has no source image.");
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

const buildVideoMergeState = { postPath: "", items: [null, null], busy: false };

function closeBuildVideoMerge() {
  document.querySelector(".b_video_merge_popup").hidden = true;
  document.querySelector(".b_detail_video_merge").setAttribute("aria-expanded", "false");
}

function syncBuildVideoMergeContext() {
  if (screen_state.current_screen !== "b_detail"
    || selectedLibraryPost()?.folder_path !== buildVideoMergeState.postPath) {
    closeBuildVideoMerge();
    buildVideoMergeState.postPath = "";
    buildVideoMergeState.items = [null, null];
  }
}

function renderBuildVideoMergeSlots() {
  document.querySelectorAll(".b_video_merge_slot").forEach((slot, index) => {
    const item = buildVideoMergeState.items[index];
    slot.disabled = buildVideoMergeState.busy;
    slot.classList.toggle("has_attachment", Boolean(item));
    const remove = slot.parentElement.querySelector(".b_video_merge_remove");
    remove.hidden = !item;
    remove.disabled = buildVideoMergeState.busy;
    slot.querySelector("small").textContent = item?.file || "Drop video";
    slot.title = item?.file || "Drop video or click to attach the selected video";
    const preview = item ? detailPreviewUrlForItem("b", item, selectedLibraryPost()) : "";
    slot.style.backgroundImage = preview ? `url(${JSON.stringify(preview)})` : "";
    slot.querySelector("video")?.remove();
    if (item && !preview) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.draggable = false;
      video.setAttribute("aria-hidden", "true");
      video.src = detailMediaUrlForItem("b", item, selectedLibraryPost());
      video.addEventListener("loadedmetadata", () => { video.currentTime = Math.min(.01, video.duration / 2); }, { once: true });
      slot.prepend(video);
    }
  });
  const submit = document.querySelector(".b_video_merge_submit");
  submit.disabled = buildVideoMergeState.busy || buildVideoMergeState.items.some((item) => !item);
  submit.textContent = buildVideoMergeState.busy ? "Merging…" : "Merge";
}

function attachBuildVideoMergeItem(index, key) {
  if (buildVideoMergeState.busy) return;
  const post = selectedLibraryPost();
  if (screen_state.current_screen !== "b_detail" || post?.folder_path !== buildVideoMergeState.postPath) return;
  const item = post.items?.find((candidate) => mediaItemKey(candidate) === key);
  if (!item || detailItemType(item) !== "video" || !item.file) {
    toast("Select a saved video thumbnail.");
    return;
  }
  buildVideoMergeState.items[index] = item;
  document.querySelector(".b_video_merge_status").textContent = "";
  renderBuildVideoMergeSlots();
}

document.querySelector(".b_detail_video_merge")?.addEventListener("click", () => {
  const popup = document.querySelector(".b_video_merge_popup");
  if (!popup.hidden) { closeBuildVideoMerge(); return; }
  const post = selectedLibraryPost();
  if (!post?.folder_path || !post.items?.some((item) => detailItemType(item) === "video" && item.file)) {
    toast("Select a folder with saved videos.");
    return;
  }
  if (buildVideoMergeState.postPath !== post.folder_path) {
    buildVideoMergeState.items = [null, null];
    document.querySelector(".b_video_merge_status").textContent = "";
  }
  buildVideoMergeState.postPath = post.folder_path;
  popup.hidden = false;
  document.querySelector(".b_detail_video_merge").setAttribute("aria-expanded", "true");
  renderBuildVideoMergeSlots();
  popup.querySelector(".b_video_merge_close").focus();
});
document.querySelector(".b_video_merge_close")?.addEventListener("click", closeBuildVideoMerge);
document.querySelector(".b_video_merge_popup")?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeBuildVideoMerge();
    document.querySelector(".b_detail_video_merge").focus();
  }
});
document.querySelector(".b_detail_thumb_list")?.addEventListener("dragstart", (event) => {
  const thumb = event.target.closest(".b_detail_thumb_video");
  if (!thumb || thumb.dataset.buildJobId || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-gc-build-video", JSON.stringify({
    postPath: selectedLibraryPost()?.folder_path,
    key: thumb.dataset.libraryItemId,
  }));
});
document.querySelectorAll(".b_video_merge_slot").forEach((slot, index) => {
  slot.addEventListener("click", () => attachBuildVideoMergeItem(index, mediaItemKey(selectedDetailItem(selectedLibraryPost()))));
  slot.addEventListener("dragover", (event) => {
    if (buildVideoMergeState.busy || !Array.from(event.dataTransfer?.types || []).includes("application/x-gc-build-video")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    slot.classList.add("drag_over");
  });
  slot.addEventListener("dragleave", () => slot.classList.remove("drag_over"));
  slot.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    slot.classList.remove("drag_over");
    try {
      const value = JSON.parse(event.dataTransfer.getData("application/x-gc-build-video"));
      if (value.postPath === buildVideoMergeState.postPath) attachBuildVideoMergeItem(index, value.key);
    } catch (_) { /* Ignore unrelated drag payloads. */ }
  });
});
document.querySelectorAll(".b_video_merge_remove").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (buildVideoMergeState.busy) return;
    const index = Number(button.dataset.removeSlot);
    buildVideoMergeState.items[index] = null;
    document.querySelector(".b_video_merge_status").textContent = "";
    renderBuildVideoMergeSlots();
    document.querySelector(`[data-merge-slot="${index}"]`).focus();
  });
});
document.querySelector(".b_video_merge_submit")?.addEventListener("click", async () => {
  if (buildVideoMergeState.busy || buildVideoMergeState.items.some((item) => !item)) return;
  const postPath = buildVideoMergeState.postPath;
  if (selectedLibraryPost()?.folder_path !== postPath || screen_state.current_screen !== "b_detail") return;
  buildVideoMergeState.busy = true;
  renderBuildVideoMergeSlots();
  const status = document.querySelector(".b_video_merge_status");
  status.textContent = "Merging videos…";
  try {
    const data = await qApi("/api/library/merge-videos", {
      post_path: postPath,
      item_keys: buildVideoMergeState.items.map((item) => mediaItemKey(item)),
    });
    applyLibrarySnapshot(data);
    if (buildVideoMergeState.postPath === postPath) {
      status.textContent = "Saved to this folder.";
      buildVideoMergeState.items = [null, null];
    }
    toast("Merged video saved.");
  } catch (error) {
    if (buildVideoMergeState.postPath === postPath) status.textContent = error?.message || "Merge failed.";
    else showErrorPanel("Merge failed", error?.message || "Merge failed.");
  } finally {
    buildVideoMergeState.busy = false;
    renderBuildVideoMergeSlots();
  }
});
