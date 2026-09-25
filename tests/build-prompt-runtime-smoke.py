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
    # A legacy Imagine card already moved into Collection is a Build card. A newly
    # dropped disk image must be editable even though it is absent from post.json.
    collection = library / "collection" / "test-category"
    legacy = collection / "legacy-imagine"
    legacy.mkdir(parents=True)
    legacy_meta = {
        "post_id": "legacy", "source": "imagine", "mode": "saved",
        "original_post_id": "original-imagine-id", "account_id": "original-account",
        "custom_history": {"keep": True}, "items": [],
    }
    server.write_json(legacy / "post.json", legacy_meta)
    (legacy / "dropped.png").write_bytes(png)
    server.refresh_library_index_paths(library, ["collection/test-category/legacy-imagine"])
    legacy_post = server.get_library_post({"path": "collection/test-category/legacy-imagine"})["post"]
    assert legacy_post["source"] == "build"
    assert legacy_post["origin_source"] == "imagine"
    dropped = next(i for i in legacy_post["items"] if i["file"] == "dropped.png")
    route({"post_path": legacy_post["folder_path"], "item_id": server.media_item_key(dropped), "text": "Edited dropped image"})
    repaired = server.read_json(legacy / "post.json")
    assert repaired["source"] == "build" and repaired["origin_source"] == "imagine"
    assert repaired["original_post_id"] == legacy_meta["original_post_id"]
    assert repaired["account_id"] == legacy_meta["account_id"]
    assert repaired["custom_history"] == legacy_meta["custom_history"]
    assert repaired["items"][0]["prompt"] == "Edited dropped image"
    assert (legacy / "dropped.png").read_bytes() == png

    # Both whole-card and single-item moves use the shared serializer, which must
    # classify the destination as Build while retaining Imagine provenance.
    server.refresh_library_index_paths(library, ["created/video-card"])
    moved = server.move_post_to_collection({
        "post_path": "created/video-card", "collection_path": "collection/test-category",
    })
    moved_meta = server.read_json(library / moved["selected_path"] / "post.json")
    assert moved_meta["source"] == "build" and moved_meta["origin_source"] == "imagine"
    assert moved_meta["items"][0]["prompt"] == video_meta["items"][0]["prompt"]
    source = {"source": "imagine", "post_id": "remote", "items": [], "account_id": "original-account"}
    copied = server.post_json_from_post(source, folder_path="collection/test-category/remote", source="build", origin_source="imagine")
    assert copied["source"] == "build" and copied["origin_source"] == "imagine"
    assert copied["account_id"] == "original-account"
    assert server.post_json_from_post(source, folder_path="created/unmoved")["source"] == "imagine"
    # Exercise remote Imagine -> Collection without network or real accounts.
    remote = {**source, "items": [{"item_id": "remote-image", "type": "image", "url": "https://example.invalid/image.png"}]}
    server.remote_imagine_payload_post = lambda payload: remote
    server.active_imagine_account = lambda *args: {"id": "test-account"}
    def copy_remote(root, item, destination, account, index):
        (destination / "image.png").write_bytes(png)
        return {"item_id": item["item_id"], "type": "image", "file": "image.png"}
    server.copy_imagine_remote_item_to_directory = copy_remote
    for item_only in (False, True):
        remote["post_id"] = "remote-single" if item_only else "remote-whole"
        remote["items"][0]["item_id"] = remote["post_id"] + "-image"
        response = server.copy_imagine_remote_post_to_collection({
            "collection_path": "collection/test-category", "item_key": remote["items"][0]["item_id"],
        }, item_only=item_only)
        copied_meta = server.read_json(library / response["selected_path"] / "post.json")
        assert copied_meta["source"] == "build" and copied_meta["origin_source"] == "imagine"
        assert copied_meta["source_post_id"] == remote["post_id"]
    print("PASS: legacy collection classification, dropped-image MOD, provenance preservation, Imagine-to-Collection move")
    print("PASS: image/video persistence, NFC, multiline text, metadata preservation, index refresh, invalid targets, provider boundary")
