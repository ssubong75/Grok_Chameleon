// Browser history state for screen navigation

const initialBrowserHistoryIndex = Number(window.history?.state?.grokStudioQHistoryIndex);
let browserHistoryCursor = Number.isFinite(initialBrowserHistoryIndex)
  ? Math.max(0, initialBrowserHistoryIndex)
  : 0;
let browserHistoryTail = browserHistoryCursor;
let detailReturnTopSyncFrame = 0;

function syncDetailReturnTopFromMainHistory() {
  detailReturnTopSyncFrame = 0;
  const previous = document.querySelector(".topbar_history_back");
  const rect = previous?.getBoundingClientRect();
  if (!rect || rect.height <= 0) return;
  document.documentElement.style.setProperty("--detail-return-top", `${rect.top}px`);
}

function scheduleDetailReturnTopSync() {
  if (detailReturnTopSyncFrame) cancelAnimationFrame(detailReturnTopSyncFrame);
  detailReturnTopSyncFrame = requestAnimationFrame(syncDetailReturnTopFromMainHistory);
}

function syncBrowserHistoryButtons() {
  const previous = document.querySelector(".topbar_history_back");
  const next = document.querySelector(".topbar_history_forward");
  if (previous) previous.disabled = browserHistoryCursor <= 0;
  if (next) next.disabled = browserHistoryCursor >= browserHistoryTail;
  scheduleDetailReturnTopSync();
}

window.addEventListener("resize", scheduleDetailReturnTopSync);
scheduleDetailReturnTopSync();

function navigateBrowserHistory(offset) {
  const direction = Number(offset) < 0 ? -1 : 1;
  if (direction < 0) {
    if (browserHistoryCursor <= 0) return;
    window.history.back();
    return;
  }
  if (browserHistoryCursor >= browserHistoryTail) return;
  window.history.forward();
}

function browserHistoryUrl(screenId) {
  const url = new URL(location.href);
  url.hash = screenId || "i_main";
  return `${url.pathname}${url.search}${url.hash}`;
}

function browserHistoryState(screenId, activeButtonId = "") {
  return {
    grokStudioQ: true,
    grokStudioQHistoryIndex: browserHistoryCursor,
    screenId,
    activeButtonId,
    accountVisible: screen_state.account_visible,
    currentMain: screen_state.current_main,
    currentImagineNavBtn: screen_state.current_i_nav_btn,
    currentBuildNavBtn: screen_state.current_b_nav_btn,
    selectedPostPath: library_state.selectedPostPath,
    selectedPostIdentity: library_state.selectedPostIdentity,
    selectedDetailItemId: library_state.selectedDetailItemId,
    selectedCollectionPath: library_state.selectedCollectionPath,
    selectedCollectionPostPath: library_state.selectedCollectionPostPath,
    collectionView: library_state.collectionView,
    iMainView: library_state.iMainView,
    bMainView: library_state.bMainView,
    detailBack: {
      imagine: { ...screen_state.detail_back.imagine },
      build: { ...screen_state.detail_back.build },
    },
  };
}

function browserHistoryKey(state) {
  if (!state?.grokStudioQ) return "";
  return JSON.stringify({
    screenId: state.screenId,
    activeButtonId: state.activeButtonId,
    accountVisible: Boolean(state.accountVisible),
    selectedPostPath: state.selectedPostPath,
    selectedPostIdentity: state.selectedPostIdentity,
    selectedDetailItemId: state.selectedDetailItemId,
    selectedCollectionPath: state.selectedCollectionPath,
    selectedCollectionPostPath: state.selectedCollectionPostPath,
    iMainView: state.iMainView,
    bMainView: state.bMainView,
  });
}

function writeBrowserHistory(screenId, activeButtonId = "", options = {}) {
  if (options.skipHistory || screen_state.historyRestoring || !window.history?.pushState) {
    syncBrowserHistoryButtons();
    return;
  }
  const state = browserHistoryState(screenId, activeButtonId);
  const url = browserHistoryUrl(screenId);
  if (options.replaceHistory || !history.state?.grokStudioQ) {
    state.grokStudioQHistoryIndex = browserHistoryCursor;
    history.replaceState(state, "", url);
    syncBrowserHistoryButtons();
    return;
  }
  if (browserHistoryKey(history.state) === browserHistoryKey(state)) {
    syncBrowserHistoryButtons();
    return;
  }
  browserHistoryCursor += 1;
  browserHistoryTail = browserHistoryCursor;
  state.grokStudioQHistoryIndex = browserHistoryCursor;
  history.pushState(state, "", url);
  syncBrowserHistoryButtons();
}

function restoreBrowserHistoryState(state) {
  if (!state?.grokStudioQ) return;
  const restoredIndex = Number(state.grokStudioQHistoryIndex);
  if (Number.isFinite(restoredIndex)) {
    browserHistoryCursor = Math.max(0, restoredIndex);
    browserHistoryTail = Math.max(browserHistoryTail, browserHistoryCursor);
  }
  screen_state.historyRestoring = true;
  try {
    screen_state.current_main = state.currentMain || screen_state.current_main;
    screen_state.current_i_nav_btn = state.currentImagineNavBtn || screen_state.current_i_nav_btn;
    screen_state.current_b_nav_btn = state.currentBuildNavBtn || screen_state.current_b_nav_btn;
    screen_state.detail_back = {
      imagine: { ...screen_state.detail_back.imagine, ...(state.detailBack?.imagine || {}) },
      build: { ...screen_state.detail_back.build, ...(state.detailBack?.build || {}) },
    };
    library_state.iMainView = state.iMainView || library_state.iMainView;
    library_state.bMainView = state.bMainView || library_state.bMainView;
    library_state.collectionView = state.collectionView || library_state.collectionView;
    library_state.selectedCollectionPath = state.selectedCollectionPath || "";
    library_state.selectedCollectionPostPath = state.selectedCollectionPostPath || "";
    library_state.selectedDetailItemId = state.selectedDetailItemId || "";
    if (state.selectedPostPath) {
      selectLibraryPost(state.selectedPostPath, {
        loadFull: state.screenId !== "2nd_main",
        identity: state.selectedPostIdentity || "",
      });
    } else {
      library_state.selectedPostPath = "";
      library_state.selectedPostIdentity = "";
      renderDetailViews();
    }
    renderSourceCards("build");
    renderBuildT2iViewCards();
    renderSourceCards("imagine");
    renderCollectionFolders();
    if (state.screenId === "2nd_main") renderSecondMain();
    openScreen(state.screenId || "i_main", state.activeButtonId || "", { skipHistory: true });
    showAccountScreen(Boolean(state.accountVisible), { skipHistory: true });
  } finally {
    screen_state.historyRestoring = false;
    syncBrowserHistoryButtons();
  }
}
