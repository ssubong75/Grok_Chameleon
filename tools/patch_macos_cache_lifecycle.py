#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one source match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} source matches, found {count}")
    return text.replace(old, new)


def patch_main(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "let activeCardPreviewTasks = 0;\n",
        'let activeCardPreviewTasks = 0;\nconst CARD_PREVIEW_LEGACY_CLEANUP_VERSION = "v1";\n',
        "card preview constants",
    )

    helpers = r'''
function cardPreviewCacheRoot() {
  return path.resolve(app.getPath("userData"), "Cache");
}

function cardPreviewCacheDir() {
  return path.join(cardPreviewCacheRoot(), "card-previews");
}

function verifiedCurrentCardPreviewCacheDir() {
  const cacheRoot = cardPreviewCacheRoot();
  const cacheDir = path.resolve(cardPreviewCacheDir());
  if (path.dirname(cacheDir) !== cacheRoot || path.basename(cacheDir) !== "card-previews") {
    throw new Error("Refusing unsafe card preview cache path.");
  }
  return cacheDir;
}

function clearCurrentCardPreviewCache(reason = "cleanup") {
  let cacheDir = "";
  try {
    cacheDir = verifiedCurrentCardPreviewCacheDir();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    cardPreviewPruneTimes.delete(cacheDir);
    appendLog(`card preview cache cleared reason=${reason} path=${cacheDir}`);
    return true;
  } catch (error) {
    appendLog(`card preview cache cleanup failed reason=${reason} path=${cacheDir} detail=${error.message || String(error)}`);
    return false;
  }
}

function legacyCardPreviewMarkerPath(libraryRoot) {
  const key = crypto.createHash("sha256").update(path.resolve(libraryRoot)).digest("hex").slice(0, 20);
  return path.join(cardPreviewCacheRoot(), `.library-card-previews-cleaned-${CARD_PREVIEW_LEGACY_CLEANUP_VERSION}-${key}`);
}

function isExactLegacyCardPreviewCachePath(libraryRoot, legacyCacheDir) {
  if (!path.isAbsolute(libraryRoot) || !path.isAbsolute(legacyCacheDir)) return false;
  const resolvedLibraryRoot = path.resolve(libraryRoot);
  const resolvedLegacyCacheDir = path.resolve(legacyCacheDir);
  if (resolvedLibraryRoot === path.parse(resolvedLibraryRoot).root) return false;
  if (path.relative(resolvedLibraryRoot, resolvedLegacyCacheDir) !== path.join("cache", "card-previews")) return false;
  try {
    return fs.statSync(resolvedLibraryRoot).isDirectory()
      && fs.existsSync(path.join(resolvedLibraryRoot, "library.json"));
  } catch (_) {
    return false;
  }
}

async function cleanupLegacyCardPreviewCacheOnce() {
  try {
    const info = await fetchJson(`${SERVER_BASE}/api/card-preview/cache-info`, {
      signal: AbortSignal.timeout(3000),
    });
    const currentCacheDir = String(info?.cache_dir || "").trim();
    const libraryRoot = String(info?.library_root || "").trim();
    const legacyCacheDir = String(info?.legacy_cache_dir || "").trim();
    if (path.resolve(currentCacheDir) !== verifiedCurrentCardPreviewCacheDir()) {
      throw new Error("Card preview cache path does not match the app cache directory.");
    }
    if (!isExactLegacyCardPreviewCachePath(libraryRoot, legacyCacheDir)) {
      throw new Error("Refusing unsafe legacy card preview cache path.");
    }
    const markerPath = legacyCardPreviewMarkerPath(libraryRoot);
    if (fs.existsSync(markerPath)) return;
    if (fs.existsSync(legacyCacheDir)) {
      fs.rmSync(legacyCacheDir, { recursive: true, force: true });
      appendLog(`legacy library card preview cache cleared path=${legacyCacheDir}`);
    }
    fs.mkdirSync(cardPreviewCacheRoot(), { recursive: true });
    const tempMarkerPath = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempMarkerPath, `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempMarkerPath, markerPath);
  } catch (error) {
    appendLog(`legacy card preview cleanup skipped: ${error.message || String(error)}`);
  }
}

'''
    text = replace_once(
        text,
        "function cardPreviewResult(key) {\n",
        helpers + "function cardPreviewResult(key) {\n",
        "cache lifecycle helpers",
    )

    touch_helper = r'''
function touchCardPreviewCacheFile(filePath) {
  try {
    const now = new Date();
    fs.utimesSync(filePath, now, now);
  } catch (_) {}
}

'''
    text = replace_once(
        text,
        "function localCardPreviewSource(rawUrl) {\n",
        touch_helper + "function localCardPreviewSource(rawUrl) {\n",
        "cache touch helper",
    )

    text = replace_once(
        text,
        '  const cacheDir = String(info?.cache_dir || "").trim();\n'
        "  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(cacheDir)) {\n"
        '    throw new Error("Card preview library path is invalid.");\n'
        "  }\n",
        '  const cacheDir = String(info?.cache_dir || "").trim();\n'
        "  const expectedCacheDir = verifiedCurrentCardPreviewCacheDir();\n"
        "  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(cacheDir) || path.resolve(cacheDir) !== expectedCacheDir) {\n"
        '    throw new Error("Card preview app cache path is invalid.");\n'
        "  }\n",
        "preview cache path validation",
    )
    text = replace_count(
        text,
        "    if (fs.statSync(targetPath).size > 0) return cardPreviewResult(cacheKey);\n",
        "    if (fs.statSync(targetPath).size > 0) {\n"
        "      touchCardPreviewCacheFile(targetPath);\n"
        "      pruneCardPreviewCache(cacheDir, targetPath);\n"
        "      return cardPreviewResult(cacheKey);\n"
        "    }\n",
        2,
        "preview cache hits",
    )

    text = replace_once(
        text,
        '    PYTHONDONTWRITEBYTECODE: "1",\n',
        '    PYTHONDONTWRITEBYTECODE: "1",\n'
        "    GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR: verifiedCurrentCardPreviewCacheDir(),\n",
        "server cache environment",
    )
    text = replace_once(
        text,
        "  shutdownServerNow(false);\n  app.exit(0);\n",
        '  shutdownServerNow(false);\n  clearCurrentCardPreviewCache("shutdown");\n  app.exit(0);\n',
        "normal exit cleanup",
    )
    text = replace_once(
        text,
        "    installMediaPermissionGuards();\n    installMenu();\n    await startServer();\n    createMainWindow();\n",
        '    installMediaPermissionGuards();\n    installMenu();\n    clearCurrentCardPreviewCache("startup");\n'
        "    await startServer();\n    await cleanupLegacyCardPreviewCacheOnce();\n    createMainWindow();\n",
        "startup cleanup",
    )
    text = replace_once(
        text,
        'app.on("will-quit", () => {\n  if (!appTerminating) shutdownServerNow();\n});\n',
        'app.on("will-quit", () => {\n  clearCurrentCardPreviewCache("will-quit");\n'
        "  if (!appTerminating) shutdownServerNow();\n});\n",
        "will-quit cleanup",
    )

    required = (
        'path.resolve(app.getPath("userData"), "Cache")',
        'path.basename(cacheDir) !== "card-previews"',
        'path.join("cache", "card-previews")',
        'clearCurrentCardPreviewCache("startup")',
        'clearCurrentCardPreviewCache("shutdown")',
        'clearCurrentCardPreviewCache("will-quit")',
        "cleanupLegacyCardPreviewCacheOnce",
        "GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR",
    )
    for marker in required:
        if marker not in text:
            raise RuntimeError(f"main.js validation failed: missing {marker}")
    path.write_text(text, encoding="utf-8", newline="\n")


def patch_server(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '    (root / "cache" / "card-previews").mkdir(parents=True, exist_ok=True)\n',
        "",
        "legacy cache directory creation",
    )
    text = replace_once(
        text,
        "def card_preview_cache_dir(root: Path | None = None) -> Path | None:\n"
        "    root = root or library_root()\n"
        '    return root / "cache" / "card-previews" if root else None\n',
        "def card_preview_cache_root() -> Path:\n"
        '    return (app_support_dir() / "Cache").resolve()\n\n\n'
        "def card_preview_cache_dir(root: Path | None = None) -> Path:\n"
        "    expected_root = card_preview_cache_root()\n"
        '    raw = str(os.environ.get("GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR") or "").strip()\n'
        '    candidate = Path(raw).expanduser() if raw else expected_root / "card-previews"\n'
        "    if not candidate.is_absolute():\n"
        '        raise RuntimeError("Card preview cache path must be absolute.")\n'
        "    candidate = candidate.resolve()\n"
        '    if candidate.parent != expected_root or candidate.name != "card-previews":\n'
        '        raise RuntimeError("Refusing unsafe card preview cache path.")\n'
        "    return candidate\n\n\n"
        "def legacy_card_preview_cache_dir(root: Path | None = None) -> Path | None:\n"
        "    root = root or library_root()\n"
        '    return (root / "cache" / "card-previews").resolve() if root else None\n',
        "app cache directory",
    )

    old_route = '''            if parsed.path == "/api/card-preview/source-info":
                root = library_root()
                cache_dir = card_preview_cache_dir(root)
                if not root or not cache_dir:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                query = parse_qs(parsed.query)
                source = safe_join(root, query.get("path", [""])[0])
                if not source.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                cache_dir.mkdir(parents=True, exist_ok=True)
                self.send_json({"ok": True, "source_path": str(source), "cache_dir": str(cache_dir)})
                return
'''
    new_route = '''            if parsed.path == "/api/card-preview/cache-info":
                root = library_root()
                cache_dir = card_preview_cache_dir(root)
                legacy_cache_dir = legacy_card_preview_cache_dir(root)
                if not root or not root.is_dir() or not legacy_cache_dir:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                self.send_json({
                    "ok": True,
                    "cache_dir": str(cache_dir),
                    "library_root": str(root.resolve()),
                    "legacy_cache_dir": str(legacy_cache_dir),
                })
                return
            if parsed.path == "/api/card-preview/source-info":
                root = library_root()
                cache_dir = card_preview_cache_dir(root)
                legacy_cache_dir = legacy_card_preview_cache_dir(root)
                if not root or not legacy_cache_dir:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                query = parse_qs(parsed.query)
                source = safe_join(root, query.get("path", [""])[0])
                if not source.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                cache_dir.mkdir(parents=True, exist_ok=True)
                self.send_json({
                    "ok": True,
                    "source_path": str(source),
                    "cache_dir": str(cache_dir),
                    "library_root": str(root.resolve()),
                    "legacy_cache_dir": str(legacy_cache_dir),
                })
                return
'''
    text = replace_once(text, old_route, new_route, "card preview routes")

    if '(root / "cache" / "card-previews").mkdir' in text:
        raise RuntimeError("server.py validation failed: library cache is still created")
    for marker in (
        "GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR",
        "def legacy_card_preview_cache_dir",
        'parsed.path == "/api/card-preview/cache-info"',
        '"legacy_cache_dir": str(legacy_cache_dir)',
    ):
        if marker not in text:
            raise RuntimeError(f"server.py validation failed: missing {marker}")
    path.write_text(text, encoding="utf-8", newline="\n")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch_macos_cache_lifecycle.py MAIN_JS SERVER_PY")
    main_path = Path(sys.argv[1]).resolve()
    server_path = Path(sys.argv[2]).resolve()
    if main_path.name != "main.js" or server_path.name != "server.py":
        raise RuntimeError("Refusing unexpected patch targets")
    patch_main(main_path)
    patch_server(server_path)
    print(f"patched {main_path}")
    print(f"patched {server_path}")


if __name__ == "__main__":
    main()
