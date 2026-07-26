// Imagine composer submit and direct-call job polling
const imagineJobPollTimers = new Map();
const notifiedImagineJobs = new Set();
const imagineT2iPartialCounts = new Map();
const imagineT2iAppliedPaths = new Map();

function applyImagineT2iPartialJobResult(job) {
  if (!(typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job))) return false;
  const posts = Array.isArray(job?.partial_result?.posts) ? job.partial_result.posts.filter(Boolean) : [];
  const jobId = String(job?.id || "");
  const previousCount = imagineT2iPartialCounts.get(jobId) || 0;
  if (!posts.length || posts.length <= previousCount) return false;
  if (!library_state.sessionImagineT2iPaths) library_state.sessionImagineT2iPaths = new Set();
  const appliedPaths = imagineT2iAppliedPaths.get(jobId) || new Set();
  let changed = false;
  for (const post of posts) {
    const candidatePath = String(post?.folder_path || "");
    if (candidatePath && appliedPaths.has(candidatePath)) continue;
    const path = upsertImagineRemotePost(post);
    if (path) {
      appliedPaths.add(path);
      library_state.sessionImagineT2iPaths.add(path);
      changed = true;
    }
  }
  imagineT2iAppliedPaths.set(jobId, appliedPaths);
  imagineT2iPartialCounts.set(jobId, posts.length);
  return changed;
}

function imagineJobStatus(job) {
  return String(job?.status || "").toLowerCase();
}

function imagineJobTerminal(job) {
  return ["done", "failed", "moderated", "cancelled", "canceled"].includes(imagineJobStatus(job));
}

function selectedImagineJob() {
  const id = String(library_state.selectedImagineJobId || "");
  if (!id) return null;
  return (library_state.imagineJobs || []).find((job) => String(job.id || "") === id) || null;
}

function imagineJobsForPost(post = null) {
  if (!post?.folder_path || typeof generationJobMatchesPost !== "function") return [];
  return (library_state.imagineJobs || []).filter((job) => (
    isRenderableBuildJob(job)
    && generationJobMatchesPost(job, post)
  ));
}

function selectedImagineJobForPost(post = null) {
  const selected = selectedImagineJob();
  const jobs = imagineJobsForPost(post);
  if (!post?.folder_path) return selected;
  if (selected && jobs.some((job) => String(job.id || "") === String(selected.id || ""))) return selected;
  return jobs[0] || null;
}

function renderImagineJobSourceViews() {
  const discoverActive = screen_state.current_screen === "i_discover_main";
  const unsavedActive = screen_state.current_screen === "i_unsaved_main";
  const activeSourceScreen = discoverActive
    ? "i_discover_main"
    : (unsavedActive ? "i_unsaved_main" : "");
  const scrollState = activeSourceScreen && typeof captureLibraryCardListScroll === "function"
    ? captureLibraryCardListScroll(activeSourceScreen)
    : null;
  renderImagineSourceCards();
  if (discoverActive && typeof renderImagineDiscoverCards === "function") {
    renderImagineDiscoverCards();
  }
  if (unsavedActive && typeof renderImagineUnsavedCards === "function") {
    renderImagineUnsavedCards();
  }
  if (typeof restoreLibraryCardListScroll === "function") {
    restoreLibraryCardListScroll(scrollState);
  }
}

function imagineJobDetailPost(job, basePost = null, jobs = null) {
  if (!job) return null;
  const type = buildJobTargetType(job);
  const context = job.context || {};
  const status = imagineJobStatus(job);
  const selectedSlotId = String(library_state.selectedDetailItemId || "");
  const escapedJobId = String(job.id || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selectedSlotMatch = selectedSlotId.match(new RegExp(`^imagine-job-${escapedJobId}-(\\d+)$`));
  const selectedSlotIndex = selectedSlotMatch ? Number.parseInt(selectedSlotMatch[1], 10) : 0;
  const item = {
    item_id: selectedSlotIndex ? `imagine-job-${job.id}-${selectedSlotIndex}` : `imagine-job-${job.id}`,
    type,
    object_url: context.preview_url || "",
    preview_url: context.preview_url || "",
    title: status === "moderated" ? "Moderated" : status === "failed" ? "Failed" : "Creating",
    prompt: job.prompt || "",
    role: "result",
    aspect_ratio: context.aspect_ratio || "",
    model: context.model || "",
  };
  return {
    post_id: `imagine-job-${job.id}`,
    source: "imagine",
    mode: context.mode || type,
    title: item.title,
    prompt: job.prompt || "",
    folder_path: `__imagine_job__/${job.id}`,
    representative_item: item,
    items: [item],
    is_job_post: true,
    base_post: basePost?.items?.length ? basePost : null,
    job,
    selected_job_slot_index: Number.isFinite(selectedSlotIndex) ? selectedSlotIndex : 0,
    jobs: (Array.isArray(jobs) && jobs.length ? jobs : [job]).filter((candidate) => (
      typeof generationJobHasVisibleSlots !== "function" || generationJobHasVisibleSlots(candidate)
    )),
  };
}

function updateImagineJobProgressDom(job) {
  if (!job?.id) return;
  const jobIdSelector = cssEscapeValue(job.id);
  const status = imagineJobStatus(job);
  const failed = status === "failed" || status === "moderated";
  const label = buildJobLabel(job);
  const progress = String(Math.max(1, buildJobProgress(job)));

  if (typeof updateGenerationJobCardProgressDom === "function") {
    updateGenerationJobCardProgressDom(job, jobIdSelector);
  }

  for (const progressEl of document.querySelectorAll(`.detail_generation_progress[data-imagine-job-id="${jobIdSelector}"]`)) {
    const slotIndex = Number.parseInt(String(progressEl.dataset.jobSlotIndex || ""), 10) || 0;
    const slotProgress = typeof buildJobSlotProgress === "function" ? buildJobSlotProgress(job, slotIndex) : buildJobProgress(job);
    progressEl.innerHTML = `Creating <span class="detail_generation_percent">${Math.max(1, slotProgress)}%</span>`;
  }

  for (const progressEl of document.querySelectorAll(`.detail_job_thumb[data-imagine-job-id="${jobIdSelector}"] .detail_job_thumb_progress`)) {
    const slotIndex = Number.parseInt(String(progressEl.closest(".detail_job_thumb")?.dataset.jobSlotIndex || ""), 10) || 0;
    progressEl.textContent = String(Math.max(1, typeof buildJobSlotProgress === "function" ? buildJobSlotProgress(job, slotIndex) : buildJobProgress(job)));
  }

  for (const badge of document.querySelectorAll(`.detail_job_badge[data-imagine-job-id="${jobIdSelector}"]`)) {
    const slotIndex = Number.parseInt(String(badge.dataset.jobSlotIndex || ""), 10) || 0;
    badge.classList.toggle("failed", failed);
    badge.classList.toggle("running", !failed);
    const badgeLabel = badge.querySelector(".detail_job_badge_label") || badge.querySelector("span");
    const slotProgressText = typeof buildJobSlotProgressText === "function"
      ? buildJobSlotProgressText(job, slotIndex)
      : String(Math.max(1, typeof buildJobSlotProgress === "function" ? buildJobSlotProgress(job, slotIndex) : buildJobProgress(job)));
    if (badgeLabel) badgeLabel.textContent = failed ? "×" : slotProgressText;
    if (failed) badge.removeAttribute("aria-disabled");
    else badge.setAttribute("aria-disabled", "true");
  }
}

function upsertImagineJob(job, options = {}) {
  if (!job?.id) return;
  const list = Array.isArray(library_state.imagineJobs) ? library_state.imagineJobs : [];
  const index = list.findIndex((candidate) => String(candidate.id) === String(job.id));
  if (index >= 0) list.splice(index, 1, { ...list[index], ...job });
  else list.unshift(job);
  library_state.imagineJobs = list;
  if (options.progressOnly && !imagineJobTerminal(job)) {
    updateImagineJobProgressDom(job);
    return;
  }
  renderImagineJobSourceViews();
  const detailPost = selectedLibraryPost();
  if (selectedImagineJob()?.id === job.id || library_state.selectedImagineJobId === job.id || generationJobMatchesPost(job, detailPost)) renderDetailViews();
}

function removeImagineJob(jobId, options = {}) {
  const id = String(jobId || "");
  const wasSelected = library_state.selectedImagineJobId === id;
  const detailPost = selectedLibraryPost();
  library_state.imagineJobs = (library_state.imagineJobs || []).filter((job) => String(job.id || "") !== id);
  if (wasSelected) {
    library_state.selectedImagineJobId = "";
    if (screen_state.current_screen === "i_detail" && detailPost?.items?.length) {
      const selectedStillValid = detailPost.items.some((item) => mediaItemKey(item) === library_state.selectedDetailItemId);
      if (!selectedStillValid) {
        library_state.selectedDetailItemId = mediaItemKey(detailDefaultSelectedItem(detailPost));
      }
    } else if (screen_state.current_screen === "i_detail") {
      openScreen("i_main", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
    }
  }
  if (!options.skipRender) {
    renderImagineJobSourceViews();
    renderDetailViews();
  }
}

function selectImagineJob(jobId, options = {}) {
  const job = (library_state.imagineJobs || []).find((candidate) => String(candidate.id || "") === String(jobId || ""));
  if (!job) return;
  library_state.selectedImagineJobId = String(job.id);
  library_state.selectedJobId = "";
  if (!options.keepDetailPost) library_state.selectedPostPath = "";
  if (options.slotIndex) library_state.selectedDetailItemId = `imagine-job-${job.id}-${options.slotIndex}`;
  else if (!options.keepDetailPost || options.focusJobThumb) library_state.selectedDetailItemId = "";
  renderDetailViews();
  openScreen("i_detail", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
}

function activeImagineAccountId() {
  return String(account_state.imagine?.active_id || account_state.imagine?.accounts?.[0]?.id || "");
}

function imagineSubmissionPreview(postOverride = null, itemOverride = undefined) {
  if (postOverride || screen_state.current_screen === "i_detail") {
    const post = postOverride || selectedLibraryPost();
    const item = arguments.length >= 2 ? itemOverride : selectedDetailItem(post);
    const mediaUrl = detailMediaUrlForItem("i", item, post);
    const previewUrl = detailVideoPreviewUrlForItem("i", item, post) || detailPreviewUrlForItem("i", item, post);
    const renderedAspect = typeof detailRenderedMediaAspect === "function" ? detailRenderedMediaAspect("i", item) : "";
    const aspectRatio = renderedAspect || (typeof detailAspectFromItem === "function" ? detailAspectFromItem(item) : "");
    if (mediaUrl) {
      return {
        url: previewUrl || mediaUrl,
        type: detailItemType(item),
        aspect_ratio: aspectRatio,
      };
    }
  }
  const attachment = composerAttachments.find((item) => item.preview_url || item.source_url || item.raw_url);
  if (attachment) {
    return {
      url: attachment.preview_url || attachment.source_url || attachment.raw_url || "",
      type: composerMediaKind(attachment) || "image",
      aspect_ratio: attachment.aspect_ratio || attachment.aspectRatio || "",
    };
  }
  return {
    url: "",
    type: composerState.mode === "video" || composerState.mode === "extend" ? "video" : "image",
    aspect_ratio: "",
  };
}

function imagineSubmissionSourceContext(post, item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const postMetadata = post?.metadata && typeof post.metadata === "object" ? post.metadata : {};
  const sourceIsT2i = typeof composerSourceIsT2i === "function" && composerSourceIsT2i(post, item);
  return {
    conversation_id: sourceIsT2i ? "" : String(
      item?.conversation_id
      || metadata.conversation_id
      || imagine.conversation_id
      || postMetadata.conversation_id
      || ""
    ).trim(),
    response_id: sourceIsT2i ? "" : String(
      item?.response_id
      || metadata.response_id
      || imagine.response_id
      || ""
    ).trim(),
    source_is_t2i: sourceIsT2i,
  };
}

function imaginePrimarySubmissionAttachment(attachments, mode) {
  const list = Array.isArray(attachments) ? attachments : [];
  const expectedType = mode === "extend" ? "video" : (mode === "image" || mode === "video" ? "image" : "");
  if (!expectedType) return null;
  return list.find((attachment) => composerMediaKind(attachment) === expectedType) || null;
}

function imagineAttachmentSubmissionContext(attachment) {
  const source = attachment && typeof attachment === "object" ? attachment : {};
  const sourceIsT2i = source.source_is_t2i === true;
  return {
    conversation_id: sourceIsT2i ? "" : String(source.conversation_id || source.source_conversation_id || "").trim(),
    response_id: sourceIsT2i ? "" : String(source.response_id || source.parent_response_id || "").trim(),
    source_is_t2i: sourceIsT2i,
  };
}

function imagineAttachmentSubmissionItemId(attachment) {
  const source = attachment && typeof attachment === "object" ? attachment : {};
  return String(
    source.detail_item_id
    || source.item_id
    || source.post_id
    || source.asset_id
    || ""
  ).trim();
}

function imagineImageAspectFromAttachment(attachment) {
  if (composerMediaKind(attachment) !== "image") return Promise.resolve("");
  const source = String(attachment?.data_url || attachment?.source_url || attachment?.preview_url || "").trim();
  if (!source) return Promise.resolve("");
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (aspect = "") => {
      image.onload = null;
      image.onerror = null;
      resolve(aspect);
    };
    image.onload = () => {
      const width = Number(image.naturalWidth || 0);
      const height = Number(image.naturalHeight || 0);
      finish(width > 0 && height > 0 ? `${width} / ${height}` : "");
    };
    image.onerror = () => finish("");
    image.src = source;
    if (image.complete && image.naturalWidth && image.naturalHeight) {
      finish(`${image.naturalWidth} / ${image.naturalHeight}`);
    }
  });
}

async function imagineAttachmentsWithMeasuredImageAspects(attachments) {
  return Promise.all((attachments || []).map(async (attachment) => {
    const measuredAspect = await imagineImageAspectFromAttachment(attachment);
    return measuredAspect ? { ...attachment, aspect_ratio: measuredAspect } : attachment;
  }));
}

function createPendingImagineJob(prompt, preview, sourcePostPath, sourceItemId) {
  return {
    id: `pending-imagine-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: composerState.mode === "video" || composerState.mode === "extend" ? "video" : "image",
    status: "running",
    progress: 1,
    prompt,
    error: "",
    context: {
      provider: "imagine",
      generation_provider: "imagine",
      mode: composerState.mode,
      source_post_path: sourcePostPath || "",
      source_item_id: sourceItemId || "",
      preview_url: preview?.url || "",
      preview_type: preview?.type || "",
      aspect_ratio: preview?.aspect_ratio || "",
      phase: "preparing",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pending_client_job: true,
  };
}

function discardPendingImagineJob(jobId, render = true) {
  const id = String(jobId || "");
  if (!id) return;
  library_state.imagineJobs = (library_state.imagineJobs || []).filter((job) => String(job.id || "") !== id);
  if (library_state.selectedImagineJobId === id) library_state.selectedImagineJobId = "";
  if (render) {
    renderImagineSourceCards();
    renderDetailViews();
  }
}

function shouldCreatePendingImagineDetailJob(sourcePostPath) {
  if (screen_state.current_screen !== "i_detail" || !sourcePostPath) return false;
  return ["image", "video", "extend"].includes(String(composerState.mode || ""));
}

function stopImagineJobPolling(jobId) {
  const id = String(jobId || "");
  const timer = imagineJobPollTimers.get(id);
  if (timer) window.clearTimeout(timer);
  imagineJobPollTimers.delete(id);
}

function imagineMergeItemInputRole(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return [
    item?.role,
    item?.relation,
    item?.source_type,
    item?.kind,
    metadata.role,
    metadata.relation,
    metadata.source_type,
    imagine.role,
    imagine.relation,
    imagine.source_type,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function imagineMergeNormalizeKey(value) {
  return String(value || "").trim().split("#", 1)[0];
}

function imagineMergeItemIdentityValues(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return [
    mediaItemKey(item),
    item?.item_id,
    item?.id,
    item?.post_id,
    item?.file,
    item?.url,
    item?.remote_url,
    item?.object_url,
    item?.media_url,
    item?.source_url,
    item?.thumbnail_url,
    metadata.post_id,
    metadata.media_url,
    metadata.remote_url,
    metadata.object_url,
    metadata.source_url,
    metadata.thumbnail_url,
    imagine.post_id,
    imagine.media_url,
  ].map(imagineMergeNormalizeKey).filter(Boolean);
}

function imagineMergeCurrentAttachmentValues() {
  const values = new Set();
  for (const attachment of Array.isArray(composerAttachments) ? composerAttachments : []) {
    for (const value of [
      attachment?.item_id,
      attachment?.id,
      attachment?.post_id,
      attachment?.asset_id,
      attachment?.detail_item_id,
      attachment?.upload_item_id,
      attachment?._imagine_file_attachment_id,
      attachment?._imagine_liked_post_id,
      attachment?.raw_url,
      attachment?.source_url,
      attachment?.url,
      attachment?.remote_url,
      attachment?.object_url,
      attachment?.media_url,
      attachment?.preview_url,
    ]) {
      const key = imagineMergeNormalizeKey(value);
      if (key) values.add(key);
    }
  }
  return values;
}

function imagineMergeItemMatchesCurrentAttachment(item) {
  const attachmentValues = imagineMergeCurrentAttachmentValues();
  if (!attachmentValues.size) return false;
  return imagineMergeItemIdentityValues(item).some((value) => attachmentValues.has(value));
}

function imagineMergeItemLooksLikeInput(item) {
  const roleText = imagineMergeItemInputRole(item);
  if (!roleText) return false;
  const hasGeneratedMarker = /\b(result|child|generated|moderated)\b/.test(roleText);
  const hasInputMarker = /\b(source|upload|input|reference|original|parent|start)\b/.test(roleText);
  return hasInputMarker && !hasGeneratedMarker;
}

function mergeImagineGeneratedItems(post, generatedItems) {
  if (!post) return post;
  const additions = (Array.isArray(generatedItems) ? generatedItems : [generatedItems])
    .filter(Boolean)
    .filter((item) => !imagineMergeItemLooksLikeInput(item))
    .filter((item) => !imagineMergeItemMatchesCurrentAttachment(item));
  if (!additions.length) return normalizeServerPost(post);
  let items = [...(post.items || [])];
  for (const item of additions) {
    const itemKey = mediaItemKey(item);
    const itemUrl = String(item.url || item.remote_url || item.object_url || "");
    const existing = items.some((candidate) => {
      return mediaItemKey(candidate) === itemKey
        || (itemUrl && [candidate.url, candidate.remote_url, candidate.object_url].map((value) => String(value || "")).includes(itemUrl));
    });
    if (!existing) items.push(item);
  }
  const representative = representativeItem(items, { ...post, items }) || items[items.length - 1];
  return normalizeServerPost({
    ...post,
    prompt: post.prompt || additions[0]?.prompt || "",
    items,
    representative: representative?.file || representative?.url || representative?.item_id || "",
    representative_item: representative,
  });
}

function upsertImagineRemotePost(post) {
  if (!post?.folder_path) return "";
  const normalized = normalizeServerPost(post);
  const list = Array.isArray(library_state.imagineRemotePosts) ? library_state.imagineRemotePosts : [];
  const index = list.findIndex((candidate) => candidate?.folder_path === normalized.folder_path);
  if (index >= 0) list.splice(index, 1, normalized);
  else list.unshift(normalized);
  library_state.imagineRemotePosts = list;
  syncImagineRemotePostsIntoLibrary();
  return normalized.folder_path;
}

function applyImagineDirectResult(result, options = {}) {
  if (!result) return;
  let selectedPath = "";
  const upsertedPaths = [];
  const skipPaths = options.skipPaths instanceof Set ? options.skipPaths : new Set();
  const targetPath = String(result.target_folder_path || result.source_post_path || "");
  const items = Array.isArray(result.items) && result.items.length ? result.items : [result.item].filter(Boolean);
  const item = items[items.length - 1] || null;
  const resultPosts = Array.isArray(result.posts) ? result.posts.filter(Boolean) : [];
  if (resultPosts.length) {
    for (const post of resultPosts) {
      const candidatePath = String(post?.folder_path || "");
      if (candidatePath && skipPaths.has(candidatePath)) continue;
      const path = upsertImagineRemotePost(post);
      if (path) upsertedPaths.push(path);
      if (path) selectedPath = path;
      if (targetPath && path === targetPath) selectedPath = path;
    }
  } else {
    if (targetPath && items.length) {
      const existing = (library_state.imagineRemotePosts || []).find((post) => post.folder_path === targetPath)
        || (library_state.posts || []).find((post) => post.folder_path === targetPath);
      if (existing) {
        selectedPath = upsertImagineRemotePost(mergeImagineGeneratedItems(existing, items));
        if (selectedPath) upsertedPaths.push(selectedPath);
      }
    }
    if (!selectedPath && result.post) {
      selectedPath = upsertImagineRemotePost(result.post);
      if (selectedPath) upsertedPaths.push(selectedPath);
    }
    if (!selectedPath && items.length) {
      const representative = representativeItem(items, { items }) || item;
      selectedPath = upsertImagineRemotePost({
        post_id: representative?.root_post_id || representative?.item_id,
        source: "imagine",
        mode: result.action || "direct",
        area: "imagine_remote",
        remote: true,
        title: representative?.prompt || "Imagine",
        prompt: representative?.prompt || "",
        created_at: representative?.created_at || new Date().toISOString(),
        folder_path: `imagine_generated/${representative?.root_post_id || representative?.item_id}`,
        representative: representative?.url || representative?.item_id,
        representative_item: representative,
        items,
      });
      if (selectedPath) upsertedPaths.push(selectedPath);
    }
  }
  if (options.stayOnImagineT2i) {
    if (!library_state.sessionImagineT2iPaths) library_state.sessionImagineT2iPaths = new Set();
    upsertedPaths.forEach((path) => {
      if (path) library_state.sessionImagineT2iPaths.add(path);
    });
  }
  renderImagineSourceCards();
  if (options.stayOnImagineT2i) {
    showImagineT2iViewNow();
    return;
  }
  if (selectedPath) {
    if (result.selected_item_id) {
      library_state.selectedDetailItemId = result.selected_item_id;
      if (typeof resetDetailMediaAspect === "function") resetDetailMediaAspect("i");
    }
    selectLibraryPost(selectedPath);
    if (result.selected_item_id && library_state.selectedDetailItemId !== result.selected_item_id) {
      library_state.selectedDetailItemId = result.selected_item_id;
      renderDetailViews();
    }
    screen_state.detail_back.imagine = { screenId: "i_main", activeButtonId: screen_state.current_i_nav_btn || "i_imagine_nav_btn" };
    openScreen("i_detail", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
    if (String(result.action || "").toLowerCase() === "i2i" && typeof resetComposerAttachmentsToSelectedDetail === "function") {
      resetComposerAttachmentsToSelectedDetail();
    }
  } else {
    renderDetailViews();
  }
}

function showImagineT2iViewNow() {
  library_state.selectedImagineJobId = "";
  library_state.iMainView = typeof imagineViewValue === "function" ? imagineViewValue("T2I", "t2i") : "t2i";
  if (typeof setImagineTab === "function") setImagineTab("i_t2i_btn");
  openScreen("i_main", "i_imagine_nav_btn");
  renderImagineSourceCards();
}

function shouldSwitchImagineT2iBeforeSubmit() {
  if (composerState.provider !== "imagine" || composerState.mode !== "image") return false;
  if (screen_state.current_screen === "i_detail") return false;
  return !composerAttachments.some((attachment) => composerMediaKind(attachment) === "image");
}

function finishImagineJob(job) {
  stopImagineJobPolling(job.id);
  const jobId = String(job?.id || "");
  const appliedT2iPaths = imagineT2iAppliedPaths.get(jobId) || new Set();
  imagineT2iPartialCounts.delete(jobId);
  imagineT2iAppliedPaths.delete(jobId);
  const status = imagineJobStatus(job);
  if (status === "done" && job.result) {
    if (String(job.result.action || job.context?.mode || "").toLowerCase() === "upscale") {
      removeImagineJob(job.id, { skipRender: true });
      if (typeof applyImagineUpscaleJobResult === "function" && applyImagineUpscaleJobResult(job.result)) {
        if (job.result.selected_item_id) library_state.selectedDetailItemId = job.result.selected_item_id;
        refreshImagineRemoteViews();
        toast("Upscaled video.");
      } else {
        showErrorPanel("Upscale failed", "Upscale response did not include a video URL.");
      }
      qApi("/api/imagine/dismiss", { id: job.id }).catch(() => {});
      return;
    }
    const stayOnImagineT2i = typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job);
    removeImagineJob(job.id, { skipRender: true });
    applyImagineDirectResult(job.result, { stayOnImagineT2i, skipPaths: appliedT2iPaths });
    if (typeof resultHasLucky === "function" && resultHasLucky(job.result)) showLuckyNotice();
    qApi("/api/imagine/dismiss", { id: job.id }).catch(() => {});
    return;
  }
  if (status === "cancelled" || status === "canceled") {
    removeImagineJob(job.id);
    qApi("/api/imagine/dismiss", { id: job.id }).catch(() => {});
    return;
  }
  if (status === "moderated" || isModerationError(job.error)) {
    upsertImagineJob(job);
    if (!notifiedImagineJobs.has(job.id)) {
      notifiedImagineJobs.add(job.id);
      toastError("Moderated");
    }
    return;
  }
  if (status === "failed") {
    upsertImagineJob(job);
    if (!notifiedImagineJobs.has(job.id)) {
      notifiedImagineJobs.add(job.id);
      showErrorPanel("Imagine failed", job.error || "Imagine request failed.");
    }
  }
}

function scheduleImagineJobPoll(jobId) {
  const id = String(jobId || "");
  if (!id || imagineJobPollTimers.has(id)) return;
  const run = async () => {
    imagineJobPollTimers.delete(id);
    try {
      const data = await qApi("/api/imagine/job", { id });
      const job = data?.job;
      if (!job) return;
      const partialChanged = applyImagineT2iPartialJobResult(job);
      if (imagineJobTerminal(job)) {
        finishImagineJob(job);
        return;
      }
      upsertImagineJob(job, { progressOnly: !partialChanged });
    } catch (error) {
      console.warn(error);
    }
    imagineJobPollTimers.set(id, window.setTimeout(run, 1200));
  };
  imagineJobPollTimers.set(id, window.setTimeout(run, 500));
}

async function submitImagineComposer() {
  if (composerState.provider !== "imagine") {
    toastError("Imagine screen에서 사용해주세요.");
    return;
  }
  if (!library_state.apiReady) {
    showErrorPanel("Imagine request failed", "Grok Chameleon.app로 실행해야 Imagine 호출을 사용할 수 있습니다.");
    return;
  }
  const input = document.getElementById("composer_input");
  const prompt = String(input?.value || "").trim();
  if (!prompt) {
    input?.focus();
    return;
  }
  const switchedToT2iView = shouldSwitchImagineT2iBeforeSubmit();
  const submissionAccountId = activeImagineAccountId();
  if (switchedToT2iView) showImagineT2iViewNow();
  const isExtendSubmit = composerState.mode === "extend";
  const initialPost = screen_state.current_screen === "i_detail" ? selectedLibraryPost() : null;
  const initialItem = initialPost ? selectedDetailItem(initialPost) : null;
  const initialPreview = imagineSubmissionPreview(initialPost, initialItem);
  const initialSourcePostPath = initialPost?.area === "imagine_remote" ? initialPost.folder_path : "";
  const initialSourceItemId = initialItem ? mediaItemKey(initialItem) : "";
  const useInitialDetailSource = Boolean(
    initialSourcePostPath
    && ["image", "video", "extend"].includes(String(composerState.mode || "")),
  );
  let lockedExtendAttachment = null;
  if (isExtendSubmit) {
    if (typeof prepareDetailExtendFromCurrentVideo === "function") prepareDetailExtendFromCurrentVideo();
    lockedExtendAttachment = await detailVideoAttachmentForSourceMode(initialPost, initialItem);
    if (!lockedExtendAttachment) {
      showErrorPanel("Extend unavailable", "Select an Imagine video thumbnail.");
      return;
    }
  }
  let pendingJob = null;
  if (shouldCreatePendingImagineDetailJob(initialSourcePostPath)) {
    pendingJob = createPendingImagineJob(prompt, initialPreview, initialSourcePostPath, initialSourceItemId);
    upsertImagineJob(pendingJob);
    selectImagineJob(pendingJob.id, {
      keepDetailPost: true,
      focusJobThumb: true,
    });
  }
  setComposerBusy(true);
  try {
    if (typeof prepareActiveImagineBridgeSession === "function") {
      await prepareActiveImagineBridgeSession({ force: false, silent: false, accountId: submissionAccountId });
    }
    if (useInitialDetailSource) await syncDetailAttachmentForComposerTray(initialPost, initialItem);
    else await syncDetailAttachmentForComposerTray();
    trimComposerAttachmentsToLimit();
    await ensureComposerAttachmentsReady();
    let attachments = composerAttachments.map(composerSubmissionAttachment);
    attachments = await imagineAttachmentsWithMeasuredImageAspects(attachments);
    if (isExtendSubmit) {
      const detailAttachment = lockedExtendAttachment || await detailVideoAttachmentForSourceMode(initialPost, initialItem);
      if (detailAttachment) {
        attachments = [detailAttachment];
      } else if (!hasVideoAttachment(attachments)) {
        throw new Error("Extend needs one source video.");
      }
    }
    const requestOptions = composerRequestOptions();
    if (composerState.mode === "video" && !requestOptions.aspect_ratio) {
      const sourceImage = attachments.find((attachment) => composerMediaKind(attachment) === "image");
      if (sourceImage) {
        const imageSource = String(sourceImage.data_url || sourceImage.source_url || "").trim();
        if (imageSource) {
          requestOptions.aspect_ratio = await new Promise((resolve) => {
            const image = new Image();
            image.onload = () => {
              const width = Number(image.naturalWidth || 0);
              const height = Number(image.naturalHeight || 0);
              if (!width || !height) {
                resolve("");
                return;
              }
              const gcd = (left, right) => {
                let a = Math.round(Math.abs(left));
                let b = Math.round(Math.abs(right));
                while (b) [a, b] = [b, a % b];
                return a || 1;
              };
              const divisor = gcd(width, height);
              resolve(`${Math.round(width / divisor)}:${Math.round(height / divisor)}`);
            };
            image.onerror = () => resolve("");
            image.src = imageSource;
          });
        }
      }
    }
    const post = useInitialDetailSource ? initialPost : selectedLibraryPost();
    const item = useInitialDetailSource ? initialItem : selectedDetailItem(post);
    const primarySourceAttachment = imaginePrimarySubmissionAttachment(attachments, composerState.mode);
    const preview = useInitialDetailSource ? initialPreview : imagineSubmissionPreview();
    const attachmentSourcePostPath = String(primarySourceAttachment?.detail_post_path || "").trim();
    const fallbackSourcePostPath = useInitialDetailSource
      ? initialSourcePostPath
      : (screen_state.current_screen === "i_detail" && post?.area === "imagine_remote" ? post.folder_path : "");
    const sourcePostPath = attachmentSourcePostPath || (!primarySourceAttachment ? fallbackSourcePostPath : "");
    const attachmentSourceItemId = imagineAttachmentSubmissionItemId(primarySourceAttachment);
    const fallbackSourceItemId = useInitialDetailSource ? initialSourceItemId : (item ? mediaItemKey(item) : "");
    const sourceItemId = attachmentSourceItemId || (!primarySourceAttachment ? fallbackSourceItemId : "");
    const sourceContext = primarySourceAttachment
      ? imagineAttachmentSubmissionContext(primarySourceAttachment)
      : (sourcePostPath ? imagineSubmissionSourceContext(post, item) : { conversation_id: "", response_id: "" });
    const isImageToImage = composerState.mode === "image"
      && (useInitialDetailSource || attachments.some((attachment) => composerMediaKind(attachment) === "image"));
    const isTextToImage = composerState.mode === "image"
      && !useInitialDetailSource
      && !attachments.some((attachment) => composerMediaKind(attachment) === "image");
    if (isTextToImage && !switchedToT2iView) showImagineT2iViewNow();
    const data = await qApi("/api/imagine/start", {
      provider: "imagine",
      mode: composerState.mode,
      prompt,
      options: requestOptions,
      attachments,
      preview_url: preview.url,
      preview_type: preview.type,
      source_post_path: sourcePostPath,
      source_item_id: sourceItemId,
      source_conversation_id: sourceContext.conversation_id,
      parent_response_id: sourceContext.response_id,
      source_is_t2i: sourceContext.source_is_t2i === true,
      account_id: submissionAccountId,
    });
    if (data?.job) {
      if (pendingJob) discardPendingImagineJob(pendingJob.id, false);
      upsertImagineJob(data.job);
      if (!isTextToImage && (screen_state.current_screen === "i_detail" || isImageToImage)) {
        selectImagineJob(data.job.id, {
          keepDetailPost: screen_state.current_screen === "i_detail" && Boolean(sourcePostPath),
          focusJobThumb: true,
        });
      }
      scheduleImagineJobPoll(data.job.id);
    }
  } catch (error) {
    console.warn(error);
    if (pendingJob) discardPendingImagineJob(pendingJob.id);
    showErrorPanel("Imagine failed", error?.message || "Imagine request failed.");
  } finally {
    setComposerBusy(false);
  }
}

async function cancelImagineJobFromUi(jobId) {
  const id = String(jobId || "");
  if (!id) return;
  try {
    const data = await qApi("/api/imagine/cancel", { id });
    if (data?.job) {
      upsertImagineJob(data.job);
      if (imagineJobTerminal(data.job)) finishImagineJob(data.job);
    } else {
      removeImagineJob(id);
    }
  } catch (error) {
    showErrorPanel("Imagine failed", error?.message || "Cancel failed.");
  }
}

async function dismissImagineJobFromUi(jobId) {
  const id = String(jobId || "");
  if (!id) return;
  const scrollState = typeof captureLibraryCardListScroll === "function"
    ? captureLibraryCardListScroll()
    : null;
  try {
    await qApi("/api/imagine/dismiss", { id });
  } catch (error) {
    console.warn(error);
  }
  removeImagineJob(id);
  if (typeof restoreLibraryCardListScroll === "function") {
    restoreLibraryCardListScroll(scrollState);
  }
}
