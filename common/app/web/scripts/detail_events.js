// Detail card navigation and thumbnail events
for (const card of document.querySelectorAll(".i_card")) {
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.addEventListener("click", () => {
    openScreen("i_detail", screen_state.current_i_nav_btn);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openScreen("i_detail", screen_state.current_i_nav_btn);
    }
  });
}

for (const card of document.querySelectorAll(".b_card")) {
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.addEventListener("click", () => {
    openScreen("b_detail", screen_state.current_b_nav_btn);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openScreen("b_detail", screen_state.current_b_nav_btn);
    }
  });
}

document.querySelector(".b_detail_back")?.addEventListener("click", () => {
  navigateDetailPost(-1).catch((error) => console.warn(error));
});

document.querySelector(".i_detail_back")?.addEventListener("click", () => {
  navigateDetailPost(-1).catch((error) => console.warn(error));
});

document.querySelector(".b_detail_forward")?.addEventListener("click", () => {
  navigateDetailPost(1).catch((error) => console.warn(error));
});

document.querySelector(".i_detail_forward")?.addEventListener("click", () => {
  navigateDetailPost(1).catch((error) => console.warn(error));
});

document.querySelector(".b_detail_return")?.addEventListener("click", () => {
  returnFromDetailToSource();
});

document.querySelector(".i_detail_return")?.addEventListener("click", () => {
  returnFromDetailToSource();
});

for (const thumbListSelector of [".i_detail_thumb_list", ".b_detail_thumb_list"]) {
  const thumbList = document.querySelector(thumbListSelector);
  thumbList?.addEventListener("click", (event) => {
    const thumb = event.target.closest("button");
    if (!thumb || !thumbList.contains(thumb)) return;
    const buildDetail = thumbListSelector.includes("b_detail");
    const imagineDetail = thumbListSelector.includes("i_detail");
    if (thumb.dataset.buildJobId) {
      library_state.selectedJobId = thumb.dataset.buildJobId;
      library_state.selectedImagineJobId = "";
      library_state.selectedDetailItemId = thumb.dataset.libraryItemId || "";
      renderDetailViews();
      syncComposerPromptFromDetail();
      composerState.dismissedDetailAttachmentKey = "";
      syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
      return;
    }
    if (thumb.dataset.imagineJobId) {
      library_state.selectedImagineJobId = thumb.dataset.imagineJobId;
      library_state.selectedJobId = "";
      library_state.selectedDetailItemId = thumb.dataset.libraryItemId || "";
      renderDetailViews();
      syncComposerPromptFromDetail();
      composerState.dismissedDetailAttachmentKey = "";
      syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
      return;
    }
    if (typeof handleBuildDetailThumbAction === "function" && handleBuildDetailThumbAction(thumb)) return;
    const keepBuildJob = buildDetail && typeof selectedBuildJob === "function" && selectedBuildJob();
    const keepImagineJob = imagineDetail && typeof selectedImagineJob === "function" && selectedImagineJob();
    if (!keepBuildJob) library_state.selectedJobId = "";
    if (!keepImagineJob) library_state.selectedImagineJobId = "";
    setSelectedDetailItem(thumb.dataset.libraryItemId || "");
    composerState.dismissedDetailAttachmentKey = "";
    syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
  });
}
