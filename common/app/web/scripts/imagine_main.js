// Imagine main view state and navigation helpers
const IMAGINE_MAIN_VIEWS = Object.freeze({
  IMAGINE: "imagine",
  T2I: "t2i",
  LINK: "link",
  DISCOVER: "discover",
});

const IMAGINE_MAIN_BUTTON_VIEWS = Object.freeze({
  i_imagine_tab_btn: IMAGINE_MAIN_VIEWS.IMAGINE,
  i_t2i_btn: IMAGINE_MAIN_VIEWS.T2I,
  i_link_btn: IMAGINE_MAIN_VIEWS.LINK,
});

const IMAGINE_MAIN_BUTTON_IDS = Object.freeze(Object.keys(IMAGINE_MAIN_BUTTON_VIEWS));
const IMAGINE_BRIDGE_READY_MAX_AGE_MS = 20 * 60 * 1000;
const IMAGINE_BRIDGE_STARTUP_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 12000]);
const imagineBridgePrepareStates = new Map();

function imagineBridgePrepareState(accountId) {
  const id = String(accountId || "");
  let state = imagineBridgePrepareStates.get(id);
  if (!state) {
    state = { ready: false, readyAt: 0, promise: null, retryTimer: null };
    imagineBridgePrepareStates.set(id, state);
  }
  return state;
}

function invalidateImagineBridgePreparation(accountId = "") {
  const id = String(accountId || "");
  if (id) {
    const state = imagineBridgePrepareStates.get(id);
    if (state?.retryTimer) clearTimeout(state.retryTimer);
    imagineBridgePrepareStates.delete(id);
    return;
  }
  for (const state of imagineBridgePrepareStates.values()) {
    if (state?.retryTimer) clearTimeout(state.retryTimer);
  }
  imagineBridgePrepareStates.clear();
}


function imagineMainButtonIds() {
  return IMAGINE_MAIN_BUTTON_IDS;
}

function setImagineTab(activeButtonId) {
  for (const id of IMAGINE_MAIN_BUTTON_IDS) {
    document.getElementById(id)?.classList.toggle("active", id === activeButtonId);
  }
}

function imagineMainViewForButton(buttonId) {
  return IMAGINE_MAIN_BUTTON_VIEWS[buttonId] || IMAGINE_MAIN_VIEWS.IMAGINE;
}

function openImagineMainView(buttonId = "i_imagine_tab_btn") {
  const view = imagineMainViewForButton(buttonId);
  if (view === IMAGINE_MAIN_VIEWS.LINK) {
    const input = document.getElementById("i_link_input");
    const value = String(input?.value || "").trim();
    if (value) {
      openImagineLinkPost(value);
      return;
    }
    setImagineLinkInputOpen(true, { clear: false, focus: true });
    return;
  }
  setImagineLinkInputOpen(false, { clear: false });
  library_state.iMainView = view;
  setImagineTab(buttonId);
  openScreen("i_main", "i_imagine_nav_btn");
  renderSourceCards("imagine");
}

function openImagineDiscoverMain() {
  library_state.iMainView = IMAGINE_MAIN_VIEWS.DISCOVER;
  setImagineTab("");
  setImagineLinkInputOpen(false);
  openScreen("i_discover_main", "i_discover_nav_btn");
  renderImagineDiscoverCards();
}

async function prepareActiveImagineBridgeSession({ force = false, silent = true, accountId: requestedAccountId = "" } = {}) {
  if (!library_state.apiReady) return { ok: true, status: "api_unavailable" };
  const accountId = String(requestedAccountId || account_state.imagine?.active_id || account_state.imagine?.accounts?.[0]?.id || "");
  if (!accountId) return { ok: true, status: "no_account" };
  const state = imagineBridgePrepareState(accountId);
  const readyIsFresh = state.ready
    && state.readyAt > 0
    && Date.now() - state.readyAt < IMAGINE_BRIDGE_READY_MAX_AGE_MS;
  if (!force && readyIsFresh) return { ok: true, status: "ready", cached: true, account_id: accountId };
  if (!state.promise) {
    const promise = qApi("/api/imagine/bridge/prepare", {
      account_id: accountId,
      force_refresh: Boolean(force),
    }).then((result) => {
      state.ready = result?.status === "ready";
      state.readyAt = state.ready ? Date.now() : 0;
      return result || { ok: true, status: "unknown", account_id: accountId };
    });
    state.promise = promise;
    promise.finally(() => { if (state.promise === promise) state.promise = null; }).catch(() => {});
  }
  try { return await state.promise; }
  catch (error) {
    state.ready = false;
    state.readyAt = 0;
    if (!silent) throw error;
    console.warn(error);
    return { ok: false, status: "error", account_id: accountId, error: error?.message || String(error) };
  }
}

function startImagineBridgePreparation({ accountId: requestedAccountId = "" } = {}) {
  const accountId = String(requestedAccountId || account_state.imagine?.active_id || account_state.imagine?.accounts?.[0]?.id || "");
  if (!accountId || !library_state.apiReady) return;
  const state = imagineBridgePrepareState(accountId);
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  const run = async (attempt = 0) => {
    if (!library_state.apiReady) return;
    const activeAccountId = String(account_state.imagine?.active_id || account_state.imagine?.accounts?.[0]?.id || "");
    if (activeAccountId !== accountId) return;
    const result = await prepareActiveImagineBridgeSession({ silent: true, accountId });
    if (result?.status === "ready" || attempt >= IMAGINE_BRIDGE_STARTUP_RETRY_DELAYS_MS.length) return;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      run(attempt + 1).catch((error) => console.warn(error));
    }, IMAGINE_BRIDGE_STARTUP_RETRY_DELAYS_MS[attempt]);
  };
  run().catch((error) => console.warn(error));
}

document.getElementById("i_link_input")?.addEventListener("focus", () => {
  setImagineLinkInputOpen(true, { clear: false });
});

document.getElementById("i_link_input")?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setImagineLinkInputOpen(false, { clear: false });
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  openImagineLinkPost(event.currentTarget.value || "");
});

document.addEventListener("click", (event) => {
  if (!isImagineLinkSelected()) return;
  const target = event.target;
  if (target?.closest?.("#i_link_btn, #i_link_input")) return;
  setImagineLinkInputOpen(false, { clear: false });
});
