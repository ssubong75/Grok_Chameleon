// Sidebar, top navigation, account, library path, and search events
function clearSidebarSearchQuery() {
  const hadSearch = Boolean(String(library_state.searchQuery || "").trim() || searchInput?.value);
  if (typeof setTopbarCollapsedInput === "function") setTopbarCollapsedInput("");
  if (!hadSearch) {
    searchInput?.blur();
    return false;
  }
  if (searchInput) {
    searchInput.value = "";
    searchInput.blur();
  }
  library_state.searchQuery = "";
  if (typeof renderSearchResults === "function") renderSearchResults();
  if (typeof renderSourceCards === "function") {
    renderSourceCards("build");
    renderSourceCards("imagine");
  }
  if (typeof renderBuildT2iViewCards === "function") renderBuildT2iViewCards();
  if (typeof renderPromptCards === "function") renderPromptCards();
  return true;
}

async function refreshImagineSavedMain() {
  if (typeof loadImagineSavedCards === "function" && typeof canLoadImagineSavedList === "function" && canLoadImagineSavedList()) {
    // A title click is an explicit refresh: replace any older request immediately and
    // start the fresh Saved read now. loadImagineSavedCards({ force: true }) owns that
    // cancellation and replacement.
    library_state.imagineRemoteCursor = "";
    return loadImagineSavedCards({ force: true });
  }
  renderSourceCards("imagine");
  return Promise.resolve();
}

function refreshImagineDiscoverMain() {
  if (typeof loadImagineDiscoverCards === "function" && typeof canLoadImagineSavedList === "function" && canLoadImagineSavedList()) {
    library_state.imagineDiscoverCursor = "";
    return loadImagineDiscoverCards({ force: true });
  }
  renderImagineDiscoverCards();
  return Promise.resolve();
}

function waitForRefreshPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function cardListForRefreshScreen(screenId) {
  if (screenId === "i_main") return document.querySelector(".i_card_list");
  if (screenId === "i_discover_main") return document.querySelector(".i_discover_card_list");
  if (screenId === "b_main") return document.querySelector(".b_card_list");
  if (screenId === "collection_main") return document.querySelector(".collection_1st_card_list");
  if (screenId === "2nd_main") return document.querySelector(".second_main_card_list");
  if (screenId === "prompt_main") return document.querySelector(".prompt_card_list");
  if (screenId === "search_main") return document.querySelector(".search_card_list");
  return null;
}

function showMainRefreshLoading(screenId) {
  // These screens own keyed or virtual lists. Replacing their DOM from outside the
  // renderer breaks the stable-card cache and causes the exact flash refresh is avoiding,
  // so append a loading node instead of wiping the list.
  if (["i_main", "i_discover_main", "b_main", "collection_main", "2nd_main"].includes(screenId)) {
    const list = cardListForRefreshScreen(screenId);
    // virtual_card_loading also matches the list's own paging/initial-load indicator, so this
    // skips adding a second one when that's already showing.
    if (!list || list.querySelector(":scope > .virtual_card_loading")) return;
    const loading = emptyLibraryNode("Loading . . .");
    loading.classList.add(
      "discover_loading_more",
      "virtual_card_loading",
      "imagine_title_refresh_loading",
    );
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    list.append(loading);
    return;
  }
  const list = cardListForRefreshScreen(screenId);
  if (list && typeof emptyLibraryNode === "function") {
    list.replaceChildren(emptyLibraryNode("Loading . . ."));
  }
}

function hideMainRefreshLoading(screenId) {
  cardListForRefreshScreen(screenId)
    ?.querySelector(":scope > .imagine_title_refresh_loading")
    ?.remove();
}

async function refreshLocalLibrarySnapshot() {
  if (typeof scanLibrary === "function") await scanLibrary();
}

async function refreshCurrentMainView() {
  const screenId = screen_state.account_visible ? "account" : screen_state.current_screen;
  showMainRefreshLoading(screenId);
  await waitForRefreshPaint();
  if (screenId === "account") {
    renderAccounts();
    if (typeof refreshAccounts === "function") await refreshAccounts();
    return;
  }
  if (screenId === "i_main") {
    if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) await refreshImagineSavedMain();
    else if (library_state.iMainView === imagineViewValue("LIKED", "liked") && typeof loadImagineLikedCards === "function") {
      await loadImagineLikedCards({ force: true });
    }
    else if (library_state.iMainView === imagineViewValue("UPLOAD", "upload") && typeof loadImagineUploadCards === "function") {
      await loadImagineUploadCards({ force: true });
    } else {
      await refreshLocalLibrarySnapshot();
      renderSourceCards("imagine");
    }
    return;
  }
  if (screenId === "i_discover_main") {
    await refreshImagineDiscoverMain();
    return;
  }
  if (screenId === "b_main") {
    await refreshLocalLibrarySnapshot();
    renderSourceCards("build");
    renderBuildT2iViewCards();
    if (typeof refreshBuildJobs === "function") await refreshBuildJobs();
    return;
  }
  if (screenId === "collection_main") {
    await refreshLocalLibrarySnapshot();
    renderCollectionFolders();
    return;
  }
  if (screenId === "2nd_main") {
    await refreshLocalLibrarySnapshot();
    renderSecondMain();
    return;
  }
  if (screenId === "prompt_main") {
    await refreshLocalLibrarySnapshot();
    renderPromptCards();
    return;
  }
  if (screenId === "search_main") {
    await refreshLocalLibrarySnapshot();
    renderSearchResults();
    return;
  }
  if (screenId === "i_detail" || screenId === "b_detail") {
    await refreshLocalLibrarySnapshot();
    renderDetailViews();
    return;
  }
  renderLibrary();
}

let titleRefreshInProgress = false;
document.getElementById("titleImagineBtn")?.addEventListener("click", async () => {
  if (titleRefreshInProgress) return;
  titleRefreshInProgress = true;
  const screenId = screen_state.account_visible ? "account" : screen_state.current_screen;
  try {
    const savedIsCurrentView = Boolean(
      screenId === "i_main"
      && library_state.iMainView === imagineViewValue("IMAGINE", "imagine")
    );
    showMainRefreshLoading(screenId);
    await waitForRefreshPaint();
    // The title is the global Grok Imagine refresh control. Always reconcile the
    // selected account's complete official Saved feed first, even when the user is
    // currently looking at detail, search, Liked, Upload, or another screen.
    await refreshImagineSavedMain();
    if (!savedIsCurrentView) await refreshCurrentMainView();
  } catch (error) {
    setLibraryMessage(error.message || "Refresh failed.");
  } finally {
    hideMainRefreshLoading(screenId);
    titleRefreshInProgress = false;
  }
});

let brandImagineReloading = false;
document.getElementById("brandImagineBtn")?.addEventListener("click", () => {
  if (brandImagineReloading) return;
  brandImagineReloading = true;
  const button = document.getElementById("brandImagineBtn");
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  }
  try {
    const historySnapshot = typeof browserHistoryState === "function"
      ? browserHistoryState(screen_state.current_screen, activeNavButtonId())
      : null;
    const selectedPost = typeof selectedLibraryPost === "function" ? selectedLibraryPost() : null;
    sessionStorage.setItem("grokChameleonUiReloadStateV1", JSON.stringify({
      history: historySnapshot,
      imagineActiveId: String(account_state.imagine?.active_id || ""),
      buildActiveId: String(account_state.build?.active_id || ""),
      searchQuery: String(library_state.searchQuery || searchInput?.value || ""),
      selectedPostSnapshot: selectedPost || null,
    }));
    // A renderer reload is internal navigation, not an app/window close.
    sessionStorage.setItem("grokChameleonInternalNavigation", "ui-reload");
  } catch (_) {
    // Reload still works if session storage is temporarily unavailable.
  }
  window.location.reload();
});

document.getElementById("i_imagine_nav_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  openImagineMainView("i_imagine_tab_btn");
});

document.getElementById("i_discover_nav_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  openImagineDiscoverMain();
});

document.getElementById("b_build_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  library_state.bMainView = "build";
  openScreen("b_main", "b_build_btn");
  renderSourceCards("build");
});

document.getElementById("b_t2i_view_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  library_state.bMainView = "t2i";
  openScreen("b_main", "b_build_btn");
  renderSourceCards("build");
});

document.getElementById("b_collection_filter_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  const collectionActive = library_state.bMainView === "build"
    && Boolean(library_state.buildIncludeCollections);
  library_state.bMainView = "build";
  library_state.buildIncludeCollections = !collectionActive;
  openScreen("b_main", "b_build_btn");
  renderSourceCards("build");
});

document.getElementById("b_t2i_view_back_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  library_state.bMainView = "build";
  openScreen("b_main", "b_build_btn");
  renderSourceCards("build");
});

document.getElementById("prompt_main_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  openScreen("prompt_main", "prompt_main_btn");
});

document.getElementById("account_usage_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  openUsagePage().catch((error) => setLibraryMessage(error.message || "Usage page failed."));
});

document.getElementById("library_backup_btn")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  openScreen("library_backup", "library_backup_btn");
});

document.getElementById("accountButton")?.addEventListener("click", () => {
  clearSidebarSearchQuery();
  showAccountScreen(true, { pushHistory: true });
});

document.getElementById("total_account_btn")?.addEventListener("click", () => {
  registerTotalAccount().catch((error) => setLibraryMessage(error.message || "Total account failed."));
});

document.getElementById("account_all_delete_btn")?.addEventListener("click", () => {
  deleteAllAccounts().catch((error) => setLibraryMessage(error.message || "All account delete failed."));
});

sidebarCloseBtn?.addEventListener("click", () => {
  setSidebarCollapsed(true);
});

sidebarOpenBtn?.addEventListener("click", () => {
  setSidebarCollapsed(false);
});

const compactSidebarMedia = window.matchMedia("(max-width: 1100px)");
const syncResponsiveSidebarState = (event = compactSidebarMedia) => {
  setSidebarCollapsed(Boolean(event.matches));
};
compactSidebarMedia.addEventListener("change", syncResponsiveSidebarState);
syncResponsiveSidebarState();

document.getElementById("folder_btn")?.addEventListener("click", async () => {
  if (library_state.apiReady) {
    if (library_state.rootPath) {
      const activeScreen = window.screen || {};
      await qApi("/api/open-library-folder", {
        screen_work_area: {
          left: Number(activeScreen.availLeft) || 0,
          top: Number(activeScreen.availTop) || 0,
          width: Number(activeScreen.availWidth) || 0,
          height: Number(activeScreen.availHeight) || 0,
        },
      });
    } else {
      setLibraryMessage("Set Library Path first.");
    }
    return;
  }
  if (library_state.rootHandle) {
    await scanLibrary();
  } else {
    setLibraryMessage("Set Library Path first.");
  }
});

document.getElementById("set_library_path_btn")?.addEventListener("click", async () => {
  await chooseLibraryPath();
});

for (const buttonId of imagineMainButtonIds()) {
  document.getElementById(buttonId)?.addEventListener("click", () => {
    clearSidebarSearchQuery();
    const activeButtonId = buttonId === "i_upload_image_btn"
      && library_state.iMainView === imagineViewValue("UPLOAD", "upload")
      ? "i_imagine_tab_btn"
      : buttonId;
    openImagineMainView(activeButtonId);
  });
}

const searchBtn = document.getElementById("search_btn");
const sidebarActiveButtonIdForCurrentScreen = () => {
  if (screen_state.current_screen === "i_main") return screen_state.current_i_nav_btn || "i_imagine_nav_btn";
  if (screen_state.current_screen === "i_discover_main") return "i_discover_nav_btn";
  if (screen_state.current_screen === "b_main" || screen_state.current_screen === "b_t2i_view_main") return screen_state.current_b_nav_btn || "b_build_btn";
  if (screen_state.current_screen === "collection_main" || screen_state.current_screen === "2nd_main") return "b_collection_nav_btn";
  if (screen_state.current_screen === "prompt_main") return "prompt_main_btn";
  if (screen_state.current_screen === "usage") return "account_usage_btn";
  if (screen_state.current_screen === "i_detail") return screen_state.current_i_nav_btn || "i_imagine_nav_btn";
  if (screen_state.current_screen === "b_detail") return screen_state.current_b_nav_btn || "b_build_btn";
  return "";
};

const syncSearchState = () => {
  const searching = Boolean(searchInput?.value.trim()) || document.activeElement === searchInput;
  searchBtn?.classList.toggle("active", searching);
  if (searching) {
    for (const button of navButtons) button.classList.remove("active");
    return;
  }
  const activeId = sidebarActiveButtonIdForCurrentScreen();
  for (const button of navButtons) {
    button.classList.toggle("active", button.id === activeId);
  }
};

const applySearchQuery = () => {
  library_state.searchQuery = String(searchInput?.value || "").trim();
  if (library_state.searchQuery && screen_state.account_visible) {
    showAccountScreen(false, { skipHistory: true });
  }
  if (library_state.searchQuery) {
    if (screen_state.current_screen !== "search_main") {
      openScreen("search_main", "search_btn");
    }
    renderSearchResults();
  } else if (screen_state.current_screen === "search_main") {
    const nextScreen = screen_state.current_main && screen_state.current_main !== "search_main"
      ? screen_state.current_main
      : "i_main";
    const nextButton = nextScreen.startsWith("i_")
      ? (nextScreen === "i_discover_main"
        ? "i_discover_nav_btn"
        : screen_state.current_i_nav_btn || "i_imagine_nav_btn")
      : (nextScreen.startsWith("b_") ? screen_state.current_b_nav_btn || "b_build_btn" : sidebarActiveButtonIdForCurrentScreen());
    openScreen(nextScreen, nextButton);
  }
  renderSourceCards("build");
  renderBuildT2iViewCards();
  renderSourceCards("imagine");
  renderPromptCards();
  if (screen_state.current_screen === "search_main") renderSearchResults();
  syncSearchState();
};

searchBtn?.addEventListener("click", () => {
  if (typeof setTopbarCollapsedInput === "function") setTopbarCollapsedInput("search");
  searchInput?.focus();
  if (library_state.searchQuery) {
    openScreen("search_main", "search_btn");
    renderSearchResults();
  }
  syncSearchState();
});
searchInput?.addEventListener("input", applySearchQuery);
searchInput?.addEventListener("focus", syncSearchState);
searchInput?.addEventListener("blur", () => {
  syncSearchState();
  if (!searchInput.value && typeof setTopbarCollapsedInput === "function") setTopbarCollapsedInput("");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && screen_state.account_visible) showAccountScreen(false);
});

window.addEventListener("resize", () => {
  scheduleSidebarTogglePosition();
});
