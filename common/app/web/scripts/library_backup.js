(() => {
  const native = window.grokChameleonNative;
  const localInput = document.getElementById("library_backup_local_path");
  const externalInput = document.getElementById("library_backup_external_path");
  const localChoose = document.getElementById("library_backup_local_choose");
  const externalChoose = document.getElementById("library_backup_external_choose");
  const toExternal = document.getElementById("library_backup_to_external");
  const toLocal = document.getElementById("library_backup_to_local");
  const refresh = document.getElementById("library_backup_refresh");
  const status = document.getElementById("library_backup_status");
  const log = document.getElementById("library_backup_log");
  const progressTrack = document.querySelector(".library_backup_progress_track");
  const progressBar = progressTrack?.querySelector("span");
  if (!localInput || !externalInput || !status || !log) return;

  let busy = false;

  function friendlyError(error) {
    return String(error?.message || error || "Library Backup failed.")
      .replace(/^Error invoking remote method '[^']+':\s*/i, "")
      .replace(/^Error:\s*/i, "");
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let amount = bytes;
    let unit = "B";
    for (const candidate of units) {
      amount /= 1024;
      unit = candidate;
      if (amount < 1024) break;
    }
    return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${unit}`;
  }

  // Every stage counts its own items from zero, so a raw percentage swings back to the start
  // several times per run. Give each stage a slice of the bar and never move backwards.
  const PHASE_RANGES = {
    start: [0, 2],
    scan: [2, 40],
    review: [40, 42],
    confirm: [42, 52],
    pause: [52, 55],
    copy: [55, 80],
    apply: [80, 92],
    verify: [92, 98],
    restart: [98, 99],
    complete: [100, 100],
  };
  let progressFloor = 0;

  function paintProgress(percent) {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    progressFloor = value;
    if (progressBar) progressBar.style.width = `${value}%`;
    progressTrack?.setAttribute("aria-valuenow", String(value));
  }

  function setProgress(current, total, phase = "") {
    const range = PHASE_RANGES[phase];
    const maximum = Math.max(0, Number(total) || 0);
    const value = Math.max(0, Number(current) || 0);
    const ratio = maximum > 0 ? Math.min(1, value / maximum) : 0;
    const percent = range
      ? range[0] + ((range[1] - range[0]) * ratio)
      : (maximum > 0 ? ratio * 100 : progressFloor);
    paintProgress(Math.max(progressFloor, percent));
  }

  function resetProgress() {
    progressFloor = 0;
    paintProgress(0);
  }

  // Rebuilding textContent once per line is quadratic, and a first backup emits thousands of
  // lines. Keep a bounded buffer and paint it once per frame.
  const LOG_MAX_LINES = 400;
  const logLines = [];
  let logPaintHandle = 0;

  function paintLog() {
    logPaintHandle = 0;
    log.textContent = logLines.join("\n");
    log.scrollTop = log.scrollHeight;
  }

  function writeLog(message, append = true) {
    const value = String(message || "").trim();
    if (!value) return;
    if (!append) logLines.length = 0;
    logLines.push(value);
    if (logLines.length > LOG_MAX_LINES) logLines.splice(0, logLines.length - LOG_MAX_LINES);
    if (!logPaintHandle) logPaintHandle = window.requestAnimationFrame(paintLog);
  }

  // A failed run leaves the status line red; without this the next success would still read as
  // an error. Every status update names the state it wants.
  function setStatus(message, state = "idle") {
    status.textContent = String(message || "");
    status.dataset.state = state;
  }

  function setBusy(value) {
    busy = Boolean(value);
    for (const element of [localChoose, externalChoose, toExternal, toLocal]) {
      if (element) element.disabled = busy;
    }
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = busy ? "Cancel" : "Refresh";
    }
    // The library server is stopped for the length of a backup, so every other screen would
    // fail to load its data. Keep the sidebar out of reach until it is back.
    for (const element of document.querySelectorAll(".sidebar .nav_item, .sidebar .account-button")) {
      element.disabled = busy;
    }
  }

  function payload(direction = "") {
    return {
      local_path: localInput.value.trim(),
      external_path: externalInput.value.trim(),
      ...(direction ? { direction } : {}),
    };
  }

  function applyDefaultLocalPath() {
    const currentRoot = String(typeof library_state !== "undefined" ? library_state.rootPath || "" : "").trim();
    if (!localInput.value && currentRoot) localInput.value = currentRoot;
  }

  async function choose(input, label) {
    if (!native?.chooseLibraryBackupFolder || busy) return;
    try {
      const result = await native.chooseLibraryBackupFolder({
        title: `Select ${label}`,
        current: input.value.trim(),
      });
      if (!result?.cancelled && result?.path) {
        input.value = result.path;
        await refreshStatus();
      }
    } catch (error) {
      setStatus(friendlyError(error), "blocked");
    }
  }

  async function refreshStatus() {
    applyDefaultLocalPath();
    if (!native?.libraryBackupStatus) {
      setStatus("Library Backup is available in the desktop app.");
      return;
    }
    try {
      const result = await native.libraryBackupStatus(payload());
      setStatus(
        String(result?.message || "Select both library folders."),
        result?.blocked ? "blocked" : result?.ready ? "ready" : "idle",
      );
      writeLog("Folder status refreshed.", false);
      resetProgress();
    } catch (error) {
      setStatus(friendlyError(error), "blocked");
    }
  }

  function reviewMessage(direction, analysis) {
    const summary = analysis.summary || {};
    const directionLabel = direction === "to-external"
      ? "Local Library → External Library"
      : "External Library → Local Library";
    const changes = `Add ${summary.add || 0}, update ${summary.update || 0}, delete ${summary.delete || 0}`;
    const sizes = `Copy ${formatBytes(summary.copy_bytes)}, history ${formatBytes(summary.history_bytes)}`;
    const warning = analysis.warning ? ` ${analysis.warning}` : "";
    if (!summary.total) return `${directionLabel}. The libraries already match. Continue to update the backup state?${warning}`;
    return `${directionLabel}. ${changes}. ${sizes}. The destination will match the source.${warning}`;
  }

  async function run(direction) {
    if (busy || !native?.analyzeLibraryBackup || !native?.executeLibraryBackup) return;
    if (!localInput.value.trim() || !externalInput.value.trim()) {
      setStatus("Select both library folders.");
      return;
    }
    setBusy(true);
    currentPhase = "";
    setStatus("Comparing library folders…");
    writeLog("Starting comparison.", false);
    resetProgress();
    try {
      const analysis = await native.analyzeLibraryBackup(payload(direction));
      const confirmed = await openGalleryActionDialog({
        title: direction === "to-external" ? "Back Up Library" : "Restore Library",
        message: reviewMessage(direction, analysis),
        confirmLabel: direction === "to-external" ? "Back Up" : "Restore",
        cancelLabel: "Cancel",
        messageBox: true,
      });
      if (!confirmed) {
        setStatus("Library Backup was cancelled before any files were changed.");
        writeLog("Cancelled before execution.");
        return;
      }
      setStatus(direction === "to-external" ? "Backing up to External Library…" : "Restoring to Local Library…");
      const result = await native.executeLibraryBackup({ token: analysis.token });
      setProgress(1, 1, "complete");
      setStatus(
        result.changed
          ? `Completed. ${result.changed} change${result.changed === 1 ? "" : "s"} applied and verified.`
          : "Completed. The libraries already match.",
        "ready",
      );
      writeLog(result.historyPath ? `Previous files saved in history: ${result.historyPath}` : "No previous files required history storage.");
      // A full rescan rewrites library.json and the card index, which would put the Local
      // Library out of step with the baseline this run just saved. Only a restore actually
      // changes local files, so only a restore needs one.
      if (direction === "to-local" && typeof scanLibrary === "function") {
        try { await scanLibrary(); } catch (_) {}
      }
    } catch (error) {
      const message = friendlyError(error);
      setStatus(message, "blocked");
      writeLog(`Error: ${message}`);
      resetProgress();
    } finally {
      setBusy(false);
    }
  }

  // Once the files are in place the run has to reach its manifest writes, so the cancel button
  // steps aside for the closing stages rather than pretending it can still stop them.
  const UNSTOPPABLE_PHASES = new Set(["verify", "restart", "complete"]);
  let currentPhase = "";

  native?.onLibraryBackupProgress?.((event) => {
    currentPhase = String(event.phase || "");
    writeLog(event.message);
    setProgress(event.current, event.total, event.phase);
    if (refresh && busy) refresh.disabled = UNSTOPPABLE_PHASES.has(currentPhase);
  });

  localChoose?.addEventListener("click", () => choose(localInput, "Local Library"));
  externalChoose?.addEventListener("click", () => choose(externalInput, "External Library"));
  toExternal?.addEventListener("click", () => run("to-external"));
  toLocal?.addEventListener("click", () => run("to-local"));
  refresh?.addEventListener("click", async () => {
    if (busy) {
      if (UNSTOPPABLE_PHASES.has(currentPhase)) {
        setStatus("The backup is finishing and can no longer be cancelled.");
        return;
      }
      setStatus("Cancelling Library Backup…");
      const result = await native?.cancelLibraryBackup?.();
      if (result && result.cancelling === false) setStatus("There was nothing left to cancel.");
      return;
    }
    await refreshStatus();
  });
  document.getElementById("library_backup_btn")?.addEventListener("click", () => {
    applyDefaultLocalPath();
    void refreshStatus();
  });

  applyDefaultLocalPath();
})();
