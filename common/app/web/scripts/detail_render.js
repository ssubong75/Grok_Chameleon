// Detail view rendering and model labels
function detailModelCandidateText(value, depth = 0) {
  if (value === null || value === undefined || depth > 3) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = detailModelCandidateText(entry, depth + 1);
      if (text) return text;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const keys = [
    "model_label",
    "modelLabel",
    "display_model",
    "displayModel",
    "model",
    "modelName",
    "model_name",
    "generation_model",
    "generationModel",
    "image_model",
    "imageModel",
    "imageModelName",
    "video_model",
    "videoModel",
    "videoModelName",
    "video_gen_model",
    "videoGenModel",
    "videoGenModelConfig",
    "model_config",
    "modelConfig",
    "options",
    "context",
    "build_request",
    "build_requests",
    "request",
    "request_body",
    "body",
  ];
  for (const key of keys) {
    const text = detailModelCandidateText(value[key], depth + 1);
    if (text) return text;
  }
  return "";
}

function detailModelSourceCandidates(source) {
  if (!source) return [];
  return [
    source.model_label,
    source.modelLabel,
    source.display_model,
    source.displayModel,
    source.model,
    source.modelName,
    source.model_name,
    source.generation_model,
    source.generationModel,
    source.image_model,
    source.imageModel,
    source.video_model,
    source.videoModel,
    source.videoGenModelConfig,
    source.model_config,
    source.modelConfig,
    source.options,
    source.context,
    source.build_request,
    source.build_requests,
    source.request,
    source.request_body,
    source.body,
  ].map((value) => detailModelCandidateText(value));
}

function detailModelMayUsePostFallback(item) {
  if (!item) return true;
  const roleText = [
    item.role,
    item.relation,
    item.source_type,
    item.kind,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return !/(source|original|start|input|parent|reference|ref|upload)/.test(roleText);
}

function detailModelCandidates(item, post) {
  const candidates = detailModelSourceCandidates(item);
  if (detailModelMayUsePostFallback(item)) {
    candidates.push(...detailModelSourceCandidates(post));
  }
  return candidates
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizeDetailModelLabel(type, raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  const isVideoName = value.includes("video") || value.includes("t2v") || value.includes("i2v");
  const isImageName = value.includes("image") || value.includes("quality") || value.includes("speed") || value.includes("imagine-x");
  if (type === "video") {
    if (value.includes("1.5-preview") || value.includes("m 1.5p") || value.includes("m1.5p")) return "M 1.5P";
    if (value.includes("1.5") || value.includes("m 1.5") || value.includes("m1.5")) return "M 1.5";
    if (value.includes("1.0") || value.includes("m 1.0") || value.includes("m1.0")) return "M 1.0";
    if (/^grok-imagine-video(?:$|[^0-9.])/.test(value)) return "M 1.0";
    return "";
  }
  if (value.includes("quality")) return "Quality";
  if (value.includes("speed") || (value.includes("grok-imagine-image") && !value.includes("quality"))) return "Speed";
  if (isImageName && !isVideoName) return "Quality";
  return "";
}

function detailModelLabel(type, item, post) {
  for (const raw of detailModelCandidates(item, post)) {
    const label = normalizeDetailModelLabel(type, raw);
    if (label) return label;
  }
  return "";
}

function detailJobModelLabel(type, job) {
  const context = job?.context || {};
  return normalizeDetailModelLabel(type, context.model_label)
    || normalizeDetailModelLabel(type, context.modelLabel)
    || normalizeDetailModelLabel(type, context.display_model)
    || normalizeDetailModelLabel(type, context.displayModel)
    || normalizeDetailModelLabel(type, context.model)
    || "";
}

function detailVisibleModelLabel(prefix, type, item, post) {
  if (prefix === "i") return "";
  return detailModelLabel(type, item, post);
}

function detailVisibleJobModelLabel(prefix, type, job, item, post) {
  if (prefix === "i") return "";
  return detailJobModelLabel(type, job) || detailModelLabel(type, item, post);
}

function setDetailResolutionLabel(prefix, label) {
  const node = document.querySelector(`.${prefix}_detail_resolution_name`);
  if (!node) return;
  const text = String(label || "").trim();
  node.textContent = text;
  node.hidden = !text;
}

function detailImagineMetadataFrom(source) {
  const metadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return { metadata, imagine };
}

function detailIsImagineLinkSource(post, item) {
  const postMeta = detailImagineMetadataFrom(post);
  const itemMeta = detailImagineMetadataFrom(item);
  return Boolean(
    post?.mode === "link"
    || postMeta.metadata.link_source
    || postMeta.metadata.remote_view === "link"
    || postMeta.imagine.link_source
    || postMeta.imagine.remote_view === "link"
    || itemMeta.metadata.link_source
    || itemMeta.metadata.remote_view === "link"
    || itemMeta.imagine.link_source
    || itemMeta.imagine.remote_view === "link"
  );
}

function detailCanSaveImaginePost(post, item) {
  if (detailIsImagineLinkSource(post, item)) return true;
  return Boolean(
    (typeof isImagineDiscoverPost === "function" && isImagineDiscoverPost(post, item))
    || (typeof isImagineT2iPost === "function" && isImagineT2iPost(post))
  );
}

function syncImagineDetailHeartState(post, item) {
  const button = document.querySelector(".i_detail_heart");
  if (!button) return;
  const saved = typeof imaginePostLiked === "function"
    && (imaginePostLiked(post, item) || imaginePostLiked(post));
  const visible = detailCanSaveImaginePost(post, item) && !saved;
  button.hidden = !visible;
  button.classList.remove("saved");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", "Save");
}

function syncBuildDetailHeartState(post) {
  const button = document.querySelector(".b_detail_heart");
  if (!button) return;
  const visible = !post?.is_job_post
    && typeof isBuildT2iPost === "function"
    && isBuildT2iPost(post);
  button.hidden = !visible;
  if (!visible) return;
  const saved = typeof postBuildFavorite === "function" ? postBuildFavorite(post) : false;
  button.classList.toggle("saved", saved);
  button.setAttribute("aria-pressed", saved ? "true" : "false");
  button.setAttribute("aria-label", saved ? "Unfavorite" : "Favorite");
}

function renderDetailViews() {
  const post = selectedLibraryPost();
  const buildJobs = typeof buildJobsForPost === "function" ? buildJobsForPost(post) : [];
  const imagineJobs = typeof imagineJobsForPost === "function" ? imagineJobsForPost(post) : [];
  const buildJob = typeof selectedBuildJobForPost === "function" ? selectedBuildJobForPost(post) : selectedBuildJob();
  const imagineJob = typeof selectedImagineJobForPost === "function"
    ? selectedImagineJobForPost(post)
    : (typeof selectedImagineJob === "function" ? selectedImagineJob() : null);
  const imaginePost = imagineJob && typeof imagineJobDetailPost === "function" ? imagineJobDetailPost(imagineJob, post, imagineJobs) : post;
  renderDetailView("i", imaginePost);
  renderDetailView("b", buildJob ? buildJobDetailPost(buildJob, post, buildJobs) : post);
  updateDetailPostNavigationButtons();
}

function hiddenMediaIconSvg() {
  return `<svg viewBox="0 0 96 96" aria-hidden="true">
    <path d="M12 49s13-22 36-22c6.5 0 12.3 1.7 17.2 4.2M77.5 39.2C83 44.3 86 49 86 49S73 71 48 71c-6.8 0-12.8-1.6-17.9-4.1" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M40 56.5A12 12 0 0 1 56.4 40M29 17l42 62" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}

function syncDetailThumbListOverflow(thumbList) {
  if (!thumbList) return false;
  const overflowing = thumbList.scrollHeight > thumbList.clientHeight + 1;
  thumbList.classList.toggle("detail_thumb_list_overflowing", overflowing);
  return overflowing;
}

function dotCssOverlayHtml(extraClass = "") {
  const className = extraClass ? ` ${extraClass}` : "";
  return `<span class="dot_css_overlay${className}" aria-hidden="true">
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
  </span>`;
}

function detailThumbButtonForItem(prefix, item, post, options = {}) {
  const key = mediaItemKey(item);
  const type = item.type || mediaTypeForName(item.file || item.url) || "image";
  const sourcePickActive = Boolean(options.sourcePickActive);
  const splitPickActive = Boolean(options.splitPickActive);
  const button = document.createElement("button");
  button.className = `${prefix}_detail_thumb ${prefix}_detail_thumb_${type}${options.active ? " active" : ""}${sourcePickActive && type === "image" ? " source_pick_candidate" : ""}${splitPickActive ? " split_pick_candidate" : ""}`;
  button.type = "button";
  button.dataset.libraryItemId = key;
  button.dataset.libraryItemType = type;
  button.setAttribute("aria-label", `${type === "video" ? "Video" : "Image"} version`);

  const fill = document.createElement("span");
  fill.className = `${prefix}_detail_thumb_fill`;
  const previewUrl = detailPreviewUrlForItem(prefix, { ...item, type }, post);
  const videoUrl = type === "video" ? detailVideoPreviewUrlForItem(prefix, { ...item, type }, post) : "";
  const buildPreviewSource = prefix === "b" ? (previewUrl || videoUrl) : "";
  const appendVideoFallback = () => {
    if (!videoUrl || !fill.isConnected) return;
    fill.classList.remove("detail_thumb_preview");
    fill.style.backgroundImage = "";
    fill.classList.add("detail_thumb_video_preview");
    const video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    fill.replaceChildren(video);
    bindHoverVideoPreview(button, video);
  };
  if (buildPreviewSource && typeof resolveLocalCardPreview === "function") {
    fill.classList.add("detail_thumb_preview");
    resolveLocalCardPreview(buildPreviewSource, "thumbnail").then((resolvedUrl) => {
      if (!fill.isConnected) return;
      if (resolvedUrl && (type !== "video" || resolvedUrl !== buildPreviewSource)) {
        fill.style.backgroundImage = `url("${resolvedUrl}")`;
      } else if (type === "video") {
        appendVideoFallback();
      }
    });
  } else if (previewUrl) {
    fill.classList.add("detail_thumb_preview");
    fill.style.backgroundImage = `url("${previewUrl}")`;
  } else {
    if (videoUrl) {
      requestAnimationFrame(appendVideoFallback);
    }
  }
  button.append(fill);
  if (type === "video") {
    const typeIcon = document.createElement("span");
    typeIcon.className = `${prefix}_detail_thumb_type`;
    typeIcon.innerHTML = `<img src="./assets/icons/video.svg" alt="" />`;
    button.append(typeIcon);
  }
  return button;
}

function syncImagineDetailToolButtons(type, item = null, post = null) {
  const isImage = type === "image";
  const isVideo = type === "video";
  const isDiscover = typeof isImagineDiscoverPost === "function" && isImagineDiscoverPost(post, item);
  const deleteButton = document.querySelector(".i_detail_delete");
  if (deleteButton) deleteButton.hidden = isDiscover;
  document.querySelectorAll(".i_detail_image_tool_btn").forEach((button) => {
    if (button.classList.contains("i_detail_crop_btn")) {
      button.hidden = true;
      button.classList.remove("open");
      return;
    }
    button.hidden = !isImage;
    if (!isImage) button.classList.remove("open");
  });
  document.querySelectorAll(".i_detail_video_tool_btn").forEach((button) => {
    if (button.classList.contains("i_detail_upscale_btn")) {
      const targetResolution = isVideo && typeof imagineUpscaleTargetResolution === "function"
        ? imagineUpscaleTargetResolution(item, post)
        : "";
      button.hidden = !targetResolution;
      button.dataset.targetResolution = targetResolution;
      if (targetResolution) {
        button.setAttribute("aria-label", `Upscale to ${targetResolution}`);
      }
      button.removeAttribute("title");
      return;
    }
    button.hidden = !isVideo;
  });
}

const imagineDetailAspectOptions = ["2:3", "3:2", "1:1", "16:9", "9:16"];

function detailAspectRatioFromLabel(label) {
  const normalized = typeof detailAspectFromValue === "function" ? detailAspectFromValue(label) : "";
  const match = String(normalized || "").match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 0;
}

function imagineDetailCurrentAspectLabel(item) {
  const ratio = detailAspectRatioFromLabel(detailAspectFromItem(item));
  if (!ratio) return "";
  let best = "";
  let bestDiff = Infinity;
  for (const option of imagineDetailAspectOptions) {
    const optionRatio = detailAspectRatioFromLabel(option);
    if (!optionRatio) continue;
    const diff = Math.abs(Math.log(ratio / optionRatio));
    if (diff < bestDiff) {
      best = option;
      bestDiff = diff;
    }
  }
  return bestDiff <= 0.04 ? best : "";
}

function renderImagineDetailAspectMenu(item) {
  const menu = document.querySelector(".i_detail_aspect_menu");
  if (!menu) return;
  const current = imagineDetailCurrentAspectLabel(item);
  menu.replaceChildren(...imagineDetailAspectOptions
    .filter((label) => label !== current)
    .map((label) => {
      const option = document.createElement("button");
      option.className = "custom_select_option";
      option.type = "button";
      option.textContent = label;
      option.setAttribute("role", "menuitem");
      return option;
    }));
}

function renderDetailView(prefix, post) {
  const thumbList = document.querySelector(`.${prefix}_detail_thumb_list`);
  const media = document.querySelector(`.${prefix}_detail_media`);
  const mediaWrap = document.querySelector(`.${prefix}_detail_media_wrap`);
  const meta = document.querySelector(`.${prefix}_detail_meta span`);
  const providerBadge = document.querySelector(`.${prefix}_detail_provider_badge`);
  const modelBadge = document.querySelector(`.${prefix}_detail_model_badge`);
  const modelName = document.querySelector(`.${prefix}_detail_model_name`);
  if (!thumbList || !media) return;
  if (prefix === "i") syncImagineDetailToolButtons("");
  setDetailResolutionLabel(prefix, "");
  mediaWrap?.querySelector(".detail_job_badges")?.remove();
  modelBadge?.querySelector(".detail_lucky_badge")?.remove();
  if (post?.is_job_post) {
    renderBuildJobDetailView(prefix, post);
    return;
  }
  if (!post?.items?.length) return;

  const selectedItem = selectedDetailItem(post);
  if (prefix === "i") syncImagineDetailHeartState(post, selectedItem);
  if (prefix === "b") syncBuildDetailHeartState(post);
  const selectedKey = mediaItemKey(selectedItem);
  const detailItems = detailOrderedItems(post);
  const sourcePickActive = Boolean(library_state.sourcePickPending && screen_state.current_screen === `${prefix}_detail`);
  const splitPickActive = Boolean(library_state.splitPickPending && screen_state.current_screen === `${prefix}_detail`);
  thumbList.classList.toggle("source_pick_active", sourcePickActive);
  thumbList.classList.toggle("split_pick_active", splitPickActive);
  let selectedThumb = null;
  thumbList.replaceChildren(...detailItems.map((item) => {
    const key = mediaItemKey(item);
    const button = detailThumbButtonForItem(prefix, item, post, {
      active: key === selectedKey,
      sourcePickActive,
      splitPickActive,
    });
    if (key === selectedKey) selectedThumb = button;
    return button;
  }));
  if (selectedThumb) {
    requestAnimationFrame(() => {
      syncDetailThumbListOverflow(thumbList);
      thumbList.scrollTop = thumbList.scrollHeight;
    });
  } else {
    requestAnimationFrame(() => {
      syncDetailThumbListOverflow(thumbList);
      thumbList.scrollTop = thumbList.scrollHeight;
    });
  }

  const type = detailItemType(selectedItem);
  if (prefix === "i") syncImagineDetailToolButtons(type, selectedItem, post);
  if (prefix === "i") renderImagineDetailAspectMenu(selectedItem);
  const renderItem = detailRenderableItem(prefix, selectedItem, post);
  const detailMediaUrl = detailMediaUrlForItem(prefix, selectedItem, post);
  const hasDetailMedia = Boolean(detailMediaUrl);
  media.className = `${prefix}_detail_media ${prefix}_detail_media_${type}${hasDetailMedia ? " has_detail_media" : " has_detail_placeholder"}`;
  media.replaceChildren();
  setDetailMediaAspect(prefix, detailAspectFromItem(selectedItem));
  if (hasDetailMedia) {
    if (type === "video") {
      const player = createDetailVideoPlayer(prefix, renderItem);
      media.append(player);
      playDetailVideoIfCurrent(prefix, player.querySelector("video"));
    } else {
      const image = document.createElement("img");
      image.className = "detail_image detail-image detail_media_object";
      image.alt = "";
      image.draggable = false;
      image.addEventListener("load", () => {
        syncDetailMediaAspect(prefix, image, selectedItem);
        if (prefix === "i") renderImagineDetailAspectMenu(selectedItem);
      }, { once: true });
      image.src = detailMediaUrl;
      media.append(image);
      bindDetailMediaZoom(media, image);
      bindDetailImageFullscreen(media);
      if (image.complete) {
        syncDetailMediaAspect(prefix, image, selectedItem);
        if (prefix === "i") renderImagineDetailAspectMenu(selectedItem);
      }
    }
  } else {
    const icon = document.createElement("img");
    icon.className = "detail_placeholder_icon";
    icon.src = `./assets/icons/${type === "video" ? "video" : "image"}.svg`;
    icon.alt = "";
    media.append(icon);
  }
  if (meta) {
    meta.textContent = detailPromptFor(post, selectedItem) || "Prompt";
  }
  if (providerBadge) {
    providerBadge.classList.toggle(`${prefix}_detail_provider_video`, type === "video");
    providerBadge.classList.toggle(`${prefix}_detail_provider_image`, type !== "video");
    providerBadge.innerHTML = `<img src="./assets/icons/${type === "video" ? "video" : "image"}.svg" alt="" />`;
  }
  if (modelName) {
    modelName.textContent = detailVisibleModelLabel(prefix, type, selectedItem, post);
  }
  setDetailResolutionLabel(prefix, mediaResolutionLabelForItem(selectedItem, post));
  if (modelBadge) {
    appendLuckyBadge(modelBadge, selectedItem, post, "detail_lucky_badge");
  }
}
