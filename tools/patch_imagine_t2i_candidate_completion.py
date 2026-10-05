#!/usr/bin/env python3
"""Recover T2I candidates that exist even when only one websocket completion arrives."""

from __future__ import annotations

import argparse
from pathlib import Path


OLD_STATE = '''    completed_grace_deadline = 0.0
    last_completed_count = 0
    completion_order: list[str] = []
'''

NEW_STATE = '''    completed_grace_deadline = 0.0
    candidate_recovery_attempts = 0
    last_completed_count = 0
    completion_order: list[str] = []
'''

OLD_IDLE = '''            if not readable:
                if completed_grace_deadline and time.monotonic() >= completed_grace_deadline:
                    break
                continue
'''

NEW_IDLE = '''            if not readable:
                if completed_grace_deadline and time.monotonic() >= completed_grace_deadline:
                    recovered_ids: list[str] = []
                    for pending in candidates.values():
                        if pending.get("completed") or pending.get("moderated"):
                            continue
                        if imagine_remote_media_available(str(pending.get("url") or ""), account, kind="image", timeout=3):
                            pending["completed"] = True
                            pending_id = str(pending.get("post_id") or "")
                            if pending_id and pending_id not in completion_order:
                                completion_order.append(pending_id)
                            if pending_id:
                                recovered_ids.append(pending_id)
                    completed_count = sum(1 for item in candidates.values() if item.get("completed"))
                    if recovered_ids:
                        imagine_debug_event("t2i_candidates_url_recovered", {
                            "request_id": request_id,
                            "recovered_ids": recovered_ids,
                            "completed_count": completed_count,
                            "candidate_count": len(candidates),
                            "expected_count": count,
                        })
                    if completed_count >= count:
                        break
                    candidate_recovery_attempts += 1
                    if candidate_recovery_attempts >= 2 and completed_count > 0:
                        break
                    completed_grace_deadline = time.monotonic() + 1.5
                continue
'''

OLD_GRACE = '''                if completed_count >= count and completed_count != last_completed_count:
                    completed_grace_deadline = time.monotonic() + 2.5
                    last_completed_count = completed_count
'''

NEW_GRACE = '''                if completed_count >= count and completed_count != last_completed_count:
                    completed_grace_deadline = time.monotonic() + 2.5
                    last_completed_count = completed_count
                elif completed_count > 0 and len(candidates) >= count and not completed_grace_deadline:
                    completed_grace_deadline = time.monotonic() + 1.25
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if new_count == 1:
        return text
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    raise RuntimeError(f"Unexpected {label} counts old={old_count} new={new_count}.")


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    text = replace_once(text, OLD_STATE, NEW_STATE, "T2I recovery state")
    text = replace_once(text, OLD_IDLE, NEW_IDLE, "T2I idle recovery")
    text = replace_once(text, OLD_GRACE, NEW_GRACE, "T2I recovery grace")
    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"IMAGINE_T2I_CANDIDATE_COMPLETION_PATCHED {path}")
        return True
    print(f"IMAGINE_T2I_CANDIDATE_COMPLETION_ALREADY_PATCHED {path}")
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
