#!/usr/bin/env python3
"""Keep generated card previews in app cache and clean them at start and exit."""

from __future__ import annotations

import argparse
from pathlib import Path


MAIN_REQUIRED = (
    'path.resolve(app.getPath("userData"), "Cache")',
    'path.basename(cacheDir) !== "card-previews"',
    'path.join("cache", "card-previews")',
    'clearCurrentCardPreviewCache("startup")',
    'clearCurrentCardPreviewCache("shutdown")',
    'clearCurrentCardPreviewCache("will-quit")',
    "cleanupLegacyCardPreviewCacheOnce",
    "GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR",
)

SERVER_REQUIRED = (
    "GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR",
    "def legacy_card_preview_cache_dir",
    'parsed.path == "/api/card-preview/cache-info"',
    '"legacy_cache_dir": str(legacy_cache_dir)',
)


MAIN_HELPERS = r'''function cardPreviewCacheRoot() {
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


SERVER_CACHE_BLOCK = '''def card_preview_cache_root() -> Path:
    return (app_support_dir() / "Cache").resolve()


def card_preview_cache_dir(root: Path | None = None) -> Path:
    expected_root = card_preview_cache_root()
    raw = str(os.environ.get("GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR") or "").strip()
    candidate = Path(raw).expanduser() if raw else expected_root / "card-previews"
    if not candidate.is_absolute():
        raise RuntimeError("Card preview cache path must be absolute.")
    candidate = candidate.resolve()
    if candidate.parent != expected_root or candidate.name != "card-previews":
        raise RuntimeError("Refusing unsafe card preview cache path.")
    return candidate


def legacy_card_preview_cache_dir(root: Path | None = None) -> Path | None:
    root = root or library_root()
    return (root / "cache" / "card-previews").resolve() if root else None
'''


SERVER_ROUTES = '''            if parsed.path == "/api/card-preview/cache-info":
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


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one source match, found {count}")
    return text.replace(old, new, 1)


def patch_main(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    if all(marker in text for marker in MAIN_REQUIRED):
        return False

    text = replace_once(
        text,
        "let activeCardPreviewTasks = 0;\n",
        'let activeCardPreviewTasks = 0;\nconst CARD_PREVIEW_LEGACY_CLEANUP_VERSION = "v1";\n',
        "card preview constants",
    )
    text = replace_once(text, "function cardPreviewResult(key) {\n", MAIN_HELPERS + "function cardPreviewResult(key) {\n", "cache helpers")
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
        "cache path validation",
    )
    text = replace_once(
        text,
        '    PYTHONDONTWRITEBYTECODE: "1",\n',
        '    PYTHONDONTWRITEBYTECODE: "1",\n    GROK_CHAMELEON_CARD_PREVIEW_CACHE_DIR: verifiedCurrentCardPreviewCacheDir(),\n',
        "server cache environment",
    )
    text = replace_once(
        text,
        "  shutdownServerNow(false);\n  app.exit(0);\n",
        '  shutdownServerNow(false);\n  clearCurrentCardPreviewCache("shutdown");\n  app.exit(0);\n',
        "normal exit cleanup",
    )
    boot_variants = (
        "    installMediaPermissionGuards();\n    installMenu();\n    await startServer();\n    void pruneCardPreviewCacheAtStartup();\n    createMainWindow();\n",
        "    installMediaPermissionGuards();\n    installMenu();\n    await startServer();\n    createMainWindow();\n",
    )
    matches = [variant for variant in boot_variants if text.count(variant) == 1]
    if len(matches) != 1:
        raise RuntimeError(f"startup cleanup: expected one known boot variant, found {len(matches)}")
    text = text.replace(
        matches[0],
        '    installMediaPermissionGuards();\n    installMenu();\n    clearCurrentCardPreviewCache("startup");\n'
        "    await startServer();\n    await cleanupLegacyCardPreviewCacheOnce();\n    createMainWindow();\n",
        1,
    )
    text = replace_once(
        text,
        'app.on("will-quit", () => {\n  if (!appTerminating) shutdownServerNow();\n});\n',
        'app.on("will-quit", () => {\n  clearCurrentCardPreviewCache("will-quit");\n  if (!appTerminating) shutdownServerNow();\n});\n',
        "will-quit cleanup",
    )
    missing = [marker for marker in MAIN_REQUIRED if marker not in text]
    if missing:
        raise RuntimeError(f"main.js cache lifecycle markers missing: {missing}")
    path.write_text(text, encoding="utf-8", newline="\n")
    return text != original


def patch_server(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    if all(marker in text for marker in SERVER_REQUIRED):
        return False
    text = replace_once(text, '    (root / "cache" / "card-previews").mkdir(parents=True, exist_ok=True)\n', "", "legacy directory creation")
    text = replace_once(
        text,
        'def card_preview_cache_dir(root: Path | None = None) -> Path | None:\n    root = root or library_root()\n    return root / "cache" / "card-previews" if root else None\n',
        SERVER_CACHE_BLOCK,
        "server cache directory",
    )
    source_route_start = text.find('            if parsed.path == "/api/card-preview/source-info":\n')
    preview_route_start = text.find('            if parsed.path == "/api/card-preview":\n', source_route_start)
    if source_route_start < 0 or preview_route_start < 0:
        raise RuntimeError("card preview route block was not found")
    existing_routes = text[source_route_start:preview_route_start]
    if existing_routes.count('/api/card-preview/source-info') != 1 or existing_routes.count('/api/card-preview/cache-info') != 1:
        raise RuntimeError("unexpected card preview route block")
    text = text[:source_route_start] + SERVER_ROUTES + text[preview_route_start:]
    if '(root / "cache" / "card-previews").mkdir' in text:
        raise RuntimeError("library cache creation remains")
    missing = [marker for marker in SERVER_REQUIRED if marker not in text]
    if missing:
        raise RuntimeError(f"server.py cache lifecycle markers missing: {missing}")
    path.write_text(text, encoding="utf-8", newline="\n")
    return text != original


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("main_js", type=Path)
    parser.add_argument("server_py", type=Path)
    args = parser.parse_args()
    if args.main_js.name != "main.js" or args.server_py.name != "server.py":
        raise RuntimeError("Expected main.js followed by server.py.")
    changed_main = patch_main(args.main_js)
    changed_server = patch_server(args.server_py)
    print(f"CARD_PREVIEW_CACHE_LIFECYCLE_{'PATCHED' if changed_main or changed_server else 'ALREADY_PATCHED'}")


if __name__ == "__main__":
    main()
