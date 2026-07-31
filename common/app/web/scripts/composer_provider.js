// Composer provider and mode switching
function providerForScreen(screenId, activeButtonId = "") {
  if (screenId.startsWith("i_") || activeButtonId.startsWith("i_")) return "imagine";
  if (screenId.startsWith("b_") || screenId === "collection_main" || screenId === "2nd_main" || activeButtonId.startsWith("b_")) return "build";
  return "";
}

function modeForNavButton(buttonId = "") {
  if (buttonId.endsWith("_video_btn")) return "video";
  if (buttonId.endsWith("_image_btn")) return "image";
  return "";
}

function updateComposerProviderBadge() {
  const imagine = composerState.provider === "imagine";
  composer?.classList.toggle("provider_imagine", imagine);
  composer?.classList.toggle("provider_build", !imagine);
  if (!composerProviderBadge) return;
  composerProviderBadge.textContent = imagine ? "Imagine" : "Build";
  composerProviderBadge.classList.toggle("provider_imagine", imagine);
  composerProviderBadge.classList.toggle("provider_build", !imagine);
}

function setComposerProvider(provider) {
  if (!provider) return;
  const previousProvider = composerState.provider;
  if (previousProvider && previousProvider !== provider && typeof clearComposerAttachmentsForPostChange === "function") {
    clearComposerAttachmentsForPostChange();
  }
  composerState.provider = provider;
  if (provider === "imagine" && (composerState.mode === "analyze" || composerState.mode === "video_edit")) {
    composerState.mode = "image";
  }
  updateComposerProviderBadge();
  trimComposerAttachmentsToLimit();
  setComposerMode(composerState.mode);
}

function setComposerMode(mode, options = {}) {
  if (!mode) return;
  const previousMode = composerState.mode;
  if (composerState.provider === "imagine" && (mode === "analyze" || mode === "video_edit")) {
    mode = "image";
  }
  composerState.mode = mode;
  for (const nextMode of ["image", "video", "extend", "video_edit", "analyze"]) {
    composer?.classList.toggle(`mode_${nextMode}`, nextMode === mode);
  }
  pruneComposerAttachmentsForMode();
  updateComposerFileAccept();
  for (const tab of document.querySelectorAll(".composer_mode .tab")) {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  }
  renderComposerOptions();
  if (mode === "extend") {
    prepareDetailExtendFromCurrentVideo({ resetStart: Boolean(options.resetExtendStart) });
  } else {
    clearDetailExtendState();
  }
  trimComposerAttachmentsToLimit();
  renderComposerAttachments();
  if (
    previousMode !== mode
    && (screen_state.current_screen === "i_detail" || screen_state.current_screen === "b_detail")
    && typeof syncDetailAttachmentForComposerTray === "function"
  ) {
    syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
  }
}
