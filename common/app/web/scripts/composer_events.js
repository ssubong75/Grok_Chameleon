// Composer mode, input, attachment tray, upload, send, and option events
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

function syncComposerScrollClearance() {
  if (!composer) return;
  const composerRect = composer.getBoundingClientRect();
  const visibleLists = [...document.querySelectorAll(".i_card_list, .b_card_list")]
    .filter((list) => !list.closest("[hidden]") && list.getBoundingClientRect().height > 0);
  const clearance = Math.max(16, ...visibleLists.map((list) => {
    const listRect = list.getBoundingClientRect();
    return Math.ceil(listRect.bottom - composerRect.top + 16);
  }));
  document.documentElement.style.setProperty("--composer-scroll-clearance", `${clearance}px`);
}

const composerScrollClearanceObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(syncComposerScrollClearance)
  : null;
composerScrollClearanceObserver?.observe(composer);
const composerScreenObserver = typeof MutationObserver === "function"
  ? new MutationObserver(syncComposerScrollClearance)
  : null;
for (const screen of document.querySelectorAll("#i_main, #b_main")) {
  composerScreenObserver?.observe(screen, { attributes: true, attributeFilter: ["hidden"] });
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

function collapseComposerPromptIfAllowed() {
  if (!composer?.classList.contains("prompt_expanded")) return;
  if (isComposerPromptDragGuardActive()) return;
  setComposerPromptExpanded(false);
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
composer?.addEventListener("mouseleave", collapseComposerPromptIfAllowed);
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
