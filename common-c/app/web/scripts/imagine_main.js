// Imagine main view state and navigation helpers
const IMAGINE_MAIN_VIEWS = Object.freeze({
  IMAGINE: "imagine",
  UPLOAD: "upload",
  T2I: "t2i",
  LIKED: "liked",
  LINK: "link",
  DISCOVER: "discover",
});

const IMAGINE_MAIN_BUTTON_VIEWS = Object.freeze({
  i_imagine_tab_btn: IMAGINE_MAIN_VIEWS.IMAGINE,
  i_upload_image_btn: IMAGINE_MAIN_VIEWS.LIKED,
  i_t2i_btn: IMAGINE_MAIN_VIEWS.T2I,
  i_link_btn: IMAGINE_MAIN_VIEWS.LINK,
});

const IMAGINE_MAIN_BUTTON_IDS = Object.freeze(Object.keys(IMAGINE_MAIN_BUTTON_VIEWS));
const IMAGINE_BRIDGE_STARTUP_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 12000]);
// A normal warm-up settles well inside this; past it the account row alone no longer
// explains the wait, so say so rather than leaving the user guessing.
const IMAGINE_BRIDGE_SLOW_PREPARE_NOTICE_MS = 10000;
const imagineBridgePrepareStates = new Map();

function imagineBridgePrepareState(accountId) {
  const id = String(accountId || "");
  let state = imagineBridgePrepareStates.get(id);
  if (!state) {
    state = { ready: false, readyAt: 0, promise: null, retryTimer: null, controller: null };
    imagineBridgePrepareStates.set(id, state);
  }
  return state;
}

function invalidateImagineBridgePreparation(accountId = "") {
  const id = String(accountId || "");
  if (id) {
    const state = imagineBridgePrepareStates.get(id);
    if (state?.retryTimer) clearTimeout(state.retryTimer);
    if (state?.controller) {
      try {
        state.controller.abort();
      } catch (_) {}
    }
    imagineBridgePrepareStates.delete(id);
    return;
  }
  for (const state of imagineBridgePrepareStates.values()) {
    if (state?.retryTimer) clearTimeout(state.retryTimer);
    if (state?.controller) {
      try {
        state.controller.abort();
      } catch (_) {}
    }
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
  let view = imagineMainViewForButton(buttonId);
  // Liked is a toggle: pressing it while it is already showing goes back to Imagine.
  if (view === IMAGINE_MAIN_VIEWS.LIKED && library_state.iMainView === IMAGINE_MAIN_VIEWS.LIKED) {
    view = IMAGINE_MAIN_VIEWS.IMAGINE;
    buttonId = "i_imagine_tab_btn";
  }
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
  if (view === IMAGINE_MAIN_VIEWS.UPLOAD && typeof loadImagineUploadCards === "function") {
    loadImagineUploadCards({ force: true }).catch((error) => {
      library_state.imagineUploadError = error?.message || "Imagine uploads failed.";
      library_state.imagineUploadLoading = false;
      renderSourceCards("imagine");
    });
  }
  if (view === IMAGINE_MAIN_VIEWS.LIKED && typeof loadImagineLikedCards === "function") {
    loadImagineLikedCards({ force: true }).catch((error) => {
      library_state.imagineLikedError = error?.message || "Imagine liked failed.";
      library_state.imagineLikedLoading = false;
      renderSourceCards("imagine");
    });
  }
}

function openImagineDiscoverMain() {
  library_state.iMainView = IMAGINE_MAIN_VIEWS.DISCOVER;
  setImagineTab("");
  setImagineLinkInputOpen(false);
  openScreen("i_discover_main", "i_discover_nav_btn");
  renderImagineDiscoverCards();
}

function imagineAccountIsPreparing(accountId) {
  const id = String(accountId || "");
  if (!id) return false;
  return Boolean(imagineBridgePrepareStates.get(id)?.promise);
}

function notifyImaginePrepareStateChanged() {
  if (typeof renderAccounts === "function") {
    try {
      renderAccounts();
    } catch (error) {
      console.warn(error);
    }
  }
}

// The main process abandons the previous account's warm-up when a new one starts, so
// stop waiting on it here too. The abandoned account keeps no timers and is prepared
// again only when the user selects it.
function abandonOtherImaginePreparations(accountId) {
  const keep = String(accountId || "");
  for (const [id, state] of imagineBridgePrepareStates.entries()) {
    if (id === keep) continue;
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
    if (state.controller) {
      try {
        state.controller.abort();
      } catch (_) {}
      state.controller = null;
    }
    state.promise = null;
    state.ready = false;
    state.readyAt = 0;
  }
}

async function prepareActiveImagineBridgeSession({ force = false, revalidate = false, silent = true, accountId: requestedAccountId = "" } = {}) {
  if (!library_state.apiReady) return { ok: true, status: "api_unavailable" };
  const accountId = String(requestedAccountId || account_state.imagine?.active_id || account_state.imagine?.accounts?.[0]?.id || "");
  if (!accountId) return { ok: true, status: "no_account" };
  const state = imagineBridgePrepareState(accountId);
  // An open bridge window with a live media store does not go stale on a clock, so this only
  // records that preparation has succeeded at least once. Electron rechecks the store on
  // every call and rebuilds when it is actually gone.
  const readyIsFresh = state.ready && state.readyAt > 0;
  // The 20 minute window records when this tab last heard "ready", not whether the
  // media store is still there. Electron re-checks that and rebuilds when it is gone,
  // but only when we actually ask. revalidate skips this shortcut so the check runs;
  // force_refresh stays off so a live store is still reused in ~2ms.
  if (!force && !revalidate && readyIsFresh) return { ok: true, status: "ready", cached: true, account_id: accountId };
  if (!state.promise) {
    abandonOtherImaginePreparations(accountId);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    state.controller = controller;
    const slowNotice = setTimeout(() => {
      if (state.promise && typeof toast === "function") {
        toast("Account is taking longer than usual. Still preparing…");
      }
    }, IMAGINE_BRIDGE_SLOW_PREPARE_NOTICE_MS);
    const promise = qApi("/api/imagine/bridge/prepare", {
      account_id: accountId,
      force_refresh: Boolean(force),
    }, controller ? { signal: controller.signal } : undefined).then((result) => {
      state.ready = result?.status === "ready";
      state.readyAt = state.ready ? Date.now() : 0;
      return result || { ok: true, status: "unknown", account_id: accountId };
    });
    state.promise = promise;
    promise.finally(() => {
      clearTimeout(slowNotice);
      if (state.controller === controller) state.controller = null;
      if (state.promise === promise) {
        state.promise = null;
        notifyImaginePrepareStateChanged();
      }
    }).catch(() => {});
    notifyImaginePrepareStateChanged();
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

// Liked and the paste box are pinned to the card columns underneath them: Liked ends
// 10px inside the first column, the box is centred on the second and is 60px narrower
// than a column. The grid runs from six columns down to two across the breakpoints and
// every column is a fraction, so read what the browser resolved instead of repeating
// the formula. Reading the track list works before a single card has rendered.
function imagineCardColumnMetrics() {
  const list = document.getElementById("i_card_list");
  if (!list) return null;
  const style = getComputedStyle(list);
  const columns = String(style.gridTemplateColumns || "")
    .split(" ")
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!columns.length) return null;
  const gap = Number.parseFloat(style.columnGap) || 0;
  const left = list.getBoundingClientRect().left + (Number.parseFloat(style.paddingLeft) || 0);
  return { columns, gap, left };
}

// Which ancestor these two hang off differs by breakpoint: the desktop header keeps
// .i_main_actions relative, while the narrow layout makes it `display: contents` and
// positions .i_main instead. Measuring the actual offsetParent covers both.
function placeImagineHeaderElement(element, rightEdge, centreY) {
  const parent = element.offsetParent || document.documentElement;
  const parentRect = parent.getBoundingClientRect();
  const parentStyle = getComputedStyle(parent);
  const borderLeft = Number.parseFloat(parentStyle.borderLeftWidth) || 0;
  const borderTop = Number.parseFloat(parentStyle.borderTopWidth) || 0;
  const rect = element.getBoundingClientRect();
  element.style.left = `${Math.round(rightEdge - rect.width - parentRect.left - borderLeft)}px`;
  element.style.top = `${Math.round(centreY - (rect.height / 2) - parentRect.top - borderTop)}px`;
}

function syncImagineHeaderLayout() {
  const header = document.querySelector(".i_main_header");
  const button = document.getElementById("i_upload_image_btn");
  const input = document.getElementById("i_link_input");
  if (!header || !button || !input) return;
  const metrics = imagineCardColumnMetrics();
  if (!metrics) return;
  const { columns, gap, left } = metrics;
  const headerRect = header.getBoundingClientRect();
  const centreY = headerRect.top + (headerRect.height / 2);
  const firstRight = left + columns[0];

  input.style.width = `${Math.round(columns[0] * 0.8)}px`;
  placeImagineHeaderElement(button, firstRight - 10, centreY);

  // One column means no second card to centre on, so keep the box beside Liked.
  const secondCentre = columns.length > 1
    ? firstRight + gap + (columns[1] / 2)
    : firstRight + gap + (columns[0] / 2);
  // Line the paste box up with the Liked label itself, not the header box: the label is
  // 12px tall inside a 22px row, so centring on the row left the placeholder 2px high.
  const likedRect = button.getBoundingClientRect();
  const likedCentreY = likedRect.height > 0 ? likedRect.top + (likedRect.height / 2) : centreY;
  placeImagineHeaderElement(input, secondCentre + (input.getBoundingClientRect().width / 2), likedCentreY);
}

let imagineHeaderLayoutFrame = 0;
function scheduleImagineHeaderLayout() {
  if (imagineHeaderLayoutFrame) return;
  imagineHeaderLayoutFrame = requestAnimationFrame(() => {
    imagineHeaderLayoutFrame = 0;
    syncImagineHeaderLayout();
  });
}

window.addEventListener("resize", scheduleImagineHeaderLayout);
window.addEventListener("orientationchange", scheduleImagineHeaderLayout);
if (typeof ResizeObserver === "function") {
  const imagineCardListForLayout = document.getElementById("i_card_list");
  if (imagineCardListForLayout) {
    new ResizeObserver(scheduleImagineHeaderLayout).observe(imagineCardListForLayout);
  }
}
scheduleImagineHeaderLayout();

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
