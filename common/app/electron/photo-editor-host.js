const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { WebContentsView, app } = require("electron");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const FONT_EXT = /\.(ttf|otf|ttc|otc)$/i;
const MAX_FONT_BYTES = 128 * 1024 * 1024;

function systemLanguages() {
  try {
    if (typeof app.getPreferredSystemLanguages === "function") {
      const preferred = app.getPreferredSystemLanguages();
      if (Array.isArray(preferred) && preferred.length) return preferred.map((tag) => String(tag));
    }
    return [String(app.getLocale())];
  } catch (_) {
    return [];
  }
}

function firstFile(paths) {
  for (const file of paths) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch (_) {}
  }
  return null;
}

let pingfangPath;
function macPingfang() {
  if (pingfangPath !== undefined) return pingfangPath;
  const old = "/System/Library/Fonts/PingFang.ttc";
  if (firstFile([old])) {
    pingfangPath = old;
    return pingfangPath;
  }
  const roots = ["/System/Library/AssetsV2", "/System/Library/AssetsV2/PreinstalledAssetsV2/InstallWithOs"];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch (_) { continue; }
    for (const name of entries.slice(0, 512)) {
      if (!String(name).startsWith("com_apple_MobileAsset_Font")) continue;
      let assets = [];
      try { assets = fs.readdirSync(path.join(root, name)); } catch (_) { continue; }
      for (const asset of assets.slice(0, 4096)) {
        const candidate = path.join(root, name, asset, "AssetData", "PingFang.ttc");
        if (firstFile([candidate])) {
          pingfangPath = candidate;
          return pingfangPath;
        }
      }
    }
  }
  pingfangPath = null;
  return null;
}

const CJK_FONTS = {
  korean: ["/System/Library/Fonts/AppleSDGothicNeo.ttc"],
  japanese: ["/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"],
  "japanese-w4": ["/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc"],
  "simplified-chinese-gb": ["/System/Library/Fonts/Hiragino Sans GB.ttc"],
  "simplified-chinese-heiti": ["/System/Library/Fonts/STHeiti Light.ttc"],
  "traditional-chinese-heiti": ["/System/Library/Fonts/STHeiti Light.ttc"],
  "last-resort": ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf"],
};

function cjkFontFile(key) {
  if (key === "simplified-chinese" || key === "traditional-chinese") return macPingfang();
  const list = CJK_FONTS[key];
  return list ? firstFile(list) : null;
}

let fontCatalog = null;
function fontIndex() {
  if (fontCatalog) return fontCatalog;
  const dirs = ["/System/Library/Fonts", "/Library/Fonts", path.join(os.homedir(), "Library", "Fonts")];
  const files = [];
  const seen = new Set();
  function walk(dir, depth) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      if (stat.isDirectory()) {
        if (depth < 8) walk(full, depth + 1);
      } else if (stat.isFile() && FONT_EXT.test(entry.name) && !seen.has(full)) {
        seen.add(full);
        files.push(full);
      }
    }
  }
  for (const dir of dirs) walk(dir, 0);
  files.sort();
  fontCatalog = files.map((file, index) => ({ id: String(index), name: path.basename(file), file }));
  return fontCatalog;
}

function systemFontFile(pathname) {
  const prefix = "/host/system-font/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const id = rest.slice(0, slash);
  const name = rest.slice(slash + 1);
  if (!id || !name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  const found = fontIndex().find((entry) => entry.id === id && entry.name === name);
  return found ? found.file : null;
}

function streamFile(response, file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FONT_BYTES) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": stat.size });
  fs.createReadStream(file).pipe(response);
}

function createPhotoEditorHost({ resourcesPath, serverBase, log }) {
  const bundled = path.join(__dirname, "..", "web", "photo-editor-web");
  const legacy = path.join(resourcesPath, "photo-editor-web");
  const root = fs.existsSync(path.join(bundled, "index.html")) ? bundled : legacy;
  let server = null;
  let port = 0;
  let view = null;
  let fit = null;
  let session = null;
  let sourcePath = "";
  let sourceType = "image/png";
  let fileName = "source.png";
  let finishing = false;

  function fail(error) {
    return { ok: false, error: String(error || "Photo Editor를 열지 못했습니다.") };
  }

  function listen() {
    if (server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
      const created = http.createServer((request, response) => {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        if (url.pathname === "/host/session.json") {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ file: fileName, languages: systemLanguages() }));
          return;
        }
        if (url.pathname === "/host/font-index.json") {
          const index = fontIndex().map(({ id, name }) => ({ id, name }));
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(index));
          return;
        }
        if (url.pathname.startsWith("/host/font/")) {
          const file = cjkFontFile(url.pathname.slice("/host/font/".length));
          if (!file) {
            response.writeHead(404);
            response.end();
            return;
          }
          streamFile(response, file);
          return;
        }
        const systemFont = systemFontFile(url.pathname);
        if (systemFont) {
          streamFile(response, systemFont);
          return;
        }
        if (url.pathname === "/host/source") {
          if (!sourcePath || !fs.existsSync(sourcePath)) {
            response.writeHead(404);
            response.end();
            return;
          }
          response.writeHead(200, { "Content-Type": sourceType });
          fs.createReadStream(sourcePath).pipe(response);
          return;
        }
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        const file = path.normalize(path.join(root, relative || "index.html"));
        if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
        fs.createReadStream(file).pipe(response);
      });
      created.once("error", reject);
      created.listen(0, "127.0.0.1", () => {
        const address = created.address();
        port = address && typeof address === "object" ? address.port : 0;
        server = created;
        resolve(port);
      });
    });
  }

  function layout(win) {
    if (!view || !win || win.isDestroyed()) return;
    const bounds = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
  }

  function finish(win, saved) {
    if (finishing) return;
    finishing = true;
    const current = view;
    view = null;
    session = null;
    if (fit && win && !win.isDestroyed()) {
      for (const event of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
        win.removeListener(event, fit);
      }
    }
    fit = null;
    if (current && win && !win.isDestroyed()) {
      try { win.contentView.removeChildView(current); } catch (_) {}
      try { current.webContents.close(); } catch (_) {}
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send("grok-chameleon:photo-editor-done", { saved: saved || null });
    }
  }

  async function save(event, bytes) {
    if (!view || event.sender !== view.webContents) throw new Error("Photo Editor가 열려 있지 않습니다.");
    if (!session) throw new Error("편집 세션이 없습니다.");
    const image = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    const response = await fetch(`${serverBase}/api/image-editor/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: session.itemId,
        source_url: session.sourceUrl,
        name: session.name,
        image,
        provider: session.provider,
        save_target: session.saveTarget,
      }),
    });
    const text = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch (_) {}
    if (!response.ok) {
      const message = parsed.error || parsed.message || text || `저장에 실패했습니다 (${response.status})`;
      throw new Error(String(message).slice(0, 300));
    }
    const itemId = parsed?.item?.id ? String(parsed.item.id) : "";
    if (!itemId) throw new Error(parsed.error || parsed.message || "Chameleon did not accept the image");
    const saveTarget = parsed?.item?.metadata?.editor_save_target || session.saveTarget || "";
    const owner = view.webContents.getOwnerBrowserWindow();
    setTimeout(() => finish(owner, { itemId, saveTarget }), 0);
    return { ok: true };
  }

  function close(event) {
    if (!view || event.sender !== view.webContents) return { ok: true };
    finish(view.webContents.getOwnerBrowserWindow(), null);
    return { ok: true };
  }

  async function open(payload, win) {
    if (view) return fail("Photo Editor가 이미 열려 있습니다.");
    if (!fs.existsSync(path.join(root, "index.html"))) return fail("Photo Editor 화면이 앱 안에 없습니다.");
    const raw = String(payload.image_base64 || "");
    if (!raw) return fail("편집할 이미지가 비어 있습니다.");
    const mime = String(payload.mime || "image/png");
    const jpeg = mime.includes("jpeg") || mime.includes("jpg");
    fileName = jpeg ? "source.jpg" : "source.png";
    sourceType = jpeg ? "image/jpeg" : "image/png";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-editor-"));
    sourcePath = path.join(dir, fileName);
    fs.writeFileSync(sourcePath, Buffer.from(raw, "base64"));
    session = {
      itemId: String(payload.item_id || ""),
      sourceUrl: String(payload.source_url || ""),
      name: String(payload.name || "Image"),
      provider: String(payload.provider || "build"),
      saveTarget: String(payload.save_target || "detail"),
    };
    if (!win || win.isDestroyed()) return fail("창이 없습니다.");
    try {
      await listen();
    } catch (error) {
      return fail(error && error.message ? error.message : error);
    }
    finishing = false;
    const next = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "photo-editor-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    try { next.setBackgroundColor("#262626"); } catch (_) {}
    view = next;
    win.contentView.addChildView(next);
    fit = () => layout(win);
    for (const event of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
      win.on(event, fit);
    }
    layout(win);
    next.webContents.on("console-message", (_event, _level, message) => {
      if (message) log(`photo editor: ${message}`);
    });
    await next.webContents.loadURL(`http://127.0.0.1:${port}/index.html?host=chameleon`);
    return { ok: true };
  }

  function stop(win) {
    finish(win, null);
    if (server) {
      try { server.close(); } catch (_) {}
      server = null;
    }
  }

  return { open, stop, save, close };
}

module.exports = { createPhotoEditorHost };
