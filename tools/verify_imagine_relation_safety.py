#!/usr/bin/env python3
"""Verify persisted Imagine relations are portable, private, crisp, and hideable."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path


def load_server(path: Path):
    runtime_dir = str(path.parent.resolve())
    if runtime_dir not in sys.path:
        sys.path.insert(0, runtime_dir)
    spec = importlib.util.spec_from_file_location("grok_chameleon_release_server", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load bundled server module.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("server_py", type=Path)
    args = parser.parse_args()
    if args.server_py.name != "server.py":
        raise RuntimeError("Expected server.py.")
    server = load_server(args.server_py.resolve())
    source_id = "11111111-1111-4111-8111-111111111111"
    child_id = "22222222-2222-4222-8222-222222222222"
    full_url = f"https://assets.grok.com/generated/{child_id}/image.jpg"
    preview_url = f"https://assets.grok.com/generated/{child_id}/preview_image.jpg"
    with tempfile.TemporaryDirectory(prefix="grok-relation-verify-") as raw_root:
        root = Path(raw_root)
        server.write_json(root / "library.json", server.default_library_json())
        server.imagine_persist_generated_relation(
            root,
            f"imagine_saved/{source_id}",
            source_id,
            [{
                "item_id": child_id,
                "type": "image",
                "url": full_url,
                "remote_url": full_url,
                "thumbnail_url": preview_url,
                "account_email": "private@example.invalid",
                "metadata": {
                    "remote_url": full_url,
                    "thumbnail_url": preview_url,
                    "cookie": "cookie-secret",
                    "token": "token-secret",
                    "data_url": "data:image/jpeg;base64,secret",
                    "imagine": {"post_id": child_id, "media_url": full_url},
                },
            }],
            "i2i",
            "release-verification",
        )
        stored_text = (root / "library.json").read_text(encoding="utf-8")
        for forbidden in ("private@example.invalid", "cookie-secret", "token-secret", "data:image"):
            if forbidden in stored_text:
                raise RuntimeError(f"Private relation value persisted: {forbidden}")
        post = {
            "post_id": source_id,
            "items": [{"item_id": source_id, "type": "image", "url": "https://assets.grok.com/source/image.jpg"}],
            "metadata": {},
        }
        account = {"id": "portable-account-id", "email": "private@example.invalid"}
        restored = server.imagine_apply_generated_relations(dict(post), root, account)
        restored_child = next((item for item in restored["items"] if item.get("item_id") == child_id), None)
        if not restored_child:
            raise RuntimeError("Generated child relation was not restored.")
        if restored_child.get("thumbnail_url") != restored_child.get("object_url"):
            raise RuntimeError("Restored image card does not use the full image preview.")
        library = json.loads(stored_text)
        library["settings"]["hidden_imagine_item_keys"] = [child_id]
        server.write_json(root / "library.json", library)
        hidden = server.imagine_apply_generated_relations(dict(post), root, account)
        if any(item.get("item_id") == child_id for item in hidden["items"]):
            raise RuntimeError("Hidden generated relation was restored.")
    print("IMAGINE_RELATION_SAFETY_OK")


if __name__ == "__main__":
    main()
