"""Verify disk refresh with the complete app runtime and an isolated library."""
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unicodedata

app = Path(sys.argv[1]).resolve()
sys.dont_write_bytecode = True
with tempfile.TemporaryDirectory(prefix="grok-disk-refresh-") as temporary:
    sandbox = Path(temporary).resolve()
    runtime = sandbox / "runtime"
    runtime.mkdir()
    library = sandbox / "library"
    (runtime / "settings.json").write_text(json.dumps({"library_root": str(library)}))
    os.environ.update(
        GROK_CHAMELEON_RUNTIME_DIR=str(runtime),
        GROK_CHAMELEON_PORTABLE_ROOT=str(sandbox),
        GROK_CHAMELEON_LIBRARY_POINTER_PATH=str(sandbox / ".library_path.json"),
        GROK_CHAMELEON_PLATFORM_KEY="macos",
        GROK_CHAMELEON_NO_BROWSER="1",
    )
    spec = importlib.util.spec_from_file_location("build_prompt_smoke", app / "runtime/server.py")
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    server.LEGACY_SETTINGS_PATH = sandbox / "no-legacy.json"
    server.set_library_root(str(library))
    folder = library / "collection" / "category" / "card"
    folder.mkdir(parents=True)
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=")
    (folder / "image.png").write_bytes(png)
    metadata = {"source": "build", "title": "Original", "prompt": "Keep prompt", "items": [{"item_id": "image", "file": "image.png", "type": "image"}]}
    server.write_json(folder / "post.json", metadata)
    server.scan_library(library)
    rel = "collection/category/card"
    assert len(server.get_library_post({"path": rel})["post"]["items"]) == 1
    (folder / "added.mp4").write_bytes(b"temporary media placeholder")
    assert len(server.get_library_post({"path": rel})["post"]["items"]) == 1
    refreshed = server.get_library_post({"path": rel, "refresh_from_disk": True})["post"]
    assert {item["file"] for item in refreshed["items"]} == {"image.png", "added.mp4"}
    assert len(server.get_library_post({"path": rel})["post"]["items"]) == 2
    assert server.read_json(folder / "post.json") == metadata
    assert (folder / "added.mp4").read_bytes() == b"temporary media placeholder"
    (folder / "added.mp4").unlink()
    refreshed = server.get_library_post({"path": rel, "refresh_from_disk": True})["post"]
    assert [item["file"] for item in refreshed["items"]] == ["image.png"]
    for bad in ["../outside", "__pending/job", "collection/missing"]:
        try:
            server.get_library_post({"path": bad, "refresh_from_disk": True})
        except (RuntimeError, ValueError):
            pass
        else:
            raise AssertionError(bad)
    print("PASS: stale index reproduced; targeted refresh discovers added video, persists index, handles removed file, preserves metadata/media, rejects invalid paths")
