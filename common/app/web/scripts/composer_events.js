// Composer mode, input, attachment tray, upload, send, and option events
function syncComposerExtendSelectionFromSeekEvent(event) {
  if (composerState.mode !== "extend" || !detail_state.extendActive) return;
  const seekInput = event.target instanceof Element ? event.target.closest("input.video-seek[data-seek]") : null;
  if (!seekInput) return;
  const video = seekInput.closest(".video-player")?.querySelector("video");
  const duration = Number(video?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return;
  const syncSelection = () => {
    const scale = Number(seekInput.max || 1000) || 1000;
    const requested = (Number(seekInput.value || 0) / scale) * duration;
    const clamped = clampedComposerExtendStart(requested, duration);
    if (!Number.isFinite(clamped)) return;
    detail_state.extendStart = Number(clamped.toFixed(3));
    detail_state.extendUserAdjusted = true;
    if (typeof refreshDetailExtendTimeLabel === "function") refreshDetailExtendTimeLabel();
  };
  if (event.type === "pointerup" || event.type === "click") {
    requestAnimationFrame(syncSelection);
  } else {
    syncSelection();
  }
}

document.addEventListener("input", syncComposerExtendSelectionFromSeekEvent);
document.addEventListener("change", syncComposerExtendSelectionFromSeekEvent);
document.addEventListener("pointerup", syncComposerExtendSelectionFromSeekEvent);
document.addEventListener("click", syncComposerExtendSelectionFromSeekEvent);

for (const tab of document.querySelectorAll(".composer_mode .tab")) {
  tab.addEventListener("click", () => {
    const mode = tab.dataset.mode || "image";
    setComposerMode(mode, { resetExtendStart: mode === "extend" });
  });
}

const composerInput = document.getElementById("composer_input");
const composerPromptDragThreshold = 4;
const composerPromptDragReleaseGraceMs = 350;
let composerPromptPointer = null;
let composerPromptDragReleaseAt = Number.NEGATIVE_INFINITY;

function responsiveCardAspectRatio() {
  const viewportRatio = window.innerWidth / Math.max(1, window.innerHeight);
  const displayWidth = Number(window.screen?.width) || 0;
  const displayHeight = Number(window.screen?.height) || 0;
  const workWidth = Number(window.screen?.availWidth) || displayWidth;
  const workHeight = Number(window.screen?.availHeight) || displayHeight;
  const outerWidth = Number(window.outerWidth) || window.innerWidth;
  const outerHeight = Number(window.outerHeight) || window.innerHeight;
  if (!displayWidth || !displayHeight || !workWidth || !workHeight) return viewportRatio;

  const widthTolerance = Math.max(24, workWidth * 0.02);
  const heightTolerance = Math.max(24, workHeight * 0.02);
  const fillsWorkArea = Math.abs(outerWidth - workWidth) <= widthTolerance
    && Math.abs(outerHeight - workHeight) <= heightTolerance;
  return fillsWorkArea ? displayWidth / displayHeight : viewportRatio;
}

function syncResponsiveCardHeight() {
  const root = document.documentElement;
  const previousHeight = root.style.getPropertyValue("--responsive-card-height");
  const wasFitted = root.classList.contains("responsive_card_fit");
  root.classList.remove("responsive_card_fit", "landscape_six_card_grid");
  root.style.removeProperty("--responsive-card-height");
  if (!composer) return;
  const aspectRatio = responsiveCardAspectRatio();
  const landscapeTwoRowGrid = aspectRatio >= (16 / 9);
  const landscapeSixGrid = aspectRatio > (16 / 9);
  const fittedRows = landscapeTwoRowGrid ? 2 : 3;
  if (landscapeSixGrid) root.classList.add("landscape_six_card_grid");
  if (!landscapeTwoRowGrid && aspectRatio > 1) return;

  const list = [...document.querySelectorAll(
    ".i_card_list, .b_card_list, .b_t2i_view_card_list, .search_card_list, .i_discover_card_list, .i_unsaved_card_list, .second_main_card_list",
  )].find((candidate) => !candidate.closest("[hidden]") && candidate.getBoundingClientRect().height > 0);
  if (!list) return;

  const card = list.querySelector(":scope > .card");
  const cardRect = card?.getBoundingClientRect();
  const naturalHeight = cardRect?.height || 0;
  const composerRect = composer.getBoundingClientRect();
  const rowGap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
  const fitBoundary = landscapeTwoRowGrid ? window.innerHeight : composerRect.top;
  const availableHeight = fitBoundary - (cardRect?.top || 0);
  const fittedHeight = Math.floor((availableHeight - (rowGap * (fittedRows - 1))) / fittedRows) - 2;
  if (naturalHeight <= 0 || fittedHeight <= 0 || fittedHeight >= naturalHeight) return;

  const nextHeight = `${fittedHeight}px`;
  root.style.setProperty("--responsive-card-height", nextHeight);
  root.classList.add("responsive_card_fit");
  if ((!wasFitted || previousHeight !== nextHeight) && typeof scheduleScreenVirtualCardList === "function") {
    const screenId = list.closest(".i_main, .b_main, .b_t2i_view_main, .search_main, .i_discover_main, .i_unsaved_main, .second_main")?.id;
    if (screenId) scheduleScreenVirtualCardList(screenId);
  }
}

function syncComposerScrollClearance() {
  if (!composer) return;
  const composerRect = composer.getBoundingClientRect();
  const visibleLists = [...document.querySelectorAll(
    ".i_card_list, .b_card_list, .b_t2i_view_card_list, .search_card_list, .i_discover_card_list, .prompt_card_list, .second_main_card_list, .i_unsaved_card_list",
  )]
    .filter((list) => !list.closest("[hidden]") && list.getBoundingClientRect().height > 0);
  const clearance = Math.max(16, ...visibleLists.map((list) => {
    const listRect = list.getBoundingClientRect();
    return Math.ceil(listRect.bottom - composerRect.top + 16);
  }));
  document.documentElement.style.setProperty("--composer-scroll-clearance", `${clearance}px`);
  syncResponsiveCardHeight();
}

const composerScrollClearanceObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(syncComposerScrollClearance)
  : null;
composerScrollClearanceObserver?.observe(composer);
const composerScreenObserver = typeof MutationObserver === "function"
  ? new MutationObserver(syncComposerScrollClearance)
  : null;
for (const screenId of [
  "i_main",
  "b_main",
  "b_t2i_view_main",
  "search_main",
  "i_discover_main",
  "i_unsaved_main",
  "prompt_main",
  "2nd_main",
]) {
  const screen = document.getElementById(screenId);
  if (screen) {
    composerScreenObserver?.observe(screen, { attributes: true, attributeFilter: ["hidden"] });
  }
}
const responsiveCardListObserver = typeof MutationObserver === "function"
  ? new MutationObserver(syncResponsiveCardHeight)
  : null;
for (const list of document.querySelectorAll(
  ".i_card_list, .b_card_list, .b_t2i_view_card_list, .search_card_list, .i_discover_card_list, .i_unsaved_card_list, .second_main_card_list",
)) {
  responsiveCardListObserver?.observe(list, { childList: true });
}
window.addEventListener("resize", syncComposerScrollClearance);
requestAnimationFrame(syncComposerScrollClearance);

function composerPromptMinHeight(input = composerInput) {
  if (!input) return 44;
  const minHeight = parseFloat(getComputedStyle(input).minHeight);
  return Number.isFinite(minHeight) ? minHeight : 44;
}

function autoSizeComposerPromptInput(input = composerInput) {
  if (!input) return;
  const minHeight = composerPromptMinHeight(input);
  if (!composer?.classList.contains("prompt_expanded")) {
    input.style.height = `${minHeight}px`;
    input.scrollTop = 0;
    return;
  }
  input.style.height = "auto";
  input.style.height = `${Math.min(220, Math.max(minHeight, input.scrollHeight))}px`;
}

function setComposerPromptExpanded(expanded) {
  composer?.classList.toggle("prompt_expanded", Boolean(expanded));
  autoSizeComposerPromptInput();
}

function isComposerPromptDragGuardActive() {
  return Boolean(composerPromptPointer)
    || (performance.now() - composerPromptDragReleaseAt) < composerPromptDragReleaseGraceMs;
}

function clearComposerPromptPointer(event) {
  if (!composerPromptPointer) return;
  if (event?.pointerId != null && event.pointerId !== composerPromptPointer.pointerId) return;
  if (composerPromptPointer.dragged) composerPromptDragReleaseAt = performance.now();
  composerPromptPointer = null;
}

composerInput?.addEventListener("input", () => setComposerPromptExpanded(true));
composerInput?.addEventListener("focus", () => setComposerPromptExpanded(true));
composerInput?.addEventListener("click", () => setComposerPromptExpanded(true));
composerInput?.addEventListener("pointerdown", (event) => {
  composerPromptPointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragged: false,
  };
  setComposerPromptExpanded(true);
});
composerInput?.addEventListener("paste", () => {
  requestAnimationFrame(() => setComposerPromptExpanded(true));
});
window.addEventListener("pointermove", (event) => {
  if (!composerPromptPointer || event.pointerId !== composerPromptPointer.pointerId) return;
  const movedX = Math.abs(event.clientX - composerPromptPointer.startX);
  const movedY = Math.abs(event.clientY - composerPromptPointer.startY);
  if (movedX > composerPromptDragThreshold || movedY > composerPromptDragThreshold) {
    composerPromptPointer.dragged = true;
    setComposerPromptExpanded(true);
  }
});
window.addEventListener("pointerup", clearComposerPromptPointer);
window.addEventListener("pointercancel", clearComposerPromptPointer);
window.addEventListener("resize", () => autoSizeComposerPromptInput());

const composerAttach = document.getElementById("composer_attach");
const composerUploadTray = document.getElementById("composer_upload_tray");

function closeComposerUploadTray() {
  if (!composerUploadTray) return;
  composerUploadTray.hidden = true;
  composerAttach?.classList.remove("is-open");
  composer?.classList.remove("composer_tools_open");
}

composerAttach?.addEventListener("click", () => {
  if (!composerUploadTray) return;
  const nextOpen = composerUploadTray.hidden;
  composerUploadTray.hidden = !nextOpen;
  composerAttach.classList.toggle("is-open", nextOpen);
  composer?.classList.toggle("composer_tools_open", nextOpen);
  if (nextOpen) {
    syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
  }
});

document.getElementById("image_files")?.addEventListener("change", (event) => {
  setComposerFiles(event.target.files).catch((error) => {
    console.warn(error);
    showErrorPanel("Attachment read failed", error?.message || "Attachment read failed.");
  });
});

document.getElementById("composer_upload_box")?.addEventListener("dragover", (event) => {
  event.preventDefault();
});

document.getElementById("composer_upload_box")?.addEventListener("drop", (event) => {
  event.preventDefault();
  setComposerFiles(event.dataTransfer?.files).catch((error) => {
    console.warn(error);
    showErrorPanel("Attachment read failed", error?.message || "Attachment read failed.");
  });
});

for (const thumbListSelector of [".composer_upload_thumb_list", ".composer_attached_list"]) {
  const thumbList = document.querySelector(thumbListSelector);
  thumbList?.addEventListener("click", (event) => {
    const remove = event.target.closest(".composer_upload_remove");
    if (remove && thumbList.contains(remove)) {
      event.preventDefault();
      event.stopPropagation();
      const thumb = remove.closest(".composer_upload_thumb");
      if (!thumb) return;
      removeComposerUploadFromList(
        thumb.dataset.uploadPostPath || "",
        thumb.dataset.uploadItemId || "",
        thumb.dataset.uploadRemoveKey || "",
      ).catch((error) => {
        console.warn(error);
        showErrorPanel("Remove failed", error?.message || "Remove failed.");
      });
      return;
    }
    const thumb = event.target.closest("button");
    if (!thumb || !thumbList.contains(thumb)) return;
    if (thumb.dataset.attachmentIndex) {
      removeComposerAttachmentAt(Number(thumb.dataset.attachmentIndex));
      return;
    }
    if (thumb.dataset.uploadPostPath && thumb.dataset.uploadItemId) {
      toggleComposerAttachmentFromLibraryItem(thumb.dataset.uploadPostPath, thumb.dataset.uploadItemId).catch((error) => {
        console.warn(error);
        showErrorPanel("Attachment read failed", error?.message || "Attachment read failed.");
      });
      return;
    }
    setActiveInGroup(thumbList.querySelectorAll("button"), thumb);
  });
}

document.getElementById("composer_send")?.addEventListener("click", () => {
  submitComposer();
});

document.getElementById("composer_save")?.addEventListener("click", () => {
  openPromptSave();
});

const closeComposerSelects = (except = null) => {
  for (const select of document.querySelectorAll(".custom_select.open")) {
    if (select !== except) select.classList.remove("open");
  }
};

for (const select of document.querySelectorAll(".custom_select")) {
  const button = select.querySelector(".custom_select_btn");
  button?.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextOpen = !select.classList.contains("open");
    closeComposerSelects(select);
    select.classList.toggle("open", nextOpen);
  });
  select.addEventListener("click", (event) => {
    const option = event.target.closest(".custom_select_option");
    if (!option || !select.contains(option)) return;
    event.stopPropagation();
    button.textContent = option.textContent;
    if (typeof rememberComposerOption === "function") rememberComposerOption(select, option.textContent);
    select.querySelectorAll(".custom_select_option").forEach((item) => item.classList.toggle("active", item === option));
    if (composerState.mode === "video" && typeof syncComposerVideoOptionControls === "function") {
      syncComposerVideoOptionControls();
    }
    closeComposerSelects();
  });
}

document.addEventListener("click", () => {
  closeComposerSelects();
});

document.addEventListener("click", (event) => {
  if (!composer?.classList.contains("prompt_expanded")) return;
  if (!(event.target instanceof Element)) return;
  if (composer?.contains(event.target)) return;
  if (isComposerPromptDragGuardActive()) return;
  setComposerPromptExpanded(false);
});

document.addEventListener("pointerdown", (event) => {
  if (!composerUploadTray || composerUploadTray.hidden) return;
  if (!(event.target instanceof Element)) return;
  if (composer?.contains(event.target)) return;
  closeComposerUploadTray();
}, { capture: true });
