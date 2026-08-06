// Screen routing and account/usage overlays

function activeNavButtonId() {
  return navButtons.find((button) => button.classList.contains("active"))?.id || "";
}

function showAccountScreen(show, options = {}) {
  const visible = Boolean(show);
  const accountScreen = document.getElementById("account");
  screen_state.account_visible = visible;
  if (accountScreen) accountScreen.hidden = !visible;
  workspace?.classList.toggle("show_account", visible);
  document.getElementById("accountButton")?.classList.toggle("active", visible);
  if (visible) {
    closePromptSave();
    renderAccounts();
    refreshAccounts({ refreshStatuses: true }).catch((error) => setLibraryMessage(error.message || "Account refresh failed."));
    accountScreen?.focus({ preventScroll: true });
    if (options.pushHistory) writeBrowserHistory(screen_state.current_screen, activeNavButtonId());
  } else if (!options.skipHistory && history.state?.grokStudioQ && history.state.accountVisible) {
    history.replaceState(
      browserHistoryState(screen_state.current_screen, activeNavButtonId()),
      "",
      browserHistoryUrl(screen_state.current_screen),
    );
  }
}

function openScreen(screenId, activeButtonId = "", options = {}) {
  const previousScreenId = screen_state.current_screen;
  if (screenId === "b_t2i_view_main") {
    library_state.bMainView = "t2i";
    screenId = "b_main";
    activeButtonId = activeButtonId || "b_build_btn";
  }
  showAccountScreen(false, { skipHistory: true });
  closePromptSave();
  screen_state.current_screen = screenId;

  for (const screen of screens) {
    screen.hidden = screen.id !== screenId;
  }
  pauseHiddenDetailVideos();

  for (const id of screenIds) {
    workspace?.classList.toggle(`${id}_open`, id === screenId);
  }

  for (const button of navButtons) {
    button.classList.toggle("active", button.id === activeButtonId);
  }

  if (["i_main", "i_discover_main", "b_main", "b_t2i_view_main", "collection_main", "2nd_main"].includes(screenId)) {
    screen_state.current_main = screenId;
  }

  if (activeButtonId.startsWith("i_")) screen_state.current_i_nav_btn = activeButtonId;
  if (activeButtonId.startsWith("b_")) screen_state.current_b_nav_btn = activeButtonId;

  setComposerProvider(providerForScreen(screenId, activeButtonId));
  setComposerMode(modeForNavButton(activeButtonId) || composerState.mode);
  if (screenId !== "i_detail" && screenId !== "b_detail" && typeof clearDetailAutoComposerAttachments === "function") {
    clearDetailAutoComposerAttachments();
  }
  if ((screenId === "i_detail" || screenId === "b_detail") && typeof syncDetailAttachmentForComposerTray === "function") {
    syncDetailAttachmentForComposerTray().catch((error) => console.warn(error));
  }
  if (screenId === "2nd_main") renderSecondMain();
  if (screenId === "i_detail" || screenId === "b_detail") syncComposerPromptFromDetail();
  if (screenId === "i_detail" || screenId === "b_detail") playActiveDetailVideoIfSelected();
  if (screenId === "i_detail" || screenId === "b_detail") updateDetailPostNavigationButtons();
  if (screenId === "collection_main") scheduleCollectionRows();
  if (typeof scheduleScreenVirtualCardList === "function") scheduleScreenVirtualCardList(screenId);
  if ((screenId === "i_main" || screenId === "i_discover_main") && typeof prepareActiveImagineBridgeSession === "function") {
    prepareActiveImagineBridgeSession().catch((error) => console.warn(error));
  }
  if (typeof syncCardSelectionControls === "function") syncCardSelectionControls();
  const historyOptions = (
    previousScreenId === screenId
    && (screenId === "i_detail" || screenId === "b_detail")
    && !options.skipHistory
  ) ? { ...options, replaceHistory: true } : options;
  writeBrowserHistory(screenId, activeButtonId, historyOptions);
}

function usagePopupFeatures(width = 560, height = 760) {
  const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || width) - width) / 2));
  const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || height) - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}

let lastWarmedImagineUsageAccount = "";
let warmImagineUsageTimer = null;

function activeImagineUsagePayload() {
  const accountId = account_state.imagine?.active_id || "";
  const accounts = account_state.imagine?.accounts || [];
  const account = accounts.find((item) => item.id === accountId) || accounts[0];
  if (!account) return null;
  return {
    account_id: account.id,
    account_email: account.email || "",
    cookies: validImagineCookies(account),
  };
}

function warmActiveImagineUsage() {
  const payload = activeImagineUsagePayload();
  if (!payload || !window.grokChameleonNative?.warmImagineUsage) return;
  const key = `${payload.account_id}:${payload.cookies.length}`;
  if (key === lastWarmedImagineUsageAccount) return;
  lastWarmedImagineUsageAccount = key;
  clearTimeout(warmImagineUsageTimer);
  warmImagineUsageTimer = setTimeout(() => {
    window.grokChameleonNative.warmImagineUsage(payload).catch(() => {});
  }, 250);
}

async function openUsagePage() {
  const payload = activeImagineUsagePayload();
  const account = payload ? { id: payload.account_id } : null;
  if (account && window.grokChameleonNative?.openImagineUsage) {
    await window.grokChameleonNative.openImagineUsage(payload);
    return;
  }
  if (library_state.apiReady && payload?.account_id) {
    await qApi("/api/imagine/usage-page", { account_id: payload.account_id });
    return;
  }
  window.open("https://grok.com/?_s=usage", "grokUsagePage", usagePopupFeatures());
}
