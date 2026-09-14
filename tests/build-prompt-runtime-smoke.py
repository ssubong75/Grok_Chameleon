"""Verify prompt edits with the complete app runtime and an isolated library."""
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
with tempfile.TemporaryDirectory(prefix="grok-build-prompt-") as temporary:
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
    folder = library / "created" / "test-card"
    folder.mkdir(parents=True)
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=")
    (folder / "image.png").write_bytes(png)
    metadata = {
        "post_id": "test-card", "source": "build", "title": "Keep title",
        "prompt": "Card fallback", "build_favorite": True,
        "extra_metadata": {"keep": [1, 2, 3]},
        "items": [
            {"item_id": "image", "type": "image", "file": "image.png", "prompt": "Old image", "metadata": {"keep": "image"}},
            {"item_id": "video", "type": "video", "url": "https://example.invalid/video.mp4", "prompt": "Old video", "source_item_id": "image"},
        ],
    }
    server.write_json(folder / "post.json", metadata)
    server.refresh_library_index_paths(library, ["created/test-card"])
    # Use a second local image for a genuine multi-item folder scan.
    (folder / "second.png").write_bytes(png)
    metadata["items"].append({"item_id": "second", "type": "image", "file": "second.png", "prompt": "Keep second"})
    # Late disk changes must survive even when the index has an older snapshot.
    metadata["late_field"] = "preserved"
    server.write_json(folder / "post.json", metadata)
    route = server.POST_JSON_ROUTES["/api/library/update-item-prompt"]
    text = unicodedata.normalize("NFD", "수정된 이미지\n두 번째 줄")
    response = route({"post_path": "created/test-card", "item_id": "image", "text": text})
    saved = server.read_json(folder / "post.json")
    expected = copy.deepcopy(metadata)
    expected["items"][0]["prompt"] = unicodedata.normalize("NFC", text)
    saved.pop("updated_at")
    saved["items"][0].pop("updated_at")
    assert saved == expected, "Only the selected prompt and modification times may change"
    assert (folder / "image.png").read_bytes() == png
    assert "selected_path" not in response and "selected_item_id" not in response
    loaded = server.get_library_post({"path": "created/test-card"})["post"]
    assert next(i for i in loaded["items"] if i["item_id"] == "image")["prompt"] == expected["items"][0]["prompt"]
    assert next(i for i in loaded["items"] if i["item_id"] == "second")["prompt"] == "Keep second"

    # Remote-file metadata is supported on local cards as well as disk images.
    video_folder = library / "created" / "video-card"
    video_folder.mkdir()
    video_meta = {"post_id": "video-card", "source": "build", "items": [metadata["items"][1]]}
    server.write_json(video_folder / "post.json", video_meta)
    route({"post_path": "created/video-card", "item_id": "video", "text": "New video prompt"})
    assert server.get_library_post({"path": "created/video-card"})["post"]["items"][0]["prompt"] == "New video prompt"

    before = (folder / "post.json").read_bytes()
    for payload in [
        {"post_path": "created/test-card", "item_id": "image", "text": "  "},
        {"post_path": "created/test-card", "item_id": "missing", "text": "Wrong target"},
        {"post_path": "../outside", "item_id": "image", "text": "Outside"},
        {"post_path": "__pending/job", "item_id": "image", "text": "Pending"},
    ]:
        try:
            route(payload)
        except (RuntimeError, ValueError):
            pass
        else:
            raise AssertionError(f"Invalid edit accepted: {payload}")
        assert (folder / "post.json").read_bytes() == before

    video_meta["source"] = "imagine"
    server.write_json(video_folder / "post.json", video_meta)
    try:
        route({"post_path": "created/video-card", "item_id": "video", "text": "Wrong provider"})
    except RuntimeError:
        pass
    else:
        raise AssertionError("Imagine edit accepted")
    assert server.read_json(video_folder / "post.json") == video_meta
    print("PASS: image/video persistence, NFC, multiline text, metadata preservation, index refresh, invalid targets, provider boundary")
