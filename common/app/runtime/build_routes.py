#!/usr/bin/env python3
from __future__ import annotations

from collections.abc import Callable


JsonHandler = Callable[[dict], dict]


def build_post_routes(
    *,
    start_build_job: JsonHandler,
    get_build_job: Callable[[str], dict],
    cancel_build_job: JsonHandler,
    dismiss_build_job: JsonHandler,
    set_build_favorite: JsonHandler,
    analyze_image: JsonHandler,
    build_generate: JsonHandler,
) -> dict[str, JsonHandler]:
    return {
        "/api/build/start": lambda payload: {"ok": True, "job": start_build_job(payload)},
        "/api/build/job": lambda payload: {"ok": True, "job": get_build_job(str(payload.get("id") or ""))},
        "/api/build/cancel": cancel_build_job,
        "/api/build/dismiss": dismiss_build_job,
        "/api/build/favorite": set_build_favorite,
        "/api/analyze": analyze_image,
        "/api/build/generate": build_generate,
    }
