"""Exercise destructive merge only in a disposable library with a full runtime."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
app = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="grok-merge-library-") as temporary:
    sandbox = Path(temporary).resolve()
    runtime = sandbox / "runtime"
    runtime.mkdir()
    library = sandbox / "library"
    (runtime / "settings.json").write_text(json.dumps({"library_root": str(library)}))
    os.environ.update(
        GROK_CHAMELEON_RUNTIME_DIR=str(runtime),
        GROK_CHAMELEON_PORTABLE_ROOT=str(sandbox),
        GROK_CHAMELEON_LIBRARY_POINTER_PATH=str(sandbox / ".library_path.json"),
        GROK_CHAMELEON_PLATFORM_KEY="macos", GROK_CHAMELEON_NO_BROWSER="1",
    )
    spec = importlib.util.spec_from_file_location("merge_smoke", app / "runtime/server.py")
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    server.LEGACY_SETTINGS_PATH = sandbox / "no-legacy.json"
    server.set_library_root(str(library))
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=")

    def make_card(name, suffix):
        folder = library / "created" / name
        folder.mkdir(parents=True)
        data = png + suffix.encode()
        (folder / "image-01.png").write_bytes(data)
        server.write_json(folder / "post.json", {
            "post_id": name, "source": "build", "items": [{
                "item_id": "image-01", "file": "image-01.png", "type": "image",
                "prompt": name, "parent_item_id": "image-01",
            }],
        })
        server.refresh_library_index_paths(library, ["created/" + name])
        return folder, data

    cards = [make_card("card-" + str(i), str(i)) for i in range(3)]
    # This fourth image is deliberately absent from both the index and metadata.
    (cards[0][0] / "late.png").write_bytes(png + b"late")
    result = server.merge_selected_posts({"post_paths": ["created/" + p.name for p, _ in cards]})
    target = library / result["selected_path"]
    post = server.get_library_post({"path": result["selected_path"]})["post"]
    assert len(post["items"]) == 4
    assert len({i["item_id"] for i in post["items"]}) == 4
    assert { (target / i["file"]).read_bytes() for i in post["items"] } == {d for _, d in cards} | {png + b"late"}
    for item in post["items"]:
        if item.get("parent_item_id"):
            assert item["parent_item_id"] == item["item_id"]
    assert all(not p.exists() for p, _ in cards)

    # Simulate a broken copy: originals must survive the failed transaction.
    originals = [make_card("failure-" + str(i), str(i)) for i in range(2)]
    copy_item = server.copy_media_item_to_directory
    def corrupt_copy(source, item, destination):
        copied = copy_item(source, item, destination)
        (destination / copied["file"]).write_bytes(b"corrupt")
        return copied
    server.copy_media_item_to_directory = corrupt_copy
    try:
        server.merge_selected_posts({"post_paths": ["created/" + p.name for p, _ in originals]})
    except RuntimeError as error:
        assert "verification failed" in str(error)
    else:
        raise AssertionError("Corrupt copy was accepted")
    assert all((p / "image-01.png").read_bytes() == d for p, d in originals)
    print("PASS: three colliding IDs/files retained, fresh disk scan, unique IDs, relationships, copy failure preserves originals")
