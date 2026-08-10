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
const IMAGINE_BRIDGE_PAGE_TIMEOUT_MS = 10000;
const IMAGINE_BRIDGE_STORE_TIMEOUT_MS = 20000;
// A browser does not evict tabs on a count; it keeps them loaded and reclaims memory
// when the machine actually needs it back. Retaining two accounts meant anyone rotating
// through more than two reused a window 0% of the time: measured over 20 switches across
// 10 accounts, every one took the full grok.com boot (median 5.5s, two outright
// failures), while a live window answers in ~1ms. Keep every account the budget allows.
const IMAGINE_BRIDGE_MEMORY_BUDGET_RATIO = 0.6;
const IMAGINE_BRIDGE_MIN_BUDGET_BYTES = 1024 * 1024 * 1024;
const IMAGINE_BRIDGE_MIN_FREE_BYTES = 1536 * 1024 * 1024;
// Only used when app.getAppMetrics() has no reading yet for a window's process.
const IMAGINE_BRIDGE_ASSUMED_WINDOW_BYTES = 480 * 1024 * 1024;
const IMAGINE_BRIDGE_MAX_ACCOUNT_WINDOWS = 40;
const IMAGINE_BRIDGE_NETWORK_BUFFER_BYTES = 50 * 1024 * 1024;
const IMAGINE_BRIDGE_NETWORK_RESOURCE_BUFFER_BYTES = 10 * 1024 * 1024;
const IMAGINE_BRIDGE_SCRIPT_TIMEOUT_MS = 3000;
const IMAGINE_BRIDGE_PREPARE_TIMEOUT_MS = 30000;

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

function macBundleLastUsedTime(bundlePath) {
  try {
    const value = execFileSync(
      "/usr/bin/mdls",
      ["-raw", "-name", "kMDItemLastUsedDate", bundlePath],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (!value || value === "(null)") return 0;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch (_) {
    return 0;
  }
}

function resolveTranslocatedMacBundle(currentBundlePath) {
  const fingerprint = portableBundleFingerprint(currentBundlePath);
  if (!fingerprint) throw new Error("Portable app identity could not be read.");
  let matches = macOriginalBundleCandidates(fingerprint)
    .filter((candidate) => !candidate.includes(`${path.sep}AppTranslocation${path.sep}`))
    .filter((candidate) => portableBundleFingerprint(candidate) === fingerprint);
  if (matches.length > 1) {
    const lastUsedMatches = matches.map((candidate) => ({
      candidate,
      lastUsed: macBundleLastUsedTime(candidate),
    }));
    const newestLastUsed = Math.max(...lastUsedMatches.map((entry) => entry.lastUsed));
    if (newestLastUsed > 0) {
      const newestMatches = lastUsedMatches
        .filter((entry) => entry.lastUsed === newestLastUsed)
        .map((entry) => entry.candidate);
      if (newestMatches.length) matches = newestMatches;
    }
  }
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
const CARD_PREVIEW_MAX_ACTIVE = 4;
const CARD_PREVIEW_MAX_FILES = 5000;
const CARD_PREVIEW_MAX_BYTES = 512 * 1024 * 1024;
const cardPreviewQueue = [];
const cardPreviewTasks = new Map();
const cardPreviewPruneTimes = new Map();
const cardPreviewPruneTasks = new Map();
const cardPreviewTouchTimes = new Map();
let activeCardPreviewTasks = 0;

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

async function waitForCardPreviewTasks(timeoutMs = 2000) {
  const tasks = Array.from(cardPreviewTasks.values());
  if (!tasks.length) return true;
  const completed = await Promise.race([
    Promise.allSettled(tasks).then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
  if (!completed) appendLog(`card preview shutdown wait timed out after ${timeoutMs}ms`);
  return completed;
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

function scheduleCardPreviewCachePrune(cacheDir, protectedPath = "") {
  const now = Date.now();
  const lastPruneAt = Number(cardPreviewPruneTimes.get(cacheDir) || 0);
  if (now - lastPruneAt < 5 * 60 * 1000) return cardPreviewPruneTasks.get(cacheDir) || null;
  if (cardPreviewPruneTasks.has(cacheDir)) return cardPreviewPruneTasks.get(cacheDir);
  cardPreviewPruneTimes.set(cacheDir, now);
  const task = (async () => {
    let names = [];
    try {
      names = (await fs.promises.readdir(cacheDir))
        .filter((name) => /^[a-f0-9]{64}\.jpg$/.test(name));
    } catch (_) {
      return;
    }
    const entries = [];
    for (let offset = 0; offset < names.length; offset += 32) {
      const batch = await Promise.all(names.slice(offset, offset + 32).map(async (name) => {
        const filePath = path.join(cacheDir, name);
        try {
          const stat = await fs.promises.stat(filePath);
          return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch (_) {
          return null;
        }
      }));
      entries.push(...batch.filter(Boolean));
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
        await fs.promises.unlink(entry.filePath);
        cardPreviewTouchTimes.delete(entry.filePath);
        totalBytes -= entry.size;
      } catch (_) {}
    }
  })().finally(() => {
    cardPreviewPruneTasks.delete(cacheDir);
  });
  cardPreviewPruneTasks.set(cacheDir, task);
  return task;
}

function scheduleCardPreviewCacheTouch(filePath) {
  const now = Date.now();
  const lastTouchAt = Number(cardPreviewTouchTimes.get(filePath) || 0);
  if (now - lastTouchAt < 60 * 60 * 1000) return;
  cardPreviewTouchTimes.set(filePath, now);
  const value = new Date(now);
  fs.promises.utimes(filePath, value, value).catch(() => {
    cardPreviewTouchTimes.delete(filePath);
  });
}

async function pruneCardPreviewCacheAtStartup() {
  try {
    const info = await fetchJson(`${SERVER_BASE}/api/card-preview/cache-info`, {
      signal: AbortSignal.timeout(3000),
    });
    const cacheDir = verifiedLibraryCardPreviewCacheDir(info);
    fs.mkdirSync(cacheDir, { recursive: true });
    scheduleCardPreviewCachePrune(cacheDir);
  } catch (error) {
    appendLog(`card preview startup prune skipped: ${error.message || String(error)}`);
  }
}

function localCardPreviewSource(rawUrl) {
  const source = String(rawUrl || "").trim();
  if (!source || source.length > 4096) throw new Error("Invalid card preview URL.");
  const parsed = new URL(source, SERVER_BASE);
  const localOrigin = new URL(SERVER_BASE).origin;
  if (
    parsed.origin !== localOrigin
    || !["/api/media", "/api/imagine/remote/media"].includes(parsed.pathname)
  ) {
    throw new Error("Unsupported card preview URL.");
  }
  if (parsed.pathname === "/api/imagine/remote/media") {
    const remoteUrl = String(parsed.searchParams.get("url") || "").trim();
    const remote = new URL(remoteUrl);
    if (!["http:", "https:"].includes(remote.protocol)) {
      throw new Error("Unsupported remote card preview URL.");
    }
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

function writeCardPreviewImage(sourceImage, targetPath, kind = "card") {
  const normalizedKind = normalizedPreviewKind(kind);
  const maxPreviewEdge = normalizedKind === "thumbnail" ? THUMBNAIL_PREVIEW_MAX_EDGE : CARD_PREVIEW_MAX_EDGE;
  const jpegQuality = normalizedKind === "thumbnail" ? 78 : 82;
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

async function generateCardPreview(sourcePath, targetPath, kind = "card") {
  const normalizedKind = normalizedPreviewKind(kind);
  const maxPreviewEdge = normalizedKind === "thumbnail" ? THUMBNAIL_PREVIEW_MAX_EDGE : CARD_PREVIEW_MAX_EDGE;
  const isVideo = /\.(?:m4v|mov|mp4|webm)$/i.test(sourcePath);
  const sourceImage = isVideo
    ? await nativeImage.createThumbnailFromPath(sourcePath, { width: maxPreviewEdge, height: maxPreviewEdge })
    : nativeImage.createFromBuffer(fs.readFileSync(sourcePath));
  writeCardPreviewImage(sourceImage, targetPath, normalizedKind);
}

async function generateRemoteCardPreview(sourceUrl, targetPath, kind = "card") {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Remote card preview HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  const maxSourceBytes = 64 * 1024 * 1024;
  if (declaredSize > maxSourceBytes) throw new Error("Remote card preview source is too large.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxSourceBytes) {
    throw new Error("Remote card preview source is empty or too large.");
  }
  writeCardPreviewImage(nativeImage.createFromBuffer(bytes), targetPath, kind);
}

async function ensureCardPreview(payload = {}) {
  const source = localCardPreviewSource(payload.url);
  const previewKind = normalizedPreviewKind(payload.kind);
  const remoteSource = source.pathname === "/api/imagine/remote/media";
  let info;
  let sourcePath = "";
  let storage = "cache";
  let previewKey = "";
  if (remoteSource) {
    info = await fetchJson(`${SERVER_BASE}/api/card-preview/cache-info`, {
      signal: AbortSignal.timeout(3000),
    });
    const cacheIdentity = String(payload.cache_identity || "").trim().normalize("NFC");
    const keySource = cacheIdentity && cacheIdentity.length <= 512
      ? `remote\0${previewKind}\0identity\0${cacheIdentity}`
      : `remote\0${previewKind}\0${source.pathname}${source.search}`;
    previewKey = crypto.createHash("sha256")
      .update(keySource)
      .digest("hex");
  } else {
    const infoUrl = new URL("/api/card-preview/source-info", SERVER_BASE);
    infoUrl.search = source.search;
    infoUrl.searchParams.set("preview_kind", previewKind);
    info = await fetchJson(infoUrl, { signal: AbortSignal.timeout(3000) });
    sourcePath = String(info?.source_path || "").trim();
    storage = info?.storage === "build" ? "build" : "cache";
    previewKey = String(info?.preview_key || "").trim().toLowerCase();
  }
  if (!/^[a-f0-9]{64}$/.test(previewKey)) {
    throw new Error("Card preview key is invalid.");
  }
  const previewDir = storage === "build"
    ? verifiedLibraryBuildPreviewDir(info, previewKind)
    : verifiedLibraryCardPreviewCacheDir(info);
  if (!remoteSource && !path.isAbsolute(sourcePath)) {
    throw new Error("Card preview source path is invalid.");
  }
  const targetPath = path.join(previewDir, `${previewKey}.jpg`);
  const taskKey = `${previewDir}\0${previewKey}`;
  if (usablePreviewFile(targetPath)) {
    if (storage === "cache") {
      scheduleCardPreviewCacheTouch(targetPath);
      scheduleCardPreviewCachePrune(previewDir, targetPath);
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
        scheduleCardPreviewCacheTouch(targetPath);
        scheduleCardPreviewCachePrune(previewDir, targetPath);
      }
      return cardPreviewResult(previewKey, storage, previewKind);
    }
    try {
      fs.unlinkSync(targetPath);
    } catch (_) {}
    if (remoteSource) await generateRemoteCardPreview(source.href, targetPath, previewKind);
    else await generateCardPreview(sourcePath, targetPath, previewKind);
    if (storage === "cache") scheduleCardPreviewCachePrune(previewDir, targetPath);
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

const EDIT_CONTEXT_ICON_CACHE = new Map();

function editContextIcon(name) {
  const color = process.platform === "darwin"
    ? 0
    : (nativeTheme.shouldUseDarkColors ? 238 : 32);
  const cacheKey = `${name}:${color}`;
  if (EDIT_CONTEXT_ICON_CACHE.has(cacheKey)) return EDIT_CONTEXT_ICON_CACHE.get(cacheKey);
  const size = 32;
  const bitmap = Buffer.alloc(size * size * 4);
  const paint = (x, y, alpha = 255) => {
    const pixelX = Math.round(x);
    const pixelY = Math.round(y);
    if (pixelX < 0 || pixelX >= size || pixelY < 0 || pixelY >= size) return;
    const offset = ((pixelY * size) + pixelX) * 4;
    bitmap[offset] = color;
    bitmap[offset + 1] = color;
    bitmap[offset + 2] = color;
    bitmap[offset + 3] = Math.max(bitmap[offset + 3], alpha);
  };
  const dot = (x, y, radius = 1.4) => {
    const edge = radius + 0.75;
    for (let pixelY = Math.floor(y - edge); pixelY <= Math.ceil(y + edge); pixelY += 1) {
      for (let pixelX = Math.floor(x - edge); pixelX <= Math.ceil(x + edge); pixelX += 1) {
        const distance = Math.hypot(pixelX - x, pixelY - y);
        if (distance > edge) continue;
        const alpha = distance <= radius ? 255 : Math.round(255 * (edge - distance) / 0.75);
        paint(pixelX, pixelY, alpha);
      }
    }
  };
  const line = (x1, y1, x2, y2, thickness = 1.5) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let index = 0; index <= steps; index += 1) {
      const ratio = index / steps;
      dot(x1 + ((x2 - x1) * ratio), y1 + ((y2 - y1) * ratio), thickness);
    }
  };
  const arc = (centerX, centerY, radius, startDegrees, endDegrees, thickness = 1.5, mirror = false) => {
    const steps = Math.max(12, Math.ceil(Math.abs(endDegrees - startDegrees) * radius / 24));
    for (let index = 0; index <= steps; index += 1) {
      const degrees = startDegrees + ((endDegrees - startDegrees) * index / steps);
      const radians = degrees * Math.PI / 180;
      const rawX = centerX + (Math.cos(radians) * radius);
      const x = mirror ? (size - 1 - rawX) : rawX;
      dot(x, centerY + (Math.sin(radians) * radius), thickness);
    }
  };
  const rectangle = (left, top, right, bottom, thickness = 1.35) => {
    line(left, top, right, top, thickness);
    line(right, top, right, bottom, thickness);
    line(right, bottom, left, bottom, thickness);
    line(left, bottom, left, top, thickness);
  };

  if (name === "selectAll") {
    line(6, 12, 6, 6);
    line(6, 6, 12, 6);
    line(20, 6, 26, 6);
    line(26, 6, 26, 12);
    line(26, 20, 26, 26);
    line(26, 26, 20, 26);
    line(12, 26, 6, 26);
    line(6, 26, 6, 20);
    rectangle(11, 11, 21, 21, 1.25);
  } else if (name === "undo" || name === "redo") {
    const mirror = name === "redo";
    const mirrorX = (x) => (mirror ? size - 1 - x : x);
    arc(18, 17, 9, 185, 390, 1.55, mirror);
    line(mirrorX(9), 17, mirrorX(14), 11.5, 1.55);
    line(mirrorX(9), 17, mirrorX(14), 22.5, 1.55);
  } else if (name === "paste") {
    rectangle(8, 8, 24, 28, 1.35);
    rectangle(12, 5, 20, 11, 1.35);
    line(12, 16, 20, 16, 1.1);
    line(12, 21, 20, 21, 1.1);
  } else if (name === "copy") {
    rectangle(7, 5, 20, 23, 1.35);
    rectangle(12, 10, 25, 28, 1.35);
  } else if (name === "cut") {
    arc(8, 9, 4, 0, 360, 1.35);
    arc(8, 23, 4, 0, 360, 1.35);
    line(11, 12, 25, 4, 1.35);
    line(11, 20, 25, 28, 1.35);
    dot(14, 16, 1.6);
  } else if (name === "delete") {
    line(7, 9, 25, 9, 1.45);
    line(12, 5, 20, 5, 1.45);
    line(10, 12, 12, 28, 1.35);
    line(22, 12, 20, 28, 1.35);
    line(12, 28, 20, 28, 1.35);
    line(14.5, 14, 15.5, 24, 1.05);
    line(18.5, 14, 17.5, 24, 1.05);
  }

  const icon = nativeImage.createFromBitmap(bitmap, {
    width: size,
    height: size,
    scaleFactor: 2,
  });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  EDIT_CONTEXT_ICON_CACHE.set(cacheKey, icon);
  return icon;
}

function installEditableContextMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const flags = params.editFlags || {};
    const actionItem = (name, label, accelerator, enabled) => ({
      label,
      accelerator,
      registerAccelerator: false,
      icon: editContextIcon(name),
      enabled: Boolean(enabled),
      click: () => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        const action = win.webContents[name];
        if (typeof action === "function") action.call(win.webContents);
      },
    });
    const menu = Menu.buildFromTemplate([
      actionItem("selectAll", "Select All", "CommandOrControl+A", flags.canSelectAll),
      actionItem("undo", "Undo", "CommandOrControl+Z", flags.canUndo),
      actionItem("redo", "Redo", "CommandOrControl+Shift+Z", flags.canRedo),
      { type: "separator" },
      actionItem("copy", "Copy", "CommandOrControl+C", flags.canCopy),
      actionItem("cut", "Cut", "CommandOrControl+X", flags.canCut),
      actionItem("paste", "Paste", "CommandOrControl+V", flags.canPaste),
      { type: "separator" },
      actionItem("delete", "Delete", "Backspace", flags.canDelete),
    ]);
    menu.popup({ window: win });
  });
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
  installEditableContextMenu(mainWindow);
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
  return ["t2i_ws", "fetch_stream"].includes(String(command?.type || ""));
}

function bridgeCommandUsesEphemeralWindow(command) {
  return String(command?.type || "") === "t2i_ws";
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
  if (!bridgeCommandUsesEphemeralWindow(command)) return baseKey;
  return `${baseKey}::${command.request_id || command.id || Date.now()}`;
}

function bridgePartition(command) {
  const raw = String(command.store_id || command.account_id || "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `persist:grok-chameleon-imagine-${raw}`;
}

// A warm-up that is still running when the user picks a different account keeps
// loading grok.com in the background, so both accounts fight over CPU and network and
// both finish late. Abandon the one the user moved away from; it is prepared again on
// demand the next time that account is selected.
function supersedeOtherAccountPreparations(command) {
  const activeKey = bridgeAccountKey(command);
  for (const win of bridgeWindows.values()) {
    if (!win || win.isDestroyed()) continue;
    if (win.__grokAccountKey === activeKey) continue;
    if (!win.__grokPreparePromise) continue;
    win.__grokPrepareGeneration = Number(win.__grokPrepareGeneration || 0) + 1;
    win.__grokPreparedAt = 0;
    try {
      win.webContents.stop();
    } catch (_) {}
    appendLog(`bridge preparation abandoned account=${win.__grokAccountKey || ""} reason=account-switch`);
  }
}

function bridgeWindowIsBusy(win) {
  return Boolean(win?.__grokPreparePromise) || Number(win?.__grokBusyCount || 0) > 0;
}

function markBridgeWindowBusy(win, delta) {
  if (!win || win.isDestroyed()) return;
  win.__grokBusyCount = Math.max(0, Number(win.__grokBusyCount || 0) + delta);
}

// Asleep is what a browser does to a background tab: clamp the timers, stop the frame
// work, drop the buffers nobody is reading — and keep the document and its media store
// resident, so coming back is a repaint instead of a reload.
function sleepBridgeWindow(win) {
  if (!win || win.isDestroyed() || win.__grokAsleep) return;
  win.__grokAsleep = true;
  try {
    win.webContents.setBackgroundThrottling(true);
  } catch (_) {}
  disableBridgeNetworkCapture(win);
  // Do not try to reclaim the renderer's JS heap here. Memory.forciblyPurgeJavaScriptMemory
  // takes the official media store down with it: the window survives, the store does not,
  // and waking then spends the full 20s store wait before failing. Measured on 2026-08-10,
  // 11 accounts collapsed to 1 over 20 switches with every prepare erroring at ~23s.
}

function wakeBridgeWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.__grokAsleep) win.__grokWokeFromSleep = true;
  win.__grokAsleep = false;
  try {
    win.webContents.setBackgroundThrottling(false);
  } catch (_) {}
  enableBridgeNetworkCapture(win);
}

function bridgeWindowProcessId(win) {
  try {
    return Number(win.webContents.getOSProcessId() || 0);
  } catch (_) {
    return 0;
  }
}

function bridgeProcessMemoryBytes() {
  const byPid = new Map();
  let totalBytes = 0;
  let rendererBytes = 0;
  try {
    for (const metric of app.getAppMetrics()) {
      const pid = Number(metric?.pid || 0);
      const kilobytes = Number(metric?.memory?.workingSetSize || 0);
      if (pid <= 0 || kilobytes <= 0) continue;
      const bytes = kilobytes * 1024;
      byPid.set(pid, bytes);
      totalBytes += bytes;
      if (String(metric?.type || "") === "Tab") rendererBytes += bytes;
    }
  } catch (_) {}
  return { byPid, totalBytes, rendererBytes };
}

// A grok.com page is not one process. The main frame renderer is joined by site-isolated
// subframe renderers, and getAppMetrics() cannot map those back to a window: ten accounts
// produced 31 renderers. Charging an account only for the frame we can name understated
// it by about 40%, so measure what the account windows brought in as a whole and divide.
function bridgeAccountWindowShareBytes(metrics, windowCount) {
  if (windowCount <= 0) return 0;
  const excluded = new Set();
  const addPid = (win) => {
    if (!win || win.isDestroyed()) return;
    const pid = bridgeWindowProcessId(win);
    if (pid > 0) excluded.add(pid);
  };
  addPid(mainWindow);
  for (const win of usageWindows.values()) addPid(win);
  let othersBytes = 0;
  for (const pid of excluded) othersBytes += metrics.byPid.get(pid) || 0;
  const accountBytes = Math.max(0, metrics.rendererBytes - othersBytes);
  return Math.max(
    Math.round(IMAGINE_BRIDGE_ASSUMED_WINDOW_BYTES / 2),
    Math.round(accountBytes / windowCount),
  );
}

function bridgeMemoryBudgetBytes() {
  return Math.max(
    IMAGINE_BRIDGE_MIN_BUDGET_BYTES,
    Math.floor(os.totalmem() * IMAGINE_BRIDGE_MEMORY_BUDGET_RATIO),
  );
}

function closeInactiveAccountWindows(command) {
  const activeKey = bridgeAccountKey(command);
  const destroy = (map, key, win) => {
    map.delete(key);
    if (!win || win.isDestroyed()) return;
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch (_) {}
  };
  // The account the user picked wakes up; every other one goes to sleep but stays loaded.
  for (const win of bridgeWindows.values()) {
    if (!win || win.isDestroyed()) continue;
    if (win.__grokAccountKey === activeKey) wakeBridgeWindow(win);
    else sleepBridgeWindow(win);
  }
  const liveEntries = () => [...bridgeWindows.entries()].filter(([, win]) => win && !win.isDestroyed());
  const metrics = bridgeProcessMemoryBytes();
  const budget = bridgeMemoryBudgetBytes();
  const entries = liveEntries();
  const perWindow = bridgeAccountWindowShareBytes(metrics, entries.length);
  // Budget the whole app, not just the account windows: the ceiling the machine cares
  // about is what this process tree costs it, and releasing a window is the only lever
  // available for staying under it.
  let used = metrics.totalBytes || entries.length * IMAGINE_BRIDGE_ASSUMED_WINDOW_BYTES;
  let live = entries.length;
  // Sweeping only what is already there means the window about to be built pushes the
  // total past the ceiling, and booting grok.com on a machine already at the ceiling is
  // what produced the two 30s prepare timeouts measured across 13 accounts. Clear room
  // for the newcomer first when this account has nothing open yet.
  const headroom = entries.some(([, win]) => win.__grokAccountKey === activeKey) ? 0 : perWindow;
  // Least recently used first. The active account is never taken, and neither is one
  // that is mid-generation — a video run can hold its window for three minutes.
  const candidates = entries
    .filter(([, win]) => win.__grokAccountKey !== activeKey && !bridgeWindowIsBusy(win))
    .sort((left, right) => Number(left[1].__grokLastUsedAt || 0) - Number(right[1].__grokLastUsedAt || 0));
  // A single release per pressure signal, the way a browser unloads one tab at a time,
  // so an unrelated memory spike elsewhere on the machine cannot clear the whole set.
  let pressureReleases = os.freemem() < IMAGINE_BRIDGE_MIN_FREE_BYTES ? 1 : 0;
  let evicted = 0;
  for (const [key, win] of candidates) {
    const overBudget = used + headroom > budget;
    const overCount = live > IMAGINE_BRIDGE_MAX_ACCOUNT_WINDOWS;
    if (!overBudget && !overCount) {
      if (pressureReleases <= 0) break;
      pressureReleases -= 1;
    }
    used -= perWindow;
    live -= 1;
    evicted += 1;
    destroy(bridgeWindows, key, win);
  }
  const kept = liveEntries();
  appendLog(
    `bridge windows account=${command?.account_id || ""}`
    + ` kept=${kept.length} asleep=${kept.filter(([, win]) => win.__grokAsleep).length} evicted=${evicted}`
    + ` usedMB=${Math.round(used / (1024 * 1024))} budgetMB=${Math.round(budget / (1024 * 1024))}`
    + ` perWindowMB=${Math.round(perWindow / (1024 * 1024))}`
    + ` freeMB=${Math.round(os.freemem() / (1024 * 1024))}`,
  );
  // Usage windows are cheap to recreate and are not part of the prepared store, so
  // they keep the previous single-account behaviour.
  for (const [key, win] of usageWindows.entries()) {
    if (win?.__grokAccountKey === activeKey) continue;
    destroy(usageWindows, key, win);
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

function bridgeCookieKey(cookie) {
  const name = String(cookie?.name || "").trim();
  const domain = String(cookie?.domain || ".grok.com").trim().replace(/^\./, "").toLowerCase() || "grok.com";
  const rawPath = String(cookie?.path || "/").trim() || "/";
  const cookiePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${name}\n${domain}\n${cookiePath}`;
}

async function bridgeSessionHasCookies(ses, cookies) {
  const desired = cookies.filter((cookie) => String(cookie?.name || "").trim());
  if (!desired.length) return false;
  const current = await ses.cookies.get({});
  const currentValues = new Map(current.map((cookie) => [
    bridgeCookieKey(cookie),
    String(cookie?.value || ""),
  ]));
  return desired.every((cookie) => (
    currentValues.get(bridgeCookieKey(cookie)) === String(cookie?.value || "")
  ));
}

async function applyBridgeCookies(win, command, options = {}) {
  const cookies = Array.isArray(command?.cookies) ? command.cookies : [];
  if (!cookies.length) return false;
  const signature = crypto.createHash("sha256").update(JSON.stringify(cookies.map((cookie) => ({
    name: String(cookie?.name || ""),
    value: String(cookie?.value || ""),
    domain: String(cookie?.domain || ""),
    path: String(cookie?.path || ""),
    expirationDate: Number(cookie?.expirationDate || cookie?.expires || 0),
  })))).digest("hex");
  if (!options.force && win.__grokCookieSignature === signature) return false;
  const ses = win.webContents.session;
  if (!options.force && await bridgeSessionHasCookies(ses, cookies)) {
    win.__grokCookieSignature = signature;
    return false;
  }
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
  win.__grokCookieSignature = signature;
  win.__grokPreparedAt = 0;
  appendLog(`bridge cookies applied account=${command?.account_id || ""} mode=${clearExisting ? "reset" : "merge"} count=${applied}`);
  return true;
}

function installImagineGenerationNetworkCapture(win) {
  if (!win || win.isDestroyed() || win.__grokGenerationNetworkCaptureInstalled) return;
  win.__grokGenerationNetworkCaptureInstalled = true;
  const pending = new Map();
  const debuggerApi = win.webContents.debugger;
  try {
    if (!debuggerApi.isAttached()) debuggerApi.attach("1.3");
  } catch (error) {
    appendLog(`bridge generation response capture attach failed error=${error.message || String(error)}`);
    return;
  }
  debuggerApi.on("message", (_event, method, params = {}) => {
    if (method === "Network.requestWillBeSent") {
      const request = params.request || {};
      let endpoint = "";
      try {
        endpoint = new URL(String(request.url || "")).pathname;
      } catch (_) {}
      if (
        String(request.method || "").toUpperCase() !== "POST"
        || !/^\/rest\/app-chat\/conversations\/(?:new|[^/]+\/responses)$/.test(endpoint)
      ) return;
      let requestBody = null;
      try {
        requestBody = JSON.parse(String(request.postData || ""));
      } catch (_) {}
      if (!/^imagine-(?:video-gen|image-edit)$/.test(String(requestBody?.modelName || ""))) return;
      pending.set(params.requestId, {
        endpoint,
        requestBody,
        status: 0,
      });
      return;
    }
    if (method === "Network.responseReceived") {
      const record = pending.get(params.requestId);
      if (record) record.status = Number(params.response?.status || 0);
      return;
    }
    if (method === "Network.loadingFailed") {
      pending.delete(params.requestId);
      return;
    }
    if (method !== "Network.loadingFinished") return;
    const record = pending.get(params.requestId);
    if (!record) return;
    pending.delete(params.requestId);
    debuggerApi.sendCommand("Network.getResponseBody", { requestId: params.requestId }).then((result) => {
      if (!win || win.isDestroyed()) return;
      const body = result?.base64Encoded
        ? Buffer.from(String(result.body || ""), "base64").toString("utf8")
        : String(result?.body || "");
      const payload = JSON.stringify({
        endpoint: record.endpoint,
        requestBody: record.requestBody,
        status: record.status,
        body,
      });
      return win.webContents.executeJavaScript(`
        (() => {
          const bridge = window.__grokChameleonImagineBridge;
          if (!bridge || typeof bridge.acceptGenerationNetworkResponse !== 'function') {
            return { matched: false, error: 'generation response receiver missing' };
          }
          return bridge.acceptGenerationNetworkResponse(${payload});
        })()
      `, true);
    }).catch((error) => {
      appendLog(`bridge generation response capture failed error=${error.message || String(error)}`);
    });
  });
  debuggerApi.on("detach", (_event, reason) => {
    win.__grokNetworkCaptureEnabled = false;
    appendLog(`bridge generation response capture detached reason=${reason || ""}`);
  });
  win.once("closed", () => {
    pending.clear();
    try {
      if (debuggerApi.isAttached()) debuggerApi.detach();
    } catch (_) {}
  });
}

// The CDP buffer holds every response body the page receives, not only the generation
// calls the filter above keeps, so on an Imagine page it fills with media and becomes the
// largest single cost of an account window nobody is looking at. Arm it for the account
// being used and drop it for the rest; the debugger itself stays attached either way.
function enableBridgeNetworkCapture(win) {
  if (!win || win.isDestroyed() || win.__grokNetworkCaptureEnabled) return;
  const debuggerApi = win.webContents.debugger;
  if (!debuggerApi.isAttached()) return;
  win.__grokNetworkCaptureEnabled = true;
  debuggerApi.sendCommand("Network.enable", {
    maxTotalBufferSize: IMAGINE_BRIDGE_NETWORK_BUFFER_BYTES,
    maxResourceBufferSize: IMAGINE_BRIDGE_NETWORK_RESOURCE_BUFFER_BYTES,
  }).catch((error) => {
    win.__grokNetworkCaptureEnabled = false;
    appendLog(`bridge generation response capture enable failed error=${error.message || String(error)}`);
  });
}

function disableBridgeNetworkCapture(win) {
  if (!win || win.isDestroyed() || !win.__grokNetworkCaptureEnabled) return;
  const debuggerApi = win.webContents.debugger;
  win.__grokNetworkCaptureEnabled = false;
  if (!debuggerApi.isAttached()) return;
  debuggerApi.sendCommand("Network.disable").catch((error) => {
    appendLog(`bridge generation response capture disable failed error=${error.message || String(error)}`);
  });
}

function bridgeWindow(command) {
  const key = bridgeWindowKey(command);
  const existing = bridgeWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.__grokLastUsedAt = Date.now();
    // Asking for the window is the signal that this account is in use again. Let
    // wakeBridgeWindow own the from-sleep flag; the budget sweep usually wakes the
    // active account before this runs, and assigning here would erase what it recorded.
    wakeBridgeWindow(existing);
    return existing;
  }
  const bounds = centeredWindowBounds();
  const partition = bridgePartition(command);
  installMediaPermissionGuard(session.fromPartition(partition));
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    paintWhenInitiallyHidden: true,
    title: `${APP_NAME} Imagine Login`,
    backgroundColor: "#090b0c",
    webPreferences: {
      partition,
      preload: path.join(__dirname, "preload-bridge.js"),
      contextIsolation: false,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });
  win.__grokAccountKey = bridgeAccountKey(command);
  win.__grokCookieSignature = "";
  win.__grokPreparedAt = 0;
  win.__grokPreparePromise = null;
  win.__grokPrepareGeneration = 0;
  win.__grokDomReadyUrl = "";
  win.__grokLastUsedAt = Date.now();
  win.__grokAsleep = false;
  win.__grokBusyCount = 0;
  win.__grokNetworkCaptureEnabled = false;
  installImagineGenerationNetworkCapture(win);
  wakeBridgeWindow(win);
  win.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    win.__grokDomReadyUrl = "";
    win.__grokPreparedAt = 0;
  });
  win.webContents.on("dom-ready", () => {
    win.__grokDomReadyUrl = normalizeGrokUrl(win.webContents.getURL() || "");
  });
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
  const attempts = Math.max(1, Number(options.attempts || 3));
  const targetReached = () => {
    const current = win.webContents.getURL() || "";
    return current.includes("grok.com")
      && (!forceTarget || grokUrlMatches(current, targetUrl));
  };
  const domReadyAtTarget = () => (
    targetReached()
    && (
      grokUrlMatches(win.__grokDomReadyUrl || "", targetUrl)
      || !win.webContents.isLoadingMainFrame()
    )
  );
  if (domReadyAtTarget()) return;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const ready = () => {
        if (domReadyAtTarget()) done();
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        win.webContents.off("dom-ready", ready);
        win.webContents.off("did-finish-load", ready);
        win.webContents.off("did-stop-loading", ready);
      };
      timer = setTimeout(done, timeoutMs);
      win.webContents.on("dom-ready", ready);
      win.webContents.on("did-finish-load", ready);
      win.webContents.on("did-stop-loading", ready);
      if (domReadyAtTarget()) {
        done();
      } else if (!targetReached()) {
        win.loadURL(targetUrl).catch(done);
      }
    });
    if (domReadyAtTarget()) return;
  }
  throw new Error(`Grok page did not become ready url=${targetUrl} current=${win.webContents.getURL() || ""}`);
}

function bridgePromiseWithTimeout(promise, timeoutMs, message) {
  const waitMs = Math.max(250, Number(timeoutMs || 0));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, waitMs);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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


async function bridgeMediaContext(win, ids = [], timeoutMs = IMAGINE_BRIDGE_SCRIPT_TIMEOUT_MS) {
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
    return await bridgePromiseWithTimeout(
      win.webContents.executeJavaScript(script, true),
      timeoutMs,
      "Imagine media store check did not return.",
    );
  } catch (error) {
    return { ok: false, error: error.message || String(error), hasMediaStore: false, matchedBy: "", ids };
  }
}

async function bridgeMediaStatus(win, timeoutMs = IMAGINE_BRIDGE_SCRIPT_TIMEOUT_MS) {
  const script = `
    (() => {
      const bridge = window.__grokChameleonImagineBridge;
      if (!bridge || typeof bridge.status !== 'function') {
        return { ok: false, error: 'bridge missing', hasMediaStore: false, status: null };
      }
      const status = bridge.status();
      return { ok: true, hasMediaStore: Boolean(status && status.hasMediaStore), status };
    })()
  `;
  try {
    return await bridgePromiseWithTimeout(
      win.webContents.executeJavaScript(script, true),
      timeoutMs,
      "Imagine bridge status check did not return.",
    );
  } catch (error) {
    return { ok: false, error: error.message || String(error), hasMediaStore: false, status: null };
  }
}

async function bridgeWaitForMediaStore(win, timeoutMs) {
  const budget = Math.max(0, Math.floor(Number(timeoutMs) || 0));
  const script = `
    (() => {
      const bridge = window.__grokChameleonImagineBridge;
      if (!bridge || typeof bridge.awaitMediaStore !== 'function') {
        return { ok: false, error: 'bridge missing', hasMediaStore: false, status: null };
      }
      return bridge.awaitMediaStore(${budget});
    })()
  `;
  try {
    return await bridgePromiseWithTimeout(
      win.webContents.executeJavaScript(script, true),
      budget + IMAGINE_BRIDGE_SCRIPT_TIMEOUT_MS,
      "Imagine bridge readiness wait did not return.",
    );
  } catch (error) {
    return { ok: false, error: error.message || String(error), hasMediaStore: false, status: null };
  }
}

async function waitForBridgeStoreReady(win, command, options = {}) {
  const ids = commandMediaIds(command);
  const needIdMatch = (Boolean(options.requireIdMatch) || command.type === "crop_image") && ids.length > 0;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || (needIdMatch ? 12000 : 8000)));
  const deadline = Date.now() + timeoutMs;
  let last = null;
  // Ask the page to tell us when its media store lands instead of re-probing a
  // renderer that is busy loading Grok's bundle. Polling stays as the fallback for
  // pages whose preload bridge predates awaitMediaStore, and for id matching.
  if (!needIdMatch) {
    const awaited = await bridgeWaitForMediaStore(win, Math.max(0, deadline - Date.now()));
    if (awaited?.hasMediaStore) return awaited;
    if (awaited?.waited) last = awaited;
  }
  while (Date.now() < deadline) {
    const remainingMs = Math.max(250, deadline - Date.now());
    const probeTimeoutMs = Math.min(IMAGINE_BRIDGE_SCRIPT_TIMEOUT_MS, remainingMs);
    const probe = needIdMatch
      ? await bridgeMediaContext(win, ids, probeTimeoutMs)
      : await bridgeMediaStatus(win, probeTimeoutMs);
    // A probe squeezed into the last few hundred milliseconds reports a timeout by
    // construction. Do not let that overwrite a result that actually described the page.
    if (probe?.status || !last) last = probe;
    if (probe?.hasMediaStore && (!needIdMatch || probe.matchedBy)) return probe;
    await sleep(250);
  }
  return last;
}

async function prepareBridgeWindow(win, command, prepareGeneration = 0) {
  const prepareStartedAt = Date.now();
  const storePageCommand = ["prepare", "fetch_stream"].includes(command.type);
  // Generation commands reuse the account-scoped media store prepared at app startup.
  // Source post/conversation context is carried in the command payload and hydrated by
  // the preload bridge; navigating to the request referer would discard the warm store.
  const targetUrl = ["t2i_ws", "prepare", "fetch_stream"].includes(command.type)
    ? "https://grok.com/imagine/saved"
    : (command.url || "https://grok.com/imagine");
  const cookiesChanged = await applyBridgeCookies(win, command);
  const currentUrl = win.webContents.getURL() || "";
  // force_refresh and a cookie rotation both defeat the reuse shortcut below, so
  // "initial" on its own does not tell us whether the page was actually rebuilt.
  // Record what the window was really holding before we touch it.
  const pageWasLoaded = grokUrlMatches(win.__grokDomReadyUrl || "", targetUrl);
  const wasAsleep = Boolean(win.__grokWokeFromSleep);
  win.__grokWokeFromSleep = false;
  // A window that is still open with a live media store stays usable however long it has
  // been there, the same way a browser tab does. Ageing it out on a clock only made the
  // next call take the "initial" path and log a fresh preparation while reusing the very
  // same window, so the store check below is what actually decides.
  const preparedRecently = (
    storePageCommand
    && !command.force_refresh
    && !cookiesChanged
    && Number(win.__grokPreparedAt || 0) > 0
    && grokUrlMatches(currentUrl, targetUrl)
  );
  if (preparedRecently) {
    const context = await bridgeMediaStatus(win);
    if (context?.hasMediaStore) {
      if (command.type === "prepare") {
        appendLog(
          `bridge prepared account=${command?.account_id || ""} mode=reused`
          + ` asleep_before=${wasAsleep ? "yes" : "no"}`
          + ` elapsed_ms=${Date.now() - prepareStartedAt}`,
        );
      }
      return win;
    }
    win.__grokPreparedAt = 0;
  }

  await waitForLoad(win, targetUrl, {
    forceTarget: ["t2i_ws", "prepare", "fetch_stream", "crop_image", "open_page"].includes(command.type),
    timeoutMs: storePageCommand ? IMAGINE_BRIDGE_PAGE_TIMEOUT_MS : undefined,
    attempts: storePageCommand ? 1 : undefined,
  });
  const needsMediaStore = storePageCommand || command.type === "crop_image";
  const context = needsMediaStore
    ? await waitForBridgeStoreReady(win, command, {
      timeoutMs: storePageCommand ? IMAGINE_BRIDGE_STORE_TIMEOUT_MS : undefined,
    })
    : null;
  if (needsMediaStore && !context?.hasMediaStore) {
    const status = context?.status || {};
    appendLog(
      `bridge media store missing account=${command?.account_id || ""} type=${command?.type || ""}`
      + ` runtimes=${Number(status?.turbopackRuntimeCount || 0)}`
      + ` modules=${Array.isArray(status?.turbopackModuleCounts) ? status.turbopackModuleCounts.join(",") : ""}`
      + ` error=${String(context?.error || "")}`,
    );
    throw new Error("Imagine official media store is not ready.");
  }
  if (storePageCommand) {
    if (prepareGeneration && win.__grokPrepareGeneration !== prepareGeneration) {
      throw new Error("Imagine bridge preparation was superseded.");
    }
    win.__grokPreparedAt = Date.now();
    if (command.type === "prepare") {
      const status = context?.status || {};
      appendLog(
        `bridge prepared account=${command?.account_id || ""} mode=initial`
        + ` reloaded=${pageWasLoaded ? "no" : "yes"}`
        + ` asleep_before=${wasAsleep ? "yes" : "no"}`
        + ` elapsed_ms=${Date.now() - prepareStartedAt}`
        + ` runtimes=${Number(status?.turbopackRuntimeCount || 0)}`
        + ` modules=${Array.isArray(status?.turbopackModuleCounts) ? status.turbopackModuleCounts.join(",") : ""}`,
      );
    }
  }
  return win;
}

async function ensureBridgeReady(command) {
  const win = bridgeWindow(command);
  const storePageCommand = ["prepare", "fetch_stream"].includes(command.type);
  if (!storePageCommand) return prepareBridgeWindow(win, command);
  if (win.__grokPreparePromise) {
    await win.__grokPreparePromise;
    return win;
  }
  const generation = Number(win.__grokPrepareGeneration || 0) + 1;
  win.__grokPrepareGeneration = generation;
  const preparePromise = prepareBridgeWindow(win, command, generation).then((value) => {
    if (win.__grokPrepareGeneration !== generation) {
      throw new Error("Imagine bridge preparation was superseded.");
    }
    return value;
  });
  const promise = bridgePromiseWithTimeout(
    preparePromise,
    IMAGINE_BRIDGE_PREPARE_TIMEOUT_MS,
    "Imagine bridge preparation did not finish in time.",
  );
  win.__grokPreparePromise = promise;
  try {
    return await promise;
  } catch (error) {
    if (win.__grokPrepareGeneration === generation) {
      win.__grokPrepareGeneration += 1;
      win.__grokPreparedAt = 0;
    }
    throw error;
  } finally {
    if (win.__grokPreparePromise === promise) win.__grokPreparePromise = null;
  }
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
    if (command.type === "prepare") {
      supersedeOtherAccountPreparations(command);
      closeInactiveAccountWindows(command);
    }
    win = await ensureBridgeReady(command);
    // Held for the whole command so the budget sweep cannot evict a window that is
    // still streaming a generation.
    markBridgeWindowBusy(win, 1);
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
    markBridgeWindowBusy(win, -1);
    if (bridgeCommandUsesEphemeralWindow(command) && win && !win.isDestroyed()) {
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
    createMainWindow();
    void pruneCardPreviewCacheAtStartup();
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
  if (!appTerminating) shutdownServerNow();
});

if (process.platform === "darwin") {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.once(signal, () => {
      void exitAppNow(signal.toLowerCase());
    });
  }
}
