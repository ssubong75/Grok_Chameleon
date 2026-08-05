// Prompt save and account actions
  async function uniqueFileName(parentHandle, preferredStem, extension) {
    const base = safeFileStem(preferredStem);
    let name = `${base}.${extension}`;
    let index = 2;
    while (await getOptionalFile(parentHandle, name)) {
      name = `${base}-${index}.${extension}`;
      index += 1;
    }
    return name;
  }

  async function promptFileNameForSave(parentHandle, title, currentName = "") {
    const current = String(currentName || "");
    const base = safeFileStem(title);
    let name = `${base}.txt`;
    if (name === current) return current;
    let index = 2;
    while (await getOptionalFile(parentHandle, name)) {
      name = `${base}-${index}.txt`;
      if (name === current) return current;
      index += 1;
    }
    return name;
  }

  async function savePromptFromDialog() {
    const titleInput = promptSave?.querySelector(".prompt_save_title");
    const promptInput = promptSave?.querySelector(".prompt_save_original");
    const translationInput = promptSave?.querySelector(".prompt_save_translation");
    const promptText = normalizeNfcText(promptInput?.value || "").trim();
    const translationText = normalizeNfcText(translationInput?.value || "").trim();
    if (!promptText) {
      promptInput?.focus();
      return;
    }
    if (library_state.apiReady) {
      if (!library_state.rootPath) {
        await chooseLibraryPath();
        if (!library_state.rootPath) return;
      }
      const title = normalizeNfcText(titleInput?.value || "").trim() || promptTitleFromText(promptText);
      const data = await qApi("/api/prompts/save", {
        file_name: promptSave?.dataset.editFileName || "",
        title,
        text: promptText,
        translation: translationText,
      });
      closePromptSave();
      applyLibrarySnapshot(data);
      openScreen("prompt_main", "prompt_main_btn");
      return;
    }
    if (!library_state.rootHandle) {
      await chooseLibraryPath();
      if (!library_state.rootHandle) return;
    }
    const promptHandle = await library_state.rootHandle.getDirectoryHandle("prompt", { create: true });
    const title = normalizeNfcText(titleInput?.value || "").trim() || promptTitleFromText(promptText);
    const currentFileName = promptSave?.dataset.editFileName || "";
    const fileName = currentFileName
      ? await promptFileNameForSave(promptHandle, title, currentFileName)
      : await uniqueFileName(promptHandle, title, "txt");
    await writeTextFile(promptHandle, fileName, `${promptText}\n`);
    if (currentFileName && currentFileName !== fileName) {
      await promptHandle.removeEntry(currentFileName).catch(() => {});
    }
    closePromptSave();
    await scanLibrary();
    openScreen("prompt_main", "prompt_main_btn");
  }

  async function deletePrompt(fileName) {
    if (library_state.apiReady) {
      if (!fileName) return;
      const data = await qApi("/api/prompts/delete", { file_name: fileName });
      applyLibrarySnapshot(data);
      return;
    }
    if (!library_state.rootHandle || !fileName) return;
    const promptHandle = await getOptionalDirectory(library_state.rootHandle, "prompt");
    if (!promptHandle) return;
    await promptHandle.removeEntry(fileName);
    await scanLibrary();
  }

  let accountTierMenu = null;

  function closeAccountTierMenu() {
    accountTierMenu?.remove();
    accountTierMenu = null;
  }

  function confirmAction({ title = "Confirm", message = "", confirmLabel = "OK", cancelLabel = "Cancel" } = {}) {
    if (typeof openGalleryActionDialog === "function") {
      return openGalleryActionDialog({ title, message, confirmLabel, cancelLabel }).then(Boolean);
    }
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "confirm_overlay";
      overlay.innerHTML = `
        <article class="confirm_card" role="dialog" aria-modal="true">
          <h3></h3>
          <p></p>
          <div class="confirm_actions">
            <button class="confirm_cancel" type="button"></button>
            <button class="confirm_ok" type="button"></button>
          </div>
        </article>
      `;
      overlay.querySelector("h3").textContent = title;
      overlay.querySelector("p").textContent = message;
      overlay.querySelector(".confirm_cancel").textContent = cancelLabel;
      overlay.querySelector(".confirm_ok").textContent = confirmLabel;
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener("pointerdown", (event) => {
        if (event.target === overlay) close(false);
      });
      overlay.querySelector(".confirm_cancel").addEventListener("click", () => close(false));
      overlay.querySelector(".confirm_ok").addEventListener("click", () => close(true));
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close(false);
      });
      document.body.append(overlay);
      overlay.querySelector(".confirm_ok").focus({ preventScroll: true });
    });
  }

  const accountTierSortOrder = { heavy: 0, super: 1, free: 2 };

  function sortAccountCardsByPriority(provider) {
    const store = account_state[provider];
    if (!store?.accounts) return;
    const selectedId = String(store.active_id || "");
    store.accounts = [...store.accounts].sort((left, right) => {
      const leftSelected = selectedId && String(left.id || "") === selectedId ? 0 : 1;
      const rightSelected = selectedId && String(right.id || "") === selectedId ? 0 : 1;
      if (leftSelected !== rightSelected) return leftSelected - rightSelected;
      const leftTier = accountTierSortOrder[normalizeAccountTier(left.tier)] ?? 2;
      const rightTier = accountTierSortOrder[normalizeAccountTier(right.tier)] ?? 2;
      if (leftTier !== rightTier) return leftTier - rightTier;
      const leftName = String(left.email || left.label || left.id || "");
      const rightName = String(right.email || right.label || right.id || "");
      const byName = leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
      return byName || String(left.id || "").localeCompare(String(right.id || ""));
    });
  }

  async function refreshAccounts({ refreshStatuses = true } = {}) {
    if (location.protocol !== "file:") {
      const data = await tryQApi("/api/accounts");
      if (data) {
        applyAccountSnapshot(data);
        account_state.buildStatuses = {};
      } else if (library_state.rootHandle) {
        await loadAccountFiles();
        account_state.buildStatuses = {};
      } else {
        account_state.buildStatuses = {};
        renderAccounts();
      }
    } else if (library_state.rootHandle) {
      await loadAccountFiles();
      account_state.buildStatuses = {};
    } else {
      account_state.buildStatuses = {};
      renderAccounts();
    }
    sortAccountCardsByPriority("build");
    sortAccountCardsByPriority("imagine");
    renderAccounts();
    if (refreshStatuses) {
      await refreshImagineAccountStatuses();
    }
  }

  async function refreshImagineAccountStatuses() {
    const ids = account_state.imagine.accounts.map((account) => account.id).filter(Boolean);
    if (!ids.length) {
      account_state.imagineStatuses = {};
      renderAccounts();
      return;
    }
    const token = account_state.statusToken + 1;
    account_state.statusToken = token;
    account_state.imagineStatuses = Object.fromEntries(ids.map((id) => [id, { status: "checking" }]));
    renderAccounts();
    let statuses = [];
    if (library_state.apiReady) {
      const data = await qApi("/api/imagine/accounts/status", { ids });
      statuses = Array.isArray(data.statuses) ? data.statuses : [];
    } else {
      statuses = account_state.imagine.accounts.map((account) => ({
        id: account.id,
        status: validImagineCookies(account).length ? "ok" : "expired",
      }));
    }
    if (account_state.statusToken !== token) return;
    account_state.imagineStatuses = Object.fromEntries(statuses.map((item) => [
      String(item.id || ""),
      { status: String(item.status || "unknown") },
    ]));
    for (const item of statuses) {
      const id = String(item?.id || "");
      if (!item || !("tier" in item)) continue;
      const tier = normalizeAccountTier(item.tier);
      const account = account_state.imagine.accounts.find((entry) => entry.id === id);
      if (account) account.tier = tier;
    }
    sortAccountCardsByPriority("imagine");
    renderAccounts();
  }

  const imagineTierRefreshTasks = new Map();

  function refreshSelectedImagineAccountTier(accountId) {
    const id = String(accountId || "");
    if (!id || !library_state.apiReady) return Promise.resolve();
    if (imagineTierRefreshTasks.has(id)) return imagineTierRefreshTasks.get(id);
    const task = qApi("/api/imagine/account/tier", { account_id: id }).then((data) => {
      if (
        String(account_state.imagine.active_id || "") !== id
        || String(data?.imagine?.id || "") !== id
        || !data?.refreshed
      ) return;
      const account = account_state.imagine.accounts.find((item) => String(item.id || "") === id);
      if (!account) return;
      account.tier = normalizeAccountTier(data.imagine.tier);
      sortAccountCardsByPriority("imagine");
      renderAccounts();
    }).finally(() => {
      if (imagineTierRefreshTasks.get(id) === task) imagineTierRefreshTasks.delete(id);
    });
    imagineTierRefreshTasks.set(id, task);
    return task;
  }

  function activeAccount(provider) {
    const store = account_state[provider];
    if (store.active_id) {
      return store.accounts.find((account) => account.id === store.active_id) || null;
    }
    return provider === "build" ? store.accounts[0] || null : null;
  }

  function accountStatus(account, provider) {
    if (!account) return "unknown";
    if (provider === "build" && String(account.status || "") === "oauth_error") {
      return "denied";
    }
    if (provider === "imagine") {
      return account_state.imagineStatuses?.[account.id]?.status
        || account.status
        || (validImagineCookies(account).length ? "ok" : "expired");
    }
    return account_state.buildStatuses?.[account.id]?.status
      || account.status
      || activeStatusFromExpires(account.expires_at);
  }

  function accountStatusText(status) {
    if (status === "ok") return "OK";
    if (status === "expired") return "Expired";
    if (status === "checking") return "Checking";
    if (status === "denied") return "Denied";
    if (status === "login_required") return "Expired";
    if (status === "oauth_error") return "Expired";
    return "Unknown";
  }

  function accountStatusClass(status) {
    if (status === "denied") return "expired";
    if (status === "login_required" || status === "oauth_error") return "expired";
    return status || "unknown";
  }

  function setAccountSummary() {
    const build = activeAccount("build");
    const imagine = activeAccount("imagine");
    const buildStatus = accountStatus(build, "build");
    const imagineStatus = accountStatus(imagine, "imagine");
    const buildEmail = document.getElementById("accountBuildEmail");
    const buildSmall = document.getElementById("accountBuildStatus");
    const imagineEmail = document.getElementById("accountImagineEmail");
    const imagineSmall = document.getElementById("accountImagineStatus");
    if (buildEmail) buildEmail.textContent = build?.email || build?.label || "Build";
    if (buildSmall) buildSmall.textContent = accountStatusText(buildStatus);
    if (imagineEmail) imagineEmail.textContent = imagine?.email || imagine?.label || "Imagine";
    if (imagineSmall) imagineSmall.textContent = accountStatusText(imagineStatus);
  }

  function openAccountTierMenu(provider, id, anchor) {
    closeAccountTierMenu();
    const current = normalizeAccountTier(account_state[provider].accounts.find((account) => account.id === id)?.tier);
    const menu = document.createElement("div");
    menu.className = "account_tier_menu";
    menu.dataset.provider = provider;
    menu.dataset.accountId = id;
    for (const tier of accountTiers) {
      const option = document.createElement("button");
      option.className = `account_tier_option tier_${tier}${tier === current ? " active" : ""}`;
      option.type = "button";
      option.textContent = accountTierLabels[tier];
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        updateAccountTier(provider, id, tier).catch((error) => setLibraryMessage(error.message || "Account tier failed."));
      });
      menu.append(option);
    }
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuRect.width - 8));
    const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - menuRect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    accountTierMenu = menu;
  }

  function canDragAccountRow(provider, id) {
    return account_state.drag?.provider === provider && account_state.drag?.id && account_state.drag.id !== id;
  }

  function accountRow(account, provider, index = 0) {
    const row = document.createElement("article");
    const selected = account.id === account_state[provider].active_id;
    const status = accountStatus(account, provider);
    row.className = `account_row account_row_${provider}${selected ? " active" : ""}`;
    row.role = "button";
    row.tabIndex = 0;
    row.draggable = true;
    row.dataset.provider = provider;
    row.dataset.accountId = account.id;

    const tierControl = document.createElement("div");
    tierControl.className = `account_tier_control tier_${normalizeAccountTier(account.tier)}`;
    const tierBtn = document.createElement("button");
    tierBtn.className = "account_tier_btn";
    tierBtn.type = "button";
    tierBtn.textContent = accountTierLabels[normalizeAccountTier(account.tier)];
    tierBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openAccountTierMenu(provider, account.id, tierBtn);
    });
    tierControl.append(tierBtn);

    const copy = document.createElement("div");
    copy.className = "account_row_copy";
    const email = document.createElement("strong");
    email.className = "account_row_email";
    email.textContent = account.email || account.label || (provider === "build" ? "Grok account" : "Imagine");
    copy.append(email);

    const badge = document.createElement("span");
    badge.className = `account_status_badge ${accountStatusClass(status)}`;
    badge.textContent = accountStatusText(status);

    const remove = document.createElement("button");
    remove.className = "account_delete_btn account_row_delete";
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${provider} account`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteAccount(provider, account.id).catch((error) => setLibraryMessage(error.message || "Account delete failed."));
    });

    const choose = () => {
      if (provider === "build" && status === "denied") {
        return Promise.resolve();
      }
      return selectAccount(provider, account.id);
    };
    row.addEventListener("click", () => choose().catch((error) => setLibraryMessage(error.message || "Account select failed.")));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      choose().catch((error) => setLibraryMessage(error.message || "Account select failed."));
    });
    row.addEventListener("dragstart", (event) => {
      account_state.drag = { provider, id: account.id };
      event.dataTransfer?.setData("text/plain", account.id);
      event.dataTransfer?.setDragImage?.(row, 20, 20);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      account_state.drag = null;
      row.classList.remove("dragging");
      for (const item of document.querySelectorAll(".account_row.drag_over")) item.classList.remove("drag_over");
    });
    row.addEventListener("dragover", (event) => {
      if (!canDragAccountRow(provider, account.id)) return;
      event.preventDefault();
      row.classList.add("drag_over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag_over"));
    row.addEventListener("drop", (event) => {
      if (!canDragAccountRow(provider, account.id)) return;
      event.preventDefault();
      event.stopPropagation();
      row.classList.remove("drag_over");
      reorderAccount(provider, account_state.drag.id, account.id).catch((error) => setLibraryMessage(error.message || "Account reorder failed."));
    });
    row.append(tierControl, copy, badge, remove);
    return row;
  }

  function fitAccountRowsToScreen() {
    const account = document.getElementById("account");
    if (!account || account.hidden) return;
    const accountRect = account.getBoundingClientRect();
    const accountStyle = getComputedStyle(account);
    const bottomPadding = parseFloat(accountStyle.paddingBottom || "0") || 0;
    const maxBottom = accountRect.bottom - bottomPadding;
    for (const body of document.querySelectorAll(".account_column_body")) {
      const firstRow = body.querySelector(".account_row");
      if (!firstRow) {
        body.style.maxHeight = "";
        body.dataset.visibleRows = "0";
        continue;
      }
      const bodyRect = body.getBoundingClientRect();
      const rowRect = firstRow.getBoundingClientRect();
      const bodyStyle = getComputedStyle(body);
      const gap = parseFloat(bodyStyle.rowGap || bodyStyle.gap || "0") || 0;
      const rowHeight = Math.round(rowRect.height);
      const available = Math.max(0, maxBottom - bodyRect.top);
      const visibleRows = Math.max(1, Math.floor((available + gap) / (rowHeight + gap)));
      const maxHeight = (visibleRows * rowHeight) + (Math.max(0, visibleRows - 1) * gap);
      body.style.maxHeight = `${Math.round(maxHeight)}px`;
      body.dataset.visibleRows = String(visibleRows);
    }
  }

  function scheduleAccountRowsFit() {
    requestAnimationFrame(fitAccountRowsToScreen);
  }

  function accountCardCount() {
    return account_state.imagine.accounts.length + account_state.build.accounts.length;
  }

  function syncAccountAllDeleteButton() {
    const button = document.getElementById("account_all_delete_btn");
    if (!button) return;
    const count = accountCardCount();
    const busy = button.dataset.busy === "true";
    button.disabled = busy || count === 0;
    button.title = count ? `Delete all ${count} account cards` : "No accounts to delete";
  }

  function renderAccounts() {
    setAccountSummary();
    syncAccountAllDeleteButton();
    const list = document.querySelector(".account_list");
    if (!list) return;
    list.replaceChildren(
      accountColumn("imagine", account_state.imagine.accounts),
      accountColumn("build", account_state.build.accounts),
    );
    scheduleAccountRowsFit();
    if (typeof renderComposerOptions === "function") renderComposerOptions();
    if (screen_state.current_screen === "i_detail" && typeof syncImagineDetailToolButtons === "function") {
      const post = selectedLibraryPost();
      const item = selectedDetailItem(post);
      syncImagineDetailToolButtons(detailItemType(item), item, post);
    }
  }

  function accountColumn(provider, accounts) {
    const section = document.createElement("section");
    section.className = "account_column";
    const header = document.createElement("div");
    header.className = `account_column_header account_column_header_${provider}`;
    header.textContent = provider === "imagine" ? "Imagine" : "Build";
    const body = document.createElement("div");
    body.className = "account_column_body";
    body.dataset.provider = provider;
    body.addEventListener("dragover", (event) => {
      if (account_state.drag?.provider !== provider) return;
      event.preventDefault();
    });
    body.addEventListener("drop", (event) => {
      if (account_state.drag?.provider !== provider) return;
      event.preventDefault();
      reorderAccount(provider, account_state.drag.id, "").catch((error) => setLibraryMessage(error.message || "Account reorder failed."));
    });
    body.append(...accounts.map((account, index) => accountRow(account, provider, index)));
    section.append(header, body);
    return section;
  }

  function imagineAttachmentAccountId(attachment) {
    const metadata = attachment?.metadata && typeof attachment.metadata === "object" ? attachment.metadata : {};
    const imagine = metadata.imagine && typeof metadata.imagine === "object" ? metadata.imagine : {};
    return String(attachment?.account_id || metadata.account_id || imagine.account_id || "").trim();
  }

  function clearImagineAccountScopedCache(nextAccountId = "") {
    const selectedPath = String(library_state.selectedPostPath || "");
    const selectedPost = typeof selectedLibraryPost === "function" ? selectedLibraryPost() : null;
    const selectedRemoteImagine = Boolean(
      selectedPath.startsWith("imagine_")
      || selectedPost?.area === "imagine_remote"
      || selectedPost?.folder_path?.startsWith?.("imagine_")
    );
    library_state.imagineRemoteRequestController?.abort?.();
    library_state.imagineRemoteRequestEpoch = Number(library_state.imagineRemoteRequestEpoch || 0) + 1;
    library_state.imagineRemoteRequestController = null;
    if (library_state.imagineRemoteSyncTimer) {
      clearTimeout(library_state.imagineRemoteSyncTimer);
      library_state.imagineRemoteSyncTimer = 0;
    }
    library_state.imagineRemoteSyncTimerResolve?.();
    library_state.imagineRemoteSyncTimerResolve = null;
    library_state.imagineRemoteSyncPromise = null;
    library_state.imagineRemoteAccountId = String(nextAccountId || "");
    library_state.imagineRemotePosts = [];
    library_state.imagineRemoteLoaded = false;
    library_state.imagineRemoteLoading = false;
    library_state.imagineRemoteSyncing = false;
    library_state.imagineRemoteError = "";
    library_state.imagineRemoteCursor = "";
    library_state.imagineRemoteHasMore = false;
    library_state.imagineRemoteCacheLoaded = false;
    library_state.imagineRemoteCacheOffset = 0;
    library_state.imagineRemoteCacheHasMore = false;
    library_state.imagineRemoteSyncToken = "";
    library_state.imagineDiscoverPosts = [];
    library_state.imagineDiscoverLoaded = false;
    library_state.imagineDiscoverLoading = false;
    library_state.imagineDiscoverError = "";
    library_state.imagineDiscoverCursor = "";
    library_state.imagineDiscoverHasMore = false;
    library_state.imagineUnsavedPosts = [];
    library_state.imagineUnsavedLoaded = false;
    library_state.imagineUnsavedLoading = false;
    library_state.imagineUnsavedError = "";
    library_state.imagineUnsavedCursor = "";
    library_state.imagineUnsavedHasMore = false;
    library_state.imagineUploadPosts = [];
    library_state.imagineUploadLoaded = false;
    library_state.imagineUploadLoading = false;
    library_state.imagineUploadError = "";
    library_state.imagineUploadCursor = "";
    library_state.imagineUploadHasMore = false;
    library_state.imagineJobs = [];
    library_state.selectedImagineJobId = "";
    library_state.imagineHiddenRemotePostIds = new Set();
    for (let index = composerAttachments.length - 1; index >= 0; index -= 1) {
      const accountId = imagineAttachmentAccountId(composerAttachments[index]);
      if (!accountId || accountId === nextAccountId) continue;
      if (typeof removeComposerAttachmentAt === "function") {
        removeComposerAttachmentAt(index, { markDismissed: false });
      } else {
        composerAttachments.splice(index, 1);
      }
    }
    if (selectedRemoteImagine) {
      library_state.selectedPostPath = "";
      library_state.selectedDetailItemId = "";
      if (screen_state.current_screen === "i_detail") {
        openScreen("i_main", screen_state.current_i_nav_btn || "i_imagine_nav_btn");
      }
    }
    if (typeof syncImagineRemotePostsIntoLibrary === "function") syncImagineRemotePostsIntoLibrary();
    if (typeof renderComposerAttachments === "function") renderComposerAttachments();
    if (typeof renderLibrary === "function") renderLibrary();
  }

  async function selectAccount(provider, id) {
    const previousId = provider === "imagine" ? String(account_state.imagine.active_id || "") : "";
    const nextId = String(id || "");
    const imagineAccountChanged = provider === "imagine" && previousId !== nextId;
    if (library_state.apiReady) {
      const data = await qApi(provider === "imagine" ? "/api/imagine/select" : "/api/accounts/select", { id });
      applyAccountSnapshot(data);
      sortAccountCardsByPriority(provider);
      if (imagineAccountChanged) {
        clearImagineAccountScopedCache(nextId);
        if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation();
      }
      setComposerProvider(provider);
      renderAccounts();
      if (provider === "imagine") {
        refreshSelectedImagineAccountTier(nextId).catch((error) => console.warn(error));
      }
      if (provider === "imagine" && typeof prepareActiveImagineBridgeSession === "function") {
        prepareActiveImagineBridgeSession({ force: imagineAccountChanged, accountId: nextId }).catch((error) => console.warn(error));
      }
      if (provider === "imagine" && typeof warmActiveImagineUsage === "function") warmActiveImagineUsage();
      return;
    }
    const store = account_state[provider];
    const account = store.accounts.find((entry) => entry.id === id);
    if (!account) return;
    store.active_id = id;
    sortAccountCardsByPriority(provider);
    await persistAccountFiles();
    if (imagineAccountChanged) {
      clearImagineAccountScopedCache(nextId);
      if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation();
    }
    setComposerProvider(provider);
    renderAccounts();
    if (provider === "imagine" && typeof prepareActiveImagineBridgeSession === "function") {
      prepareActiveImagineBridgeSession({ force: imagineAccountChanged, accountId: nextId }).catch((error) => console.warn(error));
    }
    if (provider === "imagine" && typeof warmActiveImagineUsage === "function") warmActiveImagineUsage();
  }

  async function deleteAccount(provider, id) {
    const store = account_state[provider];
    const account = store.accounts.find((item) => item.id === id);
    const label = account?.email || account?.label || (provider === "imagine" ? "Imagine account" : "Build account");
    const previousImagineId = provider === "imagine" ? String(account_state.imagine.active_id || "") : "";
    const confirmed = await confirmAction({
      title: "Delete account",
      message: `Delete ${label}?`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    if (library_state.apiReady) {
      const data = await qApi(provider === "imagine" ? "/api/imagine/delete" : "/api/accounts/delete", { id });
      applyAccountSnapshot(data);
      if (provider === "imagine" && previousImagineId === String(id || "")) {
        const accountId = String(account_state.imagine.active_id || "");
        clearImagineAccountScopedCache(accountId);
        if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation(accountId);
        if (accountId && typeof prepareActiveImagineBridgeSession === "function") {
          prepareActiveImagineBridgeSession({ force: true, accountId }).catch((error) => console.warn(error));
        }
      }
      renderAccounts();
      return;
    }
    store.accounts = store.accounts.filter((account) => account.id !== id);
    if (store.active_id === id) store.active_id = provider === "build" ? store.accounts[0]?.id || "" : "";
    await persistAccountFiles();
    if (provider === "imagine" && previousImagineId === String(id || "")) {
      clearImagineAccountScopedCache(String(account_state.imagine.active_id || ""));
    }
    renderAccounts();
  }

  async function deleteAllAccounts() {
    const imagineCount = account_state.imagine.accounts.length;
    const buildCount = account_state.build.accounts.length;
    const totalCount = imagineCount + buildCount;
    if (!totalCount) return;
    const confirmed = await confirmAction({
      title: "Delete all accounts",
      message: `Delete all ${totalCount} account cards (${imagineCount} Imagine, ${buildCount} Build)? This cannot be undone.`,
      confirmLabel: "All Delete",
    });
    if (!confirmed) return;

    const button = document.getElementById("account_all_delete_btn");
    const previous = {
      build: { ...account_state.build, accounts: [...account_state.build.accounts] },
      imagine: { ...account_state.imagine, accounts: [...account_state.imagine.accounts] },
      buildStatuses: { ...account_state.buildStatuses },
      imagineStatuses: { ...account_state.imagineStatuses },
      statusToken: account_state.statusToken,
    };
    if (button) {
      button.dataset.busy = "true";
      button.textContent = "Deleting...";
      button.disabled = true;
    }
    account_state.build.accounts = [];
    account_state.build.active_id = "";
    account_state.imagine.accounts = [];
    account_state.imagine.active_id = "";
    account_state.buildStatuses = {};
    account_state.imagineStatuses = {};
    account_state.statusToken += 1;
    try {
      await persistAccountFiles();
      clearImagineAccountScopedCache("");
      renderAccounts();
    } catch (error) {
      account_state.build = previous.build;
      account_state.imagine = previous.imagine;
      account_state.buildStatuses = previous.buildStatuses;
      account_state.imagineStatuses = previous.imagineStatuses;
      account_state.statusToken = previous.statusToken;
      renderAccounts();
      throw error;
    } finally {
      if (button) {
        button.dataset.busy = "false";
        button.textContent = "All Delete";
      }
      syncAccountAllDeleteButton();
    }
  }

  async function updateAccountTier(provider, id, tier) {
    closeAccountTierMenu();
    const store = account_state[provider];
    const account = store.accounts.find((item) => item.id === id);
    if (!account) return;
    const next = normalizeAccountTier(tier);
    if (library_state.apiReady) {
      const data = await qApi("/api/accounts/tier", { provider, id, tier: next });
      applyAccountSnapshot(data);
      sortAccountCardsByPriority(provider);
      renderAccounts();
      return;
    }
    account.tier = next;
    sortAccountCardsByPriority(provider);
    await persistAccountFiles();
    renderAccounts();
  }

  async function reorderAccount(provider, draggedId, targetId = "") {
    const store = account_state[provider];
    const accounts = [...store.accounts];
    const from = accounts.findIndex((account) => account.id === draggedId);
    if (from < 0) return;
    const targetIndex = targetId ? accounts.findIndex((account) => account.id === targetId) : -1;
    const [dragged] = accounts.splice(from, 1);
    let to = targetId ? accounts.findIndex((account) => account.id === targetId) : accounts.length;
    if (to < 0) to = accounts.length;
    if (targetIndex >= 0 && from < targetIndex) to += 1;
    accounts.splice(to, 0, dragged);
    store.accounts = accounts;
    renderAccounts();
    if (library_state.apiReady) {
      const data = await qApi(provider === "imagine" ? "/api/imagine/reorder" : "/api/accounts/reorder", {
        ids: accounts.map((account) => account.id),
      });
      applyAccountSnapshot(data);
      renderAccounts();
      return;
    }
    await persistAccountFiles();
    renderAccounts();
  }

  document.addEventListener("pointerdown", (event) => {
    if (!accountTierMenu) return;
    if (event.target instanceof Element && accountTierMenu.contains(event.target)) return;
    closeAccountTierMenu();
  }, { capture: true });

  async function chooseJsonFile() {
    if (!window.showOpenFilePicker) return null;
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "JSON",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    if (!handle) return null;
    const file = await handle.getFile();
    const text = await file.text();
    return { name: file.name, raw: JSON.parse(text) };
  }

  async function registerBuildAccount() {
    if (!library_state.rootPath && !library_state.rootHandle) {
      await chooseLibraryPath();
      if (!library_state.rootPath && !library_state.rootHandle) return;
    }
    const labelInput = document.getElementById("build_auth_path_input");
    const pathText = String(labelInput?.value || "").trim();
    if (library_state.apiReady) {
      const looksLikePath = /[\\/]/.test(pathText) || /\.json$/i.test(pathText) || pathText.startsWith("~");
      const data = await qApi("/api/accounts/register", looksLikePath ? { auth_file: pathText } : { label: pathText });
      applyAccountSnapshot(data);
      sortAccountCardsByPriority("build");
      renderAccounts();
      return;
    }
    const bridge = window.grokStudioAccount || window.grokStudio;
    let chosen = null;
    if (bridge?.registerBuildAuth) {
      const result = await bridge.registerBuildAuth(pathText);
      chosen = {
        name: result?.source_name || result?.auth_file || pathText || "build_auth.json",
        raw: result?.auth || result,
      };
    } else {
      chosen = await chooseJsonFile();
    }
    if (!chosen?.raw) return;
    if (labelInput) labelInput.value = chosen.name;
    const account = buildAccountFromAuth(chosen.raw, chosen.name, labelInput?.value || "");
    account_state.build.accounts = [
      account,
      ...account_state.build.accounts.filter((item) => item.email !== account.email || !account.email),
    ];
    account_state.build.active_id = account.id;
    sortAccountCardsByPriority("build");
    await persistAccountFiles();
    renderAccounts();
  }

  async function registerTotalAccount() {
    if (!library_state.rootPath && !library_state.rootHandle) {
      await chooseLibraryPath();
      if (!library_state.rootPath && !library_state.rootHandle) return;
    }
    const button = document.getElementById("total_account_btn");
    if (button) {
      button.disabled = true;
      button.textContent = "Total Account";
    }
    try {
      const data = await qApi("/api/accounts/total/register", {});
      applyAccountSnapshot(data);
      sortAccountCardsByPriority("build");
      sortAccountCardsByPriority("imagine");
      clearImagineAccountScopedCache(String(account_state.imagine.active_id || ""));
      renderAccounts();
      const accountId = String(account_state.imagine.active_id || "");
      if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation(accountId);
      if (typeof prepareActiveImagineBridgeSession === "function") {
        prepareActiveImagineBridgeSession({ force: true, accountId }).catch((error) => console.warn(error));
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Total Account";
      }
    }
  }

  async function startImagineLogin() {
    if (library_state.apiReady) {
      const data = await qApi("/api/imagine/login/start", {});
      applyAccountSnapshot(data);
      return;
    }
    const bridge = window.grokStudioAccount || window.grokStudio;
    if (bridge?.startImagineLogin) {
      await bridge.startImagineLogin();
      return;
    }
    window.open("https://grok.com/imagine", "grokImagineLogin", "width=960,height=760");
  }

  async function captureImagineAccount() {
    if (!library_state.rootPath && !library_state.rootHandle) {
      await chooseLibraryPath();
      if (!library_state.rootPath && !library_state.rootHandle) return;
    }
    if (library_state.apiReady) {
      const data = await qApi("/api/imagine/login/capture", {});
      applyAccountSnapshot(data);
      sortAccountCardsByPriority("imagine");
      const accountId = String(account_state.imagine.active_id || "");
      clearImagineAccountScopedCache(accountId);
      if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation(accountId);
      if (typeof prepareActiveImagineBridgeSession === "function") prepareActiveImagineBridgeSession({ force: true, accountId }).catch((error) => console.warn(error));
      renderAccounts();
      return;
    }
    const bridge = window.grokStudioAccount || window.grokStudio;
    let raw = null;
    if (bridge?.captureImagineLogin) {
      raw = await bridge.captureImagineLogin();
    } else {
      const chosen = await chooseJsonFile();
      if (!chosen) return;
      raw = chosen.raw;
    }
    const account = normalizeImagineAccount(imagineAccountFromSession(raw, raw?.source_url || "https://grok.com/imagine"));
    account_state.imagine.accounts = [
      account,
      ...account_state.imagine.accounts.filter((item) => item.id !== account.id && (!account.email || item.email !== account.email)),
    ];
    account_state.imagine.active_id = account.id;
    sortAccountCardsByPriority("imagine");
    await persistAccountFiles();
    clearImagineAccountScopedCache(account.id);
    if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation(account.id);
    if (typeof prepareActiveImagineBridgeSession === "function") prepareActiveImagineBridgeSession({ force: true, accountId: account.id }).catch((error) => console.warn(error));
    if (typeof warmActiveImagineUsage === "function") warmActiveImagineUsage();
    renderAccounts();
  }

  async function logoutImagineAccount() {
    if (library_state.apiReady) {
      const data = await qApi("/api/imagine/logout", {});
      applyAccountSnapshot(data);
      sortAccountCardsByPriority("imagine");
      clearImagineAccountScopedCache("");
      if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation();
      renderAccounts();
      return;
    }
    const bridge = window.grokStudioAccount || window.grokStudio;
    if (bridge?.logoutImagine) await bridge.logoutImagine();
    account_state.imagine.active_id = "";
    sortAccountCardsByPriority("imagine");
    await persistAccountFiles();
    clearImagineAccountScopedCache("");
    if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation();
    renderAccounts();
  }

  window.fitAccountRowsToScreen = fitAccountRowsToScreen;
  window.addEventListener("resize", scheduleAccountRowsFit);
