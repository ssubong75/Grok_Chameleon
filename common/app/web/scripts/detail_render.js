// Detail view rendering and model labels
const DETAIL_THUMB_CACHE_MAX_ACTIVE = 12;
const detailThumbCacheQueue = [];
let activeDetailThumbCacheLoads = 0;
let detailThumbCachePumpScheduled = false;

function pumpDetailThumbCacheQueue() {
  detailThumbCachePumpScheduled = false;
  while (activeDetailThumbCacheLoads < DETAIL_THUMB_CACHE_MAX_ACTIVE && detailThumbCacheQueue.length) {
    const entry = detailThumbCacheQueue.shift();
    if (!entry?.button?.isConnected) continue;
    activeDetailThumbCacheLoads += 1;
    Promise.resolve()
      .then(entry.load)
      .catch(() => {
        // The thumbnail's source fallback is retained by its own loader.
      })
      .finally(() => {
        activeDetailThumbCacheLoads -= 1;
        if (!detailThumbCachePumpScheduled) {
          detailThumbCachePumpScheduled = true;
          Promise.resolve().then(pumpDetailThumbCacheQueue);
        }
      });
  }
}

function queueDetailThumbCacheLoad(button, load, priority = false) {
  if (!button || typeof load !== "function") return;
  const entry = { button, load };
  if (priority) {
    const firstNormal = detailThumbCacheQueue.findIndex((candidate) => !candidate.priority);
    if (firstNormal >= 0) detailThumbCacheQueue.splice(firstNormal, 0, { ...entry, priority: true });
    else detailThumbCacheQueue.push({ ...entry, priority: true });
  } else {
    detailThumbCacheQueue.push({ ...entry, priority: false });
  }
  if (!detailThumbCachePumpScheduled) {
    detailThumbCachePumpScheduled = true;
    Promise.resolve().then(pumpDetailThumbCacheQueue);
  }
}

function startDetailThumbCacheLoads(thumbs) {
  const start = (thumb, priority) => {
    const load = thumb?._detailThumbCacheLoad;
    if (typeof load !== "function") return;
    delete thumb._detailThumbCacheLoad;
    queueDetailThumbCacheLoad(thumb, load, priority);
  };
  for (const thumb of thumbs) {
    if (thumb.classList.contains("active")) start(thumb, true);
  }
  for (const thumb of thumbs) {
    if (!thumb.classList.contains("active")) start(thumb, false);
  }
}

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
  if (value.includes("grok-imagine-image-2.0") || value.includes("m 2.0") || value.includes("m2.0")) return "M 2.0";
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

// i2i, i2v and extend results attach to the link card they were generated from, and so do
// their in-flight jobs, but none of them carry the link metadata themselves. Offer the
// heart only for the assets the card was opened with, so a generated result sitting in an
// Imagine main card never asks to be saved.
function detailImagineLinkItemIsSource(item) {
  if (!item) return true;
  const { metadata, imagine } = detailImagineMetadataFrom(item);
  return Boolean(
    metadata.link_source
    || imagine.link_source
    || metadata.remote_view === "link"
    || imagine.remote_view === "link"
  );
}

// A copy made by the heart is already this account's own asset, so there is nothing left
// for the heart to do and no second state to toggle into. Pressing it again used to strip
// the copy from Liked while the app still kept it out of the main list, leaving an asset
// that was owned but reachable from nowhere. Delete is what removes a copy now, and that
// clears it from the saved view and Liked at once.
function detailIsImagineClonedCopy(post, item) {
  const postMeta = detailImagineMetadataFrom(post);
  const itemMeta = detailImagineMetadataFrom(item);
  return Boolean(
    postMeta.metadata.cloned_copy
    || postMeta.imagine.cloned_copy
    || itemMeta.metadata.cloned_copy
    || itemMeta.imagine.cloned_copy
  );
}

function detailCanSaveImaginePost(post, item) {
  if (detailIsImagineClonedCopy(post, item)) return false;
  // A link-opened post carries folder_path "imagine_saved/{id}" whether or not it was
  // ever hearted, so that prefix cannot stand in for "already saved" — testing it here
  // hid the heart on every linked post and left no way to reach clone-batch. Whether the
  // post is actually saved is decided by imaginePostLiked() in syncImagineDetailHeartState.
  if (detailIsImagineLinkSource(post, item)) return detailImagineLinkItemIsSource(item);
  return Boolean(
    (typeof isImagineDiscoverPost === "function" && isImagineDiscoverPost(post, item))
    || (typeof isImagineT2iPost === "function" && isImagineT2iPost(post))
  );
}

function syncImagineDetailHeartState(post, item) {
  const button = document.querySelector(".i_detail_heart");
  if (!button) return;
  if (detailIsImagineLinkSource(post, item)) {
    const postMeta = detailImagineMetadataFrom(post);
    const itemMeta = detailImagineMetadataFrom(item);
    const postId = String(
      postMeta.metadata.link_post_id
      || postMeta.imagine.link_post_id
      || itemMeta.metadata.link_post_id
      || itemMeta.imagine.link_post_id
      || post?.post_id
      || "",
    ).trim();
    const itemId = String(
      item?.asset_id
      || itemMeta.metadata.asset_id
      || itemMeta.imagine.asset_id
      || item?.item_id
      || item?.post_id
      || "",
    ).trim();
    const accountId = String(
      post?.account_id
      || itemMeta.imagine.account_id
      || itemMeta.metadata.account_id
      || "",
    ).trim();
    if (postId) button.dataset.imagineHeartPostId = postId;
    if (itemId) button.dataset.imagineHeartItemId = itemId;
    if (accountId) button.dataset.imagineHeartAccountId = accountId;
  } else {
    delete button.dataset.imagineHeartPostId;
    delete button.dataset.imagineHeartItemId;
    delete button.dataset.imagineHeartAccountId;
  }
  if (button.getAttribute("aria-busy") === "true") {
    button.hidden = false;
    button.classList.add("saved");
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("aria-label", "Saving");
    return;
  }
  const saved = typeof imaginePostLiked === "function"
    && (imaginePostLiked(post, item) || imaginePostLiked(post));
  // Hiding the heart once saved left no way to un-heart: grok.com keeps it on screen and
  // filled, and pressing it again takes the asset out of the Liked collection.
  const visible = detailCanSaveImaginePost(post, item);
  button.hidden = !visible;
  button.classList.toggle("saved", Boolean(saved));
  button.setAttribute("aria-pressed", saved ? "true" : "false");
  button.setAttribute("aria-label", saved ? "Unsave" : "Save");
}

function syncBuildDetailHeartState(post) {
  const button = document.querySelector(".b_detail_heart");
  if (!button) return;
  // Build results land in the local library as files the moment they finish, so there is
  // nothing here for a heart to save. Imagine needs one because a linked asset is not yours
  // until clone-batch copies it; Build main lists on build_visible, never on favorite.
  button.hidden = true;
}

function renderDetailViews(options = {}) {
  const activePrefix = options.activeOnly
    ? (screen_state.current_screen === "i_detail" ? "i" : (screen_state.current_screen === "b_detail" ? "b" : ""))
    : "";
  const post = selectedLibraryPost();
  const buildJobs = typeof buildJobsForPost === "function" ? buildJobsForPost(post) : [];
  const imagineJobs = typeof imagineJobsForPost === "function" ? imagineJobsForPost(post) : [];
  const buildJob = typeof selectedBuildJobForPost === "function" ? selectedBuildJobForPost(post) : selectedBuildJob();
  const imagineJob = typeof selectedImagineJobForPost === "function"
    ? selectedImagineJobForPost(post)
    : (typeof selectedImagineJob === "function" ? selectedImagineJob() : null);
  const imaginePost = imagineJob && typeof imagineJobDetailPost === "function" ? imagineJobDetailPost(imagineJob, post, imagineJobs) : post;
  if (activePrefix !== "b") renderDetailView("i", imaginePost, options);
  if (activePrefix !== "i") renderDetailView("b", buildJob ? buildJobDetailPost(buildJob, post, buildJobs) : post, options);
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

// Everything a thumbnail's contents depend on. Anything not in here is state a reused node
// can be re-dressed with, so it decides whether the node survives a re-render.
function detailThumbSignature(prefix, item, post) {
  const type = item.type || mediaTypeForName(item.file || item.url) || "image";
  const moderated = typeof mediaItemIsModerated === "function" && mediaItemIsModerated(item);
  const previewUrl = moderated ? "" : detailPreviewUrlForItem(prefix, { ...item, type }, post);
  const videoUrl = !moderated && type === "video"
    ? detailVideoPreviewUrlForItem(prefix, { ...item, type }, post)
    : "";
  return JSON.stringify([type, moderated, previewUrl, videoUrl]);
}

function applyDetailThumbState(button, type, options = {}) {
  button.classList.toggle("active", Boolean(options.active));
  button.classList.toggle("source_pick_candidate", Boolean(options.sourcePickActive) && type === "image");
  button.classList.toggle("split_pick_candidate", Boolean(options.splitPickActive));
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
  button.dataset.thumbSignature = detailThumbSignature(prefix, item, post);
  button.setAttribute("aria-label", `${type === "video" ? "Video" : "Image"} version`);

  const fill = document.createElement("span");
  fill.className = `${prefix}_detail_thumb_fill`;
  const moderated = typeof mediaItemIsModerated === "function" && mediaItemIsModerated(item);
  if (moderated) {
    button.classList.add("moderated_media_thumb");
    button.setAttribute("aria-label", "Moderated");
    fill.classList.add("moderated_detail_thumb_media");
    const moderatedIcon = document.createElement("span");
    moderatedIcon.className = "detail_job_thumb_icon";
    moderatedIcon.innerHTML = hiddenMediaIconSvg();
    button.append(fill, moderatedIcon);
    return button;
  }
  const previewUrl = detailPreviewUrlForItem(prefix, { ...item, type }, post);
  const videoUrl = type === "video" ? detailVideoPreviewUrlForItem(prefix, { ...item, type }, post) : "";
  const buildPreviewSource = previewUrl || videoUrl;
  const queuedPreviewSource = buildPreviewSource;
  const queuedPreviewSourceIsVideo = type === "video" && Boolean(videoUrl) && queuedPreviewSource === videoUrl;
  const previewCacheIdentity = prefix === "i" && typeof cardPreviewStableIdentity === "function"
    ? cardPreviewStableIdentity(item)
    : "";
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
  if (queuedPreviewSource && typeof resolveLocalCardPreview === "function") {
    fill.classList.add("detail_thumb_preview");
    if ((prefix === "b" || prefix === "i") && typeof existingPersistentCardPreview === "function") {
      // A detail version strip can be long. Ask its 320px cache in a bounded parallel
      // batch instead of making every button request its source first. Cache misses use
      // the separate native queue, so they never hold up cached thumbnails behind them.
      button._detailThumbCacheLoad = () => {
        const showSourceFallback = () => {
          if (!fill.isConnected) return;
          if (queuedPreviewSourceIsVideo) appendVideoFallback();
          else if (previewUrl) fill.style.backgroundImage = `url("${previewUrl}")`;
        };
        const showCachedPreview = (resolvedUrl) => {
          if (!fill.isConnected || !resolvedUrl) return;
          fill.classList.remove("detail_thumb_video_preview");
          fill.replaceChildren();
          fill.style.backgroundImage = `url("${resolvedUrl}")`;
        };
        const remoteImagineSource = prefix === "i"
          && typeof isImagineRemoteCardPreview === "function"
          && isImagineRemoteCardPreview(buildPreviewSource);
        const queueMissingPreview = () => {
          if (typeof window.grokChameleonNative?.cardPreview !== "function") {
            if (remoteImagineSource) showSourceFallback();
            return;
          }
          // Intentionally do not return this promise. The 12-slot cache loader can keep
          // checking the rest of the strip while only this cache miss waits to generate.
          queueNativeCardPreview(fill, {
            url: buildPreviewSource,
            kind: "thumbnail",
            cache_identity: previewCacheIdentity,
          }).then((result) => {
            const generatedUrl = String(result?.url || "").trim();
            if (generatedUrl) showCachedPreview(generatedUrl);
          }).catch(() => {
            if (remoteImagineSource) showSourceFallback();
          });
        };
        return existingPersistentCardPreview(buildPreviewSource, "thumbnail", previewCacheIdentity).then((existingPreview) => {
          if (!fill.isConnected) return;
          if (existingPreview) {
            showCachedPreview(existingPreview);
            return;
          }
          // An Imagine cache miss would otherwise make every thumbnail fetch from Grok
          // at once. Let the detail-native queue start only two remote generations; Build
          // and local Imagine media can reveal their local source immediately.
          if (!remoteImagineSource) showSourceFallback();
          queueMissingPreview();
        }).catch(() => {
          if (!remoteImagineSource) showSourceFallback();
          queueMissingPreview();
        });
      };
    } else {
      if (previewUrl && !queuedPreviewSourceIsVideo) {
        fill.style.backgroundImage = `url("${previewUrl}")`;
      } else if (queuedPreviewSourceIsVideo) {
        requestAnimationFrame(appendVideoFallback);
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!fill.isConnected) return;
          // The legacy call shape, resolveLocalCardPreview(buildPreviewSource, "thumbnail"), remains supported.
          resolveLocalCardPreview(buildPreviewSource, "thumbnail", previewCacheIdentity, fill).then((resolvedUrl) => {
            if (!fill.isConnected) return;
            if (resolvedUrl && (!queuedPreviewSourceIsVideo || resolvedUrl !== queuedPreviewSource)) {
              fill.style.backgroundImage = `url("${resolvedUrl}")`;
            } else if (type === "video") {
              appendVideoFallback();
            } else if (previewUrl) {
              fill.style.backgroundImage = `url("${previewUrl}")`;
            }
          });
        });
      });
    }
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
    const icon = document.createElement("img");
    icon.src = "./assets/icons/video.svg";
    icon.alt = "";
    typeIcon.append(icon);
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

function renderDetailView(prefix, post, options = {}) {
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
    renderBuildJobDetailView(prefix, post, options);
    return;
  }
  if (!post?.items?.length) return;
  const preserveThumbScroll = Boolean(options.preserveThumbScroll);
  const previousThumbScrollTop = preserveThumbScroll ? thumbList.scrollTop : 0;
  const selectedItem = selectedDetailItem(post);
  if (prefix === "i") syncImagineDetailHeartState(post, selectedItem);
  if (prefix === "b") syncBuildDetailHeartState(post);
  const selectedKey = mediaItemKey(selectedItem);
  const detailItems = detailOrderedItems(post);
  const sourcePickActive = Boolean(library_state.sourcePickPending && screen_state.current_screen === `${prefix}_detail`);
  const splitPickActive = Boolean(library_state.splitPickPending && screen_state.current_screen === `${prefix}_detail`);
  thumbList.classList.toggle("source_pick_active", sourcePickActive);
  thumbList.classList.toggle("split_pick_active", splitPickActive);
  // Selecting a thumbnail re-renders the whole strip. Rebuilding it threw every node away,
  // and disposing a node cancels its queued preview, so each click restarted work that had
  // already been done or was halfway there. Keep the nodes whose contents did not change
  // and only re-dress them; a thumbnail resolved once now stays resolved.
  const previousThumbs = new Map();
  for (const oldThumb of Array.from(thumbList.children)) {
    const oldKey = String(oldThumb?.dataset?.libraryItemId || "");
    if (oldKey && !previousThumbs.has(oldKey)) previousThumbs.set(oldKey, oldThumb);
  }
  const reusedThumbs = new Set();
  const thumbs = detailItems.map((item) => {
    const key = mediaItemKey(item);
    const active = key === selectedKey;
    const existing = previousThumbs.get(key);
    const type = existing?.dataset?.libraryItemType || "";
    if (existing && existing.dataset.thumbSignature === detailThumbSignature(prefix, item, post)) {
      reusedThumbs.add(existing);
      applyDetailThumbState(existing, type, { active, sourcePickActive, splitPickActive });
      return existing;
    }
    const button = detailThumbButtonForItem(prefix, item, post, {
      active,
      sourcePickActive,
      splitPickActive,
    });
    return button;
  });
  for (const oldThumb of previousThumbs.values()) {
    if (reusedThumbs.has(oldThumb)) continue;
    if (typeof disposeCardPreviewNode === "function") disposeCardPreviewNode(oldThumb);
  }
  // replaceChildren detaches and re-attaches even identical children, and an in-flight
  // preview that resolves during that gap sees isConnected === false and drops its result.
  const currentThumbs = Array.from(thumbList.children);
  const orderUnchanged = currentThumbs.length === thumbs.length
    && currentThumbs.every((node, index) => node === thumbs[index]);
  if (!orderUnchanged) thumbList.replaceChildren(...thumbs);
  if (prefix === "b" || prefix === "i") startDetailThumbCacheLoads(thumbs);
  if (thumbList._detailThumbLayoutFrame) {
    cancelAnimationFrame(thumbList._detailThumbLayoutFrame);
    thumbList._detailThumbLayoutFrame = 0;
  }
  if (preserveThumbScroll && orderUnchanged) {
    // The user just picked an item in the visible strip. Its layout is unchanged, so avoid
    // a forced measurement and, critically, do not pull the list back to its newest item.
  } else {
    thumbList._detailThumbLayoutFrame = requestAnimationFrame(() => {
      thumbList._detailThumbLayoutFrame = 0;
      syncDetailThumbListOverflow(thumbList);
      if (preserveThumbScroll) {
        const maxScrollTop = Math.max(0, thumbList.scrollHeight - thumbList.clientHeight);
        thumbList.scrollTop = Math.min(previousThumbScrollTop, maxScrollTop);
      } else {
        thumbList.scrollTop = thumbList.scrollHeight;
      }
    });
  }

  const type = detailItemType(selectedItem);
  if (prefix === "i") syncImagineDetailToolButtons(type, selectedItem, post);
  if (prefix === "i") renderImagineDetailAspectMenu(selectedItem);
  const renderItem = detailRenderableItem(prefix, selectedItem, post);
  const detailMediaUrl = detailMediaUrlForItem(prefix, selectedItem, post);
  const moderated = typeof mediaItemIsModerated === "function" && mediaItemIsModerated(selectedItem);
  const hasDetailMedia = !moderated && Boolean(detailMediaUrl);
  media.className = `${prefix}_detail_media ${prefix}_detail_media_${type}${moderated ? " has_moderated_preview" : (hasDetailMedia ? " has_detail_media" : " has_detail_placeholder")}`;
  media.replaceChildren();
  setDetailMediaAspect(prefix, detailAspectFromItem(selectedItem));
  if (moderated) {
    media.append(hiddenMediaPreviewElement());
  } else if (hasDetailMedia) {
    if (type === "video") {
      const player = createDetailVideoPlayer(prefix, renderItem, post);
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
  if (prefix === "i" && typeof renderImagineDetailHeartPreparationOverlay === "function") {
    renderImagineDetailHeartPreparationOverlay(media);
  }
  if (meta) {
    meta.textContent = detailPromptFor(post, selectedItem) || "Prompt";
  }
  if (providerBadge) {
    providerBadge.classList.toggle(`${prefix}_detail_provider_video`, type === "video");
    providerBadge.classList.toggle(`${prefix}_detail_provider_image`, type !== "video");
    const icon = document.createElement("img");
    icon.src = `./assets/icons/${type === "video" ? "video" : "image"}.svg`;
    icon.alt = "";
    providerBadge.replaceChildren(icon);
  }
  if (modelName) {
    modelName.textContent = detailVisibleModelLabel(prefix, type, selectedItem, post);
  }
  setDetailResolutionLabel(prefix, mediaResolutionLabelForItem(selectedItem, post));
  if (modelBadge) {
    appendLuckyBadge(modelBadge, selectedItem, post, "detail_lucky_badge");
  }
}
