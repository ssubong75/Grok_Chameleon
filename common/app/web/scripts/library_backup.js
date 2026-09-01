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

  function setProgress(current, total, phase = "") {
    const maximum = Math.max(0, Number(total) || 0);
    const value = Math.max(0, Number(current) || 0);
    const percent = maximum > 0 ? Math.min(100, Math.round((value / maximum) * 100)) : (phase === "complete" ? 100 : 0);
    if (progressBar) progressBar.style.width = `${percent}%`;
    progressTrack?.setAttribute("aria-valuenow", String(percent));
  }

  function writeLog(message, append = true) {
    const value = String(message || "").trim();
    if (!value) return;
    if (!append || log.textContent === "Ready.") log.textContent = value;
    else log.textContent = `${log.textContent}\n${value}`;
    log.scrollTop = log.scrollHeight;
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
      status.textContent = friendlyError(error);
    }
  }

  async function refreshStatus() {
    applyDefaultLocalPath();
    if (!native?.libraryBackupStatus) {
      status.textContent = "Library Backup is available in the desktop app.";
      return;
    }
    try {
      const result = await native.libraryBackupStatus(payload());
      status.textContent = String(result?.message || "Select both library folders.");
      status.dataset.state = result?.blocked ? "blocked" : result?.ready ? "ready" : "idle";
      writeLog("Folder status refreshed.", false);
      setProgress(0, 1);
    } catch (error) {
      status.textContent = friendlyError(error);
      status.dataset.state = "blocked";
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
      status.textContent = "Select both library folders.";
      return;
    }
    setBusy(true);
    status.textContent = "Comparing library folders…";
    log.textContent = "Starting comparison.";
    setProgress(0, 1);
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
        status.textContent = "Library Backup was cancelled before any files were changed.";
        writeLog("Cancelled before execution.");
        return;
      }
      status.textContent = direction === "to-external" ? "Backing up to External Library…" : "Restoring to Local Library…";
      const result = await native.executeLibraryBackup({ token: analysis.token });
      setProgress(1, 1, "complete");
      status.textContent = result.changed
        ? `Completed. ${result.changed} change${result.changed === 1 ? "" : "s"} applied and verified.`
        : "Completed. The libraries already match.";
      writeLog(result.historyPath ? `Previous files saved in history: ${result.historyPath}` : "No previous files required history storage.");
      if (typeof scanLibrary === "function") {
        try { await scanLibrary(); } catch (_) {}
      }
    } catch (error) {
      const message = friendlyError(error);
      status.textContent = message;
      status.dataset.state = "blocked";
      writeLog(`Error: ${message}`);
      setProgress(0, 1);
    } finally {
      setBusy(false);
    }
  }

  native?.onLibraryBackupProgress?.((event) => {
    writeLog(event.message);
    setProgress(event.current, event.total, event.phase);
  });

  localChoose?.addEventListener("click", () => choose(localInput, "Local Library"));
  externalChoose?.addEventListener("click", () => choose(externalInput, "External Library"));
  toExternal?.addEventListener("click", () => run("to-external"));
  toLocal?.addEventListener("click", () => run("to-local"));
  refresh?.addEventListener("click", async () => {
    if (busy) {
      status.textContent = "Cancelling Library Backup…";
      await native?.cancelLibraryBackup?.();
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
