// Composer option controls
function aspectOptions(provider, mode) {
  if (provider === "build" && mode === "image") return buildT2iAspectOptions;
  return mode === "video" ? videoAspectOptions : imageAspectOptions;
}

function resolutionOptions(provider, mode) {
  if (provider === "build" && mode === "image") return buildT2iResolutionOptions;
  if (mode === "image") return imageResolutionOptions;
  if (mode === "video") return videoResolutionOptions;
  return [];
}

function isVideoModel10(value) {
  return /\b1\.0\b/.test(String(value || ""));
}

function isLongVideoDuration(value) {
  return new Set(["15s", "12s"]).has(String(value || "").trim());
}

function isHighVideoResolution(value) {
  return String(value || "").trim().toLowerCase().replace(/p$/, "") === "1080";
}

function composerImageAttachmentCount() {
  return composerAttachments.filter((attachment) => composerMediaKind(attachment) === "image").length;
}

function composerImplicitDetailImageAttachmentCount() {
  if (composerState.provider !== "imagine" || composerState.mode !== "image") return 0;
  if (screen_state.current_screen !== "i_detail") return 0;
  if (composerImageAttachmentCount() > 0) return 0;
  if (typeof selectedLibraryPost !== "function" || typeof detailImageForComposer !== "function") return 0;
  if (typeof detailMediaUrlForComposer !== "function") return 0;
  const post = selectedLibraryPost();
  const item = detailImageForComposer(post);
  const sourceUrl = detailMediaUrlForComposer(item, post);
  if (!post || !item || !sourceUrl) return 0;
  if (typeof detailComposerAttachmentKey === "function") {
    const detailKey = detailComposerAttachmentKey(post, item);
    if (detailKey && composerState.dismissedDetailAttachmentKey === detailKey) return 0;
  }
  return 1;
}

function composerEffectiveImageAttachmentCount() {
  return composerImageAttachmentCount() + composerImplicitDetailImageAttachmentCount();
}

function composerIsBuildDetailImageEdit() {
  if (composerState.provider !== "build" || composerState.mode !== "image") return false;
  if (screen_state.current_screen !== "b_detail") return false;
  if (typeof selectedLibraryPost !== "function" || typeof selectedDetailItem !== "function") return false;
  const post = selectedLibraryPost();
  const item = selectedDetailItem(post);
  if (!post || !item) return false;
  return typeof detailItemType === "function"
    ? detailItemType(item) === "image"
    : String(item.type || "image").toLowerCase() === "image";
}

function videoAttachmentBucket(imageCount) {
  if (imageCount >= 2) return "multi-image";
  if (imageCount === 1) return "single-image";
  return "text";
}

function videoModelOptionsForState(provider, imageCount) {
  if (imageCount >= 2) return ["M 1.0"];
  const availableModels = provider === "build" ? buildVideoModelOptions : videoModelOptions;
  const selectedDuration = selectedComposerControl(composerControls.duration);
  const selectedResolution = selectedComposerControl(composerControls.resolution);
  if (imageCount === 1 && isLongVideoDuration(selectedDuration)) {
    return availableModels.filter((model) => !isVideoModel10(model));
  }
  if (isHighVideoResolution(selectedResolution)) {
    return availableModels.filter((model) => !isVideoModel10(model));
  }
  return availableModels;
}

function videoDurationOptionsForState(provider, imageCount, model) {
  const options = provider === "imagine" ? imagineVideoDurationOptions : videoDurationOptions;
  if (imageCount >= 2 || (imageCount === 1 && isVideoModel10(model))) {
    return options.filter((option) => !isLongVideoDuration(option));
  }
  return options;
}

function activeComposerAccountTier(provider) {
  const store = account_state?.[provider];
  const activeId = String(store?.active_id || "");
  const account = activeId
    ? store?.accounts?.find((item) => String(item?.id || "") === activeId)
    : null;
  return normalizeAccountTier(account?.tier);
}

function videoResolutionOptionsForState(provider, imageCount, model) {
  let options = videoResolutionOptions;
  if (provider === "imagine" && activeComposerAccountTier(provider) !== "heavy") {
    options = options.filter((option) => !isHighVideoResolution(option));
  }
  if (imageCount >= 2 || isVideoModel10(model)) {
    return options.filter((option) => !isHighVideoResolution(option));
  }
  return options;
}

function videoResolutionDefaultForState(imageCount, model) {
  return imageCount >= 2 || isVideoModel10(model) ? "720" : "480";
}

function extensionDurationOptionsForProvider(provider) {
  return provider === "imagine" ? imagineExtensionDurationOptions : extensionDurationOptions;
}

function setControlVisible(control, visible) {
  if (!control) return;
  control.hidden = !visible;
  control.classList.remove("open");
}

function composerControlName(control) {
  return control?.dataset?.composerControl || "";
}

function composerOptionStateKey(control, provider = composerState.provider, mode = composerState.mode) {
  const name = composerControlName(control);
  return name ? `${provider}:${mode}:${name}` : "";
}

function rememberComposerOption(control, value, provider = composerState.provider, mode = composerState.mode) {
  const key = composerOptionStateKey(control, provider, mode);
  if (!key) return;
  composerState.optionValues[key] = String(value || "").trim();
}

function rememberedComposerOption(control, provider = composerState.provider, mode = composerState.mode) {
  const key = composerOptionStateKey(control, provider, mode);
  return key ? String(composerState.optionValues[key] || "").trim() : "";
}

function setCustomSelectOptions(control, options, defaultValue, context) {
  if (!control) return;
  const button = control.querySelector(".custom_select_btn");
  const menu = control.querySelector(".custom_select_menu");
  if (!button || !menu) return;

  const previous = control.dataset.optionContext === context ? button.textContent.trim() : "";
  const remembered = rememberedComposerOption(control);
  const selected = options.includes(remembered)
    ? remembered
    : (options.includes(previous) ? previous : (options.includes(defaultValue) ? defaultValue : options[0] || ""));
  control.dataset.optionContext = context;
  button.textContent = selected;
  rememberComposerOption(control, selected);
  menu.replaceChildren(...options.map((label) => {
    const option = document.createElement("button");
    option.className = `custom_select_option${label === selected ? " active" : ""}`;
    option.type = "button";
    option.textContent = label;
    return option;
  }));
}

function syncComposerVideoOptionControls(provider = composerState.provider, mode = composerState.mode) {
  const imageCount = composerEffectiveImageAttachmentCount();
  const bucket = videoAttachmentBucket(imageCount);
  const modelOptions = videoModelOptionsForState(provider, imageCount);
  const modelDefault = imageCount >= 2 ? "M 1.0" : "M 1.5";
  const longDurationBlocksModel10 = imageCount === 1 && isLongVideoDuration(selectedComposerControl(composerControls.duration));
  const highResolutionBlocksModel10 = isHighVideoResolution(selectedComposerControl(composerControls.resolution));
  setCustomSelectOptions(composerControls.videoModel, modelOptions, modelDefault, `${provider}:${mode}:video-model:${bucket}:${longDurationBlocksModel10}:${highResolutionBlocksModel10}`);
  const selectedModel = selectedComposerControl(composerControls.videoModel);
  setCustomSelectOptions(composerControls.duration, videoDurationOptionsForState(provider, imageCount, selectedModel), "10s", `${provider}:${mode}:duration:${bucket}:${isVideoModel10(selectedModel)}`);
  setCustomSelectOptions(composerControls.aspect, aspectOptions(provider, mode), "Auto", `${provider}:${mode}:aspect`);
  setCustomSelectOptions(composerControls.resolution, videoResolutionOptionsForState(provider, imageCount, selectedModel), videoResolutionDefaultForState(imageCount, selectedModel), `${provider}:${mode}:resolution:${bucket}:${isVideoModel10(selectedModel)}:${activeComposerAccountTier(provider)}`);
}

function renderComposerOptions() {
  const { provider, mode } = composerState;
  for (const control of Object.values(composerControls)) {
    setControlVisible(control, false);
  }

  if (mode === "image") {
    const isBuildDetailImageEdit = composerIsBuildDetailImageEdit();
    const isImageToImage = isBuildDetailImageEdit || composerEffectiveImageAttachmentCount() > 0;
    const hideImagineImageToImageOptions = provider === "imagine" && isImageToImage;
    const showImageModel = provider === "build"
      || isBuildDetailImageEdit
      || (!isImageToImage && !hideImagineImageToImageOptions);
    const imageAspectDefault = "Auto";
    const imageCountOptions = provider === "imagine"
      ? buildT2iCountOptions.filter((option) => option !== "1")
      : buildT2iCountOptions;
    const imageCountDefault = "5";
    setControlVisible(composerControls.aspect, !hideImagineImageToImageOptions);
    setControlVisible(composerControls.imageModel, showImageModel);
    setControlVisible(composerControls.resolution, provider === "build");
    setControlVisible(composerControls.count, !isImageToImage && !hideImagineImageToImageOptions);
    if (!hideImagineImageToImageOptions) {
      setCustomSelectOptions(composerControls.aspect, aspectOptions(provider, mode), imageAspectDefault, `${provider}:${mode}:aspect`);
    }
    if (showImageModel) {
      setCustomSelectOptions(composerControls.imageModel, ["Quality", "Speed"], "Quality", `${provider}:${mode}:image-model`);
    }
    if (provider === "build") {
      setCustomSelectOptions(composerControls.resolution, resolutionOptions(provider, mode), "1K", `${provider}:${mode}:resolution`);
    }
    if (!isImageToImage && !hideImagineImageToImageOptions) {
      setCustomSelectOptions(composerControls.count, imageCountOptions, imageCountDefault, `${provider}:${mode}:count`);
    } else {
      rememberComposerOption(composerControls.count, "1");
    }
    return;
  }

  if (mode === "video") {
    setControlVisible(composerControls.videoModel, provider === "build");
    setControlVisible(composerControls.duration, true);
    setControlVisible(composerControls.aspect, true);
    setControlVisible(composerControls.resolution, true);
    syncComposerVideoOptionControls(provider, mode);
    return;
  }

  if (mode === "video_edit") {
    setControlVisible(composerControls.videoEditNote, true);
    return;
  }

  if (mode === "extend") {
    setControlVisible(composerControls.duration, true);
    if (composerControls.extendMaxNote) {
      composerControls.extendMaxNote.textContent = provider === "imagine" ? "-Max 30s" : "-Max 25s";
    }
    setControlVisible(composerControls.extendMaxNote, true);
    setCustomSelectOptions(composerControls.duration, extensionDurationOptionsForProvider(provider), "6s", `${provider}:${mode}:duration`);
  }
}

function selectedComposerControl(control) {
  return rememberedComposerOption(control) || control?.querySelector(".custom_select_btn")?.textContent.trim() || "";
}

function composerResolutionOption(value) {
  const selected = String(value || "").trim();
  if (composerState.mode === "video" && /^\d+$/.test(selected)) return `${selected}p`;
  return selected;
}

function composerAspectOption(value) {
  const selected = String(value || "").trim();
  if (selected.toLowerCase() !== "auto") return selected;
  return composerState.mode === "image" ? "auto" : "";
}

function composerExtendStartBounds(videoDuration, provider = composerState.provider) {
  const duration = Number(videoDuration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const maximum = provider === "build" ? Math.min(duration, 15) : duration;
  return {
    minimum: Math.min(2, maximum),
    maximum,
  };
}

function clampedComposerExtendStart(startTime, videoDuration, provider = composerState.provider) {
  const bounds = composerExtendStartBounds(videoDuration, provider);
  const requested = Number(startTime);
  if (!bounds || !Number.isFinite(requested)) return requested;
  return Math.max(bounds.minimum, Math.min(bounds.maximum, requested));
}

function clampActiveDetailExtendStart(video = null) {
  if (composerState.mode !== "extend" || !detail_state.extendActive) return false;
  const activeVideo = video || (typeof currentDetailVideoElement === "function" ? currentDetailVideoElement() : null);
  if (!activeVideo) return false;
  const duration = Number(activeVideo.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    activeVideo.addEventListener("loadedmetadata", () => clampActiveDetailExtendStart(activeVideo), { once: true });
    return false;
  }
  const requested = Number(detail_state.extendStart);
  const clamped = clampedComposerExtendStart(requested, duration);
  if (!Number.isFinite(clamped) || Math.abs(clamped - requested) < 0.0005) return true;
  detail_state.extendStart = Number(clamped.toFixed(3));
  activeVideo.dispatchEvent(new Event("timeupdate"));
  return true;
}

function composerRequestOptions() {
  const isBuildDetailImageEdit = composerIsBuildDetailImageEdit();
  const isImageToImage = composerState.mode === "image" && (isBuildDetailImageEdit || composerEffectiveImageAttachmentCount() > 0);
  const isImagineImageToImage = composerState.provider === "imagine" && isImageToImage;
  const options = {
    duration: selectedComposerControl(composerControls.duration),
    aspect_ratio: isImagineImageToImage ? "" : composerAspectOption(selectedComposerControl(composerControls.aspect)),
    image_model: isImagineImageToImage ? "" : selectedComposerControl(composerControls.imageModel),
    resolution: isImagineImageToImage ? "" : composerResolutionOption(selectedComposerControl(composerControls.resolution)),
    count: isImageToImage ? "1" : selectedComposerControl(composerControls.count),
  };
  if (composerState.mode === "video" && composerState.provider === "build") {
    options.video_model = selectedComposerControl(composerControls.videoModel);
  }
  if (composerState.mode === "extend" && detail_state.extendActive) {
    const sourceTrimEnd = Number((detail_state.extendStart || 0).toFixed(3));
    const invalidMinimum = sourceTrimEnd < 2;
    const invalidBuildMaximum = composerState.provider === "build" && sourceTrimEnd > 15;
    if (invalidMinimum || invalidBuildMaximum) {
      throw new Error(composerState.provider === "build"
        ? "Build Extend start position must be between 2 and 15 seconds."
        : "Imagine Extend start position must be at least 2 seconds.");
    }
    options.source_trim_end = sourceTrimEnd;
    options.source_trim_user_adjusted = Boolean(detail_state.extendUserAdjusted);
    options.source_trim_quality = "high";
  }
  return options;
}
