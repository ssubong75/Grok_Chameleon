const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONTENT_DIRECTORIES = [
  "created",
  "upload",
  "collection",
  "prompt",
  "account",
  "cache",
  "previews",
];
const STATE_FILES = new Set([
  "state.sqlite3",
  "state.backup.sqlite3",
  "state.backup.json",
  "imagine_state.sqlite3",
  "library_index.sqlite3",
]);
const AUTOMATIC_METADATA_PATHS = new Set([
  "library.json",
  "sql_data/library_index.sqlite3",
  "sql_data/state.backup.json",
  "sql_data/state.backup.sqlite3",
].map(canonicalPathKey));
// The server rewrites these every time it scans the library, so their contents differ after
// merely opening the app. They still travel with the backup; they just do not count as a
// local edit when deciding whether the Local Library is behind the backup.
const REGENERATED_ON_SCAN = new Set([
  "library.json",
  "sql_data/library_index.sqlite3",
].map(canonicalPathKey));
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 200;
const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);
const TERMINAL_JOB_STATES = new Set(["done", "failed", "moderated", "cancelled"]);
const MANIFEST_VERSION = 1;

class LibraryBackupError extends Error {
  constructor(message, code = "LIBRARY_BACKUP_ERROR") {
    super(message);
    this.name = "LibraryBackupError";
    this.code = code;
  }
}

function canonicalRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").normalize("NFC");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => !part || part === "." || part === "..")) {
    throw new LibraryBackupError(`Unsafe relative path: ${value}`, "INVALID_PATH");
  }
  return parts.join("/");
}

function canonicalPathKey(value) {
  return canonicalRelativePath(value).toLocaleLowerCase("en-US");
}

function safePath(root, relativePath) {
  const relative = canonicalRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...relative.split("/"));
  const relation = path.relative(resolvedRoot, candidate);
  if (!relation || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new LibraryBackupError(`Path escapes the library: ${relative}`, "INVALID_PATH");
  }
  return candidate;
}

function utcNow() {
  return new Date().toISOString();
}

function randomSuffix() {
  return crypto.randomBytes(6).toString("hex");
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function readJson(filePath) {
  if (!pathExists(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    throw new LibraryBackupError(`Could not read backup metadata: ${filePath}: ${error.message}`, "METADATA_INVALID");
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomSuffix()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
}

function libraryIdentity(root) {
  const libraryPath = path.join(root, "library.json");
  if (!pathExists(libraryPath)) return "";
  const data = readJson(libraryPath);
  const explicit = String(data.library_id || "").trim().normalize("NFC");
  if (explicit) return explicit;
  const seed = [data.created_at || "", data.version || ""].join("|");
  return `library_${crypto.createHash("sha256").update(`grok-chameleon:${seed}`).digest("hex").slice(0, 32)}`;
}

function ensureDirectory(root, label, { allowMissing = false } = {}) {
  const resolved = path.resolve(String(root || ""));
  if (!root) throw new LibraryBackupError(`${label} is not selected.`, "PATH_REQUIRED");
  if (!pathExists(resolved)) {
    if (!allowMissing) throw new LibraryBackupError(`${label} folder was not found.`, "PATH_NOT_FOUND");
    fs.mkdirSync(resolved, { recursive: true });
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new LibraryBackupError(`${label} must be a folder.`, "PATH_NOT_DIRECTORY");
  }
  return resolved;
}

function validateDistinctRoots(localRoot, externalRoot) {
  const local = path.resolve(localRoot);
  const external = path.resolve(externalRoot);
  if (local === external) throw new LibraryBackupError("Local and External Library folders are the same.", "SAME_ROOT");
  const localToExternal = path.relative(local, external);
  const externalToLocal = path.relative(external, local);
  if (
    (!localToExternal.startsWith("..") && !path.isAbsolute(localToExternal))
    || (!externalToLocal.startsWith("..") && !path.isAbsolute(externalToLocal))
  ) {
    throw new LibraryBackupError("A library folder cannot be inside the other library folder.", "NESTED_ROOT");
  }
}

function validateLibraryPair(sourceRoot, destinationRoot, sourceLabel, destinationLabel) {
  const libraryId = libraryIdentity(sourceRoot);
  if (!libraryId) {
    throw new LibraryBackupError(`${sourceLabel} does not contain library.json.`, "SOURCE_NOT_LIBRARY");
  }
  const destinationId = libraryIdentity(destinationRoot);
  if (destinationId && destinationId !== libraryId) {
    throw new LibraryBackupError(`${sourceLabel} and ${destinationLabel} are different libraries.`, "LIBRARY_MISMATCH");
  }
  return libraryId;
}

function shouldIgnoreFile(name) {
  const lower = name.toLowerCase();
  return IGNORED_NAMES.has(name) || lower.endsWith(".tmp") || lower.endsWith("-journal") || lower.endsWith("-wal") || lower.endsWith("-shm");
}

function collectFiles(root) {
  const files = [];
  const addFile = (absolutePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new LibraryBackupError(`Symbolic links cannot be backed up: ${absolutePath}`, "SYMLINK_NOT_SUPPORTED");
    }
    if (stat.isFile() && !shouldIgnoreFile(path.basename(absolutePath))) files.push(absolutePath);
  };
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new LibraryBackupError(`Symbolic links cannot be backed up: ${absolute}`, "SYMLINK_NOT_SUPPORTED");
      }
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && !shouldIgnoreFile(entry.name)) files.push(absolute);
    }
  };

  const libraryJson = path.join(root, "library.json");
  if (pathExists(libraryJson)) addFile(libraryJson);
  for (const directoryName of CONTENT_DIRECTORIES) {
    const directory = path.join(root, directoryName);
    if (pathExists(directory) && fs.statSync(directory).isDirectory()) walk(directory);
  }
  const stateDirectory = path.join(root, "sql_data");
  if (pathExists(stateDirectory) && fs.statSync(stateDirectory).isDirectory()) {
    for (const fileName of [...STATE_FILES].sort()) {
      const filePath = path.join(stateDirectory, fileName);
      if (pathExists(filePath)) addFile(filePath);
    }
  }
  return files;
}

// Progress travels to the renderer over IPC, and one message per file means tens of thousands
// of hops for a library this size - more than the log pane can absorb. Report on a timer and
// always let the closing item through so the final count lands.
function throttledProgress(progress) {
  let lastAt = 0;
  return (payload) => {
    if (!progress) return;
    const total = Number(payload.total) || 0;
    const final = total > 0 && Number(payload.current) >= total;
    const now = Date.now();
    if (!final && now - lastAt < PROGRESS_INTERVAL_MS) return;
    lastAt = now;
    progress(payload);
  };
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new LibraryBackupError("Library Backup was cancelled.", "CANCELLED");
}

async function sha256File(filePath, signal) {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    const cancel = () => stream.destroy(new LibraryBackupError("Library Backup was cancelled.", "CANCELLED"));
    signal?.addEventListener("abort", cancel, { once: true });
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
    stream.on("close", () => signal?.removeEventListener("abort", cancel));
  });
}

function manifestFromJson(data) {
  if (!data || Number(data.schema_version) !== MANIFEST_VERSION || !Array.isArray(data.files)) return null;
  const records = new Map();
  for (const item of data.files) {
    const relativePath = canonicalRelativePath(item.relative_path);
    const record = {
      relativePath,
      diskRelativePath: relativePath,
      size: Number(item.size) || 0,
      mtimeMs: Number(item.mtime_ms) || 0,
      sha256: String(item.sha256 || ""),
    };
    records.set(canonicalPathKey(relativePath), record);
  }
  return {
    libraryId: String(data.library_id || ""),
    generation: Number(data.generation) || 0,
    records,
  };
}

function manifestToJson(libraryId, generation, manifest) {
  return {
    schema_version: MANIFEST_VERSION,
    library_id: libraryId,
    generation: Number(generation) || 0,
    fingerprint: manifestFingerprint(manifest),
    saved_at: utcNow(),
    files: [...manifest.records.values()]
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"))
      .map((record) => ({
        relative_path: record.relativePath,
        size: record.size,
        mtime_ms: record.mtimeMs,
        sha256: record.sha256,
      })),
  };
}

async function scanLibrary(root, { previous = null, progress = null, signal = null, phase = "Scanning" } = {}) {
  if (!pathExists(root)) return { records: new Map() };
  const files = collectFiles(root);
  const records = new Map();
  const report = throttledProgress(progress);
  let index = 0;
  for (const filePath of files) {
    throwIfCancelled(signal);
    index += 1;
    const diskRelativePath = path.relative(root, filePath).split(path.sep).join("/");
    const relativePath = canonicalRelativePath(diskRelativePath);
    const key = canonicalPathKey(relativePath);
    if (records.has(key)) {
      throw new LibraryBackupError(
        `Case or Unicode filename collision: ${records.get(key).diskRelativePath} / ${diskRelativePath}`,
        "FILENAME_COLLISION",
      );
    }
    const stat = fs.statSync(filePath);
    const cached = previous?.records?.get(key);
    const forceHash = ["library.json", "post.json"].includes(path.basename(filePath));
    const digest = cached && !forceHash && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
      ? cached.sha256
      : await sha256File(filePath, signal);
    records.set(key, {
      relativePath,
      diskRelativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: digest,
    });
    report({ phase: "scan", message: `${phase}: ${index} of ${files.length}`, current: index, total: files.length });
  }
  return { records };
}

function manifestFingerprint(manifest) {
  const digest = crypto.createHash("sha256");
  for (const [key, record] of [...manifest.records.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    digest.update(key);
    digest.update("\0");
    digest.update(record.relativePath);
    digest.update("\0");
    digest.update(String(record.size));
    digest.update("\0");
    digest.update(record.sha256);
    digest.update("\n");
  }
  return digest.digest("hex");
}

function changedManifestKeys(previous, current) {
  const keys = new Set([...previous.records.keys(), ...current.records.keys()]);
  const changed = new Set();
  for (const key of keys) {
    const before = previous.records.get(key);
    const after = current.records.get(key);
    if (!before || !after || before.relativePath !== after.relativePath || before.size !== after.size || before.sha256 !== after.sha256) {
      changed.add(key);
    }
  }
  return changed;
}

function onlyAutomaticMetadataChanged(previous, current) {
  const changed = changedManifestKeys(previous, current);
  return changed.size > 0 && [...changed].every((key) => AUTOMATIC_METADATA_PATHS.has(key));
}

function unexpectedExternalKeys(previous, current) {
  return [...changedManifestKeys(previous, current)].filter((key) => !AUTOMATIC_METADATA_PATHS.has(key));
}

function unsyncedChangeKeys(previous, current) {
  return [...changedManifestKeys(previous, current)].filter((key) => !REGENERATED_ON_SCAN.has(key));
}

// Names that this computer stores happily but a Windows computer cannot recreate. The backup
// still runs; the caller surfaces these so the folders can be renamed before the drive travels.
function windowsPortabilityIssue(relativePath) {
  for (const part of relativePath.split("/")) {
    if (/[<>:"|?*]/.test(part) || /[\u0000-\u001f]/.test(part)) return `${relativePath} (character Windows cannot store)`;
    if (/[. ]$/.test(part)) return `${relativePath} (ends with a space or period, which Windows drops)`;
    if (WINDOWS_RESERVED_NAMES.has(part.split(".")[0].toLocaleLowerCase("en-US"))) return `${relativePath} (name reserved by Windows)`;
  }
  return "";
}

function windowsPortabilityIssues(manifest) {
  const issues = [];
  for (const record of manifest.records.values()) {
    const issue = windowsPortabilityIssue(record.relativePath);
    if (issue) issues.push(issue);
  }
  return issues.sort((a, b) => a.localeCompare(b, "en"));
}

async function fileMatchesRecord(root, record, signal) {
  const filePath = safePath(root, record.diskRelativePath);
  if (!pathExists(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size !== record.size) return false;
  if (stat.mtimeMs === record.mtimeMs) return true;
  return (await sha256File(filePath, signal)) === record.sha256;
}

function buildChangePlan(source, destination) {
  const changes = [];
  for (const [key, sourceRecord] of [...source.records.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const destinationRecord = destination.records.get(key);
    if (!destinationRecord) changes.push({ action: "add", relativePath: sourceRecord.relativePath, size: sourceRecord.size, sourceRecord, destinationRecord: null });
    else if (sourceRecord.sha256 !== destinationRecord.sha256 || sourceRecord.size !== destinationRecord.size) {
      changes.push({ action: "update", relativePath: sourceRecord.relativePath, size: sourceRecord.size, sourceRecord, destinationRecord });
    }
  }
  for (const [key, destinationRecord] of [...destination.records.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (!source.records.has(key)) changes.push({ action: "delete", relativePath: destinationRecord.relativePath, size: destinationRecord.size, sourceRecord: null, destinationRecord });
  }
  return changes;
}

function summarizeChanges(changes) {
  const summary = { add: 0, update: 0, delete: 0, copy_bytes: 0, history_bytes: 0, total: changes.length };
  for (const change of changes) {
    summary[change.action] += 1;
    if (change.action !== "delete") summary.copy_bytes += change.size;
    if (change.action !== "add") summary.history_bytes += change.destinationRecord?.size || 0;
  }
  return summary;
}

function controlDirectory(root, libraryId, local = false) {
  const rootKey = local
    ? crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16)
    : "";
  return path.join(
    path.dirname(root),
    local ? ".grok-library-backup-local" : ".grok-library-backup",
    libraryId,
    ...(rootKey ? [rootKey] : []),
  );
}

function metadataPaths(localRoot, externalRoot, libraryId) {
  const externalControl = controlDirectory(externalRoot, libraryId, false);
  const localControl = controlDirectory(localRoot, libraryId, true);
  return {
    externalControl,
    externalManifest: path.join(externalControl, "manifest.json"),
    session: path.join(externalControl, "session.json"),
    localControl,
    localBaseline: path.join(localControl, "baseline.json"),
  };
}

function loadStoredManifest(filePath) {
  return manifestFromJson(readJson(filePath));
}

function saveStoredManifest(filePath, libraryId, generation, manifest) {
  writeJsonAtomic(filePath, manifestToJson(libraryId, generation, manifest));
}

function sessionOwnerError(session) {
  return new LibraryBackupError(
    `The External Library is currently in use by another computer (${String(session.started_at || "unknown time")}).`,
    "OTHER_COMPUTER_ACTIVE",
  );
}

function validateStoredLibrary(stored, libraryId, label) {
  if (stored && stored.libraryId && stored.libraryId !== libraryId) {
    throw new LibraryBackupError(`${label} metadata belongs to a different library.`, "METADATA_LIBRARY_MISMATCH");
  }
}

function isTerminalJob(job) {
  return TERMINAL_JOB_STATES.has(String(job?.status || "").toLowerCase());
}

class LibraryBackup {
  constructor({ localRoot, externalRoot, machineId, progress = null, signal = null }) {
    this.localRoot = path.resolve(String(localRoot || ""));
    this.externalRoot = path.resolve(String(externalRoot || ""));
    this.machineId = String(machineId || "").trim();
    this.progress = progress;
    this.signal = signal;
    if (!this.machineId) throw new LibraryBackupError("Internal computer ID is missing.", "MACHINE_ID_MISSING");
  }

  emit(message, current = null, total = null, phase = "work") {
    this.progress?.({ phase, message, current, total });
  }

  validate(direction) {
    const local = ensureDirectory(this.localRoot, "Local Library", { allowMissing: direction === "to-local" });
    const external = ensureDirectory(this.externalRoot, "External Library", { allowMissing: direction === "to-external" });
    validateDistinctRoots(local, external);
    const source = direction === "to-external" ? local : external;
    const destination = direction === "to-external" ? external : local;
    const libraryId = validateLibraryPair(
      source,
      destination,
      direction === "to-external" ? "Local Library" : "External Library",
      direction === "to-external" ? "External Library" : "Local Library",
    );
    return { local, external, source, destination, libraryId, paths: metadataPaths(local, external, libraryId) };
  }

  async analyze(direction) {
    if (!["to-external", "to-local"].includes(direction)) {
      throw new LibraryBackupError("Unknown backup direction.", "INVALID_DIRECTION");
    }
    const context = this.validate(direction);
    const { libraryId, paths } = context;
    const storedExternal = loadStoredManifest(paths.externalManifest);
    const localBaseline = loadStoredManifest(paths.localBaseline);
    validateStoredLibrary(storedExternal, libraryId, "External Library");
    validateStoredLibrary(localBaseline, libraryId, "Local Library");
    const session = readJson(paths.session);
    if (session.machine_id && session.machine_id !== this.machineId) throw sessionOwnerError(session);

    this.emit("Scanning External Library.", null, null, "scan");
    const actualExternal = await scanLibrary(context.external, {
      previous: storedExternal,
      progress: this.progress,
      signal: this.signal,
      phase: "Scanning External Library",
    });
    this.emit("Scanning Local Library.", null, null, "scan");
    const actualLocal = await scanLibrary(context.local, {
      previous: localBaseline,
      progress: this.progress,
      signal: this.signal,
      phase: "Scanning Local Library",
    });
    if (!actualExternal.records.size && direction === "to-local") {
      throw new LibraryBackupError("External Library does not contain backup files.", "SOURCE_EMPTY");
    }
    if (!actualLocal.records.size && direction === "to-external") {
      throw new LibraryBackupError("Local Library does not contain backup files.", "SOURCE_EMPTY");
    }

    const externalFingerprint = manifestFingerprint(actualExternal);
    const localFingerprint = manifestFingerprint(actualLocal);
    const storedExternalFingerprint = storedExternal ? manifestFingerprint(storedExternal) : "";
    // A run can copy every file into place and still fail before writing its manifests - a
    // cleanup error, a crash, a drive pulled out mid-run. What it leaves behind looks like
    // someone edited the drive directly, except the two libraries match each other exactly.
    // That is a finished transfer missing its receipt, not a conflict, so it is allowed
    // through to rewrite the record instead of locking both directions until the control
    // folders are deleted by hand.
    const librariesMatch = Boolean(actualLocal.records.size)
      && unsyncedChangeKeys(actualExternal, actualLocal).length === 0;
    const unrecordedRun = "The last run copied everything but did not record itself. This run writes the missing record.";
    let generation = storedExternal?.generation || 0;
    let externalDrift = Boolean(storedExternal && storedExternalFingerprint !== externalFingerprint);
    let warning = "";

    if (direction === "to-external") {
      if (session.machine_id === this.machineId) {
        if (Number(session.generation) !== generation || String(session.base_fingerprint || "") !== storedExternalFingerprint) {
          throw new LibraryBackupError("External Library changed after it was checked out. Backup was stopped.", "EXTERNAL_GENERATION_CHANGED");
        }
        if (externalDrift && !onlyAutomaticMetadataChanged(storedExternal, actualExternal)) {
          throw new LibraryBackupError("External Library was changed directly while Local Library was in use. Backup was stopped.", "EXTERNAL_CHANGED");
        }
      } else if (localBaseline && storedExternal && localBaseline.generation !== storedExternal.generation) {
        throw new LibraryBackupError("External Library has a newer backup. Restore it to Local Library before backing up.", "EXTERNAL_NEWER");
      } else if (externalDrift && !onlyAutomaticMetadataChanged(storedExternal, actualExternal)) {
        // Backing up is the Local Library's turn to write. A drive that no longer matches its
        // own record is usually the trace of a run that copied everything and then failed
        // before recording itself - refusing here would strand both directions. The case that
        // actually loses work, another computer having backed up something newer, is caught by
        // the generation check above, and anything replaced below is moved to history first.
        const drifted = unexpectedExternalKeys(storedExternal, actualExternal).length;
        const plural = drifted === 1 ? "" : "s";
        warning = `External Library differs from its last record in ${drifted} file${plural} - either a run that copied everything without recording itself, or work done straight on the drive. Only the changes listed here are written, and whatever they replace is kept in history.`;
      }
    } else if (librariesMatch && (externalDrift || (localBaseline && unsyncedChangeKeys(localBaseline, actualLocal).length))) {
      warning = unrecordedRun;
    } else {
      if (localBaseline) {
        const unsynced = unsyncedChangeKeys(localBaseline, actualLocal);
        if (unsynced.length) {
          const plural = unsynced.length === 1 ? "" : "s";
          throw new LibraryBackupError(
            `Local Library has ${unsynced.length} change${plural} that the backup does not have yet. Back up to External Library first.`,
            "LOCAL_UNSYNCED",
          );
        }
      } else if (actualLocal.records.size && unsyncedChangeKeys(actualExternal, actualLocal).length) {
        throw new LibraryBackupError("Local Library is not empty and has no matching backup baseline. Select an empty folder or back it up separately.", "LOCAL_BASELINE_MISSING");
      }
      if (externalDrift) generation += 1;
    }

    const sourceManifest = direction === "to-external" ? actualLocal : actualExternal;
    const destinationManifest = direction === "to-external" ? actualExternal : actualLocal;
    const changes = buildChangePlan(sourceManifest, destinationManifest);
    const portability = windowsPortabilityIssues(sourceManifest);
    if (portability.length) {
      const plural = portability.length === 1 ? "" : "s";
      warning = `${warning} ${portability.length} name${plural} cannot be recreated on a Windows computer, starting with ${portability[0]}.`.trim();
    }
    return {
      direction,
      ...context,
      generation,
      session,
      storedExternal,
      localBaseline,
      actualExternal,
      actualLocal,
      externalDrift,
      warning,
      sourceManifest,
      destinationManifest,
      sourceFingerprint: manifestFingerprint(sourceManifest),
      destinationFingerprint: manifestFingerprint(destinationManifest),
      changes,
      summary: summarizeChanges(changes),
      analyzedAt: utcNow(),
    };
  }

  // The review dialog sits between analyze() and execute(), so the situation has to be checked
  // again. Re-running the whole analysis would walk both libraries a second time - four full
  // passes for one backup - so only the drive's ownership, its recorded generation, and the
  // files actually named in the plan are re-read here.
  async confirmPlan(analysis) {
    const context = this.validate(analysis.direction);
    const session = readJson(context.paths.session);
    if (session.machine_id && session.machine_id !== this.machineId) throw sessionOwnerError(session);
    const storedExternal = loadStoredManifest(context.paths.externalManifest);
    const reviewed = analysis.storedExternal;
    const externalMoved = Boolean(storedExternal) !== Boolean(reviewed)
      || Boolean(storedExternal && reviewed && (
        storedExternal.generation !== reviewed.generation
        || manifestFingerprint(storedExternal) !== manifestFingerprint(reviewed)
      ));
    if (externalMoved) {
      throw new LibraryBackupError("External Library changed after the review. Refresh and review the backup again.", "PLAN_CHANGED");
    }
    const report = throttledProgress(this.progress);
    let checked = 0;
    for (const change of analysis.changes) {
      throwIfCancelled(this.signal);
      const stale = (change.sourceRecord && !(await fileMatchesRecord(analysis.source, change.sourceRecord, this.signal)))
        || (change.destinationRecord && !(await fileMatchesRecord(analysis.destination, change.destinationRecord, this.signal)));
      if (stale) {
        throw new LibraryBackupError("Library files changed after the review. Refresh and review the backup again.", "PLAN_CHANGED");
      }
      checked += 1;
      report({ phase: "confirm", message: `Rechecking reviewed changes: ${checked} of ${analysis.changes.length}`, current: checked, total: analysis.changes.length });
    }
    return { ...analysis, ...context };
  }

  async execute(analysis) {
    throwIfCancelled(this.signal);
    this.emit("Rechecking the reviewed changes.", 0, 1, "confirm");
    const current = await this.confirmPlan(analysis);
    const destinationControl = analysis.direction === "to-external" ? current.paths.externalControl : current.paths.localControl;
    const historyPath = await applyChanges(
      current.source,
      current.destination,
      current.changes,
      destinationControl,
      { progress: this.progress, signal: this.signal },
    );
    // From here the destination already holds the new files. Stopping now would leave the
    // libraries updated but the manifests unwritten, which locks both directions until the
    // control folders are deleted by hand - so verification and the manifest writes below
    // deliberately ignore the cancel signal. Comparing the destination against its own
    // pre-change manifest also forces every file this run touched to be hashed again.
    this.emit("Verifying completed backup.", null, null, "verify");
    const sourceAfter = await scanLibrary(current.source, { previous: current.sourceManifest });
    const destinationAfter = await scanLibrary(current.destination, { previous: current.destinationManifest });
    if (manifestFingerprint(sourceAfter) !== manifestFingerprint(destinationAfter)) {
      throw new LibraryBackupError("Final verification failed. Source and destination are different.", "VERIFY_FAILED");
    }

    if (analysis.direction === "to-external") {
      const nextGeneration = current.generation + (current.changes.length > 0 || !current.storedExternal ? 1 : 0);
      saveStoredManifest(current.paths.externalManifest, current.libraryId, nextGeneration, destinationAfter);
      saveStoredManifest(current.paths.localBaseline, current.libraryId, nextGeneration, sourceAfter);
      try { fs.unlinkSync(current.paths.session); } catch (_) {}
      this.emit("Backup to External Library completed.", 1, 1, "complete");
      return { direction: analysis.direction, generation: nextGeneration, changed: current.changes.length, historyPath, completedAt: utcNow() };
    }

    const nextGeneration = Math.max(1, current.generation || current.storedExternal?.generation || 1);
    saveStoredManifest(current.paths.externalManifest, current.libraryId, nextGeneration, sourceAfter);
    saveStoredManifest(current.paths.localBaseline, current.libraryId, nextGeneration, destinationAfter);
    writeJsonAtomic(current.paths.session, {
      schema_version: 1,
      library_id: current.libraryId,
      machine_id: this.machineId,
      platform: process.platform,
      generation: nextGeneration,
      base_fingerprint: manifestFingerprint(sourceAfter),
      started_at: utcNow(),
    });
    this.emit("Restore to Local Library completed.", 1, 1, "complete");
    return { direction: analysis.direction, generation: nextGeneration, changed: current.changes.length, historyPath, completedAt: utcNow() };
  }
}

function copyPriority(change) {
  const name = path.posix.basename(change.relativePath);
  if (name === "library.json") return 3;
  if (name === "post.json") return 2;
  if (change.relativePath.startsWith("sql_data/")) return 1;
  return 0;
}

function removeTreeSafely(target, allowedParent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(allowedParent);
  const relation = path.relative(resolvedParent, resolvedTarget);
  if (!relation || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new LibraryBackupError(`Refused to remove unsafe staging path: ${target}`, "UNSAFE_CLEANUP");
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function pruneStagingRoot(controlRoot) {
  const stagingParent = path.join(controlRoot, "staging");
  if (!pathExists(stagingParent)) return;
  for (const entry of fs.readdirSync(stagingParent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { removeTreeSafely(path.join(stagingParent, entry.name), stagingParent); } catch (_) {}
  }
  try { fs.rmdirSync(stagingParent); } catch (_) {}
}

function pruneOldHistory(controlRoot) {
  const historyParent = path.join(controlRoot, "history");
  if (!pathExists(historyParent)) return;
  const oldestAllowed = Date.now() - HISTORY_RETENTION_MS;
  for (const entry of fs.readdirSync(historyParent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(historyParent, entry.name);
    try {
      if (fs.statSync(target).mtimeMs < oldestAllowed) removeTreeSafely(target, historyParent);
    } catch (_) {}
  }
  try { fs.rmdirSync(historyParent); } catch (_) {}
}

function pruneEmptyDirectories(root) {
  const prune = (directory, top) => {
    if (!pathExists(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) prune(path.join(directory, entry.name), top);
    }
    if (directory !== top) {
      try { fs.rmdirSync(directory); } catch (_) {}
    }
  };
  for (const name of CONTENT_DIRECTORIES) {
    const top = path.join(root, name);
    prune(top, top);
  }
}

async function copyFileVerified(sourcePath, destinationPath, expectedHash, signal) {
  throwIfCancelled(signal);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  const sourceStat = await fs.promises.stat(sourcePath);
  await fs.promises.utimes(destinationPath, sourceStat.atime, sourceStat.mtime).catch(() => {});
  const actualHash = await sha256File(destinationPath, signal);
  if (actualHash !== expectedHash) {
    throw new LibraryBackupError(`Copy verification failed: ${path.basename(destinationPath)}`, "COPY_VERIFY_FAILED");
  }
}

async function applyChanges(sourceRoot, destinationRoot, changes, controlRoot, { progress = null, signal = null } = {}) {
  if (!changes.length) return "";
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.mkdirSync(controlRoot, { recursive: true });
  pruneStagingRoot(controlRoot);
  pruneOldHistory(controlRoot);
  const destinationDevice = fs.statSync(destinationRoot).dev;
  const controlDevice = fs.statSync(controlRoot).dev;
  if (destinationDevice !== controlDevice) {
    throw new LibraryBackupError("Backup staging folder is not on the destination drive.", "STAGING_VOLUME_MISMATCH");
  }
  const runId = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomSuffix()}`;
  const stagingRoot = path.join(controlRoot, "staging", runId);
  const historyRoot = path.join(controlRoot, "history", runId);
  fs.mkdirSync(path.dirname(stagingRoot), { recursive: true });
  fs.mkdirSync(stagingRoot, { recursive: false });
  const copied = [];
  const copyChanges = changes
    .filter((change) => change.action !== "delete")
    .sort((a, b) => copyPriority(a) - copyPriority(b) || a.relativePath.localeCompare(b.relativePath, "en"));
  const total = copyChanges.length + changes.length;
  const report = throttledProgress(progress);
  let completed = 0;
  try {
    for (const change of copyChanges) {
      throwIfCancelled(signal);
      const sourcePath = safePath(sourceRoot, change.sourceRecord.diskRelativePath);
      const stagedPath = safePath(stagingRoot, change.relativePath);
      await copyFileVerified(sourcePath, stagedPath, change.sourceRecord.sha256, signal);
      copied.push({ change, stagedPath });
      completed += 1;
      report({ phase: "copy", message: `Copy verified: ${change.relativePath}`, current: completed, total });
    }

    const rollback = [];
    try {
      for (const { change, stagedPath } of copied) {
        throwIfCancelled(signal);
        const destinationPath = safePath(destinationRoot, change.relativePath);
        const oldPath = change.destinationRecord
          ? safePath(destinationRoot, change.destinationRecord.diskRelativePath)
          : destinationPath;
        let historyPath = "";
        if (pathExists(oldPath)) {
          historyPath = safePath(historyRoot, change.relativePath);
          fs.mkdirSync(path.dirname(historyPath), { recursive: true });
          fs.renameSync(oldPath, historyPath);
        }
        rollback.push({ destinationPath, historyPath });
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.renameSync(stagedPath, destinationPath);
        completed += 1;
        report({ phase: "apply", message: `Applied: ${change.relativePath}`, current: completed, total });
      }
      const deletes = changes
        .filter((change) => change.action === "delete")
        .sort((a, b) => b.relativePath.split("/").length - a.relativePath.split("/").length);
      for (const change of deletes) {
        throwIfCancelled(signal);
        const destinationPath = safePath(destinationRoot, change.destinationRecord.diskRelativePath);
        let historyPath = "";
        if (pathExists(destinationPath)) {
          historyPath = safePath(historyRoot, change.relativePath);
          fs.mkdirSync(path.dirname(historyPath), { recursive: true });
          fs.renameSync(destinationPath, historyPath);
          rollback.push({ destinationPath, historyPath });
        }
        completed += 1;
        report({ phase: "apply", message: `Moved to history: ${change.relativePath}`, current: completed, total });
      }
    } catch (error) {
      for (const item of rollback.reverse()) {
        try {
          if (pathExists(item.destinationPath)) fs.unlinkSync(item.destinationPath);
          if (item.historyPath && pathExists(item.historyPath)) {
            fs.mkdirSync(path.dirname(item.destinationPath), { recursive: true });
            fs.renameSync(item.historyPath, item.destinationPath);
          }
        } catch (_) {}
      }
      throw error;
    }
    pruneEmptyDirectories(destinationRoot);
  } finally {
    // Clearing the staging area is housekeeping, not part of the backup. Some filesystems -
    // exFAT on a removable drive especially - answer ENOTEMPTY for a directory whose files
    // were just moved out of it. Letting that escape would fail a backup whose files are
    // already in place and leave the manifests unwritten, locking both directions. Anything
    // left behind is cleared at the start of the next run.
    try {
      removeTreeSafely(stagingRoot, controlRoot);
    } catch (error) {
      report({ phase: "apply", message: `Staging folder left for the next run: ${error.message}`, current: total, total });
    }
    try { fs.rmdirSync(path.join(controlRoot, "staging")); } catch (_) {}
  }
  return pathExists(historyRoot) ? historyRoot : "";
}

function inspectPaths(localRoot, externalRoot, machineId) {
  const result = {
    ok: true,
    local: { path: String(localRoot || ""), exists: false, library: false },
    external: { path: String(externalRoot || ""), exists: false, library: false },
    ready: false,
    message: "Select both library folders.",
  };
  for (const [key, value] of [["local", localRoot], ["external", externalRoot]]) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    const exists = pathExists(resolved) && fs.statSync(resolved).isDirectory();
    result[key] = { path: resolved, exists, library: exists && Boolean(libraryIdentity(resolved)) };
  }
  if (!localRoot || !externalRoot) return result;
  if (!result.local.exists || !result.external.exists) {
    result.message = "One of the selected folders was not found.";
    return result;
  }
  try {
    validateDistinctRoots(result.local.path, result.external.path);
    const id = libraryIdentity(result.local.path) || libraryIdentity(result.external.path);
    if (!id) {
      result.message = "Select at least one existing Chameleon library.";
      return result;
    }
    const otherId = result.local.library && result.external.library
      ? libraryIdentity(result.local.path) === libraryIdentity(result.external.path)
      : true;
    if (!otherId) {
      result.message = "Local and External folders contain different libraries.";
      return result;
    }
    const paths = metadataPaths(result.local.path, result.external.path, id);
    const session = readJson(paths.session);
    if (session.machine_id && session.machine_id !== machineId) {
      result.message = "External Library is currently in use by another computer.";
      result.blocked = true;
      return result;
    }
    result.ready = true;
    result.session_active = session.machine_id === machineId;
    result.message = result.session_active
      ? "External Library was restored to this computer. Back up local changes when finished."
      : "Ready to compare libraries.";
    return result;
  } catch (error) {
    result.message = error.message;
    return result;
  }
}

module.exports = {
  LibraryBackup,
  LibraryBackupError,
  applyChanges,
  buildChangePlan,
  inspectPaths,
  isTerminalJob,
  libraryIdentity,
  manifestFingerprint,
  scanLibrary,
  summarizeChanges,
};
