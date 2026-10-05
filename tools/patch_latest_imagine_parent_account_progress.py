#!/usr/bin/env python3
from pathlib import Path
import sys


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected Mac source block not found: {path.name}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Expected one source block in {path.name}, found {text.count(old)}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_span(path: Path, start: str, end: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    left = text.find(start)
    right = text.find(end, left)
    if left < 0 or right < 0:
        raise SystemExit(f"Expected source span not found: {path.name}")
    path.write_text(text[:left] + replacement + text[right:], encoding="utf-8")


def replace_n(path: Path, old: str, new: str, count: int) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != count:
        raise SystemExit(f"Expected {count} source blocks in {path.name}, found {text.count(old)}: {old[:100]!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


root = Path(sys.argv[1]).resolve()
server = root / "runtime/server.py"
preload = root / "electron/preload-bridge.js"
main = root / "electron/main.js"
imagine_main = root / "web/scripts/imagine_main.js"
prompt_account = root / "web/scripts/prompt_account.js"
composer = root / "web/scripts/i_composer_submit.js"
detail_actions = root / "web/scripts/i_detail_actions.js"
build_main = root / "web/scripts/build_main.js"

# Server: selected child remains parent, bundle root remains container.
replace_once(server,
'''    references = imagine_direct_reference_urls(image_attachments, 5)
    input_asset_ids = imagine_direct_input_asset_ids([source], 1)
    if not input_asset_ids:
        raise RuntimeError("Image edit input asset ids could not be resolved.")''',
'''    references = imagine_direct_reference_urls(image_attachments, 5)
    input_asset_ids = [parent_post_id] if parent_post_id else imagine_direct_input_asset_ids([source], 1)
    if not input_asset_ids:
        raise RuntimeError("Image edit input asset ids could not be resolved.")''')
replace_once(server,
'''    if parent_post_id:
        image_config["parentPostId"] = parent_post_id
        image_config["containerPostId"] = parent_post_id
    if root_post_id:
        image_config["rootPostId"] = root_post_id''',
'''    if parent_post_id:
        image_config["parentPostId"] = parent_post_id
    if root_post_id:
        image_config["rootPostId"] = root_post_id
        image_config["containerPostId"] = root_post_id
    elif parent_post_id:
        image_config["containerPostId"] = parent_post_id''')
replace_once(server,
'''            if not parent_post_id and input_asset_ids:
                parent_post_id = input_asset_ids[0]
            if not original_post_id:''',
'''            if not parent_post_id and input_asset_ids:
                parent_post_id = input_asset_ids[0]
            if parent_post_id:
                input_asset_ids = [parent_post_id]
            if not original_post_id:''')

# Server: tight 99% display schedule and extend candidate recovery only.
for old, new in [
    ("IMAGINE_DIRECT_T2I_DISPLAY_SECONDS = 10", "IMAGINE_DIRECT_T2I_DISPLAY_SECONDS = 8"),
    ("IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS = 94", "IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS = 99"),
    ("IMAGINE_DIRECT_I2I_DISPLAY_SECONDS = 14", "IMAGINE_DIRECT_I2I_DISPLAY_SECONDS = 12"),
    ("IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS = 94", "IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS = 99"),
    ("IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS = 94", "IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS = 99"),
    ("IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS = 94", "IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS = 99"),
    ("IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS = 94", "IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS = 99"),
]:
    replace_once(server, old, new)
replace_once(server,
'''IMAGINE_DIRECT_LOW_I2V_CANDIDATE_GRACE_SECONDS = 10
IMAGINE_DIRECT_VIDEO_ABSOLUTE_GRACE_SECONDS = 15''',
'''IMAGINE_DIRECT_LOW_I2V_CANDIDATE_GRACE_SECONDS = 10
IMAGINE_DIRECT_EXTEND_CANDIDATE_GRACE_SECONDS = 60
IMAGINE_DIRECT_VIDEO_ABSOLUTE_GRACE_SECONDS = 15''')
old_table = '''    display_seconds_override = {
        ("i2v", "480p", 6): 13,
        ("i2v", "480p", 10): 30,
        ("i2v", "720p", 6): 50,
        ("i2v", "720p", 10): 60,
        ("t2v", "480p", 6): 13,
        ("t2v", "480p", 10): 30,
        ("t2v", "720p", 6): 50,
        ("t2v", "720p", 10): 60,
        ("extend", "480p", 6): 30,
        ("extend", "480p", 10): 45,
        ("extend", "720p", 6): 60,
        ("extend", "720p", 10): 80,
    }.get((resolved_action, resolution, duration))'''
rows = [("480p",6,25),("480p",10,35),("480p",15,45),("720p",6,40),("720p",10,55),("720p",15,70),("1080p",6,65),("1080p",10,100),("1080p",15,100)]
table = ['    def recovery_seconds(value: int) -> int:', '        if resolved_action == "extend":', '            return max(value, IMAGINE_DIRECT_EXTEND_CANDIDATE_GRACE_SECONDS)', '        return value', '    display_seconds_override = {']
for action in ("i2v", "t2v", "extend"):
    table.extend(f'        ("{action}", "{res}", {duration}): {seconds},' for res, duration, seconds in rows)
table.append('    }.get((resolved_action, resolution, duration))')
replace_once(server, old_table, "\n".join(table))
for constant in ["IMAGINE_DIRECT_VIDEO_ABSOLUTE_GRACE_SECONDS", "IMAGINE_DIRECT_LONG_I2V_CANDIDATE_GRACE_SECONDS", "IMAGINE_DIRECT_HIGH_SHORT_I2V_CANDIDATE_GRACE_SECONDS", "IMAGINE_DIRECT_MID_I2V_CANDIDATE_GRACE_SECONDS", "IMAGINE_DIRECT_LOW_I2V_CANDIDATE_GRACE_SECONDS"]:
    replace_once(server, f'"recovery_seconds": {constant},', f'"recovery_seconds": recovery_seconds({constant}),')

# Official store arguments and root/child mapping.
for old, new in [
    ("? resolvedMediaId(state, explicitImageContainerSeedId)", "? containerPostIdFor(state, explicitImageContainerSeedId)"),
    ("        resolutionName: params.resolutionName || imageConfig.resolutionName,\n      }];", "        resolutionName: params.resolutionName || imageConfig.resolutionName,\n        mediaGenInput: payload.mediaGenInput,\n      }];"),
    ("      const rootContainerId = explicitRootSeedId\n        ? resolvedMediaId(state, explicitRootSeedId)\n        : rootContainerIdFor(state, rootSeedId);", "      const rootContainerId = rootContainerIdFor(state, explicitRootSeedId || rootSeedId);"),
    ("        containerId = extendPostId || rootContainerId || videoConfig.rootPostId;", "        containerId = rootContainerId || videoConfig.rootPostId || extendPostId;"),
    ("        imageReferences,\n        onVideoGenerationStart\n      ];", "        imageReferences,\n        onVideoGenerationStart,\n        payload.mediaGenInput\n      ];"),
]: replace_once(preload, old, new)

# Mac main.js: change only official saved-page preparation, preserving Mac lifecycle code.
replace_span(main, "async function ensureBridgeReady(command) {", "async function openBridgePage(command) {", '''async function ensureBridgeReady(command) {
  const win = bridgeWindow(command);
  const storePageCommand = ["prepare", "fetch_stream"].includes(command.type);
  const targetUrl = command.type === "t2i_ws" || storePageCommand
    ? "https://grok.com/imagine/saved"
    : (command.url || "https://grok.com/imagine");
  await applyBridgeCookies(win, command);
  await waitForLoad(win, targetUrl, { forceTarget: ["t2i_ws", "prepare", "fetch_stream", "crop_image", "open_page"].includes(command.type) });
  let probe = await loginProbe(win);
  if (probe?.ok) {
    const context = await waitForBridgeStoreReady(win, command, { timeoutMs: storePageCommand ? 12000 : undefined });
    if (storePageCommand && !context?.hasMediaStore) {
      throw new Error("Imagine official media store could not be prepared on the saved page.");
    }
    return win;
  }
  showBridgeWindow(win, `${APP_NAME} Imagine Login`);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await sleep(1000);
    probe = await loginProbe(win);
    if (probe?.ok) {
      await sleep(2000);
      await waitForBridgeStoreReady(win, command);
      win.hide();
      return win;
    }
  }
  throw new Error("Imagine login was not completed.");
}

''')

# Per-account bridge preparation with a stable submission account.
replace_once(imagine_main, '''const IMAGINE_BRIDGE_PREPARE_MAX_AGE_MS = 5 * 60 * 1000;
let imagineBridgePrepareAccountId = "";
let imagineBridgePrepareReadyAt = 0;
let imagineBridgePreparePromise = null;''', '''const IMAGINE_BRIDGE_PREPARE_MAX_AGE_MS = 30 * 60 * 1000;
const imagineBridgePrepareStates = new Map();

function imagineBridgePrepareState(accountId) {
  const id = String(accountId || "");
  let state = imagineBridgePrepareStates.get(id);
  if (!state) { state = { readyAt: 0, promise: null }; imagineBridgePrepareStates.set(id, state); }
  return state;
}

function invalidateImagineBridgePreparation(accountId = "") {
  const id = String(accountId || "");
  if (id) imagineBridgePrepareStates.delete(id); else imagineBridgePrepareStates.clear();
}
''')

replace_span(imagine_main, "async function prepareActiveImagineBridgeSession", "document.getElementById(\"i_link_input\")", '''async function prepareActiveImagineBridgeSession({ force = false, silent = true, accountId: requestedAccountId = "" } = {}) {
  if (!library_state.apiReady) return { ok: true, status: "api_unavailable" };
  const accountId = String(requestedAccountId || account_state.imagine?.active_id || account_state.imagine?.accounts?.[0]?.id || "");
  if (!accountId) return { ok: true, status: "no_account" };
  const state = imagineBridgePrepareState(accountId);
  if (!force && state.readyAt && Date.now() - state.readyAt < IMAGINE_BRIDGE_PREPARE_MAX_AGE_MS) return { ok: true, status: "ready", cached: true, account_id: accountId };
  if (!state.promise) {
    const promise = qApi("/api/imagine/bridge/prepare", { account_id: accountId }).then((result) => {
      state.readyAt = result?.status === "ready" ? Date.now() : 0;
      return result || { ok: true, status: "unknown", account_id: accountId };
    });
    state.promise = promise;
    promise.finally(() => { if (state.promise === promise) state.promise = null; }).catch(() => {});
  }
  try { return await state.promise; }
  catch (error) {
    state.readyAt = 0;
    if (!silent) throw error;
    console.warn(error);
    return { ok: false, status: "error", account_id: accountId, error: error?.message || String(error) };
  }
}

''')
replace_n(prompt_account, "prepareActiveImagineBridgeSession({ force: true })", "prepareActiveImagineBridgeSession({ force: false, accountId: String(id || \"\") })", 2)
replace_once(prompt_account, '''      const data = await qApi("/api/imagine/login/capture", {});
      applyLibrarySnapshot(data);
      clearImagineAccountScopedCache(String(account_state.imagine.active_id || ""));
      renderAccounts();''', '''      const data = await qApi("/api/imagine/login/capture", {});
      applyLibrarySnapshot(data);
      const accountId = String(account_state.imagine.active_id || "");
      clearImagineAccountScopedCache(accountId);
      if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation(accountId);
      if (typeof prepareActiveImagineBridgeSession === "function") prepareActiveImagineBridgeSession({ force: true, accountId }).catch((error) => console.warn(error));
      renderAccounts();''')
replace_once(prompt_account, '''    clearImagineAccountScopedCache(account.id);
    if (typeof warmActiveImagineUsage''', '''    clearImagineAccountScopedCache(account.id);
    if (typeof invalidateImagineBridgePreparation === "function") invalidateImagineBridgePreparation(account.id);
    if (typeof prepareActiveImagineBridgeSession === "function") prepareActiveImagineBridgeSession({ force: true, accountId: account.id }).catch((error) => console.warn(error));
    if (typeof warmActiveImagineUsage''')
replace_once(composer, '      aspect_ratio: preview?.aspect_ratio || "",', '      aspect_ratio: preview?.aspect_ratio || "",\n      phase: "preparing",')
replace_once(composer, '  const switchedToT2iView = shouldSwitchImagineT2iBeforeSubmit();', '  const switchedToT2iView = shouldSwitchImagineT2iBeforeSubmit();\n  const submissionAccountId = activeImagineAccountId();')
replace_once(composer, 'prepareActiveImagineBridgeSession({ force: false, silent: false })', 'prepareActiveImagineBridgeSession({ force: false, silent: false, accountId: submissionAccountId })')
replace_once(composer, '      account_id: activeImagineAccountId(),', '      account_id: submissionAccountId,')
replace_once(detail_actions, 'prepareActiveImagineBridgeSession({ force: false, silent: true })', 'prepareActiveImagineBridgeSession({ force: false, silent: true, accountId: payload.account_id })')

replace_once(build_main, '''

  function buildJobStatus(job) {''', '''

  function buildJobPreparing(job) {
    return Boolean(job?.pending_client_job && String(job?.context?.phase || "") === "preparing");
  }


  function buildJobStatus(job) {''')
replace_n(build_main, '    const status = buildJobStatus(job);\n    if (status === "moderated"', '    const status = buildJobStatus(job);\n    if (buildJobPreparing(job)) return "Preparing";\n    if (status === "moderated"', 2)
replace_once(build_main, '  function buildJobSlotProgressText(job, slotIndex = 0) {\n    return String', '  function buildJobSlotProgressText(job, slotIndex = 0) {\n    if (buildJobPreparing(job)) return "…";\n    return String')
replace_once(build_main, '      progressEl.innerHTML = `Creating <span class="detail_generation_percent">${Math.max(1, buildJobSlotProgress(job, slotIndex))}%</span>`;', '      progressEl.innerHTML = buildJobPreparing(job) ? "Preparing" : `Creating <span class="detail_generation_percent">${Math.max(1, buildJobSlotProgress(job, slotIndex))}%</span>`;')
replace_once(build_main, '${candidateFailed ? hiddenMediaIconSvg() : String(candidateProgress)}</span>`;', '${candidateFailed ? hiddenMediaIconSvg() : buildJobSlotProgressText(candidate, slotIndex)}</span>`;')
replace_once(build_main, '>Creating <span class="detail_generation_percent">${progress}%</span></span>', '>${buildJobPreparing(job) ? "Preparing" : `Creating <span class="detail_generation_percent">${progress}%</span>`}</span>')

print("LATEST_IMAGINE_MAC_PATCH_OK")
