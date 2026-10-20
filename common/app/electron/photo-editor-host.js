const {createRecentFiles}=require('./photo-editor-recents.js');
const {createFileSave}=require('./photo-editor-file-save.js');
const {encodeLosslessWebp}=require('./photo-editor-webp.js');
const {createHistoryLogWriter}=require('./photo-editor-history-log.js');
const {createRecoveryStore}=require('./photo-editor-recovery.js');
const {createSettingsStore}=require('./photo-editor-settings.js');
const {installEditorMenu}=require('./photo-editor-menu.js');
const fs = require("node:fs");
const { fontMetadata } = require("./font-metadata.js");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { app, WebContentsView, dialog } = require("electron");
const { randomUUID } = require("node:crypto");

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

function windowsFonts() {
  return path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
}

function cjkFontFile(key) {
  if (process.platform === "win32") {
    const dir = windowsFonts();
    const named = {
      korean: ["malgun.ttf", "gulim.ttc"],
      japanese: ["YuGothR.ttc", "meiryo.ttc", "msgothic.ttc"],
      "japanese-w4": ["YuGothM.ttc", "YuGothR.ttc"],
      "simplified-chinese": ["msyh.ttc", "msyh.ttf", "simsun.ttc"],
      "simplified-chinese-gb": ["simsun.ttc", "msyh.ttc"],
      "simplified-chinese-heiti": ["simsun.ttc"],
      "traditional-chinese": ["msjh.ttc", "msjh.ttf", "mingliu.ttc"],
      "traditional-chinese-heiti": ["mingliu.ttc", "msjh.ttc"],
      "last-resort": ["ARIALUNI.TTF", "arialuni.ttf"],
    };
    const names = named[key];
    return names ? firstFile(names.map((name) => path.join(dir, name))) : null;
  }
  if (key === "simplified-chinese" || key === "traditional-chinese") return macPingfang();
  const list = CJK_FONTS[key];
  return list ? firstFile(list) : null;
}

let fontCatalog = null;
function fontIndex() {
  if (fontCatalog) return fontCatalog;
  const dirs = process.platform === "win32"
    ? [windowsFonts(), process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") : ""]
      .filter(Boolean)
    : ["/System/Library/Fonts", "/Library/Fonts", path.join(os.homedir(), "Library", "Fonts")];
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
  fontCatalog = files.flatMap((file, index) => { const faces = fontMetadata(file); return faces.length ? faces.map(face => ({ id: `${index}-${face.faceIndex}`, name: path.basename(file), file, ...face })) : [{ id: String(index), name: path.basename(file), file, family: path.basename(file).replace(/\.(ttf|otf|ttc|otc)$/i, ""), aliases: [], weight: 400, weightMin: 400, weightMax: 400, style: "normal", faceIndex: 0 }]; });
  return fontCatalog;
}

function systemFontFile(pathname) {
  const prefix = "/host/system-font/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  let id, name;
  try { id = decodeURIComponent(rest.slice(0, slash)); name = decodeURIComponent(rest.slice(slash + 1)); } catch (_) { return null; }
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

function createPhotoEditorHost({ serverBase, log }) {
  let nativeMenu,previousWindowTitle;
  function updateTitle(event,title){if(!view||event.sender!==view.webContents||!session||typeof title!=='string'||title.length>1000)return;const owner=view.webContents.getOwnerBrowserWindow();if(owner&&!owner.isDestroyed())owner.setTitle(title||'Photo Editor');}
  function updateMenu(event,model){if(!view||event.sender!==view.webContents||!session)return;nativeMenu?.update(event,model);}
  let settingsStore,recoveryStore,workspaceStore,recentStore;
  async function recovery(event,operation,value){if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');recoveryStore??=createRecoveryStore(path.join(app.getPath('userData'),'photo-editor','recovery'));return recoveryStore.handle(operation,value);}
  async function workspaceState(event,value=null){if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');workspaceStore??=createSettingsStore(path.join(app.getPath('userData'),'photo-editor'),'workspace.json');if(value!==null){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['dockLayout','workspace','workspaces','rulers','recentFonts'].includes(key)||typeof value[key]!=='string'))throw Error('Invalid workspace state.');}return value===null?workspaceStore.read():workspaceStore.write(value);}
  async function preferences(event,value=null){if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');settingsStore??=createSettingsStore(path.join(app.getPath('userData'),'photo-editor'));return value===null?settingsStore.read():settingsStore.write(value);}

  const appendLogEntry=createHistoryLogWriter(async()=>{settingsStore??=createSettingsStore(path.join(app.getPath('userData'),'photo-editor'));return settingsStore.read();});
  async function historyLog(event,line){if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');return appendLogEntry(line);}
  async function webp(event,bytes){if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');return encodeLosslessWebp(bytes);}
  async function exportRaster(event,value,name){
    if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');const current=view,currentSession=session,bytes=Buffer.from(value);if(!bytes.length||bytes.length>256*1024*1024||typeof name!=='string'||path.basename(name)!==name)throw Error('Invalid export.');settingsStore??=createSettingsStore(path.join(app.getPath('userData'),'photo-editor'));const prefs=await settingsStore.read();let destination,automatic=false;
    if(prefs?.quickExportLocation==='sameFolder'&&String(session.sourceUrl).startsWith('file:')){try{const source=require('node:url').fileURLToPath(session.sourceUrl);if((await fs.promises.stat(source)).isFile()){const candidate=path.join(path.dirname(source),name);try{await fs.promises.lstat(candidate);}catch(error){if(error.code==='ENOENT'){destination=candidate;automatic=true;}else throw error;}}}catch{}}
    if(!destination){const selected=await dialog.showSaveDialog(current.webContents.getOwnerBrowserWindow(),{title:'Quick Export',defaultPath:name});if(selected.canceled||!selected.filePath)return {cancelled:true};destination=selected.filePath;}
    if(view!==current||session!==currentSession)throw Error('Photo Editor session changed.');const handle=await fs.promises.open(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|(automatic?fs.constants.O_EXCL:fs.constants.O_TRUNC)|fs.constants.O_NOFOLLOW,0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}return {saved:true};
  }
  async function recentFiles(event,operation,value){if(!view||event.sender!==view.webContents||!session)throw Error('Photo Editor session is unavailable.');recentStore??=createRecentFiles(path.join(app.getPath('userData'),'photo-editor'),async()=>{settingsStore??=createSettingsStore(path.join(app.getPath('userData'),'photo-editor'));return settingsStore.read();});if(!['list','remember','open','clear'].includes(operation))throw Error('Unknown recent-file operation.');return recentStore[operation](value);}
  const root = path.join(__dirname, "..", "web", "photo_editor");
  let server = null;
  let port = 0;
  let view = null;
  let opening = false;
  let fit = null;
  let session = null;
  let sourcePath = "";
  let sourceDir = "";
  let sourceType = "image/png";
  let fileName = "source.png";
  let finishing = false;
  const linkedFiles = new Map();

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
        response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/host/session.json") {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ file: fileName, name: session?.name || fileName, languages: systemLanguages() }));
          return;
        }
        if (url.pathname === "/host/font-index.json") {
          const index = fontIndex().map(({ file, ...entry }) => entry);
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
        const relative = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
        const file = path.resolve(root, relative || "index.html");
        const fromRoot = path.relative(root, file);
        if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
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
    nativeMenu?.dispose();nativeMenu=null;
    if(previousWindowTitle!==undefined&&win&&!win.isDestroyed())win.setTitle(previousWindowTitle);previousWindowTitle=undefined;
    const current = view;
    view = null;
    session = null;
    linkedFiles.clear();
    if (sourceDir) {
      try { fs.rmSync(sourceDir, { recursive: true, force: true }); } catch (_) {}
      sourceDir = "";
      sourcePath = "";
    }
    if (fit && win && !win.isDestroyed()) {
      for (const event of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
        win.removeListener(event, fit);
      }
    }
    fit = null;
    if (current) {
      if (win && !win.isDestroyed()) {
        try { win.contentView.removeChildView(current); } catch (_) {}
      }
      try { current.webContents.close(); } catch (_) {}
    }
    if (win && !win.isDestroyed()) {
      win.webContents.focus();
      win.webContents.send("grok-chameleon:photo-editor-done", { saved: saved || null });
    }
  }

  async function linkedFile(event, token = null) {
    if (!view || event.sender !== view.webContents || !session) throw new Error("Photo Editor session is unavailable.");
    const current = view, currentSession = session;
    let file, key = token;
    if (token === null) {
      const selected = await dialog.showOpenDialog(current.webContents.getOwnerBrowserWindow(), {
        title: "Relink Smart Object", properties: ["openFile"],
        filters: [{ name: "Smart Object Source", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "psd", "psb", "tif", "tiff", "gcphoto"] }],
      });
      if (selected.canceled || !selected.filePaths.length) return { cancelled: true };
      file = await fs.promises.realpath(selected.filePaths[0]);key = randomUUID();
    } else {
      if (typeof token !== "string" || !linkedFiles.has(token)) throw new Error("Relink this file before refreshing it in this session.");
      file = linkedFiles.get(token);
    }
    if (view !== current || session !== currentSession || current.webContents.isDestroyed()) throw new Error("Photo Editor session changed.");
    const handle = await fs.promises.open(file, "r");
    let bytes, before;
    try {
      before = await handle.stat();
      if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > 256 * 1024 * 1024) throw new Error("Linked source must be a file of at most 256 MiB.");
      bytes = Buffer.alloc(before.size);let offset = 0;
      while (offset < bytes.length) { const part = await handle.read(bytes, offset, bytes.length - offset, offset);if (!part.bytesRead) throw new Error("Linked source changed while reading.");offset += part.bytesRead; }
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Linked source changed while reading. Try again.");
    } finally { await handle.close(); }
    if (view !== current || session !== currentSession || current.webContents.isDestroyed()) throw new Error("Photo Editor session changed.");
    linkedFiles.set(key, file);
    return { token: key, path: file, name: path.basename(file), size: before.size, modified: before.mtimeMs, bytes: new Uint8Array(bytes) };
  }

  async function save(event, bytes) {
    if (!view || event.sender !== view.webContents) throw new Error("Photo Editor가 열려 있지 않습니다.");
    if (!session) throw new Error("편집 세션이 없습니다.");
    const current = view;
    const currentSession = session;
    const owner = current.webContents.getOwnerBrowserWindow();
    const image = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    const response = await fetch(`${serverBase}/api/image-editor/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: currentSession.itemId,
        source_url: currentSession.sourceUrl,
        name: currentSession.name,
        image,
        provider: currentSession.provider,
        save_target: currentSession.saveTarget,
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
    const saveTarget = parsed?.item?.metadata?.editor_save_target || currentSession.saveTarget || "";
    setTimeout(() => {
      if (view === current && session === currentSession) finish(owner, { itemId, saveTarget });
    }, 0);
    return { ok: true };
  }

  function close(event) {
    if (!view || event.sender !== view.webContents) return { ok: true };
    finish(view.webContents.getOwnerBrowserWindow(), null);
    return { ok: true };
  }

  async function open(payload, win) {
    if (view || opening) return fail("Photo Editor가 이미 열려 있습니다.");
    if (!win || win.isDestroyed()) return fail("창이 없습니다.");
    if (!fs.existsSync(path.join(root, "index.html"))) return fail("JavaScript Photo Editor가 앱 안에 없습니다.");
    const raw = String(payload.image_base64 || "");
    if (!raw) return fail("편집할 이미지가 비어 있습니다.");
    const requestedMime = String(payload.mime || "").toLowerCase().split(";")[0].trim();
    const sourceFormats = {
      "image/jpeg": ["source.jpg", "image/jpeg"],
      "image/jpg": ["source.jpg", "image/jpeg"],
      "image/png": ["source.png", "image/png"],
      "image/webp": ["source.webp", "image/webp"],
      "image/gif": ["source.gif", "image/gif"],
      "image/bmp": ["source.bmp", "image/bmp"],
    };
    [fileName, sourceType] = sourceFormats[requestedMime] || sourceFormats["image/png"];
    opening = true;
    finishing = false;
    try {
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-editor-"));
      sourcePath = path.join(sourceDir, fileName);
      fs.writeFileSync(sourcePath, Buffer.from(raw, "base64"));
      session = {
        itemId: String(payload.item_id || ""),
        sourceUrl: String(payload.source_url || ""),
        name: String(payload.name || "Image"),
        provider: String(payload.provider || "build"),
        saveTarget: String(payload.save_target || "detail"),
      };
      const editorPort = await listen();
      if (finishing || win.isDestroyed()) throw new Error("편집기 열기가 취소되었습니다.");
      const current = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "photo-editor-preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      view = current;
      previousWindowTitle=win.getTitle();win.setTitle(session.name);
      nativeMenu=installEditorMenu(current.webContents);
      current.webContents.setZoomFactor(1);
      current.setBackgroundColor("#202020");
      current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      current.webContents.once("destroyed", () => {
        if (view === current) finish(win, null);
      });
      current.webContents.on("render-process-gone", () => {
        if (view === current) finish(win, null);
      });
      win.contentView.addChildView(current);
      fit = () => layout(win);
      for (const event of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
        win.on(event, fit);
      }
      layout(win);
      await current.webContents.loadURL(`http://127.0.0.1:${editorPort}/index.html`);
      if (view !== current || current.webContents.isDestroyed()) throw new Error("편집기가 닫혔습니다.");
      current.webContents.focus();
      log("photo editor JavaScript photo_editor");
      return { ok: true };
    } catch (error) {
      finish(win, null);
      return fail(error);
    } finally {
      opening = false;
    }
  }

  function stop(win) {
    finish(win, null);
    if (server) {
      try { server.close(); } catch (_) {}
      server = null;
    }
  }

  const fileSave=createFileSave({dialog,getContext:()=>({view,session})});
  return { open, stop, save, close, linkedFile, preferences, recovery, workspaceState,historyLog,webp,exportRaster,recentFiles,updateMenu,updateTitle,fileSave };
}

module.exports = { createPhotoEditorHost };
