const { app, BrowserWindow, Menu, session, dialog, screen, ipcMain, nativeImage, nativeTheme } = require("electron");
const { spawn, execFile, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");

const APP_NAME = "Grok Chameleon";
const APP_BUNDLE_IDENTIFIER = "local.grokchameleon.app";
const APP_ROOT = path.resolve(__dirname, "..");
const CERTIFI_CA = path.join(APP_ROOT, "vendor", "python", "certifi", "cacert.pem");
const VENDOR_PYTHON = path.join(APP_ROOT, "vendor", "python");
const PORT = String(process.env.GROK_CHAMELEON_PORT || "8797");
const CDP_PORT = String(process.env.GROK_CHAMELEON_CDP_PORT || "0");
const SERVER_BASE = `http://127.0.0.1:${PORT}`;
const GROK_USAGE_URL = "https://grok.com/?_s=usage";

function portableFileDigest(filePath) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch (_) {
    return "";
  }
}

function portableBundleFingerprint(bundlePath) {
  const appRoot = path.join(bundlePath, "Contents", "Resources", "app");
  const relativePaths = [
    path.join("electron", "main.js"),
    path.join("runtime", "server.py"),
    path.join("web", "index.html"),
  ];
  const digests = relativePaths.map((relativePath) => portableFileDigest(path.join(appRoot, relativePath)));
  return digests.every(Boolean) ? digests.join(":") : "";
}

function addMacBundleCandidates(candidates, root, depth = 1) {
  if (!root || depth < 0) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    if (entry.name.endsWith(".app")) {
      candidates.add(candidate);
      continue;
    }
    if (depth > 0) addMacBundleCandidates(candidates, candidate, depth - 1);
  }
}

function macOriginalBundleCandidates(fingerprint = "") {
  const candidates = new Set();
  try {
    const query = `kMDItemCFBundleIdentifier == "${APP_BUNDLE_IDENTIFIER}"`;
    const output = execFileSync("/usr/bin/mdfind", [query], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const candidate of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      if (candidate.endsWith(".app")) candidates.add(candidate);
    }
  } catch (_) {}
  if (
    fingerprint
    && Array.from(candidates).some((candidate) => portableBundleFingerprint(candidate) === fingerprint)
  ) {
    return Array.from(candidates);
  }
  for (const root of [
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Applications"),
    "/Applications",
  ]) {
    addMacBundleCandidates(candidates, root, 1);
  }
  try {
    for (const volume of fs.readdirSync("/Volumes", { withFileTypes: true })) {
      if (volume.isDirectory()) addMacBundleCandidates(candidates, path.join("/Volumes", volume.name), 1);
    }
  } catch (_) {}
  return Array.from(candidates);
}

function macQuarantineValue(bundlePath) {
  try {
    return execFileSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", bundlePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    return "";
  }
}

function resolveTranslocatedMacBundle(currentBundlePath) {
  const fingerprint = portableBundleFingerprint(currentBundlePath);
  if (!fingerprint) throw new Error("Portable app identity could not be read.");
  let matches = macOriginalBundleCandidates(fingerprint)
    .filter((candidate) => !candidate.includes(`${path.sep}AppTranslocation${path.sep}`))
    .filter((candidate) => portableBundleFingerprint(candidate) === fingerprint);
  if (matches.length > 1) {
    const quarantine = macQuarantineValue(currentBundlePath);
    const quarantineMatches = quarantine
      ? matches.filter((candidate) => macQuarantineValue(candidate) === quarantine)
      : [];
    if (quarantineMatches.length) matches = quarantineMatches;
  }
  if (matches.length > 1) {
    const indexText = fs.readFileSync(path.join(APP_ROOT, "web", "index.html"), "utf8");
    const expectedParent = indexText.includes('id="i_unsaved_nav_btn"') ? "Grok Chameleon U" : "Grok Chameleon";
    const namedMatches = matches.filter((candidate) => path.basename(path.dirname(candidate)) === expectedParent);
    if (namedMatches.length) matches = namedMatches;
  }
  const uniqueMatches = Array.from(new Set(matches.map((candidate) => {
    try {
      return fs.realpathSync(candidate);
    } catch (_) {
      return path.resolve(candidate);
    }
  })));
  if (uniqueMatches.length !== 1) {
    throw new Error("Portable app folder could not be identified uniquely. Keep one matching app copy or set GROK_CHAMELEON_PORTABLE_ROOT.");
  }
  return uniqueMatches[0];
}

function validatePortableRoot(rootPath) {
  const resolved = path.resolve(rootPath);
  if (resolved === path.parse(resolved).root) throw new Error("Refusing unsafe portable app root.");
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
  return resolved;
}

function resolvePortableRoot() {
  const override = String(process.env.GROK_CHAMELEON_PORTABLE_ROOT || "").trim();
  if (override) return validatePortableRoot(override);
  const resourcesPath = path.resolve(process.resourcesPath || path.join(APP_ROOT, ".."));
  if (process.platform === "darwin") {
    const currentBundlePath = path.resolve(resourcesPath, "..", "..");
    const bundlePath = currentBundlePath.includes(`${path.sep}AppTranslocation${path.sep}`)
      ? resolveTranslocatedMacBundle(currentBundlePath)
      : currentBundlePath;
    return validatePortableRoot(path.dirname(bundlePath));
  }
  if (process.platform === "win32") {
    return validatePortableRoot(path.resolve(resourcesPath, "..", "..", ".."));
  }
  return validatePortableRoot(path.resolve(resourcesPath, "..", "..", ".."));
}

function readPortableJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function portablePlatformKey() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function verifiedPortableLibraryRoot(value) {
  const text = String(value || "").trim();
  if (!text || !path.isAbsolute(text)) return "";
  const root = path.resolve(text);
  if (root === path.parse(root).root || !fs.existsSync(path.join(root, "library.json"))) return "";
  try {
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    return root;
  } catch (_) {
    return "";
  }
}

function portableLibraryRootFromSettings(filePath) {
  return verifiedPortableLibraryRoot(readPortableJson(filePath).library_root);
}

function atomicWritePortableJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

function legacyPortableSettingsPaths(portableRoot, platformKey) {
  const paths = [
    path.join(portableRoot, "runtime_data", platformKey, "settings.json"),
    path.join(portableRoot, "runtime_data", "settings.json"),
    path.join(portableRoot, "runtime", platformKey, "settings.json"),
    path.join(portableRoot, "runtime", "settings.json"),
  ];
  if (process.platform === "darwin") {
    paths.push(path.join(os.homedir(), "Library", "Application Support", APP_NAME, "settings.json"));
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    paths.push(path.join(appData, APP_NAME, "settings.json"));
  }
  return paths;
}

function resolvePortableLibraryRoot(portableRoot, pointerPaths, platformKey) {
  const override = verifiedPortableLibraryRoot(process.env.GROK_CHAMELEON_LIBRARY_ROOT);
  if (override) return override;
  for (const pointerPath of pointerPaths) {
    const pointer = readPortableJson(pointerPath);
    const pointerRoot = verifiedPortableLibraryRoot(
      pointer?.paths?.[platformKey] || pointer.library_root,
    );
    if (pointerRoot) return pointerRoot;
  }
  for (const settingsPath of legacyPortableSettingsPaths(portableRoot, platformKey)) {
    const root = portableLibraryRootFromSettings(settingsPath);
    if (root) return root;
  }
  return "";
}

function hidePortableFile(filePath) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("attrib", ["+H", filePath], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (_) {}
}

function writePortableLibraryPointer(pointerPath, platformKey, libraryRoot, legacyPointerPath = "") {
  const current = readPortableJson(pointerPath);
  const legacy = legacyPointerPath ? readPortableJson(legacyPointerPath) : {};
  atomicWritePortableJson(pointerPath, {
    version: 1,
    paths: {
      ...(legacy.paths && typeof legacy.paths === "object" ? legacy.paths : {}),
      ...(current.paths && typeof current.paths === "object" ? current.paths : {}),
      [platformKey]: libraryRoot,
    },
    updated_at: new Date().toISOString(),
  });
  hidePortableFile(pointerPath);
}

function removeLegacyPortableLibraryPointer(legacyPointerPath, pointerPath) {
  if (path.resolve(legacyPointerPath) === path.resolve(pointerPath)) return;
  try {
    fs.unlinkSync(legacyPointerPath);
  } catch (_) {}
}

function seedPortableLibrarySettings(runtimeDir, libraryRoot) {
  const settingsPath = path.join(runtimeDir, "settings.json");
  if (fs.existsSync(settingsPath)) return;
  atomicWritePortableJson(settingsPath, {
    library_root: libraryRoot,
    updated_at: new Date().toISOString(),
  });
}

function portablePathContains(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return (
    relative === ""
    || (
      !path.isAbsolute(relative)
      && relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
    )
  );
}

function removeObsoletePortableRuntime(portableRoot, activeRuntimeRoot) {
  for (const directoryName of ["runtime_data", "runtime"]) {
    const obsolete = path.resolve(portableRoot, directoryName);
    if (
      portablePathContains(obsolete, activeRuntimeRoot)
      || path.dirname(obsolete) !== path.resolve(portableRoot)
      || path.basename(obsolete) !== directoryName
    ) {
      continue;
    }
    fs.rmSync(obsolete, { recursive: true, force: true });
  }
}

const PORTABLE_ROOT = resolvePortableRoot();
const PLATFORM_RUNTIME_KEY = portablePlatformKey();
const LIBRARY_POINTER_PATH = path.join(PORTABLE_ROOT, ".library_path.json");
const LEGACY_LIBRARY_POINTER_PATH = path.join(PORTABLE_ROOT, "library_path.json");
const SELECTED_LIBRARY_ROOT = resolvePortableLibraryRoot(
  PORTABLE_ROOT,
  [LIBRARY_POINTER_PATH, LEGACY_LIBRARY_POINTER_PATH],
  PLATFORM_RUNTIME_KEY,
);
const RUNTIME_ROOT = SELECTED_LIBRARY_ROOT
  ? path.join(SELECTED_LIBRARY_ROOT, "runtime_data")
  : path.join(PORTABLE_ROOT, "runtime_data");
const RUNTIME_DIR = path.join(RUNTIME_ROOT, PLATFORM_RUNTIME_KEY);
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const TEMP_DIR = path.join(RUNTIME_DIR, "temp");
const CRASH_DUMPS_DIR = path.join(RUNTIME_DIR, "crash_dumps");
for (const directory of [RUNTIME_DIR, LOG_DIR, TEMP_DIR, CRASH_DUMPS_DIR]) {
  fs.mkdirSync(directory, { recursive: true });
}
if (SELECTED_LIBRARY_ROOT) {
  seedPortableLibrarySettings(RUNTIME_DIR, SELECTED_LIBRARY_ROOT);
  writePortableLibraryPointer(
    LIBRARY_POINTER_PATH,
    PLATFORM_RUNTIME_KEY,
    SELECTED_LIBRARY_ROOT,
    LEGACY_LIBRARY_POINTER_PATH,
  );
  removeLegacyPortableLibraryPointer(
    LEGACY_LIBRARY_POINTER_PATH,
    LIBRARY_POINTER_PATH,
  );
  removeObsoletePortableRuntime(PORTABLE_ROOT, RUNTIME_ROOT);
}
app.setPath("userData", RUNTIME_DIR);
app.setPath("sessionData", RUNTIME_DIR);
app.setPath("temp", TEMP_DIR);
app.setPath("crashDumps", CRASH_DUMPS_DIR);
app.setAppLogsPath(LOG_DIR);

const LOG_FILE = path.join(LOG_DIR, "grok_chameleon.log");
const BRIDGE_WINDOW_WIDTH = 960;
const BRIDGE_WINDOW_HEIGHT = 760;

if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-audio-input");
}

if (CDP_PORT && CDP_PORT !== "0") {
  app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}

let mainWindow = null;
let serverProcess = null;
let bridgePolling = false;
let appTerminating = false;
const bridgeWindows = new Map();
const bridgeCommandQueues = new Map();
const usageWindows = new Map();
const CARD_PREVIEW_MAX_EDGE = 960;
const THUMBNAIL_PREVIEW_MAX_EDGE = 320;
const CARD_PREVIEW_MAX_ACTIVE = 2;
const CARD_PREVIEW_MAX_FILES = 5000;
const CARD_PREVIEW_MAX_BYTES = 512 * 1024 * 1024;
const cardPreviewQueue = [];
const cardPreviewTasks = new Map();
const cardPreviewPruneTimes = new Map();
let activeCardPreviewTasks = 0;
let lastVerifiedCardPreviewCacheDir = "";

function appendLog(line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch (_) {}
}

function verifiedLibraryCardPreviewCacheDir(info = {}) {
  const libraryRoot = String(info?.library_root || "").trim();
  const cacheDir = String(info?.cache_dir || "").trim();
  if (!path.isAbsolute(libraryRoot) || !path.isAbsolute(cacheDir)) {
    throw new Error("Card preview library cache path is invalid.");
  }
  const resolvedLibraryRoot = path.resolve(libraryRoot);
  const expectedCacheDir = path.resolve(resolvedLibraryRoot, "cache", "card-previews");
  const resolvedCacheDir = path.resolve(cacheDir);
  if (
    resolvedLibraryRoot === path.parse(resolvedLibraryRoot).root
    || resolvedCacheDir !== expectedCacheDir
    || path.dirname(resolvedCacheDir) !== path.join(resolvedLibraryRoot, "cache")
    || path.basename(resolvedCacheDir) !== "card-previews"
    || !fs.existsSync(path.join(resolvedLibraryRoot, "library.json"))
  ) {
    throw new Error("Refusing unsafe card preview cache path.");
  }
  lastVerifiedCardPreviewCacheDir = resolvedCacheDir;
  return resolvedCacheDir;
}

function normalizedPreviewKind(value) {
  return String(value || "").trim().toLowerCase() === "thumbnail" ? "thumbnail" : "card";
}

function verifiedLibraryBuildPreviewDir(info = {}, kind = "card") {
  const libraryRoot = String(info?.library_root || "").trim();
  const previewDir = String(info?.preview_dir || "").trim();
  const normalizedKind = normalizedPreviewKind(kind);
  if (!path.isAbsolute(libraryRoot) || !path.isAbsolute(previewDir)) {
    throw new Error("Build preview path is invalid.");
  }
  const resolvedLibraryRoot = path.resolve(libraryRoot);
  const expectedDir = path.resolve(
    resolvedLibraryRoot,
    "previews",
    "build",
    normalizedKind === "thumbnail" ? "thumbnails" : "cards",
  );
  const resolvedPreviewDir = path.resolve(previewDir);
  if (
    resolvedLibraryRoot === path.parse(resolvedLibraryRoot).root
    || resolvedPreviewDir !== expectedDir
    || !fs.existsSync(path.join(resolvedLibraryRoot, "library.json"))
  ) {
    throw new Error("Refusing unsafe build preview path.");
  }
  return resolvedPreviewDir;
}

function clearVerifiedCardPreviewCache(cacheDir, reason = "cleanup") {
  if (!cacheDir || path.resolve(cacheDir) !== lastVerifiedCardPreviewCacheDir) return false;
  try {
    const verifiedCacheDir = lastVerifiedCardPreviewCacheDir;
    fs.rmSync(verifiedCacheDir, { recursive: true, force: true });
    cardPreviewPruneTimes.delete(verifiedCacheDir);
    appendLog(`card preview cache cleared reason=${reason} path=${verifiedCacheDir}`);
    return true;
  } catch (error) {
    appendLog(`card preview cache cleanup failed reason=${reason} path=${lastVerifiedCardPreviewCacheDir} detail=${error.message || String(error)}`);
    return false;
  }
}

async function waitForCardPreviewTasks() {
  const tasks = Array.from(cardPreviewTasks.values());
  if (tasks.length) await Promise.allSettled(tasks);
}

async function clearCurrentCardPreviewCache(reason = "cleanup") {
  try {
    const info = await fetchJson(`${SERVER_BASE}/api/card-preview/cache-info`, {
      signal: AbortSignal.timeout(3000),
    });
    const cacheDir = verifiedLibraryCardPreviewCacheDir(info);
    return clearVerifiedCardPreviewCache(cacheDir, reason);
  } catch (error) {
    appendLog(`card preview cache cleanup skipped reason=${reason} detail=${error.message || String(error)}`);
    return false;
  }
}

function cardPreviewResult(key, storage = "cache", kind = "card") {
  const normalizedKind = normalizedPreviewKind(kind);
  return {
    key,
    storage,
    kind: normalizedKind,
    url: storage === "build"
      ? `/api/build-preview?kind=${normalizedKind}&key=${key}`
      : `/api/card-preview?key=${key}`,
  };
}

function pumpCardPreviewQueue() {
  while (activeCardPreviewTasks < CARD_PREVIEW_MAX_ACTIVE && cardPreviewQueue.length) {
    const entry = cardPreviewQueue.shift();
    activeCardPreviewTasks += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        activeCardPreviewTasks -= 1;
        pumpCardPreviewQueue();
      });
  }
}

function queueCardPreviewTask(task) {
  return new Promise((resolve, reject) => {
    cardPreviewQueue.push({ task, resolve, reject });
    pumpCardPreviewQueue();
  });
}

function pruneCardPreviewCache(cacheDir, protectedPath = "") {
  const now = Date.now();
  const lastPruneAt = Number(cardPreviewPruneTimes.get(cacheDir) || 0);
  if (now - lastPruneAt < 5 * 60 * 1000) return;
  cardPreviewPruneTimes.set(cacheDir, now);
  let entries = [];
  try {
    entries = fs.readdirSync(cacheDir)
      .filter((name) => /^[a-f0-9]{64}\.jpg$/.test(name))
      .map((name) => {
        const filePath = path.join(cacheDir, name);
        const stat = fs.statSync(filePath);
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      });
  } catch (_) {
    return;
  }
  let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  if (entries.length <= CARD_PREVIEW_MAX_FILES && totalBytes <= CARD_PREVIEW_MAX_BYTES) return;
  entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
  const targetFiles = Math.floor(CARD_PREVIEW_MAX_FILES * 0.8);
  const targetBytes = Math.floor(CARD_PREVIEW_MAX_BYTES * 0.8);
  while (entries.length > targetFiles || totalBytes > targetBytes) {
    const entry = entries.shift();
    if (!entry) break;
    if (entry.filePath === protectedPath) continue;
    try {
      fs.unlinkSync(entry.filePath);
      totalBytes -= entry.size;
    } catch (_) {}
  }
}

function touchCardPreviewCacheFile(filePath) {
  try {
    const now = new Date();
    fs.utimesSync(filePath, now, now);
  } catch (_) {}
}

async function pruneCardPreviewCacheAtStartup() {
  try {
    const info = await fetchJson(`${SERVER_BASE}/api/card-preview/cache-info`, {
      signal: AbortSignal.timeout(3000),
    });
    const cacheDir = String(info?.cache_dir || "").trim();
    if (!path.isAbsolute(cacheDir)) return;
    fs.mkdirSync(cacheDir, { recursive: true });
    pruneCardPreviewCache(cacheDir);
  } catch (error) {
    appendLog(`card preview startup prune skipped: ${error.message || String(error)}`);
  }
}

function localCardPreviewSource(rawUrl) {
  const source = String(rawUrl || "").trim();
  if (!source || source.length > 4096) throw new Error("Invalid card preview URL.");
  const parsed = new URL(source, SERVER_BASE);
  if (parsed.origin !== new URL(SERVER_BASE).origin || parsed.pathname !== "/api/media") {
    throw new Error("Unsupported card preview URL.");
  }
  return parsed;
}

function usablePreviewFile(filePath) {
  try {
    if (fs.statSync(filePath).size <= 0) return false;
    return !nativeImage.createFromPath(filePath).isEmpty();
  } catch (_) {
    return false;
  }
}

async function generateCardPreview(sourcePath, targetPath, kind = "card") {
  const normalizedKind = normalizedPreviewKind(kind);
  const maxPreviewEdge = normalizedKind === "thumbnail" ? THUMBNAIL_PREVIEW_MAX_EDGE : CARD_PREVIEW_MAX_EDGE;
  const jpegQuality = normalizedKind === "thumbnail" ? 78 : 82;
  const isVideo = /\.(?:m4v|mov|mp4|webm)$/i.test(sourcePath);
  const sourceImage = isVideo
    ? await nativeImage.createThumbnailFromPath(sourcePath, { width: maxPreviewEdge, height: maxPreviewEdge })
    : nativeImage.createFromBuffer(fs.readFileSync(sourcePath));
  if (sourceImage.isEmpty()) throw new Error("Card preview source is not a supported image.");
  const sourceSize = sourceImage.getSize();
  const maxEdge = Math.max(sourceSize.width, sourceSize.height);
  const previewImage = maxEdge > maxPreviewEdge
    ? sourceImage.resize(
      sourceSize.width >= sourceSize.height
        ? { width: maxPreviewEdge, quality: "good" }
        : { height: maxPreviewEdge, quality: "good" },
    )
    : sourceImage;
  const previewBytes = previewImage.toJPEG(jpegQuality);
  if (!previewBytes.length) throw new Error("Could not encode card preview.");
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, previewBytes);
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    if (!fs.existsSync(targetPath)) throw error;
  }
}

async function ensureCardPreview(payload = {}) {
  const source = localCardPreviewSource(payload.url);
  const previewKind = normalizedPreviewKind(payload.kind);
  const infoUrl = new URL("/api/card-preview/source-info", SERVER_BASE);
  infoUrl.search = source.search;
  infoUrl.searchParams.set("preview_kind", previewKind);
  const info = await fetchJson(infoUrl, { signal: AbortSignal.timeout(3000) });
  const sourcePath = String(info?.source_path || "").trim();
  const storage = info?.storage === "build" ? "build" : "cache";
  const previewKey = String(info?.preview_key || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(previewKey)) {
    throw new Error("Card preview key is invalid.");
  }
  const previewDir = storage === "build"
    ? verifiedLibraryBuildPreviewDir(info, previewKind)
    : verifiedLibraryCardPreviewCacheDir(info);
  if (!path.isAbsolute(sourcePath)) {
    throw new Error("Card preview source path is invalid.");
  }
  const targetPath = path.join(previewDir, `${previewKey}.jpg`);
  const taskKey = `${previewDir}\0${previewKey}`;
  if (usablePreviewFile(targetPath)) {
    if (storage === "cache") {
      touchCardPreviewCacheFile(targetPath);
      pruneCardPreviewCache(previewDir, targetPath);
    }
    return cardPreviewResult(previewKey, storage, previewKind);
  }
  try {
    fs.unlinkSync(targetPath);
  } catch (_) {}
  if (cardPreviewTasks.has(taskKey)) return cardPreviewTasks.get(taskKey);
  const task = queueCardPreviewTask(async () => {
    fs.mkdirSync(previewDir, { recursive: true });
    if (usablePreviewFile(targetPath)) {
      if (storage === "cache") {
        touchCardPreviewCacheFile(targetPath);
        pruneCardPreviewCache(previewDir, targetPath);
      }
      return cardPreviewResult(previewKey, storage, previewKind);
    }
    try {
      fs.unlinkSync(targetPath);
    } catch (_) {}
    await generateCardPreview(sourcePath, targetPath, previewKind);
    if (storage === "cache") pruneCardPreviewCache(previewDir, targetPath);
    return cardPreviewResult(previewKey, storage, previewKind);
  });
  cardPreviewTasks.set(taskKey, task);
  try {
    return await task;
  } finally {
    cardPreviewTasks.delete(taskKey);
  }
}

const guardedSessions = new WeakSet();

function isMediaCapturePermission(permission, details = {}) {
  const name = String(permission || "").toLowerCase();
  if (["media", "camera", "microphone", "audio", "video", "audiocapture", "videocapture"].includes(name)) {
    return true;
  }
  const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
  return mediaTypes.some((type) => {
    const value = String(type || "").toLowerCase();
    return value === "audio" || value === "video" || value === "camera" || value === "microphone";
  });
}

function installMediaPermissionGuard(targetSession) {
  if (!targetSession || guardedSessions.has(targetSession)) return;
  guardedSessions.add(targetSession);
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details = {}) => {
    callback(!isMediaCapturePermission(permission, details));
  });
  targetSession.setPermissionCheckHandler((_webContents, permission, _origin, details = {}) => {
    return !isMediaCapturePermission(permission, details);
  });
}

function installMediaPermissionGuards() {
  installMediaPermissionGuard(session.defaultSession);
  app.on("web-contents-created", (_event, contents) => {
    installMediaPermissionGuard(contents.session);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function centeredWindowBounds(width = BRIDGE_WINDOW_WIDTH, height = BRIDGE_WINDOW_HEIGHT) {
  const referenceBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const display = referenceBounds ? screen.getDisplayMatching(referenceBounds) : screen.getPrimaryDisplay();
  const area = display?.workArea || { x: 0, y: 0, width, height };
  return {
    x: Math.max(area.x, Math.round(area.x + (area.width - width) / 2)),
    y: Math.max(area.y, Math.round(area.y + (area.height - height) / 2)),
    width,
    height,
  };
}

function placeBridgeWindow(win, title = "") {
  if (!win || win.isDestroyed()) return;
  const bounds = centeredWindowBounds();
  win.setBounds(bounds, false);
  if (title) win.setTitle(title);
}

function showBridgeWindow(win, title = "") {
  placeBridgeWindow(win, title);
  win.show();
  win.focus();
  app.focus({ steal: true });
}

function showUsageWindow(win, title = "") {
  if (!win || win.isDestroyed()) return;
  placeBridgeWindow(win, title);
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  app.focus({ steal: true });
  win.moveTop();
  win.focus();
  appendLog("usage window brought to front");
  const releaseAlwaysOnTop = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(false);
    win.moveTop();
    win.focus();
  }, 250);
  releaseAlwaysOnTop.unref?.();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { text };
    }
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data;
}

async function serverAlive() {
  try {
    await fetchJson(`${SERVER_BASE}/api/health`, { signal: AbortSignal.timeout(900) });
    return true;
  } catch (_) {
    return false;
  }
}

function serverPortNumber() {
  const parsed = Number.parseInt(PORT, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8797;
}

function serverPortOpen(timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: serverPortNumber() });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function requestShutdown() {
  try {
    await fetchJson(`${SERVER_BASE}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "electron-shutdown" }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (_) {}
}

function execFileQuiet(file, args = [], options = {}) {
  try {
    return execFileSync(file, args, { stdio: "ignore", ...options });
  } catch (_) {
    return null;
  }
}

function sleepSync(ms) {
  const duration = Math.max(0, Number(ms) || 0);
  if (!duration) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
  } catch (_) {}
}

function requestShutdownSync() {
  if (process.platform === "win32") return;
  execFileQuiet("/usr/bin/curl", [
    "-fsS",
    "-m",
    "1.2",
    "-X",
    "POST",
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({ event: "electron-shutdown" }),
    `${SERVER_BASE}/api/shutdown`,
  ]);
}

function serverPortPids() {
  if (process.platform === "win32") return [];
  try {
    const output = execFileSync("/usr/sbin/lsof", ["-ti", `tcp:${PORT}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
  } catch (_) {
    return [];
  }
}

function killServerPortPids(signal = "TERM") {
  if (process.platform === "win32") return;
  const pids = serverPortPids();
  if (!pids.length) return;
  execFileQuiet("/bin/kill", [`-${signal}`, ...pids.map(String)]);
}

function closeAccountWindowsNow() {
  for (const win of bridgeWindows.values()) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch (_) {}
  }
  bridgeWindows.clear();
  for (const win of usageWindows.values()) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch (_) {}
  }
  usageWindows.clear();
}

function closeBridgeWindowsNow() {
  closeAccountWindowsNow();
  bridgeCommandQueues.clear();
}

function shutdownServerNow(notifyServer = true) {
  if (notifyServer) requestShutdownSync();
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill("SIGTERM");
    } catch (_) {}
  }
  killServerPortPids("TERM");
  sleepSync(200);
  killServerPortPids("KILL");
  serverProcess = null;
}

async function exitAppNow(reason = "app-exit") {
  if (appTerminating) return;
  appTerminating = true;
  app.isQuitting = true;
  appendLog(`app exit reason=${reason}`);
  closeBridgeWindowsNow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.removeAllListeners("close");
      mainWindow.destroy();
    } catch (_) {}
  }
  await waitForCardPreviewTasks();
  await clearCurrentCardPreviewCache("shutdown");
  await requestShutdown();
  shutdownServerNow(false);
  app.exit(0);
  setTimeout(() => process.exit(0), 100).unref();
}

function findPython() {
  const candidates = [];
  if (process.platform === "win32") {
    const resourceRoot = process.resourcesPath || "";
    candidates.push(
      path.resolve(resourceRoot, "..", "..", "Python", "python.exe"),
    );
  } else {
    const resourceRoot = process.resourcesPath || "";
    candidates.push(
      path.join(resourceRoot, "Python", "bin", "python3"),
      path.join(resourceRoot, "Python", "bin", "python3.14"),
      path.join(APP_ROOT, "Python", "bin", "python3"),
      path.join(APP_ROOT, "Python", "bin", "python3.14"),
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
      path.join(os.homedir(), ".pyenv", "shims", "python3"),
      path.join(os.homedir(), "miniconda3", "bin", "python3"),
      path.join(os.homedir(), "anaconda3", "bin", "python3"),
      "/usr/bin/python3",
    );
  }
  return candidates.find((candidate) => {
    try {
      if (path.isAbsolute(candidate)) fs.accessSync(candidate, fs.constants.X_OK);
      else if (!execFileQuiet(candidate, ["--version"])) return false;
      return true;
    } catch (_) {
      return false;
    }
  }) || "";
}

function bundledPythonRoot(pythonPath = "") {
  if (!pythonPath || !path.isAbsolute(pythonPath)) return "";
  const normalized = path.normalize(pythonPath);
  if (process.platform === "win32") {
    const root = path.dirname(normalized);
    return fs.existsSync(path.join(root, "python312.dll")) ? root : "";
  }
  const root = path.resolve(path.dirname(normalized), "..");
  return fs.existsSync(path.join(root, "Python")) && fs.existsSync(path.join(root, "lib")) ? root : "";
}

function pythonServerEnv() {
  const env = {
    ...process.env,
    GROK_CHAMELEON_PORT: PORT,
    GROK_CHAMELEON_NO_BROWSER: "1",
    GROK_CHAMELEON_RUNTIME_DIR: RUNTIME_DIR,
    GROK_CHAMELEON_PORTABLE_ROOT: PORTABLE_ROOT,
    GROK_CHAMELEON_LIBRARY_POINTER_PATH: LIBRARY_POINTER_PATH,
    GROK_CHAMELEON_PLATFORM_KEY: PLATFORM_RUNTIME_KEY,
    ...(process.platform === "win32"
      ? { TEMP: TEMP_DIR, TMP: TEMP_DIR }
      : { TMPDIR: TEMP_DIR }),
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  };
  if (fs.existsSync(VENDOR_PYTHON)) {
    env.PYTHONPATH = VENDOR_PYTHON;
  }
  if (fs.existsSync(CERTIFI_CA)) {
    env.SSL_CERT_FILE = CERTIFI_CA;
    env.REQUESTS_CA_BUNDLE = CERTIFI_CA;
    env.CURL_CA_BUNDLE = CERTIFI_CA;
  }
  return env;
}

async function cleanupExistingServer() {
  if (!(await serverPortOpen())) return;
  await requestShutdown();
  for (let index = 0; index < 30; index += 1) {
    await sleep(120);
    if (!(await serverPortOpen())) return;
  }
  throw new Error(`Local port ${PORT} is already in use.`);
}

async function startServer() {
  await cleanupExistingServer();
  if (await serverAlive()) return;
  const python = findPython();
  if (!python) {
    throw new Error(process.platform === "win32"
      ? "Bundled Python was not found at Resources\\Python\\python.exe."
      : "Python 3 not found.");
  }
  const pythonRoot = bundledPythonRoot(python);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const output = fs.openSync(LOG_FILE, "a");
  let serverStartError = null;
  let serverExit = null;
  serverProcess = spawn(python, ["runtime/server.py"], {
    cwd: APP_ROOT,
    env: {
      ...pythonServerEnv(),
      ...(pythonRoot ? { PYTHONHOME: pythonRoot } : {}),
    },
    detached: false,
    windowsHide: process.platform === "win32",
    stdio: ["ignore", output, output],
  });
  serverProcess.on("error", (error) => {
    serverStartError = error;
    appendLog(`server spawn error=${error.message}`);
  });
  serverProcess.on("exit", (code, signal) => {
    serverExit = { code, signal };
    appendLog(`server exit code=${code} signal=${signal}`);
  });
  for (let index = 0; index < 80; index += 1) {
    if (await serverAlive()) return;
    if (serverStartError) throw new Error(`Local server could not start: ${serverStartError.message}`);
    if (serverExit) {
      throw new Error(`Local server exited before startup: code=${serverExit.code} signal=${serverExit.signal}. See ${LOG_FILE}`);
    }
    await sleep(250);
  }
  if (await serverPortOpen()) {
    throw new Error(`Local server did not answer health check on port ${PORT}. See ${LOG_FILE}`);
  }
  throw new Error(`Local server did not start. See ${LOG_FILE}`);
}

function installMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: "#050706",
    webPreferences: {
      preload: path.join(__dirname, "preload-main.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });
  mainWindow.maximize();
  mainWindow.loadURL(`${SERVER_BASE}/?launch=${Date.now()}`);
  mainWindow.on("close", (event) => {
    if (!appTerminating) {
      event.preventDefault();
      void exitAppNow("main-window-close");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function bridgeCommandCanRunInParallel(command) {
  return ["t2i_ws"].includes(String(command?.type || ""));
}

function bridgeAccountKey(command) {
  return `${command.account_id || "imagine"}::${command.store_id || "default"}`;
}

function bridgeKey(command) {
  const baseKey = bridgeAccountKey(command);
  if (String(command?.type || "") === "open_page") return `${baseKey}::open_page`;
  if (!bridgeCommandCanRunInParallel(command)) return baseKey;
  return `${baseKey}::${command.request_id || command.id || Date.now()}`;
}

function bridgeWindowKey(command) {
  const baseKey = bridgeAccountKey(command);
  if (String(command?.type || "") === "open_page") return `${baseKey}::open_page`;
  if (!bridgeCommandCanRunInParallel(command)) return baseKey;
  return `${baseKey}::${command.request_id || command.id || Date.now()}`;
}

function bridgePartition(command) {
  const raw = String(command.store_id || command.account_id || "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `grok-chameleon-imagine-${raw}`;
}

function closeInactiveAccountWindows(command) {
  const activeKey = bridgeAccountKey(command);
  for (const [key, win] of bridgeWindows.entries()) {
    if (win?.__grokAccountKey === activeKey) continue;
    bridgeWindows.delete(key);
    if (!win || win.isDestroyed()) continue;
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch (_) {}
  }
  for (const [key, win] of usageWindows.entries()) {
    if (win?.__grokAccountKey === activeKey) continue;
    usageWindows.delete(key);
    if (!win || win.isDestroyed()) continue;
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch (_) {}
  }
}

function uuidV5Url(name) {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const hash = crypto.createHash("sha1").update(namespace).update(String(name)).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nativeBridgeStoreId(account = {}) {
  const key = String(account.account_id || account.id || account.email || "imagine");
  return uuidV5Url(`grok-chameleon-imagine:${key}`);
}

function bridgeCookieSameSite(value) {
  const text = String(value || "").toLowerCase().replace(/[_\s-]+/g, "");
  if (text === "none" || text === "no_restriction" || text === "norestriction") return "no_restriction";
  if (text === "lax") return "lax";
  if (text === "strict") return "strict";
  return "unspecified";
}

function bridgeCookieUrl(cookie) {
  const rawDomain = String(cookie?.domain || "grok.com").trim() || "grok.com";
  const host = rawDomain.replace(/^\./, "") || "grok.com";
  const rawPath = String(cookie?.path || "/").trim() || "/";
  const pathPart = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `https://${host}${pathPart}`;
}

async function clearGrokCookies(ses) {
  const current = await ses.cookies.get({});
  await Promise.all(current
    .filter((cookie) => String(cookie.domain || "").replace(/^\./, "").endsWith("grok.com"))
    .map((cookie) => ses.cookies.remove(bridgeCookieUrl(cookie), cookie.name).catch(() => {})));
}

async function applyBridgeCookies(win, command, options = {}) {
  const cookies = Array.isArray(command?.cookies) ? command.cookies : [];
  if (!cookies.length) return;
  const ses = win.webContents.session;
  const clearExisting = options.clearExisting !== false;
  if (clearExisting) await clearGrokCookies(ses);
  let applied = 0;
  for (const cookie of cookies) {
    const name = String(cookie?.name || "").trim();
    const value = String(cookie?.value || "");
    if (!name) continue;
    const domain = String(cookie?.domain || ".grok.com").trim() || ".grok.com";
    const pathValue = String(cookie?.path || "/").trim() || "/";
    const expirationDate = Number(cookie?.expirationDate || cookie?.expires || 0);
    const normalized = {
      url: bridgeCookieUrl({ domain, path: pathValue }),
      name,
      value,
      domain,
      path: pathValue.startsWith("/") ? pathValue : `/${pathValue}`,
      secure: cookie?.secure !== false,
      httpOnly: Boolean(cookie?.httpOnly),
      sameSite: bridgeCookieSameSite(cookie?.sameSite),
    };
    if (Number.isFinite(expirationDate) && expirationDate > 0) {
      normalized.expirationDate = expirationDate;
    }
    try {
      await ses.cookies.set(normalized);
      applied += 1;
    } catch (error) {
      appendLog(`bridge cookie set failed account=${command?.account_id || ""} name=${name} error=${error.message}`);
    }
  }
  appendLog(`bridge cookies applied account=${command?.account_id || ""} mode=${clearExisting ? "reset" : "merge"} count=${applied}`);
}

function bridgeWindow(command) {
  const key = bridgeWindowKey(command);
  const existing = bridgeWindows.get(key);
  if (existing && !existing.isDestroyed()) return existing;
  const bounds = centeredWindowBounds();
  const partition = bridgePartition(command);
  installMediaPermissionGuard(session.fromPartition(partition));
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    title: `${APP_NAME} Imagine Login`,
    backgroundColor: "#090b0c",
    webPreferences: {
      partition,
      preload: path.join(__dirname, "preload-bridge.js"),
      contextIsolation: false,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.__grokAccountKey = bridgeAccountKey(command);
  win.on("closed", () => bridgeWindows.delete(key));
  bridgeWindows.set(key, win);
  return win;
}

function existingBridgeWindow(command) {
  const key = bridgeWindowKey(command);
  const existing = bridgeWindows.get(key);
  return existing && !existing.isDestroyed() ? existing : null;
}

function usageWindowKey(command) {
  return `${command.account_id || "imagine"}::${command.store_id || "default"}::usage`;
}

function usageWindow(command) {
  closeInactiveAccountWindows(command);
  const key = usageWindowKey(command);
  const existing = usageWindows.get(key);
  if (existing && !existing.isDestroyed()) return existing;
  const bounds = centeredWindowBounds(560, 760);
  const partition = bridgePartition(command);
  installMediaPermissionGuard(session.fromPartition(partition));
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    paintWhenInitiallyHidden: true,
    title: `${APP_NAME} Usage`,
    backgroundColor: "#090b0c",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });
  win.__grokAccountKey = bridgeAccountKey(command);
  win.on("closed", () => {
    usageWindows.delete(key);
    if (!mainWindow || mainWindow.isDestroyed() || appTerminating) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    app.focus({ steal: true });
    mainWindow.moveTop();
    mainWindow.focus();
    appendLog("usage window closed; main window restored");
  });
  usageWindows.set(key, win);
  return win;
}

function usagePageReady(win, targetUrl) {
  if (!win || win.isDestroyed()) return false;
  const current = win.webContents.getURL() || "";
  return grokUrlMatches(current, targetUrl) && !win.webContents.isLoadingMainFrame();
}

async function warmUsagePage(command) {
  const targetUrl = command.url || GROK_USAGE_URL;
  return { ok: true, status: "deferred", url: targetUrl };
}

async function showUsagePage(command) {
  const targetUrl = command.url || GROK_USAGE_URL;
  const win = usageWindow(command);
  await applyBridgeCookies(win, command, { clearExisting: false });
  showUsageWindow(win, `${APP_NAME} Usage`);
  if (usagePageReady(win, targetUrl)) {
    return { ok: true, status: "shown", url: win.webContents.getURL() || targetUrl };
  }
  if (!grokUrlMatches(win.webContents.getURL() || "", targetUrl)) {
    win.loadURL(targetUrl).catch((error) => {
      appendLog(`usage show load warning account=${command?.account_id || ""} error=${error.message || String(error)}`);
    });
  }
  return { ok: true, status: "loading", url: win.webContents.getURL() || targetUrl };
}

async function visitImaginePostPage(command) {
  const targetUrl = String(command?.url || "");
  if (!/^https:\/\/grok\.com\/imagine\/post\/[0-9a-f-]+(?:[/?#]|$)/i.test(targetUrl)) {
    throw new Error("Imagine post page URL is invalid.");
  }
  const partition = bridgePartition(command);
  installMediaPermissionGuard(session.fromPartition(partition));
  const userAgent = String(command?.user_agent || "").trim();
  const win = new BrowserWindow({
    width: 720,
    height: 720,
    show: false,
    paintWhenInitiallyHidden: true,
    title: `${APP_NAME} Imagine Post`,
    backgroundColor: "#090b0c",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });
  try {
    if (userAgent) win.webContents.setUserAgent(userAgent);
    await applyBridgeCookies(win, command, { clearExisting: false });
    await waitForLoad(win, targetUrl, { forceTarget: true, timeoutMs: 20000 });
    await sleep(2500);
    let registration = { registered: false, verification_error: "" };
    try {
      const postId = JSON.stringify(String(command?.post_id || ""));
      registration = await win.webContents.executeJavaScript(`
        (async () => {
          const postId = ${postId};
          const response = await fetch(
            "/rest/assets?pageSize=40&orderBy=ORDER_BY_CREATE_TIME&workspaceKind=WORKSPACE_KIND_IMAGINE_ALL",
            { method: "GET", credentials: "include", headers: { accept: "application/json, text/plain, */*" } }
          );
          if (!response.ok) {
            return { registered: false, verification_error: "Saved verification HTTP " + response.status };
          }
          const data = await response.json();
          const assets = Array.isArray(data?.assets) ? data.assets : [];
          return {
            registered: assets.some((asset) => String(asset?.assetId || asset?.id || "") === postId),
            verification_error: "",
          };
        })()
      `, true);
    } catch (error) {
      registration = {
        registered: false,
        verification_error: error?.message || String(error),
      };
    }
    return {
      ok: true,
      status: "visited",
      url: win.webContents.getURL() || targetUrl,
      registered: Boolean(registration?.registered),
      verification_error: String(registration?.verification_error || ""),
    };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function normalizeGrokUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_) {
    return "";
  }
}

function grokUrlMatches(current, target) {
  const currentUrl = normalizeGrokUrl(current);
  const targetUrl = normalizeGrokUrl(target);
  if (!currentUrl || !targetUrl) return false;
  return currentUrl === targetUrl || currentUrl.startsWith(`${targetUrl}?`);
}

async function waitForLoad(win, url, options = {}) {
  const targetUrl = url || "https://grok.com/imagine";
  const forceTarget = Boolean(options.forceTarget);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 12000));
  const usable = () => {
    const current = win.webContents.getURL() || "";
    return current.includes("grok.com")
      && !win.webContents.isLoadingMainFrame()
      && (!forceTarget || grokUrlMatches(current, targetUrl));
  };
  if (usable()) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        win.webContents.off("did-finish-load", done);
        win.webContents.off("did-stop-loading", done);
        win.webContents.off("did-fail-load", done);
      };
      const timer = setTimeout(done, timeoutMs);
      win.webContents.once("did-finish-load", done);
      win.webContents.once("did-stop-loading", done);
      win.webContents.once("did-fail-load", done);
      const current = win.webContents.getURL() || "";
      const alreadyAtTarget = current.includes("grok.com")
        && (!forceTarget || grokUrlMatches(current, targetUrl));
      if (alreadyAtTarget) {
        if (!win.webContents.isLoadingMainFrame()) done();
      } else {
        win.loadURL(targetUrl).catch(done);
      }
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (usable()) return;
      await sleep(150);
    }
  }
  throw new Error(`Grok page did not reach target url=${targetUrl} current=${win.webContents.getURL() || ""}`);
}

async function loginProbe(win) {
  const script = `
    (async () => {
      try {
        const response = await fetch('/rest/media/post/list', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/plain, */*'
          },
          body: JSON.stringify({ limit: 1, source: 'MEDIA_POST_SOURCE_LIKED', safeForWork: false })
        });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text: text.slice(0, 300) };
      } catch (error) {
        return { ok: false, status: 0, text: String(error && error.message || error || '') };
      }
    })()
  `;
  try {
    return await win.webContents.executeJavaScript(script, true);
  } catch (error) {
    return { ok: false, status: 0, text: error.message || String(error) };
  }
}

function commandMediaIds(command) {
  const payload = command?.request_payload || {};
  const input = payload.mediaGenInput && typeof payload.mediaGenInput === "object" ? payload.mediaGenInput : {};
  const modelMap = payload.responseMetadata?.modelConfigOverride?.modelMap || {};
  const videoConfig = modelMap.videoGenModelConfig || {};
  const imageConfig = modelMap.imageEditModelConfig || {};
  const ids = [];
  const add = (value) => {
    const text = String(value || "").trim();
    if (text && !ids.includes(text)) ids.push(text);
  };
  for (const key of ["imageToImage", "imageToVideo", "referenceToVideo", "textToVideo", "videoExtension"]) {
    const params = input[key];
    if (!params || typeof params !== "object") continue;
    if (Array.isArray(params.inputAssets)) {
      for (const id of params.inputAssets) add(id);
    }
  }
  for (const value of [
    command?.source_post_id,
    command?.source_container_id,
    payload.grokChameleonConversationId,
    payload.grokChameleonParentResponseId,
    videoConfig.parentPostId,
    videoConfig.rootPostId,
    videoConfig.originalPostId,
    videoConfig.extendPostId,
    imageConfig.parentPostId,
    imageConfig.rootPostId,
    imageConfig.originalPostId,
  ]) {
    add(value);
  }
  return ids;
}

function commandSourceContextId(command) {
  const payload = command?.request_payload || {};
  const modelMap = payload.responseMetadata?.modelConfigOverride?.modelMap || {};
  const videoConfig = modelMap.videoGenModelConfig || {};
  const imageConfig = modelMap.imageEditModelConfig || {};
  for (const value of [
    ...commandMediaIds(command),
    imageConfig.parentPostId,
    videoConfig.extendPostId,
    videoConfig.parentPostId,
    command?.source_post_id,
  ]) {
    const id = String(value || "").trim();
    if (id) return id;
  }
  return "";
}

function commandRootContextId(command) {
  const payload = command?.request_payload || {};
  const modelMap = payload.responseMetadata?.modelConfigOverride?.modelMap || {};
  const videoConfig = modelMap.videoGenModelConfig || {};
  const imageConfig = modelMap.imageEditModelConfig || {};
  for (const value of [
    payload.grokChameleonConversationId,
    imageConfig.containerPostId,
    imageConfig.rootPostId,
    videoConfig.rootPostId,
    videoConfig.originalPostId,
    command?.source_container_id,
  ]) {
    const id = String(value || "").trim();
    if (id) return id;
  }
  return "";
}


async function bridgeMediaContext(win, ids = []) {
  const script = `
    (() => {
      const bridge = window.__grokChameleonImagineBridge;
      if (!bridge || typeof bridge.status !== 'function') {
        return { ok: false, error: 'bridge missing', hasMediaStore: false, matchedBy: '', ids: ${JSON.stringify(ids)} };
      }
      if (typeof bridge.mediaContext === 'function') {
        return bridge.mediaContext(${JSON.stringify(ids)});
      }
      const status = bridge.status();
      return { ok: true, hasMediaStore: Boolean(status && status.hasMediaStore), matchedBy: '', ids: ${JSON.stringify(ids)}, status };
    })()
  `;
  try {
    return await win.webContents.executeJavaScript(script, true);
  } catch (error) {
    return { ok: false, error: error.message || String(error), hasMediaStore: false, matchedBy: "", ids };
  }
}

async function waitForBridgeStoreReady(win, command, options = {}) {
  const ids = commandMediaIds(command);
  const needIdMatch = (Boolean(options.requireIdMatch) || command.type === "crop_image") && ids.length > 0;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || (needIdMatch ? 12000 : 8000)));
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await bridgeMediaContext(win, ids);
    if (last?.hasMediaStore && (!needIdMatch || last.matchedBy)) return last;
    await sleep(250);
  }
  return last;
}

async function ensureBridgeReady(command) {
  const win = bridgeWindow(command);
  const storePageCommand = ["prepare", "fetch_stream"].includes(command.type);
  // Generation commands reuse the account-scoped media store prepared at app startup.
  // Source post/conversation context is carried in the command payload and hydrated by
  // the preload bridge; navigating to the request referer would discard the warm store.
  const targetUrl = ["t2i_ws", "prepare", "fetch_stream"].includes(command.type)
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

async function openBridgePage(command) {
  return showUsagePage(command);
}

function usageCommandFromPayload(payload = {}) {
  const account = payload && typeof payload === "object" ? payload : {};
  const accountId = String(account.account_id || account.id || "");
  const accountEmail = String(account.account_email || account.email || "");
  return {
    type: "open_page",
    account_id: accountId,
    account_email: accountEmail,
    store_id: String(account.store_id || nativeBridgeStoreId({ account_id: accountId, email: accountEmail })),
    url: GROK_USAGE_URL,
    cookies: Array.isArray(account.cookies) ? account.cookies : [],
  };
}

ipcMain.handle("grok-chameleon:warm-imagine-usage", async (_event, payload = {}) => warmUsagePage(usageCommandFromPayload(payload)));

ipcMain.handle("grok-chameleon:open-imagine-usage", async (_event, payload = {}) => {
  return showUsagePage(usageCommandFromPayload(payload));
});

ipcMain.handle("grok-chameleon:card-preview", async (_event, payload = {}) => ensureCardPreview(payload));

async function runFetchStream(win, command) {
  const requestId = String(command.request_id || "");
  const requestPayload = command.request_payload || {};
  const maxWaitMs = Math.max(1, Number(command.max_wait_seconds || 90)) * 1000;
  const script = `
    (async () => {
      const requestId = ${JSON.stringify(requestId)};
      const requestPayload = ${JSON.stringify(requestPayload)};
      const maxWaitMs = ${Math.floor(maxWaitMs)};
      const bridge = window.__grokChameleonImagineBridge;
      if (!bridge || typeof bridge.runStoreGeneration !== 'function') {
        throw new Error('Official Imagine store bridge hook is missing url=' + location.href);
      }
      return await bridge.runStoreGeneration({ requestId, requestPayload, maxWaitMs });
    })()
  `;
  return win.webContents.executeJavaScript(script, true);
}

async function runCropImage(win, command) {
  const requestId = String(command.request_id || "");
  const imageData = String(command.image_data || "");
  const fileName = String(command.file_name || "cropped.png");
  const mimeType = String(command.mime_type || "image/png");
  const originalPostId = String(command.source_post_id || command.original_post_id || "");
  const sourceContainerId = String(command.source_container_id || originalPostId);
  const script = `
    (async () => {
      const bridge = window.__grokChameleonImagineBridge;
      if (!bridge || typeof bridge.runCropImage !== 'function') {
        throw new Error('Official Imagine crop bridge hook is missing url=' + location.href);
      }
      return await bridge.runCropImage({
        requestId: ${JSON.stringify(requestId)},
        imageData: ${JSON.stringify(imageData)},
        fileName: ${JSON.stringify(fileName)},
        mimeType: ${JSON.stringify(mimeType)},
        originalPostId: ${JSON.stringify(originalPostId)},
        sourceContainerId: ${JSON.stringify(sourceContainerId)}
      });
    })()
  `;
  return win.webContents.executeJavaScript(script, true);
}

async function runT2IWebSocket(win, command) {
  const requestId = String(command.request_id || "");
  const wsUrl = String(command.ws_url || "wss://grok.com/ws/imagine/listen");
  const resetPayload = command.reset_payload || {};
  const createPayload = command.create_payload || {};
  const maxWaitMs = Math.max(0, Number(command.max_wait_seconds || 0)) * 1000;
  const expectedCount = Math.max(1, Number(command.expected_count || 1));
  const script = `
    (async () => {
      const wsUrl = ${JSON.stringify(wsUrl)};
      const requestId = ${JSON.stringify(requestId)};
      const resetPayload = ${JSON.stringify(resetPayload)};
      const createPayload = ${JSON.stringify(createPayload)};
      const maxWaitMs = ${Math.floor(maxWaitMs)};
      const expectedCount = ${Math.floor(expectedCount)};
      const bridge = window.__grokChameleonImagineBridge;
      if (!bridge || typeof bridge.runT2I !== 'function') {
        throw new Error('Imagine websocket bridge hook is missing url=' + location.href);
      }
      return await bridge.runT2I({
        wsUrl,
        requestId,
        resetPayload,
        createPayload,
        maxWaitMs,
        expectedCount
      });
    })()
  `;
  return win.webContents.executeJavaScript(script, true);
}

async function sendBridgeResult(id, ok, value = {}, error = "") {
  await fetchJson(`${SERVER_BASE}/api/native-bridge/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ok, value, error }),
    signal: AbortSignal.timeout(10000),
  }).catch((err) => appendLog(`bridge result send failed ${id}: ${err.message}`));
}

async function handleBridgeCommand(command) {
  const id = String(command?.id || "");
  if (!id) return;
  let win = null;
  try {
    if (command.type === "release_all") {
      closeAccountWindowsNow();
      await sendBridgeResult(id, true, { ok: true, status: "released" });
      return;
    }
    if (command.type === "open_page") {
      const value = await openBridgePage(command);
      await sendBridgeResult(id, true, value);
      return;
    }
    if (command.type === "visit_post") {
      const value = await visitImaginePostPage(command);
      await sendBridgeResult(id, true, value);
      return;
    }
    if (command.type === "prepare") closeInactiveAccountWindows(command);
    win = await ensureBridgeReady(command);
    if (command.type === "prepare") {
      await sendBridgeResult(id, true, { ok: true, status: "ready" });
    } else if (command.type === "fetch_stream") {
      const value = await runFetchStream(win, command);
      await sendBridgeResult(id, true, value || {});
    } else if (command.type === "crop_image") {
      const value = await runCropImage(win, command);
      await sendBridgeResult(id, true, value || {});
    } else if (command.type === "t2i_ws") {
      const value = await runT2IWebSocket(win, command);
      await sendBridgeResult(id, true, value || {});
    } else {
      await sendBridgeResult(id, false, {}, `Unknown native bridge command: ${command.type}`);
    }
  } catch (error) {
    await sendBridgeResult(id, false, {}, error.message || String(error));
  } finally {
    if (bridgeCommandCanRunInParallel(command) && win && !win.isDestroyed()) {
      win.close();
    }
  }
}

function enqueueBridgeCommand(command) {
  const key = bridgeKey(command);
  const previous = bridgeCommandQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => handleBridgeCommand(command))
    .finally(() => {
      if (bridgeCommandQueues.get(key) === next) bridgeCommandQueues.delete(key);
    });
  bridgeCommandQueues.set(key, next);
}

async function pollBridge() {
  if (bridgePolling) return;
  bridgePolling = true;
  while (!app.isQuitting) {
    try {
      const data = await fetchJson(`${SERVER_BASE}/api/native-bridge/next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: 25 }),
        signal: AbortSignal.timeout(35000),
      });
      if (data?.command) {
        appendLog(`bridge command received id=${data.command.id || ""} type=${data.command.type || ""}`);
        enqueueBridgeCommand(data.command);
      }
    } catch (error) {
      appendLog(`bridge poll error: ${error.message}`);
      await sleep(1000);
    }
  }
}

async function boot() {
  try {
    installMediaPermissionGuards();
    installMenu();
    await startServer();
    await clearCurrentCardPreviewCache("startup");
    createMainWindow();
    pollBridge();
  } catch (error) {
    appendLog(`boot failed: ${error.stack || error.message}`);
    dialog.showErrorBox(APP_NAME, error.message || String(error));
    app.quit();
  }
}

app.name = APP_NAME;
if (process.platform === "win32") nativeTheme.themeSource = "dark";
app.whenReady().then(boot);

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
});

app.on("before-quit", (event) => {
  if (!appTerminating) {
    event.preventDefault();
    void exitAppNow("before-quit");
  }
});

app.on("window-all-closed", () => {
  void exitAppNow("window-all-closed");
});

app.on("will-quit", () => {
  clearVerifiedCardPreviewCache(lastVerifiedCardPreviewCacheDir, "will-quit");
  if (!appTerminating) shutdownServerNow();
});
