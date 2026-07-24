// Sidebar, top navigation, account, library path, and search events
function clearSidebarSearchQuery() {
  const hadSearch = Boolean(String(library_state.searchQuery || "").trim() || searchInput?.value);
  if (!hadSearch) return false;
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

function refreshImagineSavedMain() {
  if (typeof loadImagineSavedCards === "function" && typeof canLoadImagineSavedList === "function" && canLoadImagineSavedList()) {
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

function refreshImagineUnsavedMain() {
  if (typeof loadImagineUnsavedCards === "function" && typeof canLoadImagineSavedList === "function" && canLoadImagineSavedList()) {
    library_state.imagineUnsavedCursor = "";
    return loadImagineUnsavedCards({ force: true });
  }
  renderImagineUnsavedCards();
  return Promise.resolve();
}

function waitForRefreshPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function cardListForRefreshScreen(screenId) {
  if (screenId === "i_main") return document.querySelector(".i_card_list");
  if (screenId === "i_discover_main") return document.querySelector(".i_discover_card_list");
  if (screenId === "i_unsaved_main") return document.querySelector(".i_unsaved_card_list");
  if (screenId === "b_main") return document.querySelector(".b_card_list");
  if (screenId === "collection_main") return document.querySelector(".collection_1st_card_list");
  if (screenId === "2nd_main") return document.querySelector(".second_main_card_list");
  if (screenId === "prompt_main") return document.querySelector(".prompt_card_list");
  if (screenId === "search_main") return document.querySelector(".search_card_list");
  return null;
}

function showMainRefreshLoading(screenId) {
  const list = cardListForRefreshScreen(screenId);
  if (list && typeof emptyLibraryNode === "function") {
    list.replaceChildren(emptyLibraryNode("Loading . . ."));
  }
}

async function refreshLocalLibrarySnapshot() {
  if (typeof restoreLibraryRoot === "function") await restoreLibraryRoot();
}

async function refreshCurrentMainView() {
  const screenId = screen_state.account_visible ? "account" : screen_state.current_screen;
  showMainRefreshLoading(screenId);
  await waitForRefreshPaint();
  if (screenId === "account") {
    renderAccounts();
    if (typeof refreshAccounts === "function") await refreshAccounts({ refreshStatuses: true });
    return;
  }
  if (screenId === "i_main") {
    if (library_state.iMainView === imagineViewValue("IMAGINE", "imagine")) await refreshImagineSavedMain();
    else {
      await refreshLocalLibrarySnapshot();
      renderSourceCards("imagine");
    }
    return;
  }
  if (screenId === "i_discover_main") {
    await refreshImagineDiscoverMain();
    return;
  }
  if (screenId === "i_unsaved_main") {
    await refreshImagineUnsavedMain();
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

function reloadAppFromStart() {
  try {
    sessionStorage.setItem("grokChameleonInternalNavigation", "1");
  } catch {}
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.set("launch", String(Date.now()));
  location.assign(url.href);
}

document.getElementById("titleImagineBtn")?.addEventListener("click", () => {
  refreshCurrentMainView().catch((error) => setLibraryMessage(error.message || "Refresh failed."));
});

document.getElementById("brandImagineBtn")?.addEventListener("click", () => {
  reloadAppFromStart();
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

document.getElementById("folder_btn")?.addEventListener("click", async () => {
  if (library_state.apiReady) {
    if (library_state.rootPath) {
      await qApi("/api/open-library-folder", {});
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
    openImagineMainView(buttonId);
  });
}

const searchBtn = document.getElementById("search_btn");
const sidebarActiveButtonIdForCurrentScreen = () => {
  if (screen_state.current_screen === "i_main") return screen_state.current_i_nav_btn || "i_imagine_nav_btn";
  if (screen_state.current_screen === "i_discover_main") return "i_discover_nav_btn";
  if (screen_state.current_screen === "i_unsaved_main") return "i_unsaved_nav_btn";
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
        : (nextScreen === "i_unsaved_main" ? "i_unsaved_nav_btn" : screen_state.current_i_nav_btn || "i_imagine_nav_btn"))
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
  searchInput?.focus();
  if (library_state.searchQuery) {
    openScreen("search_main", "search_btn");
    renderSearchResults();
  }
  syncSearchState();
});
searchInput?.addEventListener("input", applySearchQuery);
searchInput?.addEventListener("focus", syncSearchState);
searchInput?.addEventListener("blur", syncSearchState);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && screen_state.account_visible) showAccountScreen(false);
});

window.addEventListener("resize", () => {
  scheduleSidebarTogglePosition();
});
