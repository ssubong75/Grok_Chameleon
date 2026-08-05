// Detail media type, aspect, zoom, and card preview helpers
const detailMediaZoomBindings = new WeakMap();
const detailMediaAspectCache = new Map();
const localCardPreviewObserver = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      localCardPreviewObserver.unobserve(entry.target);
      if (typeof entry.target.cardPreviewLoad === "function") entry.target.cardPreviewLoad();
    }
  }, { root: null, rootMargin: "1600px 0px", threshold: 0.01 })
  : null;
const missingImagineCardPreviewChecks = new Map();
const persistentCardPreviewLookupCache = new Map();
const imagineRecoveredStartFrameTasks = new Map();
const imagineRecoveredStartFrameItems = new Map();
const imagineRecoveredStartFrameRefreshes = new Set();
const cardPreviewDisposers = new WeakMap();
const CARD_PREVIEW_NATIVE_MAX_ACTIVE = 4;
const nativeCardPreviewQueue = [];
let activeNativeCardPreviewTasks = 0;
let nativeCardPreviewPumpScheduled = false;
const imagineRecoveredStartFrameIconDataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="#fff" stroke-width="2"/>
    <path d="M8 4.5V19.5M16 4.5V19.5M3.5 9H8M3.5 15H8M16 9H20.5M16 15H20.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  </svg>
`)}`;
let detailLastMediaAspect = "";
let detailImageFullscreenListenerBound = false;

function imagineRecoveredStartFrameIconUrl() {
  return imagineRecoveredStartFrameIconDataUrl;
}

function imagineRecoveredStartFrameMetadata(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return {
    metadata,
    imagine,
    recovered: Boolean(
      item?.recovered_start_frame
      || metadata.recovered_start_frame
      || imagine.recovered_start_frame
    ),
  };
}

function isImagineRecoveredStartFrame(item) {
  return imagineRecoveredStartFrameMetadata(item).recovered;
}

function imagineRecoveredStartFrameDisabled(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return Boolean(
    item?.recovered_start_frame_disabled
    || metadata.recovered_start_frame_disabled
    || imagine.recovered_start_frame_disabled
  );
}

function imagineRecoveredStartFramePostEligible(post) {
  const source = String(post?.source || "").trim().toLowerCase();
  if (source === "imagine") return true;
  const accountId = String(post?.account_id || "").trim().toLowerCase();
  const folderName = String(post?.folder_path || "").split("/").filter(Boolean).pop() || "";
  return source === "build"
    && accountId.startsWith("imagine_")
    && /^merged-item(?:-\d+)?$/i.test(folderName);
}

function imagineRecoveredStartFrameSourceKey(item) {
  const { metadata, imagine } = imagineRecoveredStartFrameMetadata(item);
  return String(
    item?.recovered_from_item_id
    || metadata.recovered_from_item_id
    || imagine.recovered_from_item_id
    || ""
  ).trim();
}

function imagineRecoveredStartFrameForVideo(post, videoItem) {
  if (imagineRecoveredStartFrameDisabled(videoItem)) return null;
  const sourceKey = String(typeof mediaItemKey === "function" ? mediaItemKey(videoItem) : "").trim();
  if (!sourceKey) return null;
  const attached = (post?.items || []).find((item) => (
    isImagineRecoveredStartFrame(item)
    && imagineRecoveredStartFrameSourceKey(item) === sourceKey
  ));
  if (attached) return attached;
  return imagineRecoveredStartFrameItems.get(imagineRecoveredStartFrameTaskKey(post, videoItem)) || null;
}

function imaginePostHasRealImage(post) {
  return (post?.items || []).some((item) => (
    detailItemType(item) === "image"
    && !isImagineRecoveredStartFrame(item)
    && Boolean(detailMediaUrlForItem("i", item, post))
  ));
}

function imagineRecoveredStartFrameTaskKey(post, videoItem) {
  const postKey = String(post?.folder_path || post?.post_id || "").trim();
  const itemKey = String(typeof mediaItemKey === "function" ? mediaItemKey(videoItem) : "").trim();
  return `${postKey}\0${itemKey}`;
}

function attachCachedImagineRecoveredStartFrames(post) {
  if (!imagineRecoveredStartFramePostEligible(post) || imaginePostHasRealImage(post)) return;
  const originalItems = Array.isArray(post?.items) ? post.items : [];
  const recoveredItems = originalItems
    .filter((item) => detailItemType(item) === "video" && !imagineRecoveredStartFrameDisabled(item))
    .map((videoItem) => imagineRecoveredStartFrameItems.get(imagineRecoveredStartFrameTaskKey(post, videoItem)))
    .filter(Boolean)
    .filter((item) => !originalItems.some((existing) => mediaItemKey(existing) === mediaItemKey(item)));
  if (recoveredItems.length) post.items = [...originalItems, ...recoveredItems];
}

function captureImagineVideoStartFrame(videoUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timeoutId = window.setTimeout(() => finish(null, new Error("Start frame timed out.")), 15000);
    let finished = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      try {
        video.load();
      } catch (_) {}
    };
    const finish = (result, error = null) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const capture = () => {
      const width = Number(video.videoWidth || 0);
      const height = Number(video.videoHeight || 0);
      if (!width || !height) {
        finish(null, new Error("Start frame dimensions are unavailable."));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        finish(null, new Error("Start frame canvas is unavailable."));
        return;
      }
      try {
        context.drawImage(video, 0, 0, width, height);
      } catch (error) {
        finish(null, error);
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          finish(null, new Error("Start frame encoding failed."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (finished) return;
          const dataUrl = String(reader.result || "");
          if (!dataUrl.startsWith("data:image/")) {
            finish(null, new Error("Start frame data could not be encoded."));
            return;
          }
          finish({
            url: URL.createObjectURL(blob),
            data_url: dataUrl,
            mime_type: blob.type || "image/png",
            size: blob.size || 0,
            width,
            height,
          });
        };
        reader.onerror = () => finish(null, reader.error || new Error("Start frame data could not be read."));
        reader.readAsDataURL(blob);
      }, "image/png");
    };
    const onLoadedData = () => {
      window.requestAnimationFrame(capture);
    };
    const onError = () => finish(null, new Error("Start frame could not be decoded."));

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("loadeddata", onLoadedData, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.src = videoUrl;
    video.load();
  });
}

function ensureImagineRecoveredStartFrame(post, videoItem) {
  if (!imagineRecoveredStartFramePostEligible(post) || detailItemType(videoItem) !== "video") return Promise.resolve(null);
  if (imagineRecoveredStartFrameDisabled(videoItem)) return Promise.resolve(null);
  if (imaginePostHasRealImage(post)) return Promise.resolve(null);
  const existing = imagineRecoveredStartFrameForVideo(post, videoItem);
  if (existing) return Promise.resolve(existing);
  const detailPrefix = String(post?.source || "").toLowerCase() === "build" ? "b" : "i";
  const videoUrl = detailMediaUrlForItem(detailPrefix, videoItem, post);
  const sourceKey = String(typeof mediaItemKey === "function" ? mediaItemKey(videoItem) : "").trim();
  if (!videoUrl || !sourceKey) return Promise.resolve(null);
  const taskKey = imagineRecoveredStartFrameTaskKey(post, videoItem);
  if (imagineRecoveredStartFrameTasks.has(taskKey)) return imagineRecoveredStartFrameTasks.get(taskKey);
  const accountId = String(
    videoItem?.account_id
    || videoItem?.metadata?.account_id
    || videoItem?.metadata?.imagine?.account_id
    || post?.account_id
    || ""
  ).trim();
  const safeSourceKey = sourceKey.replace(/[^a-zA-Z0-9]/g, "").slice(-48) || "video";
  const task = captureImagineVideoStartFrame(videoUrl).then((frame) => {
    const duplicate = imagineRecoveredStartFrameForVideo(post, videoItem);
    if (duplicate) {
      URL.revokeObjectURL(frame.url);
      return duplicate;
    }
    const item = {
      item_id: `recovered-start-frame-${safeSourceKey}`,
      type: "image",
      file: "",
      url: frame.url,
      object_url: frame.url,
      thumbnail_url: frame.url,
      data_url: frame.data_url,
      mime_type: frame.mime_type,
      size: frame.size,
      width: frame.width,
      height: frame.height,
      aspect_ratio: `${frame.width}:${frame.height}`,
      role: "source",
      relation: "recovered_start_frame",
      title: "Recovered start frame",
      prompt: "",
      recovered_start_frame: true,
      recovered_from_item_id: sourceKey,
      account_id: accountId,
      metadata: {
        recovered_start_frame: true,
        recovered_from_item_id: sourceKey,
        account_id: accountId,
        imagine: {
          recovered_start_frame: true,
          recovered_from_item_id: sourceKey,
          account_id: accountId,
        },
      },
    };
    imagineRecoveredStartFrameItems.set(taskKey, item);
    post.items = Array.isArray(post.items) ? [...post.items, item] : [item];
    return item;
  }).catch((error) => {
    console.warn("Imagine start frame recovery failed.", error);
    return null;
  }).finally(() => {
    imagineRecoveredStartFrameTasks.delete(taskKey);
  });
  imagineRecoveredStartFrameTasks.set(taskKey, task);
  return task;
}

function scheduleImagineRecoveredStartFrame(post, videoItem) {
  if (!imagineRecoveredStartFramePostEligible(post) || detailItemType(videoItem) !== "video") return;
  if (imagineRecoveredStartFrameDisabled(videoItem)) return;
  if (imaginePostHasRealImage(post) || imagineRecoveredStartFrameForVideo(post, videoItem)) return;
  const taskKey = imagineRecoveredStartFrameTaskKey(post, videoItem);
  if (!taskKey || imagineRecoveredStartFrameRefreshes.has(taskKey)) return;
  const detailScreen = screen_state.current_screen;
  if (detailScreen !== "i_detail" && detailScreen !== "b_detail") return;
  imagineRecoveredStartFrameRefreshes.add(taskKey);
  ensureImagineRecoveredStartFrame(post, videoItem).then((item) => {
    if (!item || screen_state.current_screen !== detailScreen) return;
    const selectedPost = typeof selectedLibraryPost === "function" ? selectedLibraryPost() : null;
    if (
      selectedPost !== post
      && String(selectedPost?.folder_path || "") !== String(post?.folder_path || "")
    ) return;
    renderDetailViews();
    if (typeof syncDetailAttachmentForComposerTray === "function") {
      syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
    }
  }).finally(() => {
    imagineRecoveredStartFrameRefreshes.delete(taskKey);
  });
}

function discardImagineRecoveredStartFrame(post, item) {
  if (!isImagineRecoveredStartFrame(item)) return false;
  const sourceKey = imagineRecoveredStartFrameSourceKey(item);
  const postKey = String(post?.folder_path || post?.post_id || "").trim();
  const taskKey = `${postKey}\0${sourceKey}`;
  const cached = imagineRecoveredStartFrameItems.get(taskKey);
  const urls = new Set([
    item?.url,
    item?.object_url,
    item?.thumbnail_url,
    cached?.url,
    cached?.object_url,
    cached?.thumbnail_url,
  ].map((value) => String(value || "").trim()).filter((value) => value.startsWith("blob:")));
  imagineRecoveredStartFrameItems.delete(taskKey);
  imagineRecoveredStartFrameRefreshes.delete(taskKey);
  const itemKey = String(typeof mediaItemKey === "function" ? mediaItemKey(item) : item?.item_id || "");
  if (Array.isArray(post?.items)) {
    post.items = post.items.filter((candidate) => (
      String(typeof mediaItemKey === "function" ? mediaItemKey(candidate) : candidate?.item_id || "") !== itemKey
    ));
  }
  for (const url of urls) URL.revokeObjectURL(url);
  return true;
}

function detailItemType(item) {
  return item?.type || mediaTypeForName(item?.file || item?.url || item?.object_url || "") || "image";
}

function mediaItemLucky(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  return Boolean(item?.lucky || item?.lucky_recovery || metadata.lucky || imagine.lucky);
}

function postHasLucky(post, item = null) {
  if (item && mediaItemLucky(item)) return true;
  if (mediaItemLucky(post?.representative_item)) return true;
  return Array.isArray(post?.items) && post.items.some((candidate) => mediaItemLucky(candidate));
}

function appendLuckyBadge(host, item, post = null, className = "") {
  if (!host || !postHasLucky(post, item)) return null;
  const badge = document.createElement("span");
  badge.className = `lucky_badge${className ? ` ${className}` : ""}`;
  badge.textContent = "Lucky";
  host.append(badge);
  return badge;
}

function detailProviderFor(prefix, post) {
  if (prefix === "i") return "imagine";
  if (prefix === "b") return "build";
  return isImaginePost(post) ? "imagine" : "build";
}

function detailMediaUrlForItem(prefix, item, post = selectedLibraryPost()) {
  if (detailProviderFor(prefix, post) === "imagine" && typeof iDetailMediaUrl === "function") {
    return iDetailMediaUrl(item, post);
  }
  if (typeof bDetailMediaUrl === "function") return bDetailMediaUrl(item);
  return item?.object_url || item?.url || "";
}

function detailPreviewUrlForItem(prefix, item, post = selectedLibraryPost()) {
  if (detailProviderFor(prefix, post) === "imagine" && typeof iDetailPreviewUrl === "function") {
    return iDetailPreviewUrl(item, post);
  }
  if (typeof bDetailPreviewUrl === "function") return bDetailPreviewUrl(item);
  return mediaPreviewUrl(item);
}

function detailVideoPreviewUrlForItem(prefix, item, post = selectedLibraryPost()) {
  if (detailProviderFor(prefix, post) === "imagine" && typeof iDetailVideoPreviewUrl === "function") {
    return iDetailVideoPreviewUrl(item, post);
  }
  if (typeof bDetailVideoPreviewUrl === "function") return bDetailVideoPreviewUrl(item);
  return videoPreviewUrl(item);
}

function detailRenderableItem(prefix, item, post = selectedLibraryPost()) {
  if (!item) return item;
  const provider = detailProviderFor(prefix, post);
  const mediaUrl = detailMediaUrlForItem(prefix, item, post);
  const previewUrl = detailPreviewUrlForItem(prefix, item, post);
  if (provider === "build") {
    return {
      ...item,
      object_url: mediaUrl,
      local_url: mediaUrl || item.local_url || "",
      url: typeof bLocalMediaUrl === "function" ? bLocalMediaUrl(item.url) : "",
      media_url: "",
      mediaUrl: "",
      remote_url: "",
      thumbnail_url: previewUrl,
      poster_url: typeof bLocalMediaUrl === "function" ? bLocalMediaUrl(item.poster_url) : "",
    };
  }
  return {
    ...item,
    object_url: mediaUrl || item.object_url || item.url || "",
    thumbnail_url: previewUrl || item.thumbnail_url || item.poster_url || "",
  };
}

function detailAspectFromValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?::|\/|x|\u00d7)\s*(\d+(?:\.\d+)?)/);
  if (!match) return "";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  return `${width} / ${height}`;
}

function normalizeDetailAspectValue(aspect) {
  return detailAspectFromValue(aspect);
}

function detailAspectKeysForItem(item) {
  if (!item) return [];
  const keys = new Set();
  const add = (prefix, value) => {
    const text = String(value || "").trim();
    if (text) keys.add(`${prefix}:${text}`);
  };
  add("key", typeof mediaItemKey === "function" ? mediaItemKey(item) : "");
  add("item", item.item_id || item.id);
  add("file", item.file || item.name);
  add("url", item.url || item.object_url || item.local_url || item.remote_url);
  return [...keys];
}

function cachedDetailAspectForItem(item) {
  for (const key of detailAspectKeysForItem(item)) {
    const aspect = detailMediaAspectCache.get(key);
    if (aspect) return aspect;
  }
  return "";
}

function rememberDetailAspectForItem(item, aspect) {
  const normalized = normalizeDetailAspectValue(aspect);
  if (!normalized) return;
  detailLastMediaAspect = normalized;
  for (const key of detailAspectKeysForItem(item)) {
    detailMediaAspectCache.set(key, normalized);
  }
}

function detailAspectFromItem(item) {
  const cached = cachedDetailAspectForItem(item);
  if (cached) return cached;
  const width = Number(item?.width || item?.natural_width || item?.metadata?.width || item?.meta?.width || 0);
  const height = Number(item?.height || item?.natural_height || item?.metadata?.height || item?.meta?.height || 0);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${width} / ${height}`;
  }
  return detailAspectFromValue(item?.aspect_ratio)
    || detailAspectFromValue(item?.aspectRatio)
    || detailAspectFromValue(item?.aspect)
    || detailAspectFromValue(item?.ratio)
    || detailAspectFromValue(item?.resolution)
    || detailAspectFromValue(item?.size)
    || "";
}

function detailRenderedMediaAspect(prefix, item = selectedDetailItem()) {
  const media = document.querySelector(`.${prefix}_detail_media`);
  const element = media?.querySelector("img.detail_media_object, video.detail_media_object, video");
  const width = Number(element?.naturalWidth || element?.videoWidth || 0);
  const height = Number(element?.naturalHeight || element?.videoHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  const aspect = `${width} / ${height}`;
  rememberDetailAspectForItem(item, aspect);
  return aspect;
}

function mediaResolutionLabelFromDimensions(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "";
  const shortSide = Math.min(w, h);
  for (const size of [1080, 720, 480]) {
    if (Math.abs(shortSide - size) <= 24) return String(size);
  }
  return "";
}

function normalizeMediaResolutionLabel(value) {
  if (!value) return "";
  if (typeof value === "object") {
    const direct = normalizeMediaResolutionLabel(value.name || value.label || value.resolutionName || value.resolution_name);
    if (direct) return direct;
    return mediaResolutionLabelFromDimensions(value.width, value.height);
  }
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (/1080\s*p|1080|hd1080|full\s*hd|\bfhd\b|upscale_target_resolution_1080p/.test(text)) return "1080";
  if (/720\s*p|720|(^|[_\W])hd([_\W]|$)/.test(text)) return "720";
  if (/480\s*p|480|(^|[_\W])sd([_\W]|$)/.test(text)) return "480";
  return "";
}

function mediaResolutionCandidates(source) {
  if (!source || typeof source !== "object") return [];
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const context = source.context && typeof source.context === "object" ? source.context : {};
  const options = source.options && typeof source.options === "object" ? source.options : {};
  return [
    source.resolution_name,
    source.resolutionName,
    source.resolution_label,
    source.resolutionLabel,
    source.resolution,
    source.video_resolution,
    source.videoResolution,
    source.quality,
    metadata.resolution_name,
    metadata.resolutionName,
    metadata.resolution,
    metadata.video_resolution,
    metadata.hd1080_media_url,
    metadata.hdMediaUrl,
    metadata.hd_media_url,
    imagine.resolution_name,
    imagine.resolutionName,
    imagine.resolution,
    imagine.video_resolution,
    imagine.hd1080_media_url,
    imagine.hdMediaUrl,
    imagine.hd_media_url,
    meta.resolution_name,
    meta.resolutionName,
    meta.resolution,
    context.resolution_name,
    context.resolutionName,
    context.resolution,
    context.video_resolution,
    options.resolution_name,
    options.resolutionName,
    options.resolution,
    source.url,
    source.remote_url,
    source.object_url,
    source.media_url,
    source.thumbnail_url,
  ];
}

function mediaResolutionLabelForItem(item, post = null) {
  if (detailItemType(item) !== "video") return "";
  for (const source of [item, post]) {
    for (const candidate of mediaResolutionCandidates(source)) {
      const label = normalizeMediaResolutionLabel(candidate);
      if (label) return label;
    }
  }
  return mediaResolutionLabelFromDimensions(
    item?.width || item?.natural_width || item?.metadata?.width || item?.meta?.width,
    item?.height || item?.natural_height || item?.metadata?.height || item?.meta?.height,
  );
}

function setDetailMediaAspect(prefix, aspect) {
  const shell = document.querySelector(`.${prefix}_detail_media_shell`);
  if (!shell) return;
  const normalized = normalizeDetailAspectValue(aspect);
  if (normalized) {
    detailLastMediaAspect = normalized;
    shell.style.setProperty("--detail-media-aspect", normalized);
    return;
  }
}

function resetDetailMediaAspect(prefix = "") {
  detailLastMediaAspect = "";
}

function syncDetailMediaAspect(prefix, element, item = selectedDetailItem()) {
  if (!element) return;
  const width = element.videoWidth || element.naturalWidth || 0;
  const height = element.videoHeight || element.naturalHeight || 0;
  if (!width || !height) return;
  const aspect = `${width} / ${height}`;
  rememberDetailAspectForItem(item, aspect);
  setDetailMediaAspect(prefix, aspect);
}

function detailMediaNaturalSize(target, surfaceRect) {
  const width = Number(target?.videoWidth || target?.naturalWidth || 0);
  const height = Number(target?.videoHeight || target?.naturalHeight || 0);
  if (width > 0 && height > 0) return { width, height };
  return {
    width: surfaceRect.width || 1,
    height: surfaceRect.height || 1,
  };
}

function detailMediaContentRect(surface, target) {
  const surfaceRect = surface.getBoundingClientRect();
  const natural = detailMediaNaturalSize(target, surfaceRect);
  const surfaceWidth = Math.max(1, surfaceRect.width || 1);
  const surfaceHeight = Math.max(1, surfaceRect.height || 1);
  const naturalRatio = natural.width / natural.height;
  const surfaceRatio = surfaceWidth / surfaceHeight;
  let width = surfaceWidth;
  let height = surfaceHeight;
  if (naturalRatio > surfaceRatio) height = width / naturalRatio;
  else width = height * naturalRatio;
  return {
    surfaceWidth,
    surfaceHeight,
    x: (surfaceWidth - width) / 2,
    y: (surfaceHeight - height) / 2,
    width,
    height,
  };
}

function clampDetailZoomAxis(value, origin, size, surfaceSize, scale) {
  if (!Number.isFinite(value) || scale <= 1) return 0;
  const scaledOrigin = origin * scale;
  const scaledSize = size * scale;
  if (scaledSize <= surfaceSize) return ((surfaceSize - scaledSize) / 2) - scaledOrigin;
  const min = surfaceSize - scaledOrigin - scaledSize;
  const max = -scaledOrigin;
  return Math.min(max, Math.max(min, value));
}

function clampDetailZoomState(surface, target, state) {
  const rect = detailMediaContentRect(surface, target);
  state.x = clampDetailZoomAxis(state.x, rect.x, rect.width, rect.surfaceWidth, state.scale);
  state.y = clampDetailZoomAxis(state.y, rect.y, rect.height, rect.surfaceHeight, state.scale);
  return rect;
}

function applyDetailMediaZoom(target, state) {
  const scale = Number.isFinite(state.scale) ? state.scale : 1;
  if (scale <= 1.001) {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    target.style.removeProperty("transform");
    target.classList.remove("detail_media_zoomed");
    return;
  }
  target.classList.add("detail_media_zoomed");
  target.style.transform = `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
}

function syncDetailImageFullscreenState() {
  const active = document.fullscreenElement;
  document.querySelectorAll(".i_detail_media, .b_detail_media").forEach((surface) => {
    const isImageSurface = surface.classList.contains("i_detail_media_image")
      || surface.classList.contains("b_detail_media_image");
    surface.classList.toggle("detail_image_fullscreen", isImageSurface && surface === active);
  });
}

function ensureDetailImageFullscreenListener() {
  if (detailImageFullscreenListenerBound) return;
  detailImageFullscreenListenerBound = true;
  document.addEventListener("fullscreenchange", syncDetailImageFullscreenState);
}

function bindDetailImageFullscreen(surface) {
  if (!surface || surface.dataset.detailImageFullscreenBound === "true") return;
  surface.dataset.detailImageFullscreenBound = "true";
  ensureDetailImageFullscreenListener();
  surface.addEventListener("dblclick", (event) => {
    if (event.target instanceof Element && event.target.closest("button, input, textarea, select, .video-controls")) return;
    event.preventDefault();
    event.stopPropagation();
    if (document.fullscreenElement === surface) {
      document.exitFullscreen?.();
      return;
    }
    if (document.fullscreenElement) return;
    surface.requestFullscreen?.()
      .then(syncDetailImageFullscreenState)
      .catch(() => {});
  });
}

function bindDetailMediaZoom(surface, target) {
  if (!surface || !target) return;
  const previous = detailMediaZoomBindings.get(surface);
  if (previous?.target === target) return;
  previous?.controller?.abort();
  if (previous?.target) {
    previous.target.style.removeProperty("transform");
    previous.target.classList.remove("detail_media_zoom_target", "detail_media_zoomed");
  }
  const controller = new AbortController();
  detailMediaZoomBindings.set(surface, { target, controller });
  const zoomState = { scale: 1, x: 0, y: 0, dragging: false, dragX: 0, dragY: 0, dragStartX: 0, dragStartY: 0, moved: false };
  target.classList.add("detail_media_zoom_target");
  surface.addEventListener("wheel", (event) => {
    if (!event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest(".video-controls, input, button, select")) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const previousScale = zoomState.scale;
    const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!rawDelta) return;
    const step = event.deltaMode === 0 ? 0.0018 : 0.055;
    const nextScale = Math.max(1, Math.min(6, previousScale * Math.exp(-rawDelta * step)));
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const worldX = (localX - zoomState.x) / previousScale;
    const worldY = (localY - zoomState.y) / previousScale;
    zoomState.scale = nextScale;
    zoomState.x = localX - (worldX * nextScale);
    zoomState.y = localY - (worldY * nextScale);
    clampDetailZoomState(surface, target, zoomState);
    applyDetailMediaZoom(target, zoomState);
  }, { passive: false, signal: controller.signal });
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || zoomState.scale <= 1.001) return;
    if (event.target instanceof Element && event.target.closest(".video-controls, input, button, select")) return;
    event.preventDefault();
    event.stopPropagation();
    zoomState.dragging = true;
    zoomState.dragX = event.clientX;
    zoomState.dragY = event.clientY;
    zoomState.dragStartX = event.clientX;
    zoomState.dragStartY = event.clientY;
    zoomState.moved = false;
    surface.classList.add("detail_media_dragging");
    surface.setPointerCapture?.(event.pointerId);
  }, { signal: controller.signal });
  surface.addEventListener("pointermove", (event) => {
    if (!zoomState.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - zoomState.dragX;
    const dy = event.clientY - zoomState.dragY;
    zoomState.x += dx;
    zoomState.y += dy;
    zoomState.dragX = event.clientX;
    zoomState.dragY = event.clientY;
    if (Math.hypot(event.clientX - zoomState.dragStartX, event.clientY - zoomState.dragStartY) > 3) {
      zoomState.moved = true;
    }
    clampDetailZoomState(surface, target, zoomState);
    applyDetailMediaZoom(target, zoomState);
  }, { signal: controller.signal });
  const stopDrag = (event) => {
    if (!zoomState.dragging) return;
    zoomState.dragging = false;
    surface.classList.remove("detail_media_dragging");
    surface.releasePointerCapture?.(event.pointerId);
  };
  surface.addEventListener("pointerup", stopDrag, { signal: controller.signal });
  surface.addEventListener("pointercancel", stopDrag, { signal: controller.signal });
  surface.addEventListener("lostpointercapture", () => {
    zoomState.dragging = false;
    surface.classList.remove("detail_media_dragging");
  }, { signal: controller.signal });
  surface.addEventListener("click", (event) => {
    if (!zoomState.moved) return;
    zoomState.moved = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal: controller.signal });
}

function bindHoverVideoPreview(host, video) {
  if (!host || !video) return;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  host.addEventListener("mouseenter", () => {
    video.play().catch(() => {});
  });
  host.addEventListener("mouseleave", () => {
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // Browser may block seeking before metadata is loaded.
    }
  });
}

function registerCardPreviewDisposer(host, disposer) {
  if (!host || typeof disposer !== "function") return;
  const disposers = cardPreviewDisposers.get(host) || new Set();
  disposers.add(disposer);
  cardPreviewDisposers.set(host, disposers);
}

function nativeCardPreviewQueuePriority(entry) {
  const target = entry?.target;
  if (!target?.isConnected) return Number.POSITIVE_INFINITY;
  const detailThumb = target.closest?.(".i_detail_thumb, .b_detail_thumb");
  if (detailThumb?.classList.contains("active")) return -1;
  const rect = target.getBoundingClientRect?.();
  if (!rect) return 0;
  if (rect.width <= 0 && rect.height <= 0) return Number.MAX_SAFE_INTEGER;
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1);
  const visibleVertically = rect.bottom >= 0 && rect.top <= viewportHeight;
  const visibleHorizontally = rect.right >= 0 && rect.left <= viewportWidth;
  if (visibleVertically && visibleHorizontally) return 0;
  const verticalDistance = rect.top > viewportHeight ? rect.top - viewportHeight : Math.max(0, -rect.bottom);
  const horizontalDistance = rect.left > viewportWidth ? rect.left - viewportWidth : Math.max(0, -rect.right);
  return verticalDistance + horizontalDistance;
}

function pumpNativeCardPreviewQueue() {
  while (activeNativeCardPreviewTasks < CARD_PREVIEW_NATIVE_MAX_ACTIVE && nativeCardPreviewQueue.length) {
    nativeCardPreviewQueue.sort((left, right) => nativeCardPreviewQueuePriority(left) - nativeCardPreviewQueuePriority(right));
    const entry = nativeCardPreviewQueue.shift();
    if (!entry || entry.cancelled || !entry.target?.isConnected) {
      entry?.resolve?.(null);
      continue;
    }
    entry.started = true;
    activeNativeCardPreviewTasks += 1;
    Promise.resolve()
      .then(() => entry.task())
      .then((result) => entry.resolve(entry.cancelled ? null : result), entry.reject)
      .finally(() => {
        activeNativeCardPreviewTasks -= 1;
        pumpNativeCardPreviewQueue();
      });
  }
}

function scheduleNativeCardPreviewPump() {
  if (nativeCardPreviewPumpScheduled) return;
  nativeCardPreviewPumpScheduled = true;
  Promise.resolve().then(() => {
    nativeCardPreviewPumpScheduled = false;
    pumpNativeCardPreviewQueue();
  });
}

function queueCardPreviewWork(target, task) {
  if (!target || typeof task !== "function") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const entry = { target, task, resolve, reject, started: false, cancelled: false };
    const cancel = () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      if (!entry.started) {
        const queueIndex = nativeCardPreviewQueue.indexOf(entry);
        if (queueIndex >= 0) nativeCardPreviewQueue.splice(queueIndex, 1);
        resolve(null);
      }
    };
    registerCardPreviewDisposer(target, cancel);
    nativeCardPreviewQueue.push(entry);
    scheduleNativeCardPreviewPump();
  });
}

function queueNativeCardPreview(target, payload) {
  if (!target || typeof window.grokChameleonNative?.cardPreview !== "function") return Promise.resolve(null);
  return queueCardPreviewWork(target, () => window.grokChameleonNative.cardPreview(payload));
}

function releaseCardPreviewVideo(video, { remove = true } = {}) {
  if (!video) return;
  try {
    video.pause();
  } catch {
    // Ignore media elements that are not ready yet.
  }
  localCardPreviewObserver?.unobserve?.(video);
  video.removeAttribute("src");
  video.removeAttribute("poster");
  for (const source of video.querySelectorAll("source")) source.remove();
  try {
    video.load();
  } catch {
    // Ignore media elements that are already being discarded.
  }
  if (remove) video.remove();
}

function disposeCardPreviewNode(root) {
  if (!root) return;
  const elements = [root, ...(root.querySelectorAll?.("*") || [])];
  for (const element of elements) {
    const disposers = cardPreviewDisposers.get(element);
    if (disposers) {
      for (const dispose of disposers) dispose();
      disposers.clear();
      cardPreviewDisposers.delete(element);
    }
    if (element.matches?.("img.card_preview, video.card_preview")) {
      localCardPreviewObserver?.unobserve?.(element);
    }
  }
  for (const video of root.querySelectorAll?.("video") || []) releaseCardPreviewVideo(video);
  for (const image of root.querySelectorAll?.("img.card_preview") || []) {
    image.removeAttribute("src");
    image.removeAttribute("srcset");
  }
}

function bindLazyHoverVideoPreview(host, media, poster, posterUrl, videoUrl, item) {
  if (!host || !media || !poster || !videoUrl) return;
  let video = null;
  let hovered = false;
  let generation = 0;
  const hideVideo = () => {
    if (!video) return;
    video.hidden = true;
    poster.hidden = false;
  };
  const showReadyVideo = () => {
    if (!video || !hovered || video.readyState < 2) return;
    video.hidden = false;
    poster.hidden = false;
    video.play().catch(() => {});
  };
  const releaseVideo = () => {
    hovered = false;
    generation += 1;
    if (video) releaseCardPreviewVideo(video);
    video = null;
    poster.hidden = false;
  };
  registerCardPreviewDisposer(host, releaseVideo);
  host.addEventListener("mouseenter", () => {
    hovered = true;
    if (!video) {
      const currentGeneration = ++generation;
      video = document.createElement("video");
      video.className = "card_preview card_video_preview";
      video.hidden = true;
      if (posterUrl && posterUrl !== videoUrl) video.poster = posterUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = videoUrl;
      bindCardPreviewLoadState(media, video, videoUrl, cardPreviewLoadOptions(host, item, videoUrl));
      const reveal = () => {
        if (currentGeneration !== generation) return;
        showReadyVideo();
      };
      video.addEventListener("loadeddata", reveal);
      video.addEventListener("canplay", reveal);
      media.append(video);
      if (posterUrl && item?.card_local_preview) {
        scheduleLocalCardVideoPoster(video, posterUrl, videoUrl, cardPreviewStableIdentity(item));
      }
    }
    showReadyVideo();
  });
  host.addEventListener("mouseleave", () => {
    hovered = false;
    if (!video) return;
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // Browser may block seeking before metadata is loaded.
    }
    hideVideo();
  });
}

function cardPreviewRetryUrl(url, attempt) {
  const key = String(url || "");
  if (!key || /^(?:blob|data):/i.test(key)) return key;
  try {
    const parsed = new URL(key, window.location.origin);
    parsed.searchParams.set("_card_retry", String(attempt));
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    const separator = key.includes("?") ? "&" : "?";
    return `${key}${separator}_card_retry=${attempt}`;
  }
}

function isImagineRemotePreviewUrl(url) {
  const value = String(url || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname === "/api/imagine/remote/media";
  } catch {
    return false;
  }
}

function imaginePreviewUrlKey(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    parsed.searchParams.delete("_card_retry");
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}`
      : parsed.toString();
  } catch {
    return value.replace(/([?&])_card_retry=[^&]*(&|$)/, (match, prefix, suffix) => (
      suffix ? prefix : ""
    ));
  }
}

function imagineItemUsesPreviewUrl(item, url) {
  const target = imaginePreviewUrlKey(url);
  if (!target || !item) return false;
  const candidates = [
    item.object_url,
    item.url,
    item.remote_url,
    item.thumbnail_url,
    item.poster_url,
    typeof mediaPreviewUrl === "function" ? mediaPreviewUrl(item) : "",
    typeof videoPreviewUrl === "function" ? videoPreviewUrl(item) : "",
  ];
  return candidates.some((candidate) => imaginePreviewUrlKey(candidate) === target);
}

function removeUnavailableImagineItem(postPath, url, host = null) {
  const path = String(postPath || "").trim();
  if (!path || typeof library_state !== "object" || !library_state) return false;
  let changed = false;
  let keptPost = null;
  const removedSelectedPost = String(library_state.selectedPostPath || "") === path;
  for (const stateKey of [
    "imagineRemotePosts",
    "imagineDiscoverPosts",
    "imagineUnsavedPosts",
    "imagineSearchPosts",
  ]) {
    if (!Array.isArray(library_state[stateKey])) continue;
    library_state[stateKey] = library_state[stateKey].flatMap((post) => {
      if (String(post?.folder_path || "") !== path) return [post];
      const items = Array.isArray(post?.items) ? post.items : [];
      const remaining = items.filter((item) => {
        if (!imagineItemUsesPreviewUrl(item, url)) return true;
        return false;
      });
      if (remaining.length === items.length) return [post];
      changed = true;
      if (!remaining.length) return [];
      const representative = representativeItem(remaining, { ...post, items: remaining }) || remaining[0];
      const nextPost = normalizeServerPost({
        ...post,
        items: remaining,
        representative: representative?.file || representative?.url || representative?.item_id || "",
        representative_item: representative,
      });
      keptPost = nextPost;
      return [nextPost];
    });
  }
  if (!changed) return false;
  if (!keptPost) {
    library_state.sessionImagineT2iPaths?.delete?.(path);
    library_state.selectedItems?.delete?.(path);
    if (String(library_state.selectedPostPath || "") === path) {
      library_state.selectedPostPath = "";
      library_state.selectedDetailItemId = "";
    }
  } else if (
    String(library_state.selectedPostPath || "") === path
    && !keptPost.items.some((item) => mediaItemKey(item) === String(library_state.selectedDetailItemId || ""))
  ) {
    library_state.selectedDetailItemId = mediaItemKey(keptPost.representative_item || keptPost.items[0]);
  }
  if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
  host?.remove?.();
  window.setTimeout(() => {
    if (
      removedSelectedPost
      && !keptPost
      && typeof screen_state === "object"
      && screen_state?.current_screen === "i_detail"
      && typeof openScreen === "function"
    ) {
      const backTarget = typeof detailBackTarget === "function" ? detailBackTarget("imagine") : null;
      openScreen(
        backTarget?.screenId || "i_main",
        backTarget?.activeButtonId || screen_state.current_i_nav_btn || "i_imagine_nav_btn",
      );
      return;
    }
    if (typeof screen_state === "object" && screen_state?.current_screen === "search_main") {
      if (typeof renderSearchResults === "function") renderSearchResults();
      return;
    }
    if (/^imagine_discover\//.test(path)) {
      if (typeof renderImagineDiscoverCards === "function") renderImagineDiscoverCards();
      return;
    }
    if (/^imagine_unsaved\//.test(path)) {
      if (typeof renderImagineSourceCards === "function") renderImagineSourceCards();
      return;
    }
    if (typeof renderImagineSourceCards === "function") renderImagineSourceCards();
  }, 0);
  return true;
}

function missingImagineAssetIdentity(item, url) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const candidates = [
    item?.asset_id,
    metadata.asset_id,
    imagine.asset_id,
    item?.item_id,
    item?.post_id,
    url,
  ];
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let assetId = "";
  for (const candidate of candidates) {
    const match = String(candidate || "").match(uuidPattern);
    if (match) {
      assetId = match[0];
      break;
    }
  }
  const accountId = String(
    item?.account_id
    || metadata.account_id
    || imagine.account_id
    || "",
  ).trim();
  return { assetId, accountId };
}

function handleUnavailableImagineCardPreview(host, item, url, postPath) {
  const key = String(url || "").trim();
  const path = String(postPath || "").trim();
  if (!path || !isImagineRemotePreviewUrl(key)) return Promise.resolve(false);
  if (missingImagineCardPreviewChecks.has(key)) return missingImagineCardPreviewChecks.get(key);
  const check = fetch(cardPreviewRetryUrl(key, `missing-${Date.now()}`), {
    method: "HEAD",
    cache: "no-store",
  }).then((response) => {
    const status = Number(response.status);
    if (![404, 410].includes(status)) return false;
    const { assetId, accountId } = missingImagineAssetIdentity(item, key);
    const cleanup = assetId
      ? qApi("/api/imagine/asset/missing", {
        asset_id: assetId,
        account_id: accountId,
        status,
      }).catch(() => null)
      : Promise.resolve(null);
    return cleanup.then(() => removeUnavailableImagineItem(path, key, host));
  }).catch(() => false).finally(() => {
    missingImagineCardPreviewChecks.delete(key);
  });
  missingImagineCardPreviewChecks.set(key, check);
  return check;
}

function cardPreviewLoadOptions(host, item, url) {
  const postPath = String(item?.card_remote_post_path || "").trim();
  return {
    retries: item?.card_preview_retries,
    onUnavailable: postPath
      ? () => handleUnavailableImagineCardPreview(host, item, url, postPath)
      : null,
  };
}

async function sha256Text(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return "";
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cardPreviewStableIdentity(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
  const accountId = String(item?.account_id || metadata.account_id || imagine.account_id || "").trim();
  const assetId = String(
    item?.asset_id
    || metadata.asset_id
    || imagine.asset_id
    || item?.item_id
    || item?.post_id
    || imagine.post_id
    || "",
  ).trim();
  const mediaType = String(item?.type || item?.mime_type || item?.mime || "").trim().toLowerCase();
  const imageVariant = mediaType === "image" || mediaType.startsWith("image/")
    ? ":image-original-v2"
    : "";
  return assetId ? `${accountId}:${assetId}${imageVariant}` : "";
}

async function lookupPersistentCardPreview(rawUrl, kind = "card", cacheIdentity = "") {
  try {
    const parsed = new URL(String(rawUrl || ""), location.origin);
    if (parsed.origin !== location.origin) return "";
    const previewKind = String(kind || "").toLowerCase() === "thumbnail" ? "thumbnail" : "card";
    if (parsed.pathname === "/api/imagine/remote/media") {
      const stableIdentity = String(cacheIdentity || "").trim();
      const keySources = stableIdentity
        ? [
          `remote\0${previewKind}\0identity\0${stableIdentity}`,
          `remote\0${previewKind}\0${parsed.pathname}${parsed.search}`,
        ]
        : [`remote\0${previewKind}\0${parsed.pathname}${parsed.search}`];
      for (const keySource of keySources) {
        const key = await sha256Text(keySource);
        if (!key) continue;
        const previewUrl = `/api/card-preview?key=${key}`;
        const response = await fetch(previewUrl, { method: "HEAD", cache: "force-cache" });
        if (response.ok) return previewUrl;
      }
      return "";
    }
    if (parsed.pathname !== "/api/media") return "";
    const mediaPath = String(parsed.searchParams.get("path") || "").replace(/^\/+/, "");
    if (!/^(created|collection)\//.test(mediaPath)) return "";
    const version = String(parsed.searchParams.get("v") || "");
    const match = version.match(/^([a-f0-9]+)-([a-f0-9]+)$/i);
    if (!match) return "";
    const modifiedNs = BigInt(`0x${match[1]}`).toString(10);
    const size = BigInt(`0x${match[2]}`).toString(10);
    const key = await sha256Text(`${mediaPath}\0${modifiedNs}\0${size}`);
    if (!key) return "";
    const previewUrl = `/api/build-preview?kind=${previewKind}&key=${key}`;
    const response = await fetch(previewUrl, { method: "HEAD", cache: "force-cache" });
    return response.ok ? previewUrl : "";
  } catch (_) {
    return "";
  }
}

async function existingPersistentCardPreview(rawUrl, kind = "card", cacheIdentity = "") {
  const lookupKey = `${kind}\0${cacheIdentity}\0${rawUrl}`;
  if (persistentCardPreviewLookupCache.has(lookupKey)) {
    return persistentCardPreviewLookupCache.get(lookupKey);
  }
  const lookup = lookupPersistentCardPreview(rawUrl, kind, cacheIdentity);
  persistentCardPreviewLookupCache.set(lookupKey, lookup);
  const result = await lookup;
  if (!result) {
    persistentCardPreviewLookupCache.delete(lookupKey);
  } else if (persistentCardPreviewLookupCache.size > 5000) {
    persistentCardPreviewLookupCache.delete(persistentCardPreviewLookupCache.keys().next().value);
  }
  return result;
}

function isImagineRemoteCardPreview(url) {
  try {
    const parsed = new URL(String(url || ""), location.origin);
    return parsed.origin === location.origin && parsed.pathname === "/api/imagine/remote/media";
  } catch (_) {
    return false;
  }
}

function resolveLocalCardPreview(url, kind = "card", cacheIdentity = "") {
  const target = arguments[3] || null;
  const key = String(url || "");
  if (!key) return Promise.resolve("");
  const nativePreview = window.grokChameleonNative?.cardPreview;
  const resolve = () => existingPersistentCardPreview(key, kind, cacheIdentity).then((existingPreview) => {
    if (existingPreview) return existingPreview;
    if (typeof nativePreview !== "function") return key;
    return nativePreview({ url: key, kind, cache_identity: cacheIdentity })
      .then((result) => String(result?.url || (target && !target.isConnected ? "" : key)))
      .catch(() => key);
  });
  return target ? queueCardPreviewWork(target, resolve) : resolve();
}

function scheduleLocalCardPreview(preview, url, kind = "card", cacheIdentity = "") {
  if (!preview || !url) return;
  preview.cardPreviewLoad = () => {
    if (preview.dataset.cardPreviewStarted === "true") return;
    preview.dataset.cardPreviewStarted = "true";
    if (isImagineRemoteCardPreview(url)) {
      existingPersistentCardPreview(url, kind, cacheIdentity).then((existingPreview) => {
        if (!preview.isConnected) return;
        if (existingPreview) {
          preview.src = existingPreview;
          return;
        }
        const nativePreview = window.grokChameleonNative?.cardPreview;
        if (typeof nativePreview !== "function") {
          preview.src = url;
          return;
        }
        queueNativeCardPreview(preview, { url, kind, cache_identity: cacheIdentity }).then((result) => {
          if (!result) return;
          const cachedUrl = String(result?.url || "");
          if (preview.isConnected) preview.src = cachedUrl || url;
        }).catch(() => {
          if (preview.isConnected) preview.src = url;
        });
      }).catch(() => {
        if (preview.isConnected) preview.src = url;
      });
      return;
    }
    resolveLocalCardPreview(url, kind, cacheIdentity, preview).then((resolvedUrl) => {
      if (preview.isConnected && resolvedUrl) preview.src = resolvedUrl;
    });
  };
  if (localCardPreviewObserver) localCardPreviewObserver.observe(preview);
  else preview.cardPreviewLoad();
}

function scheduleLocalCardVideoPoster(preview, previewUrl, videoUrl, cacheIdentity = "") {
  if (!preview || !previewUrl) return;
  preview.cardPreviewLoad = () => {
    if (preview.dataset.cardPreviewStarted === "true") return;
    preview.dataset.cardPreviewStarted = "true";
    resolveLocalCardPreview(previewUrl, "card", cacheIdentity, preview).then((resolvedUrl) => {
      if (preview.isConnected && resolvedUrl && resolvedUrl !== videoUrl) preview.poster = resolvedUrl;
    });
  };
  if (localCardPreviewObserver) localCardPreviewObserver.observe(preview);
  else preview.cardPreviewLoad();
}

function bindCardPreviewLoadState(media, preview, url, options = {}) {
  const key = String(url || "");
  if (!media || !preview || !key) return;
  const parsedRetries = Number.parseInt(String(options.retries ?? 2), 10);
  const maxRetries = Number.isFinite(parsedRetries) ? Math.max(0, Math.min(2, parsedRetries)) : 2;
  let retryCount = 0;
  let retryPending = false;
  let terminalPending = false;
  preview.dataset.cardPreviewUrl = key;
  const markLoaded = () => {
    media.classList.remove("card_media_failed");
    media.classList.add("card_media_loaded");
    preview.classList.add("card_preview_loaded");
  };
  const retryPreview = () => {
    if (retryPending) return;
    if (retryCount >= maxRetries) {
      if (terminalPending) return;
      terminalPending = true;
      const unavailableHandler = typeof options.onUnavailable === "function" ? options.onUnavailable : null;
      if (!unavailableHandler) {
        media.classList.add("card_media_failed");
        return;
      }
      Promise.resolve(unavailableHandler()).then((handled) => {
        if (!handled && media.isConnected) media.classList.add("card_media_failed");
      }).catch(() => {
        if (media.isConnected) media.classList.add("card_media_failed");
      });
      return;
    }
    retryCount += 1;
    retryPending = true;
    window.setTimeout(() => {
      retryPending = false;
      if (!preview.isConnected) return;
      const retryUrl = cardPreviewRetryUrl(key, retryCount);
      if (preview.tagName === "IMG") {
        preview.src = retryUrl;
      } else {
        preview.src = retryUrl;
        preview.load();
      }
    }, 180 * retryCount);
  };
  if (preview.tagName === "IMG") {
    if (!preview.hasAttribute("loading")) preview.loading = "eager";
    preview.decoding = "async";
    if (preview.complete && preview.naturalWidth > 0) markLoaded();
    preview.addEventListener("load", markLoaded);
    preview.addEventListener("error", retryPreview);
  } else {
    if (!preview.preload || preview.preload === "none") preview.preload = "metadata";
    const hasPoster = Boolean(preview.getAttribute("poster"));
    const loadedEnough = hasPoster ? preview.readyState >= 1 : preview.readyState >= 2;
    if (loadedEnough) markLoaded();
    else {
      if (hasPoster) preview.addEventListener("loadedmetadata", markLoaded, { once: true });
      else {
        preview.addEventListener("loadedmetadata", () => {
          try {
            if (Number.isFinite(preview.duration) && preview.duration > 0 && preview.currentTime < 0.04) {
              preview.currentTime = Math.min(0.05, Math.max(0, preview.duration - 0.01));
            }
          } catch {
            // Some video sources cannot seek before data is ready.
          }
        }, { once: true });
      }
      preview.addEventListener("loadeddata", markLoaded);
      preview.addEventListener("canplay", markLoaded);
    }
    preview.addEventListener("error", retryPreview);
  }
}

function appendCardImagePreview(host, media, preview, previewUrl, item) {
  bindCardPreviewLoadState(media, preview, previewUrl, cardPreviewLoadOptions(host, item, previewUrl));
  media.append(preview);
  if (item?.card_local_preview) {
    scheduleLocalCardPreview(preview, previewUrl, "card", cardPreviewStableIdentity(item));
  }
  else preview.src = previewUrl;
}

function appendMediaPreview(host, media, item, type) {
  if (item?.moderated || String(item?.status || "").toLowerCase() === "moderated" || item?.metadata?.moderated || item?.metadata?.imagine?.moderated) {
    media.classList.add("has_moderated_preview");
    const failedPreview = document.createElement("div");
    failedPreview.className = "text2image_moderated_preview";
    failedPreview.innerHTML = `<span class="text2image_moderated_label">Moderated</span>`;
    media.append(failedPreview);
    return;
  }
  const previewUrl = mediaPreviewUrl({ ...item, type });
  const videoUrl = videoPreviewUrl({ ...item, type });
  if (videoUrl && previewUrl && item?.card_static_video_preview) {
    media.classList.add("has_preview", "has_video_preview");
    const preview = document.createElement("img");
    preview.className = "card_preview card_video_preview";
    preview.alt = "";
    preview.loading = item?.card_lazy_preview ? "lazy" : "eager";
    preview.decoding = "async";
    appendCardImagePreview(host, media, preview, previewUrl, item);
    bindLazyHoverVideoPreview(host, media, preview, previewUrl, videoUrl, item);
    return;
  }
  if (videoUrl) {
    media.classList.add("has_preview", "has_video_preview");
    const preview = document.createElement("video");
    preview.className = "card_preview card_video_preview";
    preview.src = videoUrl;
    if (previewUrl && previewUrl !== videoUrl) preview.poster = previewUrl;
    preview.muted = true;
    preview.playsInline = true;
    preview.preload = previewUrl ? "metadata" : "auto";
    bindCardPreviewLoadState(media, preview, videoUrl, cardPreviewLoadOptions(host, item, videoUrl));
    media.append(preview);
    if (previewUrl && item?.card_local_preview) {
      scheduleLocalCardVideoPoster(preview, previewUrl, videoUrl, cardPreviewStableIdentity(item));
    }
    bindHoverVideoPreview(host, preview);
    return;
  }
  if (previewUrl) {
    media.classList.add("has_preview");
    const preview = document.createElement("img");
    preview.className = "card_preview";
    preview.alt = "";
    preview.loading = item?.card_lazy_preview ? "lazy" : "eager";
    preview.decoding = "async";
    appendCardImagePreview(host, media, preview, previewUrl, item);
    return;
  }
}
