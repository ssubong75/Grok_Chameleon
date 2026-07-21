#!/usr/bin/env python3
"""Use the full generated image for restored relation cards instead of a soft preview image."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD = '''        "thumbnail_url": imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else (
            imagine_saved_proxy_url(raw_url, "image", account_id_value) if kind == "image" else ""
        ),
'''

NEW = '''        "thumbnail_url": (
            imagine_saved_proxy_url(raw_url, "image", account_id_value)
            if kind == "image"
            else (imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else "")
        ),
'''


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    old_count = text.count(OLD)
    new_count = text.count(NEW)
    if new_count == 1:
        pass
    elif old_count == 1 and new_count == 0:
        text = text.replace(OLD, NEW, 1)
    else:
        raise RuntimeError(f"Unexpected full-image preview counts old={old_count} new={new_count}.")
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_RELATION_FULL_IMAGE_PREVIEW_PATCHED {path}")
        return True
    print(f"IMAGINE_RELATION_FULL_IMAGE_PREVIEW_ALREADY_PATCHED {path}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("server_py", type=Path)
    args = parser.parse_args()
    if args.server_py.name != "server.py":
        raise RuntimeError("Expected server.py.")
    patch_file(args.server_py)


if __name__ == "__main__":
    main()
