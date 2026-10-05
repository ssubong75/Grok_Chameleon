// Browser history state for screen navigation

const IMAGE_EDITOR_HISTORY_CURSOR_KEY = "grokStudioImageEditorHistoryCursor";
const IMAGE_EDITOR_HISTORY_TAIL_KEY = "grokStudioImageEditorHistoryTail";

function imageEditorRoundTripHistoryState() {
  // The image editor is a separate page reached via location.replace(): the underlying
  // browser history stack survives the round trip untouched, but window.history.state does
  // not, so the cursor below would otherwise reset to 0 and the topbar back/forward buttons
  // would go dead after every editor visit. Restore the cursor this page had just before it
  // navigated away, then drop the stash so a normal reload never picks it up by accident.
  const savedCursor = sessionStorage.getItem(IMAGE_EDITOR_HISTORY_CURSOR_KEY);
  const savedTail = sessionStorage.getItem(IMAGE_EDITOR_HISTORY_TAIL_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_HISTORY_CURSOR_KEY);
  sessionStorage.removeItem(IMAGE_EDITOR_HISTORY_TAIL_KEY);
  const cursor = Number(savedCursor);
  if (!Number.isFinite(cursor)) return null;
  const tail = Number(savedTail);
  return { cursor: Math.max(0, cursor), tail: Math.max(0, Number.isFinite(tail) ? tail : cursor) };
}

const initialBrowserHistoryIndex = Number(window.history?.state?.grokStudioQHistoryIndex);
const editorRoundTripHistory = Number.isFinite(initialBrowserHistoryIndex)
  ? null
  : imageEditorRoundTripHistoryState();
let browserHistoryCursor = Number.isFinite(initialBrowserHistoryIndex)
  ? Math.max(0, initialBrowserHistoryIndex)
  : (editorRoundTripHistory ? editorRoundTripHistory.cursor : 0);
let browserHistoryTail = editorRoundTripHistory
  ? Math.max(editorRoundTripHistory.tail, browserHistoryCursor)
  : browserHistoryCursor;
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

// Folder selection happens inside one screen, so it must refresh the current history
// entry rather than add a new stop. Otherwise returning from a folder's card list lands
// on the empty Collections state that existed before the user selected the folders.
function replaceCurrentBrowserHistoryState() {
  if (
    screen_state.historyRestoring
    || !history.state?.grokStudioQ
    || !window.history?.replaceState
  ) return;
  const screenId = screen_state.current_screen || history.state.screenId || "i_main";
  const state = browserHistoryState(screenId, activeNavButtonId());
  state.grokStudioQHistoryIndex = browserHistoryCursor;
  history.replaceState(state, "", browserHistoryUrl(screenId));
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
