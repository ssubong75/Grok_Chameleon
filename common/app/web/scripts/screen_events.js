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

document.getElementById("selectionDeleteBtn")?.addEventListener("click", () => {
  deleteSelectedCardItems().catch((error) => {
    console.warn(error);
    showErrorPanel("Delete failed", error?.message || "Delete failed.");
  });
});

document.getElementById("selectionClearBtn")?.addEventListener("click", () => {
  clearCardSelection();
});

let browserClosingSent = false;
const INTERNAL_NAVIGATION_KEY = "grokChameleonInternalNavigation";

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
  consumeImageEditorReturn().catch((error) => showErrorPanel("Edit failed", error?.message || "Edit failed."));
  if (typeof refreshBuildJobs === "function") refreshBuildJobs();
  if (typeof prepareActiveImagineBridgeSession === "function") {
    prepareActiveImagineBridgeSession().catch((error) => console.warn(error));
  }
});
