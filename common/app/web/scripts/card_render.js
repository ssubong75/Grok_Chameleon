// Shared media card rendering

function stopVisualCardAction(event) {
  event.preventDefault();
  event.stopPropagation();
}

function cardBackTargetKey(backTargetOverride = null) {
  if (!backTargetOverride) return "";
  return `${backTargetOverride.screenId || ""}:${backTargetOverride.activeButtonId || ""}`;
}

function cardRenderKeyForPost(post, className, backTargetOverride = null) {
  return [
    className || "card",
    cardBackTargetKey(backTargetOverride),
    post?.folder_path || post?.post_id || post?.id || "",
  ].join("|");
}

function cardUsesImagineDetail(post, className = "") {
  return className === "i_card"
    || Boolean(post?.remote)
    || post?.area === "imagine_remote"
    || post?.area === "imagine_upload_remote";
}

function buildCardVideoPosterUrl(post, item) {
  if (item?.thumbnail_url || item?.poster_url) return item.thumbnail_url || item.poster_url;
  const image = (post?.items || []).find((candidate) => detailItemType(candidate) === "image");
  if (!image) return "";
  return bDetailPreviewUrl(image) || bDetailMediaUrl(image) || mediaPreviewUrl(image);
}

function cardDisplayItemForContext(post, item, className = "") {
  if (cardUsesImagineDetail(post, className)) {
    const sourceItem = item || {};
    const type = detailItemType(sourceItem);
    const previewUrl = sourceItem.thumbnail_url || sourceItem.poster_url || "";
    return {
      ...sourceItem,
      card_lazy_preview: true,
      card_local_preview: true,
      card_preview_retries: 2,
      card_static_video_preview: type === "video" && Boolean(previewUrl),
    };
  }
  const localItem = typeof bLocalMediaItem === "function" ? bLocalMediaItem(item) : item;
  const cardItem = {
    ...(localItem || {}),
    card_lazy_preview: true,
    card_local_preview: true,
    card_preview_retries: 2,
  };
  if (detailItemType(cardItem) !== "video") return cardItem;
  const posterUrl = buildCardVideoPosterUrl(post, cardItem) || bDetailVideoPreviewUrl(cardItem);
  if (!posterUrl) return cardItem;
  return {
    ...cardItem,
    thumbnail_url: cardItem.thumbnail_url || posterUrl,
    poster_url: cardItem.poster_url || posterUrl,
  };
}

function cardAttachedBuildJob(post, className = "") {
  if (className === "b_card" && typeof buildJobsForPost === "function") {
    return buildJobsForPost(post)[0] || null;
  }
  if (className === "i_card" && typeof imagineJobsForPost === "function") {
    return imagineJobsForPost(post)[0] || null;
  }
  return null;
}

function cardRenderHashForPost(post, className, backTargetOverride = null) {
  const rawRepresentative = representativeItem(post?.items || [], post) || post?.representative_item || post?.items?.[0] || {};
  const representative = cardDisplayItemForContext(post, rawRepresentative, className) || {};
  const attachedJob = cardAttachedBuildJob(post, className);
  const attachedPreview = attachedJob && typeof generationJobPreviewInfo === "function"
    ? generationJobPreviewInfo(attachedJob, post)
    : null;
  const attachedPreviewUrl = String(attachedPreview?.url || "");
  const type = representative.type || "image";
  const saved = typeof imaginePostLiked === "function" ? imaginePostLiked(post) : Boolean(post?.liked || post?.favorite);
  const buildFavorite = typeof postBuildFavorite === "function" ? postBuildFavorite(post) : Boolean(post?.build_favorite);
  return [
    className || "card",
    cardBackTargetKey(backTargetOverride),
    post?.folder_path || "",
    post?.post_id || "",
    post?.title || "",
    post?.area || "",
    post?.mode || "",
    post?.remote ? "remote" : "local",
    saved ? "saved" : "",
    buildFavorite ? "build_favorite" : "",
    typeof postHasLucky === "function" && postHasLucky(post, representative) ? "lucky" : "",
    type,
    mediaPreviewUrl({ ...representative, type }),
    videoPreviewUrl({ ...representative, type }),
    typeof mediaResolutionLabelForItem === "function" ? mediaResolutionLabelForItem(representative, post) : "",
    attachedJob?.id || "",
    attachedJob ? buildJobStatus(attachedJob) : "",
    attachedJob ? buildJobProgress(attachedJob) : "",
    attachedJob?.error || "",
    attachedPreviewUrl,
    attachedPreview?.type || "",
  ].map((value) => String(value || "")).join("\u001f");
}

function applyStableCardRenderData(card, key, hash) {
  if (!card || !key) return card;
  card.dataset.cardRenderKey = key;
  card.dataset.cardRenderHash = hash || "";
  return card;
}

function cardRenderSpecForPost(post, className, backTargetOverride = null) {
  return {
    cardRenderKey: cardRenderKeyForPost(post, className, backTargetOverride),
    cardRenderHash: cardRenderHashForPost(post, className, backTargetOverride),
    createCard: () => mediaCardForPost(post, className, backTargetOverride),
  };
}

function virtualCardRenderSpecForPost(post, className, backTargetOverride = null) {
  return {
    cardRenderKey: cardRenderKeyForPost(post, className, backTargetOverride),
    get cardRenderHash() {
      return cardRenderHashForPost(post, className, backTargetOverride);
    },
    createCard: () => mediaCardForPost(post, className, backTargetOverride),
  };
}

function replaceCardListChildren(list, entries) {
  if (!list) return;
  const existing = new Map();
  for (const child of list.children) {
    const key = child?.dataset?.cardRenderKey || "";
    if (key && !existing.has(key)) existing.set(key, child);
  }
  const nextNodes = entries.map((entry) => {
    const key = entry?.cardRenderKey || entry?.dataset?.cardRenderKey || "";
    const hash = entry?.cardRenderHash || entry?.dataset?.cardRenderHash || "";
    const current = key ? existing.get(key) : null;
    if (current && current.dataset.cardRenderHash === hash) return current;
    return typeof entry?.createCard === "function" ? entry.createCard() : entry;
  }).filter(Boolean);
  const nextNodeSet = new Set(nextNodes);
  for (const child of Array.from(list.childNodes)) {
    if (!nextNodeSet.has(child)) child.remove();
  }
  let referenceNode = list.firstChild;
  for (const node of nextNodes) {
    if (node === referenceNode) {
      referenceNode = referenceNode.nextSibling;
      continue;
    }
    list.insertBefore(node, referenceNode);
  }
}

function virtualCardCacheKey(entry) {
  const key = String(entry?.cardRenderKey || entry?.dataset?.cardRenderKey || "");
  return key.startsWith("virtual-spacer:") || key.startsWith("virtual-loading:") ? "" : key;
}

function pauseVirtualCardMedia(node) {
  if (!node?.querySelectorAll) return;
  for (const video of node.querySelectorAll("video")) {
    try {
      video.pause();
    } catch {
      // Ignore media elements that are not ready yet.
    }
  }
}

function replaceVirtualCardListChildren(list, entries, nodeCache) {
  if (!list) return;
  const existing = new Map();
  for (const child of list.children) {
    const key = child?.dataset?.cardRenderKey || "";
    if (key && !existing.has(key)) existing.set(key, child);
  }
  const nextNodes = entries.map((entry) => {
    const key = entry?.cardRenderKey || entry?.dataset?.cardRenderKey || "";
    const hash = entry?.cardRenderHash || entry?.dataset?.cardRenderHash || "";
    const cacheKey = virtualCardCacheKey(entry);
    const current = key ? existing.get(key) || nodeCache?.get(cacheKey) : null;
    const node = current && current.dataset.cardRenderHash === hash
      ? current
      : (typeof entry?.createCard === "function" ? entry.createCard() : entry);
    if (cacheKey && node) nodeCache?.set(cacheKey, node);
    return node;
  }).filter(Boolean);
  let referenceNode = list.firstChild;
  for (const node of nextNodes) {
    if (node === referenceNode) {
      referenceNode = referenceNode.nextSibling;
      continue;
    }
    list.insertBefore(node, referenceNode);
  }
  const nextNodeSet = new Set(nextNodes);
  for (const child of Array.from(list.childNodes)) {
    if (!nextNodeSet.has(child)) {
      pauseVirtualCardMedia(child);
      child.remove();
    }
  }
  if (typeof syncCardSelectionControls === "function") syncCardSelectionControls();
}

const VIRTUAL_CARD_OVERSCAN_SCREENS = 2;
const virtualCardListStates = new Map();
const virtualCardListBindings = new Map();
let virtualCardWindowEventsBound = false;

function virtualCardWindow(totalItems, columns, rowHeight, gap, scrollOffset, viewportHeight) {
  const itemCount = Math.max(0, Number(totalItems) || 0);
  const columnCount = Math.max(1, Math.floor(Number(columns) || 1));
  const cardHeight = Math.max(1, Number(rowHeight) || 400);
  const rowGap = Math.max(0, Number(gap) || 0);
  const totalRows = Math.ceil(itemCount / columnCount);
  if (!totalRows) {
    return {
      totalRows: 0,
      totalHeight: 0,
      startRow: 0,
      endRow: 0,
      startIndex: 0,
      endIndex: 0,
      topRows: 0,
      bottomRows: 0,
      topHeight: 0,
      bottomHeight: 0,
    };
  }
  const rowStep = cardHeight + rowGap;
  const totalHeight = totalRows * cardHeight + Math.max(0, totalRows - 1) * rowGap;
  const viewHeight = Math.max(1, Number(viewportHeight) || cardHeight);
  const maxOffset = Math.max(0, totalHeight - viewHeight);
  const offset = Math.max(0, Math.min(Number(scrollOffset) || 0, maxOffset));
  const firstVisibleRow = Math.min(totalRows - 1, Math.floor(offset / rowStep));
  const visibleRows = Math.max(1, Math.ceil(viewHeight / rowStep) + 1);
  const overscanRows = Math.max(4, visibleRows * VIRTUAL_CARD_OVERSCAN_SCREENS);
  const startRow = Math.max(0, firstVisibleRow - overscanRows);
  const endRow = Math.min(totalRows, firstVisibleRow + visibleRows + overscanRows);
  const topRows = startRow;
  const bottomRows = Math.max(0, totalRows - endRow);
  const spacerHeight = (rows) => rows > 0 ? rows * cardHeight + Math.max(0, rows - 1) * rowGap : 0;
  return {
    totalRows,
    totalHeight,
    startRow,
    endRow,
    startIndex: startRow * columnCount,
    endIndex: Math.min(itemCount, endRow * columnCount),
    topRows,
    bottomRows,
    topHeight: spacerHeight(topRows),
    bottomHeight: spacerHeight(bottomRows),
  };
}

function virtualCardListUsesDocumentScroll() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 720px)").matches;
}

function virtualCardGridColumnCount(list) {
  const value = String(getComputedStyle(list).gridTemplateColumns || "").trim();
  const repeated = value.match(/^repeat\(\s*(\d+)\s*,/i);
  if (repeated) return Math.max(1, Number.parseInt(repeated[1], 10) || 1);
  return Math.max(1, value.split(/\s+/).filter(Boolean).length);
}

function virtualCardGridRowHeight(list) {
  const existing = list.querySelector(":scope > .card");
  const existingHeight = existing?.getBoundingClientRect?.().height || 0;
  if (existingHeight > 0) return existingHeight;
  const probe = document.createElement("article");
  probe.className = "card virtual_card_measure";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  list.append(probe);
  const height = probe.getBoundingClientRect().height || Number.parseFloat(getComputedStyle(probe).height) || 400;
  probe.remove();
  return height;
}

function virtualCardListViewport(list) {
  if (virtualCardListUsesDocumentScroll()) {
    const rect = list.getBoundingClientRect();
    return {
      offset: Math.max(0, -rect.top),
      height: Math.max(1, Math.min(window.innerHeight || rect.height || 1, rect.height || window.innerHeight || 1)),
    };
  }
  return {
    offset: Math.max(0, list.scrollTop || 0),
    height: Math.max(1, list.clientHeight || window.innerHeight || 1),
  };
}

function virtualCardEntryKey(entry, index) {
  return String(entry?.cardRenderKey || entry?.dataset?.cardRenderKey || `virtual-entry-${index}`);
}

function virtualCardEntryHash(entry) {
  return String(entry?.cardRenderHash || entry?.dataset?.cardRenderHash || "");
}

function virtualCardSpacerEntry(listKey, edge, height) {
  const safeHeight = Math.max(0, Number(height) || 0);
  const key = `virtual-spacer:${listKey}:${edge}`;
  const hash = String(Math.round(safeHeight * 100) / 100);
  return {
    cardRenderKey: key,
    cardRenderHash: hash,
    createCard() {
      const spacer = document.createElement("div");
      spacer.className = `virtual_card_spacer virtual_card_${edge}_spacer`;
      spacer.style.height = `${safeHeight}px`;
      spacer.setAttribute("aria-hidden", "true");
      return applyStableCardRenderData(spacer, key, hash);
    },
  };
}

function virtualCardLoadingEntry(listKey) {
  const key = `virtual-loading:${listKey}`;
  return {
    cardRenderKey: key,
    cardRenderHash: "loading",
    createCard() {
      const loading = emptyLibraryNode("Loading . . .");
      loading.classList.add("discover_loading_more", "virtual_card_loading");
      return applyStableCardRenderData(loading, key, "loading");
    },
  };
}

function prepareVirtualRemoteCardImages(list) {
  for (const image of list.querySelectorAll(".remote_card img.card_preview")) {
    const reveal = () => {
      const decoded = typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
      decoded.then(() => {
        if (image.isConnected && image.naturalWidth > 0) image.classList.add("remote_preview_decoded");
      });
    };
    if (image.complete && image.naturalWidth > 0) {
      reveal();
      continue;
    }
    if (image.dataset.remotePreviewDecodeBound === "true") continue;
    image.dataset.remotePreviewDecodeBound = "true";
    image.addEventListener("load", reveal, { once: true });
  }
}

function renderVirtualCardList(listKey, list, entries, options = {}) {
  if (!list) return;
  const state = virtualCardListStates.get(listKey) || { frame: 0, renderToken: "" };
  if (!(state.nodeCache instanceof Map)) state.nodeCache = new Map();
  state.list = list;
  state.entries = (entries || []).filter(Boolean);
  state.options = { loading: Boolean(options.loading), remoteMedia: Boolean(options.remoteMedia) };
  state.enabled = true;
  virtualCardListStates.set(listKey, state);
  list.classList.add("virtual_card_list");
  list.classList.toggle("remote_virtual_card_list", state.options.remoteMedia);
  if (list.closest("[hidden]")) return;

  const validCacheKeys = new Set(state.entries.map(virtualCardCacheKey).filter(Boolean));
  for (const key of state.nodeCache.keys()) {
    if (!validCacheKeys.has(key)) state.nodeCache.delete(key);
  }
  const styles = getComputedStyle(list);
  const columns = virtualCardGridColumnCount(list);
  const rowHeight = virtualCardGridRowHeight(list);
  const gap = Number.parseFloat(styles.rowGap) || 0;
  const viewport = virtualCardListViewport(list);
  const range = virtualCardWindow(state.entries.length, columns, rowHeight, gap, viewport.offset, viewport.height);
  const visibleEntries = state.entries.slice(range.startIndex, range.endIndex);
  const signature = visibleEntries.map((entry, index) => (
    `${virtualCardEntryKey(entry, range.startIndex + index)}:${virtualCardEntryHash(entry)}`
  )).join("\u001e");
  const renderToken = [
    state.entries.length,
    columns,
    rowHeight,
    gap,
    range.startRow,
    range.endRow,
    range.topHeight,
    range.bottomHeight,
    state.options.loading ? "loading" : "ready",
    signature,
  ].join("\u001f");

  if (state.renderToken !== renderToken) {
    const nextEntries = [];
    if (range.topRows) nextEntries.push(virtualCardSpacerEntry(listKey, "top", range.topHeight));
    nextEntries.push(...visibleEntries);
    if (range.bottomRows) nextEntries.push(virtualCardSpacerEntry(listKey, "bottom", range.bottomHeight));
    if (state.options.loading) nextEntries.push(virtualCardLoadingEntry(listKey));
    replaceVirtualCardListChildren(list, nextEntries, state.nodeCache);
    state.renderToken = renderToken;
  }
  if (state.options.remoteMedia) prepareVirtualRemoteCardImages(list);
}

function disableVirtualCardList(listKey, list) {
  const state = virtualCardListStates.get(listKey);
  if (state) {
    state.enabled = false;
    state.entries = [];
    state.renderToken = "";
    if (state.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.frame);
    state.frame = 0;
    for (const node of state.nodeCache?.values?.() || []) pauseVirtualCardMedia(node);
    state.nodeCache?.clear?.();
  }
  list?.classList.remove("virtual_card_list", "remote_virtual_card_list");
}

function scheduleVirtualCardList(listKey) {
  const state = virtualCardListStates.get(listKey);
  if (!state?.enabled || state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    renderVirtualCardList(listKey, state.list, state.entries, state.options);
  });
}

function scheduleScreenVirtualCardList(screenId) {
  const listKey = {
    b_main: "build-main",
    i_main: "imagine-main",
    i_discover_main: "imagine-discover",
    i_unsaved_main: "imagine-unsaved",
    "2nd_main": "collection-second-main",
  }[screenId];
  if (!listKey) return;
  requestAnimationFrame(() => scheduleVirtualCardList(listKey));
}

function virtualCardListRemaining(list) {
  if (!list) return Number.POSITIVE_INFINITY;
  if (virtualCardListUsesDocumentScroll()) {
    return list.getBoundingClientRect().bottom - (window.innerHeight || 0);
  }
  return list.scrollHeight - list.scrollTop - list.clientHeight;
}

function runVirtualCardListScrollBinding(listKey) {
  const binding = virtualCardListBindings.get(listKey);
  if (!binding || binding.list.closest("[hidden]")) return;
  scheduleVirtualCardList(listKey);
  binding.onScroll?.();
}

function bindVirtualCardListScroll(listKey, list, onScroll = null) {
  if (!list || virtualCardListBindings.has(listKey)) return;
  const handler = () => runVirtualCardListScrollBinding(listKey);
  virtualCardListBindings.set(listKey, { list, onScroll, handler });
  list.addEventListener("scroll", handler, { passive: true });
  if (virtualCardWindowEventsBound || typeof window === "undefined") return;
  virtualCardWindowEventsBound = true;
  window.addEventListener("scroll", () => {
    if (!virtualCardListUsesDocumentScroll()) return;
    for (const key of virtualCardListBindings.keys()) runVirtualCardListScrollBinding(key);
  }, { passive: true });
  window.addEventListener("resize", () => {
    for (const [key, state] of virtualCardListStates.entries()) {
      state.renderToken = "";
      scheduleVirtualCardList(key);
    }
  }, { passive: true });
}

function cardVisualSelectButton(post) {
  const selected = library_state.selectedItems.has(post.folder_path || "");
  const button = document.createElement("button");
  button.className = "card_visual_select_btn item-select media-card-select-button";
  button.type = "button";
  button.dataset.libraryPostPath = post.folder_path || "";
  button.setAttribute("aria-label", "Select");
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  button.innerHTML = `
    <span class="selection-checkmark" aria-hidden="true">
      <span class="selection-checkmark-glyph">∨</span>
      <svg class="selection-checkmark-rounded" viewBox="0 0 24 24" focusable="false">
        <path d="M6 7.5 12 16.5 18 7.5"></path>
      </svg>
    </span>
  `;
  button.addEventListener("click", (event) => {
    stopVisualCardAction(event);
    toggleCardSelection(post.folder_path);
  });
  return button;
}

function imagineCardHeartIconHtml() {
  return `<span class="imagine-save-heart-icon" aria-hidden="true"><svg class="imagine-save-heart-svg" viewBox="0 0 24 24" focusable="false"><path class="imagine-save-heart-path" d="M12 20.2c-.28 0-.55-.1-.76-.29C6.15 15.32 3 12.48 3 8.62 3 5.78 5.12 3.7 7.9 3.7c1.62 0 3.16.75 4.1 1.94.94-1.19 2.48-1.94 4.1-1.94 2.78 0 4.9 2.08 4.9 4.92 0 3.86-3.15 6.7-8.24 11.29-.21.19-.48.29-.76.29Z"/></svg></span>`;
}

function imagineCardUnsaveButton(post) {
  const button = document.createElement("button");
  button.className = "i_remote_unsave_btn text2image-save-button media-card-select-button imagine-save-heart saved";
  button.type = "button";
  button.dataset.libraryPostPath = post.folder_path || "";
  button.setAttribute("aria-label", "Unsave");
  button.setAttribute("aria-pressed", "true");
  button.innerHTML = imagineCardHeartIconHtml();
  button.addEventListener("click", (event) => {
    stopVisualCardAction(event);
    unsaveImagineCardPost(post).catch((error) => showErrorPanel("Unsave failed", error?.message || "Unsave failed."));
  });
  return button;
}

function imagineCardSaveButton(post) {
  const button = document.createElement("button");
  button.className = "i_remote_save_btn text2image-save-button media-card-select-button imagine-save-heart";
  button.type = "button";
  button.dataset.libraryPostPath = post.folder_path || "";
  button.setAttribute("aria-label", "Save");
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = imagineCardHeartIconHtml();
  button.addEventListener("click", (event) => {
    stopVisualCardAction(event);
    if (typeof imaginePostLiked === "function" && imaginePostLiked(post)) return;
    likeImagineCardPost(post)
      .catch((error) => showErrorPanel("Save failed", error?.message || "Save failed."));
  });
  return button;
}

function cardVisualActionButton(className, label, html, onClick = null) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.innerHTML = html;
  button.addEventListener("click", (event) => {
    stopVisualCardAction(event);
    if (onClick) onClick(button, event);
  });
  return button;
}

function cardVisualActions(post) {
  const actions = document.createElement("div");
  actions.className = "card-actions media-card-actions";
  actions.append(
    cardVisualActionButton(
      "download-card-btn media-card-download-button",
      "Download",
      `<span class="media-card-action-glyph media-card-download-glyph" aria-hidden="true">↓</span>`,
      () => downloadLibraryCardPost(post).catch((error) => showErrorPanel("Download failed", error?.message || "Download failed.")),
    ),
    cardVisualActionButton(
      "move-card-btn media-card-move-button",
      "Move",
      `<span class="media-card-action-glyph" aria-hidden="true">↗</span>`,
      () => openMoveToCollectionDialog({ postPath: post.folder_path }),
    ),
    cardVisualActionButton(
      "delete-card-btn danger-card-btn media-card-delete-button",
      "Delete",
      `<span class="media-card-action-glyph media-card-delete-glyph delete-x-icon" aria-hidden="true"></span>`,
      (button) => deleteLibraryPost(post, button),
    ),
  );
  return actions;
}

function cardVisualActionsShell(post) {
  const actions = document.createElement("div");
  const allowDelete = !(typeof isImagineDiscoverPost === "function" && isImagineDiscoverPost(post));
  const buttons = [
    cardVisualActionButton(
      "download-card-btn media-card-download-button",
      "Download",
      `<span class="media-card-action-glyph media-card-download-glyph" aria-hidden="true">↓</span>`,
    ),
    cardVisualActionButton(
      "move-card-btn media-card-move-button",
      "Move",
      `<span class="media-card-action-glyph" aria-hidden="true">↗</span>`,
      () => openMoveToCollectionDialog({ postPath: post.folder_path }),
    ),
  ];
  if (allowDelete) {
    buttons.push(
      cardVisualActionButton(
        "delete-card-btn danger-card-btn media-card-delete-button",
        "Delete",
        `<span class="media-card-action-glyph media-card-delete-glyph delete-x-icon" aria-hidden="true"></span>`,
        (button) => {
          if (typeof deleteImagineCardPost === "function") {
            deleteImagineCardPost(post, button);
          }
        },
      ),
    );
  }
  actions.className = "card-actions media-card-actions";
  actions.append(...buttons);
  return actions;
}

function appendCardResolutionBadge(media, item, post = null) {
  const label = typeof mediaResolutionLabelForItem === "function" ? mediaResolutionLabelForItem(item, post) : "";
  if (!label) return;
  media.classList.add("has_resolution_badge");
  const badge = document.createElement("span");
  badge.className = "card_resolution_badge";
  badge.textContent = label;
  media.append(badge);
}

function cardJobPreviewItem(attachedPreview, rawRepresentative = {}) {
  const previewUrl = String(attachedPreview?.url || "").trim();
  if (!previewUrl) return null;
  const previewType = String(attachedPreview?.type || rawRepresentative?.type || "image").toLowerCase();
  const fallbackPoster = String(rawRepresentative?.thumbnail_url || rawRepresentative?.poster_url || "").trim();
  return {
    type: previewType,
    object_url: previewUrl,
    url: previewUrl,
    preview_url: previewUrl,
    thumbnail_url: previewType === "image" ? previewUrl : fallbackPoster,
    poster_url: previewType === "video" ? fallbackPoster : "",
  };
}

function mediaCardForPost(post, className, backTargetOverride = null) {
  const rawRepresentative = representativeItem(post.items || [], post) || post.representative_item || post.items[0] || {};
  const attachedJob = cardAttachedBuildJob(post, className);
  if (attachedJob && typeof mediaCardForBuildJob === "function") {
    return mediaCardForBuildJob(attachedJob, 0, post, backTargetOverride);
  }
  const attachedJobFailed = attachedJob && ["failed", "moderated"].includes(buildJobStatus(attachedJob));
  const attachedPreview = attachedJob && typeof generationJobPreviewInfo === "function"
    ? generationJobPreviewInfo(attachedJob, post)
    : null;
  const representative = cardJobPreviewItem(attachedPreview, rawRepresentative)
    || cardDisplayItemForContext(post, rawRepresentative, className)
    || {};
  const type = representative.type || "image";
  const remoteOnly = Boolean(post.remote || post.area === "imagine_remote");
  const article = document.createElement("article");
  article.className = `card ${className}${attachedJob ? " gallery_job_card is_generating" : ""}${attachedJobFailed ? " failed" : ""}${library_state.selectedItems.has(post.folder_path || "") ? " selected" : ""}`;
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.dataset.libraryPostPath = post.folder_path;
  if (attachedJob && typeof generationJobDatasetKey === "function") {
    article.dataset[generationJobDatasetKey(attachedJob)] = attachedJob.id || "";
  }
  applyStableCardRenderData(
    article,
    cardRenderKeyForPost(post, className, backTargetOverride),
    cardRenderHashForPost(post, className, backTargetOverride),
  );

  const media = document.createElement("div");
  media.className = `card_media card_${type}`;
  const previewItem = remoteOnly
    ? { ...representative, card_remote_post_path: String(post.folder_path || "") }
    : representative;
  appendMediaPreview(article, media, previewItem, type);
  if (type === "video") {
    const icon = document.createElement("img");
    icon.className = "card_type_icon";
    icon.src = "./assets/icons/video.svg";
    icon.alt = "";
    media.append(icon);
  }
  appendCardResolutionBadge(media, representative, post);
  appendLuckyBadge(media, representative, post, "card_lucky_badge");
  if (attachedJob && typeof buildJobOverlayElement === "function") {
    media.append(buildJobOverlayElement(attachedJob, 0, Boolean(attachedPreview?.url)));
  }

  if (remoteOnly) article.classList.add("remote_card");
  if (!attachedJob) {
    if (remoteOnly) {
      const unsavedPost = typeof isImagineUnsavedPost === "function" && isImagineUnsavedPost(post);
      const imagineCardScreenId = backTargetOverride?.screenId || "i_main";
      const saveSource = (
        (typeof isImagineDiscoverPost === "function" && isImagineDiscoverPost(post))
        || (typeof isImagineT2iPost === "function" && isImagineT2iPost(post))
      );
      const saved = typeof imaginePostLiked === "function" && imaginePostLiked(post);
      const showSaveButton = saveSource && !saved;
      if (showSaveButton) article.append(imagineCardSaveButton(post));
      if (unsavedPost || imagineCardScreenId === "i_main") {
        const selectButton = cardVisualSelectButton(post);
        if (imagineCardScreenId === "i_main" && !showSaveButton) {
          selectButton.classList.add("card_visual_select_primary");
        }
        article.append(selectButton);
      }
    } else if (className === "b_t2i_card" && isBuildT2iPost(post)) {
      article.append(buildFavoriteButton(post));
    } else {
      article.append(cardVisualSelectButton(post));
    }
  }

  const caption = document.createElement("div");
  caption.className = "card_caption";
  const title = document.createElement("strong");
  title.textContent = post.title || post.post_id || readableName(post.folderName);
  const meta = document.createElement("span");
  meta.textContent = post.collection || post.area || "Media";
  caption.append(title, meta);
  article.append(media, caption);
  if (!attachedJob) article.append(remoteOnly ? cardVisualActionsShell(post) : cardVisualActions(post));
  if (attachedJob && typeof buildJobActionButton === "function") article.append(buildJobActionButton(attachedJob));

  const activate = () => {
    selectLibraryPost(post.folder_path);
    if (attachedJob && typeof generationJobProvider === "function" && generationJobProvider(attachedJob) === "imagine") {
      library_state.selectedImagineJobId = String(attachedJob.id || "");
      library_state.selectedJobId = "";
    } else if (attachedJob) {
      library_state.selectedJobId = String(attachedJob.id || "");
      library_state.selectedImagineJobId = "";
    }
    const detailType = cardUsesImagineDetail(post, className) ? "imagine" : "build";
    const backTarget = backTargetOverride || (detailType === "imagine"
      ? { screenId: "i_main", activeButtonId: screen_state.current_i_nav_btn }
      : {
        screenId: "b_main",
        activeButtonId: screen_state.current_b_nav_btn,
      });
    const storedBackTarget = { ...backTarget };
    if (detailType === "imagine" && typeof imagineListScrollTopForScreen === "function") {
      const scrollTop = imagineListScrollTopForScreen(storedBackTarget.screenId);
      if (scrollTop !== null && scrollTop !== undefined) storedBackTarget.scrollTop = scrollTop;
    }
    screen_state.detail_back[detailType] = storedBackTarget;
    openScreen(
      detailType === "imagine" ? "i_detail" : "b_detail",
      storedBackTarget.activeButtonId,
    );
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

function mediaCardForItem(post, item, backTarget = { screenId: "2nd_main", activeButtonId: "b_collection_nav_btn" }) {
  const displayItem = cardDisplayItemForContext(post, item, "");
  const type = displayItem.type || mediaTypeForName(displayItem.file || displayItem.url) || "image";
  const article = document.createElement("article");
  article.className = "card collection_media_card";
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.dataset.libraryPostPath = post.folder_path;
  article.dataset.libraryItemId = mediaItemKey(item);
  applyStableCardRenderData(
    article,
    `collection_media_card|${post.folder_path || ""}|${mediaItemKey(item)}`,
    [
      post.folder_path || "",
      mediaItemKey(displayItem),
      displayItem?.type || "",
      mediaPreviewUrl(displayItem),
      videoPreviewUrl(displayItem),
      typeof mediaItemLucky === "function" && mediaItemLucky(displayItem) ? "lucky" : "",
      typeof mediaResolutionLabelForItem === "function" ? mediaResolutionLabelForItem(displayItem, post) : "",
      displayItem?.title || "",
      displayItem?.prompt || "",
    ].map((value) => String(value || "")).join("\u001f"),
  );

  const media = document.createElement("div");
  media.className = `card_media card_${type}`;
  appendMediaPreview(article, media, displayItem, type);
  if (type === "video") {
    const icon = document.createElement("img");
    icon.className = "card_type_icon";
    icon.src = "./assets/icons/video.svg";
    icon.alt = "";
    media.append(icon);
  }
  appendCardResolutionBadge(media, displayItem, post);
  appendLuckyBadge(media, displayItem, post, "card_lucky_badge");

  const caption = document.createElement("div");
  caption.className = "card_caption";
  const title = document.createElement("strong");
  title.textContent = displayItem.prompt || post.prompt || displayItem.title || readableName(displayItem.file || displayItem.url || "Media");
  const meta = document.createElement("span");
  meta.textContent = item.role || post.title || "Media";
  caption.append(title, meta);
  article.append(media, caption);

  const activate = () => {
    selectLibraryPost(post.folder_path);
    setSelectedDetailItem(mediaItemKey(item));
    const detailType = cardUsesImagineDetail(post, "") ? "imagine" : "build";
    screen_state.detail_back[detailType] = backTarget;
    openScreen(detailType === "imagine" ? "i_detail" : "b_detail", "b_collection_nav_btn");
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

function renderCardList(selector, posts, className, emptyText) {
  const list = document.querySelector(selector);
  if (!list) return;
  if (!posts.length) {
    list.replaceChildren(emptyLibraryNode(emptyText));
    return;
  }
  replaceCardListChildren(list, posts.map((post) => mediaCardForPost(post, className)));
}
