// Build main cards, favorites, and generation job rendering

  function buildJobProgress(job) {
    const value = Number(job?.progress);
    if (!Number.isFinite(value)) return job?.status === "done" ? 100 : 1;
    return Math.max(0, Math.min(100, Math.round(value)));
  }


  function buildJobPreparing(job) {
    return Boolean(job?.pending_client_job && String(job?.context?.phase || "") === "preparing");
  }


  function buildJobStatus(job) {
    return String(job?.status || "").toLowerCase();
  }


  function buildJobTerminal(job) {
    return ["done", "failed", "moderated", "cancelled", "canceled"].includes(buildJobStatus(job));
  }


  function isRenderableBuildJob(job) {
    const status = buildJobStatus(job);
    return job && !["done", "cancelled", "canceled"].includes(status);
  }


  function buildJobTargetType(job) {
    const kind = String(job?.kind || job?.context?.mode || "").toLowerCase();
    return kind.includes("video") || kind === "extend" ? "video" : "image";
  }


  function buildJobLabel(job) {
    const status = buildJobStatus(job);
    if (buildJobPreparing(job)) return "Preparing";
    if (status === "moderated" || isModerationError(job?.error)) return "Moderated";
    if (status === "failed") {
      if (typeof isUsageLimitError === "function" && isUsageLimitError(job?.error)) return "Usage Limit Reached";
      return isCreditLimitError(job?.error) ? "Credit Limit" : "Failed";
    }
    return `${Math.max(1, buildJobProgress(job))}%`;
  }


  function buildJobCompletedCount(job) {
    const parsed = Number.parseInt(String(job?.context?.completed_count || ""), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }


  function buildJobSlotProgress(job, slotIndex = 0) {
    const slot = Number.parseInt(String(slotIndex || ""), 10) || 0;
    if (slot > 0 && isTextToImageBuildJob(job) && buildJobCompletedCount(job) >= slot) return 100;
    return buildJobProgress(job);
  }


  function buildJobSlotLabel(job, slotIndex = 0) {
    const status = buildJobStatus(job);
    if (buildJobPreparing(job)) return "Preparing";
    if (status === "moderated" || isModerationError(job?.error)) return "Moderated";
    if (status === "failed") {
      if (typeof isUsageLimitError === "function" && isUsageLimitError(job?.error)) return "Usage Limit Reached";
      return isCreditLimitError(job?.error) ? "Credit Limit" : "Failed";
    }
    return `${Math.max(1, buildJobSlotProgress(job, slotIndex))}%`;
  }

  function buildJobSlotProgressText(job, slotIndex = 0) {
    if (buildJobPreparing(job)) return "…";
    return String(Math.max(1, buildJobSlotProgress(job, slotIndex)));
  }


  function cssEscapeValue(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function htmlAttrValue(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
  }


  function generationJobProvider(job) {
    const provider = String(job?.context?.generation_provider || job?.context?.provider || job?.provider || "").toLowerCase();
    return provider === "imagine" ? "imagine" : "build";
  }


  function generationJobSourcePostPath(job) {
    return String(job?.context?.source_post_path || job?.source_post_path || "").trim();
  }


  function generationJobHasSourcePost(job) {
    return Boolean(generationJobSourcePostPath(job));
  }


  function generationJobMatchesPost(job, post) {
    const postPath = String(post?.folder_path || "").trim();
    return Boolean(postPath && generationJobSourcePostPath(job) === postPath);
  }

  function buildJobsForPost(post = null) {
    if (!post?.folder_path) return [];
    return (library_state.jobs || []).filter((job) => (
      isRenderableBuildJob(job)
      && !isTextToImageBuildJob(job)
      && generationJobMatchesPost(job, post)
    ));
  }


  function selectedBuildJobForPost(post = null) {
    const selected = selectedBuildJob();
    const jobs = buildJobsForPost(post);
    if (!post?.folder_path) return selected;
    if (selected && jobs.some((job) => String(job.id || "") === String(selected.id || ""))) return selected;
    return jobs[0] || null;
  }

  function generationJobSourcePost(job, basePost = null) {
    const sourcePath = generationJobSourcePostPath(job);
    if (
      basePost?.items?.length
      && sourcePath
      && String(basePost.folder_path || "") === sourcePath
    ) return basePost;
    if (!sourcePath) return null;
    const pools = [
      library_state.posts || [],
      library_state.collections?.flatMap((collection) => collection.posts || []) || [],
      library_state.imagineRemotePosts || [],
      library_state.imagineDiscoverPosts || [],
      library_state.imagineUnsavedPosts || [],
      library_state.imagineSearchPosts || [],
    ];
    for (const pool of pools) {
      const post = pool.find((candidate) => String(candidate?.folder_path || "") === sourcePath);
      if (post?.items?.length) return post;
    }
    return null;
  }

  function generationJobPreviewPrefix(job, sourcePost = null) {
    if (sourcePost && typeof isImaginePost === "function" && isImaginePost(sourcePost)) return "i";
    return generationJobProvider(job) === "imagine" ? "i" : "b";
  }

  function generationJobPreviewInfo(job, basePost = null, selectedBaseItem = null) {
    const context = job?.context || {};
    const contextUrl = String(context.preview_url || "").trim();
    const contextType = String(context.preview_type || buildJobTargetType(job)).toLowerCase();
    const sourcePost = generationJobSourcePost(job, basePost);
    const sourceItem = generationJobSourceItem(job, sourcePost, selectedBaseItem);
    if (sourcePost && sourceItem) {
      const prefix = generationJobPreviewPrefix(job, sourcePost);
      const sourceType = detailItemType(sourceItem);
      const url = sourceType === "video"
        ? (
          detailVideoPreviewUrlForItem(prefix, sourceItem, sourcePost)
          || detailPreviewUrlForItem(prefix, sourceItem, sourcePost)
          || detailMediaUrlForItem(prefix, sourceItem, sourcePost)
        )
        : (
          detailPreviewUrlForItem(prefix, sourceItem, sourcePost)
          || detailMediaUrlForItem(prefix, sourceItem, sourcePost)
        );
      if (url) return { url: String(url || ""), type: sourceType || contextType || buildJobTargetType(job) };
    }
    if (contextUrl) return { url: contextUrl, type: contextType || buildJobTargetType(job) };
    return { url: "", type: contextType || buildJobTargetType(job) };
  }


  function generationJobDatasetKey(job) {
    return generationJobProvider(job) === "imagine" ? "imagineJobId" : "buildJobId";
  }


  function generationJobDataAttr(job) {
    return generationJobProvider(job) === "imagine" ? "data-imagine-job-id" : "data-build-job-id";
  }


  function generationJobDataAttrHtml(job) {
    return `${generationJobDataAttr(job)}="${htmlAttrValue(job?.id || "")}"`;
  }

  function generationJobSlotKey(job, slotIndex = 0) {
    const slot = isTextToImageBuildJob(job) ? (slotIndex || 1) : 0;
    return `${generationJobProvider(job)}:${job?.id || ""}:${slot}`;
  }

  function generationJobSlotDismissed(job, slotIndex = 0) {
    return Boolean(library_state.dismissedJobSlots?.has(generationJobSlotKey(job, slotIndex)));
  }

  function visibleGenerationJobSlots(job) {
    const count = buildJobT2iSlotCount(job);
    const completed = isTextToImageBuildJob(job) ? Math.min(count, buildJobCompletedCount(job)) : 0;
    const slots = [];
    for (let index = completed + 1; index <= count; index += 1) {
      if (!generationJobSlotDismissed(job, index)) slots.push(index);
    }
    return slots;
  }

  function generationJobHasVisibleSlots(job) {
    return visibleGenerationJobSlots(job).length > 0;
  }

  function dismissGenerationJobSlotFromUi(job, slotIndex = 0) {
    const count = buildJobT2iSlotCount(job);
    if (count <= 1 || !slotIndex) {
      dismissGenerationJobFromUi(job);
      return;
    }
    const scrollState = typeof captureLibraryCardListScroll === "function"
      ? captureLibraryCardListScroll()
      : null;
    if (!library_state.dismissedJobSlots) library_state.dismissedJobSlots = new Set();
    library_state.dismissedJobSlots.add(generationJobSlotKey(job, slotIndex));
    if (!generationJobHasVisibleSlots(job)) {
      dismissGenerationJobFromUi(job);
      return;
    }
    if (generationJobProvider(job) === "imagine") {
      if (library_state.selectedImagineJobId === String(job.id || "")) {
        const nextSlot = visibleGenerationJobSlots(job)[0] || 0;
        library_state.selectedDetailItemId = nextSlot ? `imagine-job-${job.id}-${nextSlot}` : "";
      }
      renderImagineSourceCards();
    } else {
      if (library_state.selectedJobId === String(job.id || "")) {
        const nextSlot = visibleGenerationJobSlots(job)[0] || 0;
        library_state.selectedDetailItemId = nextSlot ? `job-${job.id}-${nextSlot}` : "";
      }
      renderSourceCards("build");
      renderBuildT2iViewCards();
    }
    renderDetailViews();
    if (typeof restoreLibraryCardListScroll === "function") {
      restoreLibraryCardListScroll(scrollState);
    }
  }


  function cancelGenerationJobFromUi(job) {
    if (generationJobProvider(job) === "imagine" && typeof cancelImagineJobFromUi === "function") {
      cancelImagineJobFromUi(job.id);
      return;
    }
    cancelBuildJobFromUi(job.id);
  }


  function dismissGenerationJobFromUi(job) {
    if (generationJobProvider(job) === "imagine" && typeof dismissImagineJobFromUi === "function") {
      dismissImagineJobFromUi(job.id);
      return;
    }
    dismissBuildJobFromUi(job.id);
  }


  function selectedBuildJob() {
    const id = String(library_state.selectedJobId || "");
    if (!id) return null;
    return (library_state.jobs || []).find((job) => String(job.id || "") === id) || null;
  }


  function updateBuildJobProgressDom(job) {
    if (!job?.id) return;
    const jobIdSelector = cssEscapeValue(job.id);
    const status = buildJobStatus(job);
    const moderated = status === "moderated" || isModerationError(job?.error);
    const failed = status === "failed" || moderated;
    const creditLimit = failed && isCreditLimitError(job?.error);
    const label = buildJobLabel(job);
    const progress = String(Math.max(1, buildJobProgress(job)));

    for (const card of document.querySelectorAll(`.gallery_job_card[data-build-job-id="${jobIdSelector}"]`)) {
      const slotIndex = Number.parseInt(String(card.dataset.buildJobSlot || ""), 10) || 0;
      card.classList.toggle("failed", failed);
      card.classList.toggle("moderated", moderated);
      card.classList.toggle("is_generating", !failed);
      const overlay = card.querySelector(".gallery_generation_overlay");
      overlay?.classList.toggle("failed", failed);
      overlay?.classList.toggle("credit_limit", creditLimit);
      const progressEl = card.querySelector(".gallery_generation_progress");
      if (progressEl) progressEl.textContent = buildJobSlotLabel(job, slotIndex);
    }

    for (const progressEl of document.querySelectorAll(`.detail_generation_progress[data-build-job-id="${jobIdSelector}"]`)) {
      const slotIndex = Number.parseInt(String(progressEl.dataset.jobSlotIndex || ""), 10) || 0;
      progressEl.innerHTML = buildJobPreparing(job) ? "Preparing" : `Creating <span class="detail_generation_percent">${Math.max(1, buildJobSlotProgress(job, slotIndex))}%</span>`;
    }

    for (const progressEl of document.querySelectorAll(`.detail_job_thumb[data-build-job-id="${jobIdSelector}"] .detail_job_thumb_progress`)) {
      const slotIndex = Number.parseInt(String(progressEl.closest(".detail_job_thumb")?.dataset.jobSlotIndex || ""), 10) || 0;
      progressEl.textContent = String(Math.max(1, buildJobSlotProgress(job, slotIndex)));
    }

    for (const badge of document.querySelectorAll(`.detail_job_badge[data-build-job-id="${jobIdSelector}"]`)) {
      const slotIndex = Number.parseInt(String(badge.dataset.jobSlotIndex || ""), 10) || 0;
      badge.classList.toggle("failed", failed);
      badge.classList.toggle("running", !failed);
      badge.classList.remove("credit_limit");
      const badgeLabel = badge.querySelector(".detail_job_badge_label") || badge.querySelector("span");
      if (badgeLabel) badgeLabel.textContent = failed ? "×" : buildJobSlotProgressText(job, slotIndex);
      if (failed) badge.removeAttribute("aria-disabled");
      else badge.setAttribute("aria-disabled", "true");
    }
  }

  function updateGenerationJobCardProgressDom(job, jobIdSelector) {
    const status = buildJobStatus(job);
    const moderated = status === "moderated" || isModerationError(job?.error);
    const failed = status === "failed" || moderated;
    const creditLimit = failed && isCreditLimitError(job?.error);
    const label = buildJobLabel(job);

    for (const card of document.querySelectorAll(`.gallery_job_card[${generationJobDataAttr(job)}="${jobIdSelector}"]`)) {
      const slotIndex = Number.parseInt(String(card.dataset.buildJobSlot || ""), 10) || 0;
      card.classList.toggle("failed", failed);
      card.classList.toggle("moderated", moderated);
      card.classList.toggle("is_generating", !failed);
      const overlay = card.querySelector(".gallery_generation_overlay");
      overlay?.classList.toggle("failed", failed);
      overlay?.classList.toggle("credit_limit", creditLimit);
      const progressEl = card.querySelector(".gallery_generation_progress");
      if (progressEl) progressEl.textContent = buildJobSlotLabel(job, slotIndex);
    }
  }


  function upsertBuildJob(job, options = {}) {
    if (!job?.id) return;
    const index = library_state.jobs.findIndex((candidate) => String(candidate.id) === String(job.id));
    if (index >= 0) library_state.jobs.splice(index, 1, { ...library_state.jobs[index], ...job });
    else {
      library_state.jobs.unshift(job);
      if (typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job)) {
        noteMainGenerationActivity("build", "job", job.id);
      }
    }
    if (options.progressOnly && !buildJobTerminal(job)) {
      updateBuildJobProgressDom(job);
      return;
    }
    renderSourceCards("build");
    renderBuildT2iViewCards();
    const detailPost = selectedLibraryPost();
    if (selectedBuildJob()?.id === job.id || library_state.selectedJobId === job.id || generationJobMatchesPost(job, detailPost)) renderDetailViews();
  }


  function removeBuildJob(jobId, options = {}) {
    const id = String(jobId || "");
    const wasSelected = library_state.selectedJobId === id;
    const detailPost = selectedLibraryPost();
    forgetMainGenerationActivity("build", "job", id);
    library_state.jobs = (library_state.jobs || []).filter((job) => String(job.id || "") !== id);
    if (wasSelected) {
      library_state.selectedJobId = "";
      if (screen_state.current_screen === "b_detail" && detailPost?.items?.length) {
        const selectedStillValid = detailPost.items.some((item) => mediaItemKey(item) === library_state.selectedDetailItemId);
        if (!selectedStillValid) {
          library_state.selectedDetailItemId = mediaItemKey(detailDefaultSelectedItem(detailPost));
        }
      } else if (screen_state.current_screen === "b_detail" && !options.skipRender) {
        openScreen("b_main", "b_build_btn");
      }
    }
    if (!options.skipRender) {
      renderSourceCards("build");
      renderBuildT2iViewCards();
      renderDetailViews();
    }
  }


  function selectBuildJob(jobId, options = {}) {
    const job = (library_state.jobs || []).find((candidate) => String(candidate.id || "") === String(jobId || ""));
    if (!job) return;
    library_state.selectedJobId = String(job.id);
    if (!options.keepDetailPost) library_state.selectedPostPath = "";
    const focusedSlot = options.slotIndex
      || (options.focusJobThumb ? (visibleGenerationJobSlots(job)[0] || 1) : 0);
    if (focusedSlot) library_state.selectedDetailItemId = `job-${job.id}-${focusedSlot}`;
    else if (!options.keepDetailPost) library_state.selectedDetailItemId = "";
    screen_state.detail_back.build = { screenId: "b_main", activeButtonId: "b_build_btn" };
    renderDetailViews();
    openScreen("b_detail", "b_build_btn");
  }


  function buildJobDetailPost(job, basePost = null, jobs = null) {
    if (!job) return null;
    const type = buildJobTargetType(job);
    const context = job.context || {};
    const status = buildJobStatus(job);
    const title = status === "moderated" || isModerationError(job?.error) ? "Moderated" : status === "failed" ? "Failed" : "Creating";
    const preview = generationJobPreviewInfo(job, basePost);
    const selectedSlotId = String(library_state.selectedDetailItemId || "");
    const escapedJobId = String(job.id || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selectedSlotMatch = selectedSlotId.match(new RegExp(`^job-${escapedJobId}-(\\d+)$`));
    const selectedSlotIndex = selectedSlotMatch ? Number.parseInt(selectedSlotMatch[1], 10) : 0;
    const item = {
      item_id: selectedSlotIndex ? `job-${job.id}-${selectedSlotIndex}` : `job-${job.id}`,
      type,
      object_url: preview.url || "",
      preview_url: preview.url || "",
      title,
      prompt: job.prompt || "",
      role: "result",
      aspect_ratio: context.aspect_ratio || "",
      model: context.model || "",
    };
    return {
      post_id: `job-${job.id}`,
      source: "build",
      mode: context.mode || type,
      title,
      prompt: job.prompt || "",
      folder_path: `__build_job__/${job.id}`,
      representative_item: item,
      items: [item],
      is_job_post: true,
      base_post: basePost?.items?.length ? basePost : null,
      job,
      selected_job_slot_index: Number.isFinite(selectedSlotIndex) ? selectedSlotIndex : 0,
      jobs: (Array.isArray(jobs) && jobs.length ? jobs : [job]).filter(generationJobHasVisibleSlots),
    };
  }


  function buildJobPreviewHtml(job, className, basePost = null, selectedBaseItem = null, options = {}) {
    const preview = generationJobPreviewInfo(job, basePost, selectedBaseItem);
    const url = String(preview.url || "");
    const type = String(preview.type || buildJobTargetType(job)).toLowerCase();
    if (!url) return `<div class="${className} detail_generation_fallback"></div>`;
    if (type === "video") {
      const muted = options.muted === false ? "" : " muted";
      return `<video class="${className}" src="${url.replace(/"/g, "&quot;")}"${muted} playsinline autoplay loop preload="metadata"></video>`;
    }
    return `<img class="${className}" src="${url.replace(/"/g, "&quot;")}" alt="" />`;
  }


  function generationJobSourceItem(job, basePost, selectedBaseItem) {
    if (selectedBaseItem) return selectedBaseItem;
    const items = Array.isArray(basePost?.items) ? basePost.items : [];
    const context = job?.context || {};
    const sourceKey = String(
      context.source_item_id
      || context.detail_item_id
      || context.parent_item_id
      || context.original_item_id
      || ""
    ).trim();
    if (sourceKey && items.length) {
      const sourceItem = items.find((item) => {
        const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
        const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
        const keys = [
          mediaItemKey(item),
          item?.item_id,
          item?.id,
          item?.post_id,
          item?.detail_item_id,
          item?.asset_id,
          item?.file,
          item?.name,
          item?.url,
          item?.object_url,
          item?.remote_url,
          item?.media_url,
          item?.mediaUrl,
          item?.source_url,
          item?.raw_url,
          metadata.item_id,
          metadata.post_id,
          metadata.asset_id,
          metadata.imagine_post_id,
          metadata.media_url,
          metadata.remote_url,
          metadata.imagine_media_url,
          imagine.item_id,
          imagine.post_id,
          imagine.asset_id,
          imagine.media_url,
        ].map((value) => String(value || "")).filter(Boolean);
        return keys.includes(sourceKey);
      });
      if (sourceItem) return sourceItem;
    }
    const previewKey = String(context.preview_url || "").trim();
    if (previewKey && items.length && typeof detailMediaUrlForItem === "function") {
      const prefix = generationJobPreviewPrefix(job, basePost);
      const sourceItem = items.find((item) => {
        const keys = [
          detailMediaUrlForItem(prefix, item, basePost),
          detailPreviewUrlForItem(prefix, item, basePost),
          detailVideoPreviewUrlForItem(prefix, item, basePost),
          item?.thumbnail_url,
          item?.poster_url,
          item?.url,
          item?.object_url,
          item?.remote_url,
        ].map((value) => String(value || "").trim()).filter(Boolean);
        return keys.includes(previewKey);
      });
      if (sourceItem) return sourceItem;
    }
    if (!previewKey) return null;
    const mode = String(context.mode || "").toLowerCase();
    const previewType = String(context.preview_type || "").toLowerCase();
    const sourceType = previewType === "video" || previewType.startsWith("video/")
      ? "video"
      : (previewType === "image" || previewType.startsWith("image/")
        ? "image"
        : (mode === "extend" || mode === "video_edit" ? "video" : "image"));
    return {
      item_id: sourceKey || `job-source-${job?.id || "preview"}`,
      post_id: sourceKey || "",
      type: sourceType,
      mime_type: sourceType === "video" ? "video/mp4" : "image/jpeg",
      role: "source",
      object_url: previewKey,
      url: previewKey,
      preview_url: previewKey,
      thumbnail_url: sourceType === "image" ? previewKey : "",
      aspect_ratio: context.aspect_ratio || "",
      conversation_id: context.source_conversation_id || "",
      response_id: context.parent_response_id || "",
      account_id: context.account_id || "",
    };
  }


  function generationJobDisplayAspect(job, post, basePost, selectedBaseItem, type) {
    const contextAspect = detailAspectFromValue(job?.context?.aspect_ratio);
    if (contextAspect) return contextAspect;
    const sourceItem = generationJobSourceItem(job, basePost, selectedBaseItem);
    const sourceAspect = sourceItem ? detailAspectFromItem(sourceItem) : "";
    const representativeAspect = post?.representative_item ? detailAspectFromItem(post.representative_item) : "";
    const firstItemAspect = post?.items?.[0] ? detailAspectFromItem(post.items[0]) : "";
    return sourceAspect || representativeAspect || firstItemAspect || (type === "video" ? "16 / 9" : "2 / 3");
  }


  async function cancelBuildJobFromUi(jobId) {
    const id = String(jobId || "");
    if (!id) return;
    try {
      const data = await qApi("/api/build/cancel", { id });
      if (data?.job) {
        upsertBuildJob(data.job);
        if (buildJobTerminal(data.job) && typeof finishBuildJob === "function") finishBuildJob(data.job);
      }
      else removeBuildJob(id);
    } catch (error) {
      showErrorPanel("Job failed", error?.message || "Cancel failed.");
    }
  }


  async function dismissBuildJobFromUi(jobId) {
    const id = String(jobId || "");
    if (!id) return;
    const scrollState = typeof captureLibraryCardListScroll === "function"
      ? captureLibraryCardListScroll()
      : null;
    try {
      await qApi("/api/build/dismiss", { id });
    } catch (error) {
      console.warn(error);
    }
    removeBuildJob(id);
    if (typeof restoreLibraryCardListScroll === "function") {
      restoreLibraryCardListScroll(scrollState);
    }
  }


  function renderBuildJobDetailView(prefix, post) {
    const job = post?.job;
    const jobs = (Array.isArray(post?.jobs) && post.jobs.length ? post.jobs : [job]).filter(Boolean);
    const basePost = post?.base_post?.items?.length ? post.base_post : null;
    const selectedBaseItem = basePost?.items?.find((item) => mediaItemKey(item) === library_state.selectedDetailItemId) || null;
    const thumbList = document.querySelector(`.${prefix}_detail_thumb_list`);
    const media = document.querySelector(`.${prefix}_detail_media`);
    const mediaWrap = document.querySelector(`.${prefix}_detail_media_wrap`);
    const meta = document.querySelector(`.${prefix}_detail_meta span`);
    const providerBadge = document.querySelector(`.${prefix}_detail_provider_badge`);
    const modelName = document.querySelector(`.${prefix}_detail_model_name`);
    if (!job || !jobs.length || !thumbList || !media) return;
    mediaWrap?.querySelector(".detail_job_badges")?.remove();

    const type = buildJobTargetType(job);
    const status = buildJobStatus(job);
    const moderated = status === "moderated" || isModerationError(job.error);
    const failed = status === "failed" || moderated;
    const detailJobPreview = generationJobPreviewInfo(job, basePost, selectedBaseItem);
    const moderatedWithoutPreview = moderated && !detailJobPreview?.url;
    const selectedJobSlotIndex = Number.parseInt(String(post?.selected_job_slot_index || ""), 10) || 0;
    const progress = Math.max(1, buildJobSlotProgress(job, selectedJobSlotIndex));
    const label = buildJobSlotLabel(job, selectedJobSlotIndex);
    const aspect = generationJobDisplayAspect(job, post, basePost, selectedBaseItem, type);
    const dataAttr = generationJobDataAttrHtml(job);
    const actionPost = { ...(basePost || post || {}), is_job_post: true };
    if (prefix === "i") {
      syncImagineDetailHeartState(basePost || post, selectedBaseItem);
      syncImagineDetailToolButtons(type, selectedBaseItem, actionPost);
    }
    if (prefix === "b") {
      syncBuildDetailHeartState(actionPost);
    }
    const limitToSelectedJobSlot = selectedJobSlotIndex > 0 && typeof isTextToImageBuildJob === "function" && isTextToImageBuildJob(job);
    const detailJobs = limitToSelectedJobSlot
      ? jobs.filter((candidate) => String(candidate.id || "") === String(job.id || ""))
      : jobs;
    const visibleSlotsForDetailJob = (candidate) => {
      if (
        limitToSelectedJobSlot
        && String(candidate.id || "") === String(job.id || "")
        && !generationJobSlotDismissed(candidate, selectedJobSlotIndex)
      ) {
        return [selectedJobSlotIndex];
      }
      return visibleGenerationJobSlots(candidate);
    };

    const jobThumbs = detailJobs.flatMap((candidate) => visibleSlotsForDetailJob(candidate).map((slotIndex) => {
      const candidateStatus = buildJobStatus(candidate);
      const candidateModerated = candidateStatus === "moderated" || isModerationError(candidate?.error);
      const candidateFailed = candidateStatus === "failed" || candidateModerated;
      const candidateProgress = Math.max(1, buildJobSlotProgress(candidate, slotIndex));
      const itemId = `${generationJobProvider(candidate) === "imagine" ? "imagine-job" : "job"}-${candidate.id}-${slotIndex}`;
      const thumb = document.createElement("button");
      thumb.className = `${prefix}_detail_thumb detail_job_thumb ${candidateModerated ? "moderated" : (candidateFailed ? "failed" : "running")}${!selectedBaseItem && String(candidate.id || "") === String(job.id || "") && (!library_state.selectedDetailItemId || library_state.selectedDetailItemId === itemId) ? " active" : ""}`;
      thumb.type = "button";
      thumb.dataset[generationJobDatasetKey(candidate)] = candidate.id;
      thumb.dataset.jobSlotIndex = String(slotIndex);
      thumb.dataset.libraryItemId = itemId;
      const thumbMedia = candidateModerated
        ? `<div class="detail_job_thumb_media moderated_detail_thumb_media"></div>`
        : buildJobPreviewHtml(candidate, "detail_job_thumb_media", basePost);
      thumb.innerHTML = `${thumbMedia}
        <span class="${candidateFailed ? "detail_job_thumb_icon" : "detail_job_thumb_progress"}">${candidateFailed ? hiddenMediaIconSvg() : buildJobSlotProgressText(candidate, slotIndex)}</span>`;
      return thumb;
    }));
    const baseThumbs = basePost
      ? detailOrderedItems(basePost).map((item) => detailThumbButtonForItem(prefix, item, basePost, { active: mediaItemKey(item) === library_state.selectedDetailItemId }))
      : [];
    thumbList.classList.remove("source_pick_active", "split_pick_active");
    for (const oldThumb of Array.from(thumbList.children)) {
      if (typeof disposeCardPreviewNode === "function") disposeCardPreviewNode(oldThumb);
    }
    thumbList.replaceChildren(...baseThumbs, ...jobThumbs);
    requestAnimationFrame(() => {
      if (typeof syncDetailThumbListOverflow === "function") syncDetailThumbListOverflow(thumbList);
      (selectedBaseItem ? thumbList.querySelector(".active") : jobThumbs.find((thumb) => thumb.classList.contains("active")) || jobThumbs[0])?.scrollIntoView({ block: "end", inline: "nearest" });
    });

    const renderJobBadges = () => {
      if (!mediaWrap) return;
      const badges = document.createElement("div");
      badges.className = "detail_job_badges";
      badges.setAttribute("aria-label", "Jobs");
      for (const candidate of detailJobs) {
        const candidateStatus = buildJobStatus(candidate);
        const candidateFailed = candidateStatus === "failed" || candidateStatus === "moderated";
        for (const slotIndex of visibleSlotsForDetailJob(candidate)) {
          const badge = document.createElement("button");
          badge.className = `detail_job_badge ${candidateFailed ? "failed" : "running"}`;
          badge.type = "button";
          badge.dataset[generationJobDatasetKey(candidate)] = candidate.id;
          badge.dataset.jobSlotIndex = String(slotIndex);
          if (!candidateFailed) badge.setAttribute("aria-disabled", "true");
          const badgeLabel = document.createElement("span");
          badgeLabel.className = "detail_job_badge_label";
          badgeLabel.textContent = candidateFailed ? "×" : buildJobSlotProgressText(candidate, slotIndex);
          badge.append(badgeLabel);
          if (candidateFailed) {
            badge.addEventListener("click", () => {
              dismissGenerationJobSlotFromUi(candidate, slotIndex);
            });
          }
          badges.append(badge);
        }
      }
      mediaWrap.append(badges);
    };

    if (selectedBaseItem) {
      const baseType = detailItemType(selectedBaseItem);
      const renderItem = detailRenderableItem(prefix, selectedBaseItem, basePost);
      const detailMediaUrl = detailMediaUrlForItem(prefix, selectedBaseItem, basePost);
      const baseModerated = typeof mediaItemIsModerated === "function" && mediaItemIsModerated(selectedBaseItem);
      const hasDetailMedia = !baseModerated && Boolean(detailMediaUrl);
      media.className = `${prefix}_detail_media ${prefix}_detail_media_${baseType}${baseModerated ? " has_moderated_preview" : (hasDetailMedia ? " has_detail_media" : " has_detail_placeholder")}`;
      media.replaceChildren();
      setDetailMediaAspect(prefix, detailAspectFromItem(selectedBaseItem));
      if (baseModerated) {
        media.append(hiddenMediaPreviewElement());
      } else if (hasDetailMedia) {
        if (baseType === "video") {
          const player = createDetailVideoPlayer(prefix, renderItem);
          media.append(player);
          playDetailVideoIfCurrent(prefix, player.querySelector("video"));
        } else {
          const image = document.createElement("img");
          image.className = "detail_image detail-image detail_media_object";
          image.alt = "";
          image.draggable = false;
          image.addEventListener("load", () => syncDetailMediaAspect(prefix, image, selectedBaseItem), { once: true });
          image.src = detailMediaUrl;
          media.append(image);
          bindDetailMediaZoom(media, image);
          bindDetailImageFullscreen(media);
          if (image.complete) syncDetailMediaAspect(prefix, image, selectedBaseItem);
        }
      } else {
        const icon = document.createElement("img");
        icon.className = "detail_placeholder_icon";
        icon.src = `./assets/icons/${baseType === "video" ? "video" : "image"}.svg`;
        icon.alt = "";
        media.append(icon);
      }
      if (meta) meta.textContent = detailPromptFor(basePost, selectedBaseItem) || "Prompt";
      if (providerBadge) {
        providerBadge.classList.toggle(`${prefix}_detail_provider_video`, baseType === "video");
        providerBadge.classList.toggle(`${prefix}_detail_provider_image`, baseType !== "video");
        providerBadge.innerHTML = `<img src="./assets/icons/${baseType === "video" ? "video" : "image"}.svg" alt="" />`;
      }
      if (modelName) modelName.textContent = detailVisibleModelLabel(prefix, baseType, selectedBaseItem, basePost);
      renderJobBadges();
      return;
    }

    setDetailMediaAspect(prefix, aspect);

    media.className = `${prefix}_detail_media ${prefix}_detail_media_${type} has_detail_media has_generation ${failed ? "generation_failed" : "generation_running"}`;
    const content = failed
      ? `<div class="detail_generation_failed_icon">${hiddenMediaIconSvg()}</div>
         <div class="detail_generation_failed_label">${moderated ? "Moderated" : label}</div>`
      : `<div class="detail_generation_status">
          <span class="detail_generation_progress" ${dataAttr} data-job-slot-index="${selectedJobSlotIndex || 0}">${buildJobPreparing(job) ? "Preparing" : `Creating <span class="detail_generation_percent">${progress}%</span>`}</span>
          <span class="detail_generation_divider">|</span>
          <button class="detail_generation_cancel" type="button" ${dataAttr}>Cancel</button>
        </div>`;
    media.innerHTML = `
      <div class="detail_generation_frame ${failed ? "failed" : "running"}${moderated ? " moderated" : ""}${moderatedWithoutPreview ? " no_preview" : ""}" ${dataAttr}>
        ${buildJobPreviewHtml(job, "detail_generation_media", basePost)}
        ${failed ? "" : dotCssOverlayHtml("detail_generation_particles")}
        ${content}
      </div>
    `;
    renderJobBadges();
    media.querySelector(".detail_generation_cancel")?.addEventListener("click", () => {
      cancelGenerationJobFromUi(job);
    });
    if (meta) meta.textContent = post.prompt || "Prompt";
    if (providerBadge) {
      providerBadge.classList.toggle(`${prefix}_detail_provider_video`, type === "video");
      providerBadge.classList.toggle(`${prefix}_detail_provider_image`, type !== "video");
      providerBadge.innerHTML = `<img src="./assets/icons/${type === "video" ? "video" : "image"}.svg" alt="" />`;
    }
    if (modelName) {
      modelName.textContent = detailVisibleJobModelLabel(prefix, type, job, post.representative_item, post);
    }
  }


  function isBuildT2iPost(post) {
    return post?.source === "build" && String(post?.mode || "").toLowerCase() === "t2i";
  }


  function isSessionBuildT2iPost(post) {
    return isBuildT2iPost(post) && library_state.sessionBuildT2iPaths?.has(post.folder_path || "");
  }


  function markSessionBuildT2iPaths(result) {
    const paths = Array.isArray(result?.selected_paths)
      ? result.selected_paths
      : [result?.selected_path].filter(Boolean);
    const orderedPaths = [...new Set(
      paths.map((path) => String(path || "").trim()).filter(Boolean),
    )];
    if (!orderedPaths.length) return;
    const existingPaths = Array.from(library_state.sessionBuildT2iPaths || []);
    const existingSet = new Set(existingPaths.map((path) => String(path || "")));
    const promoted = new Set(orderedPaths);
    library_state.sessionBuildT2iPaths = new Set([
      ...orderedPaths,
      ...existingPaths.filter((path) => !promoted.has(String(path || ""))),
    ]);
    orderedPaths.forEach((path) => {
      if (!existingSet.has(path)) noteMainGenerationActivity("build", "post", path);
    });
  }


  function postBuildFavorite(post) {
    return Boolean(post?.build_favorite || post?.favorite || post?.liked);
  }


  function buildMainPostVisible(post) {
    if (!isBuildPost(post)) return false;
    if (post.area === "collection") {
      return Boolean(library_state.buildIncludeCollections && post?.items?.length);
    }
    return true;
  }


  function heartIconHtml() {
    return `<span class="imagine-save-heart-icon" aria-hidden="true"><svg class="imagine-save-heart-svg" viewBox="0 0 24 24" focusable="false"><path class="imagine-save-heart-path" d="M12 20.2c-.28 0-.55-.1-.76-.29C6.15 15.32 3 12.48 3 8.62 3 5.78 5.12 3.7 7.9 3.7c1.62 0 3.16.75 4.1 1.94.94-1.19 2.48-1.94 4.1-1.94 2.78 0 4.9 2.08 4.9 4.92 0 3.86-3.15 6.7-8.24 11.29-.21.19-.48.29-.76.29Z"/></svg></span>`;
  }


  async function toggleBuildFavorite(post, button) {
    if (!post?.folder_path || !library_state.apiReady) return;
    const nextFavorite = !postBuildFavorite(post);
    button?.classList.toggle("saved", nextFavorite);
    button?.setAttribute("aria-pressed", String(nextFavorite));
    button?.setAttribute("aria-busy", "true");
    try {
      const data = await qApi("/api/build/favorite", {
        path: post.folder_path,
        favorite: nextFavorite,
      });
      applyLibrarySnapshot(data);
      if (library_state.bMainView === "t2i") renderSourceCards("build");
    } catch (error) {
      button?.classList.toggle("saved", !nextFavorite);
      button?.setAttribute("aria-pressed", String(!nextFavorite));
      showErrorPanel("Favorite failed", error?.message || "Favorite failed.");
    } finally {
      button?.removeAttribute("aria-busy");
    }
  }


  function buildFavoriteButton(post) {
    const saved = postBuildFavorite(post);
    const button = document.createElement("button");
    button.className = `build_favorite_btn text2image-save-button media-card-select-button imagine-save-heart${saved ? " saved" : ""}`;
    button.type = "button";
    button.dataset.libraryPostPath = post.folder_path || "";
    button.setAttribute("aria-label", "Favorite");
    button.setAttribute("aria-pressed", saved ? "true" : "false");
    button.innerHTML = heartIconHtml();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleBuildFavorite(post, button);
    });
    return button;
  }


  function buildJobOverlayElement(job, slotIndex = 0, hasSourcePreview = false) {
    const overlay = document.createElement("span");
    const status = buildJobStatus(job);
    const failed = status === "failed" || status === "moderated" || isModerationError(job?.error);
    overlay.className = `gallery_generation_overlay${failed ? " failed" : ""}${hasSourcePreview ? " has_source_preview" : ""}${isCreditLimitError(job?.error) ? " credit_limit" : ""}`;
    overlay.dataset[generationJobDatasetKey(job)] = job.id || "";
    if (!failed) {
      const shell = document.createElement("span");
      shell.className = "dot_css_overlay gallery_dot_css";
      shell.innerHTML = `
        <span class="dot_css_orb dot_css_orb_one"></span>
        <span class="dot_css_orb dot_css_orb_two"></span>
        <span class="dot_css_shimmer dot_css_shimmer_edge_left"></span>
        <span class="dot_css_shimmer dot_css_shimmer_far_left"></span>
        <span class="dot_css_shimmer dot_css_shimmer_outer_left"></span>
        <span class="dot_css_shimmer dot_css_shimmer_one"></span>
        <span class="dot_css_shimmer dot_css_shimmer_two"></span>
        <span class="dot_css_shimmer dot_css_shimmer_three"></span>
        <span class="dot_css_shimmer dot_css_shimmer_outer_right"></span>
        <span class="dot_css_shimmer dot_css_shimmer_far_right"></span>
        <span class="dot_css_shimmer dot_css_shimmer_edge_right"></span>
      `;
      overlay.append(shell);
    }
    const progress = document.createElement("span");
    progress.className = "gallery_generation_progress";
    progress.textContent = buildJobSlotLabel(job, slotIndex);
    overlay.append(progress);
    return overlay;
  }

  function buildJobActionButton(job, slotIndex = 0) {
    const status = buildJobStatus(job);
    const failed = status === "failed" || status === "moderated" || isModerationError(job?.error);
    const jobAction = document.createElement("button");
    jobAction.className = `gallery_failed_dismiss_btn${failed ? "" : " gallery_job_cancel_btn"}`;
    jobAction.type = "button";
    jobAction.setAttribute("aria-label", failed ? "Remove failed job" : "Cancel generation");
    jobAction.innerHTML = `<span class="delete_x_icon" aria-hidden="true"></span>`;
    jobAction.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (failed) dismissGenerationJobSlotFromUi(job, slotIndex);
      else cancelGenerationJobFromUi(job);
    });
    return jobAction;
  }


  function mediaCardForBuildJob(job, slotIndex = 0, basePost = null, backTargetOverride = null, classNameOverride = "") {
    if (slotIndex && generationJobSlotDismissed(job, slotIndex)) return null;
    const type = buildJobTargetType(job);
    const status = buildJobStatus(job);
    const moderated = status === "moderated" || isModerationError(job?.error);
    const failed = status === "failed" || moderated;
    const provider = generationJobProvider(job);
    const providerClass = provider === "imagine" ? "i_card" : "b_card";
    const extraClass = classNameOverride && classNameOverride !== providerClass ? ` ${classNameOverride}` : "";
    const previewInfo = generationJobPreviewInfo(job, basePost);
    const article = document.createElement("article");
    article.className = `card ${providerClass}${extraClass} gallery_job_card${failed ? " failed" : " is_generating"}${moderated ? " moderated" : ""}`;
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.dataset[generationJobDatasetKey(job)] = job.id;
    if (basePost?.folder_path) article.dataset.libraryPostPath = basePost.folder_path;
    if (slotIndex) article.dataset.buildJobSlot = String(slotIndex);
    article.dataset.itemType = type;
    if (typeof applyStableCardRenderData === "function") {
      applyStableCardRenderData(
        article,
        `${provider}:job:${job.id || ""}:${slotIndex || 0}:${basePost?.folder_path || ""}`,
        [
          provider,
          classNameOverride,
          job.id || "",
          slotIndex || 0,
          basePost?.folder_path || "",
          type,
          status,
          previewInfo.url || "",
          previewInfo.type || "",
          failed ? "failed" : "running",
        ].map((value) => String(value || "")).join("\u001f"),
      );
    }

    const media = document.createElement("div");
    media.className = `card_media card_${type}`;
    const preview = previewInfo.url || "";
    if (moderated) {
      media.classList.add("has_moderated_preview");
      media.append(hiddenMediaPreviewElement("Moderated"));
    } else if (preview) {
      media.classList.add("has_preview");
      if (previewInfo.type === "video") {
        const video = document.createElement("video");
        video.className = "card_video_preview";
        video.src = preview;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.loop = true;
        if (typeof bindCardPreviewLoadState === "function") bindCardPreviewLoadState(media, video, preview);
        media.append(video);
        bindHoverVideoPreview(article, video);
      } else {
        const img = document.createElement("img");
        img.className = "card_preview";
        img.src = preview;
        img.alt = "";
        if (typeof bindCardPreviewLoadState === "function") bindCardPreviewLoadState(media, img, preview);
        media.append(img);
      }
    } else if (failed) {
      media.classList.add("has_moderated_preview");
      const hiddenPreview = hiddenMediaPreviewElement(buildJobLabel(job));
      hiddenPreview.classList.add("failed_preview");
      const hiddenLabel = hiddenPreview.querySelector(".text2image_moderated_label");
      if (hiddenLabel) hiddenLabel.remove();
      media.append(hiddenPreview);
    }
    if (type === "video") {
      const icon = document.createElement("img");
      icon.className = "card_type_icon";
      icon.src = "./assets/icons/video.svg";
      icon.alt = "";
      media.append(icon);
    }
    // Moderated jobs use the same placeholder as stored moderated media items.
    // Do not shade that placeholder with the failed-job overlay.
    if (!moderated) {
      media.append(buildJobOverlayElement(job, slotIndex, Boolean(preview)));
    }
    article.append(media);

    article.append(buildJobActionButton(job, slotIndex));

    const activate = () => {
      if (basePost?.folder_path) library_state.selectedPostPath = basePost.folder_path;
      if (backTargetOverride && provider === "build") screen_state.detail_back.build = backTargetOverride;
      if (backTargetOverride && provider === "imagine") {
        const storedBackTarget = { ...backTargetOverride };
        if (typeof imagineListScrollTopForScreen === "function") {
          const scrollTop = imagineListScrollTopForScreen(storedBackTarget.screenId);
          if (scrollTop !== null && scrollTop !== undefined) storedBackTarget.scrollTop = scrollTop;
        }
        screen_state.detail_back.imagine = storedBackTarget;
      }
      if (provider === "imagine" && typeof selectImagineJob === "function") {
        selectImagineJob(job.id, { slotIndex, keepDetailPost: Boolean(basePost?.folder_path) });
        return;
      }
      selectBuildJob(job.id, { slotIndex, keepDetailPost: Boolean(basePost?.folder_path) });
    };
    article.addEventListener("click", activate);
    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    return article;
  }


  function buildJobT2iSlotCount(job) {
    if (!isTextToImageBuildJob(job)) return 1;
    const parsed = Number.parseInt(String(job?.context?.count || ""), 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : 1;
  }


  function mediaCardsForBuildJob(job) {
    return visibleGenerationJobSlots(job)
      .map((slotIndex) => mediaCardForBuildJob(job, slotIndex))
      .filter(Boolean);
  }


    function renderBuildT2iViewCards() {
      if (library_state.bMainView === "t2i" && screen_state.current_screen === "b_main") {
        renderSourceCards("build");
        return;
      }
      const list = document.querySelector(".b_t2i_view_card_list");
      if (!list) return;
      const jobs = (library_state.jobs || []).filter((job) => isRenderableBuildJob(job) && isTextToImageBuildJob(job) && generationJobHasVisibleSlots(job));
      const posts = filterPostsBySearch(library_state.posts.filter(isSessionBuildT2iPost));
      if (!jobs.length && !posts.length) {
        list.replaceChildren(emptyLibraryNode("No T2I items."));
      } else {
        replaceCardListChildren(list, [
          ...jobs.flatMap(mediaCardsForBuildJob),
          ...posts.map((post) => mediaCardForPost(post, "b_t2i_card")),
        ]);
      }
      const count = document.querySelector(".b_t2i_view_header p");
      const jobSlots = jobs.reduce((total, job) => total + visibleGenerationJobSlots(job).length, 0);
      if (count) count.textContent = `${posts.length + jobSlots} items`;
      document.getElementById("b_t2i_view_btn")?.classList.toggle("active", library_state.bMainView === "t2i");
    }
