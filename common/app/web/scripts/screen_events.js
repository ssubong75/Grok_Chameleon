// Boot and global selection events
document.getElementById("selectionDownloadBtn")?.addEventListener("click", () => {
  downloadSelectedCardItems().catch((error) => {
    console.warn(error);
    showErrorPanel("Download failed", error?.message || "Download failed.");
  });
});

document.getElementById("selectionMergeBtn")?.addEventListener("click", () => {
  const button = document.getElementById("selectionMergeBtn");
  const movingImagineCards = button?.dataset.selectionAction === "move";
  const action = movingImagineCards ? moveSelectedImagineCardItems : mergeSelectedCardItems;
  action().catch((error) => {
    console.warn(error);
    showErrorPanel(
      movingImagineCards ? "Move failed" : "Merge failed",
      error?.message || (movingImagineCards ? "Move failed." : "Merge failed."),
    );
  });
});

document.getElementById("selectionRenameBtn")?.addEventListener("click", () => {
  renameSelectedCollectionCard().catch((error) => {
    console.warn(error);
    showErrorPanel("Rename failed", error?.message || "Rename failed.");
  });
});

document.getElementById("selectionDeleteBtn")?.addEventListener("click", () => {
  deleteSelectedCardItems().catch((error) => {
    console.warn(error);
    showErrorPanel("Delete failed", error?.message || "Delete failed.");
  });
});

document.getElementById("selectionClearBtn")?.addEventListener("click", () => {
  clearCardSelection();
});

document.querySelector(".topbar_history_back")?.addEventListener("click", () => {
  navigateBrowserHistory(-1);
});

document.querySelector(".topbar_history_forward")?.addEventListener("click", () => {
  navigateBrowserHistory(1);
});

let browserClosingSent = false;
const INTERNAL_NAVIGATION_KEY = "grokChameleonInternalNavigation";

function consumeUiReloadState() {
  try {
    const raw = sessionStorage.getItem("grokChameleonUiReloadStateV1") || "";
    sessionStorage.removeItem("grokChameleonUiReloadStateV1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

const pendingUiReloadState = consumeUiReloadState();

function restoreUiReloadState(saved) {
  if (!saved || typeof saved !== "object") return false;
  const imagineActiveId = String(saved.imagineActiveId || "");
  const buildActiveId = String(saved.buildActiveId || "");
  if (imagineActiveId && account_state.imagine.accounts.some((account) => account.id === imagineActiveId)) {
    account_state.imagine.active_id = imagineActiveId;
  }
  if (buildActiveId && account_state.build.accounts.some((account) => account.id === buildActiveId)) {
    account_state.build.active_id = buildActiveId;
  }
  const historySnapshot = saved.history && typeof saved.history === "object" ? saved.history : null;
  const selectedPostSnapshot = saved.selectedPostSnapshot && typeof saved.selectedPostSnapshot === "object"
    ? saved.selectedPostSnapshot
    : null;
  if (historySnapshot?.selectedPostPath && selectedPostSnapshot && typeof restoreImageEditorReturnPost === "function") {
    const detailType = historySnapshot.screenId === "b_detail" ? "build" : "imagine";
    const backTarget = detailType === "build"
      ? historySnapshot.detailBack?.build
      : historySnapshot.detailBack?.imagine;
    restoreImageEditorReturnPost(
      JSON.stringify(selectedPostSnapshot),
      String(historySnapshot.selectedPostPath),
      detailType,
      backTarget || { screenId: detailType === "build" ? "b_main" : "i_main" },
    );
  }
  const searchQuery = String(saved.searchQuery || "");
  library_state.searchQuery = searchQuery;
  if (searchInput) searchInput.value = searchQuery;
  renderAccounts();
  if (historySnapshot && typeof restoreBrowserHistoryState === "function") {
    restoreBrowserHistoryState(historySnapshot);
  }
  renderLibrary();
  if (
    historySnapshot?.screenId === "i_main"
    && library_state.iMainView === imagineViewValue("LIKED", "liked")
    && typeof loadImagineLikedCards === "function"
  ) {
    loadImagineLikedCards({ force: false }).catch((error) => {
      library_state.imagineLikedError = error?.message || "Imagine liked failed.";
      library_state.imagineLikedLoading = false;
      renderSourceCards("imagine");
    });
  }
  return true;
}

function notifyBrowserClosing() {
  if (location.protocol === "file:") return;
  if (sessionStorage.getItem(INTERNAL_NAVIGATION_KEY)) {
    sessionStorage.removeItem(INTERNAL_NAVIGATION_KEY);
    browserClosingSent = true;
    return;
  }
  if (browserClosingSent) return;
  browserClosingSent = true;
  const body = "{}";
  const sent = navigator.sendBeacon?.("/api/browser/closing", body);
  if (!sent) {
    fetch("/api/browser/closing", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  }
}

window.addEventListener("pagehide", notifyBrowserClosing);
window.addEventListener("beforeunload", notifyBrowserClosing);

updateComposerProviderBadge();
renderComposerOptions();
renderSourceCards("build");
renderBuildT2iViewCards();
renderSourceCards("imagine");
renderImagineDiscoverCards();
renderPromptCards();
renderAccounts();

window.addEventListener("popstate", (event) => {
  restoreBrowserHistoryState(event.state);
});

openScreen(screen_state.current_main, "i_imagine_nav_btn", { replaceHistory: true });
scheduleSidebarTogglePosition();
restoreLibraryRoot().then(() => {
  restoreUiReloadState(pendingUiReloadState);
  consumeImageEditorReturn().catch((error) => showErrorPanel("Edit failed", error?.message || "Edit failed."));
  if (typeof refreshBuildJobs === "function") refreshBuildJobs();
  if (
    library_state.apiReady
    && library_state.rootPath
    && !library_state.libraryIndexEnabled
    && typeof scanLibrary === "function"
  ) {
    setTimeout(() => {
      scanLibrary().catch((error) => console.warn(error));
    }, 100);
  }
});
