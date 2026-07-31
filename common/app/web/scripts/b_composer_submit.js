// Build composer submit, analyze, and job polling
function setComposerBusy(busy) {
  const send = document.getElementById("composer_send");
  if (send) {
    send.disabled = false;
    send.setAttribute("aria-busy", busy ? "true" : "false");
  }
  composer?.classList.toggle("is-generating", busy);
}

const buildJobPollTimers = new Map();
const notifiedBuildJobs = new Set();
const buildT2iPartialCounts = new Map();

function applyBuildT2iPartialJobResult(job) {
  if (!isTextToImageBuildJob(job)) return false;
  const posts = Array.isArray(job?.partial_result?.posts) ? job.partial_result.posts.filter(Boolean) : [];
  const previousCount = buildT2iPartialCounts.get(String(job?.id || "")) || 0;
  if (!posts.length || posts.length <= previousCount) return false;
  for (const post of posts) {
    const normalized = normalizeServerPost(post);
    const index = library_state.posts.findIndex((candidate) => candidate?.folder_path === normalized.folder_path);
    if (index >= 0) library_state.posts.splice(index, 1, normalized);
    else library_state.posts.unshift(normalized);
  }
  markSessionBuildT2iPaths({ selected_paths: posts.map((post) => post.folder_path).filter(Boolean) });
  buildT2iPartialCounts.set(String(job.id), posts.length);
  return true;
}

function buildSubmissionPreview(postOverride = null, itemOverride = undefined) {
  const attachment = composerAttachments.find((item) => item.preview_url || item.source_url);
  if (attachment) {
    return {
      url: attachment.preview_url || attachment.source_url || "",
      type: composerMediaKind(attachment) || "image",
    };
  }
  if (composerState.mode === "extend" || composerState.mode === "video_edit") {
    const post = postOverride || selectedLibraryPost();
    const item = arguments.length >= 2 ? itemOverride : selectedDetailItem(post);
    const prefix = screen_state.current_screen === "i_detail" ? "i" : "b";
    const mediaUrl = detailMediaUrlForItem(prefix, item, post);
    const previewUrl = detailVideoPreviewUrlForItem(prefix, item, post) || detailPreviewUrlForItem(prefix, item, post);
    if (mediaUrl && detailItemType(item) === "video") {
      return {
        url: previewUrl || mediaUrl,
        type: "video",
      };
    }
  }
  if (postOverride || screen_state.current_screen === "b_detail") {
    const post = postOverride || selectedLibraryPost();
    const item = arguments.length >= 2 ? itemOverride : selectedDetailItem(post);
    const mediaUrl = detailMediaUrlForItem("b", item, post);
    const previewUrl = detailPreviewUrlForItem("b", item, post) || detailVideoPreviewUrlForItem("b", item, post);
    if (mediaUrl) {
      return {
        url: previewUrl || mediaUrl,
        type: detailItemType(item),
      };
    }
  }
  return { url: "", type: composerState.mode === "video" || composerState.mode === "extend" || composerState.mode === "video_edit" ? "video" : "image" };
}

function buildPrimarySubmissionAttachment(attachments, mode = composerState.mode) {
  const expectedType = mode === "extend" || mode === "video_edit"
    ? "video"
    : (mode === "image" || mode === "video" ? "image" : "");
  if (!expectedType) return null;
  return (Array.isArray(attachments) ? attachments : [])
    .find((attachment) => composerMediaKind(attachment) === expectedType) || null;
}

function buildAttachmentSubmissionPostPath(attachment) {
  return String(attachment?.detail_post_path || attachment?.upload_post_path || "").trim();
}

function buildAttachmentSubmissionItemId(attachment) {
  return String(
    attachment?.detail_item_id
    || attachment?.upload_item_id
    || attachment?.item_id
    || ""
  ).trim();
}

function buildAttachmentSubmissionPreview(attachment) {
  return {
    url: String(attachment?.preview_url || attachment?.source_url || attachment?.raw_url || ""),
    type: composerMediaKind(attachment) || (composerState.mode === "video" ? "image" : composerState.mode),
  };
}

function createPendingBuildJob(prompt, preview, sourcePostPath, sourceItemId) {
  return {
    id: `pending-build-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: composerState.mode === "video" || composerState.mode === "extend" || composerState.mode === "video_edit" ? "video" : "image",
    status: "running",
    progress: 1,
    prompt,
    error: "",
    context: {
      provider: "build",
      generation_provider: "build",
      mode: composerState.mode,
      source_post_path: sourcePostPath || "",
      source_item_id: sourceItemId || "",
      preview_url: preview?.url || "",
      preview_type: preview?.type || "",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pending_client_job: true,
  };
}

function discardPendingBuildJob(jobId, render = true) {
  const id = String(jobId || "");
  if (!id) return;
  library_state.jobs = (library_state.jobs || []).filter((job) => String(job.id || "") !== id);
  if (library_state.selectedJobId === id) library_state.selectedJobId = "";
  if (render) {
    renderSourceCards("build");
    renderBuildT2iViewCards();
    renderDetailViews();
  }
}

function shouldCreatePendingBuildDetailJob(sourcePostPath) {
  if (screen_state.current_screen !== "b_detail" || !sourcePostPath) return false;
  return ["image", "video", "extend", "video_edit"].includes(String(composerState.mode || ""));
}

function stopBuildJobPolling(jobId) {
  const id = String(jobId || "");
  const timer = buildJobPollTimers.get(id);
  if (timer) window.clearTimeout(timer);
  buildJobPollTimers.delete(id);
}

function notifyFinishedBuildJob(job) {
  if (!job?.id || notifiedBuildJobs.has(job.id)) return;
  const status = buildJobStatus(job);
  if (status !== "failed" && status !== "moderated") return;
  notifiedBuildJobs.add(job.id);
  if (status === "moderated" || isModerationError(job.error)) {
    toastError("Moderated");
    return;
  }
  showErrorPanel("Job failed", job.error || "Build request failed.");
}

function isTextToImageBuildJob(job) {
  const mode = String(job?.context?.mode || "").toLowerCase();
  return mode === "t2i";
}

function showBuildT2iViewNow() {
  library_state.selectedJobId = "";
  library_state.bMainView = "t2i";
  openScreen("b_main", "b_build_btn");
  renderSourceCards("build");
}

function showBuildMainNow() {
  library_state.selectedJobId = "";
  library_state.bMainView = "build";
  openScreen("b_main", "b_build_btn");
  renderSourceCards("build");
}

function shouldShowBuildMainBeforeSubmit() {
  if (composerState.provider !== "build" || composerState.mode !== "image") return false;
  if (screen_state.current_screen === "b_detail") return false;
  return !composerAttachments.length;
}

function finishBuildJob(job) {
  stopBuildJobPolling(job.id);
  buildT2iPartialCounts.delete(String(job?.id || ""));
  const status = buildJobStatus(job);
  if (status === "done" && job.result) {
    const stayOnBuildMain = isTextToImageBuildJob(job);
    removeBuildJob(job.id);
    if (stayOnBuildMain && typeof markSessionBuildT2iPaths === "function") {
      markSessionBuildT2iPaths(job.result);
    }
    if (!stayOnBuildMain && job.result.selected_path) {
      noteMainGenerationActivity("build", "post", job.result.selected_path);
    }
    applyLibrarySnapshot(job.result);
    if (typeof resultHasLucky === "function" && resultHasLucky(job.result)) showLuckyNotice();
    if (job.result.selected_path && !stayOnBuildMain) {
      if (job.result.selected_item_id) {
        library_state.selectedDetailItemId = job.result.selected_item_id;
        if (typeof resetDetailMediaAspect === "function") resetDetailMediaAspect("b");
      }
      selectLibraryPost(job.result.selected_path);
      if (job.result.selected_item_id && library_state.selectedDetailItemId !== job.result.selected_item_id) {
        library_state.selectedDetailItemId = job.result.selected_item_id;
        renderDetailViews();
      }
      screen_state.detail_back.build = { screenId: "b_main", activeButtonId: "b_build_btn" };
      openScreen("b_detail", "b_build_btn");
      const completedMode = String(job.context?.mode || "").toLowerCase();
      const completedFromImage = Boolean(job.context?.source_item_id);
      if (
        (completedMode === "i2i" || (completedMode === "video" && completedFromImage))
        && typeof resetComposerAttachmentsToSelectedDetail === "function"
      ) {
        resetComposerAttachmentsToSelectedDetail();
      }
    } else {
      if (stayOnBuildMain) library_state.bMainView = "build";
      openScreen("b_main", "b_build_btn");
      renderSourceCards("build");
    }
    return;
  }
  if (status === "cancelled" || status === "canceled") {
    removeBuildJob(job.id);
    return;
  }
  if (status === "failed" || status === "moderated") {
    upsertBuildJob(job);
    notifyFinishedBuildJob(job);
  }
}

function scheduleBuildJobPoll(jobId) {
  const id = String(jobId || "");
  if (!id || buildJobPollTimers.has(id)) return;
  const run = async () => {
    buildJobPollTimers.delete(id);
    try {
      const data = await qApi("/api/build/job", { id });
      const job = data?.job;
      if (!job) return;
      const partialChanged = applyBuildT2iPartialJobResult(job);
      if (buildJobTerminal(job)) {
        finishBuildJob(job);
        return;
      }
      upsertBuildJob(job, { progressOnly: !partialChanged });
    } catch (error) {
      console.warn(error);
    }
    buildJobPollTimers.set(id, window.setTimeout(run, 500));
  };
  buildJobPollTimers.set(id, window.setTimeout(run, 500));
}

async function refreshBuildJobs() {
  if (!library_state.apiReady) return;
  try {
    const data = await qApi("/api/build/jobs");
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    library_state.jobs = jobs.filter(isRenderableBuildJob);
    renderSourceCards("build");
    for (const job of jobs) {
      if (!buildJobTerminal(job)) scheduleBuildJobPoll(job.id);
    }
  } catch (error) {
    console.warn(error);
  }
}

async function submitBuildComposer() {
  if (composerState.provider !== "build") {
    toastError("Build screen에서 사용해주세요.");
    return;
  }
  if (!library_state.apiReady) {
    showErrorPanel("Build request failed", "Grok Chameleon.app로 실행해야 Build 호출을 사용할 수 있습니다.");
    return;
  }
  const input = document.getElementById("composer_input");
  const prompt = normalizeNfcText(input?.value || "").trim();
  if (composerState.mode === "analyze") {
    await submitBuildAnalyze();
    return;
  }
  if (!prompt) {
    input?.focus();
    return;
  }
  const movedToBuildMain = shouldShowBuildMainBeforeSubmit();
  if (movedToBuildMain) showBuildMainNow();
  const initialSelection = screen_state.current_screen === "b_detail" && typeof selectedDetailSourceContext === "function"
    ? selectedDetailSourceContext()
    : { post: null, item: null };
  const initialSourcePost = initialSelection.post;
  const initialSourceItem = initialSelection.item;
  let pendingJob = null;
  setComposerBusy(true);
  try {
    if (initialSourcePost && initialSourceItem) await syncDetailAttachmentForComposerTray(initialSourcePost, initialSourceItem);
    else await syncDetailAttachmentForComposerTray();
    pruneComposerAttachmentsForMode();
    const lockedAttachments = [...composerAttachments];
    const primarySource = buildPrimarySubmissionAttachment(lockedAttachments);
    const sourcePostPath = buildAttachmentSubmissionPostPath(primarySource);
    const sourceItemId = buildAttachmentSubmissionItemId(primarySource);
    const preview = primarySource
      ? buildAttachmentSubmissionPreview(primarySource)
      : {
        url: "",
        type: composerState.mode === "video" || composerState.mode === "extend" || composerState.mode === "video_edit" ? "video" : "image",
      };
    if (shouldCreatePendingBuildDetailJob(sourcePostPath)) {
      pendingJob = createPendingBuildJob(prompt, preview, sourcePostPath, sourceItemId);
      upsertBuildJob(pendingJob);
      selectBuildJob(pendingJob.id, {
        keepDetailPost: true,
        focusJobThumb: true,
      });
    }
    await Promise.all(lockedAttachments.map((attachment) => ensureComposerAttachmentDataUrl(attachment)));
    const attachments = lockedAttachments.map(composerSubmissionAttachment);
    if ((composerState.mode === "extend" || composerState.mode === "video_edit") && !hasVideoAttachment(attachments)) {
      throw new Error(composerState.mode === "video_edit" ? "Video Edit needs one source video." : "Extend needs one source video.");
    }
    const isTextToImage = composerState.mode === "image"
      && !attachments.some((attachment) => composerMediaKind(attachment) === "image");
    if (isTextToImage && !movedToBuildMain) showBuildMainNow();
    const requestOptions = composerRequestOptions();
    const data = await qApi("/api/build/start", {
      provider: "build",
      mode: composerState.mode,
      prompt,
      options: requestOptions,
      attachments,
      preview_url: preview.url,
      preview_type: preview.type,
      source_post_path: sourcePostPath,
      source_item_id: sourceItemId,
    });
    if (data?.job) {
      if (pendingJob) discardPendingBuildJob(pendingJob.id, false);
      upsertBuildJob(data.job);
      if (isTextToImage) {
        showBuildMainNow();
      } else {
        selectBuildJob(data.job.id, { keepDetailPost: screen_state.current_screen === "b_detail", focusJobThumb: true });
      }
      scheduleBuildJobPoll(data.job.id);
    }
  } catch (error) {
    console.warn(error);
    if (pendingJob) discardPendingBuildJob(pendingJob.id);
    showErrorPanel("Job failed", error?.message || "Build request failed.");
  } finally {
    setComposerBusy(false);
  }
}

async function submitBuildAnalyze() {
  setComposerBusy(true);
  try {
    await syncDetailAttachmentForComposerTray();
    trimComposerAttachmentsToLimit(composerAnalyzeAttachmentLimit);
    await ensureComposerAttachmentsReady();
    const attachment = composerAttachments.find((item) => composerMediaKind(item) === "image");
    const image = String(attachment?.data_url || attachment?.url || "").trim();
    if (!image) {
      throw new Error("Choose an image in the detail screen or attach an image first.");
    }
    const data = await qApi("/api/analyze", {
      image,
      model: "grok-4.3",
      provider: "build",
      token_source: "build",
    });
    openPromptSave({
      title: "",
      text: data.english || "",
      translation: data.korean || "",
    });
    setLibraryMessage(`Analyzed with ${data.model || "grok-4.3"}.`);
  } catch (error) {
    console.warn(error);
    showErrorPanel("Analyze failed", error?.message || "Analyze failed.");
  } finally {
    setComposerBusy(false);
  }
}
