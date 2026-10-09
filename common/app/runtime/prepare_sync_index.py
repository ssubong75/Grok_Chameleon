"""Prepare portable card indexes while the sync engine has paused the server.

Do not call scan_library(): it also rewrites library.json/account registries after
the sync engine has verified those files. Only rebuild the derived local tables;
account-scoped Imagine/Discover rows in the same database remain untouched.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def prepare(root, server):
    root = Path(root).resolve()
    if root == Path(root.anchor) or not (root / "library.json").is_file():
        raise ValueError("A valid library folder is required")
    collections = server.scan_collection_folders(root)
    posts = [
        *server.scan_created_area(root, "created"),
        *server.scan_created_area(root, "upload"),
        *server.scan_created_area(root, server.REFERENCE_DIRECTORY),
        *[post for collection in collections for post in collection.get("posts", [])],
    ]
    server.library_index.rebuild(
        root, server.normalize_json_unicode(posts),
        server.normalize_json_unicode(collections),
        updated_at=server.now_iso(),
    )
    if not server.library_index.ready(root):
        raise RuntimeError("Library index preparation did not complete")
    return len(posts)


def main():
    import server

    roots = list(dict.fromkeys(str(Path(value).resolve()) for value in sys.argv[1:]))
    if not roots:
        raise ValueError("Library folders are required")
    counts = [prepare(root, server) for root in roots]
    print(json.dumps({"prepared": len(counts), "posts": counts}))


if __name__ == "__main__":
    main()
