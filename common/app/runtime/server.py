#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import html
import json
import mimetypes
import os
import queue
import re
import secrets
import select
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import uuid
import urllib.error
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

RUNTIME_ROOT = Path(__file__).resolve().parent
APP_ROOT = RUNTIME_ROOT.parent
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))
VENDOR_PYTHON = APP_ROOT / "vendor" / "python"
if VENDOR_PYTHON.exists():
    sys.path.insert(0, str(VENDOR_PYTHON))

try:
    from build_routes import build_post_routes
    import imagine_accounts
    from imagine_routes import imagine_post_routes
except ImportError:
    from runtime.build_routes import build_post_routes
    from runtime import imagine_accounts
    from runtime.imagine_routes import imagine_post_routes

try:
    from curl_cffi import requests as curl_requests
    from curl_cffi import CurlMime
except Exception:
    curl_requests = None
    CurlMime = None


WEB_ROOT = APP_ROOT / "web"
LIBRARY_FOLDERS = ("created", "upload", "collection", "prompt", "account")
IMAGE_EXTS = {"avif", "gif", "jpeg", "jpg", "png", "webp"}
VIDEO_EXTS = {"m4v", "mov", "mp4", "webm"}
THUMB_EXTS = ("jpg", "jpeg", "png", "webp")
XAI_API_BASE = "https://api.x.ai/v1"
DEFAULT_VIDEO_MODEL = "grok-imagine-video"
DEFAULT_IMAGE_TO_VIDEO_MODEL = "grok-imagine-video-1.5"
DEFAULT_ANALYZE_MODEL = "grok-4.3"
ANALYZE_MODELS = {"grok-4.3", "grok-4.20-0309-non-reasoning"}

# GENERATION_WAIT_POLICY: Build/Imagine image and video wait values are kept here for quick tuning.
BUILD_IMAGE_REQUEST_TIMEOUT_SECONDS = 20
BUILD_T2I_MAX_CONCURRENT_REQUESTS = 5
BUILD_VIDEO_START_SIGNAL_WAIT_SECONDS = 14
BUILD_VIDEO_START_SIGNAL_PROGRESS_LIMIT = 1
BUILD_VIDEO_GENERATE_MAX_WAIT_SECONDS = 125
BUILD_VIDEO_LONG_MAX_WAIT_SECONDS = 180
BUILD_VIDEO_EXTEND_MAX_WAIT_SECONDS = 125
BUILD_VIDEO_TERMINAL_RECHECK_SECONDS = 15
BUILD_VIDEO_TERMINAL_RECHECK_POLL_SECONDS = 3
BUILD_VIDEO_NO_CANDIDATE_MODERATION_LIMIT = 5
BUILD_VIDEO_DISPLAY_MAX_PROGRESS = 98
BUILD_VIDEO_DISPLAY_BASE_DURATION_SECONDS = 15
BUILD_VIDEO_DISPLAY_SECONDS_BY_RESOLUTION = {
    "480p": 50,
    "720p": 95,
    "1080p": 160,
}
BUILD_VIDEO_DISPLAY_DEFAULT_RESOLUTION = "720p"
BUILD_VIDEO_AFTER_90_TERMINAL_GRACE_SECONDS = 15
BUILD_VIDEO_INITIAL_DISPLAY_PROGRESS = 12
BUILD_VIDEO_MAIN_DISPLAY_PROGRESS = 90
BUILD_VIDEO_INITIAL_DISPLAY_RATIO = 0.10
BUILD_VIDEO_MAIN_DISPLAY_RATIO = 0.85
BUILD_VIDEO_PROGRESS_SMOOTH_TICKS = 6
IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS = 6
IMAGINE_DIRECT_VIDEO_FIRST_SIGNAL_SECONDS = 14
IMAGINE_DIRECT_I2I_MAX_WAIT_SECONDS = 14
IMAGINE_DIRECT_T2I_DISPLAY_SECONDS = 8
IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS = 99
IMAGINE_DIRECT_I2I_DISPLAY_SECONDS = 12
IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS = 99
IMAGINE_DIRECT_I2V_DISPLAY_SECONDS = 20
IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS = 99
IMAGINE_DIRECT_LONG_I2V_DISPLAY_SECONDS = 140
IMAGINE_DIRECT_LONG_I2V_ABSOLUTE_MAX_WAIT_SECONDS = 170
IMAGINE_DIRECT_LONG_I2V_CANDIDATE_GRACE_SECONDS = 30
IMAGINE_DIRECT_HIGH_SHORT_I2V_DISPLAY_SECONDS = 110
IMAGINE_DIRECT_HIGH_SHORT_I2V_MAX_WAIT_SECONDS = 137
IMAGINE_DIRECT_HIGH_SHORT_I2V_CANDIDATE_GRACE_SECONDS = 20
IMAGINE_DIRECT_MID_I2V_DISPLAY_SECONDS = 83
IMAGINE_DIRECT_MID_I2V_MAX_WAIT_SECONDS = 99
IMAGINE_DIRECT_MID_I2V_CANDIDATE_GRACE_SECONDS = 20
IMAGINE_DIRECT_LOW_I2V_DISPLAY_SECONDS = 63
IMAGINE_DIRECT_LOW_I2V_MAX_WAIT_SECONDS = 80
IMAGINE_DIRECT_LOW_I2V_CANDIDATE_GRACE_SECONDS = 10
IMAGINE_DIRECT_EXTEND_CANDIDATE_GRACE_SECONDS = 60
IMAGINE_DIRECT_VIDEO_ABSOLUTE_GRACE_SECONDS = 15
IMAGINE_DIRECT_VIDEO_DISPLAY_SECONDS = 40
IMAGINE_DIRECT_EXTEND_DISPLAY_SECONDS = 60
IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS = 99
IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS = 99
IMAGINE_DIRECT_IMAGE_MAX_WAIT_SECONDS = 30
IMAGINE_DIRECT_VIDEO_MAX_WAIT_SECONDS = 80
IMAGINE_DIRECT_EXTEND_MAX_WAIT_SECONDS = 80
IMAGINE_DIRECT_VIDEO_TERMINAL_RECHECK_SECONDS = 3
IMAGINE_DIRECT_EXTEND_TERMINAL_RECHECK_SECONDS = 3
IMAGINE_DIRECT_VIDEO_CANDIDATE_MAX_WAIT_SECONDS = 5
IMAGINE_DIRECT_VIDEO_NO_CANDIDATE_MAX_WAIT_SECONDS = 10
IMAGINE_DIRECT_EXTEND_CANDIDATE_MAX_WAIT_SECONDS = 10
IMAGINE_DIRECT_VIDEO_TERMINAL_POLL_SECONDS = 3
IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS = 10
IMAGINE_DIRECT_LONG_I2V_CANDIDATE_STABILIZE_SECONDS = 30
IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS = 45

IMAGINE_SAVED_MEDIA_KEYS_CACHE: dict[str, tuple[float, set[str]]] = {}
IMAGINE_SAVED_MEDIA_KEYS_CACHE_LOCK = threading.Lock()

BUILD_VIDEO_TERMINAL_STATUSES = {"failed", "expired", "cancelled", "canceled"}
IMAGE_ASPECT_RATIOS = {"auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20"}
VIDEO_ASPECT_RATIOS = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}
IMAGE_RESOLUTIONS = {"1k", "2k"}
VIDEO_RESOLUTIONS = {"480p", "720p", "1080p"}
ACCOUNT_TIERS = {"free", "super", "heavy"}
IMAGINE_BASE = "https://grok.com"
IMAGINE_ASSETS_BASE = "https://assets.grok.com"
IMAGINE_WS_URL = "wss://grok.com/ws/imagine/listen"
USAGE_URL = os.environ.get("GROK_STUDIO_USAGE_URL", IMAGINE_BASE + "/?_s=usage")
IMAGINE_DEBUG_PORT = int(os.environ.get("GROK_STUDIO_IMAGINE_DEBUG_PORT", "9223"))
AUTH_REFRESH_SKEW = timedelta(minutes=5)
XAI_OAUTH_AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize"
XAI_OAUTH_TOKEN_URL = "https://auth.x.ai/oauth2/token"
XAI_OAUTH_USERINFO_URL = "https://auth.x.ai/oauth2/userinfo"
XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
XAI_OAUTH_SCOPES = "openid profile email offline_access grok-cli:access api:access"
XAI_OAUTH_REDIRECT_PATH = "/callback"
XAI_OAUTH_REDIRECT_PORT = 56121


def app_support_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Grok Chameleon"
    if os.name == "nt":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Grok Chameleon"
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "grok-chameleon"


SETTINGS_PATH = app_support_dir() / "settings.json"
IMAGINE_PROFILE_DIR = app_support_dir() / "imagine_chrome_profile"
IMAGINE_BRIDGE_BASE_PORT = int(os.environ.get("GROK_STUDIO_IMAGINE_BRIDGE_BASE_PORT", "9230"))
IMAGINE_BRIDGE_PORT_SPAN = 1000
IMAGINE_BRIDGE_READY_WAIT_SECONDS = 20
IMAGINE_BRIDGE_LOGIN_WAIT_SECONDS = 180
IMAGINE_BRIDGE_LOGIN_SAVE_DELAY_SECONDS = 2
IMAGINE_DEBUG_LOG_PATH = Path.home() / "Library" / "Logs" / "Grok Chameleon" / "imagine_debug.jsonl"
SHUTDOWN_TIMER: threading.Timer | None = None
SHUTDOWN_LOCK = threading.Lock()
BUILD_JOBS: dict[str, dict] = {}
BUILD_JOB_LOCK = threading.Lock()
BUILD_T2I_FILE_LOCK = threading.Lock()
IMAGINE_JOBS: dict[str, dict] = {}
IMAGINE_JOB_LOCK = threading.Lock()
NATIVE_BRIDGE_COMMANDS: list[dict] = []
NATIVE_BRIDGE_RESULTS: dict[str, dict] = {}
NATIVE_BRIDGE_ACTIVE_IDS: set[str] = set()
NATIVE_BRIDGE_ASYNC_IDS: set[str] = set()
NATIVE_BRIDGE_LOCK = threading.Lock()
NATIVE_BRIDGE_CONDITION = threading.Condition(NATIVE_BRIDGE_LOCK)
NATIVE_BRIDGE_LAST_POLL_AT = 0.0
IMAGINE_VIDEO_TERMINAL_STATUSES = {"failed", "expired", "cancelled", "canceled"}
IMAGINE_DEBUG_RAW_PROGRESS_THRESHOLD = 90
IMAGINE_DEBUG_LAST_EVENT_COUNT = 5


class JobCancelled(RuntimeError):
    pass


class XaiApiError(RuntimeError):
    def __init__(self, status_code: int, detail):
        self.status_code = int(status_code)
        self.detail = detail
        super().__init__(f"xAI API error {self.status_code}: {xai_error_text(detail)}")


def remaining_seconds_until(deadline: float | None, fallback_seconds: int) -> int:
    if deadline is None:
        return max(0, int(fallback_seconds))
    remaining = deadline - time.time()
    return max(0, int(remaining + 0.999))


def remaining_monotonic_seconds_until(deadline: float | None, fallback_seconds: int) -> int:
    if deadline is None:
        return max(0, int(fallback_seconds))
    remaining = deadline - time.monotonic()
    return max(0, int(remaining + 0.999))


def elapsed_display_progress(started_at: float | None, deadline: float | None, start_progress: int = 1, end_progress: int = 98) -> int:
    start = max(1, min(99, int(start_progress)))
    end = max(start, min(99, int(end_progress)))
    if started_at is None or deadline is None or deadline <= started_at:
        return start
    ratio = max(0.0, min(1.0, (time.time() - started_at) / (deadline - started_at)))
    return max(start, min(end, int(start + ((end - start) * ratio))))


def numeric_percentage(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return max(0, min(100, int(value)))
    try:
        return max(0, min(100, int(float(str(value).strip()))))
    except (TypeError, ValueError):
        return None


def display_generation_progress(value=None, fallback=None, end_progress: int = 98) -> int:
    progress = numeric_percentage(value)
    if progress is None:
        progress = numeric_percentage(fallback)
    if progress is None:
        return 1
    end = max(1, min(99, int(end_progress)))
    if progress >= 100:
        return end
    return max(1, min(end, progress))


def monotonic_job_progress(previous, value, status: str) -> int:
    status_text = str(status or "").lower()
    progress = numeric_percentage(value)
    previous_progress = numeric_percentage(previous)
    if progress is None:
        progress = 0
    if previous_progress is None:
        previous_progress = 0
    if status_text == "done":
        return 100
    if status_text in {"cancelled", "canceled"}:
        return 0
    if status_text in {"", "queued", "running"}:
        return max(max(1, min(98, progress)), max(1, min(98, previous_progress)))
    if status_text in {"failed", "moderated"}:
        return max(1, min(99, max(progress, previous_progress)))
    return max(0, min(100, progress))


def sleep_with_optional_cancel(seconds: float, cancel_checker=None) -> None:
    end_time = time.time() + max(0.0, float(seconds))
    while time.time() < end_time:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")
        time.sleep(min(0.25, max(0.0, end_time - time.time())))


def cancel_scheduled_shutdown() -> None:
    global SHUTDOWN_TIMER
    with SHUTDOWN_LOCK:
        if SHUTDOWN_TIMER:
            SHUTDOWN_TIMER.cancel()
            SHUTDOWN_TIMER = None


def server_shutdown_is_scheduled() -> bool:
    with SHUTDOWN_LOCK:
        return SHUTDOWN_TIMER is not None


def cancel_scheduled_shutdown_for_request(path: str, method: str) -> None:
    if not server_shutdown_is_scheduled():
        return
    if method in {"GET", "HEAD"}:
        return
    if path in {"/api/browser/closing", "/api/shutdown"}:
        return
    cancel_scheduled_shutdown()


def schedule_server_shutdown(server: ThreadingHTTPServer, delay: float = 2.0) -> None:
    global SHUTDOWN_TIMER
    with SHUTDOWN_LOCK:
        if SHUTDOWN_TIMER:
            SHUTDOWN_TIMER.cancel()
        SHUTDOWN_TIMER = threading.Timer(delay, server.shutdown)
        SHUTDOWN_TIMER.daemon = True
        SHUTDOWN_TIMER.start()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def log_event(message: str) -> None:
    print(f"[{now_iso()}] {message}", flush=True)


def app_log_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Logs" / "Grok Chameleon"
    return app_support_dir() / "logs"


def build_video_debug_event(event: str, payload: dict | None = None) -> None:
    try:
        path = app_log_dir() / "build_video_debug.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "time": now_iso(),
            "event": str(event or ""),
            **(payload or {}),
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    except Exception:
        pass


def read_json(path: Path, fallback=None):
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text) if text.strip() else fallback
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_settings() -> dict:
    data = read_json(SETTINGS_PATH, {})
    return data if isinstance(data, dict) else {}


def write_settings(settings: dict) -> None:
    write_json(SETTINGS_PATH, settings)


def library_root() -> Path | None:
    raw = str(read_settings().get("library_root") or "").strip()
    if not raw:
        return None
    root = Path(raw).expanduser()
    return root if root.exists() or root.parent.exists() else None


def set_library_root(path_text: str) -> Path:
    root = Path(path_text).expanduser().resolve()
    ensure_library_root(root)
    settings = read_settings()
    settings["library_root"] = str(root)
    settings["updated_at"] = now_iso()
    write_settings(settings)
    return root


def safe_name(name: str, fallback: str = "item") -> str:
    cleaned = "".join("-" if char in '/:\\*?"<>|\x00' else char for char in str(name or "")).strip()
    return cleaned or fallback


def file_stem(name: str) -> str:
    return Path(str(name or "")).stem


def claim_unique_media_item_id(preferred: str, used_ids: set[str]) -> str:
    base = str(preferred or "item").strip() or "item"
    candidate = base
    suffix = 2
    while candidate.casefold() in used_ids:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used_ids.add(candidate.casefold())
    return candidate


def extension_for(name: str) -> str:
    return Path(str(name or "")).suffix.lower().lstrip(".")


def media_type_for_name(name: str) -> str:
    ext = extension_for(name)
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return ""


def readable_name(name: str) -> str:
    return file_stem(str(name)).replace("_", " ").replace("-", " ").strip() or str(name)


def safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def sorted_entries(path: Path) -> list[Path]:
    try:
        return sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
    except OSError:
        return []


def default_library_json() -> dict:
    return {
        "version": 1,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "settings": {
            "collection_order": [],
            "collection_sort": {},
            "hidden_upload_keys": [],
            "hidden_imagine_item_keys": [],
            "imagine_upload_asset_cache": {},
            "imagine_generated_relations": {},
        },
        "posts": [],
        "collections": [],
        "prompts": [],
    }


def merge_library_json(data) -> dict:
    base = default_library_json()
    if isinstance(data, dict):
        base.update(data)
    base.setdefault("posts", [])
    base.setdefault("collections", [])
    base.setdefault("prompts", [])
    settings = base.get("settings")
    if not isinstance(settings, dict):
        settings = {}
    settings.setdefault("collection_order", [])
    settings.setdefault("collection_sort", {})
    settings.setdefault("hidden_upload_keys", [])
    settings.setdefault("hidden_imagine_item_keys", [])
    settings.setdefault("imagine_upload_asset_cache", {})
    settings.setdefault("imagine_generated_relations", {})
    base["settings"] = settings
    return base


def default_build_auth() -> dict:
    return {"version": 1, "provider": "build", "active_id": "", "accounts": []}


def default_imagine_auth() -> dict:
    return {"version": 1, "provider": "imagine", "active_id": "", "accounts": []}


def normalize_account_tier(value) -> str:
    tier = str(value or "").strip().lower()
    return tier if tier in ACCOUNT_TIERS else "free"


def text_from_usage_body(body: str, content_type: str = "") -> str:
    if "json" in str(content_type or "").lower():
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = None
        if parsed is not None:
            body = json.dumps(parsed, ensure_ascii=False)
    body = re.sub(r"<script\b[^>]*>(.*?)</script>", r" \1 ", body, flags=re.IGNORECASE | re.DOTALL)
    body = re.sub(r"<style\b[^>]*>.*?</style>", " ", body, flags=re.IGNORECASE | re.DOTALL)
    body = re.sub(r"<[^>]+>", " ", body)
    return re.sub(r"\s+", " ", html.unescape(body)).strip()


def unescape_usage_tier_text(value: str) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match.group(1), 16)), text)
    text = re.sub(r"\\x([0-9a-fA-F]{2})", lambda match: chr(int(match.group(1), 16)), text)
    return (
        text.replace("\\/", "/")
        .replace('\\"', '"')
        .replace("\\'", "'")
        .replace("\\n", " ")
        .replace("\\r", " ")
        .replace("\\t", " ")
    )


def parse_usage_tier_text(text: str) -> str:
    normalized = re.sub(r"\s+", " ", unescape_usage_tier_text(text)).strip().lower()
    compact = re.sub(r"\s+", "", normalized)
    if (
        re.search(r'"issupergrokprouser"\s*:\s*true', normalized)
        or re.search(r'"bestsubscription"\s*:\s*"subscription_tier_super_grok_pro"', normalized)
        or re.search(r'"activesubscriptions"\s*:\s*\[[^\]]{0,4000}"tier"\s*:\s*"subscription_tier_super_grok_pro"', normalized)
        or "supergrokheavy" in compact
    ):
        return "heavy"
    if (
        re.search(r'"issupergrokuser"\s*:\s*true', normalized)
        or re.search(r'"bestsubscription"\s*:\s*"subscription_tier_grok_pro"', normalized)
        or re.search(r'"activesubscriptions"\s*:\s*\[[^\]]{0,4000}"tier"\s*:\s*"subscription_tier_grok_pro"', normalized)
        or "freecreditswithsupergrok" in compact
        or "supergrok포함무료크레딧" in compact
    ):
        return "super"
    return "free"


def account_id(prefix: str, key: str) -> str:
    raw = str(key or uuid.uuid4().hex).strip().lower()
    stable = uuid.uuid5(uuid.NAMESPACE_URL, f"grok-chameleon:{prefix}:{raw}").hex
    return f"{prefix}_{stable[:24]}"


def find_email_in_value(value, depth: int = 0) -> str:
    if depth > 6 or value is None:
        return ""
    if isinstance(value, str):
        import re
        match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", value)
        return match.group(0) if match else ""
    if isinstance(value, list):
        for item in value:
            found = find_email_in_value(item, depth + 1)
            if found:
                return found
        return ""
    if isinstance(value, dict):
        for key, item in value.items():
            if "email" in str(key).lower() and isinstance(item, str) and "@" in item:
                return item
        for item in value.values():
            found = find_email_in_value(item, depth + 1)
            if found:
                return found
    return ""


def imagine_debug_compact_url(value) -> dict:
    text = imagine_unwrap_remote_proxy(str(value or "").strip())
    if not text:
        return {}
    parsed = urlparse(text)
    return {
        "host": parsed.netloc,
        "path": parsed.path[-120:],
        "id": extract_imagine_post_id_from_text(text),
    }


def imagine_debug_safe(value, depth: int = 0):
    if depth > 8:
        return "..."
    if isinstance(value, dict):
        out = {}
        for key, child in value.items():
            key_text = str(key or "")
            low = key_text.lower()
            if any(token in low for token in ("cookie", "token", "authorization", "sso", "secret")):
                continue
            if key_text in {"message", "prompt", "originalPrompt"} and isinstance(child, str):
                out[key_text] = {"len": len(child), "head": child[:80]}
                continue
            if isinstance(child, str) and (child.startswith("http://") or child.startswith("https://") or "/api/imagine/remote/media" in child):
                out[key_text] = imagine_debug_compact_url(child)
                continue
            out[key_text] = imagine_debug_safe(child, depth + 1)
        return out
    if isinstance(value, list):
        return [imagine_debug_safe(item, depth + 1) for item in value[:20]]
    if isinstance(value, str):
        if value.startswith("data:"):
            return {"data_url": True, "len": len(value)}
        if len(value) > 240:
            return {"len": len(value), "head": value[:120]}
    return value


def imagine_debug_event(event: str, payload: dict | None = None) -> None:
    try:
        IMAGINE_DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "at": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **(imagine_debug_safe(payload or {}) if isinstance(payload, dict) else {}),
        }
        with IMAGINE_DEBUG_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        pass


def imagine_debug_event_excerpt(value) -> dict | list | str | int | float | bool | None:
    safe = imagine_debug_safe(value)
    try:
        text = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return {"repr": repr(value)[:2000]}
    if len(text) <= 6000:
        return safe
    return {
        "json_len": len(text),
        "head": text[:3200],
        "tail": text[-1800:],
    }


def imagine_debug_event_tail(events: list, count: int = IMAGINE_DEBUG_LAST_EVENT_COUNT) -> list:
    return [imagine_debug_event_excerpt(event) for event in events[-max(1, int(count)):]]


def imagine_json_string_value(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text[0] not in "{[":
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, (dict, list)) else None


def imagine_debug_attachment_summary(payload: dict) -> list[dict]:
    attachments = payload.get("attachments") if isinstance(payload.get("attachments"), list) else []
    rows = []
    for index, attachment in enumerate(attachments[:12]):
        if not isinstance(attachment, dict):
            continue
        rows.append({
            "index": index,
            "name": attachment.get("name") or "",
            "type": attachment.get("type") or "",
            "role": attachment.get("role") or "",
            "detail_auto": bool(attachment.get("detail_auto")),
            "has_data_url": bool(str(attachment.get("data_url") or "").startswith("data:")),
            "post_id": extract_imagine_post_id_from_text(attachment.get("post_id")),
            "item_id": extract_imagine_post_id_from_text(attachment.get("item_id")) or str(attachment.get("item_id") or "")[:80],
            "detail_item_id": extract_imagine_post_id_from_text(attachment.get("detail_item_id")) or str(attachment.get("detail_item_id") or "")[:80],
            "parent_post_id": extract_imagine_post_id_from_text(attachment.get("parent_post_id")),
            "original_post_id": extract_imagine_post_id_from_text(attachment.get("original_post_id")),
            "root_post_id": extract_imagine_post_id_from_text(attachment.get("root_post_id")),
            "conversation_id": str(attachment.get("conversation_id") or "")[:80],
            "response_id": str(attachment.get("response_id") or attachment.get("parent_response_id") or "")[:80],
            "raw_url": imagine_debug_compact_url(attachment.get("raw_url")),
            "source_url": imagine_debug_compact_url(attachment.get("source_url")),
            "remote_url": imagine_debug_compact_url(attachment.get("remote_url")),
            "aspect_ratio": attachment.get("aspect_ratio") or attachment.get("aspectRatio") or "",
            "video_duration": attachment.get("video_duration") or attachment.get("duration") or "",
        })
    return rows


def auth_candidates(raw) -> list[dict]:
    candidates = []
    if isinstance(raw, dict):
        if isinstance(raw.get("key"), str):
            candidates.append(raw)
        for value in raw.values():
            if isinstance(value, dict) and isinstance(value.get("key"), str):
                candidates.append(value)
    return candidates


def auth_candidate_is_invalid(item: dict) -> bool:
    if not isinstance(item, dict):
        return True
    error = str(item.get("oauth_error") or "").strip().lower()
    return bool(item.get("oauth_invalid") or item.get("requires_login") or error == "invalid_grant")


def valid_auth_candidates(candidates: list[dict]) -> list[dict]:
    return [item for item in candidates if isinstance(item, dict) and not auth_candidate_is_invalid(item)]


def parse_iso_time(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def token_needs_refresh(item: dict, force: bool = False) -> bool:
    if force:
        return True
    expires = parse_iso_time(item.get("expires_at") if isinstance(item, dict) else "")
    return expires is not None and expires <= datetime.now(timezone.utc) + AUTH_REFRESH_SKEW


def choose_auth_candidate(candidates: list[dict], force_refresh: bool = False) -> dict:
    valid = valid_auth_candidates(candidates)
    pool = valid or candidates
    usable = [item for item in pool if not token_needs_refresh(item, force_refresh)]
    return usable[0] if usable else pool[0]


def oauth_refresh_error_is_invalid_grant(status_code: int, detail_text: str) -> bool:
    if int(status_code or 0) != 400:
        return False
    text = str(detail_text or "")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = {}
    if isinstance(parsed, dict):
        error = str(parsed.get("error") or "").strip().lower()
        description = str(parsed.get("error_description") or "").strip().lower()
        if error == "invalid_grant" or "refresh token has been revoked" in description:
            return True
    lowered = text.lower()
    return "invalid_grant" in lowered or "refresh token has been revoked" in lowered


def b64url_no_padding(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def oauth_pkce_pair() -> tuple[str, str]:
    verifier = b64url_no_padding(secrets.token_bytes(32))
    challenge = b64url_no_padding(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


class OAuthCallbackHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != XAI_OAUTH_REDIRECT_PATH:
            self.send_response(HTTPStatus.NOT_FOUND)
            self.end_headers()
            return
        params = parse_qs(parsed.query, keep_blank_values=True)
        self.server.oauth_result = {
            "code": str(params.get("code", [""])[0] or ""),
            "state": str(params.get("state", [""])[0] or ""),
            "error": str(params.get("error", [""])[0] or ""),
            "error_description": str(params.get("error_description", [""])[0] or ""),
        }
        ok = bool(self.server.oauth_result.get("code"))
        message = "Sign-in complete. You can close this window." if ok else "Sign-in failed. Return to the app and try again."
        body = (
            "<!doctype html><meta charset='utf-8'>"
            "<body style='margin:0;background:#08090a;color:#f5f7f8;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;min-height:100vh'>"
            f"<main style='text-align:center'><h2>{html.escape(message)}</h2></main>"
            "</body>"
        ).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_oauth_callback_server() -> tuple[ThreadingHTTPServer, int]:
    last_error = None
    for port in (XAI_OAUTH_REDIRECT_PORT, 0):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), OAuthCallbackHandler)
            server.oauth_result = None
            return server, int(server.server_address[1])
        except OSError as exc:
            last_error = exc
    raise RuntimeError(f"Could not start OAuth callback server: {last_error}")


def wait_oauth_callback(server: ThreadingHTTPServer, timeout_seconds: int = 300) -> dict:
    server.timeout = 1
    deadline = time.monotonic() + max(1, timeout_seconds)
    while time.monotonic() < deadline:
        server.handle_request()
        result = getattr(server, "oauth_result", None)
        if isinstance(result, dict):
            return result
    raise RuntimeError("Timed out waiting for xAI account authorization.")


def build_oauth_authorize_url(redirect_uri: str, challenge: str, state: str, nonce: str) -> str:
    return XAI_OAUTH_AUTHORIZE_URL + "?" + urlencode({
        "response_type": "code",
        "client_id": XAI_OAUTH_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": XAI_OAUTH_SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "nonce": nonce,
        "plan": "generic",
        "referrer": "grok-chameleon-desktop",
    })


def exchange_oauth_code(code: str, redirect_uri: str, verifier: str) -> dict:
    form = urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": XAI_OAUTH_CLIENT_ID,
        "code_verifier": verifier,
    }).encode("utf-8")
    request = urllib.request.Request(
        XAI_OAUTH_TOKEN_URL,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"xAI OAuth token exchange failed HTTP {exc.code}: {detail[:500]}") from exc
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"xAI OAuth token exchange returned non-JSON response: {body[:500]}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
        raise RuntimeError("xAI OAuth token exchange did not return an access token.")
    return data


def fetch_oauth_userinfo(access_token: str) -> dict:
    request = urllib.request.Request(
        XAI_OAUTH_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
    except Exception:
        return {}
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def oauth_expires_at(tokens: dict) -> str:
    expires_in = tokens.get("expires_in") if isinstance(tokens, dict) else None
    if not isinstance(expires_in, (int, float)):
        return ""
    seconds = max(0, float(expires_in) - 60)
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def build_auth_from_oauth(tokens: dict, userinfo: dict, email_hint: str = "") -> dict:
    access_token = str(tokens.get("access_token") or "")
    refresh_token = str(tokens.get("refresh_token") or "")
    email = str(find_email_in_value(userinfo) or find_email_in_value(tokens) or email_hint or "").strip()
    item = {
        "key": access_token,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": str(tokens.get("token_type") or "Bearer"),
        "scope": str(tokens.get("scope") or XAI_OAUTH_SCOPES),
        "expires_at": oauth_expires_at(tokens),
        "oidc_client_id": XAI_OAUTH_CLIENT_ID,
        "oidc_issuer": "https://auth.x.ai",
        "email": email,
    }
    if isinstance(tokens.get("id_token"), str):
        item["id_token"] = tokens["id_token"]
    return {
        "oauth": item,
        "account": userinfo if isinstance(userinfo, dict) else {},
    }


def discover_oidc_token_endpoint(issuer: str) -> str:
    request = urllib.request.Request(
        issuer.rstrip("/") + "/.well-known/openid-configuration",
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OAuth discovery failed: {exc}") from exc
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"OAuth discovery returned non-JSON response: {body[:500]}") from exc
    endpoint = data.get("token_endpoint") if isinstance(data, dict) else ""
    if not isinstance(endpoint, str) or not endpoint:
        raise RuntimeError("OAuth discovery did not include a token endpoint.")
    return endpoint


def build_account_status(expires_at: str) -> str:
    if not expires_at:
        return "ok"
    expires = parse_iso_time(expires_at)
    if expires is None:
        return "unknown"
    return "ok" if expires > datetime.now(timezone.utc) else "expired"


def normalize_build_account(account) -> dict:
    auth = account.get("auth") if isinstance(account, dict) and isinstance(account.get("auth"), dict) else {}
    email = str((account or {}).get("email") or find_email_in_value(auth) or "").strip()
    source_name = str((account or {}).get("source_name") or "").strip()
    key = email or source_name or str((account or {}).get("id") or "")
    expires_at = str((account or {}).get("expires_at") or "").strip()
    status = str((account or {}).get("status") or "").strip()
    if status not in {"login_required", "oauth_error"}:
        status = build_account_status(expires_at)
    return {
        "id": str((account or {}).get("id") or account_id("build", key)),
        "provider": "build",
        "label": str((account or {}).get("label") or email or "Build"),
        "email": email,
        "tier": normalize_account_tier((account or {}).get("tier")),
        "source_name": source_name,
        "registered_at": str((account or {}).get("registered_at") or now_iso()),
        "expires_at": expires_at,
        "status": status,
        "oauth_error": str((account or {}).get("oauth_error") or ""),
        "oauth_error_at": str((account or {}).get("oauth_error_at") or ""),
        "auth": auth,
    }


def build_account_from_auth(raw, source_name: str = "", label: str = "") -> dict:
    candidates = auth_candidates(raw)
    chosen = candidates[0] if candidates else {}
    email = str(chosen.get("email") or find_email_in_value(raw) or "").strip()
    account = {
        "id": account_id("build", email or source_name or label),
        "provider": "build",
        "label": label or email or readable_name(source_name or "Build"),
        "email": email,
        "tier": "free",
        "source_name": source_name,
        "registered_at": now_iso(),
        "expires_at": str(chosen.get("expires_at") or ""),
        "auth": raw if isinstance(raw, dict) else {},
    }
    return normalize_build_account(account)


def normalize_imagine_cookies(cookies) -> list[dict]:
    return imagine_accounts.normalize_imagine_cookies(cookies)


def valid_imagine_cookies(account) -> list[dict]:
    return imagine_accounts.valid_imagine_cookies(account)


def normalize_imagine_account(account) -> dict:
    return imagine_accounts.normalize_imagine_account(account)


def normalize_build_auth(data) -> dict:
    raw_accounts = data.get("accounts") if isinstance(data, dict) and isinstance(data.get("accounts"), list) else []
    accounts = [normalize_build_account(item) for item in raw_accounts if isinstance(item, dict)]
    active_id = str(data.get("active_id") or "") if isinstance(data, dict) else ""
    if active_id and not any(account["id"] == active_id for account in accounts):
        active_id = ""
    return {
        "version": 1,
        "provider": "build",
        "active_id": active_id or (accounts[0]["id"] if accounts else ""),
        "accounts": accounts,
        "updated_at": str((data or {}).get("updated_at") or now_iso()) if isinstance(data, dict) else now_iso(),
    }


def normalize_imagine_auth(data) -> dict:
    raw_accounts = data.get("accounts") if isinstance(data, dict) and isinstance(data.get("accounts"), list) else []
    accounts = [normalize_imagine_account(item) for item in raw_accounts if isinstance(item, dict)]
    active_id = str(data.get("active_id") or "") if isinstance(data, dict) else ""
    if active_id and not any(account["id"] == active_id for account in accounts):
        active_id = ""
    return {
        "version": 1,
        "provider": "imagine",
        "active_id": active_id,
        "accounts": accounts,
        "updated_at": str((data or {}).get("updated_at") or now_iso()) if isinstance(data, dict) else now_iso(),
    }


def ensure_library_root(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    for folder in LIBRARY_FOLDERS:
        (root / folder).mkdir(parents=True, exist_ok=True)
    library_path = root / "library.json"
    if not library_path.exists():
        write_json(library_path, default_library_json())
    account_dir = root / "account"
    build_path = account_dir / "build_auth.json"
    imagine_path = account_dir / "imagine_auth.json"
    if not build_path.exists():
        write_json(build_path, default_build_auth())
    if not imagine_path.exists():
        write_json(imagine_path, default_imagine_auth())


def account_files(root: Path) -> dict:
    ensure_library_root(root)
    build = read_json(root / "account" / "build_auth.json", default_build_auth())
    imagine = read_json(root / "account" / "imagine_auth.json", default_imagine_auth())
    return {
        "build": normalize_build_auth(build if isinstance(build, dict) else default_build_auth()),
        "imagine": normalize_imagine_auth(imagine if isinstance(imagine, dict) else default_imagine_auth()),
    }


def active_imagine_account(root: Path | None = None, account_id_value: str = "") -> dict:
    root = root or library_root()
    if not root:
        return {}
    imagine = account_files(root)["imagine"]
    accounts = [account for account in imagine.get("accounts") or [] if isinstance(account, dict)]
    wanted = str(account_id_value or imagine.get("active_id") or "")
    if wanted:
        match = next((account for account in accounts if str(account.get("id") or "") == wanted), None)
        if match:
            return match
    return accounts[0] if accounts else {}


def write_build_auth(root: Path, data: dict) -> None:
    normalized = normalize_build_auth(data)
    normalized["updated_at"] = now_iso()
    write_json(root / "account" / "build_auth.json", normalized)


def write_imagine_auth(root: Path, data: dict) -> None:
    normalized = normalize_imagine_auth(data)
    normalized["updated_at"] = now_iso()
    write_json(root / "account" / "imagine_auth.json", normalized)


def upsert_account(accounts: list[dict], account: dict) -> list[dict]:
    key = account.get("id")
    email = str(account.get("email") or "").lower()
    kept = [
        item for item in accounts
        if item.get("id") != key and (not email or str(item.get("email") or "").lower() != email)
    ]
    return [account, *kept]


def matching_account_tier(accounts: list[dict], account: dict) -> str:
    key = str(account.get("id") or "")
    email = str(account.get("email") or "").lower()
    for item in accounts:
        if not isinstance(item, dict):
            continue
        same_id = key and str(item.get("id") or "") == key
        same_email = email and str(item.get("email") or "").lower() == email
        if same_id or same_email:
            return normalize_account_tier(item.get("tier"))
    return ""


def reorder_accounts_by_ids(accounts: list[dict], ids: list[str]) -> list[dict]:
    ordered_ids = [str(value) for value in ids if str(value)]
    by_id = {str(account.get("id") or ""): account for account in accounts}
    seen = set()
    ordered = []
    for account_id_value in ordered_ids:
        account = by_id.get(account_id_value)
        if account and account_id_value not in seen:
            ordered.append(account)
            seen.add(account_id_value)
    ordered.extend(account for account in accounts if str(account.get("id") or "") not in seen)
    return ordered


def register_build_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    label = str(payload.get("label") or "").strip()
    auth_file = str(payload.get("auth_file") or "").strip()
    raw_auth = payload.get("auth") if isinstance(payload.get("auth"), dict) else None
    source_name = str(payload.get("source_name") or "").strip()
    if raw_auth is None:
        path_text = auth_file or os.environ.get("GROK_CHAMELEON_BUILD_AUTH") or "~/.grok/auth.json"
        path = Path(path_text).expanduser()
        if not path.is_file():
            raise RuntimeError(f"Auth file not found: {path}")
        raw_auth = read_json(path, None)
        if not isinstance(raw_auth, dict):
            raise RuntimeError(f"Auth file is not valid JSON: {path}")
        source_name = source_name or path.name
    account = build_account_from_auth(raw_auth, source_name or "build_auth.json", label)
    if label and "@" in label and account.get("email") and label.lower() != str(account["email"]).lower():
        raise RuntimeError(f"Auth file belongs to {account['email']}, not {label}.")
    build = account_files(root)["build"]
    previous_tier = matching_account_tier(build.get("accounts") or [], account)
    if previous_tier:
        account["tier"] = previous_tier
    build["accounts"] = upsert_account(build.get("accounts") or [], account)
    build["active_id"] = account["id"]
    tier_result = fetch_build_usage_tier_for_account(root, build, account)
    if tier_result.get("ok"):
        account["tier"] = normalize_account_tier(tier_result.get("tier"))
        account["tier_checked_at"] = now_iso()
        log_event(f"Build usage tier {account['tier']} for {account.get('email') or account.get('label') or account.get('id')}: {tier_result.get('message') or ''}")
    elif previous_tier:
        account["tier"] = previous_tier
        log_event(f"Build usage tier kept {previous_tier} for {account.get('email') or account.get('label') or account.get('id')}: {tier_result.get('message') or ''}")
    write_build_auth(root, build)
    return scan_library(root)


def register_total_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    session_id = uuid.uuid4().hex
    profile_dir = total_account_profile_dir(root, session_id)
    debug_port = available_loopback_port()
    target: dict | None = None
    callback_server: ThreadingHTTPServer | None = None
    log_event(f"total_account_start session={session_id} debug_port={debug_port}")
    try:
        launch_total_account_browser(IMAGINE_BASE + "/imagine", profile_dir, debug_port)
        target = wait_total_account_imagine_login(debug_port)
        cookies = capture_total_account_cookies(target)
        identity = fetch_imagine_identity(cookies)
        imagine_email = str(identity.get("email") or "").strip()

        verifier, challenge = oauth_pkce_pair()
        state = secrets.token_hex(16)
        nonce = secrets.token_hex(16)
        callback_server, callback_port = start_oauth_callback_server()
        redirect_uri = f"http://127.0.0.1:{callback_port}{XAI_OAUTH_REDIRECT_PATH}"
        oauth_url = build_oauth_authorize_url(redirect_uri, challenge, state, nonce)
        navigate_cdp_target(target, oauth_url)
        callback_result = wait_oauth_callback(callback_server, timeout_seconds=300)
        if callback_result.get("error"):
            raise RuntimeError(callback_result.get("error_description") or callback_result.get("error") or "xAI authorization failed.")
        if callback_result.get("state") != state:
            raise RuntimeError("xAI authorization state mismatch.")
        code = str(callback_result.get("code") or "")
        if not code:
            raise RuntimeError("xAI authorization did not return a code.")
        tokens = exchange_oauth_code(code, redirect_uri, verifier)
        userinfo = fetch_oauth_userinfo(str(tokens.get("access_token") or ""))
        build_email = str(find_email_in_value(userinfo) or find_email_in_value(tokens) or "").strip()
        if imagine_email and build_email and imagine_email.lower() != build_email.lower():
            raise RuntimeError(f"Imagine account {imagine_email} and Build account {build_email} do not match.")
        email = build_email or imagine_email

        navigate_cdp_target(target, IMAGINE_BASE + "/imagine/saved")
        target = wait_total_account_imagine_login(debug_port, timeout_seconds=60)
        cookies = capture_total_account_cookies(target)
        identity = fetch_imagine_identity(cookies) or identity
        imagine_email = str(identity.get("email") or imagine_email).strip()
        if imagine_email and build_email and imagine_email.lower() != build_email.lower():
            raise RuntimeError(f"Imagine account {imagine_email} and Build account {build_email} do not match.")
        email = build_email or imagine_email

        imagine_account = normalize_imagine_account({
            "provider": "imagine",
            "captured_at": now_iso(),
            "source_url": str(target.get("url") or IMAGINE_BASE + "/imagine"),
            "cookies": cookies,
            **identity,
            "email": email or imagine_email,
            "label": email or identity.get("label") or imagine_email or "Imagine",
        })
        verify_imagine_saved_access(imagine_account)
        files = account_files(root)
        previous_imagine_tier = matching_account_tier(files["imagine"].get("accounts") or [], imagine_account)
        if previous_imagine_tier:
            imagine_account["tier"] = previous_imagine_tier
        apply_imagine_account_tier(imagine_account)
        files["imagine"]["accounts"] = upsert_account(files["imagine"].get("accounts") or [], imagine_account)
        files["imagine"]["active_id"] = imagine_account["id"]
        write_imagine_auth(root, files["imagine"])

        build_auth = build_auth_from_oauth(tokens, userinfo, email)
        build_account = build_account_from_auth(build_auth, "xai_oauth", email)
        previous_build_tier = matching_account_tier(files["build"].get("accounts") or [], build_account)
        if previous_build_tier:
            build_account["tier"] = previous_build_tier
        files["build"]["accounts"] = upsert_account(files["build"].get("accounts") or [], build_account)
        files["build"]["active_id"] = build_account["id"]
        tier_result = fetch_build_usage_tier_for_account(root, files["build"], build_account)
        if tier_result.get("ok"):
            build_account["tier"] = normalize_account_tier(tier_result.get("tier"))
            build_account["tier_checked_at"] = now_iso()
        elif previous_build_tier:
            build_account["tier"] = previous_build_tier
        write_build_auth(root, files["build"])

        data = scan_library(root)
        data["total_account"] = {
            "ok": True,
            "email": email,
            "imagine_id": imagine_account["id"],
            "build_id": build_account["id"],
        }
        log_event(f"total_account_done session={session_id} email={email or ''}")
        return data
    finally:
        if callback_server:
            try:
                callback_server.server_close()
            except Exception:
                pass
        close_cdp_browser(target)
        try:
            shutil.rmtree(profile_dir, ignore_errors=True)
        except Exception:
            pass


def select_build_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account_id_value = str(payload.get("id") or "")
    build = account_files(root)["build"]
    account = next((account for account in build.get("accounts") or [] if account.get("id") == account_id_value), None)
    if not account:
        raise RuntimeError("Build account not found.")
    build["active_id"] = account_id_value
    previous_tier = normalize_account_tier(account.get("tier"))
    tier_result = fetch_build_usage_tier_for_account(root, build, account)
    if tier_result.get("ok"):
        account["tier"] = normalize_account_tier(tier_result.get("tier"))
        account["tier_checked_at"] = now_iso()
        log_event(f"Build usage tier {account['tier']} for {account.get('email') or account.get('label') or account.get('id')}: {tier_result.get('message') or ''}")
    else:
        account["tier"] = previous_tier
        log_event(f"Build usage tier kept {previous_tier} for {account.get('email') or account.get('label') or account.get('id')}: {tier_result.get('message') or ''}")
    write_build_auth(root, build)
    return scan_library(root)


def delete_build_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account_id_value = str(payload.get("id") or "")
    build = account_files(root)["build"]
    accounts = [account for account in build.get("accounts") or [] if account.get("id") != account_id_value]
    if len(accounts) == len(build.get("accounts") or []):
        raise RuntimeError("Build account not found.")
    build["accounts"] = accounts
    if build.get("active_id") == account_id_value:
        build["active_id"] = accounts[0].get("id") if accounts else ""
    write_build_auth(root, build)
    return scan_library(root)


def update_account_tier(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    provider = str(payload.get("provider") or "build").strip().lower()
    account_id_value = str(payload.get("id") or "")
    tier = normalize_account_tier(payload.get("tier"))
    files = account_files(root)
    key = "imagine" if provider == "imagine" else "build"
    store = files[key]
    found = False
    for account in store.get("accounts") or []:
        if account.get("id") == account_id_value:
            account["tier"] = tier
            found = True
            break
    if not found:
        raise RuntimeError(f"{key.title()} account not found.")
    if key == "imagine":
        write_imagine_auth(root, store)
    else:
        write_build_auth(root, store)
    return scan_library(root)


def reorder_account_store(payload: dict, provider: str) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ids = payload.get("ids") if isinstance(payload.get("ids"), list) else []
    files = account_files(root)
    key = "imagine" if provider == "imagine" else "build"
    store = files[key]
    store["accounts"] = reorder_accounts_by_ids(store.get("accounts") or [], [str(value) for value in ids])
    if key == "imagine":
        write_imagine_auth(root, store)
    else:
        write_build_auth(root, store)
    return scan_library(root)


def cookie_header(cookies: list[dict]) -> str:
    return imagine_accounts.cookie_header(cookies)


def imagine_user_agent() -> str:
    return imagine_accounts.imagine_user_agent()


def imagine_statsig_id() -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    if secrets.randbelow(2):
        token = "".join(secrets.choice(alphabet) for _ in range(5))
        message = f"x1:TypeError: Cannot read properties of null (reading 'children[\\'{token}\\']')"
    else:
        token = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(10))
        message = f"x1:TypeError: Cannot read properties of undefined (reading '{token}')"
    return base64.b64encode(message.encode("utf-8")).decode("ascii")


def imagine_saved_headers(account: dict) -> dict[str, str]:
    cookies = valid_imagine_cookies(account)
    if not cookies:
        raise RuntimeError("Select or capture an Imagine account first.")
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Content-Type": "application/json",
        "Cookie": cookie_header(cookies),
        "Origin": IMAGINE_BASE,
        "Referer": IMAGINE_BASE + "/imagine/saved",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": imagine_user_agent(),
        "x-statsig-id": imagine_statsig_id(),
        "x-xai-request-id": str(uuid.uuid4()),
    }


def imagine_post_json(path: str, payload: dict, account: dict, timeout: int = 12, referer: str = "") -> dict:
    headers = imagine_saved_headers(account)
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(
        IMAGINE_BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read(4000).decode("utf-8", errors="replace")
        if "usage_pool_exhausted" in detail.lower() or "insufficient balance" in detail.lower():
            raise RuntimeError("Usage Limit Reached") from exc
        raise RuntimeError(f"Imagine HTTP {exc.code}: {detail[:1000]}") from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise RuntimeError(f"Imagine network error: {exc}") from exc
    try:
        return json.loads(body) if body.strip() else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Imagine returned non-JSON response: {body[:1000]}") from exc


def verify_imagine_saved_access(account: dict) -> None:
    try:
        imagine_get_json(
            "/rest/app-chat/conversations?" + urlencode({
                "pageSize": "1",
                "kind": "CONVERSATION_KIND_IMAGINE",
            }),
            account,
            timeout=12,
        )
    except RuntimeError as exc:
        message = str(exc)
        if "Imagine HTTP 401" in message or "not authorized" in message.lower():
            raise RuntimeError("Imagine login is not ready. Finish Grok login, then try Total Account again.") from exc
        raise


def imagine_get_json(path: str, account: dict, timeout: int = 12) -> dict:
    headers = imagine_saved_headers(account)
    headers.pop("Content-Type", None)
    request = urllib.request.Request(
        IMAGINE_BASE + path,
        headers=headers,
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read(4000).decode("utf-8", errors="replace")
        if "usage_pool_exhausted" in detail.lower() or "insufficient balance" in detail.lower():
            raise RuntimeError("Usage Limit Reached") from exc
        raise RuntimeError(f"Imagine HTTP {exc.code}: {detail[:1000]}") from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise RuntimeError(f"Imagine network error: {exc}") from exc
    try:
        return json.loads(body) if body.strip() else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Imagine returned non-JSON response: {body[:1000]}") from exc


def imagine_upload_file_direct(account: dict, file_name: str, mime_type: str, data: bytes, request_id: str, action: str) -> dict:
    if not data:
        raise RuntimeError("Imagine upload file is empty.")
    headers = imagine_saved_headers(account)
    headers.pop("Content-Type", None)
    headers["Referer"] = IMAGINE_BASE + "/imagine"
    url = IMAGINE_BASE + "/http/upload-file-v2/direct"
    imagine_debug_event("direct_local_upload_request", {
        "request_id": request_id,
        "action": action,
        "file_name": file_name,
        "mime_type": mime_type,
        "size": len(data),
        "transport": "curl_cffi" if curl_requests is not None else "urllib",
    })
    if curl_requests is not None and CurlMime is not None:
        try:
            multipart = CurlMime.from_list([{
                "name": "file",
                "filename": file_name,
                "content_type": mime_type,
                "data": data,
            }])
            with curl_requests.Session(impersonate="chrome", default_headers=False) as session:
                try:
                    response = session.post(
                        url,
                        headers=headers,
                        multipart=multipart,
                        timeout=30,
                    )
                finally:
                    multipart.close()
            body = response.text
            status = int(response.status_code)
            if status < 200 or status >= 300:
                if "usage_pool_exhausted" in str(body).lower() or "insufficient balance" in str(body).lower():
                    raise RuntimeError("Usage Limit Reached")
                raise RuntimeError(f"Imagine upload HTTP {status}: {body[:1000]}")
        except Exception as exc:
            raise RuntimeError(f"Imagine upload error: {exc}") from exc
    else:
        boundary = "----grok-studio-q-" + uuid.uuid4().hex
        body_bytes = b"".join([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'.encode("utf-8"),
            f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
            data,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ])
        request_headers = dict(headers)
        request_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        request = urllib.request.Request(url, data=body_bytes, headers=request_headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read(4000).decode("utf-8", errors="replace")
            if "usage_pool_exhausted" in detail.lower() or "insufficient balance" in detail.lower():
                raise RuntimeError("Usage Limit Reached") from exc
            raise RuntimeError(f"Imagine upload HTTP {exc.code}: {detail[:1000]}") from exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise RuntimeError(f"Imagine upload network error: {exc}") from exc
    try:
        result = json.loads(body) if str(body).strip() else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Imagine upload returned non-JSON response: {str(body)[:1000]}") from exc
    metadata = result.get("fileMetadata") if isinstance(result.get("fileMetadata"), dict) else {}
    file_id = str(metadata.get("fileMetadataId") or result.get("assetId") or "").strip()
    file_uri = str(metadata.get("fileUri") or "").strip()
    if not file_id or not file_uri:
        raise RuntimeError("Imagine upload response did not include file metadata.")
    imagine_debug_event("direct_local_upload_response", {
        "request_id": request_id,
        "action": action,
        "upload_id": result.get("uploadId") or "",
        "file_metadata_id": file_id,
        "file_uri": file_uri,
        "file_source": metadata.get("fileSource") or "",
    })
    return result


def imagine_direct_post_id_from_item(item: dict | None) -> str:
    if not isinstance(item, dict):
        return ""
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    for value in (
        item.get("item_id"),
        item.get("post_id"),
        imagine.get("post_id"),
        imagine.get("media_post_id"),
        metadata.get("post_id"),
        metadata.get("media_post_id"),
        item.get("remote_url"),
        item.get("url"),
    ):
        post_id = imagine_post_id_from_value(str(value or "")) or extract_imagine_post_id_from_text(value)
        if post_id:
            return post_id
    return ""


def imagine_saved_proxy_url(raw_url: str, kind: str = "", account_id_value: str = "") -> str:
    url = str(raw_url or "").strip()
    if not url:
        return ""
    params = {"url": url}
    if kind:
        params["kind"] = kind
    if account_id_value:
        params["account_id"] = account_id_value
    return f"/api/imagine/remote/media?{urlencode(params)}"


def imagine_asset_url(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"{IMAGINE_ASSETS_BASE}/{text.lstrip('/')}"


def imagine_text_value(value) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("text", "prompt", "message", "content", "caption", "title"):
            text = imagine_text_value(value.get(key))
            if text:
                return text
    return ""


def imagine_post_text(post: dict) -> str:
    for key in ("prompt", "originalPrompt", "message", "text", "caption", "title", "description"):
        text = imagine_text_value(post.get(key))
        if text:
            return text
    for key in ("query", "input", "metadata"):
        text = imagine_text_value(post.get(key))
        if text:
            return text
    return ""


def imagine_post_time(post: dict) -> str:
    for key in ("createTime", "createdAt", "created_at", "updateTime", "updatedAt", "timestamp"):
        value = post.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return now_iso()


def imagine_post_id(post: dict, fallback: str = "") -> str:
    for key in ("id", "postId", "post_id", "mediaPostId", "media_post_id"):
        value = post.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def generated_media_id_from_url(value: str) -> str:
    text = imagine_unwrap_remote_proxy(str(value or "").strip())
    if not text:
        return ""
    match = re.search(
        r"/generated/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:/|-part-)",
        urlparse(text).path,
    )
    return match.group(1) if match else ""


def imagine_media_identity_id_from_text(value) -> str:
    text = imagine_unwrap_remote_proxy(str(value or "").strip())
    if not text:
        return ""
    path = urlparse(text).path
    generated_id = generated_media_id_from_url(text)
    if generated_id:
        return generated_id
    uuid_pattern = IMAGINE_POST_ID_RE.pattern
    content_match = re.search(rf"/users/{uuid_pattern}/({uuid_pattern})(?:/|$)", path)
    if content_match:
        return content_match.group(1)
    return extract_imagine_post_id_from_text(text)


def imagine_media_node_post_id(node: dict, raw_url: str = "", fallback: str = "") -> str:
    for key in (
        "id",
        "postId",
        "post_id",
        "mediaPostId",
        "media_post_id",
        "imageId",
        "image_id",
        "assetId",
        "asset_id",
        "videoPostId",
        "video_post_id",
        "videoId",
        "video_id",
    ):
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return imagine_media_identity_id_from_text(raw_url) or fallback


def imagine_post_id_from_value(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    uuid_pattern = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    for pattern in (
        rf"/imagine/post/({uuid_pattern})",
        rf"^({uuid_pattern})$",
    ):
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return ""


def imagine_url_kind(key: str, url: str, node: dict) -> str:
    key_text = str(key or "").lower()
    mime = str(node.get("mimeType") or node.get("mime_type") or node.get("contentType") or node.get("content_type") or "").lower()
    media_type = str(node.get("mediaType") or node.get("media_type") or node.get("type") or node.get("kind") or "").lower()
    url_text = str(url or "").strip().lower()
    if url_text.startswith("data:image/"):
        return "image"
    if url_text.startswith("data:video/"):
        return "video"
    parsed = urlparse(str(url or ""))
    path = parsed.path
    ext = extension_for(path)
    mediaish_url = ext in IMAGE_EXTS | VIDEO_EXTS or any(
        token in f"{parsed.netloc.lower()}{path.lower()}"
        for token in ("media", "image", "video", "asset", "assets.grok", "grokusercontent")
    )
    if "video" in key_text or "video" in mime or "video" in media_type or ext in VIDEO_EXTS:
        return "video"
    if "image" in key_text or "photo" in key_text or "image" in mime or "image" in media_type or ext in IMAGE_EXTS:
        return "image"
    if ("media" in key_text or "asset" in key_text or "download" in key_text or "content" in key_text or "url" == key_text) and mediaish_url:
        return "image"
    return ""


def imagine_remote_media_key(key: str) -> bool:
    text = str(key or "").lower()
    if not text:
        return False
    if any(token in text for token in ("avatar", "profile", "icon", "blurhash")):
        return False
    if any(token in text for token in ("thumbnail", "thumb", "poster", "preview")):
        return False
    return any(token in text for token in ("url", "uri")) and any(
        token in text for token in ("media", "image", "video", "asset", "download", "content", "file", "url")
    )


def imagine_remote_thumbnail_key(key: str) -> bool:
    text = str(key or "").lower()
    return any(token in text for token in ("thumbnail", "thumb", "poster", "preview"))


def imagine_remote_url(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("data:image/") or text.startswith("data:video/"):
        return text
    if (text.startswith("users/") or text.startswith("/users/")) and (
        "/generated/" in text or "/content" in text or extension_for(text) in IMAGE_EXTS | VIDEO_EXTS
    ):
        return imagine_asset_url(text)
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"}:
        return ""
    return text


def imagine_node_thumbnail(node: dict) -> str:
    for key in (
        "thumbnailImageUrl",
        "lastFrameThumbnailImageUrl",
        "previewImageUrl",
        "posterUrl",
        "thumbnailUrl",
        "thumbnail_url",
        "poster_url",
    ):
        value = node.get(key)
        if isinstance(value, str):
            url = imagine_remote_url(value)
            if url:
                return url
    for key, value in node.items():
        if isinstance(value, str) and imagine_remote_thumbnail_key(key):
            url = imagine_remote_url(value)
            if url:
                return url
    return ""


def imagine_node_relation_id(node: dict, *keys: str) -> str:
    for key in keys:
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def imagine_node_media_type(node: dict, raw_url: str = "") -> str:
    media_type = str(node.get("mediaType") or node.get("media_type") or node.get("type") or node.get("kind") or "").upper()
    mime = str(node.get("mimeType") or node.get("mime_type") or node.get("contentType") or node.get("content_type") or "").lower()
    if "VIDEO" in media_type or mime.startswith("video/"):
        return "video"
    if "IMAGE" in media_type or mime.startswith("image/"):
        return "image"
    if raw_url:
        return imagine_url_kind("mediaUrl", raw_url, node)
    return ""


def imagine_node_primary_media_url(node: dict) -> str:
    for key in (
        "mediaUrl",
        "media_url",
        "mediaURL",
        "url",
        "assetUrl",
        "asset_url",
        "imageUrl",
        "image_url",
        "videoUrl",
        "video_url",
        "hdMediaUrl",
        "hd_media_url",
        "hd1080MediaUrl",
        "watermarkedMediaUrl",
    ):
        value = node.get(key)
        if isinstance(value, str):
            url = imagine_remote_url(value)
            if url and imagine_node_media_type(node, url) in {"image", "video"}:
                return url
    for key, value in node.items():
        if isinstance(value, str) and imagine_remote_media_key(key):
            url = imagine_remote_url(value)
            if url and imagine_url_kind(key, url, node) in {"image", "video"}:
                return url
    return ""


def imagine_node_resolution(node: dict) -> tuple[int, int]:
    for width_key, height_key in (("width", "height"), ("naturalWidth", "naturalHeight")):
        try:
            width = int(node.get(width_key) or 0)
            height = int(node.get(height_key) or 0)
        except (TypeError, ValueError):
            width = 0
            height = 0
        if width > 0 and height > 0:
            return width, height
    resolution = node.get("resolution")
    if isinstance(resolution, dict):
        try:
            width = int(resolution.get("width") or 0)
            height = int(resolution.get("height") or 0)
        except (TypeError, ValueError):
            width = 0
            height = 0
        if width > 0 and height > 0:
            return width, height
    return 0, 0


def collect_imagine_media_entries(root_post: dict) -> list[dict]:
    entries: list[dict] = []
    candidate_nodes: list[dict] = []
    seen_candidate_ids: set[str] = set()
    seen_entry_ids: set[str] = set()
    seen_urls: set[str] = set()
    root_id = imagine_post_id(root_post)
    root_prompt = imagine_post_text(root_post)

    def add_candidate(node: dict) -> None:
        if not isinstance(node, dict):
            return
        raw_url = imagine_node_primary_media_url(node)
        if not raw_url:
            return
        post_id = imagine_post_id(node, file_stem(Path(urlparse(raw_url).path).name) or uuid.uuid4().hex)
        key = post_id or raw_url
        if key in seen_candidate_ids:
            return
        seen_candidate_ids.add(key)
        candidate_nodes.append(node)

    add_candidate(root_post)
    for key in ("childPosts", "child_posts"):
        value = root_post.get(key)
        if isinstance(value, list):
            for child in value:
                add_candidate(child)
    for key in ("images", "videos"):
        value = root_post.get(key)
        if isinstance(value, list):
            for child in value:
                add_candidate(child)
    for node in list(candidate_nodes):
        original_post = node.get("originalPost")
        if isinstance(original_post, dict):
            add_candidate(original_post)

    source_ids = {
        imagine_node_relation_id(node, "originalPostId", "original_post_id", "parentPostId", "parent_post_id")
        for node in candidate_nodes
    }
    source_ids = {source_id for source_id in source_ids if source_id}

    def input_collection_key(key: str) -> bool:
        compact = re.sub(r"[^a-z0-9]", "", str(key or "").lower())
        return any(token in compact for token in (
            "inputmediaitems",
            "inputassets",
            "imagereferences",
            "imagereference",
            "referenceimages",
            "referenceimage",
            "fileattachments",
            "fileattachment",
            "attachments",
        ))

    def add_entry(node: dict, relation: str = "") -> None:
        if input_collection_key(relation):
            return
        raw_url = imagine_node_primary_media_url(node)
        if not raw_url or raw_url in seen_urls:
            return
        kind = imagine_node_media_type(node, raw_url)
        if kind not in {"image", "video"}:
            return
        post_id = imagine_post_id(node, file_stem(Path(urlparse(raw_url).path).name) or uuid.uuid4().hex)
        if post_id in seen_entry_ids:
            return
        seen_entry_ids.add(post_id)
        seen_urls.add(raw_url)
        created_at = imagine_post_time(node)
        prompt = imagine_post_text(node) or root_prompt
        thumbnail = imagine_node_thumbnail(node)
        original_post_id = imagine_node_relation_id(node, "originalPostId", "original_post_id")
        parent_post_id = imagine_node_relation_id(node, "parentPostId", "parent_post_id")
        source_item_id = original_post_id or parent_post_id
        if source_item_id == post_id:
            source_item_id = ""
        root_post_id = imagine_node_relation_id(node, "rootPostId", "root_post_id") or root_id
        original_ref_type = str(node.get("originalRefType") or node.get("original_ref_type") or "").strip()
        width, height = imagine_node_resolution(node)
        role = "source" if kind == "image" and post_id in source_ids else "result"
        if relation == "input" and role != "source":
            role = "reference"
        metadata = {
            "imagine_post_id": post_id,
            "imagine_media_url": raw_url,
            "imagine_video_media_url": raw_url if kind == "video" else "",
            "original_post_id": original_post_id,
            "parent_post_id": parent_post_id,
            "root_post_id": root_post_id,
            "source_item_id": source_item_id,
            "original_ref_type": original_ref_type,
            "media_status": node.get("mediaStatus") or "",
            "model_name": node.get("modelName") or "",
            "resolution_name": node.get("resolutionName") or "",
            "video_duration": node.get("videoDuration") or "",
            "video_extension_start_time": node.get("videoExtensionStartTime") or "",
        }
        entries.append({
            "item_id": post_id,
            "type": kind,
            "url": raw_url,
            "thumbnail_url": thumbnail,
            "prompt": prompt,
            "created_at": created_at,
            "role": role,
            "relation": relation or ("original" if role == "source" else "child"),
            "source_item_id": source_item_id,
            "original_post_id": original_post_id,
            "parent_post_id": parent_post_id,
            "root_post_id": root_post_id,
            "original_ref_type": original_ref_type,
            "width": width,
            "height": height,
            "aspect_ratio": f"{width}:{height}" if width > 0 and height > 0 else "",
            "model": node.get("modelName") or "",
            "resolution_name": node.get("resolutionName") or "",
            "video_duration": node.get("videoDuration") or "",
            "metadata": metadata,
        })

    for node in candidate_nodes:
        add_entry(node, "root" if imagine_post_id(node) == root_id else "child")

    def walk(value, parent_key: str = "", depth: int = 0) -> None:
        if depth > 8:
            return
        if input_collection_key(parent_key):
            return
        if isinstance(value, list):
            for item in value:
                walk(item, parent_key, depth + 1)
            return
        if not isinstance(value, dict):
            return
        for key, item in value.items():
            key_text = str(key or "").lower()
            if input_collection_key(key_text):
                continue
            if isinstance(item, str) and imagine_remote_media_key(key):
                add_candidate(value)
                add_entry(value, parent_key or key)
        for key, item in value.items():
            key_text = str(key or "").lower()
            if input_collection_key(key_text):
                continue
            if isinstance(item, list):
                walk(item, key_text, depth + 1)
            elif isinstance(item, dict) and any(token in key_text for token in ("post", "child", "media", "image", "video", "asset", "file", "result")):
                walk(item, key_text, depth + 1)

    walk(root_post)
    if not entries:
        for key, value in root_post.items():
            if isinstance(value, str) and imagine_remote_url(value):
                add_candidate(root_post)
                add_entry(root_post, key)
    return entries


def imagine_item_representative_media_url(item: dict) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    item_type = str(item.get("type") or "").lower()
    for source in (item, metadata, imagine):
        for key in (
            "hd1080_media_url" if item_type == "video" else "",
            "hd1080MediaUrl" if item_type == "video" else "",
            "hd_media_url" if item_type == "video" else "",
            "hdMediaUrl" if item_type == "video" else "",
            "object_url",
            "url",
            "media_url",
            "mediaUrl",
            "remote_url",
            "source_url",
            "imagine_video_media_url" if item_type == "video" else "imagine_media_url",
        ):
            value = source.get(key) if key else ""
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def imagine_item_representative_preview_url(item: dict) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    item_type = str(item.get("type") or "").lower()
    for source in (item, metadata, imagine):
        for key in (
            "thumbnail_url",
            "thumbnailUrl",
            "poster_url",
            "posterUrl",
            "preview_url",
            "previewUrl",
            "primary_poster_url",
            "primaryPosterUrl",
        ):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return imagine_item_representative_media_url(item) if item_type == "image" else ""


def imagine_representative_item(items: list[dict], require_video_preview: bool = False) -> dict | None:
    videos = [
        item for item in items
        if item.get("type") == "video"
        and imagine_item_representative_media_url(item)
        and (not require_video_preview or imagine_item_representative_preview_url(item))
    ]
    images = [
        item for item in items
        if item.get("type") == "image"
        and imagine_item_representative_preview_url(item)
    ]
    candidates = videos or images or items
    return sorted(candidates, key=lambda item: str(item.get("created_at") or ""), reverse=True)[0] if candidates else None


def imagine_relation_source_id(source_post_path: str) -> str:
    value = str(source_post_path or "").strip().strip("/")
    if not value:
        return ""
    tail = value.rsplit("/", 1)[-1]
    return imagine_post_id_from_value(tail) or extract_imagine_post_id_from_text(tail) or tail


def imagine_relation_item_key(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("item_id") or item.get("id") or item.get("url") or item.get("remote_url") or "").strip()


def imagine_relation_stored_item(item: dict) -> dict:
    if not isinstance(item, dict):
        return {}
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    raw_url = str(item.get("remote_url") or item.get("url") or metadata.get("remote_url") or metadata.get("media_url") or imagine.get("media_url") or "").strip()
    if not raw_url or raw_url.startswith("data:"):
        return {}
    raw_thumb = str(metadata.get("thumbnail_url") or imagine.get("thumbnail_url") or "").strip()
    if not raw_thumb:
        candidate_thumb = str(item.get("thumbnail_url") or "").strip()
        if candidate_thumb.startswith("http://") or candidate_thumb.startswith("https://"):
            raw_thumb = candidate_thumb
    stored_imagine = {
        key: imagine.get(key)
        for key in (
            "post_id", "root_post_id", "media_type", "source_item_id",
            "original_post_id", "parent_post_id", "original_ref_type",
            "conversation_id", "response_id", "parent_response_id",
            "request_id", "action", "aspect_ratio",
        )
        if imagine.get(key) not in (None, "")
    }
    stored_imagine["media_url"] = raw_url
    stored_metadata = {
        "remote_url": raw_url,
        "media_url": raw_url,
        "thumbnail_url": raw_thumb,
        "imagine": stored_imagine,
    }
    if metadata.get("aspect_ratio"):
        stored_metadata["aspect_ratio"] = metadata.get("aspect_ratio")
    return {
        key: item.get(key)
        for key in (
            "item_id", "type", "mime_type", "role", "relation",
            "source_item_id", "original_post_id", "parent_post_id",
            "root_post_id", "conversation_id", "response_id", "parent_response_id",
            "original_ref_type", "prompt", "created_at",
            "width", "height", "aspect_ratio", "aspectRatio", "model",
            "resolution_name", "video_duration",
        )
        if item.get(key) not in (None, "")
    } | {
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "thumbnail_url": raw_thumb,
        "metadata": stored_metadata,
    }


def imagine_relation_materialized_item(item: dict, account: dict) -> dict:
    stored = imagine_relation_stored_item(item)
    if not stored:
        return {}
    raw_url = str(stored.get("remote_url") or stored.get("url") or "").strip()
    raw_thumb = str((stored.get("metadata") or {}).get("thumbnail_url") or stored.get("thumbnail_url") or "").strip()
    kind = "video" if str(stored.get("type") or "").lower() == "video" else "image"
    account_id_value = str(account.get("id") or "")
    metadata = dict(stored.get("metadata") or {})
    imagine = dict(metadata.get("imagine") or {})
    imagine.update({
        "media_url": raw_url,
        "media_type": kind,
        "account_id": account_id_value,
        "remote_view": "saved",
        "liked": True,
    })
    metadata.update({
        "remote_url": raw_url,
        "media_url": raw_url,
        "remote_view": "saved",
        "liked": True,
        "imagine": imagine,
    })
    stored.update({
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": imagine_saved_proxy_url(raw_url, kind, account_id_value),
        "thumbnail_url": (
            imagine_saved_proxy_url(raw_url, "image", account_id_value)
            if kind == "image"
            else (imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else "")
        ),
        "metadata": metadata,
        "liked": True,
        "favorite": True,
    })
    return stored


def imagine_persist_generated_relation(
    root: Path,
    source_post_path: str,
    source_item_id: str,
    items: list[dict],
    action: str,
    request_id: str,
) -> None:
    source_id = imagine_relation_source_id(source_post_path)
    stored_items = [stored for stored in (imagine_relation_stored_item(item) for item in items or []) if stored]
    if not source_id or not stored_items:
        return
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})
    relations = settings.get("imagine_generated_relations")
    if not isinstance(relations, dict):
        relations = {}
    record = relations.get(source_id) if isinstance(relations.get(source_id), dict) else {}
    merged: dict[str, dict] = {}
    for candidate in record.get("items") if isinstance(record.get("items"), list) else []:
        key = imagine_relation_item_key(candidate)
        if key:
            merged[key] = imagine_relation_stored_item(candidate)
    for candidate in stored_items:
        key = imagine_relation_item_key(candidate)
        if key:
            merged[key] = candidate
    relations[source_id] = {
        "source_post_id": source_id,
        "source_post_path": str(source_post_path or ""),
        "source_item_id": str(source_item_id or ""),
        "action": str(action or ""),
        "request_id": str(request_id or ""),
        "updated_at": now_iso(),
        "items": list(merged.values())[-120:],
    }
    if len(relations) > 500:
        ordered = sorted(
            relations.items(),
            key=lambda pair: str((pair[1] if isinstance(pair[1], dict) else {}).get("updated_at") or ""),
            reverse=True,
        )[:500]
        relations = dict(ordered)
    settings["imagine_generated_relations"] = relations
    library["updated_at"] = now_iso()
    write_json(library_path, library)
    imagine_debug_event("generated_relation_persisted", {
        "request_id": request_id,
        "action": action,
        "source_post_id": source_id,
        "source_item_id": source_item_id,
        "item_ids": [imagine_relation_item_key(item) for item in stored_items],
    })


def imagine_apply_generated_relations(post: dict, root: Path, account: dict, library: dict | None = None) -> dict:
    if not isinstance(post, dict):
        return post
    post_id = str(post.get("post_id") or "").strip()
    if not post_id:
        return post
    if not isinstance(library, dict):
        library = merge_library_json(read_json(root / "library.json", {}))
    settings = library.get("settings") if isinstance(library.get("settings"), dict) else {}
    relations = settings.get("imagine_generated_relations") if isinstance(settings.get("imagine_generated_relations"), dict) else {}
    record = relations.get(post_id) if isinstance(relations.get(post_id), dict) else None
    if not record:
        return post
    hidden = {str(value) for value in settings.get("hidden_imagine_item_keys", []) if str(value)}
    existing_items = [dict(item) for item in post.get("items") or [] if isinstance(item, dict)]
    existing_keys = {imagine_relation_item_key(item) for item in existing_items}
    for stored in record.get("items") if isinstance(record.get("items"), list) else []:
        if not isinstance(stored, dict):
            continue
        stored_metadata = stored.get("metadata") if isinstance(stored, dict) and isinstance(stored.get("metadata"), dict) else {}
        stored_imagine = stored_metadata.get("imagine") if isinstance(stored_metadata.get("imagine"), dict) else {}
        stored_conversation_id = str(
            stored.get("conversation_id")
            or stored_imagine.get("conversation_id")
            or ""
        ).strip()
        # A result created in a new Imagine conversation belongs to that new
        # Saved post.  Do not also graft it onto the source post.
        if stored_conversation_id and stored_conversation_id != post_id:
            continue
        item = imagine_relation_materialized_item(stored, account)
        key = imagine_relation_item_key(item)
        if not key or key in existing_keys:
            continue
        if key in hidden or str(item.get("url") or "") in hidden or str(item.get("remote_url") or "") in hidden:
            continue
        existing_items.append(item)
        existing_keys.add(key)
    if len(existing_items) == len(post.get("items") or []):
        return post
    representative = imagine_representative_item(existing_items) or existing_items[0]
    post.update({
        "items": existing_items,
        "representative_item": representative,
        "representative": representative.get("url") or representative.get("item_id") or post.get("representative") or "",
    })
    metadata = post.get("metadata") if isinstance(post.get("metadata"), dict) else {}
    metadata["app_preserved_generated_relations"] = True
    post["metadata"] = metadata
    return post


def imagine_saved_post_from_root(root_post: dict, account: dict) -> dict | None:
    if not isinstance(root_post, dict):
        return None
    root_id = imagine_post_id(root_post)
    entries = collect_imagine_media_entries(root_post)
    if not entries:
        return None
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    root_prompt = imagine_post_text(root_post)
    items = []
    for index, entry in enumerate(entries):
        kind = entry["type"]
        raw_url = entry["url"]
        proxied_url = imagine_saved_proxy_url(raw_url, kind, account_id_value)
        raw_thumb = entry.get("thumbnail_url") or ""
        proxied_thumb = imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else (proxied_url if kind == "image" else "")
        item_id = str(entry.get("item_id") or f"item-{index + 1}")
        metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
        imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
        imagine.update({
            "post_id": item_id,
            "root_post_id": root_id,
            "media_url": raw_url,
            "media_type": kind,
            "source_item_id": entry.get("source_item_id") or "",
            "original_post_id": entry.get("original_post_id") or "",
            "parent_post_id": entry.get("parent_post_id") or "",
            "original_ref_type": entry.get("original_ref_type") or "",
            "account_id": account_id_value,
            "account_email": account_email,
            "remote_view": "saved",
            "liked": True,
        })
        metadata.update({
            "remote_url": raw_url,
            "media_url": raw_url,
            "remote_view": "saved",
            "liked": True,
            "imagine": imagine,
        })
        items.append({
            "item_id": item_id,
            "type": kind,
            "file": "",
            "url": raw_url,
            "remote_url": raw_url,
            "object_url": proxied_url,
            "thumbnail_url": proxied_thumb,
            "mime_type": "video/mp4" if kind == "video" else "image/*",
            "role": entry.get("role") or "result",
            "relation": entry.get("relation") or "",
            "source_item_id": entry.get("source_item_id") or "",
            "original_post_id": entry.get("original_post_id") or "",
            "parent_post_id": entry.get("parent_post_id") or "",
            "root_post_id": entry.get("root_post_id") or root_id,
            "original_ref_type": entry.get("original_ref_type") or "",
            "prompt": entry.get("prompt") or root_prompt,
            "created_at": entry.get("created_at") or imagine_post_time(root_post),
            "width": entry.get("width") or 0,
            "height": entry.get("height") or 0,
            "aspect_ratio": entry.get("aspect_ratio") or "",
            "model": entry.get("model") or "",
            "resolution_name": entry.get("resolution_name") or "",
            "video_duration": entry.get("video_duration") or "",
            "metadata": metadata,
            "liked": True,
            "favorite": True,
        })
    representative = imagine_representative_item(items) or items[0]
    post_id = root_id or str(representative.get("item_id") or uuid.uuid4().hex)
    title = (root_prompt or representative.get("prompt") or post_id or "Imagine").strip().splitlines()[0][:80]
    return {
        "post_id": post_id,
        "source": "imagine",
        "mode": "saved",
        "area": "imagine_remote",
        "remote": True,
        "liked": True,
        "favorite": True,
        "title": title or "Imagine",
        "prompt": root_prompt or representative.get("prompt") or "",
        "created_at": imagine_post_time(root_post),
        "folder_path": f"imagine_saved/{post_id}",
        "folderName": title or post_id,
        "representative": representative.get("url") or representative.get("item_id") or "",
        "representative_item": representative,
        "items": items,
        "account_id": account_id_value,
        "account_email": account_email,
        "metadata": {
            "imagine_root_post_id": post_id,
            "raw_root_post_id": root_id,
            "remote_view": "saved",
            "liked": True,
        },
    }


def imagine_discover_post_from_root(root_post: dict, account: dict) -> dict | None:
    post = imagine_saved_post_from_root(root_post, account)
    if not post:
        return None
    post_id = str(post.get("post_id") or post.get("folderName") or uuid.uuid4().hex)
    metadata = post.get("metadata") if isinstance(post.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    metadata.update({
        "remote_view": "discover",
        "liked": False,
        "imagine": {
            **imagine,
            "remote_view": "discover",
            "liked": False,
        },
    })
    post.update({
        "mode": "discover",
        "area": "imagine_remote",
        "remote": True,
        "liked": False,
        "favorite": False,
        "folder_path": f"imagine_discover/{post_id}",
        "metadata": metadata,
    })
    for item in (post.get("items") if isinstance(post.get("items"), list) else []):
        item_metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        item_imagine = item_metadata.get("imagine") if isinstance(item_metadata.get("imagine"), dict) else {}
        item_metadata.update({
            "remote_view": "discover",
            "liked": False,
            "imagine": {
                **item_imagine,
                "remote_view": "discover",
                "liked": False,
            },
        })
        item.update({
            "liked": False,
            "favorite": False,
            "metadata": item_metadata,
        })
    representative = imagine_representative_item(
        post.get("items") if isinstance(post.get("items"), list) else [],
        require_video_preview=True,
    ) or post.get("representative_item")
    if isinstance(representative, dict):
        post["representative_item"] = representative
        post["representative"] = representative.get("url") or representative.get("item_id") or post.get("representative") or ""
    return post


def imagine_conversation_media_gen(asset: dict) -> dict:
    media_gen_input = asset.get("mediaGenInput") if isinstance(asset.get("mediaGenInput"), dict) else {}
    for action, value in media_gen_input.items():
        if not isinstance(value, dict):
            continue
        input_assets = value.get("inputAssets") if isinstance(value.get("inputAssets"), list) else []
        return {
            "action": str(action or ""),
            "prompt": imagine_text_value(value.get("prompt")),
            "input_assets": [str(item) for item in input_assets if str(item or "").strip()],
            "model": str(value.get("modelName") or ""),
            "resolution_name": str(value.get("resolutionName") or ""),
            "video_duration": value.get("duration") or "",
            "video_extension_start_time": value.get("videoExtensionStartTime") or "",
        }
    return {
        "action": "",
        "prompt": "",
        "input_assets": [],
        "model": "",
        "resolution_name": "",
        "video_duration": "",
        "video_extension_start_time": "",
    }


def imagine_conversation_request_prompt(value) -> str:
    text = imagine_text_value(value).strip()
    if not text:
        return ""
    text = re.sub(r"\s+--mode(?:=|\s+)\S+\s*$", "", text, flags=re.IGNORECASE).strip()
    for pattern in (
        r"^I edited the image with the prompt:\s*(['\"])(.*)\1\s*$",
        r"^I generated (?:an image|a video) with the prompt:\s*(['\"])(.*)\1\s*$",
    ):
        match = re.match(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(2).strip()
    return text


def imagine_conversation_asset_item(
    asset: dict,
    conversation_id: str,
    response: dict,
    parent_asset_ids: list[str],
    parent_response: dict,
    account: dict,
) -> dict | None:
    if not isinstance(asset, dict):
        return None
    asset_id = str(asset.get("assetId") or asset.get("id") or "").strip()
    raw_url = imagine_asset_url(str(asset.get("key") or asset.get("mediaUrl") or asset.get("url") or ""))
    mime_type = str(asset.get("mimeType") or asset.get("mime_type") or "").lower()
    kind = "video" if mime_type.startswith("video/") else "image" if mime_type.startswith("image/") else ""
    if not kind:
        kind = imagine_node_media_type(asset, raw_url)
    if not asset_id or not raw_url or kind not in {"image", "video"}:
        return None

    aux_keys = asset.get("auxKeys") if isinstance(asset.get("auxKeys"), dict) else {}
    raw_thumbnail = imagine_asset_url(str(
        asset.get("previewImageKey")
        or aux_keys.get("preview-image")
        or aux_keys.get("preview_image")
        or ""
    ))
    media_gen = imagine_conversation_media_gen(asset)
    input_assets = list(media_gen.get("input_assets") or [])
    if not input_assets and str(response.get("sender") or "").upper() == "ASSISTANT":
        input_assets = [str(item) for item in parent_asset_ids if str(item or "").strip()]
    source_item_id = next((item for item in input_assets if item != asset_id), "")
    created_at = imagine_post_time(asset)
    response_id = str(response.get("responseId") or response.get("id") or asset.get("responseId") or "").strip()
    parent_response_id = str(response.get("parentResponseId") or asset.get("parentResponseId") or "").strip()
    is_model_generated = bool(asset.get("isModelGenerated"))
    file_source = str(asset.get("fileSource") or "")
    is_upload = not is_model_generated or "UPLOAD" in file_source.upper()
    prompt = "" if is_upload else (
        imagine_conversation_request_prompt(media_gen.get("prompt"))
        or imagine_conversation_request_prompt(parent_response.get("message") if isinstance(parent_response, dict) else "")
        or imagine_conversation_request_prompt(response.get("message"))
        or imagine_conversation_request_prompt(asset.get("summary"))
    )
    role = "source" if is_upload else "result"
    relation = "upload" if is_upload else str(media_gen.get("action") or "generated")
    try:
        width = int(asset.get("width") or 0)
        height = int(asset.get("height") or 0)
    except (TypeError, ValueError):
        width = 0
        height = 0
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    proxied_url = imagine_saved_proxy_url(raw_url, kind, account_id_value)
    proxied_thumbnail = (
        imagine_saved_proxy_url(raw_thumbnail, "image", account_id_value)
        if raw_thumbnail
        else (proxied_url if kind == "image" else "")
    )
    imagine_metadata = {
        "post_id": asset_id,
        "asset_id": asset_id,
        "root_post_id": conversation_id,
        "conversation_id": conversation_id,
        "response_id": response_id,
        "parent_response_id": parent_response_id,
        "media_url": raw_url,
        "media_type": kind,
        "source_item_id": source_item_id,
        "original_post_id": source_item_id,
        "parent_post_id": source_item_id,
        "account_id": account_id_value,
        "account_email": account_email,
        "remote_view": "saved",
        "liked": True,
        "generated_action": str(media_gen.get("action") or ""),
    }
    metadata = {
        "asset_id": asset_id,
        "response_id": response_id,
        "parent_response_id": parent_response_id,
        "conversation_id": conversation_id,
        "remote_url": raw_url,
        "media_url": raw_url,
        "thumbnail_url": raw_thumbnail,
        "remote_view": "saved",
        "liked": True,
        "imagine": imagine_metadata,
    }
    return {
        "item_id": asset_id,
        "post_id": asset_id,
        "asset_id": asset_id,
        "type": kind,
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": proxied_url,
        "thumbnail_url": proxied_thumbnail,
        "mime_type": mime_type or ("video/mp4" if kind == "video" else "image/*"),
        "role": role,
        "relation": relation,
        "source_item_id": source_item_id,
        "original_post_id": source_item_id,
        "parent_post_id": source_item_id,
        "root_post_id": conversation_id,
        "conversation_id": conversation_id,
        "response_id": response_id,
        "parent_response_id": parent_response_id,
        "prompt": prompt,
        "created_at": created_at,
        "width": width,
        "height": height,
        "aspect_ratio": f"{width}:{height}" if width > 0 and height > 0 else "",
        "model": str(media_gen.get("model") or ""),
        "resolution_name": str(media_gen.get("resolution_name") or ""),
        "video_duration": media_gen.get("video_duration") or "",
        "video_extension_start_time": media_gen.get("video_extension_start_time") or "",
        "metadata": metadata,
        "liked": True,
        "favorite": True,
    }


def imagine_conversation_root_generation(responses: list[dict]) -> dict:
    response_by_id = {
        str(response.get("responseId") or response.get("id") or ""): response
        for response in responses
        if isinstance(response, dict)
    }
    for response in responses:
        if not isinstance(response, dict):
            continue
        attachments = response.get("fileAttachmentAssetMetadata") if isinstance(response.get("fileAttachmentAssetMetadata"), list) else []
        generated_assets = [
            asset for asset in attachments
            if isinstance(asset, dict) and bool(asset.get("isModelGenerated"))
        ]
        for asset in generated_assets:
            parent_response = response_by_id.get(str(response.get("parentResponseId") or ""), {})
            parent_attachments = (
                parent_response.get("fileAttachmentAssetMetadata")
                if isinstance(parent_response, dict) and isinstance(parent_response.get("fileAttachmentAssetMetadata"), list)
                else []
            )
            media_gen_sources = [
                source for source in (asset, response, parent_response)
                if isinstance(source, dict)
            ]
            media_gen = next(
                (value for value in (imagine_conversation_media_gen(source) for source in media_gen_sources) if value.get("action")),
                imagine_conversation_media_gen(asset),
            )
            action = str(media_gen.get("action") or "").strip()
            requested_count = 0
            for source in media_gen_sources:
                media_gen_input = source.get("mediaGenInput") if isinstance(source.get("mediaGenInput"), dict) else {}
                for config in media_gen_input.values():
                    if not isinstance(config, dict):
                        continue
                    try:
                        requested_count = max(requested_count, int(config.get("numOfImages") or config.get("num_images") or 0))
                    except (TypeError, ValueError):
                        pass
            mime_type = str(asset.get("mimeType") or asset.get("mime_type") or "").lower()
            kind = "video" if mime_type.startswith("video/") else "image" if mime_type.startswith("image/") else ""
            if not kind:
                raw_url = imagine_asset_url(str(asset.get("key") or asset.get("mediaUrl") or asset.get("url") or ""))
                kind = imagine_node_media_type(asset, raw_url)
            normalized_action = re.sub(r"[^a-z0-9]", "", action.lower())
            is_t2i_root = kind == "image" and (
                normalized_action == "texttoimage"
                or (not normalized_action and not parent_attachments)
            )
            is_t2i_group_container = is_t2i_root and max(len(generated_assets), requested_count) > 1
            return {
                "action": action,
                "type": kind,
                "asset_id": str(asset.get("assetId") or asset.get("id") or "").strip(),
                "has_input_assets": bool(parent_attachments),
                "generated_asset_count": len(generated_assets),
                "requested_count": requested_count,
                "is_t2i_group_container": is_t2i_group_container,
            }
    return {
        "action": "",
        "type": "",
        "asset_id": "",
        "has_input_assets": False,
        "generated_asset_count": 0,
        "requested_count": 0,
        "is_t2i_group_container": False,
    }


def imagine_conversation_items_from_detail(conversation_id: str, detail: dict, account: dict) -> tuple[list[dict], dict[str, dict]]:
    responses = detail.get("responses") if isinstance(detail, dict) and isinstance(detail.get("responses"), list) else []
    response_by_id = {
        str(response.get("responseId") or response.get("id") or ""): response
        for response in responses
        if isinstance(response, dict)
    }
    items_by_id: dict[str, dict] = {}
    for response in responses:
        if not isinstance(response, dict):
            continue
        parent_response = response_by_id.get(str(response.get("parentResponseId") or ""), {})
        parent_attachments = (
            parent_response.get("fileAttachmentAssetMetadata")
            if isinstance(parent_response, dict) and isinstance(parent_response.get("fileAttachmentAssetMetadata"), list)
            else []
        )
        parent_asset_ids = [
            str(asset.get("assetId") or asset.get("id") or "")
            for asset in parent_attachments
            if isinstance(asset, dict)
        ]
        attachments = response.get("fileAttachmentAssetMetadata") if isinstance(response.get("fileAttachmentAssetMetadata"), list) else []
        for asset in attachments:
            item = imagine_conversation_asset_item(
                asset,
                conversation_id,
                response,
                parent_asset_ids,
                parent_response,
                account,
            )
            if not item:
                continue
            item_id = str(item.get("item_id") or "")
            if item_id and item_id not in items_by_id:
                items_by_id[item_id] = item
    items = list(items_by_id.values())
    items.sort(key=lambda item: str(item.get("created_at") or ""))
    return items, response_by_id


def imagine_saved_post_from_conversation(conversation: dict, detail: dict, account: dict) -> dict | None:
    if not isinstance(conversation, dict):
        return None
    conversation_id = str(conversation.get("conversationId") or conversation.get("id") or "").strip()
    latest_asset = conversation.get("latestAssetMetadata") if isinstance(conversation.get("latestAssetMetadata"), dict) else {}
    if not conversation_id or not latest_asset:
        return None

    responses = detail.get("responses") if isinstance(detail, dict) and isinstance(detail.get("responses"), list) else []
    root_generation = imagine_conversation_root_generation(responses)
    items, response_by_id = imagine_conversation_items_from_detail(conversation_id, detail, account)
    items_by_id = {str(item.get("item_id") or ""): item for item in items if str(item.get("item_id") or "")}

    latest_response = response_by_id.get(str(latest_asset.get("responseId") or ""), {})
    latest_parent_response = response_by_id.get(str(latest_response.get("parentResponseId") or ""), {})
    latest_parent_attachments = (
        latest_parent_response.get("fileAttachmentAssetMetadata")
        if isinstance(latest_parent_response, dict) and isinstance(latest_parent_response.get("fileAttachmentAssetMetadata"), list)
        else []
    )
    latest_parent_asset_ids = [
        str(asset.get("assetId") or asset.get("id") or "")
        for asset in latest_parent_attachments
        if isinstance(asset, dict)
    ]
    latest_item = imagine_conversation_asset_item(
        latest_asset,
        conversation_id,
        latest_response,
        latest_parent_asset_ids,
        latest_parent_response,
        account,
    )
    if latest_item:
        items_by_id.setdefault(str(latest_item.get("item_id") or ""), latest_item)
    items = list(items_by_id.values())
    if not items:
        return None
    items.sort(key=lambda item: str(item.get("created_at") or ""))

    latest_asset_id = str(latest_asset.get("assetId") or latest_asset.get("id") or "").strip()
    representative = items_by_id.get(latest_asset_id) or items[-1]
    title = str(conversation.get("title") or representative.get("prompt") or "Imagine").strip().splitlines()[0][:80]
    prompt = str(representative.get("prompt") or conversation.get("title") or "").strip()
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    return {
        "post_id": conversation_id,
        "source": "imagine",
        "mode": "saved",
        "area": "imagine_remote",
        "remote": True,
        "liked": True,
        "favorite": True,
        "t2i_group_container": bool(root_generation.get("is_t2i_group_container")),
        "title": title or "Imagine",
        "prompt": prompt,
        "created_at": imagine_post_time(conversation),
        "folder_path": f"imagine_saved/{conversation_id}",
        "folderName": title or conversation_id,
        "representative": representative.get("url") or representative.get("item_id") or "",
        "representative_item": representative,
        "items": items,
        "account_id": account_id_value,
        "account_email": account_email,
        "metadata": {
            "imagine_root_post_id": conversation_id,
            "raw_root_post_id": conversation_id,
            "conversation_id": conversation_id,
            "latest_asset_id": latest_asset_id,
            "remote_view": "saved",
            "saved_content_view": "conversations",
            "grouped": True,
            "root_generation_action": root_generation.get("action") or "",
            "root_generation_type": root_generation.get("type") or "",
            "root_generation_asset_id": root_generation.get("asset_id") or "",
            "root_generation_has_input_assets": bool(root_generation.get("has_input_assets")),
            "root_generation_asset_count": int(root_generation.get("generated_asset_count") or 0),
            "root_generation_requested_count": int(root_generation.get("requested_count") or 0),
            "t2i_group_container": bool(root_generation.get("is_t2i_group_container")),
            "liked": True,
        },
    }


def imagine_conversation_detail(conversation_id: str, account: dict) -> dict:
    query = urlencode({"conversationKind": "CONVERSATION_KIND_IMAGINE"})
    return imagine_get_json(
        f"/rest/app-chat/conversations/{quote(conversation_id, safe='')}/responses?{query}",
        account,
        timeout=20,
    )


def list_imagine_saved(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    try:
        limit = int((payload or {}).get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    limit = min(40, max(1, limit))
    cursor = str((payload or {}).get("cursor") or "").strip()
    query_params = {
        "pageSize": str(limit),
        "kind": "CONVERSATION_KIND_IMAGINE",
    }
    if cursor:
        query_params["pageToken"] = cursor
    try:
        data = imagine_get_json(
            "/rest/app-chat/conversations?" + urlencode(query_params),
            account,
            timeout=20,
        )
    except RuntimeError as exc:
        message = str(exc)
        if "Imagine HTTP 401" in message or "not authorized" in message.lower():
            files = account_files(root)
            changed = False
            for item in files["imagine"].get("accounts") or []:
                if str(item.get("id") or "") == str(account.get("id") or ""):
                    item["status"] = "expired"
                    item["oauth_error"] = "not_authorized"
                    item["oauth_error_at"] = now_iso()
                    changed = True
                    break
            if changed:
                write_imagine_auth(root, files["imagine"])
            raise RuntimeError("Imagine login expired. Register the account again.") from exc
        raise
    conversations = data.get("conversations") if isinstance(data.get("conversations"), list) else []
    conversations = [
        conversation
        for conversation in conversations
        if isinstance(conversation, dict) and isinstance(conversation.get("latestAssetMetadata"), dict)
    ]
    details: dict[str, dict] = {}
    if conversations:
        with ThreadPoolExecutor(max_workers=min(8, len(conversations))) as executor:
            futures = {
                executor.submit(imagine_conversation_detail, str(conversation.get("conversationId") or ""), account): str(conversation.get("conversationId") or "")
                for conversation in conversations
                if str(conversation.get("conversationId") or "").strip()
            }
            for future in as_completed(futures):
                conversation_id = futures[future]
                try:
                    details[conversation_id] = future.result()
                except Exception as exc:
                    details[conversation_id] = {}
                    imagine_debug_event("saved_conversation_detail_failed", {
                        "conversation_id": conversation_id,
                        "error": str(exc)[:400],
                    })
    posts = []
    for conversation in conversations:
        conversation_id = str(conversation.get("conversationId") or "")
        post = imagine_saved_post_from_conversation(conversation, details.get(conversation_id, {}), account)
        if post:
            posts.append(post)
    return {
        "ok": True,
        "source": "saved",
        "url": IMAGINE_BASE + "/imagine/saved",
        "posts": posts,
        "items": posts,
        "cursor": cursor,
        "next_cursor": str(data.get("nextPageToken") or ""),
        "has_more": bool(data.get("nextPageToken")),
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def imagine_get_media_post_direct(post_id: str, account: dict, timeout: int = 12) -> dict:
    errors: list[str] = []
    for payload in ({"id": post_id}, {"ids": [post_id]}):
        path = "/rest/media/post/get" if "id" in payload else "/rest/media/post/bulk-get"
        try:
            data = imagine_post_json(path, payload, account, timeout=timeout)
        except Exception as exc:
            errors.append(str(exc)[:240])
            continue
        post = data.get("post") if isinstance(data.get("post"), dict) else None
        if post:
            return post
        posts = data.get("posts") if isinstance(data.get("posts"), list) else []
        for candidate in posts:
            if isinstance(candidate, dict) and imagine_post_id(candidate) == post_id:
                return candidate
        if posts and isinstance(posts[0], dict):
            return posts[0]
    detail = "; ".join(errors[-2:])
    raise RuntimeError(("Could not load the Imagine source media post. " + detail).strip())


def load_imagine_remote_link_post(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    raw_value = str(
        (payload or {}).get("value")
        or (payload or {}).get("url")
        or (payload or {}).get("post_id")
        or ""
    ).strip()
    post_id = imagine_post_id_from_value(raw_value)
    if not post_id:
        raise RuntimeError("Enter a valid Grok Imagine post link.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    raw_post = imagine_get_media_post_direct(post_id, account, timeout=12)
    post = imagine_saved_post_from_root(raw_post, account)
    if post:
        post = imagine_apply_generated_relations(post, root, account)
    if not post:
        raise RuntimeError("Could not load the linked Imagine post.")
    metadata = post.get("metadata") if isinstance(post.get("metadata"), dict) else {}
    metadata.update({
        "remote_view": "link",
        "link_source": True,
        "link_post_id": post_id,
        "link_url": f"{IMAGINE_BASE}/imagine/post/{post_id}",
        "liked": False,
    })
    post["metadata"] = metadata
    post["mode"] = "link"
    post["liked"] = False
    post["favorite"] = False
    for item in post.get("items") or []:
        if not isinstance(item, dict):
            continue
        item_metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        imagine = item_metadata.get("imagine") if isinstance(item_metadata.get("imagine"), dict) else {}
        item_metadata.update({
            "remote_view": "link",
            "link_source": True,
            "link_post_id": post_id,
            "link_url": f"{IMAGINE_BASE}/imagine/post/{post_id}",
            "liked": False,
        })
        imagine.update({
            "remote_view": "link",
            "link_source": True,
            "link_post_id": post_id,
            "liked": False,
        })
        item_metadata["imagine"] = imagine
        item["metadata"] = item_metadata
        item["liked"] = False
        item["favorite"] = False
    return {
        "ok": True,
        "source": "link",
        "post_id": post_id,
        "url": f"{IMAGINE_BASE}/imagine/post/{post_id}",
        "post": post,
        "posts": [post],
        "items": [post],
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def list_imagine_discover(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    try:
        limit = int((payload or {}).get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, limit)
    cursor = str((payload or {}).get("cursor") or "").strip()
    media_kind = str((payload or {}).get("media_type") or (payload or {}).get("discover_type") or "video").strip().lower()
    media_type = "MEDIA_POST_TYPE_IMAGE" if media_kind == "image" else "MEDIA_POST_TYPE_VIDEO"
    request_payload = {
        "limit": limit,
        "isNsfwEnabled": True,
        "withContainerOnly": False,
        "includeCanvas": False,
        "filter": {
            "source": "MEDIA_POST_SOURCE_PUBLIC",
            "mediaType": media_type,
        },
    }
    if cursor:
        request_payload["cursor"] = cursor
    data = imagine_post_json("/rest/media/post/list", request_payload, account, referer=IMAGINE_BASE + "/imagine")
    root_posts = data.get("posts") if isinstance(data.get("posts"), list) else []
    posts = [post for post in (imagine_discover_post_from_root(item, account) for item in root_posts) if post]
    return {
        "ok": True,
        "source": "discover",
        "url": IMAGINE_BASE + "/imagine",
        "media_type": media_kind if media_kind in {"image", "video"} else "video",
        "posts": posts,
        "items": posts,
        "cursor": cursor,
        "next_cursor": str(data.get("nextCursor") or ""),
        "has_more": bool(data.get("nextCursor")),
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def imagine_search_post_from_result(result: dict, account: dict, query: str) -> dict | None:
    if not isinstance(result, dict):
        return None
    raw_url = imagine_remote_url(str(result.get("mediaUrl") or result.get("media_url") or ""))
    if not raw_url:
        return None
    post_id = str(result.get("postId") or result.get("mediaPostId") or result.get("id") or "").strip()
    root_id = str(result.get("rootPostId") or result.get("root_post_id") or post_id).strip()
    if not post_id:
        post_id = extract_imagine_post_id_from_text(raw_url) or generated_media_id_from_url(raw_url) or uuid.uuid4().hex
    if not root_id:
        root_id = post_id
    media_type = str(result.get("mediaType") or result.get("media_type") or "").upper()
    kind = "video" if "VIDEO" in media_type or extension_for(urlparse(raw_url).path) in VIDEO_EXTS else "image"
    raw_thumb = imagine_remote_url(str(result.get("thumbnailUrl") or result.get("thumbnail_url") or result.get("previewImageUrl") or ""))
    if kind == "image" and not raw_thumb:
        raw_thumb = raw_url
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    proxied_url = imagine_saved_proxy_url(raw_url, kind, account_id_value)
    proxied_thumb = imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else (proxied_url if kind == "image" else "")
    try:
        width = int(result.get("width") or 0)
        height = int(result.get("height") or 0)
    except (TypeError, ValueError):
        width = 0
        height = 0
    created_at = str(result.get("createTime") or result.get("createdAt") or now_iso())
    title = (str(query or "").strip() or post_id or "Imagine").splitlines()[0][:80]
    item_metadata = {
        "remote_url": raw_url,
        "media_url": raw_url,
        "search_query": query,
        "result_type": result.get("resultType") or "",
        "root_post_id": root_id,
        "post_id": post_id,
        "remote_view": "search",
        "liked": True,
        "imagine": {
            "post_id": post_id,
            "root_post_id": root_id,
            "media_url": raw_url,
            "media_type": kind,
            "remote_view": "search",
            "liked": True,
            "account_id": account_id_value,
            "account_email": account_email,
        },
    }
    item = {
        "item_id": post_id,
        "type": kind,
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": proxied_url,
        "thumbnail_url": proxied_thumb,
        "mime_type": "video/mp4" if kind == "video" else "image/*",
        "role": "result",
        "relation": "search",
        "title": title,
        "prompt": query,
        "created_at": created_at,
        "width": width,
        "height": height,
        "aspect_ratio": f"{width}:{height}" if width > 0 and height > 0 else "",
        "root_post_id": root_id,
        "metadata": item_metadata,
        "liked": True,
        "favorite": True,
    }
    return {
        "post_id": root_id or post_id,
        "source": "imagine",
        "mode": "search",
        "area": "imagine_remote",
        "remote": True,
        "liked": True,
        "favorite": True,
        "title": title,
        "prompt": query,
        "created_at": created_at,
        "folder_path": f"imagine_search/{root_id or post_id}/{post_id}",
        "folderName": title or post_id,
        "representative": raw_url,
        "representative_item": item,
        "items": [item],
        "account_id": account_id_value,
        "account_email": account_email,
        "metadata": {
            "imagine_root_post_id": root_id,
            "raw_root_post_id": root_id,
            "search_post_id": post_id,
            "search_query": query,
            "remote_view": "search",
            "liked": True,
        },
    }


def search_imagine_media(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    query = str((payload or {}).get("query") or "").strip()
    if not query:
        return {"ok": True, "source": "search", "query": "", "posts": [], "items": []}
    try:
        limit = int((payload or {}).get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(limit, 100))
    try:
        imagine_post_json("/rest/media/search/status", {}, account, timeout=8, referer=IMAGINE_BASE + "/imagine")
    except Exception:
        pass
    data = imagine_post_json(
        "/rest/media/search/query",
        {"query": query, "limit": limit},
        account,
        timeout=30,
        referer=IMAGINE_BASE + "/imagine",
    )
    results = data.get("results") if isinstance(data.get("results"), list) else []
    posts = [post for post in (imagine_search_post_from_result(item, account, query) for item in results) if post]
    return {
        "ok": True,
        "source": "search",
        "query": query,
        "posts": posts,
        "items": posts,
        "result_count": len(results),
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def imagine_remote_key_variants(value) -> set[str]:
    text = str(value or "").strip()
    if not text:
        return set()
    variants = {text, text.lower()}
    parsed = urlparse(text)
    path = unquote(parsed.path if parsed.scheme else text)
    name = Path(path).name
    if name:
        variants.add(name)
        variants.add(name.lower())
        stem = file_stem(name)
        if stem:
            variants.add(stem)
            variants.add(stem.lower())
    for match in re.findall(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", text):
        variants.add(match)
        variants.add(match.lower())
    return {item for item in variants if item}


def imagine_asset_key_values(asset: dict) -> set[str]:
    values: set[str] = set()
    if not isinstance(asset, dict):
        return values
    raw_url = imagine_asset_primary_media_url(asset)
    kind = imagine_asset_media_kind(asset, raw_url)
    asset_id = str(asset.get("assetId") or asset.get("id") or "").strip()
    if asset_id and kind:
        values.add(f"asset:{kind}:{asset_id}")
    elif asset_id:
        values.add(f"asset:{asset_id}")
    url_key = canonical_remote_media_key(raw_url)
    if url_key:
        values.add(f"url:{url_key}")
    return values


def canonical_remote_media_key(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    path = unquote(parsed.path)
    if parsed.scheme and parsed.netloc:
        return parsed._replace(path=path, query="", fragment="").geturl()
    return path or text


def imagine_saved_media_keys(account: dict, max_posts: int = 160) -> set[str]:
    keys: set[str] = set()
    cursor = ""
    seen = 0
    while seen < max_posts:
        request_payload = {
            "limit": min(40, max_posts - seen),
            "includeCanvas": False,
            "filter": {
                "source": "MEDIA_POST_SOURCE_LIKED",
                "safeForWork": False,
            },
        }
        if cursor:
            request_payload["cursor"] = cursor
        data = imagine_post_json("/rest/media/post/list", request_payload, account)
        root_posts = data.get("posts") if isinstance(data.get("posts"), list) else []
        if not root_posts:
            break
        for root_post in root_posts:
            for entry in collect_imagine_media_entries(root_post):
                kind = str(entry.get("type") or "").strip()
                item_id = str(entry.get("item_id") or "").strip()
                if item_id and kind:
                    keys.add(f"asset:{kind}:{item_id}")
                    keys.add(f"post:{kind}:{item_id}")
                url_key = canonical_remote_media_key(entry.get("url"))
                if url_key:
                    keys.add(f"url:{url_key}")
        seen += len(root_posts)
        cursor = str(data.get("nextCursor") or "").strip()
        if not cursor:
            break
    return keys


def imagine_saved_media_keys_cached(account: dict, max_posts: int = 160) -> set[str]:
    account_key = str(account.get("id") or account.get("email") or "").strip().lower()
    cache_key = f"{account_key}:{max_posts}"
    now = time.monotonic()
    with IMAGINE_SAVED_MEDIA_KEYS_CACHE_LOCK:
        cached = IMAGINE_SAVED_MEDIA_KEYS_CACHE.get(cache_key)
        if cached and now - cached[0] < IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS:
            return set(cached[1])
    keys = imagine_saved_media_keys(account, max_posts=max_posts)
    with IMAGINE_SAVED_MEDIA_KEYS_CACHE_LOCK:
        IMAGINE_SAVED_MEDIA_KEYS_CACHE[cache_key] = (time.monotonic(), set(keys))
        stale_keys = [
            key for key, value in IMAGINE_SAVED_MEDIA_KEYS_CACHE.items()
            if time.monotonic() - value[0] >= IMAGINE_SAVED_MEDIA_KEYS_CACHE_SECONDS
        ]
        for key in stale_keys:
            IMAGINE_SAVED_MEDIA_KEYS_CACHE.pop(key, None)
    return keys


def imagine_asset_url_candidates(asset: dict) -> list[str]:
    candidates: list[str] = []

    def add(value) -> None:
        if not isinstance(value, str) or not value.strip():
            return
        text = value.strip()
        if text.startswith("//"):
            text = "https:" + text
        elif text.startswith("/users/"):
            text = IMAGINE_ASSETS_BASE + text
        elif text.startswith("users/"):
            text = IMAGINE_ASSETS_BASE + "/" + text
        else:
            text = imagine_asset_url(text)
        if text and text not in candidates:
            candidates.append(text)

    for key in (
        "url", "mediaUrl", "downloadUrl", "previewUrl", "thumbnailUrl",
        "imageUrl", "videoUrl", "assetUrl", "publicUrl", "key",
        "previewImageKey", "thumbnailImageKey", "videoKey", "imageKey", "generatedVideoKey",
    ):
        add(asset.get(key))
    aux_keys = asset.get("auxKeys")
    if isinstance(aux_keys, list):
        for value in aux_keys:
            add(value)
    elif isinstance(aux_keys, dict):
        for value in aux_keys.values():
            add(value)
    return candidates


def imagine_asset_primary_media_url(asset: dict) -> str:
    if not isinstance(asset, dict):
        return ""
    candidates = imagine_asset_url_candidates(asset)
    video_candidates = [url for url in candidates if Path(urlparse(url).path).suffix.lower().lstrip(".") in VIDEO_EXTS]
    if video_candidates:
        return video_candidates[0]
    image_candidates = [url for url in candidates if Path(urlparse(url).path).suffix.lower().lstrip(".") in IMAGE_EXTS]
    if image_candidates:
        return image_candidates[0]
    if candidates:
        return candidates[0]
    return ""


def imagine_asset_upload_source(asset: dict) -> bool:
    if not isinstance(asset, dict):
        return False
    source_text = " ".join(str(asset.get(key) or "") for key in ("source", "fileSource", "file_source", "mediaSource"))
    source_upper = source_text.upper()
    return "SELF_UPLOAD" in source_upper or "SOURCE_UPLOADED" in source_upper


def imagine_asset_preview_url(asset: dict, fallback_url: str = "") -> str:
    if not isinstance(asset, dict):
        return fallback_url
    if fallback_url and imagine_asset_upload_source(asset):
        return fallback_url
    for key in ("previewImageUrl", "previewImageKey", "thumbnailUrl", "thumbnailImageUrl", "thumbnailImageKey", "imageUrl", "imageKey"):
        raw_url = imagine_asset_url(str(asset.get(key) or ""))
        if raw_url:
            return raw_url
    aux_keys = asset.get("auxKeys")
    if isinstance(aux_keys, dict):
        for key in ("preview-image", "preview_image", "previewImage", "thumbnail-image", "thumbnail_image", "thumbnail"):
            raw_url = imagine_asset_url(str(aux_keys.get(key) or ""))
            if raw_url:
                return raw_url
    return fallback_url


def imagine_asset_media_kind(asset: dict, raw_url: str) -> str:
    mime_type = str(asset.get("mimeType") or asset.get("mime_type") or "").lower() if isinstance(asset, dict) else ""
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("image/"):
        return "image"
    ext = Path(urlparse(raw_url).path).suffix.lower().lstrip(".")
    if ext in VIDEO_EXTS:
        return "video"
    if ext in IMAGE_EXTS:
        return "image"
    return ""


def imagine_asset_upload_only(asset: dict) -> bool:
    if not isinstance(asset, dict):
        return False
    source_text = " ".join(str(asset.get(key) or "") for key in ("source", "fileSource", "file_source", "mediaSource"))
    if "UPLOADED" not in source_text.upper():
        return False
    post_keys = ("postId", "mediaPostId", "rootPostId", "originalPostId", "parentPostId")
    return not any(str(asset.get(key) or "").strip() for key in post_keys)


def imagine_asset_group_key(asset: dict, fallback: str) -> str:
    for key in (
        "assetId",
        "id",
        "postId",
        "mediaPostId",
    ):
        value = str(asset.get(key) or "").strip()
        if value:
            return f"asset:{value}"
    raw_url = imagine_asset_primary_media_url(asset)
    url_key = canonical_remote_media_key(raw_url)
    if url_key:
        return f"url:{url_key}"
    return fallback


def imagine_unsaved_post_from_asset(asset: dict, account: dict) -> dict | None:
    if not isinstance(asset, dict):
        return None
    raw_url = imagine_asset_primary_media_url(asset)
    kind = imagine_asset_media_kind(asset, raw_url)
    if kind not in {"image", "video"} or not raw_url:
        return None
    asset_id = str(asset.get("assetId") or asset.get("id") or asset.get("postId") or file_stem(Path(urlparse(raw_url).path).name) or uuid.uuid4().hex)
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    preview_url = raw_url if kind == "image" else imagine_asset_preview_url(asset, "")
    proxied_url = imagine_saved_proxy_url(raw_url, kind, account_id_value)
    proxied_preview = imagine_saved_proxy_url(preview_url, "image", account_id_value) if preview_url else (proxied_url if kind == "image" else "")
    created_at = str(asset.get("lastUseTime") or asset.get("updateTime") or asset.get("createTime") or now_iso())
    title = str(asset.get("name") or asset.get("title") or asset_id).strip()
    prompt = imagine_text_value(asset.get("prompt") or asset.get("metadata") or "")
    item = {
        "item_id": asset_id,
        "type": kind,
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": proxied_url,
        "thumbnail_url": proxied_preview,
        "mime_type": "video/mp4" if kind == "video" else str(asset.get("mimeType") or "image/*"),
        "role": "result",
        "relation": "unsaved",
        "title": title,
        "prompt": prompt,
        "created_at": created_at,
        "asset_id": asset_id,
        "liked": False,
        "favorite": False,
        "metadata": {
            "remote_url": raw_url,
            "media_url": raw_url,
            "asset_id": asset_id,
            "root_asset_id": asset.get("rootAssetId") or "",
            "file_source": asset.get("fileSource") or asset.get("source") or "",
            "account_id": account_id_value,
            "account_email": account_email,
            "remote_view": "unsaved",
            "liked": False,
            "imagine": {
                "asset_id": asset_id,
                "post_id": str(asset.get("postId") or asset.get("mediaPostId") or asset_id),
                "media_url": raw_url,
                "media_type": kind,
                "remote_view": "unsaved",
                "liked": False,
                "account_id": account_id_value,
                "account_email": account_email,
            },
        },
    }
    return {
        "post_id": asset_id,
        "source": "imagine",
        "mode": "unsaved",
        "area": "imagine_remote",
        "remote": True,
        "liked": False,
        "favorite": False,
        "title": title or "Imagine",
        "prompt": prompt,
        "created_at": created_at,
        "folder_path": f"imagine_unsaved/{asset_id}",
        "folderName": title or asset_id,
        "representative": raw_url,
        "representative_item": item,
        "items": [item],
        "account_id": account_id_value,
        "account_email": account_email,
        "metadata": {
            "imagine_asset_id": asset_id,
            "file_source": asset.get("fileSource") or asset.get("source") or "",
            "remote_view": "unsaved",
            "liked": False,
        },
    }


def merge_imagine_unsaved_asset_post(groups: dict[str, dict], post: dict, group_key: str) -> None:
    existing = groups.get(group_key)
    if not existing:
        post["post_id"] = group_key
        post["folder_path"] = f"imagine_unsaved/{group_key}"
        post["metadata"] = post.get("metadata") if isinstance(post.get("metadata"), dict) else {}
        post["metadata"]["group_id"] = group_key
        groups[group_key] = post
        return
    known_ids = {str(item.get("item_id") or "") for item in existing.get("items") or []}
    for item in post.get("items") or []:
        item_id = str(item.get("item_id") or "")
        if item_id and item_id in known_ids:
            continue
        existing.setdefault("items", []).append(item)
        if item_id:
            known_ids.add(item_id)
    representative = imagine_representative_item(existing.get("items") or []) or existing.get("representative_item")
    if isinstance(representative, dict):
        existing["representative_item"] = representative
        existing["representative"] = representative.get("url") or representative.get("remote_url") or representative.get("item_id") or existing.get("representative") or ""


def list_imagine_unsaved(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    try:
        limit = int((payload or {}).get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 40))
    cursor = str((payload or {}).get("cursor") or "").strip()
    saved_keys = imagine_saved_media_keys_cached(account, max_posts=160)
    grouped_posts: dict[str, dict] = {}
    next_cursor = cursor
    current_cursor = cursor
    pages_scanned = 0
    seen_paths: set[str] = set()
    while len(grouped_posts) < limit and pages_scanned < 12:
        query_parts = [
            ("pageSize", str(max(80, limit * 4))),
            ("orderBy", "ORDER_BY_LAST_USE_TIME"),
            ("source", "SOURCE_ANY"),
            ("isLatest", "true"),
            ("includeImagineFiles", "true"),
        ]
        if current_cursor:
            query_parts.append(("pageToken", current_cursor))
            query_parts.append(("cursor", current_cursor))
        data = imagine_get_json(f"/rest/assets?{urlencode(query_parts)}", account)
        assets = data.get("assets") if isinstance(data.get("assets"), list) else []
        next_cursor = str(
            data.get("nextPageToken")
            or data.get("nextCursor")
            or data.get("next_page_token")
            or data.get("cursor")
            or ""
        ).strip()
        for asset in assets:
            if not isinstance(asset, dict) or imagine_asset_upload_only(asset):
                continue
            asset_keys = imagine_asset_key_values(asset)
            if asset_keys & saved_keys:
                continue
            post = imagine_unsaved_post_from_asset(asset, account)
            if not post:
                continue
            group_key = imagine_asset_group_key(asset, str(post.get("post_id") or ""))
            merge_imagine_unsaved_asset_post(grouped_posts, post, group_key)
            folder_path = f"imagine_unsaved/{group_key}"
            if folder_path in seen_paths:
                pass
            seen_paths.add(folder_path)
            if len(grouped_posts) >= limit:
                break
        pages_scanned += 1
        if not next_cursor or next_cursor == current_cursor:
            break
        current_cursor = next_cursor
    posts = list(grouped_posts.values())[:limit]
    return {
        "ok": True,
        "source": "unsaved",
        "url": IMAGINE_BASE + "/files",
        "posts": posts,
        "items": posts,
        "cursor": cursor,
        "next_cursor": next_cursor if next_cursor != cursor else "",
        "has_more": bool(next_cursor and next_cursor != cursor),
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def imagine_upload_cache_record_for_asset(root: Path | None, asset_id: str, raw_url: str) -> tuple[str, dict]:
    if not root:
        return "", {}
    for cache_key, record in imagine_upload_asset_cache(root).items():
        if not isinstance(record, dict):
            continue
        file_id = str(record.get("file_id") or record.get("post_id") or "").strip()
        file_url = str(record.get("file_url") or "").strip()
        if file_id != asset_id and file_url != raw_url:
            continue
        upload_hash = str(record.get("upload_hash") or "").strip()
        if not upload_hash and ":" in str(cache_key):
            upload_hash = str(cache_key).split(":", 1)[1].strip()
        cached = dict(record)
        if upload_hash:
            cached["upload_hash"] = upload_hash
        return str(cache_key), cached
    return "", {}


def imagine_upload_post_from_asset(asset: dict, account: dict, root: Path | None = None) -> dict | None:
    if not isinstance(asset, dict):
        return None
    asset_id = str(asset.get("assetId") or asset.get("id") or "").strip()
    raw_url = imagine_asset_url(str(asset.get("key") or asset.get("url") or ""))
    if not asset_id or not raw_url:
        return None
    mime_type = str(asset.get("mimeType") or asset.get("mime_type") or "image/jpeg")
    if not mime_type.startswith("image/"):
        return None
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    preview_url = imagine_asset_preview_url(asset, raw_url)
    proxied_url = imagine_saved_proxy_url(raw_url, "image", account_id_value)
    proxied_preview = imagine_saved_proxy_url(preview_url, "image", account_id_value) if preview_url else proxied_url
    _, cached_upload = imagine_upload_cache_record_for_asset(root, asset_id, raw_url)
    cached_name = str(cached_upload.get("name") or "").strip()
    upload_hash = str(cached_upload.get("upload_hash") or "").strip()
    name = str(asset.get("name") or cached_name or asset_id)
    created_at = str(asset.get("lastUseTime") or asset.get("createTime") or now_iso())
    item = {
        "item_id": asset_id,
        "type": "image",
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": proxied_url,
        "thumbnail_url": proxied_preview,
        "mime_type": mime_type,
        "role": "source",
        "relation": "upload",
        "title": name,
        "prompt": "",
        "created_at": created_at,
        "asset_id": asset_id,
        "upload_hash": upload_hash,
        "metadata": {
            "remote_url": raw_url,
            "media_url": raw_url,
            "asset_id": asset_id,
            "root_asset_id": asset.get("rootAssetId") or "",
            "upload_hash": upload_hash,
            "cached_upload_name": cached_name,
            "file_source": asset.get("fileSource") or "",
            "account_id": account_id_value,
            "account_email": account_email,
            "imagine": {
                "asset_id": asset_id,
                "media_url": raw_url,
                "media_type": "image",
                "upload_hash": upload_hash,
                "account_id": account_id_value,
                "account_email": account_email,
            },
        },
    }
    return {
        "post_id": asset_id,
        "source": "imagine",
        "mode": "upload",
        "area": "imagine_upload_remote",
        "remote": True,
        "title": name,
        "prompt": "",
        "created_at": created_at,
        "folder_path": f"imagine_uploads/{asset_id}",
        "folderName": name,
        "representative": raw_url,
        "representative_item": item,
        "items": [item],
        "account_id": account_id_value,
        "account_email": account_email,
        "metadata": {
            "imagine_asset_id": asset_id,
            "file_source": asset.get("fileSource") or "",
        },
    }


def list_imagine_uploads(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    try:
        page_size = int((payload or {}).get("limit") or 24)
    except (TypeError, ValueError):
        page_size = 24
    page_size = max(1, min(page_size, 24))
    query = urlencode([
        ("pageSize", str(page_size)),
        ("mimeTypes", "image/jpeg"),
        ("mimeTypes", "image/jpg"),
        ("mimeTypes", "image/png"),
        ("mimeTypes", "image/webp"),
        ("orderBy", "ORDER_BY_LAST_USE_TIME"),
        ("source", "SOURCE_UPLOADED"),
        ("includeImagineFiles", "true"),
    ])
    data = imagine_get_json(f"/rest/assets?{query}", account)
    assets = data.get("assets") if isinstance(data.get("assets"), list) else []
    posts = [post for post in (imagine_upload_post_from_asset(asset, account, root) for asset in assets) if post]
    return {
        "ok": True,
        "source": "uploaded",
        "posts": posts,
        "items": posts,
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def imagine_media_post_action(payload: dict, action: str) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    payload = payload or {}
    post_id_value = str(
        payload.get("id")
        or payload.get("post_id")
        or payload.get("item_id")
        or ""
    ).strip()
    if not post_id_value:
        raise RuntimeError("Imagine post id is required.")
    account = active_imagine_account(root, str(payload.get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    media_url = str(
        payload.get("media_url")
        or payload.get("remote_url")
        or payload.get("url")
        or metadata.get("media_url")
        or metadata.get("remote_url")
        or imagine.get("media_url")
        or ""
    ).strip()
    media_url = imagine_remote_url(imagine_unwrap_remote_proxy(media_url)) or media_url
    media_type = str(payload.get("type") or payload.get("media_type") or imagine.get("media_type") or "").strip().lower()
    media_post_type = "MEDIA_POST_TYPE_VIDEO" if media_type == "video" else "MEDIA_POST_TYPE_IMAGE"
    imagine_action = str(
        payload.get("mode")
        or payload.get("action")
        or metadata.get("mode")
        or metadata.get("generated_action")
        or imagine.get("action")
        or imagine.get("generated_action")
        or ""
    ).strip().lower()
    action_name = "delete" if action == "delete" else "unsave"
    path = "/rest/media/post/delete" if action_name == "delete" else "/rest/media/post/unlike"
    deleted_id = post_id_value
    try:
        result = imagine_post_json(path, {"id": post_id_value}, account, timeout=15)
    except RuntimeError as exc:
        text = str(exc)
        post_not_found = "Media post not found" in text or "HTTP 404" in text
        can_create_delete = (
            action_name == "delete"
            and imagine_action == "t2i"
            and bool(media_url)
            and post_not_found
        )
        if not can_create_delete:
            raise
        create_result = imagine_post_json(
            "/rest/media/post/create",
            {
                "mediaType": media_post_type,
                "mediaUrl": media_url,
            },
            account,
            timeout=15,
            referer=IMAGINE_BASE + "/imagine",
        )
        post = create_result.get("post") if isinstance(create_result.get("post"), dict) else {}
        deleted_id = imagine_post_id(post, extract_imagine_post_id_from_text(media_url) or post_id_value)
        if not deleted_id:
            raise RuntimeError("Imagine post id could not be resolved for delete.") from exc
        result = imagine_post_json(path, {"id": deleted_id}, account, timeout=15)
        imagine_debug_event("t2i_delete_create_then_delete", {
            "requested_id": post_id_value,
            "deleted_id": deleted_id,
            "media_url": imagine_debug_compact_url(media_url),
            "media_type": media_post_type,
        })
    return {
        "ok": True,
        "action": action_name,
        "id": deleted_id,
        "requested_id": post_id_value,
        "result": result,
        "imagine": {
            "id": account.get("id") or "",
            "email": account.get("email") or "",
            "label": account.get("label") or "",
            "tier": account.get("tier") or "",
        },
    }


def delete_imagine_media_post(payload: dict) -> dict:
    return imagine_media_post_action(payload, "delete")


def like_imagine_media_post(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    targets: list[dict] = []
    raw_items = (payload or {}).get("items")
    if isinstance(raw_items, list):
        targets.extend(item for item in raw_items if isinstance(item, dict))
    targets.append(payload or {})
    liked_ids: list[str] = []
    results: list[dict] = []
    errors: list[str] = []

    def media_type_for_target(target: dict) -> str:
        kind = str(target.get("type") or target.get("media_type") or "").strip().lower()
        return "MEDIA_POST_TYPE_VIDEO" if kind == "video" else "MEDIA_POST_TYPE_IMAGE"

    def media_url_for_target(target: dict) -> str:
        metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
        imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
        return str(
            target.get("media_url")
            or target.get("remote_url")
            or target.get("url")
            or metadata.get("media_url")
            or metadata.get("remote_url")
            or imagine.get("media_url")
            or ""
        ).strip()

    def id_for_target(target: dict) -> str:
        metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
        imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
        raw_id = str(
            target.get("id")
            or target.get("post_id")
            or target.get("item_id")
            or imagine.get("post_id")
            or metadata.get("post_id")
            or ""
        ).strip()
        return imagine_post_id_from_value(raw_id) or raw_id

    for target in targets:
        post_id_value = id_for_target(target)
        media_url = media_url_for_target(target)
        if post_id_value and post_id_value in liked_ids:
            continue
        try:
            if not post_id_value:
                raise RuntimeError("missing post id")
            result = imagine_post_json("/rest/media/post/like", {"id": post_id_value}, account, timeout=15)
        except Exception as exc:
            if not media_url:
                errors.append(str(exc)[:240])
                continue
            try:
                create_result = imagine_post_json(
                    "/rest/media/post/create",
                    {
                        "mediaType": media_type_for_target(target),
                        "mediaUrl": media_url,
                    },
                    account,
                    timeout=15,
                    referer=IMAGINE_BASE + "/files",
                )
                post = create_result.get("post") if isinstance(create_result.get("post"), dict) else {}
                post_id_value = imagine_post_id(post, post_id_value or extract_imagine_post_id_from_text(media_url))
                if not post_id_value:
                    raise RuntimeError("Imagine post id could not be resolved.")
                result = imagine_post_json("/rest/media/post/like", {"id": post_id_value}, account, timeout=15, referer=IMAGINE_BASE + "/files")
            except Exception as fallback_exc:
                errors.append(str(fallback_exc)[:240])
                continue
        liked_ids.append(post_id_value)
        results.append(result if isinstance(result, dict) else {"result": result})
    if not liked_ids:
        raise RuntimeError("Imagine post like failed. " + "; ".join(errors[-2:]))
    return {
        "ok": True,
        "action": "like",
        "id": liked_ids[0],
        "ids": liked_ids,
        "result": results[0] if results else {},
        "results": results,
    }


def unsave_imagine_media_post(payload: dict) -> dict:
    return imagine_media_post_action(payload, "unsave")


def normalize_imagine_upscale_resolution(value) -> str:
    text = str(value or "").strip().lower()
    if text in {"1080", "1080p", "hd1080", "fhd", "fullhd", "full_hd"}:
        return "1080p"
    return "720p"


def imagine_upscale_url_from_post(post: dict, resolution: str) -> str:
    if not isinstance(post, dict):
        return ""
    key = "hd1080MediaUrl" if resolution == "1080p" else "hdMediaUrl"
    return imagine_remote_url(post.get(key))


def upscale_imagine_video_post(payload: dict, progress_callback=None, cancel_checker=None) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    payload = payload or {}
    account = active_imagine_account(root, str(payload.get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    post_id = imagine_direct_post_id_from_item({
        **payload,
        "metadata": metadata,
    }) or imagine_post_id_from_value(str(
        payload.get("video_id")
        or payload.get("videoId")
        or imagine.get("video_id")
        or imagine.get("videoId")
        or ""
    ))
    post_id = extract_imagine_post_id_from_text(post_id) or post_id
    if not post_id:
        raise RuntimeError("Imagine video post id is required.")
    resolution = normalize_imagine_upscale_resolution(payload.get("resolution") or payload.get("target_resolution"))
    if resolution == "1080p" and normalize_account_tier(account.get("tier")) != "heavy":
        raise RuntimeError("1080p Imagine upscale requires a Heavy account.")
    request_id = str(uuid.uuid4())
    referer = IMAGINE_BASE + "/imagine/post/" + quote(post_id)
    body = {"videoId": post_id}
    if resolution == "1080p":
        body["targetResolution"] = "UPSCALE_TARGET_RESOLUTION_1080P"
    imagine_debug_event("video_upscale_request", {
        "request_id": request_id,
        "post_id": post_id,
        "resolution": resolution,
        "target_resolution": body.get("targetResolution") or "",
    })
    if progress_callback:
        progress_callback(1, "running", {"action": "upscale", "request_id": request_id})

    post_before = imagine_post_detail(post_id, account, timeout=12)
    if cancel_checker and cancel_checker():
        raise JobCancelled("Job cancelled.")
    existing_url = imagine_upscale_url_from_post(post_before, resolution)
    if existing_url and imagine_remote_media_available(existing_url, account, "video", timeout=8):
        if progress_callback:
            progress_callback(94, "running", {"action": "upscale", "request_id": request_id})
        imagine_debug_event("video_upscale_existing", {
            "request_id": request_id,
            "post_id": post_id,
            "resolution": resolution,
            "url": imagine_debug_compact_url(existing_url),
        })
        return {
            "ok": True,
            "action": "upscale",
            "id": post_id,
            "resolution": resolution,
            "hd_media_url": existing_url if resolution != "1080p" else "",
            "hd1080_media_url": existing_url if resolution == "1080p" else "",
            "media_url": existing_url,
            "post": post_before,
            "source_post_path": str(payload.get("source_post_path") or ""),
            "source_item_id": str(payload.get("source_item_id") or payload.get("item_id") or post_id),
            "selected_item_id": str(payload.get("source_item_id") or payload.get("item_id") or post_id),
        }

    if progress_callback:
        progress_callback(16, "running", {"action": "upscale", "request_id": request_id})
    result = imagine_post_json("/rest/media/video/upscale", body, account, timeout=240, referer=referer)
    direct_url = imagine_remote_url(result.get("hd1080MediaUrl" if resolution == "1080p" else "hdMediaUrl"))
    updated_post = post_before
    if direct_url and imagine_remote_media_available(direct_url, account, "video", timeout=8):
        if progress_callback:
            progress_callback(70, "running", {"action": "upscale", "request_id": request_id})
        updated_post = imagine_post_detail(post_id, account, timeout=12) or post_before
        imagine_debug_event("video_upscale_response", {
            "request_id": request_id,
            "post_id": post_id,
            "resolution": resolution,
            "url": imagine_debug_compact_url(direct_url),
            "response_keys": sorted(result.keys()) if isinstance(result, dict) else [],
        })
    else:
        started = time.time()
        deadline = started + 240
        while time.time() < deadline:
            if cancel_checker and cancel_checker():
                raise JobCancelled("Job cancelled.")
            time.sleep(5)
            if progress_callback:
                progress_callback(elapsed_display_progress(started, deadline, 16, 92), "running", {"action": "upscale", "request_id": request_id})
            updated_post = imagine_post_detail(post_id, account, timeout=12) or updated_post
            direct_url = imagine_upscale_url_from_post(updated_post, resolution)
            if direct_url and imagine_remote_media_available(direct_url, account, "video", timeout=8):
                break
        if not direct_url:
            imagine_debug_event("video_upscale_timeout", {
                "request_id": request_id,
                "post_id": post_id,
                "resolution": resolution,
                "response_keys": sorted(result.keys()) if isinstance(result, dict) else [],
            })
            raise RuntimeError("Timed out waiting for the Imagine upscale video URL.")

    if progress_callback:
        progress_callback(94, "running", {"action": "upscale", "request_id": request_id})
    return {
        "ok": True,
        "action": "upscale",
        "id": post_id,
        "resolution": resolution,
        "hd_media_url": direct_url if resolution != "1080p" else "",
        "hd1080_media_url": direct_url if resolution == "1080p" else "",
        "media_url": direct_url,
        "post": updated_post,
        "result": result,
        "source_post_path": str(payload.get("source_post_path") or ""),
        "source_item_id": str(payload.get("source_item_id") or payload.get("item_id") or post_id),
        "selected_item_id": str(payload.get("source_item_id") or payload.get("item_id") or post_id),
    }


def crop_imagine_image_post(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    payload = payload or {}
    account = active_imagine_account(root, str(payload.get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")

    image_data = str(payload.get("image_data") or payload.get("data_url") or "").strip()
    if not image_data.startswith("data:image/"):
        raise RuntimeError("Crop result image is missing.")
    mime_type = data_url_mime_type(image_data) or "image/png"
    image_bytes = decode_data_url(image_data)
    request_id = str(payload.get("request_id") or uuid.uuid4()).strip()
    source_metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    source_imagine = source_metadata.get("imagine") if isinstance(source_metadata.get("imagine"), dict) else {}
    original_post_id = (
        extract_imagine_post_id_from_text(payload.get("id"))
        or extract_imagine_post_id_from_text(payload.get("post_id"))
        or extract_imagine_post_id_from_text(payload.get("item_id"))
        or extract_imagine_post_id_from_text(source_imagine.get("post_id"))
        or extract_imagine_post_id_from_text(source_metadata.get("post_id"))
    )
    if not original_post_id:
        raise RuntimeError("Imagine crop source post id is missing.")

    source_info = {
        "parent_post_id": original_post_id,
        "original_post_id": original_post_id,
        "root_post_id": str(
            payload.get("root_post_id")
            or source_imagine.get("root_post_id")
            or source_metadata.get("root_post_id")
            or source_metadata.get("imagine_root_post_id")
            or original_post_id
        ),
        "source_item_id": str(payload.get("source_item_id") or payload.get("item_id") or original_post_id),
        "original_ref_type": "ORIGINAL_REF_TYPE_IMAGE_EDIT",
    }

    def build_crop_response(post_node: dict, file_id: str, media_url: str, create_result: dict, upload_metadata: dict, bridge_value: dict | None = None) -> dict:
        post_id = imagine_post_id(post_node, file_id)
        created_url = imagine_node_primary_media_url(post_node) or media_url
        item = imagine_direct_item_from_candidate(
            {
                "url": created_url,
                "post_id": post_id or file_id,
                "parent_post_id": original_post_id,
                "original_post_id": original_post_id,
                "root_post_id": source_info["root_post_id"],
                "original_ref_type": "ORIGINAL_REF_TYPE_IMAGE_EDIT",
                "created_at": imagine_post_time(post_node) or now_iso(),
                "prompt": str(payload.get("prompt") or ""),
                "model": "imagine-image-edit",
            },
            "image",
            account,
            str(payload.get("prompt") or ""),
            "crop",
            request_id,
            source_info,
        )
        item["mime_type"] = str(upload_metadata.get("fileMimeType") or mime_type)
        item["title"] = "cropped"
        item["aspect_ratio"] = str(payload.get("aspect_ratio") or "")
        item["aspectRatio"] = str(payload.get("aspect_ratio") or "")
        item.setdefault("metadata", {})
        if isinstance(item["metadata"], dict):
            item["metadata"]["crop"] = {
                "source_post_id": original_post_id,
                "request_id": request_id,
                "bridge": bool(bridge_value),
            }
        imagine_debug_event("image_crop_result", {
            "request_id": request_id,
            "source_post_id": original_post_id,
            "post_id": post_id or file_id,
            "media_url": imagine_debug_compact_url(created_url),
            "bridge": bool(bridge_value),
            "store_update": (bridge_value or {}).get("storeUpdate") if isinstance((bridge_value or {}).get("storeUpdate"), dict) else {},
        })
        return {
            "ok": True,
            "action": "crop",
            "id": post_id or file_id,
            "source_post_path": str(payload.get("source_post_path") or ""),
            "source_item_id": str(payload.get("source_item_id") or payload.get("item_id") or ""),
            "selected_item_id": item.get("item_id") or "",
            "item": item,
            "items": [item],
            "post": post_node,
            "result": create_result,
            "bridge": bool(bridge_value),
        }

    if native_bridge_wait_available(timeout_seconds=2, max_age_seconds=60):
        try:
            bridge_value = native_bridge_account_command(
                root,
                account,
                "crop_image",
                {
                    "request_id": request_id,
                    "url": IMAGINE_BASE + "/imagine/post/" + quote(original_post_id),
                    "referer": IMAGINE_BASE + "/imagine/post/" + quote(original_post_id),
                    "source_post_id": original_post_id,
                    "source_container_id": source_info["root_post_id"] or original_post_id,
                    "image_data": image_data,
                    "file_name": "cropped.png",
                    "mime_type": mime_type,
                },
                timeout_seconds=80,
            )
            create_result = bridge_value.get("result") if isinstance(bridge_value.get("result"), dict) else {}
            post_node = bridge_value.get("post") if isinstance(bridge_value.get("post"), dict) else {}
            if not post_node:
                post_node = create_result.get("post") if isinstance(create_result.get("post"), dict) else {}
            upload_result = bridge_value.get("upload") if isinstance(bridge_value.get("upload"), dict) else {}
            upload_metadata = upload_result.get("fileMetadata") if isinstance(upload_result.get("fileMetadata"), dict) else {}
            file_id = str(bridge_value.get("fileId") or upload_metadata.get("fileMetadataId") or "").strip()
            media_url = str(bridge_value.get("mediaUrl") or "").strip()
            if not media_url:
                media_url = imagine_node_primary_media_url(post_node) or imagine_asset_url(str(upload_metadata.get("fileUri") or ""))
            if not file_id:
                file_id = imagine_post_id(post_node, extract_imagine_post_id_from_text(media_url))
            if not file_id or not media_url:
                raise RuntimeError("Imagine crop bridge response did not include media.")
            return build_crop_response(post_node, file_id, media_url, create_result, upload_metadata, bridge_value)
        except Exception as exc:
            imagine_debug_event("image_crop_bridge_failed", {
                "request_id": request_id,
                "source_post_id": original_post_id,
                "error": str(exc)[:800],
            })

    upload_result = imagine_upload_file_direct(account, "cropped.png", mime_type, image_bytes, request_id, "crop")
    upload_metadata = upload_result.get("fileMetadata") if isinstance(upload_result.get("fileMetadata"), dict) else {}
    file_id = str(upload_metadata.get("fileMetadataId") or "").strip()
    file_uri = str(upload_metadata.get("fileUri") or "").strip()
    media_url = imagine_asset_url(file_uri)
    if not file_id or not media_url:
        raise RuntimeError("Imagine crop upload response did not include media.")

    create_result = imagine_post_json(
        "/rest/media/post/create",
        {
            "mediaType": "MEDIA_POST_TYPE_IMAGE",
            "mediaUrl": media_url,
            "originalPostId": original_post_id,
            "originalRefType": "ORIGINAL_REF_TYPE_IMAGE_EDIT",
        },
        account,
        timeout=30,
        referer=IMAGINE_BASE + "/imagine/post/" + quote(original_post_id),
    )
    post_node = create_result.get("post") if isinstance(create_result.get("post"), dict) else {}
    return build_crop_response(post_node, file_id, media_url, create_result, upload_metadata)


def imagine_unwrap_remote_proxy(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = urlparse(text)
        if parsed.path == "/api/imagine/remote/media":
            nested = parse_qs(parsed.query, keep_blank_values=True).get("url", [""])[0]
            return str(nested or text).strip()
    except Exception:
        return text
    return text


def imagine_attachment_raw_url(attachment: dict) -> str:
    root = library_root()
    for key in ("raw_url", "remote_url", "media_url", "mediaUrl", "url", "source_url", "object_url", "data_url"):
        value = imagine_unwrap_remote_proxy(str(attachment.get(key) or ""))
        if root and local_media_source_from_url(root, value):
            continue
        if value.startswith("http://") or value.startswith("https://"):
            return value
    return ""


def imagine_attachment_id(attachment: dict, *keys: str) -> str:
    for key in keys:
        value = str(attachment.get(key) or "").strip()
        if value:
            return value
    return ""


def imagine_asset_conversation_context(attachment: dict, account: dict | None) -> tuple[str, str]:
    if not account:
        return "", ""
    asset_id = ""
    for key in ("item_id", "detail_item_id", "source_item_id", "post_id", "asset_id"):
        asset_id = extract_imagine_post_id_from_text(attachment.get(key))
        if asset_id:
            break
    if not asset_id:
        asset_id = extract_imagine_post_id_from_text(imagine_attachment_raw_url(attachment))
    if not asset_id:
        return "", ""
    try:
        metadata = imagine_get_json(
            f"/rest/assets/{quote(asset_id, safe='')}",
            account,
            timeout=12,
        )
    except Exception as exc:
        imagine_debug_event("source_asset_context_failed", {
            "asset_id": asset_id,
            "error": str(exc)[:400],
        })
        return "", ""
    conversation_id = str(
        metadata.get("sourceConversationId")
        or metadata.get("rootAssetSourceConversationId")
        or ""
    ).strip()
    response_id = str(metadata.get("responseId") or "").strip()
    if conversation_id:
        imagine_debug_event("source_asset_context_resolved", {
            "asset_id": asset_id,
            "conversation_id": conversation_id,
            "response_id": response_id,
        })
    return conversation_id, response_id


def imagine_source_conversation_context(
    payload: dict,
    attachment: dict | None,
    account: dict | None = None,
) -> tuple[str, str]:
    source = attachment if isinstance(attachment, dict) else {}
    if source.get("_imagine_uploaded_direct") or imagine_attachment_upload_like(source):
        return "", ""
    conversation_id = str(
        source.get("conversation_id")
        or source.get("source_conversation_id")
        or payload.get("source_conversation_id")
        or payload.get("conversation_id")
        or ""
    ).strip()
    parent_response_id = str(
        source.get("parent_response_id")
        or source.get("response_id")
        or payload.get("parent_response_id")
        or ""
    ).strip()
    if not conversation_id:
        asset_conversation_id, asset_response_id = imagine_asset_conversation_context(source, account)
        if asset_conversation_id:
            return asset_conversation_id, asset_response_id or parent_response_id
    return conversation_id, parent_response_id


def imagine_detail_referer(post_id: str, conversation_id: str = "") -> str:
    post_value = str(post_id or "").strip()
    conversation_value = str(conversation_id or "").strip()
    if not post_value:
        return IMAGINE_BASE + "/imagine"
    path = IMAGINE_BASE + "/imagine/post/" + quote(post_value, safe="")
    if conversation_value:
        path += "?" + urlencode({"conversation": conversation_value})
    return path


def imagine_attachment_upload_file_name(attachment: dict, mime_type: str) -> str:
    raw_name = str(attachment.get("name") or attachment.get("file") or attachment.get("title") or "").strip()
    name = safe_name(Path(raw_name).name, "") if raw_name else ""
    fallback_ext = extension_from_mime_type(mime_type, "png")
    if not name:
        return f"imagine-upload-{uuid.uuid4().hex[:8]}.{fallback_ext}"
    if not extension_for(name):
        name = f"{name}.{fallback_ext}"
    return name


def imagine_attachment_local_upload_source(attachment: dict) -> tuple[str, str, bytes] | None:
    data_url = str(attachment.get("data_url") or "").strip()
    mime_type = str(attachment.get("type") or attachment.get("mime_type") or attachment.get("mime") or "").strip().lower()
    if data_url.startswith("data:"):
        mime_type = data_url_mime_type(data_url) or mime_type or "image/png"
        return imagine_attachment_upload_file_name(attachment, mime_type), mime_type, decode_data_url(data_url)
    root = library_root()
    if not root:
        return None
    for key in ("source_url", "raw_url", "url", "object_url"):
        raw_url = str(attachment.get(key) or "").strip()
        if not raw_url:
            continue
        source = local_media_source_from_url(root, raw_url)
        if not source:
            continue
        guessed = mimetypes.guess_type(source.name)[0] or mime_type or "image/png"
        return imagine_attachment_upload_file_name({**attachment, "name": source.name}, guessed), guessed, source.read_bytes()
    return None


def imagine_mark_attachment_uploaded_file(attachment: dict, file_id: str, file_url: str, mime_type: str = "") -> None:
    if not file_id or not file_url:
        return
    attachment["_imagine_file_attachment_id"] = file_id
    attachment["_imagine_uploaded_asset_id"] = file_id
    attachment["asset_id"] = file_id
    attachment["raw_url"] = file_url
    attachment["remote_url"] = file_url
    attachment["media_url"] = file_url
    attachment["url"] = file_url
    if mime_type:
        attachment["type"] = mime_type
        attachment["mime_type"] = mime_type


def imagine_local_upload_cache_key(data: bytes, mime_type: str) -> str:
    digest = hashlib.sha256(data or b"").hexdigest()
    return f"{str(mime_type or '').lower()}:{digest}"


def imagine_upload_asset_cache(root: Path) -> dict:
    library = merge_library_json(read_json(root / "library.json", {}))
    settings = library.get("settings") if isinstance(library.get("settings"), dict) else {}
    cache = settings.get("imagine_upload_asset_cache")
    return cache if isinstance(cache, dict) else {}


def remember_imagine_upload_asset_cache(root: Path, key: str, record: dict) -> None:
    if not key:
        return
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})
    cache = settings.get("imagine_upload_asset_cache") if isinstance(settings.get("imagine_upload_asset_cache"), dict) else {}
    upload_hash = str(record.get("upload_hash") or "").strip()
    if not upload_hash and ":" in key:
        upload_hash = key.split(":", 1)[1].strip()
    cache[key] = {
        "file_id": str(record.get("file_id") or ""),
        "file_url": str(record.get("file_url") or ""),
        "post_id": str(record.get("post_id") or ""),
        "mime_type": str(record.get("mime_type") or ""),
        "name": str(record.get("name") or ""),
        "upload_hash": upload_hash,
        "updated_at": now_iso(),
    }
    settings["imagine_upload_asset_cache"] = cache
    library["updated_at"] = now_iso()
    write_json(library_path, library)


def apply_cached_imagine_upload_asset(attachment: dict, account: dict, request_id: str, action: str, cache_key: str, promote_post: bool = True) -> bool:
    root = library_root()
    if not root or not cache_key:
        return False
    cached = imagine_upload_asset_cache(root).get(cache_key)
    if not isinstance(cached, dict):
        return False
    file_url = str(cached.get("file_url") or "").strip()
    file_id = str(cached.get("file_id") or cached.get("post_id") or "").strip()
    if not file_url or not file_id:
        return False
    if not imagine_remote_media_available(file_url, account, "image", timeout=4):
        return False
    imagine_mark_attachment_uploaded_file(attachment, file_id, file_url, str(cached.get("mime_type") or attachment.get("type") or "image/png"))
    post_id = str(cached.get("post_id") or "").strip()
    if post_id and promote_post:
        attachment["post_id"] = post_id
        attachment["parent_post_id"] = post_id
        attachment["root_post_id"] = post_id
    attachment["_imagine_upload_cache_key"] = cache_key
    attachment["_imagine_uploaded_direct"] = True
    imagine_debug_event("direct_local_upload_cache_hit", {
        "request_id": request_id,
        "action": action,
        "file_id": file_id,
        "media_url": file_url,
        "post_id": post_id,
        "promote_post": promote_post,
    })
    return True


def imagine_prepare_direct_image_attachments(attachments: list[dict], account: dict, request_id: str, action: str, promote_cached_post: bool = True) -> None:
    for index, attachment in enumerate(attachments):
        if not isinstance(attachment, dict):
            continue
        raw_url = imagine_attachment_raw_url(attachment)
        asset_id = imagine_attachment_id(attachment, "asset_id")
        if raw_url:
            if asset_id:
                attachment["_imagine_file_attachment_id"] = asset_id
            continue
        source = imagine_attachment_local_upload_source(attachment)
        if not source:
            continue
        file_name, mime_type, data = source
        cache_key = imagine_local_upload_cache_key(data, mime_type)
        attachment["_imagine_upload_cache_key"] = cache_key
        if apply_cached_imagine_upload_asset(attachment, account, request_id, action, cache_key, promote_cached_post):
            continue
        result = imagine_upload_file_direct(account, file_name, mime_type, data, request_id, action)
        metadata = result.get("fileMetadata") if isinstance(result.get("fileMetadata"), dict) else {}
        file_id = str(metadata.get("fileMetadataId") or "").strip()
        file_uri = str(metadata.get("fileUri") or "").strip()
        file_url = imagine_asset_url(file_uri)
        imagine_mark_attachment_uploaded_file(attachment, file_id, file_url, str(metadata.get("fileMimeType") or mime_type))
        attachment["_imagine_uploaded_direct"] = True
        attachment["_imagine_upload_cache_key"] = cache_key
        root = library_root()
        if root:
            remember_imagine_upload_asset_cache(root, cache_key, {
                "file_id": file_id,
                "file_url": file_url,
                "post_id": "",
                "mime_type": str(metadata.get("fileMimeType") or mime_type),
                "name": file_name,
                "upload_hash": cache_key.split(":", 1)[1] if ":" in cache_key else "",
            })
        imagine_debug_event("direct_local_upload_attached", {
            "request_id": request_id,
            "action": action,
            "index": index,
            "file_metadata_id": file_id,
            "file_url": file_url,
        })


def imagine_needs_upload_image_post(attachment: dict) -> bool:
    if not isinstance(attachment, dict):
        return False
    if not imagine_attachment_raw_url(attachment):
        return False
    if attachment.get("_imagine_uploaded_direct"):
        return True
    upload_markers = [
        attachment.get("upload_post_path"),
        attachment.get("upload_item_id"),
        attachment.get("upload_hash"),
        attachment.get("relation"),
        attachment.get("source"),
        attachment.get("mode"),
    ]
    return any("upload" in str(value or "").lower() for value in upload_markers)


def imagine_attachment_upload_like(attachment: dict) -> bool:
    if not isinstance(attachment, dict):
        return False
    if attachment.get("_imagine_uploaded_direct") or attachment.get("_imagine_upload_cache_key"):
        return True
    upload_markers = [
        attachment.get("upload_post_path"),
        attachment.get("upload_item_id"),
        attachment.get("upload_hash"),
        attachment.get("relation"),
        attachment.get("source"),
        attachment.get("mode"),
    ]
    return any("upload" in str(value or "").lower() for value in upload_markers)


def imagine_demote_uploaded_reference_identity(attachment: dict) -> dict:
    if not isinstance(attachment, dict):
        return {}
    removed: dict = {}
    for key in ("post_id", "parent_post_id", "root_post_id", "original_post_id", "detail_item_id", "item_id", "source_item_id", "upload_item_id"):
        value = attachment.pop(key, None)
        if value:
            removed[key] = str(value)
    return removed


def imagine_cached_upload_image_post_id(attachment: dict) -> tuple[str, str]:
    root = library_root()
    if not root or not isinstance(attachment, dict):
        return "", ""
    cache_key = str(attachment.get("_imagine_upload_cache_key") or "").strip()
    if cache_key:
        cached = imagine_upload_asset_cache(root).get(cache_key)
        if isinstance(cached, dict):
            post_id = str(cached.get("post_id") or "").strip()
            if post_id:
                return post_id, cache_key
    raw_url = imagine_attachment_raw_url(attachment)
    asset_id = imagine_attachment_id(attachment, "asset_id", "_imagine_file_attachment_id", "upload_item_id")
    cache_key, cached = imagine_upload_cache_record_for_asset(root, asset_id, raw_url)
    post_id = str(cached.get("post_id") or "").strip() if isinstance(cached, dict) else ""
    return post_id, cache_key


def imagine_ensure_upload_image_post(attachment: dict, account: dict, request_id: str, action: str) -> str:
    if not imagine_needs_upload_image_post(attachment):
        return imagine_attachment_real_post_id(attachment, "post_id", "parent_post_id", "original_post_id", "detail_item_id")
    raw_url = imagine_attachment_raw_url(attachment)
    asset_id = imagine_attachment_id(attachment, "_imagine_file_attachment_id", "asset_id", "upload_item_id")
    post_id, cache_key = imagine_cached_upload_image_post_id(attachment)
    created = False
    if not post_id:
        create_result = imagine_post_json(
            "/rest/media/post/create",
            {
                "mediaType": "MEDIA_POST_TYPE_IMAGE",
                "mediaUrl": raw_url,
            },
            account,
            timeout=15,
            referer=IMAGINE_BASE + "/imagine",
        )
        post = create_result.get("post") if isinstance(create_result.get("post"), dict) else {}
        post_id = imagine_post_id(post, asset_id or extract_imagine_post_id_from_text(raw_url))
        created = True
        imagine_debug_event("upload_image_post_create", {
            "request_id": request_id,
            "action": action,
            "post_id": post_id,
            "asset_id": asset_id,
            "media_url": imagine_debug_compact_url(raw_url),
        })
    if not post_id:
        raise RuntimeError("Imagine upload post id could not be resolved.")
    imagine_post_json(
        "/rest/media/post/like",
        {"id": post_id},
        account,
        timeout=15,
        referer=IMAGINE_BASE + "/imagine",
    )
    attachment["post_id"] = post_id
    attachment["parent_post_id"] = post_id
    attachment["root_post_id"] = post_id
    attachment.setdefault("item_id", post_id)
    attachment["_imagine_liked_post_id"] = post_id
    file_id = str(attachment.get("_imagine_file_attachment_id") or attachment.get("asset_id") or asset_id or post_id).strip()
    file_url = raw_url
    cache_key = cache_key or str(attachment.get("_imagine_upload_cache_key") or "").strip()
    root = library_root()
    if root and cache_key:
        remember_imagine_upload_asset_cache(root, cache_key, {
            "file_id": file_id,
            "file_url": file_url,
            "post_id": post_id,
            "mime_type": str(attachment.get("mime_type") or attachment.get("type") or "image/jpeg"),
            "name": str(attachment.get("name") or ""),
        })
    imagine_debug_event("upload_image_post_like", {
        "request_id": request_id,
        "action": action,
        "post_id": post_id,
        "asset_id": asset_id,
        "created": created,
    })
    return post_id


def imagine_ensure_upload_image_posts(attachments: list[dict], account: dict, request_id: str, action: str) -> None:
    seen: set[str] = set()
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        raw_key = imagine_media_candidate_key(imagine_attachment_raw_url(attachment))
        if raw_key and raw_key in seen:
            continue
        if raw_key:
            seen.add(raw_key)
        imagine_ensure_upload_image_post(attachment, account, request_id, action)


def imagine_direct_file_attachment_ids(attachments: list[dict]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        file_id = str(attachment.get("_imagine_file_attachment_id") or "").strip()
        if not file_id:
            continue
        if file_id in seen:
            continue
        seen.add(file_id)
        ids.append(file_id)
    return ids


IMAGINE_POST_ID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def imagine_assets_file_attachment_id(attachment: dict) -> str:
    raw_url = imagine_attachment_raw_url(attachment)
    if raw_url.startswith("https://assets") or raw_url.startswith("http://assets"):
        matches = IMAGINE_POST_ID_RE.findall(imagine_unwrap_remote_proxy(raw_url))
        if matches:
            return matches[-1]
    return ""


def imagine_video_file_attachment_ids(attachments: list[dict]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        file_id = imagine_assets_file_attachment_id(attachment)
        if not file_id or file_id in seen:
            continue
        seen.add(file_id)
        ids.append(file_id)
    return ids


def extract_imagine_post_id_from_text(value) -> str:
    text = imagine_unwrap_remote_proxy(str(value or "").strip())
    if not text:
        return ""
    match = IMAGINE_POST_ID_RE.search(text)
    return match.group(0) if match else ""


def imagine_post_detail(post_id: str, account: dict, timeout: int = 12) -> dict:
    clean_id = extract_imagine_post_id_from_text(post_id) or str(post_id or "").strip()
    if not clean_id:
        return {}
    errors: list[str] = []
    for path, payload in (
        ("/rest/media/post/get", {"id": clean_id}),
        ("/rest/media/post/bulk-get", {"ids": [clean_id]}),
    ):
        try:
            data = imagine_post_json(path, payload, account, timeout=timeout)
        except RuntimeError as exc:
            errors.append(str(exc)[:240])
            continue
        post = data.get("post") if isinstance(data.get("post"), dict) else None
        if post:
            return post
        posts = data.get("posts") if isinstance(data.get("posts"), list) else []
        for candidate in posts:
            if isinstance(candidate, dict) and str(candidate.get("id") or "") == clean_id:
                return candidate
    return {}


def imagine_attachment_video_duration(attachment: dict, detail: dict | None = None) -> float | None:
    sources = [
        attachment.get("source_trim_end"),
        attachment.get("video_duration"),
        attachment.get("duration"),
        attachment.get("duration_seconds"),
    ]
    if isinstance(detail, dict):
        sources.extend([
            detail.get("videoDuration"),
            detail.get("duration"),
            detail.get("durationSeconds"),
        ])
    metadata = attachment.get("metadata") if isinstance(attachment.get("metadata"), dict) else {}
    if metadata:
        sources.extend([
            metadata.get("video_duration"),
            metadata.get("duration"),
            metadata.get("duration_seconds"),
        ])
    for value in sources:
        try:
            parsed = float(str(value).strip())
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return None


def imagine_extend_video_source(video_attachment: dict, account: dict) -> tuple[str, dict]:
    candidates: list[str] = []

    def add(value) -> None:
        text = str(value or "").strip()
        if not text:
            return
        post_id = extract_imagine_post_id_from_text(text) or text
        if post_id and post_id not in candidates:
            candidates.append(post_id)

    for key in (
        "post_id",
        "item_id",
        "detail_item_id",
        "parent_post_id",
        "source_item_id",
        "asset_id",
        "raw_url",
        "remote_url",
        "media_url",
        "mediaUrl",
        "url",
        "source_url",
        "object_url",
    ):
        add(video_attachment.get(key))

    for candidate in candidates:
        post_id = extract_imagine_post_id_from_text(candidate) or candidate
        detail = imagine_post_detail(post_id, account, timeout=12)
        if not detail:
            continue
        raw_url = imagine_node_primary_media_url(detail)
        if str(detail.get("mediaType") or "").upper().endswith("VIDEO") or imagine_node_media_type(detail, raw_url) == "video":
            return str(detail.get("id") or post_id).strip(), detail

    for key in ("post_id", "item_id", "detail_item_id", "parent_post_id"):
        post_id = extract_imagine_post_id_from_text(video_attachment.get(key))
        if post_id:
            return post_id, {}
    raw_id = extract_imagine_post_id_from_text(imagine_attachment_raw_url(video_attachment))
    if raw_id:
        return raw_id, {}
    return "", {}


def imagine_direct_action(payload: dict) -> str:
    mode = clean_option(payload.get("mode"), "image")
    if mode == "image":
        return "i2i" if media_attachments(payload, "image") else "t2i"
    if mode == "video":
        return "i2v" if media_attachments(payload, "image") else "t2v"
    if mode == "extend":
        return "extend"
    if mode in {"upscale", "video_upscale", "video-upscale"}:
        return "upscale"
    if mode in {"aspect", "aspect_ratio", "aspect-ratio"}:
        return "aspect"
    if mode == "video_edit":
        return "video_edit"
    return mode


def imagine_direct_job_kind(payload: dict) -> str:
    action = imagine_direct_action(payload)
    return "image" if action in {"t2i", "i2i", "aspect"} else "video"


def normalize_aspect_ratio_value(value) -> str:
    text = str(value or "").strip()
    if not text or text.lower() == "auto":
        return ""
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?::|/|x|×)\s*(\d+(?:\.\d+)?)", text)
    if match:
        return f"{match.group(1)}:{match.group(2)}"
    return text


def attachment_aspect_ratio(attachment: dict) -> str:
    if not isinstance(attachment, dict):
        return ""
    return normalize_aspect_ratio_value(
        attachment.get("aspect_ratio")
        or attachment.get("aspectRatio")
        or attachment.get("aspect")
        or attachment.get("ratio")
    )


def payload_source_aspect_ratio(payload: dict, media_type: str = "image") -> str:
    for attachment in media_attachments(payload, media_type):
        aspect = attachment_aspect_ratio(attachment)
        if aspect:
            return aspect
    return ""


def imagine_long_i2v_wait_policy(payload: dict, action: str | None = None) -> bool:
    return imagine_i2v_wait_policy(payload, action)["tier"] == "long"


def imagine_i2v_wait_policy(payload: dict, action: str | None = None) -> dict:
    resolved_action = action or imagine_direct_action(payload)
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    resolution = clean_option(options.get("resolution"), "").lower()
    if resolution in {"480", "720", "1080"}:
        resolution = f"{resolution}p"
    duration = option_seconds(options.get("duration"), 10, 3, 15)
    def recovery_seconds(value: int) -> int:
        # Extend commonly returns its post IDs before the finished video URL is
        # visible in the saved-media store. Keep following those exact IDs
        # instead of reporting a timeout while the official site is finishing.
        if resolved_action == "extend":
            return max(value, IMAGINE_DIRECT_EXTEND_CANDIDATE_GRACE_SECONDS)
        return value
    display_seconds_override = {
        ("i2v", "480p", 6): 25,
        ("i2v", "480p", 10): 35,
        ("i2v", "480p", 15): 45,
        ("i2v", "720p", 6): 40,
        ("i2v", "720p", 10): 55,
        ("i2v", "720p", 15): 70,
        ("i2v", "1080p", 6): 65,
        ("i2v", "1080p", 10): 100,
        ("i2v", "1080p", 15): 100,
        ("t2v", "480p", 6): 25,
        ("t2v", "480p", 10): 35,
        ("t2v", "480p", 15): 45,
        ("t2v", "720p", 6): 40,
        ("t2v", "720p", 10): 55,
        ("t2v", "720p", 15): 70,
        ("t2v", "1080p", 6): 65,
        ("t2v", "1080p", 10): 100,
        ("t2v", "1080p", 15): 100,
        ("extend", "480p", 6): 25,
        ("extend", "480p", 10): 35,
        ("extend", "480p", 15): 45,
        ("extend", "720p", 6): 40,
        ("extend", "720p", 10): 55,
        ("extend", "720p", 15): 70,
        ("extend", "1080p", 6): 65,
        ("extend", "1080p", 10): 100,
        ("extend", "1080p", 15): 100,
    }.get((resolved_action, resolution, duration))
    if resolved_action not in {"i2v", "extend"}:
        return {
            "tier": "default",
            "official_wait_seconds": IMAGINE_DIRECT_VIDEO_MAX_WAIT_SECONDS,
            "recovery_seconds": recovery_seconds(IMAGINE_DIRECT_VIDEO_ABSOLUTE_GRACE_SECONDS),
            "candidate_stabilize_seconds": IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS,
            "display_seconds": display_seconds_override or imagine_direct_video_display_seconds(resolved_action),
        }
    high_resolution = resolution in {"720p", "1080p"}
    if high_resolution and duration >= 10:
        return {
            "tier": "long",
            "official_wait_seconds": IMAGINE_DIRECT_LONG_I2V_ABSOLUTE_MAX_WAIT_SECONDS,
            "recovery_seconds": recovery_seconds(IMAGINE_DIRECT_LONG_I2V_CANDIDATE_GRACE_SECONDS),
            "candidate_stabilize_seconds": IMAGINE_DIRECT_LONG_I2V_CANDIDATE_STABILIZE_SECONDS,
            "display_seconds": display_seconds_override or IMAGINE_DIRECT_LONG_I2V_DISPLAY_SECONDS,
        }
    if high_resolution:
        return {
            "tier": "high_short",
            "official_wait_seconds": IMAGINE_DIRECT_HIGH_SHORT_I2V_MAX_WAIT_SECONDS,
            "recovery_seconds": recovery_seconds(IMAGINE_DIRECT_HIGH_SHORT_I2V_CANDIDATE_GRACE_SECONDS),
            "candidate_stabilize_seconds": IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS,
            "display_seconds": display_seconds_override or IMAGINE_DIRECT_HIGH_SHORT_I2V_DISPLAY_SECONDS,
        }
    if duration >= 10:
        return {
            "tier": "mid",
            "official_wait_seconds": IMAGINE_DIRECT_MID_I2V_MAX_WAIT_SECONDS,
            "recovery_seconds": recovery_seconds(IMAGINE_DIRECT_MID_I2V_CANDIDATE_GRACE_SECONDS),
            "candidate_stabilize_seconds": IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS,
            "display_seconds": display_seconds_override or IMAGINE_DIRECT_MID_I2V_DISPLAY_SECONDS,
        }
    return {
        "tier": "low",
        "official_wait_seconds": IMAGINE_DIRECT_LOW_I2V_MAX_WAIT_SECONDS,
        "recovery_seconds": recovery_seconds(IMAGINE_DIRECT_LOW_I2V_CANDIDATE_GRACE_SECONDS),
        "candidate_stabilize_seconds": IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS,
        "display_seconds": display_seconds_override or IMAGINE_DIRECT_LOW_I2V_DISPLAY_SECONDS,
    }


def imagine_direct_job_context(payload: dict) -> dict:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    action = imagine_direct_action(payload)
    if action == "t2i":
        model = "imagine-x-1"
    elif action in {"i2i", "aspect"}:
        model = "imagine-image-edit"
    else:
        model = "imagine-video-gen"
    aspect_ratio = normalize_aspect_ratio_value(options.get("aspect_ratio") or options.get("aspect"))
    if not aspect_ratio and action in {"i2i", "i2v", "extend"}:
        aspect_ratio = payload_source_aspect_ratio(payload, "image") or payload_source_aspect_ratio(payload, "video")
    return {
        "provider": "imagine",
        "generation_provider": "imagine",
        "mode": action,
        "preview_url": str(payload.get("preview_url") or ""),
        "preview_type": str(payload.get("preview_type") or imagine_direct_job_kind(payload)),
        "source_post_path": str(payload.get("source_post_path") or ""),
        "source_item_id": str(payload.get("source_item_id") or ""),
        "source_conversation_id": str(payload.get("source_conversation_id") or ""),
        "parent_response_id": str(payload.get("parent_response_id") or ""),
        "aspect_ratio": aspect_ratio,
        "resolution": str(options.get("resolution") or ""),
        "duration": str(options.get("duration") or ""),
        "count": str(imagine_t2i_options(payload)[2] if action == "t2i" else (options.get("count") or "")),
        "scroll_continuation": bool(payload.get("scroll_continuation")),
        "model": model,
        "model_label": str(options.get("video_model") or options.get("video-model") or "").strip(),
    }


def imagine_direct_headers(account: dict, request_id: str, referer: str) -> dict[str, str]:
    headers = imagine_saved_headers(account)
    headers["Accept"] = "text/event-stream, application/json, text/plain, */*"
    headers["Referer"] = referer or (IMAGINE_BASE + "/imagine/saved")
    headers["x-xai-request-id"] = request_id
    return headers


def imagine_stream_data_from_line(raw_line: bytes) -> str:
    try:
        line = raw_line.decode("utf-8", errors="replace").strip()
    except Exception:
        return ""
    if not line or line in {"[DONE]", "data: [DONE]"}:
        return ""
    if line.startswith("data:"):
        return line[5:].strip()
    if line.startswith("{") or line.startswith("["):
        return line
    return ""


def imagine_request_is_aspect_ratio(request_payload: dict) -> bool:
    if not isinstance(request_payload, dict):
        return False
    if request_payload.get("modelName") != "imagine-image-edit":
        return False
    model_map = (
        ((request_payload.get("responseMetadata") or {}).get("modelConfigOverride") or {}).get("modelMap")
        if isinstance(request_payload.get("responseMetadata"), dict)
        else {}
    )
    image_config = (model_map or {}).get("imageEditModelConfig") if isinstance(model_map, dict) else {}
    return isinstance(image_config, dict) and bool(image_config.get("aspectRatio"))


def imagine_event_numeric_progress(value) -> int | None:
    stack = [value]
    seen = 0
    while stack and seen < 2000:
        seen += 1
        item = stack.pop()
        if isinstance(item, dict):
            for key, child in item.items():
                key_text = str(key or "").lower()
                if key_text in {"percentage_complete", "percentagecomplete", "progress"}:
                    try:
                        return max(0, min(100, int(float(str(child).strip().rstrip("%")))))
                    except (TypeError, ValueError):
                        pass
                if isinstance(child, (dict, list)):
                    stack.append(child)
        elif isinstance(item, list):
            stack.extend(item)
    return None


def imagine_event_status_words(value) -> str:
    words: list[str] = []
    stack = [value]
    seen = 0
    while stack and seen < 2000:
        seen += 1
        item = stack.pop()
        if isinstance(item, dict):
            for key, child in item.items():
                key_text = str(key or "").lower()
                if key_text in {"status", "current_status", "confirmation", "message", "error"} and isinstance(child, str):
                    words.append(child.lower())
                elif isinstance(child, (dict, list)):
                    stack.append(child)
        elif isinstance(item, list):
            stack.extend(item)
    return " ".join(words)


def imagine_event_all_words(value) -> str:
    words: list[str] = []
    stack = [value]
    seen = 0
    while stack and seen < 4000:
        seen += 1
        item = stack.pop()
        if isinstance(item, dict):
            for _key, child in item.items():
                if isinstance(child, str):
                    words.append(child.lower())
                elif isinstance(child, (dict, list)):
                    stack.append(child)
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, str):
            words.append(item.lower())
    return " ".join(words)


def imagine_event_has_moderation_flag(value) -> bool:
    stack = [value]
    seen = 0
    while stack and seen < 2000:
        seen += 1
        item = stack.pop()
        if isinstance(item, dict):
            for key, child in item.items():
                key_text = str(key or "").lower()
                if key_text in {"moderated", "is_moderated", "content_moderated"}:
                    if child is True:
                        return True
                    if isinstance(child, str) and child.strip().lower() in {"true", "1", "yes", "moderated", "content_policy_violation"}:
                        return True
                if isinstance(child, (dict, list)):
                    stack.append(child)
        elif isinstance(item, list):
            stack.extend(item)
    return False


def imagine_event_is_moderated(value) -> bool:
    text = imagine_event_status_words(value)
    full_text = imagine_event_all_words(value)
    return imagine_event_has_moderation_flag(value) or any(token in text for token in (
        "moderated",
        "content_policy_violation",
        "content was moderated",
        "content has been moderated",
        "violates our policy",
        "검열",
    )) or any(token in full_text for token in (
        "content_policy_violation",
        "content was moderated",
        "content has been moderated",
        "violates our policy",
        "rejected by content moderation",
        "policy_violation",
    ))


def imagine_event_is_terminal_failure(value) -> bool:
    if imagine_event_is_moderated(value):
        return True
    text = imagine_event_status_words(value)
    full_text = imagine_event_all_words(value)
    if any(token in full_text for token in (
        "usagepoolexhausted",
        "usage_pool_exhausted",
        "used up your media generation credits",
        "insufficient balance",
    )):
        return True
    return any(token in text for token in IMAGINE_VIDEO_TERMINAL_STATUSES)


def imagine_event_usage_limit_message(value) -> str:
    text = imagine_event_all_words(value)
    if any(token in text for token in (
        "usagepoolexhausted",
        "usage_pool_exhausted",
        "used up your media generation credits",
        "insufficient balance",
    )):
        return "Usage Limit Reached"
    return ""


def imagine_usage_limit_message_from_events(events: list) -> str:
    for event in events:
        message = imagine_event_usage_limit_message(event)
        if message:
            return message
    return ""


def imagine_lucky_reason_from_events(events: list) -> str:
    if any(imagine_event_is_moderated(event) for event in events):
        return "moderated"
    if any(imagine_event_is_terminal_failure(event) for event in events):
        return "terminal"
    return ""


def imagine_event_has_generation_signal(value) -> bool:
    if imagine_event_numeric_progress(value) is not None:
        return True
    stack = [value]
    seen = 0
    signal_keys = {
        "mediaurl",
        "media_url",
        "imageurl",
        "image_url",
        "videourl",
        "video_url",
        "thumbnailimageurl",
        "thumbnail_image_url",
        "videopostid",
        "video_post_id",
        "videoid",
        "video_id",
        "imageid",
        "image_id",
        "postid",
        "post_id",
    }
    while stack and seen < 2000:
        seen += 1
        item = stack.pop()
        if isinstance(item, dict):
            for key, child in item.items():
                key_text = str(key or "").lower()
                if key_text in signal_keys and str(child or "").strip():
                    return True
                if isinstance(child, str) and imagine_remote_url(imagine_unwrap_remote_proxy(child)):
                    return True
                if isinstance(child, (dict, list)):
                    stack.append(child)
        elif isinstance(item, list):
            stack.extend(item)
    return False


def log_imagine_stream_event_if_needed(request_id: str, parsed, progress: int | None, terminal: bool, reason: str = "", force: bool = False) -> None:
    moderated = imagine_event_is_moderated(parsed)
    should_log = force or terminal or moderated or (progress is not None and progress >= IMAGINE_DEBUG_RAW_PROGRESS_THRESHOLD)
    if not should_log:
        return
    imagine_debug_event("stream_event_raw", {
        "request_id": request_id,
        "reason": reason or ("forced" if force else "terminal" if terminal else "moderated" if moderated else "progress"),
        "progress": progress,
        "terminal": terminal,
        "moderated": moderated,
        "status_words": imagine_event_status_words(parsed)[:500],
        "event_payload": imagine_debug_event_excerpt(parsed),
    })


def imagine_direct_stream_curl(
    request_payload: dict,
    account: dict,
    request_id: str,
    referer: str,
    max_wait_seconds: int,
    first_signal_seconds: int = IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS,
    initial_http_error_wait_seconds: int = 0,
    progress_callback=None,
    cancel_checker=None,
) -> list:
    if curl_requests is None:
        raise RuntimeError("curl_cffi is not installed.")
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    headers = imagine_direct_headers(account, request_id, referer)
    imagine_debug_event("stream_start", {
        "request_id": request_id,
        "transport": "curl_cffi",
        "referer": referer,
        "max_wait_seconds": max_wait_seconds,
        "first_signal_seconds": first_signal_seconds,
        "modelName": request_payload.get("modelName") if isinstance(request_payload, dict) else "",
    })
    events: list = []
    stream_started_at = time.monotonic()
    deadline = stream_started_at + max(1, int(max_wait_seconds))
    first_signal_deadline = stream_started_at + max(1, int(first_signal_seconds))
    initial_http_error_deadline = stream_started_at + max(0, int(initial_http_error_wait_seconds))
    force_raw_event_log = imagine_request_is_aspect_ratio(request_payload)
    signal_seen = False
    stream_done = False
    initial_http_error: tuple[int, str] | None = None
    output: queue.Queue = queue.Queue()
    stop_event = threading.Event()
    response_holder: dict[str, object] = {}

    def check_cancelled() -> None:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")

    def close_response() -> None:
        response = response_holder.get("response")
        try:
            if response:
                response.close()
        except Exception:
            pass

    def reader() -> None:
        try:
            with curl_requests.Session(impersonate="chrome", default_headers=False) as session:
                response = session.post(
                    IMAGINE_BASE + "/rest/app-chat/conversations/new",
                    data=body,
                    headers=headers,
                    stream=True,
                    timeout=max(5, int(max_wait_seconds) + 10),
                )
                response_holder["response"] = response
                status_code = int(getattr(response, "status_code", 0) or 0)
                imagine_debug_event("stream_http_status", {"request_id": request_id, "status_code": status_code})
                if status_code >= 400:
                    if status_code in {400, 403} and initial_http_error_wait_seconds > 0:
                        output.put(("initial_http_error", status_code, ""))
                    else:
                        detail = str(getattr(response, "text", "") or "")[:1000]
                        output.put(("http_error", status_code, detail))
                        return
                for raw_line in response.iter_lines():
                    if stop_event.is_set():
                        break
                    output.put(("line", raw_line, None))
                output.put(("done", None, None))
        except Exception as exc:
            output.put(("error", exc, None))
        finally:
            close_response()

    thread = threading.Thread(target=reader, name=f"imagine-curl-stream-{request_id[:8]}", daemon=True)
    thread.start()

    try:
        while time.monotonic() < deadline:
            check_cancelled()
            now = time.monotonic()
            if stream_done:
                if initial_http_error and not signal_seen:
                    if now < first_signal_deadline:
                        time.sleep(min(0.25, max(0.01, first_signal_deadline - now)))
                        continue
                    code, detail = initial_http_error
                    raise RuntimeError(f"Imagine HTTP {code}: {detail[:1000]}")
                break
            if not signal_seen and now >= first_signal_deadline:
                if initial_http_error:
                    code, detail = initial_http_error
                    raise RuntimeError(f"Imagine HTTP {code}: {detail[:1000]}")
                raise RuntimeError(f"Imagine direct request did not emit a generation signal within {first_signal_seconds}s.")
            wait_until = deadline if signal_seen else min(deadline, first_signal_deadline)
            try:
                kind, value, extra = output.get(timeout=max(0.05, min(0.25, wait_until - now)))
            except queue.Empty:
                continue
            if kind == "done":
                imagine_debug_event("stream_done", {"request_id": request_id, "events": len(events)})
                stream_done = True
                continue
            if kind == "initial_http_error":
                initial_http_error = (int(value or 0), str(extra or ""))
                imagine_debug_event("stream_initial_http_error_ignored", {
                    "request_id": request_id,
                    "status_code": int(value or 0),
                    "wait_seconds": remaining_monotonic_seconds_until(initial_http_error_deadline, initial_http_error_wait_seconds),
                })
                continue
            if kind == "http_error":
                imagine_debug_event("stream_http_error", {"request_id": request_id, "status_code": value, "detail": str(extra or "")[:500]})
                raise RuntimeError(f"Imagine HTTP {value}: {str(extra or '')[:1000]}")
            if kind == "error":
                if stop_event.is_set():
                    break
                imagine_debug_event("stream_error", {"request_id": request_id, "error": str(value)[:500]})
                raise RuntimeError(f"Imagine network error: {value}") from value
            if kind != "line":
                continue
            raw_line = value
            if not raw_line:
                continue
            data = imagine_stream_data_from_line(raw_line)
            if not data:
                continue
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                parsed = {"text": data}
            progress = imagine_event_numeric_progress(parsed)
            terminal = imagine_event_is_terminal_failure(parsed)
            initial_http_error_wait_active = (
                initial_http_error is not None
                and initial_http_error_wait_seconds > 0
                and time.monotonic() < initial_http_error_deadline
            )
            if initial_http_error_wait_active and (terminal or not imagine_event_has_generation_signal(parsed)):
                imagine_debug_event("stream_initial_event_ignored", {
                    "request_id": request_id,
                    "progress": progress,
                    "status": imagine_event_status_words(parsed)[:300],
                    "terminal": terminal,
                    "wait_seconds": remaining_monotonic_seconds_until(initial_http_error_deadline, initial_http_error_wait_seconds),
                    "event_payload": imagine_debug_event_excerpt(parsed),
                })
                continue
            events.append(parsed)
            signal_seen = True
            if progress is not None and progress_callback:
                progress_callback(display_generation_progress(progress), "running", {"request_id": request_id, "progress_source": "stream"})
            if progress is not None:
                imagine_debug_event("stream_progress", {
                    "request_id": request_id,
                    "progress": progress,
                    "terminal": terminal,
                })
            log_imagine_stream_event_if_needed(
                request_id,
                parsed,
                progress,
                terminal,
                reason="aspect" if force_raw_event_log else "",
                force=force_raw_event_log,
            )
            if terminal:
                imagine_debug_event("stream_terminal_event", {
                    "request_id": request_id,
                    "progress": progress,
                    "status": imagine_event_status_words(parsed)[:300],
                    "event_payload": imagine_debug_event_excerpt(parsed),
                })
                stop_event.set()
                close_response()
                break
    except Exception:
        stop_event.set()
        close_response()
        raise
    finally:
        if time.monotonic() >= deadline:
            stop_event.set()
            close_response()

    if not signal_seen:
        imagine_debug_event("stream_no_signal", {"request_id": request_id, "events": len(events)})
        raise RuntimeError(f"Imagine direct request did not emit a generation signal within {first_signal_seconds}s.")
    imagine_debug_event("stream_return", {"request_id": request_id, "events": len(events), "signal_seen": signal_seen})
    return events


def imagine_direct_stream_urllib(
    request_payload: dict,
    account: dict,
    request_id: str,
    referer: str,
    max_wait_seconds: int,
    first_signal_seconds: int = IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS,
    initial_http_error_wait_seconds: int = 0,
    progress_callback=None,
    cancel_checker=None,
) -> list:
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    imagine_debug_event("stream_start", {
        "request_id": request_id,
        "transport": "urllib",
        "referer": referer,
        "max_wait_seconds": max_wait_seconds,
        "first_signal_seconds": first_signal_seconds,
        "modelName": request_payload.get("modelName") if isinstance(request_payload, dict) else "",
    })
    request = urllib.request.Request(
        IMAGINE_BASE + "/rest/app-chat/conversations/new",
        data=body,
        headers=imagine_direct_headers(account, request_id, referer),
        method="POST",
    )
    events: list = []
    stream_started_at = time.monotonic()
    deadline = stream_started_at + max(1, int(max_wait_seconds))
    first_signal_deadline = stream_started_at + max(1, int(first_signal_seconds))
    initial_http_error_deadline = stream_started_at + max(0, int(initial_http_error_wait_seconds))
    force_raw_event_log = imagine_request_is_aspect_ratio(request_payload)
    signal_seen = False
    initial_http_error_seen = False

    def check_cancelled() -> None:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")

    def set_socket_timeout(response, seconds: float) -> None:
        try:
            response.fp.raw._sock.settimeout(max(0.5, float(seconds)))
        except Exception:
            pass

    try:
        with urllib.request.urlopen(request, timeout=max(1, int(first_signal_seconds))) as response:
            set_socket_timeout(response, first_signal_seconds)
            while time.monotonic() < deadline:
                check_cancelled()
                try:
                    raw_line = response.readline()
                except (TimeoutError, socket.timeout):
                    if not signal_seen:
                        raise RuntimeError(f"Imagine direct request did not emit a generation signal within {first_signal_seconds}s.")
                    set_socket_timeout(response, min(10, max(1, deadline - time.monotonic())))
                    continue
                if not raw_line:
                    break
                data = imagine_stream_data_from_line(raw_line)
                if not data:
                    continue
                try:
                    parsed = json.loads(data)
                except json.JSONDecodeError:
                    parsed = {"text": data}
                set_socket_timeout(response, min(10, max(1, deadline - time.monotonic())))
                progress = imagine_event_numeric_progress(parsed)
                terminal = imagine_event_is_terminal_failure(parsed)
                initial_http_error_wait_active = (
                    initial_http_error_seen
                    and initial_http_error_wait_seconds > 0
                    and time.monotonic() < initial_http_error_deadline
                )
                if initial_http_error_wait_active and (terminal or not imagine_event_has_generation_signal(parsed)):
                    imagine_debug_event("stream_initial_event_ignored", {
                        "request_id": request_id,
                        "progress": progress,
                        "status": imagine_event_status_words(parsed)[:300],
                        "terminal": terminal,
                        "wait_seconds": remaining_monotonic_seconds_until(initial_http_error_deadline, initial_http_error_wait_seconds),
                        "event_payload": imagine_debug_event_excerpt(parsed),
                    })
                    continue
                events.append(parsed)
                signal_seen = True
                if progress is not None and progress_callback:
                    progress_callback(display_generation_progress(progress), "running", {"request_id": request_id, "progress_source": "stream"})
                if progress is not None:
                    imagine_debug_event("stream_progress", {
                        "request_id": request_id,
                        "progress": progress,
                        "terminal": terminal,
                    })
                log_imagine_stream_event_if_needed(
                    request_id,
                    parsed,
                    progress,
                    terminal,
                    reason="aspect" if force_raw_event_log else "",
                    force=force_raw_event_log,
                )
                if terminal:
                    imagine_debug_event("stream_terminal_event", {
                        "request_id": request_id,
                        "progress": progress,
                        "status": imagine_event_status_words(parsed)[:300],
                        "event_payload": imagine_debug_event_excerpt(parsed),
                    })
                    break
    except urllib.error.HTTPError as exc:
        detail = exc.read(4000).decode("utf-8", errors="replace")
        if exc.code in {400, 403} and initial_http_error_wait_seconds > 0:
            initial_http_error_seen = True
            wait_seconds = remaining_monotonic_seconds_until(initial_http_error_deadline, initial_http_error_wait_seconds)
            imagine_debug_event("stream_initial_http_error_ignored", {
                "request_id": request_id,
                "status_code": exc.code,
                "wait_seconds": wait_seconds,
                "detail": detail[:500],
            })
            sleep_with_optional_cancel(wait_seconds, cancel_checker)
        imagine_debug_event("stream_http_error", {"request_id": request_id, "status_code": exc.code, "detail": detail[:500]})
        raise RuntimeError(f"Imagine HTTP {exc.code}: {detail[:1000]}") from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        imagine_debug_event("stream_error", {"request_id": request_id, "error": str(exc)[:500]})
        raise RuntimeError(f"Imagine network error: {exc}") from exc
    if not signal_seen:
        imagine_debug_event("stream_no_signal", {"request_id": request_id, "events": len(events)})
        raise RuntimeError(f"Imagine direct request did not emit a generation signal within {first_signal_seconds}s.")
    imagine_debug_event("stream_return", {"request_id": request_id, "events": len(events), "signal_seen": signal_seen})
    return events


def imagine_direct_stream(
    request_payload: dict,
    account: dict,
    request_id: str,
    referer: str,
    max_wait_seconds: int,
    first_signal_seconds: int = IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS,
    initial_http_error_wait_seconds: int = 0,
    progress_callback=None,
    cancel_checker=None,
) -> list:
    if curl_requests is not None:
        return imagine_direct_stream_curl(
            request_payload,
            account,
            request_id,
            referer,
            max_wait_seconds,
            first_signal_seconds=first_signal_seconds,
            initial_http_error_wait_seconds=initial_http_error_wait_seconds,
            progress_callback=progress_callback,
            cancel_checker=cancel_checker,
        )
    return imagine_direct_stream_urllib(
        request_payload,
        account,
        request_id,
        referer,
        max_wait_seconds,
        first_signal_seconds=first_signal_seconds,
        initial_http_error_wait_seconds=initial_http_error_wait_seconds,
        progress_callback=progress_callback,
        cancel_checker=cancel_checker,
    )


def imagine_ws_headers(account: dict) -> dict[str, str]:
    cookies = valid_imagine_cookies(account)
    if not cookies:
        raise RuntimeError("Select or capture an Imagine account first.")
    return {
        "Cookie": cookie_header(cookies),
        "Origin": IMAGINE_BASE,
        "Referer": IMAGINE_BASE + "/imagine",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": imagine_user_agent(),
    }


def imagine_t2i_options(payload: dict) -> tuple[str, bool, int]:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    aspect_ratio = normalize_aspect_ratio_value(options.get("aspect_ratio") or options.get("aspect"))
    if not aspect_ratio or aspect_ratio.lower() == "auto":
        aspect_ratio = "2:3"
    image_model = str(options.get("image_model") or "").strip().lower()
    enable_pro = "quality" in image_model
    try:
        count = int(str(options.get("count") or "").strip())
    except (TypeError, ValueError):
        count = 4 if enable_pro else 8
    count = max(1, min(12, count))
    return aspect_ratio, enable_pro, count


def imagine_t2i_send_payloads(prompt: str, request_id: str, aspect_ratio: str, enable_pro: bool, count: int) -> tuple[dict, dict]:
    timestamp = int(time.time() * 1000)
    reset_payload = {
        "type": "conversation.item.create",
        "timestamp": timestamp,
        "item": {"type": "message", "content": [{"type": "reset"}]},
    }
    create_payload = {
        "type": "conversation.item.create",
        "timestamp": timestamp + 40,
        "item": {
            "type": "message",
            "content": [
                {
                    "requestId": request_id,
                    "text": prompt,
                    "type": "input_text",
                    "properties": {
                        "section_count": 0,
                        "is_kids_mode": False,
                        "enable_nsfw": True,
                        "skip_upsampler": False,
                        "enable_side_by_side": False,
                        "is_initial": False,
                        "aspect_ratio": aspect_ratio,
                        "enable_pro": enable_pro,
                        "num_generations": count,
                    },
                }
            ],
        },
    }
    return reset_payload, create_payload


def imagine_t2i_candidate_from_event(event: dict, prompt: str) -> dict | None:
    if str(event.get("request_id") or "") == "":
        return None
    image_id = str(event.get("image_id") or event.get("job_id") or "").strip()
    if not image_id or not re.fullmatch(r"[0-9a-fA-F-]{32,36}", image_id):
        return None
    raw_url = f"https://imagine-public.x.ai/imagine-public/images/{image_id}.jpg"
    status = str(event.get("current_status") or "").strip().lower()
    mode = str(event.get("mode") or "").strip().lower()
    model_label = "Quality" if mode == "quality" else ("Speed" if mode == "fast" else str(event.get("model_name") or "imagine-x-1"))
    return {
        "url": raw_url,
        "type": "image",
        "post_id": image_id,
        "root_post_id": image_id,
        "parent_post_id": "",
        "original_post_id": "",
        "original_ref_type": "",
        "thumbnail_url": raw_url,
        "created_at": now_iso(),
        "prompt": str(event.get("prompt") or prompt),
        "model": model_label,
        "resolution_name": mode,
        "video_duration": "",
        "order": safe_int(event.get("order"), 0),
        "completed": status == "completed",
        "moderated": imagine_event_is_moderated(event),
    }


def imagine_t2i_direct_items(
    payload: dict,
    account: dict,
    prompt: str,
    request_id: str,
    progress_callback=None,
    cancel_checker=None,
) -> list[dict]:
    aspect_ratio, enable_pro, count = imagine_t2i_options(payload)
    receive_limit = count + 3
    reset_payload, create_payload = imagine_t2i_send_payloads(prompt, request_id, aspect_ratio, enable_pro, count)
    imagine_debug_event("t2i_request", {
        "request_id": request_id,
        "aspect_ratio": aspect_ratio,
        "enable_pro": enable_pro,
        "count": count,
        "receive_limit": receive_limit,
        "prompt_len": len(prompt),
    })
    candidates: dict[str, dict] = {}
    last_events: list = []
    signal_seen = False
    completed_count = 0
    completed_grace_deadline = 0.0
    candidate_recovery_attempts = 0
    last_completed_count = 0
    completion_order: list[str] = []

    def progress_context(source: str = "raw_websocket") -> dict:
        return {
            "request_id": request_id,
            "action": "t2i",
            "progress_source": source,
            "candidate_count": len(candidates),
            "completed_count": completed_count,
            "expected_count": count,
            "receive_limit": receive_limit,
        }

    ws = RawWebSocket(IMAGINE_WS_URL, timeout=max(10, IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS), headers=imagine_ws_headers(account))
    try:
        ws.send_json(reset_payload)
        time.sleep(0.25)
        ws.send_json(create_payload)
        imagine_debug_event("t2i_ws_sent", {"request_id": request_id, "transport": "raw_websocket"})
        while True:
            if cancel_checker and cancel_checker():
                raise JobCancelled("Job cancelled.")
            try:
                readable, _, _ = select.select([ws.socket], [], [], 0.75)
            except (OSError, ValueError):
                readable = []
            if not readable:
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
            try:
                text = ws.recv_text()
            except (socket.timeout, TimeoutError):
                continue
            except (RuntimeError, OSError) as exc:
                completed_count = sum(1 for item in candidates.values() if item.get("completed"))
                if completed_count > 0 and "connection closed" in str(exc).lower():
                    imagine_debug_event("t2i_socket_closed_after_completed", {
                        "request_id": request_id,
                        "completed_count": completed_count,
                        "candidate_count": len(candidates),
                        "error": str(exc)[:500],
                    })
                    break
                raise
            if not text:
                break
            if '"type":"image"' in text[:32] or '"blob"' in text[:80]:
                signal_seen = True
                continue
            try:
                event = json.loads(text)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            if str(event.get("request_id") or "") != request_id:
                continue
            last_events.append(event)
            if len(last_events) > IMAGINE_DEBUG_LAST_EVENT_COUNT:
                last_events.pop(0)
            event_moderated = imagine_event_is_moderated(event)
            candidate = imagine_t2i_candidate_from_event(event, prompt)
            if event_moderated and not candidate:
                imagine_debug_event("t2i_moderated", {"request_id": request_id, "event_payload": event})
                raise RuntimeError("Imagine moderated the request.")
            signal_seen = True
            progress = imagine_event_numeric_progress(event)
            if progress is not None and progress_callback:
                progress_callback(display_generation_progress(progress), "running", progress_context())
            if progress is not None:
                imagine_debug_event("t2i_progress", {"request_id": request_id, "progress": progress})
                log_imagine_stream_event_if_needed(request_id, event, progress, imagine_event_is_terminal_failure(event), "t2i_progress")
            if candidate:
                candidates[candidate["post_id"]] = candidate
                completed_count = sum(1 for item in candidates.values() if item.get("completed"))
                if candidate.get("completed") and candidate["post_id"] not in completion_order:
                    completion_order.append(candidate["post_id"])
                if completed_count >= count and completed_count != last_completed_count:
                    completed_grace_deadline = time.monotonic() + 2.5
                    last_completed_count = completed_count
                elif completed_count > 0 and len(candidates) >= count and not completed_grace_deadline:
                    completed_grace_deadline = time.monotonic() + 1.25
                imagine_debug_event("t2i_candidate", {
                    "request_id": request_id,
                    "post_id": candidate.get("post_id"),
                    "completed": bool(candidate.get("completed")),
                    "moderated": bool(candidate.get("moderated")),
                    "completed_count": completed_count,
                    "candidate_count": len(candidates),
                    "receive_limit": receive_limit,
                })
                if progress_callback:
                    context = progress_context()
                    if candidate.get("completed"):
                        ordered_partial_candidates = [
                            candidates[post_id]
                            for post_id in completion_order
                            if post_id in candidates and candidates[post_id].get("completed")
                        ][:count]
                        partial_items = [
                            imagine_moderated_item_from_candidate(item, "image", account, prompt, "t2i", request_id, {})
                            if item.get("moderated")
                            else imagine_direct_item_from_candidate(item, "image", account, prompt, "t2i", request_id, {})
                            for item in ordered_partial_candidates
                        ]
                        partial_posts = [
                            imagine_direct_post_from_items([item], prompt, account, "t2i")
                            for item in partial_items
                        ]
                        context["partial_result"] = {
                            "action": "t2i",
                            "items": partial_items,
                            "posts": partial_posts,
                            "selected_item_id": partial_items[-1].get("item_id") if partial_items else "",
                            "request_id": request_id,
                        }
                    progress_callback(display_generation_progress(progress, fallback=1), "running", context)
                if completed_count >= receive_limit:
                    break
    finally:
        ws.close()
    if not signal_seen:
        imagine_debug_event("t2i_no_signal", {
            "request_id": request_id,
            "candidate_count": len(candidates),
            "last_events": imagine_debug_event_tail(last_events),
        })
        raise RuntimeError("Imagine T2I websocket closed before a generation signal.")
    completed: list[dict] = []
    moderated: list[dict] = []
    for item in candidates.values():
        if not item.get("completed"):
            continue
        if item.get("moderated"):
            moderated.append(item)
            continue
        completed.append(item)
    if moderated:
        imagine_debug_event("t2i_completed_moderated", {
            "request_id": request_id,
            "moderated_count": len(moderated),
            "candidate_count": len(candidates),
            "post_ids": [item.get("post_id") for item in sorted(moderated, key=lambda item: (safe_int(item.get("order"), 0), item.get("post_id") or ""))],
        })
    completed_by_id = {str(item.get("post_id") or ""): item for item in completed + moderated}
    ordered_candidates = [completed_by_id[post_id] for post_id in completion_order if post_id in completed_by_id]
    ordered_candidates.extend(item for post_id, item in completed_by_id.items() if post_id not in completion_order)
    ordered_candidates = ordered_candidates[:count]
    items = []
    for candidate in ordered_candidates:
        if candidate.get("moderated"):
            items.append(imagine_moderated_item_from_candidate(candidate, "image", account, prompt, "t2i", request_id, {}))
        else:
            items.append(imagine_direct_item_from_candidate(candidate, "image", account, prompt, "t2i", request_id, {}))
    if not items:
        imagine_debug_event("t2i_no_items", {
            "request_id": request_id,
            "candidate_count": len(candidates),
            "completed_count": len(completed),
            "last_events": imagine_debug_event_tail(last_events),
        })
        raise RuntimeError("Imagine T2I response did not contain generated images.")
    imagine_debug_event("t2i_items", {
        "request_id": request_id,
        "item_count": len(items),
        "selected_item_id": items[-1].get("item_id") if items else "",
    })
    return items


def imagine_media_candidate_key(url: str) -> str:
    return imagine_unwrap_remote_proxy(str(url or "")).split("#", 1)[0].strip()


def imagine_attachment_candidate_source_ids(attachments: list[dict]) -> set[str]:
    ids: set[str] = set()

    def add(value) -> None:
        text = str(value or "").strip()
        if not text:
            return
        ids.add(text)
        extracted = imagine_media_identity_id_from_text(text)
        if extracted:
            ids.add(extracted)

    for attachment in attachments or []:
        if not isinstance(attachment, dict):
            continue
        for key in (
            "_imagine_file_attachment_id",
            "_imagine_liked_post_id",
            "asset_id",
            "post_id",
            "item_id",
            "detail_item_id",
            "upload_item_id",
            "parent_post_id",
            "root_post_id",
            "original_post_id",
            "source_item_id",
            "raw_url",
            "remote_url",
            "media_url",
            "mediaUrl",
            "url",
            "source_url",
            "object_url",
        ):
            add(attachment.get(key))
        add(imagine_attachment_raw_url(attachment))
    return ids


def imagine_direct_source_candidate_ids(source_info: dict, ignored_urls: set[str]) -> set[str]:
    ids: set[str] = set()
    attachment_ids = source_info.get("attachment_source_ids") if isinstance(source_info, dict) else []
    if not isinstance(attachment_ids, list):
        attachment_ids = []
    for value in [
        source_info.get("parent_post_id") if isinstance(source_info, dict) else "",
        source_info.get("root_post_id") if isinstance(source_info, dict) else "",
        source_info.get("original_post_id") if isinstance(source_info, dict) else "",
        source_info.get("source_item_id") if isinstance(source_info, dict) else "",
        *attachment_ids,
        *list(ignored_urls or set()),
    ]:
        text = str(value or "").strip()
        if not text:
            continue
        ids.add(text)
        extracted = imagine_media_identity_id_from_text(text)
        if extracted:
            ids.add(extracted)
    return ids


def imagine_direct_candidate_is_source(candidate: dict, source_info: dict, ignored_urls: set[str]) -> bool:
    source_ids = imagine_direct_source_candidate_ids(source_info, ignored_urls)
    ignored_keys = {imagine_media_candidate_key(value) for value in ignored_urls if value}
    candidate_url = str((candidate or {}).get("url") or "").strip()
    candidate_key = imagine_media_candidate_key(candidate_url)
    candidate_post_id = extract_imagine_post_id_from_text((candidate or {}).get("post_id")) or str((candidate or {}).get("post_id") or "").strip()
    if candidate_key and candidate_key in ignored_keys:
        return True
    if candidate_post_id and candidate_post_id in source_ids:
        return True
    if candidate_url:
        extracted = imagine_media_identity_id_from_text(candidate_url)
        if extracted and extracted in source_ids:
            return True
    return False


def imagine_collect_media_candidates(events: list, expected_type: str, ignored_urls: set[str]) -> tuple[list[dict], list[dict]]:
    candidates: list[dict] = []
    thumbnails: list[dict] = []
    seen: set[str] = set()
    ignored = {imagine_media_candidate_key(value) for value in ignored_urls if value}

    def add_url(url: str, kind: str, node: dict | None = None, key: str = "") -> None:
        raw_url = imagine_remote_url(imagine_unwrap_remote_proxy(url))
        if not raw_url:
            return
        kind_value = kind or imagine_url_kind(key, raw_url, node or {})
        if kind_value not in {"image", "video"}:
            return
        media_key = imagine_media_candidate_key(raw_url)
        if media_key in ignored or media_key in seen:
            return
        seen.add(media_key)
        is_data_url = raw_url.startswith("data:")
        parsed_path = "" if is_data_url else urlparse(raw_url).path.lower()
        path_name = "" if is_data_url else Path(urlparse(raw_url).path).name
        thumbish = kind_value == "image" and (
            imagine_remote_thumbnail_key(key)
            or "preview_image" in parsed_path
            or "thumbnail" in parsed_path
            or "poster" in parsed_path
        )
        record = {
            "url": raw_url,
            "type": kind_value,
            "key": key,
            "post_id": imagine_media_node_post_id(node or {}, raw_url if not is_data_url else "", file_stem(path_name)),
            "conversation_id": str((node or {}).get("conversationId") or (node or {}).get("conversation_id") or "").strip(),
            "response_id": str((node or {}).get("responseId") or (node or {}).get("response_id") or "").strip(),
            "parent_response_id": str((node or {}).get("parentResponseId") or (node or {}).get("parent_response_id") or "").strip(),
            "root_post_id": imagine_node_relation_id(node or {}, "rootPostId", "root_post_id"),
            "parent_post_id": imagine_node_relation_id(node or {}, "parentPostId", "parent_post_id"),
            "original_post_id": imagine_node_relation_id(node or {}, "originalPostId", "original_post_id"),
            "original_ref_type": str((node or {}).get("originalRefType") or (node or {}).get("original_ref_type") or "").strip(),
            "thumbnail_url": imagine_node_thumbnail(node or {}),
            "created_at": imagine_post_time(node or {}),
            "prompt": imagine_post_text(node or {}),
            "model": str((node or {}).get("modelName") or "").strip(),
            "resolution_name": str((node or {}).get("resolutionName") or "").strip(),
            "video_duration": str((node or {}).get("videoDuration") or "").strip(),
            "progress": imagine_event_numeric_progress(node or {}),
            "moderated": bool((node or {}).get("moderated")),
        }
        if thumbish and expected_type == "video":
            thumbnails.append(record)
        elif kind_value == expected_type:
            candidates.append(record)

    def walk(value, parent_key: str = "") -> None:
        if isinstance(value, dict):
            primary = imagine_node_primary_media_url(value)
            if primary:
                add_url(primary, imagine_node_media_type(value, primary), value, parent_key or "mediaUrl")
            for key, child in value.items():
                key_text = str(key or "")
                if isinstance(child, str):
                    raw_url = imagine_remote_url(imagine_unwrap_remote_proxy(child))
                    if raw_url:
                        add_url(raw_url, imagine_url_kind(key_text, raw_url, value), value, key_text)
                    parsed_child = imagine_json_string_value(child)
                    if parsed_child is not None:
                        walk(parsed_child, key_text)
                elif isinstance(child, (dict, list)):
                    walk(child, key_text)
        elif isinstance(value, list):
            for child in value:
                if isinstance(child, str):
                    raw_url = imagine_remote_url(imagine_unwrap_remote_proxy(child))
                    if raw_url:
                        add_url(raw_url, imagine_url_kind(parent_key, raw_url, {}), {}, parent_key)
                    parsed_child = imagine_json_string_value(child)
                    if parsed_child is not None:
                        walk(parsed_child, parent_key)
                else:
                    walk(child, parent_key)
        elif isinstance(value, str):
            raw_url = imagine_remote_url(imagine_unwrap_remote_proxy(value))
            if raw_url:
                add_url(raw_url, imagine_url_kind(parent_key, raw_url, {}), {}, parent_key)
            parsed_value = imagine_json_string_value(value)
            if parsed_value is not None:
                walk(parsed_value, parent_key)

    walk(events)
    return candidates, thumbnails


def imagine_image_candidate_rank(candidate: dict) -> tuple[int, int]:
    raw_url = str(candidate.get("url") or "")
    path = urlparse(raw_url).path.lower()
    try:
        progress = int(candidate.get("progress") or 0)
    except (TypeError, ValueError):
        progress = 0
    final_generated = "/generated/" in path and "-part-" not in path and path.endswith((".jpg", ".jpeg", ".png", ".webp"))
    partial_generated = "/generated/" in path and "-part-" in path
    if final_generated:
        return 3, progress
    if progress >= 100:
        return 2, progress
    if raw_url.startswith("data:image/"):
        return 1, progress
    if partial_generated:
        return 1, progress
    return 0, progress


def imagine_prefer_final_image_candidates(candidates: list[dict]) -> list[dict]:
    selected: dict[str, tuple[tuple[int, int], int, dict]] = {}
    order: list[str] = []
    for index, candidate in enumerate(candidates):
        media_key = imagine_media_candidate_key(str(candidate.get("url") or ""))
        post_id = extract_imagine_post_id_from_text(candidate.get("post_id")) or extract_imagine_post_id_from_text(media_key) or media_key
        if not post_id:
            continue
        rank = imagine_image_candidate_rank(candidate)
        current = selected.get(post_id)
        if current is None:
            order.append(post_id)
            selected[post_id] = (rank, index, candidate)
            continue
        current_rank, current_index, _current_candidate = current
        if rank > current_rank or (rank == current_rank and index > current_index):
            selected[post_id] = (rank, index, candidate)
    return [selected[key][2] for key in order if key in selected]


def imagine_event_video_post_candidates(events: list) -> list[dict]:
    candidates: list[dict] = []
    seen: set[str] = set()

    def add_candidate(node: dict) -> None:
        post_id = extract_imagine_post_id_from_text(
            node.get("videoPostId")
            or node.get("video_post_id")
            or node.get("videoId")
            or node.get("video_id")
        )
        if not post_id or post_id in seen:
            return
        seen.add(post_id)
        candidates.append({
            "post_id": post_id,
            "conversation_id": str(node.get("conversationId") or node.get("conversation_id") or "").strip(),
            "response_id": str(node.get("responseId") or node.get("response_id") or "").strip(),
            "parent_response_id": str(node.get("parentResponseId") or node.get("parent_response_id") or "").strip(),
            "root_post_id": imagine_node_relation_id(node, "rootPostId", "root_post_id"),
            "parent_post_id": imagine_node_relation_id(node, "parentPostId", "parent_post_id"),
            "original_post_id": imagine_node_relation_id(node, "originalPostId", "original_post_id"),
            "original_ref_type": str(node.get("originalRefType") or node.get("original_ref_type") or "").strip(),
            "prompt": imagine_post_text(node) or str(node.get("videoPrompt") or "").strip(),
            "created_at": imagine_post_time(node),
            "model": str(node.get("modelName") or "").strip(),
            "resolution_name": str(node.get("resolutionName") or "").strip(),
            "video_duration": str(node.get("videoDuration") or node.get("videoLength") or "").strip(),
        })

    def walk(value) -> None:
        if isinstance(value, dict):
            if any(key in value for key in ("videoPostId", "video_post_id", "videoId", "video_id")):
                add_candidate(value)
            for child in value.values():
                if isinstance(child, (dict, list)):
                    walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(events)
    return candidates


def imagine_event_image_post_candidates(events: list) -> list[dict]:
    candidates: list[dict] = []
    seen: set[str] = set()

    def add_candidate(node: dict) -> None:
        raw_url = imagine_remote_url(str(
            node.get("imageUrl")
            or node.get("image_url")
            or node.get("mediaUrl")
            or node.get("media_url")
            or node.get("url")
            or ""
        ))
        post_id = extract_imagine_post_id_from_text(
            node.get("imageId")
            or node.get("image_id")
            or node.get("assetId")
            or node.get("asset_id")
            or node.get("postId")
            or node.get("post_id")
        ) or generated_media_id_from_url(raw_url)
        if not post_id or post_id in seen:
            return
        seen.add(post_id)
        candidates.append({
            "url": raw_url,
            "post_id": post_id,
            "conversation_id": str(node.get("conversationId") or node.get("conversation_id") or "").strip(),
            "response_id": str(node.get("responseId") or node.get("response_id") or "").strip(),
            "parent_response_id": str(node.get("parentResponseId") or node.get("parent_response_id") or "").strip(),
            "root_post_id": imagine_node_relation_id(node, "rootPostId", "root_post_id"),
            "parent_post_id": imagine_node_relation_id(node, "parentPostId", "parent_post_id"),
            "original_post_id": imagine_node_relation_id(node, "originalPostId", "original_post_id"),
            "original_ref_type": str(node.get("originalRefType") or node.get("original_ref_type") or "").strip(),
            "prompt": imagine_post_text(node),
            "created_at": imagine_post_time(node),
            "model": str(node.get("imageModel") or node.get("modelName") or "").strip(),
            "resolution_name": str(node.get("resolutionName") or "").strip(),
        })

    def walk(value) -> None:
        if isinstance(value, dict):
            if any(key in value for key in ("imageId", "image_id", "assetId", "asset_id", "imageUrl", "image_url", "mediaUrl", "media_url")):
                add_candidate(value)
            for child in value.values():
                if isinstance(child, (dict, list)):
                    walk(child)
                elif isinstance(child, str):
                    parsed_child = imagine_json_string_value(child)
                    if parsed_child is not None:
                        walk(parsed_child)
                    elif imagine_remote_url(imagine_unwrap_remote_proxy(child)):
                        add_candidate({"imageUrl": child})
        elif isinstance(value, list):
            for child in value:
                if isinstance(child, str):
                    parsed_child = imagine_json_string_value(child)
                    if parsed_child is not None:
                        walk(parsed_child)
                    elif imagine_remote_url(imagine_unwrap_remote_proxy(child)):
                        add_candidate({"imageUrl": child})
                else:
                    walk(child)
        elif isinstance(value, str):
            parsed_value = imagine_json_string_value(value)
            if parsed_value is not None:
                walk(parsed_value)
            elif imagine_remote_url(imagine_unwrap_remote_proxy(value)):
                add_candidate({"imageUrl": value})

    walk(events)
    return candidates


def imagine_user_id_from_url(url: str) -> str:
    path = urlparse(imagine_unwrap_remote_proxy(str(url or ""))).path
    match = re.search(r"/users/([^/]+)/", path)
    return match.group(1) if match else ""


def imagine_user_ids_from_urls(urls) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for url in urls:
        user_id = imagine_user_id_from_url(str(url or ""))
        if user_id and user_id not in seen:
            seen.add(user_id)
            ids.append(user_id)
    return ids


# VIDEO_CANDIDATE_RECOVERY: Imagine maps stream videoPostId to generated_video.mp4 candidates.
def imagine_generated_video_urls(user_id: str, post_id: str) -> tuple[str, str]:
    base = f"{IMAGINE_ASSETS_BASE}/users/{quote(user_id)}/generated/{quote(post_id)}"
    return f"{base}/generated_video.mp4", f"{base}/preview_image.jpg"


def imagine_generated_image_urls(user_id: str, post_id: str) -> tuple[str, str]:
    base = f"{IMAGINE_ASSETS_BASE}/users/{quote(user_id)}/generated/{quote(post_id)}"
    return f"{base}/image.jpg", f"{IMAGINE_ASSETS_BASE}/users/{quote(user_id)}/generated/{quote(post_id)}-part-0/image.jpg"


def imagine_image_url_is_partial(url: str) -> bool:
    raw_url = imagine_unwrap_remote_proxy(str(url or "").strip())
    if raw_url.startswith("data:image/"):
        return True
    path = urlparse(raw_url).path.lower()
    return "-part-" in path or "thumbnail" in path or "preview" in path or "poster" in path


def imagine_image_url_is_final(url: str) -> bool:
    raw_url = imagine_unwrap_remote_proxy(str(url or "").strip())
    path = urlparse(raw_url).path.lower()
    return (
        "/generated/" in path
        and "-part-" not in path
        and path.endswith((".jpg", ".jpeg", ".png", ".webp"))
    )


def imagine_accept_direct_image_candidate(candidate: dict, action: str) -> bool:
    if action not in {"i2i", "aspect"}:
        return True
    raw_url = str(candidate.get("url") or "").strip()
    if imagine_image_url_is_partial(raw_url):
        return False
    if imagine_image_url_is_final(raw_url):
        return True
    try:
        progress = int(candidate.get("progress") or 0)
    except (TypeError, ValueError):
        progress = 0
    return progress >= 100


def imagine_remote_media_available(url: str, account: dict, kind: str = "video", timeout: int = 8) -> bool:
    raw_url = imagine_remote_url(imagine_unwrap_remote_proxy(url))
    if not raw_url:
        return False
    headers = {
        "Accept": "video/*,*/*" if kind == "video" else "image/*,*/*",
        "Referer": IMAGINE_BASE + "/imagine",
        "User-Agent": imagine_user_agent(),
    }
    cookies = valid_imagine_cookies(account)
    if cookies:
        headers["Cookie"] = cookie_header(cookies)
    for method, extra_headers in (("HEAD", {}), ("GET", {"Range": "bytes=0-0"})):
        request_headers = dict(headers)
        request_headers.update(extra_headers)
        request = urllib.request.Request(raw_url, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = int(getattr(response, "status", 200) or 200)
                return 200 <= status < 400
        except urllib.error.HTTPError as exc:
            if method == "HEAD" and exc.code in {405, 501}:
                continue
            if method == "GET" and exc.code == 206:
                return True
        except (urllib.error.URLError, OSError, TimeoutError):
            pass
    return False


# VIDEO_CANDIDATE_RECOVERY: Imagine checks post/get first, then generated_video.mp4 URL pattern.
def imagine_direct_item_from_post_candidate(
    candidate: dict,
    account: dict,
    expected_type: str,
    prompt: str,
    action: str,
    request_id: str,
    source_info: dict,
    ignored_urls: set[str],
    cancel_checker=None,
    allow_unverified: bool = False,
    candidate_already_stabilized: bool = False,
    recovery_stabilize_seconds: int | None = None,
) -> dict | None:
    post_id = extract_imagine_post_id_from_text(candidate.get("post_id")) or str(candidate.get("post_id") or "").strip()
    if not post_id:
        return None

    detail = imagine_post_detail(post_id, account, timeout=12)
    if detail:
        entries = [entry for entry in collect_imagine_media_entries(detail) if entry.get("type") == expected_type]
        matching = [entry for entry in entries if str(entry.get("item_id") or "") == post_id]
        entry = (matching or entries or [None])[-1]
        if entry:
            direct_candidate = {
                "url": entry.get("url") or "",
                "type": expected_type,
                "post_id": entry.get("item_id") or post_id,
                "conversation_id": candidate.get("conversation_id") or source_info.get("conversation_id") or "",
                "response_id": candidate.get("response_id") or "",
                "parent_response_id": candidate.get("parent_response_id") or source_info.get("parent_response_id") or "",
                "root_post_id": entry.get("root_post_id") or candidate.get("root_post_id") or "",
                "parent_post_id": entry.get("parent_post_id") or candidate.get("parent_post_id") or "",
                "original_post_id": entry.get("original_post_id") or candidate.get("original_post_id") or "",
                "original_ref_type": entry.get("original_ref_type") or candidate.get("original_ref_type") or "",
                "thumbnail_url": entry.get("thumbnail_url") or "",
                "created_at": entry.get("created_at") or candidate.get("created_at") or "",
                "prompt": entry.get("prompt") or candidate.get("prompt") or prompt,
                "model": entry.get("model") or candidate.get("model") or "",
                "resolution_name": entry.get("resolution_name") or candidate.get("resolution_name") or "",
                "video_duration": entry.get("video_duration") or candidate.get("video_duration") or "",
            }
            if direct_candidate["url"]:
                if expected_type != "image" or imagine_accept_direct_image_candidate(direct_candidate, action):
                    return imagine_direct_item_from_candidate(direct_candidate, expected_type, account, prompt, action, request_id, source_info)

    user_ids = imagine_user_ids_from_urls([*ignored_urls, candidate.get("url") or ""])
    for user_id in user_ids:
        if expected_type == "image":
            explicit_url = str(candidate.get("url") or "").strip()
            generated_urls = list(imagine_generated_image_urls(user_id, post_id))
            if action in {"i2i", "aspect"}:
                image_urls = [url for url in [explicit_url, *generated_urls] if imagine_image_url_is_final(url)]
            else:
                image_urls = [explicit_url] if explicit_url else []
                image_urls.extend(generated_urls)
            for image_url in [url for index, url in enumerate(image_urls) if url and url not in image_urls[:index]]:
                media_available = imagine_remote_media_available(image_url, account, "image", timeout=8)
                if not media_available and not allow_unverified:
                    continue
                direct_candidate = {
                    "url": image_url,
                    "type": expected_type,
                    "post_id": post_id,
                    "conversation_id": candidate.get("conversation_id") or source_info.get("conversation_id") or "",
                    "response_id": candidate.get("response_id") or "",
                    "parent_response_id": candidate.get("parent_response_id") or source_info.get("parent_response_id") or "",
                    "root_post_id": candidate.get("root_post_id") or source_info.get("root_post_id") or "",
                    "parent_post_id": candidate.get("parent_post_id") or source_info.get("parent_post_id") or "",
                    "original_post_id": candidate.get("original_post_id") or source_info.get("original_post_id") or "",
                    "original_ref_type": candidate.get("original_ref_type") or source_info.get("original_ref_type") or "",
                    "thumbnail_url": image_url,
                    "created_at": candidate.get("created_at") or now_iso(),
                    "prompt": candidate.get("prompt") or prompt,
                    "model": candidate.get("model") or "imagine-image-edit",
                    "resolution_name": candidate.get("resolution_name") or "",
                }
                imagine_debug_event("candidate_image_recheck_found", {
                    "request_id": request_id,
                    "action": action,
                    "post_id": post_id,
                    "media_url": image_url,
                    "verified": media_available,
                })
                return imagine_direct_item_from_candidate(direct_candidate, expected_type, account, prompt, action, request_id, source_info)
            continue
        video_url, thumb_url = imagine_generated_video_urls(user_id, post_id)
        media_available = imagine_remote_media_available(video_url, account, expected_type)
        if not media_available and not allow_unverified:
            continue
        stabilize_seconds = 0 if candidate_already_stabilized else max(0, int(
            IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS
            if recovery_stabilize_seconds is None
            else recovery_stabilize_seconds
        ))
        if media_available and stabilize_seconds:
            imagine_debug_event("candidate_post_stabilize_start", {
                "marker": "VIDEO_CANDIDATE_RECOVERY",
                "request_id": request_id,
                "action": action,
                "post_id": post_id,
                "wait_seconds": stabilize_seconds,
                "media_url": video_url,
            })
            sleep_with_optional_cancel(stabilize_seconds, cancel_checker)
            if not imagine_remote_media_available(video_url, account, expected_type):
                imagine_debug_event("candidate_post_stabilize_lost", {
                    "marker": "VIDEO_CANDIDATE_RECOVERY",
                    "request_id": request_id,
                    "action": action,
                    "post_id": post_id,
                    "media_url": video_url,
                })
                continue
            imagine_debug_event("candidate_post_stabilize_ready", {
                "marker": "VIDEO_CANDIDATE_RECOVERY",
                "request_id": request_id,
                "action": action,
                "post_id": post_id,
                "wait_seconds": stabilize_seconds,
                "media_url": video_url,
            })
        elif not media_available and allow_unverified:
            imagine_debug_event("candidate_post_unverified_url", {
                "marker": "VIDEO_CANDIDATE_RECOVERY",
                "request_id": request_id,
                "action": action,
                "post_id": post_id,
                "media_url": video_url,
            })
        direct_candidate = {
            "url": video_url,
            "type": expected_type,
            "post_id": post_id,
            "conversation_id": candidate.get("conversation_id") or source_info.get("conversation_id") or "",
            "response_id": candidate.get("response_id") or "",
            "parent_response_id": candidate.get("parent_response_id") or source_info.get("parent_response_id") or "",
            "root_post_id": candidate.get("root_post_id") or source_info.get("root_post_id") or "",
            "parent_post_id": candidate.get("parent_post_id") or source_info.get("parent_post_id") or "",
            "original_post_id": candidate.get("original_post_id") or source_info.get("original_post_id") or "",
            "original_ref_type": candidate.get("original_ref_type") or source_info.get("original_ref_type") or "",
            "thumbnail_url": thumb_url if (allow_unverified or imagine_remote_media_available(thumb_url, account, "image", timeout=5)) else "",
            "created_at": candidate.get("created_at") or now_iso(),
            "prompt": candidate.get("prompt") or prompt,
            "model": candidate.get("model") or "imagine-video-gen",
            "resolution_name": candidate.get("resolution_name") or "",
            "video_duration": candidate.get("video_duration") or "",
        }
        return imagine_direct_item_from_candidate(direct_candidate, expected_type, account, prompt, action, request_id, source_info)
    return None


def imagine_direct_item_from_candidate(
    candidate: dict,
    expected_type: str,
    account: dict,
    prompt: str,
    action: str,
    request_id: str,
    source_info: dict,
    thumbnail: dict | None = None,
) -> dict:
    raw_url = str(candidate.get("url") or "").strip()
    if not raw_url:
        raise RuntimeError("Imagine response did not contain media.")
    is_data_url = raw_url.startswith("data:")
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    item_id = str(candidate.get("post_id") or "").strip()
    if not item_id or item_id in {"generated_video", "preview_image", "image"}:
        stem = "" if is_data_url else file_stem(Path(urlparse(raw_url).path).name)
        item_id = f"{stem or expected_type}-{request_id[:8]}"
    parent_post_id = str(candidate.get("parent_post_id") or source_info.get("parent_post_id") or "").strip()
    original_post_id = str(candidate.get("original_post_id") or source_info.get("original_post_id") or parent_post_id).strip()
    conversation_id = str(candidate.get("conversation_id") or source_info.get("conversation_id") or "").strip()
    response_id = str(candidate.get("response_id") or "").strip()
    parent_response_id = str(candidate.get("parent_response_id") or source_info.get("parent_response_id") or "").strip()
    root_post_id = str(candidate.get("root_post_id") or conversation_id or source_info.get("root_post_id") or parent_post_id or item_id).strip()
    source_item_id = str(source_info.get("source_item_id") or parent_post_id or original_post_id or "").strip()
    raw_thumb = str(candidate.get("thumbnail_url") or (thumbnail or {}).get("url") or "").strip()
    proxied_url = raw_url if is_data_url else imagine_saved_proxy_url(raw_url, expected_type, account_id_value)
    if raw_thumb.startswith("data:"):
        proxied_thumb = raw_thumb
    else:
        proxied_thumb = imagine_saved_proxy_url(raw_thumb, "image", account_id_value) if raw_thumb else (proxied_url if expected_type == "image" else "")
    imagine_metadata = {
        "post_id": item_id,
        "asset_id": item_id,
        "root_post_id": root_post_id,
        "conversation_id": conversation_id,
        "response_id": response_id,
        "parent_response_id": parent_response_id,
        "media_url": raw_url,
        "media_type": expected_type,
        "source_item_id": source_item_id,
        "original_post_id": original_post_id,
        "parent_post_id": parent_post_id,
        "original_ref_type": str(candidate.get("original_ref_type") or source_info.get("original_ref_type") or "").strip(),
        "request_id": request_id,
        "action": action,
        "account_id": account_id_value,
        "account_email": account_email,
    }
    aspect_ratio = str(candidate.get("aspect_ratio") or source_info.get("aspect_ratio") or "").strip()
    if aspect_ratio:
        imagine_metadata["aspect_ratio"] = aspect_ratio
    metadata = {
        "asset_id": item_id,
        "conversation_id": conversation_id,
        "response_id": response_id,
        "parent_response_id": parent_response_id,
        "remote_url": raw_url,
        "media_url": raw_url,
        "thumbnail_url": raw_thumb,
        "imagine": imagine_metadata,
    }
    if aspect_ratio:
        metadata["aspect_ratio"] = aspect_ratio
    return {
        "item_id": item_id,
        "post_id": item_id,
        "asset_id": item_id,
        "type": expected_type,
        "file": "",
        "url": raw_url,
        "remote_url": raw_url,
        "object_url": proxied_url,
        "thumbnail_url": proxied_thumb,
        "mime_type": "video/mp4" if expected_type == "video" else (data_url_mime_type(raw_url) if is_data_url else "image/*"),
        "role": "result",
        "relation": "child",
        "source_item_id": source_item_id,
        "original_post_id": original_post_id,
        "parent_post_id": parent_post_id,
        "root_post_id": root_post_id,
        "conversation_id": conversation_id,
        "response_id": response_id,
        "parent_response_id": parent_response_id,
        "original_ref_type": imagine_metadata["original_ref_type"],
        "prompt": str(candidate.get("prompt") or prompt or ""),
        "created_at": str(candidate.get("created_at") or now_iso()),
        "model": str(candidate.get("model") or ("imagine-image-edit" if action in {"i2i", "aspect"} else "imagine-video-gen")),
        "resolution_name": str(candidate.get("resolution_name") or ""),
        "video_duration": str(candidate.get("video_duration") or ""),
        "aspect_ratio": aspect_ratio,
        "aspectRatio": aspect_ratio,
        "metadata": metadata,
    }


def imagine_generated_like_post_id(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    for value in (
        imagine.get("post_id"),
        metadata.get("post_id"),
        item.get("post_id"),
        item.get("item_id"),
    ):
        post_id = imagine_post_id_from_value(str(value or "")) or extract_imagine_post_id_from_text(value)
        if post_id:
            return post_id
    for value in (
        imagine.get("media_url"),
        metadata.get("media_url"),
        item.get("remote_url"),
        item.get("url"),
    ):
        post_id = generated_media_id_from_url(str(value or "")) or extract_imagine_post_id_from_text(value)
        if post_id:
            return post_id
    return ""


def imagine_mark_result_item_liked(item: dict, liked: bool = True) -> None:
    if not isinstance(item, dict):
        return
    item["liked"] = liked
    item["favorite"] = liked
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    metadata["liked"] = liked
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    imagine["liked"] = liked
    metadata["imagine"] = imagine
    item["metadata"] = metadata


def imagine_like_generated_result_posts(items: list[dict], account: dict, request_id: str, action: str) -> list[str]:
    if action == "t2i":
        return []
    liked_ids: list[str] = []
    seen: set[str] = set()
    for item in items or []:
        post_id = imagine_generated_like_post_id(item)
        if not post_id or post_id in seen:
            continue
        seen.add(post_id)
        try:
            imagine_post_json(
                "/rest/media/post/like",
                {"id": post_id},
                account,
                timeout=15,
                referer=IMAGINE_BASE + "/imagine",
            )
        except Exception as exc:
            imagine_debug_event("generated_result_like_failed", {
                "request_id": request_id,
                "action": action,
                "post_id": post_id,
                "error": str(exc)[:500],
            })
            continue
        liked_ids.append(post_id)
        for candidate in items or []:
            if imagine_generated_like_post_id(candidate) == post_id:
                imagine_mark_result_item_liked(candidate, True)
    imagine_debug_event("generated_result_like", {
        "request_id": request_id,
        "action": action,
        "liked_ids": liked_ids,
    })
    return liked_ids


def imagine_moderated_item_from_candidate(
    candidate: dict,
    expected_type: str,
    account: dict,
    prompt: str,
    action: str,
    request_id: str,
    source_info: dict,
) -> dict:
    account_id_value = str(account.get("id") or "")
    account_email = str(account.get("email") or "")
    item_id = str(candidate.get("post_id") or "").strip()
    if not item_id:
        order = safe_int(candidate.get("order"), 0)
        item_id = f"moderated-{request_id[:8]}-{order or uuid.uuid4().hex[:4]}"
    parent_post_id = str(candidate.get("parent_post_id") or source_info.get("parent_post_id") or "").strip()
    original_post_id = str(candidate.get("original_post_id") or source_info.get("original_post_id") or parent_post_id).strip()
    root_post_id = str(candidate.get("root_post_id") or source_info.get("root_post_id") or parent_post_id or item_id).strip()
    source_item_id = str(source_info.get("source_item_id") or parent_post_id or original_post_id or "").strip()
    metadata = {
        "imagine": {
            "post_id": item_id,
            "root_post_id": root_post_id,
            "media_url": "",
            "media_type": expected_type,
            "source_item_id": source_item_id,
            "original_post_id": original_post_id,
            "parent_post_id": parent_post_id,
            "original_ref_type": str(candidate.get("original_ref_type") or source_info.get("original_ref_type") or "").strip(),
            "request_id": request_id,
            "action": action,
            "account_id": account_id_value,
            "account_email": account_email,
            "moderated": True,
        },
        "moderated": True,
    }
    aspect_ratio = str(candidate.get("aspect_ratio") or source_info.get("aspect_ratio") or "").strip()
    if aspect_ratio:
        metadata["aspect_ratio"] = aspect_ratio
        metadata["imagine"]["aspect_ratio"] = aspect_ratio
    return {
        "item_id": item_id,
        "type": expected_type,
        "file": "",
        "url": "",
        "remote_url": "",
        "object_url": "",
        "thumbnail_url": "",
        "mime_type": "video/mp4" if expected_type == "video" else "image/*",
        "role": "result",
        "relation": "child",
        "source_item_id": source_item_id,
        "original_post_id": original_post_id,
        "parent_post_id": parent_post_id,
        "root_post_id": root_post_id,
        "original_ref_type": metadata["imagine"]["original_ref_type"],
        "prompt": str(candidate.get("prompt") or prompt or ""),
        "created_at": str(candidate.get("created_at") or now_iso()),
        "model": str(candidate.get("model") or ("imagine-image-edit" if action in {"i2i", "aspect"} else "imagine-video-gen")),
        "resolution_name": str(candidate.get("resolution_name") or ""),
        "video_duration": str(candidate.get("video_duration") or ""),
        "aspect_ratio": aspect_ratio,
        "aspectRatio": aspect_ratio,
        "status": "moderated",
        "moderated": True,
        "metadata": metadata,
    }


def imagine_direct_item_from_events(
    events: list,
    expected_type: str,
    account: dict,
    prompt: str,
    action: str,
    request_id: str,
    source_info: dict,
    ignored_urls: set[str],
) -> dict | None:
    items = imagine_direct_items_from_events(events, expected_type, account, prompt, action, request_id, source_info, ignored_urls)
    return items[-1] if items else None


def imagine_direct_items_from_events(
    events: list,
    expected_type: str,
    account: dict,
    prompt: str,
    action: str,
    request_id: str,
    source_info: dict,
    ignored_urls: set[str],
) -> list[dict]:
    candidates, thumbnails = imagine_collect_media_candidates(events, expected_type, ignored_urls)
    before_source_filter = len(candidates)
    candidates = [
        candidate for candidate in candidates
        if not imagine_direct_candidate_is_source(candidate, source_info, ignored_urls)
    ]
    if before_source_filter != len(candidates):
        imagine_debug_event("direct_candidates_source_filtered", {
            "request_id": request_id,
            "action": action,
            "expected_type": expected_type,
            "before_count": before_source_filter,
            "after_count": len(candidates),
        })
    if not candidates:
        return []
    if expected_type == "video":
        candidates = candidates[-1:]
    elif expected_type == "image":
        before_count = len(candidates)
        candidates = imagine_prefer_final_image_candidates(candidates)
        if action in {"i2i", "aspect"}:
            candidates = [candidate for candidate in candidates if imagine_accept_direct_image_candidate(candidate, action)]
        imagine_debug_event("direct_image_candidates_preferred", {
            "request_id": request_id,
            "action": action,
            "before_count": before_count,
            "after_count": len(candidates),
            "selected": [
                {
                    "post_id": candidate.get("post_id") or "",
                    "url": candidate.get("url") or "",
                    "progress": candidate.get("progress"),
                    "rank": imagine_image_candidate_rank(candidate),
                }
                for candidate in candidates[-4:]
            ],
        })
    items = []
    for candidate in candidates:
        item = imagine_direct_item_from_candidate(
            candidate,
            expected_type,
            account,
            prompt,
            action,
            request_id,
            source_info,
            thumbnails[-1] if thumbnails else None,
        )
        items.append(item)
    return items


def imagine_filter_source_only_events(
    events: list,
    expected_type: str,
    source_info: dict,
    ignored_urls: set[str],
    request_id: str,
    action: str,
) -> list:
    kept: list = []
    removed = 0
    for event in events or []:
        candidates, _thumbnails = imagine_collect_media_candidates([event], expected_type, ignored_urls)
        post_candidates = imagine_event_video_post_candidates([event]) if expected_type == "video" else imagine_event_image_post_candidates([event])
        candidates = [*candidates, *post_candidates]
        if candidates and all(imagine_direct_candidate_is_source(candidate, source_info, ignored_urls) for candidate in candidates):
            removed += 1
            continue
        kept.append(event)
    if removed:
        imagine_debug_event("source_only_events_filtered", {
            "request_id": request_id,
            "action": action,
            "expected_type": expected_type,
            "before_count": len(events or []),
            "after_count": len(kept),
            "removed_count": removed,
        })
    return kept


def imagine_item_uses_data_url(item: dict | None) -> bool:
    return str((item or {}).get("url") or (item or {}).get("remote_url") or "").strip().startswith("data:image/")


def imagine_saved_candidate_ids(account: dict, expected_type: str, parent_ids: set[str], ignored_urls: set[str]) -> set[str]:
    data = imagine_post_json(
        "/rest/media/post/list",
        {
            "limit": 40,
            "includeCanvas": False,
            "filter": {"source": "MEDIA_POST_SOURCE_LIKED", "safeForWork": False},
        },
        account,
        timeout=20,
    )
    posts = data.get("posts") if isinstance(data.get("posts"), list) else []
    ids: set[str] = set()
    ignored = {imagine_media_candidate_key(value) for value in ignored_urls if value}
    for root_post in posts:
        if not isinstance(root_post, dict):
            continue
        for entry in collect_imagine_media_entries(root_post):
            if entry.get("type") != expected_type:
                continue
            media_key = imagine_media_candidate_key(str(entry.get("url") or ""))
            entry_id = str(entry.get("item_id") or "")
            if media_key in ignored:
                if entry_id:
                    ids.add(entry_id)
                ids.add(media_key)
                continue
            related = {
                entry_id,
                str(entry.get("root_post_id") or ""),
                str(entry.get("parent_post_id") or ""),
                str(entry.get("original_post_id") or ""),
                str(entry.get("source_item_id") or ""),
            }
            if parent_ids and not (related & parent_ids):
                continue
            ids.add(entry_id or media_key)
            ids.add(media_key)
    return {value for value in ids if value}


def imagine_generated_relation_baseline_ids(root: Path, source_post_path: str, expected_type: str) -> set[str]:
    source_id = imagine_relation_source_id(source_post_path)
    if not source_id:
        return set()
    library = merge_library_json(read_json(root / "library.json", {}))
    settings = library.get("settings") if isinstance(library.get("settings"), dict) else {}
    relations = settings.get("imagine_generated_relations") if isinstance(settings.get("imagine_generated_relations"), dict) else {}
    record = relations.get(source_id) if isinstance(relations.get(source_id), dict) else {}
    ids: set[str] = set()
    for item in record.get("items") if isinstance(record.get("items"), list) else []:
        if not isinstance(item, dict) or str(item.get("type") or "").lower() != expected_type:
            continue
        entry_id = imagine_relation_item_key(item)
        media_url = str(item.get("remote_url") or item.get("url") or "")
        media_key = imagine_media_candidate_key(media_url)
        if entry_id:
            ids.add(entry_id)
        if media_key:
            ids.add(media_key)
    return ids


def imagine_wait_for_saved_direct_result(
    account: dict,
    expected_type: str,
    prompt: str,
    action: str,
    request_id: str,
    source_info: dict,
    parent_ids: set[str],
    ignored_urls: set[str],
    baseline_ids: set[str],
    wait_seconds: int,
    poll_seconds: int,
    post_candidates: list[dict] | None = None,
    deadline: float | None = None,
    progress_started_at: float | None = None,
    progress_deadline: float | None = None,
    progress_start: int = 1,
    progress_end: int = 98,
    progress_callback=None,
    cancel_checker=None,
    candidate_initial_delay_seconds: int = 0,
    candidate_stabilize_seconds: int = 0,
    post_candidates_stabilized: bool = False,
    candidate_recovery_stabilize_seconds: int | None = None,
) -> dict | None:
    end_time = deadline if deadline is not None else time.time() + max(0, int(wait_seconds))
    if progress_started_at is None:
        progress_started_at = time.time()
    ignored_keys = {imagine_media_candidate_key(value) for value in ignored_urls if value}
    source_ids = {
        extract_imagine_post_id_from_text(value) or str(value or "").strip()
        for value in [
            *parent_ids,
            source_info.get("parent_post_id"),
            source_info.get("root_post_id"),
            source_info.get("original_post_id"),
            source_info.get("source_item_id"),
        ]
        if str(value or "").strip()
    }
    strict_saved_candidate_ids: set[str] = set()
    if expected_type == "image" and action in {"i2i", "aspect"} and post_candidates:
        for candidate in post_candidates:
            candidate_id = extract_imagine_post_id_from_text((candidate or {}).get("post_id")) or str((candidate or {}).get("post_id") or "").strip()
            if candidate_id:
                strict_saved_candidate_ids.add(candidate_id)
    conversation_recheck_ids = {
        extract_imagine_post_id_from_text(value) or str(value or "").strip()
        for value in (
            source_info.get("generation_root_post_id"),
            source_info.get("conversation_id"),
        )
        if str(value or "").strip()
    }
    imagine_debug_event("saved_recheck_start", {
        "request_id": request_id,
        "action": action,
        "expected_type": expected_type,
        "wait_seconds": wait_seconds,
        "poll_seconds": poll_seconds,
        "remaining_seconds": remaining_seconds_until(end_time, wait_seconds),
        "parent_ids": sorted(parent_ids),
        "baseline_count": len(baseline_ids),
        "ignored_count": len([value for value in ignored_urls if value]),
        "post_candidate_count": len(post_candidates or []),
        "candidate_initial_delay_seconds": candidate_initial_delay_seconds,
        "candidate_stabilize_seconds": candidate_stabilize_seconds,
        "source_info": source_info,
    })
    if post_candidates and candidate_initial_delay_seconds > 0:
        delay = min(max(0, candidate_initial_delay_seconds), max(0.0, end_time - time.time()))
        if delay:
            imagine_debug_event("candidate_recheck_initial_delay", {
                "request_id": request_id,
                "action": action,
                "expected_type": expected_type,
                "wait_seconds": delay,
                "post_candidate_count": len(post_candidates),
            })
            sleep_with_optional_cancel(delay, cancel_checker)
    while time.time() < end_time:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")
        if progress_callback:
            display_deadline = progress_deadline if progress_deadline is not None else end_time
            fallback_progress = elapsed_display_progress(progress_started_at, display_deadline, progress_start, progress_end)
            progress_callback(
                display_generation_progress(fallback=fallback_progress, end_progress=progress_end),
                "running",
                {"request_id": request_id, "action": action, "progress_source": "saved_recheck"},
            )
        time.sleep(min(max(0.5, poll_seconds), max(0.0, end_time - time.time())))
        for root_post_id in sorted(source_ids):
            if root_post_id in conversation_recheck_ids:
                try:
                    conversation_detail = imagine_conversation_detail(root_post_id, account)
                except Exception:
                    conversation_detail = {}
                conversation_items, _response_by_id = imagine_conversation_items_from_detail(
                    root_post_id,
                    conversation_detail,
                    account,
                )
                for conversation_item in conversation_items:
                    if conversation_item.get("type") != expected_type:
                        continue
                    entry_id = str(conversation_item.get("item_id") or "")
                    entry_url = str(conversation_item.get("remote_url") or conversation_item.get("url") or "")
                    media_key = imagine_media_candidate_key(entry_url)
                    if not entry_id or not entry_url:
                        continue
                    if entry_id in baseline_ids or media_key in baseline_ids:
                        continue
                    if entry_id in source_ids or media_key in source_ids or media_key in ignored_keys:
                        continue
                    related = {
                        entry_id,
                        str(conversation_item.get("root_post_id") or ""),
                        str(conversation_item.get("parent_post_id") or ""),
                        str(conversation_item.get("original_post_id") or ""),
                        str(conversation_item.get("source_item_id") or ""),
                    }
                    if parent_ids and not (related & parent_ids):
                        continue
                    candidate = {
                        "url": entry_url,
                        "type": expected_type,
                        "post_id": entry_id,
                        "conversation_id": conversation_item.get("conversation_id") or root_post_id,
                        "response_id": conversation_item.get("response_id") or "",
                        "parent_response_id": conversation_item.get("parent_response_id") or "",
                        "root_post_id": conversation_item.get("root_post_id") or root_post_id,
                        "parent_post_id": conversation_item.get("parent_post_id") or source_info.get("parent_post_id") or "",
                        "original_post_id": conversation_item.get("original_post_id") or source_info.get("original_post_id") or "",
                        "original_ref_type": conversation_item.get("original_ref_type") or "",
                        "thumbnail_url": conversation_item.get("thumbnail_url") or "",
                        "created_at": conversation_item.get("created_at") or "",
                        "prompt": conversation_item.get("prompt") or prompt,
                        "model": conversation_item.get("model") or "",
                        "resolution_name": conversation_item.get("resolution_name") or "",
                        "video_duration": conversation_item.get("video_duration") or "",
                    }
                    imagine_debug_event("candidate_conversation_recheck_found", {
                        "request_id": request_id,
                        "action": action,
                        "conversation_id": root_post_id,
                        "entry_id": entry_id,
                        "media_url": entry_url,
                    })
                    return imagine_direct_item_from_candidate(
                        candidate,
                        expected_type,
                        account,
                        prompt,
                        action,
                        request_id,
                        source_info,
                    )
            detail = imagine_post_detail(root_post_id, account, timeout=12)
            if not detail:
                continue
            for entry in collect_imagine_media_entries(detail):
                if entry.get("type") != expected_type:
                    continue
                entry_id = str(entry.get("item_id") or "")
                entry_url = str(entry.get("url") or "")
                media_key = imagine_media_candidate_key(entry_url)
                if not entry_id or not entry_url:
                    continue
                if entry_id in baseline_ids or media_key in baseline_ids:
                    continue
                if entry_id in source_ids or media_key in source_ids or media_key in ignored_keys:
                    continue
                related = {
                    entry_id,
                    str(entry.get("root_post_id") or ""),
                    str(entry.get("parent_post_id") or ""),
                    str(entry.get("original_post_id") or ""),
                    str(entry.get("source_item_id") or ""),
                }
                if parent_ids and not (related & parent_ids):
                    continue
                candidate = {
                    "url": entry_url,
                    "type": expected_type,
                    "post_id": entry_id,
                    "root_post_id": entry.get("root_post_id") or root_post_id,
                    "parent_post_id": entry.get("parent_post_id") or source_info.get("parent_post_id") or "",
                    "original_post_id": entry.get("original_post_id") or source_info.get("original_post_id") or "",
                    "original_ref_type": entry.get("original_ref_type") or "",
                    "thumbnail_url": entry.get("thumbnail_url") or "",
                    "created_at": entry.get("created_at") or "",
                    "prompt": entry.get("prompt") or prompt,
                    "model": entry.get("model") or "",
                    "resolution_name": entry.get("resolution_name") or "",
                    "video_duration": entry.get("video_duration") or "",
                }
                imagine_debug_event("candidate_root_recheck_found", {
                    "request_id": request_id,
                    "action": action,
                    "root_post_id": root_post_id,
                    "entry_id": entry_id,
                    "media_url": entry_url,
                })
                return imagine_direct_item_from_candidate(candidate, expected_type, account, prompt, action, request_id, source_info)
        for post_candidate in post_candidates or []:
            if imagine_direct_candidate_is_source(post_candidate, source_info, ignored_urls):
                imagine_debug_event("candidate_post_recheck_source_skipped", {
                    "request_id": request_id,
                    "action": action,
                    "expected_type": expected_type,
                    "post_id": post_candidate.get("post_id") or "",
                })
                continue
            candidate_item = imagine_direct_item_from_post_candidate(
                post_candidate,
                account,
                expected_type,
                prompt,
                action,
                request_id,
                source_info,
                ignored_urls,
                cancel_checker=cancel_checker,
                candidate_already_stabilized=post_candidates_stabilized,
                recovery_stabilize_seconds=candidate_recovery_stabilize_seconds,
            )
            if candidate_item:
                if candidate_stabilize_seconds > 0:
                    delay = min(max(0, candidate_stabilize_seconds), max(0.0, end_time - time.time()))
                    if delay:
                        imagine_debug_event("candidate_recheck_stabilize_start", {
                            "request_id": request_id,
                            "action": action,
                            "expected_type": expected_type,
                            "wait_seconds": delay,
                            "post_id": post_candidate.get("post_id") or "",
                            "media_url": candidate_item.get("url") or "",
                        })
                        sleep_with_optional_cancel(delay, cancel_checker)
                imagine_debug_event("candidate_post_recheck_found", {
                    "marker": "VIDEO_CANDIDATE_RECOVERY",
                    "request_id": request_id,
                    "action": action,
                    "elapsed_seconds": round(time.time() - progress_started_at, 3),
                    "post_id": post_candidate.get("post_id") or "",
                    "selected_item_id": candidate_item.get("item_id") or "",
                    "media_url": candidate_item.get("url") or "",
                })
                return candidate_item
        data = imagine_post_json(
            "/rest/media/post/list",
            {
                "limit": 40,
                "includeCanvas": False,
                "filter": {"source": "MEDIA_POST_SOURCE_LIKED", "safeForWork": False},
            },
            account,
            timeout=20,
        )
        posts = data.get("posts") if isinstance(data.get("posts"), list) else []
        for root_post in posts:
            if not isinstance(root_post, dict):
                continue
            for entry in collect_imagine_media_entries(root_post):
                if entry.get("type") != expected_type:
                    continue
                media_key = imagine_media_candidate_key(str(entry.get("url") or ""))
                entry_id = str(entry.get("item_id") or "")
                if entry_id in baseline_ids or media_key in baseline_ids:
                    continue
                if media_key in ignored_keys or entry_id in source_ids or media_key in source_ids:
                    continue
                related = {
                    entry_id,
                    str(entry.get("root_post_id") or ""),
                    str(entry.get("parent_post_id") or ""),
                    str(entry.get("original_post_id") or ""),
                    str(entry.get("source_item_id") or ""),
                }
                if strict_saved_candidate_ids and not (related & strict_saved_candidate_ids):
                    continue
                if parent_ids and not (related & parent_ids):
                    continue
                candidate = {
                    "url": entry.get("url") or "",
                    "type": expected_type,
                    "post_id": entry_id,
                    "root_post_id": entry.get("root_post_id") or "",
                    "parent_post_id": entry.get("parent_post_id") or "",
                    "original_post_id": entry.get("original_post_id") or "",
                    "original_ref_type": entry.get("original_ref_type") or "",
                    "thumbnail_url": entry.get("thumbnail_url") or "",
                    "created_at": entry.get("created_at") or "",
                    "prompt": entry.get("prompt") or prompt,
                    "model": entry.get("model") or "",
                    "resolution_name": entry.get("resolution_name") or "",
                    "video_duration": entry.get("video_duration") or "",
                }
                imagine_debug_event("saved_recheck_found", {
                    "request_id": request_id,
                    "action": action,
                    "elapsed_seconds": round(time.time() - progress_started_at, 3),
                    "entry_id": entry_id,
                    "media_key": media_key,
                    "candidate": candidate,
                })
                item = imagine_direct_item_from_candidate(candidate, expected_type, account, prompt, action, request_id, source_info)
                return item
    imagine_debug_event("saved_recheck_empty", {"request_id": request_id, "action": action})
    return None


def imagine_direct_reference_urls(attachments: list[dict], max_count: int) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    for attachment in attachments:
        raw_url = imagine_attachment_raw_url(attachment)
        if not raw_url:
            raise RuntimeError("Imagine direct attachments need an official Grok image URL.")
        key = imagine_media_candidate_key(raw_url)
        if key in seen:
            continue
        seen.add(key)
        refs.append(raw_url)
        if len(refs) >= max_count:
            break
    return refs


def imagine_direct_input_asset_ids(attachments: list[dict], max_count: int) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        candidates = [
            attachment.get("_imagine_file_attachment_id"),
            attachment.get("asset_id"),
            attachment.get("post_id"),
            attachment.get("item_id"),
            attachment.get("detail_item_id"),
            attachment.get("parent_post_id"),
            attachment.get("original_post_id"),
            attachment.get("upload_item_id"),
            extract_imagine_post_id_from_text(imagine_attachment_raw_url(attachment)),
        ]
        for value in candidates:
            text = str(value or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            ids.append(text)
            break
        if len(ids) >= max_count:
            break
    return ids


def imagine_attachment_real_post_id(attachment: dict, *keys: str) -> str:
    for key in keys:
        value = extract_imagine_post_id_from_text(attachment.get(key))
        if value:
            return value
    return ""


def compact_media_gen_input(value: dict) -> dict:
    if not isinstance(value, dict):
        return {}
    result: dict = {}
    for key, payload in value.items():
        if not isinstance(payload, dict):
            continue
        result[key] = {
            sub_key: (
                f"{len(sub_value)} items" if isinstance(sub_value, list)
                else sub_value
            )
            for sub_key, sub_value in payload.items()
        }
    return result


def imagine_i2i_request(payload: dict, prompt: str, request_id: str, account: dict) -> tuple[dict, dict, set[str], str, int]:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    image_attachments = media_attachments(payload, "image")
    if not image_attachments:
        raise RuntimeError("Imagine i2i needs one source image.")
    imagine_prepare_direct_image_attachments(image_attachments, account, request_id, "i2i")
    source = image_attachments[0]
    conversation_id, parent_response_id = imagine_source_conversation_context(payload, source, account)
    start_new_conversation = not bool(conversation_id)
    direct_upload = bool(source.get("_imagine_uploaded_direct") or imagine_attachment_upload_like(source))
    parent_post_id = "" if direct_upload else imagine_attachment_real_post_id(
        source,
        "post_id",
        "parent_post_id",
        "original_post_id",
        "detail_item_id",
    )
    root_post_id = imagine_attachment_real_post_id(source, "root_post_id", "detail_root_post_id") or parent_post_id
    if direct_upload:
        root_post_id = ""
    demoted_upload_references: list[dict] = []
    for index, attachment in enumerate(image_attachments[1:], start=1):
        if not imagine_attachment_upload_like(attachment):
            continue
        removed = imagine_demote_uploaded_reference_identity(attachment)
        if removed:
            demoted_upload_references.append({"index": index, "removed": removed})
    references = imagine_direct_reference_urls(image_attachments, 5)
    input_asset_ids = imagine_direct_input_asset_ids([source], 1) if direct_upload else (
        [parent_post_id] if parent_post_id else imagine_direct_input_asset_ids([source], 1)
    )
    if not input_asset_ids:
        raise RuntimeError("Image edit input asset ids could not be resolved.")
    try:
        count = int(str(options.get("count") or 1).strip())
    except (TypeError, ValueError):
        count = 1
    count = max(1, min(4, count))
    image_config = {"imageReferences": references}
    if parent_post_id:
        image_config["parentPostId"] = parent_post_id
    if root_post_id and not start_new_conversation:
        image_config["rootPostId"] = root_post_id
        image_config["containerPostId"] = root_post_id
    elif parent_post_id and not start_new_conversation:
        image_config["containerPostId"] = parent_post_id
    original_post_id = "" if direct_upload else imagine_attachment_real_post_id(source, "original_post_id")
    if original_post_id:
        image_config["originalPostId"] = original_post_id
    requested_aspect_ratio = normalize_aspect_ratio_value(options.get("aspect_ratio"))
    aspect_ratio = requested_aspect_ratio or (attachment_aspect_ratio(source) if direct_upload else "")
    if aspect_ratio:
        image_config["aspectRatio"] = aspect_ratio
    media_gen_image = {
        "prompt": prompt,
        "inputAssets": input_asset_ids,
        "numOfImages": count,
    }
    if aspect_ratio:
        media_gen_image["aspectRatio"] = aspect_ratio
    media_gen_input = {"imageToImage": media_gen_image}
    request = {
        "modelName": "imagine-image-edit",
        "temporary": True,
        "message": prompt,
        "mediaGenInput": media_gen_input,
        "sendFinalMetadata": True,
        "enableImageStreaming": True,
        "enableSideBySide": True,
        "responseMetadata": {
            "modelConfigOverride": {
                "modelMap": {
                    "imageEditModel": "imagine",
                    "imageEditModelConfig": image_config,
                }
            }
        },
    }
    if direct_upload:
        request["grokChameleonDirectUpload"] = True
        request["grokChameleonUploadAssetIds"] = input_asset_ids
        request["grokChameleonUploadUrls"] = references
    if start_new_conversation:
        request["grokChameleonStartNewConversation"] = True
    if conversation_id:
        request["grokChameleonConversationId"] = conversation_id
    if parent_response_id:
        request["grokChameleonParentResponseId"] = parent_response_id
    source_info = {
        "parent_post_id": parent_post_id,
        "root_post_id": root_post_id,
        "original_post_id": original_post_id,
        "source_item_id": "" if direct_upload else imagine_attachment_real_post_id(source, "item_id", "detail_item_id", "source_item_id"),
        "conversation_id": conversation_id,
        "parent_response_id": parent_response_id,
        "direct_upload": direct_upload,
        "start_new_conversation": start_new_conversation,
        "attachment_source_ids": sorted(set([*input_asset_ids, *references])) if direct_upload else sorted(
            imagine_attachment_candidate_source_ids(image_attachments)
        ),
    }
    ignored = set(references)
    referer = IMAGINE_BASE + "/imagine" if direct_upload and not conversation_id else imagine_detail_referer(parent_post_id, conversation_id)
    imagine_debug_event("i2i_request", {
        "request_id": request_id,
        "reference_count": len(references),
        "input_asset_count": len(input_asset_ids),
        "source_info": source_info,
        "image_config": image_config,
        "media_gen_input": compact_media_gen_input(media_gen_input),
        "referer": referer,
        "demoted_upload_references": demoted_upload_references,
    })
    return request, source_info, ignored, referer, IMAGINE_DIRECT_I2I_MAX_WAIT_SECONDS


def imagine_aspect_ratio_request(payload: dict, request_id: str, account: dict) -> tuple[dict, dict, set[str], str, int]:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    image_attachments = media_attachments(payload, "image")
    if not image_attachments:
        raise RuntimeError("Imagine Aspect Ratio needs one source image.")
    imagine_prepare_direct_image_attachments(image_attachments, account, request_id, "aspect")
    imagine_ensure_upload_image_posts(image_attachments[:1], account, request_id, "aspect")
    source = image_attachments[0]
    conversation_id, parent_response_id = imagine_source_conversation_context(payload, source, account)
    references = imagine_direct_reference_urls([source], 1)
    input_asset_ids = imagine_direct_input_asset_ids([source], 1)
    parent_post_id = imagine_attachment_real_post_id(source, "post_id", "parent_post_id", "original_post_id", "detail_item_id", "asset_id")
    if not parent_post_id and input_asset_ids:
        parent_post_id = input_asset_ids[0]
    if not parent_post_id:
        raise RuntimeError("Imagine source image post id is missing.")
    aspect_ratio = normalize_aspect_ratio_value(
        options.get("aspect_ratio")
        or options.get("target_aspect_ratio")
        or payload.get("aspect_ratio")
        or payload.get("target_aspect_ratio")
    )
    if not aspect_ratio:
        raise RuntimeError("Choose an aspect ratio.")
    request = {
        "temporary": True,
        "modelName": "imagine-image-edit",
        "message": " ",
        "enableImageGeneration": True,
        "returnImageBytes": False,
        "returnRawGrokInXaiRequest": False,
        "enableImageStreaming": True,
        "imageGenerationCount": 2,
        "forceConcise": False,
        "enableSideBySide": True,
        "sendFinalMetadata": True,
        "isReasoning": False,
        "disableTextFollowUps": True,
        "responseMetadata": {
            "modelConfigOverride": {
                "modelMap": {
                    "imageEditModelConfig": {
                        "imageReferences": references,
                        "aspectRatio": aspect_ratio,
                        "parentPostId": parent_post_id,
                    },
                    "imageEditModel": "imagine",
                }
            }
        },
        "disableMemory": False,
        "forceSideBySide": False,
    }
    if conversation_id:
        request["grokChameleonConversationId"] = conversation_id
    if parent_response_id:
        request["grokChameleonParentResponseId"] = parent_response_id
    root_post_id = imagine_attachment_real_post_id(source, "root_post_id", "detail_root_post_id") or parent_post_id
    source_info = {
        "parent_post_id": parent_post_id,
        "root_post_id": root_post_id,
        "original_post_id": imagine_attachment_real_post_id(source, "original_post_id") or parent_post_id,
        "source_item_id": imagine_attachment_real_post_id(source, "item_id", "detail_item_id", "source_item_id") or parent_post_id,
        "conversation_id": conversation_id,
        "parent_response_id": parent_response_id,
        "aspect_ratio": aspect_ratio,
        "attachment_source_ids": sorted(imagine_attachment_candidate_source_ids([source])),
    }
    ignored = set(references)
    referer = imagine_detail_referer(parent_post_id, conversation_id)
    imagine_debug_event("aspect_ratio_request", {
        "request_id": request_id,
        "aspect_ratio": aspect_ratio,
        "reference_count": len(references),
        "input_asset_count": len(input_asset_ids),
        "source_info": source_info,
        "referer": referer,
    })
    return request, source_info, ignored, referer, IMAGINE_DIRECT_IMAGE_MAX_WAIT_SECONDS


def imagine_video_request(payload: dict, prompt: str, request_id: str, action: str, account: dict | None = None) -> tuple[dict, dict, set[str], set[str], str, int]:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    image_attachments = media_attachments(payload, "image")
    video_attachment = first_attachment(payload, "video")
    if action == "extend":
        image_attachments = []
    if image_attachments:
        imagine_prepare_direct_image_attachments(image_attachments, account or {}, request_id, action)
    context_attachment = video_attachment if action == "extend" else (image_attachments[0] if image_attachments else None)
    conversation_id, parent_response_id = imagine_source_conversation_context(payload, context_attachment, account)
    direct_upload = bool(
        isinstance(context_attachment, dict)
        and (context_attachment.get("_imagine_uploaded_direct") or imagine_attachment_upload_like(context_attachment))
    )
    start_new_conversation = not bool(conversation_id)
    direct_upload_urls: list[str] = []
    demoted_upload_references: list[dict] = []
    if action != "extend" and image_attachments:
        for index, attachment in enumerate(image_attachments[1:], start=1):
            if not imagine_attachment_upload_like(attachment):
                continue
            removed = imagine_demote_uploaded_reference_identity(attachment)
            if removed:
                demoted_upload_references.append({"index": index, "removed": removed})
    duration = option_seconds(options.get("duration"), 10, 3, 15)
    resolution = clean_option(options.get("resolution"), "").lower()
    if resolution in {"480", "720", "1080"}:
        resolution = f"{resolution}p"
    if resolution not in VIDEO_RESOLUTIONS:
        resolution = "480p"
    aspect_ratio = str(options.get("aspect_ratio") or "").strip()
    source_info: dict = {}
    ignored: set[str] = set()
    parent_ids: set[str] = set()
    file_attachment_ids: list[str] = []
    model_config: dict = {
        "videoLength": duration,
        "isVideoEdit": False,
        "resolutionName": resolution,
    }
    if aspect_ratio:
        model_config["aspectRatio"] = aspect_ratio

    if action == "extend":
        if not video_attachment:
            raise RuntimeError("Imagine Extend needs one source video.")
        extend_post_id, source_detail = imagine_extend_video_source(video_attachment, account or {})
        if not extend_post_id:
            raise RuntimeError("Imagine source video post id is missing.")
        explicit_trim = str(options.get("source_trim_end") or "").strip()
        explicit_trim_value = option_float(explicit_trim, 0, 0, None) if explicit_trim else None
        user_adjusted_trim = bool(options.get("source_trim_user_adjusted"))
        if explicit_trim and (user_adjusted_trim or (explicit_trim_value is not None and explicit_trim_value > 0)):
            source_trim = explicit_trim_value or 0
        else:
            source_duration = imagine_attachment_video_duration(video_attachment, source_detail) or 6.0
            source_trim = source_duration + (1 / 24)
        original_post_id = extend_post_id
        original_ref_type = (
            str(source_detail.get("originalRefType") or "").strip()
            or imagine_attachment_id(video_attachment, "original_ref_type")
            or "ORIGINAL_REF_TYPE_VIDEO_EXTENSION"
        )
        source_root_post_id = (
            extract_imagine_post_id_from_text(source_detail.get("rootPostId"))
            or imagine_attachment_id(video_attachment, "root_post_id", "detail_root_post_id")
            or extend_post_id
        )
        model_config.update({
            "isVideoExtension": True,
            "videoExtensionStartTime": round(source_trim, 3),
            "extendPostId": extend_post_id,
            "stitchWithExtendPostId": True,
            "originalPrompt": prompt,
            "originalPostId": original_post_id,
            "originalRefType": original_ref_type,
            "mode": "custom",
            "parentPostId": extend_post_id,
        })
        if source_root_post_id and not start_new_conversation:
            model_config["rootPostId"] = source_root_post_id
        detail_width, detail_height = imagine_node_resolution(source_detail) if source_detail else (0, 0)
        video_aspect = attachment_aspect_ratio(video_attachment)
        if not video_aspect and detail_width > 0 and detail_height > 0:
            video_aspect = f"{detail_width}:{detail_height}"
        if not model_config.get("aspectRatio") and video_aspect:
            model_config["aspectRatio"] = video_aspect
        source_info = {
            "parent_post_id": extend_post_id,
            "root_post_id": source_root_post_id,
            "original_post_id": original_post_id,
            "original_ref_type": original_ref_type,
            "source_item_id": imagine_attachment_id(video_attachment, "item_id", "detail_item_id", "source_item_id"),
            "conversation_id": conversation_id,
            "parent_response_id": parent_response_id,
            "attachment_source_ids": sorted(imagine_attachment_candidate_source_ids([video_attachment, *image_attachments])),
        }
        parent_ids = {value for value in {extend_post_id, source_info["root_post_id"], source_info["original_post_id"]} if value}
        ignored.add(imagine_attachment_raw_url(video_attachment))
        input_asset_ids = [extend_post_id]
        for image_attachment in image_attachments:
            attachment_id = (
                extract_imagine_post_id_from_text(imagine_attachment_id(image_attachment, "post_id", "item_id", "detail_item_id", "upload_item_id", "asset_id"))
                or extract_imagine_post_id_from_text(imagine_attachment_raw_url(image_attachment))
            )
            if attachment_id and attachment_id not in file_attachment_ids:
                file_attachment_ids.append(attachment_id)
            raw_reference = imagine_attachment_raw_url(image_attachment)
            if raw_reference:
                ignored.add(raw_reference)
        referer = imagine_detail_referer(extend_post_id, conversation_id)
        media_gen_video = {
            "prompt": prompt,
            "inputAssets": input_asset_ids,
            "duration": duration,
            "videoExtensionStartTime": model_config["videoExtensionStartTime"],
        }
        media_gen_input = {"videoExtension": media_gen_video}
    else:
        references = imagine_direct_reference_urls(image_attachments, 7) if image_attachments else []
        direct_upload_urls = list(references)
        extra_references = imagine_direct_reference_urls(image_attachments[1:], 6) if len(image_attachments) > 1 else []
        input_asset_ids = imagine_direct_input_asset_ids(image_attachments[:1], 1) if image_attachments else []
        if references:
            source = image_attachments[0]
            parent_post_id = "" if direct_upload else imagine_attachment_real_post_id(
                source,
                "post_id",
                "parent_post_id",
                "original_post_id",
                "detail_item_id",
            )
            original_post_id = "" if direct_upload else imagine_attachment_real_post_id(source, "original_post_id")
            if not direct_upload:
                if not parent_post_id and input_asset_ids:
                    parent_post_id = input_asset_ids[0]
                if parent_post_id:
                    input_asset_ids = [parent_post_id]
                if not original_post_id:
                    original_post_id = parent_post_id
            root_post_id = "" if direct_upload else (
                imagine_attachment_real_post_id(source, "root_post_id", "detail_root_post_id") or parent_post_id
            )
            if not direct_upload and original_post_id and (not root_post_id or root_post_id == parent_post_id):
                root_post_id = original_post_id
            file_attachment_ids = [parent_post_id] if parent_post_id else []
            if parent_post_id:
                model_config["parentPostId"] = parent_post_id
            if root_post_id and not start_new_conversation:
                model_config["rootPostId"] = root_post_id
            if original_post_id:
                model_config["originalPostId"] = original_post_id
            source_aspect = attachment_aspect_ratio(source)
            if not model_config.get("aspectRatio") and source_aspect:
                model_config["aspectRatio"] = source_aspect
            if extra_references:
                model_config["imageReferences"] = extra_references
            if not input_asset_ids:
                raise RuntimeError("Video input asset ids could not be resolved.")
            source_info = {
                "parent_post_id": parent_post_id,
                "root_post_id": root_post_id,
                "original_post_id": original_post_id,
                "source_item_id": "" if direct_upload else (
                    imagine_attachment_real_post_id(source, "item_id", "detail_item_id", "source_item_id") or parent_post_id
                ),
                "conversation_id": conversation_id,
                "parent_response_id": parent_response_id,
                "direct_upload": direct_upload,
                "attachment_source_ids": sorted(set([*input_asset_ids, *references])) if direct_upload else sorted(
                    imagine_attachment_candidate_source_ids(image_attachments)
                ),
            }
            parent_id_candidates = {parent_post_id, source_info["source_item_id"]}
            if not any(parent_id_candidates) or parent_post_id == root_post_id:
                parent_id_candidates.update({root_post_id, source_info["original_post_id"]})
            parent_ids = {value for value in parent_id_candidates if value}
            ignored.update(references)
            referer = IMAGINE_BASE + "/imagine" if direct_upload and not conversation_id else imagine_detail_referer(parent_post_id, conversation_id)
            media_gen_video = {
                "prompt": prompt,
                "inputAssets": input_asset_ids,
                "duration": duration,
                "resolutionName": resolution,
            }
            if model_config.get("aspectRatio"):
                media_gen_video["aspectRatio"] = model_config["aspectRatio"]
            media_gen_video["mode"] = "custom"
            media_gen_input = {"imageToVideo": media_gen_video}
        else:
            referer = IMAGINE_BASE + "/imagine/saved"
            media_gen_video = {
                "prompt": prompt,
                "duration": duration,
                "resolutionName": resolution,
            }
            if model_config.get("aspectRatio"):
                media_gen_video["aspectRatio"] = model_config["aspectRatio"]
            media_gen_input = {"textToVideo": media_gen_video}

    direct_prompt = prompt.strip()
    if "--mode=custom" not in direct_prompt:
        direct_prompt = f"{direct_prompt} --mode=custom".strip()
    request = {
        "temporary": True,
        "modelName": "imagine-video-gen",
        "message": direct_prompt,
        "mediaGenInput": media_gen_input,
        "sendFinalMetadata": True,
        "enableSideBySide": True,
        "responseMetadata": {
            "experiments": [],
            "modelConfigOverride": {
                "modelMap": {
                    "videoGenModelConfig": model_config,
                }
            },
        },
    }
    if file_attachment_ids:
        request["fileAttachments"] = file_attachment_ids
    if direct_upload:
        request["grokChameleonDirectUpload"] = True
        request["grokChameleonUploadAssetIds"] = input_asset_ids
        request["grokChameleonUploadUrls"] = direct_upload_urls
    if start_new_conversation:
        request["grokChameleonStartNewConversation"] = True
    if conversation_id:
        request["grokChameleonConversationId"] = conversation_id
    if parent_response_id:
        request["grokChameleonParentResponseId"] = parent_response_id
    source_info["start_new_conversation"] = start_new_conversation
    imagine_debug_event("video_request", {
        "request_id": request_id,
        "action": action,
        "image_attachment_count": len(image_attachments),
        "has_video_attachment": bool(video_attachment),
        "model_config": model_config,
        "media_gen_input": compact_media_gen_input(media_gen_input),
        "file_attachment_ids": file_attachment_ids,
        "source_info": source_info,
        "parent_ids": sorted(parent_ids),
        "ignored_count": len([value for value in ignored if value]),
        "referer": referer,
        "demoted_upload_references": demoted_upload_references,
        "prompt_len": len(prompt),
        "direct_prompt_len": len(direct_prompt),
        "request_keys": sorted(request.keys()),
    })
    wait_policy = imagine_i2v_wait_policy(payload, action)
    max_wait = int(wait_policy["official_wait_seconds"])
    return request, source_info, ignored, parent_ids, referer, max_wait


def imagine_direct_video_terminal_recheck_seconds(action: str) -> int:
    return IMAGINE_DIRECT_EXTEND_TERMINAL_RECHECK_SECONDS if action == "extend" else IMAGINE_DIRECT_VIDEO_TERMINAL_RECHECK_SECONDS


def imagine_direct_video_display_seconds(action: str) -> int:
    if action == "extend":
        return IMAGINE_DIRECT_EXTEND_DISPLAY_SECONDS
    if action == "i2v":
        return IMAGINE_DIRECT_I2V_DISPLAY_SECONDS
    return IMAGINE_DIRECT_VIDEO_DISPLAY_SECONDS


def imagine_direct_video_display_max_progress(action: str) -> int:
    if action == "extend":
        return IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS
    if action == "i2v":
        return IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS
    return IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS


def imagine_direct_video_candidate_deadline(
    action: str,
    started_at: float,
    default_deadline: float,
    post_candidates: list[dict] | None,
    absolute_deadline: float | None = None,
    candidate_grace_seconds: int = IMAGINE_DIRECT_VIDEO_CANDIDATE_MAX_WAIT_SECONDS,
) -> float:
    return min(
        absolute_deadline or default_deadline,
        time.time() + max(1, int(candidate_grace_seconds)),
    )


def imagine_direct_post_from_item(item: dict, prompt: str, account: dict, action: str) -> dict:
    return imagine_direct_post_from_items([item], prompt, account, action)


def imagine_direct_post_from_items(items: list[dict], prompt: str, account: dict, action: str) -> dict:
    kept_items = [item for item in items if isinstance(item, dict)]
    if not kept_items:
        raise RuntimeError("Imagine response did not contain generated media.")
    liked = action != "t2i"
    if liked:
        for item in kept_items:
            imagine_mark_result_item_liked(item, True)
    video_items = [item for item in kept_items if item.get("type") == "video"]
    representative_item = video_items[-1] if video_items else kept_items[-1]
    conversation_id = str(representative_item.get("conversation_id") or "").strip()
    response_id = str(representative_item.get("response_id") or "").strip()
    root_seed = conversation_id or representative_item.get("root_post_id") or representative_item.get("item_id") or uuid.uuid4().hex
    post_id = str(root_seed or uuid.uuid4().hex)
    representative = representative_item.get("url") or representative_item.get("item_id") or ""
    folder_namespace = "imagine_saved" if liked else "imagine_generated"
    return {
        "post_id": post_id,
        "source": "imagine",
        "mode": action,
        "area": "imagine_remote",
        "remote": True,
        "liked": liked,
        "favorite": liked,
        "title": title_from_prompt(prompt, "Imagine"),
        "prompt": prompt,
        "created_at": representative_item.get("created_at") or now_iso(),
        "folder_path": f"{folder_namespace}/{post_id}",
        "folderName": title_from_prompt(prompt, "Imagine"),
        "representative": representative,
        "representative_item": representative_item,
        "items": kept_items,
        "lucky": any(media_item_is_lucky(item) for item in kept_items),
        "account_id": account.get("id") or "",
        "account_email": account.get("email") or "",
        "metadata": {
            "imagine_root_post_id": post_id,
            "conversation_id": conversation_id,
            "response_id": response_id,
            "generated_action": action,
            "liked": liked,
        },
    }


def imagine_source_path_matches_source_info(source_post_path: str, source_info: dict, item: dict | None = None) -> bool:
    source_path = str(source_post_path or "").strip().strip("/")
    if not source_path:
        return False
    path_id = extract_imagine_post_id_from_text(source_path.split("/")[-1])
    if not path_id:
        return True
    ids: set[str] = set()
    for node in (source_info if isinstance(source_info, dict) else {}, item if isinstance(item, dict) else {}):
        for key in ("parent_post_id", "root_post_id", "original_post_id", "source_item_id", "item_id"):
            value = extract_imagine_post_id_from_text((node or {}).get(key))
            if value:
                ids.add(value)
    return path_id in ids


def imagine_apply_aspect_ratio_to_items(items: list[dict], source_info: dict) -> None:
    aspect_ratio = str((source_info or {}).get("aspect_ratio") or "").strip()
    if not aspect_ratio:
        return
    for generated_item in items:
        if not isinstance(generated_item, dict):
            continue
        generated_item["aspect_ratio"] = aspect_ratio
        generated_item["aspectRatio"] = aspect_ratio
        metadata = generated_item.setdefault("metadata", {})
        if isinstance(metadata, dict):
            metadata["aspect_ratio"] = aspect_ratio
            imagine_meta = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
            imagine_meta["aspect_ratio"] = aspect_ratio
            metadata["imagine"] = imagine_meta


def imagine_direct_rest_image_generate(
    payload: dict,
    account: dict,
    prompt: str,
    action: str,
    request_id: str,
    job_started_at: float,
    progress_callback=None,
    cancel_checker=None,
) -> dict:
    if action != "aspect":
        raise RuntimeError("This Imagine image action is not connected here.")
    request_payload, source_info, ignored_urls, referer, max_wait = imagine_aspect_ratio_request(payload, request_id, account)
    parent_ids = {value for value in {
        source_info.get("parent_post_id"),
        source_info.get("root_post_id"),
        source_info.get("original_post_id"),
        source_info.get("source_item_id"),
    } if value}
    baseline_ids = set()
    try:
        baseline_ids = imagine_saved_candidate_ids(account, "image", parent_ids, ignored_urls)
        imagine_debug_event("direct_rest_image_baseline_ids", {
            "request_id": request_id,
            "action": action,
            "count": len(baseline_ids),
            "parent_ids": sorted(parent_ids),
        })
    except Exception as exc:
        imagine_debug_event("direct_rest_image_baseline_failed", {
            "request_id": request_id,
            "action": action,
            "error": str(exc)[:500],
        })

    events = imagine_direct_stream(
        request_payload,
        account,
        request_id,
        referer,
        max_wait,
        first_signal_seconds=IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS,
        progress_callback=progress_callback,
        cancel_checker=cancel_checker,
    )
    result_events = imagine_filter_source_only_events(events, "image", source_info, ignored_urls, request_id, action)
    max_progress = max([imagine_event_numeric_progress(event) or 0 for event in result_events] or [0])
    post_candidates = imagine_event_image_post_candidates(result_events)
    if post_candidates:
        imagine_debug_event("direct_rest_image_post_candidates", {
            "request_id": request_id,
            "action": action,
            "post_ids": [candidate.get("post_id") or "" for candidate in post_candidates],
        })

    direct_items = imagine_direct_items_from_events(result_events, "image", account, prompt, action, request_id, source_info, ignored_urls)
    direct_items = [item for item in direct_items if not imagine_item_uses_data_url(item)]
    imagine_apply_aspect_ratio_to_items(direct_items, source_info)
    item = direct_items[-1] if direct_items else None

    if not item:
        usage_limit_message = imagine_usage_limit_message_from_events(events)
        if usage_limit_message:
            imagine_debug_event("direct_rest_image_usage_limit", {
                "request_id": request_id,
                "action": action,
                "last_events": imagine_debug_event_tail(events),
            })
            raise RuntimeError(usage_limit_message)
        recheck_deadline = job_started_at + max_wait
        item = imagine_wait_for_saved_direct_result(
            account,
            "image",
            prompt,
            action,
            request_id,
            source_info,
            parent_ids,
            ignored_urls,
            baseline_ids,
            remaining_seconds_until(recheck_deadline, max_wait),
            1,
            post_candidates=post_candidates,
            deadline=recheck_deadline,
            progress_started_at=job_started_at,
            progress_start=display_generation_progress(max_progress, fallback=6),
            progress_callback=progress_callback,
            cancel_checker=cancel_checker,
        )
        direct_items = [item] if item else []
        imagine_apply_aspect_ratio_to_items(direct_items, source_info)

    if not item:
        if any(imagine_event_is_moderated(event) for event in events):
            raise RuntimeError("Imagine moderated the request.")
        imagine_debug_event("direct_rest_image_no_media_failed", {
            "request_id": request_id,
            "action": action,
            "max_progress": max_progress,
            "post_candidate_count": len(post_candidates),
            "last_events": imagine_debug_event_tail(events),
        })
        raise RuntimeError("Imagine did not return a final image.")

    source_post_path = str(payload.get("source_post_path") or "")
    target_folder_path = source_post_path if (
        source_post_path
        and imagine_source_path_matches_source_info(source_post_path, source_info, item)
    ) else ""
    result = {
        "action": action,
        "item": item,
        "items": direct_items,
        "source_post_path": source_post_path,
        "target_folder_path": target_folder_path,
        "selected_item_id": item.get("item_id") or "",
        "request_id": request_id,
        "lucky": False,
    }
    if not result["target_folder_path"]:
        result["post"] = imagine_direct_post_from_item(item, prompt, account, action)
        result["target_folder_path"] = result["post"]["folder_path"]
    imagine_debug_event("direct_rest_image_generate_result", {
        "request_id": request_id,
        "action": action,
        "selected_item_id": result.get("selected_item_id") or "",
        "target_folder_path": result.get("target_folder_path") or "",
        "item_count": len(direct_items),
    })
    return result


def imagine_native_bridge_generate(
    payload: dict,
    account: dict,
    prompt: str,
    action: str,
    request_id: str,
    job_started_at: float,
    progress_callback=None,
    cancel_checker=None,
) -> dict:
    if action == "i2i":
        request_payload, source_info, ignored_urls, referer, max_wait = imagine_i2i_request(payload, prompt, request_id, account)
        expected_type = "image"
        parent_ids = {value for value in {
            source_info.get("parent_post_id"),
            source_info.get("root_post_id"),
            source_info.get("original_post_id"),
            source_info.get("source_item_id"),
        } if value}
    elif action == "aspect":
        request_payload, source_info, ignored_urls, referer, max_wait = imagine_aspect_ratio_request(payload, request_id, account)
        expected_type = "image"
        parent_ids = {value for value in {
            source_info.get("parent_post_id"),
            source_info.get("root_post_id"),
            source_info.get("original_post_id"),
            source_info.get("source_item_id"),
        } if value}
    else:
        request_payload, source_info, ignored_urls, parent_ids, referer, max_wait = imagine_video_request(payload, prompt, request_id, action, account)
        expected_type = "video"

    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    video_deadline = job_started_at + max_wait if expected_type == "video" else None
    video_wait_policy = imagine_i2v_wait_policy(payload, action) if expected_type == "video" else {}
    long_i2v_wait = video_wait_policy.get("tier") == "long"
    video_recovery_seconds = int(video_wait_policy.get("recovery_seconds") or 0)
    video_absolute_deadline = (
        video_deadline + video_recovery_seconds
        if video_deadline
        else None
    )
    source_post_path = str(payload.get("source_post_path") or "")
    baseline_ids = imagine_generated_relation_baseline_ids(root, source_post_path, expected_type)
    relation_baseline_count = len(baseline_ids)
    try:
        baseline_ids.update(imagine_saved_candidate_ids(account, expected_type, parent_ids, ignored_urls))
        imagine_debug_event("native_bridge_baseline_ids", {
            "request_id": request_id,
            "action": action,
            "count": len(baseline_ids),
            "relation_count": relation_baseline_count,
            "parent_ids": sorted(parent_ids),
        })
    except Exception as exc:
        imagine_debug_event("native_bridge_baseline_failed", {"request_id": request_id, "action": action, "error": str(exc)[:500]})

    stream_wait = remaining_seconds_until(video_deadline, max_wait) if expected_type == "video" else max_wait
    events, bridge_parent_ids, bridge_baseline_ids, canonical_container_id = native_bridge_fetch_events(
        root,
        account,
        request_payload,
        request_id,
        referer,
        stream_wait,
        progress_callback=progress_callback,
        cancel_checker=cancel_checker,
    )
    relation_recovery_action = action in {"i2i", "i2v", "t2v", "extend"}
    if relation_recovery_action and bridge_parent_ids:
        parent_ids.update(bridge_parent_ids)
    if relation_recovery_action and bridge_baseline_ids:
        baseline_ids.update(bridge_baseline_ids)
    if canonical_container_id:
        parent_ids.add(canonical_container_id)
        source_info["generation_root_post_id"] = canonical_container_id
        if source_info.get("direct_upload") or source_info.get("start_new_conversation"):
            source_info["root_post_id"] = canonical_container_id
            source_info["conversation_id"] = canonical_container_id
    if relation_recovery_action and (bridge_parent_ids or bridge_baseline_ids or canonical_container_id):
        imagine_debug_event("native_bridge_relation_ids", {
            "request_id": request_id,
            "action": action,
            "parent_ids": sorted(parent_ids),
            "bridge_parent_ids": sorted(bridge_parent_ids),
            "bridge_baseline_count": len(bridge_baseline_ids),
            "baseline_count": len(baseline_ids),
            "canonical_container_id": canonical_container_id,
        })
    result_events = imagine_filter_source_only_events(events, expected_type, source_info, ignored_urls, request_id, action)
    max_progress = max([imagine_event_numeric_progress(event) or 0 for event in result_events] or [0])
    lucky_reason = imagine_lucky_reason_from_events(result_events) if expected_type == "video" else ""
    post_candidates = imagine_event_video_post_candidates(result_events) if expected_type == "video" else imagine_event_image_post_candidates(result_events)
    if expected_type == "video" and any(imagine_event_is_moderated(event) for event in events):
        imagine_debug_event("video_moderation_provisional", {
            "request_id": request_id,
            "action": action,
            "post_candidate_count": len(post_candidates),
            "long_i2v_wait": long_i2v_wait,
        })
    if post_candidates:
        imagine_debug_event("native_bridge_post_candidates", {
            "request_id": request_id,
            "action": action,
            "expected_type": expected_type,
            "post_ids": [candidate.get("post_id") or "" for candidate in post_candidates],
        })

    direct_items = imagine_direct_items_from_events(result_events, expected_type, account, prompt, action, request_id, source_info, ignored_urls)
    if action == "aspect":
        direct_items = [item for item in direct_items if not imagine_item_uses_data_url(item)]
        imagine_apply_aspect_ratio_to_items(direct_items, source_info)
    item = direct_items[-1] if direct_items else None
    data_url_fallback_item = None
    if expected_type == "image" and imagine_item_uses_data_url(item):
        data_url_fallback_item = item
        imagine_debug_event("image_data_url_candidate", {
            "request_id": request_id,
            "action": action,
            "item_id": item.get("item_id") or "",
        })
        item = None
        direct_items = []

    if not item and expected_type == "image" and data_url_fallback_item:
        imagine_debug_event("image_data_url_discarded", {
            "request_id": request_id,
            "action": action,
            "item_id": data_url_fallback_item.get("item_id") or "",
            "reason": "temporary data url without final media",
        })

    if not item:
        usage_limit_message = imagine_usage_limit_message_from_events(events)
        if usage_limit_message:
            imagine_debug_event("native_bridge_usage_limit", {
                "request_id": request_id,
                "action": action,
                "expected_type": expected_type,
                "last_events": imagine_debug_event_tail(events),
            })
            raise RuntimeError(usage_limit_message)

    if not item and expected_type == "image" and (post_candidates or action in {"i2i", "aspect"}):
        candidate_recheck_seconds = 15 if action in {"i2i", "aspect"} else max_wait
        recheck_deadline = time.time() + candidate_recheck_seconds
        item = imagine_wait_for_saved_direct_result(
            account,
            expected_type,
            prompt,
            action,
            request_id,
            source_info,
            parent_ids,
            ignored_urls,
            baseline_ids,
            remaining_seconds_until(recheck_deadline, candidate_recheck_seconds),
            1,
            post_candidates=post_candidates,
            deadline=recheck_deadline,
            progress_started_at=job_started_at,
            progress_start=display_generation_progress(max_progress, fallback=6),
            progress_callback=progress_callback,
            cancel_checker=cancel_checker,
            candidate_initial_delay_seconds=1 if action in {"i2i", "aspect"} else 0,
            candidate_stabilize_seconds=1 if action in {"i2i", "aspect"} else 0,
        )
        direct_items = [item] if item else []
        if action == "aspect":
            imagine_apply_aspect_ratio_to_items(direct_items, source_info)

    if not item and expected_type == "video":
        candidate_recovery_grace_seconds = video_recovery_seconds
        candidate_absolute_deadline = (
            max(video_absolute_deadline or 0, time.time() + candidate_recovery_grace_seconds)
            if candidate_recovery_grace_seconds
            else video_absolute_deadline
        )
        recheck_deadline = imagine_direct_video_candidate_deadline(
            action,
            job_started_at,
            video_deadline,
            post_candidates,
            absolute_deadline=candidate_absolute_deadline,
            candidate_grace_seconds=candidate_recovery_grace_seconds,
        )
        video_display_seconds = int(video_wait_policy.get("display_seconds") or imagine_direct_video_display_seconds(action))
        video_progress_start = 1 if video_display_seconds else display_generation_progress(max_progress, fallback=6)
        video_progress_end = imagine_direct_video_display_max_progress(action) if video_display_seconds else 98
        video_progress_deadline = job_started_at + video_display_seconds if video_display_seconds else None
        item = imagine_wait_for_saved_direct_result(
            account,
            expected_type,
            prompt,
            action,
            request_id,
            source_info,
            parent_ids,
            ignored_urls,
            baseline_ids,
            remaining_seconds_until(recheck_deadline, imagine_direct_video_terminal_recheck_seconds(action)),
            IMAGINE_DIRECT_VIDEO_TERMINAL_POLL_SECONDS,
            post_candidates=post_candidates,
            deadline=recheck_deadline,
            progress_started_at=job_started_at,
            progress_deadline=video_progress_deadline,
            progress_start=video_progress_start,
            progress_end=video_progress_end,
            progress_callback=progress_callback,
            cancel_checker=cancel_checker,
            post_candidates_stabilized=False,
            candidate_recovery_stabilize_seconds=int(
                video_wait_policy.get("candidate_stabilize_seconds")
                or IMAGINE_DIRECT_VIDEO_CANDIDATE_STABILIZE_SECONDS
            ),
        )
        direct_items = [item] if item else []

    if not item:
        if data_url_fallback_item:
            imagine_debug_event("native_bridge_no_final_media_failed", {
                "request_id": request_id,
                "action": action,
                "reason": "temporary data url did not resolve to final media",
            })
            raise RuntimeError("Imagine did not return a final image.")
        if any(imagine_event_is_moderated(event) for event in events):
            raise RuntimeError("Imagine moderated the request.")
        if expected_type == "video":
            imagine_debug_event("native_bridge_no_media_timeout", {
                "request_id": request_id,
                "action": action,
                "expected_type": expected_type,
                "max_progress": max_progress,
                "post_candidate_count": len(post_candidates),
            })
            raise RuntimeError("Imagine video is still pending after recovery timeout.")
        imagine_debug_event("native_bridge_no_media_failed", {
            "request_id": request_id,
            "action": action,
            "expected_type": expected_type,
            "max_progress": max_progress,
            "post_candidate_count": len(post_candidates),
        })
        raise RuntimeError("Imagine did not return a final image.")

    skip_generated_like = bool(source_post_path and action in {"i2i", "i2v", "extend"})
    if skip_generated_like:
        imagine_debug_event("generated_result_like_skipped", {
            "request_id": request_id,
            "action": action,
            "reason": "source post already owns generated item",
            "source_post_path": source_post_path,
        })
    else:
        imagine_like_generated_result_posts(direct_items or [item], account, request_id, action)

    if lucky_reason:
        mark_lucky_media_item(item, lucky_reason)
        for generated_item in direct_items:
            if media_item_key(generated_item) == media_item_key(item):
                mark_lucky_media_item(generated_item, lucky_reason)

    attach_to_source_actions = {"i2i", "i2v", "extend", "video_edit", "aspect"}
    attach_to_existing_source = bool(
        source_post_path
        and not source_info.get("start_new_conversation")
        and (action in attach_to_source_actions or imagine_source_path_matches_source_info(source_post_path, source_info, item))
    )
    target_folder_path = source_post_path if (
        attach_to_existing_source
    ) else ""
    result = {
        "action": action,
        "item": item,
        "items": direct_items,
        "source_post_path": source_post_path,
        "target_folder_path": target_folder_path,
        "selected_item_id": item.get("item_id") or "",
        "request_id": request_id,
        "lucky": media_item_is_lucky(item),
    }
    if not result["target_folder_path"]:
        result["post"] = imagine_direct_post_from_item(item, prompt, account, action)
        result["target_folder_path"] = result["post"]["folder_path"]
    if attach_to_existing_source and action in attach_to_source_actions:
        root = library_root()
        if root:
            imagine_persist_generated_relation(
                root,
                source_post_path,
                str(payload.get("source_item_id") or source_info.get("source_item_id") or ""),
                direct_items or [item],
                action,
                request_id,
            )
    imagine_debug_event("native_bridge_generate_result", {
        "request_id": request_id,
        "action": action,
        "selected_item_id": result.get("selected_item_id") or "",
        "target_folder_path": result.get("target_folder_path") or "",
        "item_count": len(direct_items),
    })
    return result


def imagine_direct_generate(payload: dict, progress_callback=None, cancel_checker=None) -> dict:
    job_started_at = time.time()
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        raise RuntimeError("Select or capture an Imagine account first.")
    prompt = str(payload.get("prompt") or "").strip()
    action = imagine_direct_action(payload)
    if action not in {"upscale", "aspect"} and not prompt:
        raise RuntimeError("Prompt is empty.")
    if action == "upscale":
        return upscale_imagine_video_post(payload, progress_callback=progress_callback, cancel_checker=cancel_checker)
    if action == "video_edit":
        raise RuntimeError("Imagine Video Edit is not connected yet.")
    if action not in {"t2i", "i2i", "t2v", "i2v", "extend", "aspect"}:
        raise RuntimeError("This Imagine mode is not connected yet.")
    request_id = uuid.uuid4().hex
    imagine_debug_event("direct_generate_start", {
        "request_id": request_id,
        "action": action,
        "mode": payload.get("mode") or "",
        "prompt_len": len(prompt),
        "options": payload.get("options") if isinstance(payload.get("options"), dict) else {},
        "attachments": imagine_debug_attachment_summary(payload),
        "source_post_path": payload.get("source_post_path") or "",
        "source_item_id": payload.get("source_item_id") or "",
        "source_conversation_id": payload.get("source_conversation_id") or "",
        "parent_response_id": payload.get("parent_response_id") or "",
        "account_id": account.get("id") or "",
        "account_tier": account.get("tier") or "",
    })
    if progress_callback:
        progress_callback(1, "running", {"action": action, "request_id": request_id})
    if action == "t2i":
        items = imagine_t2i_direct_items(
            payload,
            account,
            prompt,
            request_id,
            progress_callback=progress_callback,
            cancel_checker=cancel_checker,
        )
        item = items[-1]
        posts = [imagine_direct_post_from_items([single_item], prompt, account, action) for single_item in items]
        post = posts[-1]
        imagine_debug_event("direct_t2i_result", {
            "request_id": request_id,
            "item_count": len(items),
            "post_count": len(posts),
            "selected_item_id": item.get("item_id") or "",
            "target_folder_path": post.get("folder_path") or "",
        })
        return {
            "action": action,
            "item": item,
            "items": items,
            "post": post,
            "posts": posts,
            "source_post_path": "",
            "target_folder_path": post["folder_path"],
            "selected_item_id": item.get("item_id") or "",
            "request_id": request_id,
        }
    return imagine_native_bridge_generate(
        payload,
        account,
        prompt,
        action,
        request_id,
        job_started_at,
        progress_callback=progress_callback,
        cancel_checker=cancel_checker,
    )


def imagine_job_snapshot(job: dict) -> dict:
    allowed = {
        "id",
        "kind",
        "status",
        "progress",
        "prompt",
        "error",
        "result",
        "partial_result",
        "context",
        "created_at",
        "updated_at",
    }
    return {key: value for key, value in job.items() if key in allowed}


def update_imagine_job(job_id: str, **updates) -> dict | None:
    with IMAGINE_JOB_LOCK:
        job = IMAGINE_JOBS.get(job_id)
        if not job:
            return None
        context = updates.pop("context", None)
        if isinstance(context, dict):
            current_context = job.get("context") if isinstance(job.get("context"), dict) else {}
            current_context.update({key: value for key, value in context.items() if value not in (None, "")})
            job["context"] = current_context
        if "progress" in updates:
            updates["progress"] = monotonic_job_progress(job.get("progress"), updates.get("progress"), str(updates.get("status") or job.get("status") or "running"))
        for key, value in updates.items():
            job[key] = value
        job["updated_at"] = now_iso()
        return imagine_job_snapshot(job)


def imagine_job_cancelled(job_id: str) -> bool:
    with IMAGINE_JOB_LOCK:
        job = IMAGINE_JOBS.get(job_id)
        return bool(job and job.get("cancel_requested"))


def classify_imagine_job_error(message: str) -> str:
    text = str(message or "").lower()
    if any(token in text for token in (
        "moderated",
        "moderation",
        "content_policy_violation",
        "policy_violation",
        "rejected by content moderation",
        "did not contain generated media",
        "http 403",
        "forbidden",
        "검열",
    )):
        return "moderated"
    return "failed"


def start_imagine_job(payload: dict) -> dict:
    job_id = uuid.uuid4().hex[:16]
    now = now_iso()
    action = imagine_direct_action(payload)
    video_wait_policy = imagine_i2v_wait_policy(payload, action)
    job = {
        "id": job_id,
        "kind": imagine_direct_job_kind(payload),
        "status": "queued",
        "progress": 1,
        "prompt": str(payload.get("prompt") or "").strip(),
        "error": "",
        "result": None,
        "partial_result": None,
        "context": imagine_direct_job_context(payload),
        "created_at": now,
        "updated_at": now,
        "cancel_requested": False,
    }
    with IMAGINE_JOB_LOCK:
        IMAGINE_JOBS[job_id] = job
    imagine_debug_event("job_queued", {
        "job_id": job_id,
        "action": action,
        "mode": payload.get("mode") or "",
        "provider": payload.get("provider") or "",
        "prompt_len": len(str(payload.get("prompt") or "")),
        "options": payload.get("options") if isinstance(payload.get("options"), dict) else {},
        "source_post_path": payload.get("source_post_path") or "",
        "source_item_id": payload.get("source_item_id") or "",
        "preview_type": payload.get("preview_type") or "",
        "preview_url": imagine_debug_compact_url(payload.get("preview_url")),
        "attachments": imagine_debug_attachment_summary(payload),
    })

    def progress(progress_value: int, status: str = "running", data: dict | None = None) -> None:
        status_text = status or "running"
        next_progress = progress_value
        if status_text == "running":
            numeric_progress = numeric_percentage(progress_value)
            running_progress_limit = {
                "t2i": IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS,
                "i2i": IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS,
                "i2v": IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS,
                "t2v": IMAGINE_DIRECT_VIDEO_DISPLAY_MAX_PROGRESS,
                "extend": IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS,
            }.get(action, 98)
            if numeric_progress is not None:
                next_progress = min(numeric_progress, running_progress_limit)
        context = {}
        if isinstance(data, dict):
            if data.get("action"):
                context["mode"] = data.get("action")
            if data.get("request_id"):
                context["request_id"] = data.get("request_id")
            for key in ("candidate_count", "completed_count", "expected_count", "receive_limit"):
                if key in data:
                    context[key] = data.get(key)
        partial_result = data.get("partial_result") if isinstance(data, dict) and isinstance(data.get("partial_result"), dict) else None
        snapshot = update_imagine_job(
            job_id,
            status=status_text,
            progress=next_progress,
            context=context,
            **({"partial_result": partial_result} if partial_result is not None else {}),
        )
        progress_int = int((snapshot or {}).get("progress") or 0)
        if progress_int in {1, 6, 12, 90, 100} or progress_int % 25 == 0:
            imagine_debug_event("job_progress", {
                "job_id": job_id,
                "status": status or "running",
                "progress": progress_int,
                "context": context,
            })

    def start_display_progress(display_action: str, display_seconds: int, display_max_progress: int) -> threading.Event:
        stop_event = threading.Event()
        started_at = time.time()
        deadline = started_at + display_seconds

        def run() -> None:
            last_progress = 0
            while not stop_event.is_set():
                with IMAGINE_JOB_LOCK:
                    current = IMAGINE_JOBS.get(job_id)
                    status_text = str((current or {}).get("status") or "")
                if status_text in {"done", "failed", "moderated", "cancelled"}:
                    break
                display_progress = elapsed_display_progress(
                    started_at,
                    deadline,
                    1,
                    display_max_progress,
                )
                if display_progress != last_progress:
                    progress(display_progress, "running", {"action": display_action, "progress_source": "display_timer"})
                    last_progress = display_progress
                if time.time() >= deadline:
                    break
                stop_event.wait(0.2)

        threading.Thread(target=run, name=f"imagine-{display_action}-display-progress-{job_id}", daemon=True).start()
        return stop_event

    def worker() -> None:
        update_imagine_job(job_id, status="running", progress=1)
        imagine_debug_event("job_worker_start", {"job_id": job_id, "action": action})
        display_stop = None
        if action == "t2i":
            display_stop = start_display_progress("t2i", IMAGINE_DIRECT_T2I_DISPLAY_SECONDS, IMAGINE_DIRECT_T2I_DISPLAY_MAX_PROGRESS)
        elif action == "i2i":
            display_stop = start_display_progress("i2i", IMAGINE_DIRECT_I2I_DISPLAY_SECONDS, IMAGINE_DIRECT_I2I_DISPLAY_MAX_PROGRESS)
        elif action in {"i2v", "t2v"}:
            display_stop = start_display_progress(
                action,
                int(video_wait_policy["display_seconds"]),
                IMAGINE_DIRECT_I2V_DISPLAY_MAX_PROGRESS,
            )
        elif action == "extend":
            display_stop = start_display_progress(
                "extend",
                int(video_wait_policy["display_seconds"]),
                IMAGINE_DIRECT_EXTEND_DISPLAY_MAX_PROGRESS,
            )
        try:
            result = imagine_direct_generate(payload, progress_callback=progress, cancel_checker=lambda: imagine_job_cancelled(job_id))
            update_imagine_job(job_id, status="done", progress=100, result=result)
            imagine_debug_event("job_done", {
                "job_id": job_id,
                "action": action,
                "request_id": result.get("request_id") if isinstance(result, dict) else "",
                "selected_item_id": result.get("selected_item_id") if isinstance(result, dict) else "",
                "target_folder_path": result.get("target_folder_path") if isinstance(result, dict) else "",
            })
        except JobCancelled:
            update_imagine_job(job_id, status="cancelled", progress=0, error="Job cancelled.")
            imagine_debug_event("job_cancelled", {"job_id": job_id, "action": action})
        except Exception as exc:
            message = str(exc) or "Imagine request failed."
            status = classify_imagine_job_error(message)
            update_imagine_job(job_id, status=status, progress=max(1, int(job.get("progress") or 1)), error=message)
            log_event(f"imagine_job_failed id={job_id} status={status} detail={message}")
            imagine_debug_event("job_failed", {
                "job_id": job_id,
                "action": action,
                "status": status,
                "progress": int(job.get("progress") or 1),
                "error": message[:1000],
            })
        finally:
            if display_stop:
                display_stop.set()

    thread = threading.Thread(target=worker, name=f"imagine-job-{job_id}", daemon=True)
    thread.start()
    return imagine_job_snapshot(job)


def get_imagine_job(job_id: str) -> dict:
    with IMAGINE_JOB_LOCK:
        job = IMAGINE_JOBS.get(job_id)
        if not job:
            raise RuntimeError("Imagine job was not found.")
        return imagine_job_snapshot(job)


def cancel_imagine_job(payload: dict) -> dict:
    job_id = str(payload.get("id") or "").strip()
    if not job_id:
        raise RuntimeError("Imagine job id is missing.")
    with IMAGINE_JOB_LOCK:
        job = IMAGINE_JOBS.get(job_id)
        if not job:
            raise RuntimeError("Imagine job was not found.")
        if job.get("status") in {"done", "failed", "moderated", "cancelled"}:
            return {"ok": True, "job": imagine_job_snapshot(job)}
        job["cancel_requested"] = True
        job["status"] = "cancelled"
        job["updated_at"] = now_iso()
        return {"ok": True, "job": imagine_job_snapshot(job)}


def dismiss_imagine_job(payload: dict) -> dict:
    job_id = str(payload.get("id") or "").strip()
    if not job_id:
        raise RuntimeError("Imagine job id is missing.")
    with IMAGINE_JOB_LOCK:
        IMAGINE_JOBS.pop(job_id, None)
    return {"ok": True}


def fetch_imagine_identity(cookies: list[dict]) -> dict:
    return imagine_accounts.fetch_imagine_identity(cookies, imagine_base=IMAGINE_BASE)


def start_imagine_login(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    fallback = launch_imagine_browser(IMAGINE_BASE + "/imagine")
    data = scan_library(root)
    data["imagine_window"] = {
        "ok": True,
        "fallback": fallback,
        "url": IMAGINE_BASE + "/imagine",
        "debug_port": IMAGINE_DEBUG_PORT,
        "profile_dir": str(IMAGINE_PROFILE_DIR),
    }
    return data


def prepare_imagine_bridge_session(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account = active_imagine_account(root, str((payload or {}).get("account_id") or ""))
    if not account:
        return {"ok": True, "status": "no_account"}
    if not native_bridge_wait_available(timeout_seconds=8, max_age_seconds=60):
        return {"ok": True, "status": "native_unavailable", "account_id": account.get("id") or ""}
    value = native_bridge_account_command(
        root,
        account,
        "prepare",
        {"url": IMAGINE_BASE + "/imagine/saved"},
        timeout_seconds=IMAGINE_BRIDGE_LOGIN_WAIT_SECONDS + 20,
    )
    status = str(value.get("status") or ("ready" if value.get("ok", True) else "login_needed"))
    return {
        "ok": True,
        "status": status,
        "account_id": account.get("id") or "",
        "store_id": native_bridge_store_id(account),
    }


def open_imagine_usage_page(payload: dict) -> dict:
    root = library_root()
    usage_url = IMAGINE_BASE + "/?_s=usage"
    account = active_imagine_account(root, str((payload or {}).get("account_id") or "")) if root else None
    if root and account:
        command_id = native_bridge_account_command_async(
            root,
            account,
            "open_page",
            {"url": usage_url},
        )
        return {
            "ok": True,
            "usage_window": {
                "ok": True,
                "native": True,
                "queued": True,
                "url": usage_url,
                "account_id": str(account.get("id") or ""),
                "store_id": native_bridge_store_id(account),
                "command_id": command_id,
            },
        }
    fallback = launch_imagine_browser(usage_url)
    return {
        "ok": True,
        "usage_window": {
            "ok": True,
            "fallback": fallback,
            "url": usage_url,
            "debug_port": IMAGINE_DEBUG_PORT,
            "profile_dir": str(IMAGINE_PROFILE_DIR),
        },
    }


def fetch_imagine_usage_tier(account: dict) -> dict:
    return imagine_accounts.fetch_imagine_usage_tier(
        account,
        usage_url=USAGE_URL,
        imagine_base=IMAGINE_BASE,
    )


def apply_imagine_account_tier(account: dict) -> bool:
    return imagine_accounts.apply_imagine_account_tier(
        account,
        usage_url=USAGE_URL,
        imagine_base=IMAGINE_BASE,
        log_event=log_event,
    )


def capture_imagine_login(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    target = find_imagine_cdp_target()
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    result = cdp_call(ws_url, "Network.getAllCookies", timeout=12)
    cookies = normalize_imagine_cookies(result.get("cookies") if isinstance(result.get("cookies"), list) else [])
    if not cookies:
        raise RuntimeError("No grok.com cookies were captured. Finish the Imagine login, then Register again.")
    identity = fetch_imagine_identity(cookies)
    account = normalize_imagine_account({
        "provider": "imagine",
        "captured_at": now_iso(),
        "source_url": str(target.get("url") or IMAGINE_BASE + "/imagine"),
        "cookies": cookies,
        **identity,
    })
    existing_tier = matching_account_tier(account_files(root)["imagine"].get("accounts") or [], account)
    if existing_tier:
        account["tier"] = existing_tier
    apply_imagine_account_tier(account)
    imagine = account_files(root)["imagine"]
    imagine["accounts"] = upsert_account(imagine.get("accounts") or [], account)
    imagine["active_id"] = account["id"]
    write_imagine_auth(root, imagine)
    close_imagine_browser()
    return scan_library(root)


def select_imagine_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account_id_value = str(payload.get("id") or "")
    imagine = account_files(root)["imagine"]
    if not any(account.get("id") == account_id_value for account in imagine.get("accounts") or []):
        raise RuntimeError("Imagine account not found.")
    imagine["active_id"] = account_id_value
    write_imagine_auth(root, imagine)
    return scan_library(root)


def logout_imagine_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    close_imagine_browser()
    imagine = account_files(root)["imagine"]
    imagine["active_id"] = ""
    write_imagine_auth(root, imagine)
    return scan_library(root)


def delete_imagine_account(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    account_id_value = str(payload.get("id") or "")
    imagine = account_files(root)["imagine"]
    accounts = [account for account in imagine.get("accounts") or [] if account.get("id") != account_id_value]
    if len(accounts) == len(imagine.get("accounts") or []):
        raise RuntimeError("Imagine account not found.")
    imagine["accounts"] = accounts
    if imagine.get("active_id") == account_id_value:
        imagine["active_id"] = accounts[0].get("id") if accounts else ""
    write_imagine_auth(root, imagine)
    return scan_library(root)


def imagine_account_status(account: dict) -> dict:
    return imagine_accounts.imagine_account_status(account, imagine_base=IMAGINE_BASE)


def imagine_account_statuses(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    requested = {str(value) for value in payload.get("ids", [])} if isinstance(payload.get("ids"), list) else set()
    imagine = account_files(root)["imagine"]
    accounts = imagine.get("accounts") or []
    selected_accounts = [
        (index, account)
        for index, account in enumerate(accounts)
        if not requested or str(account.get("id") or "") in requested
    ]
    statuses_by_index: dict[int, dict] = {}
    changed = False

    def check_one(index: int, account: dict) -> tuple[int, dict, bool]:
        account_id_value = str(account.get("id") or "")
        try:
            status = imagine_account_status(account)
        except Exception as exc:
            status = {"id": account_id_value, "status": "unknown", "message": str(exc)[:240]}
        account_changed = False
        if status.get("status") == "ok":
            account_changed = apply_imagine_account_tier(account)
        status["tier"] = normalize_account_tier(account.get("tier"))
        return index, status, account_changed

    if selected_accounts:
        max_workers = min(6, len(selected_accounts))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(check_one, index, account) for index, account in selected_accounts]
            for future in as_completed(futures):
                index, status, account_changed = future.result()
                statuses_by_index[index] = status
                changed = account_changed or changed
    if changed:
        write_imagine_auth(root, imagine)
    statuses = [statuses_by_index[index] for index, _account in selected_accounts if index in statuses_by_index]
    return {"ok": True, "statuses": statuses}


def find_secret_value(value, names: set[str], depth: int = 0, allow_plain_string: bool = False) -> str:
    if depth > 7 or value is None:
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        if not allow_plain_string:
            return ""
        if stripped.lower().startswith("bearer "):
            return stripped.split(None, 1)[1].strip()
        return stripped
    if isinstance(value, list):
        for item in value:
            found = find_secret_value(item, names, depth + 1)
            if found:
                return found
        return ""
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key or "").lower().replace("-", "_")
            if normalized in names and isinstance(item, str):
                found = find_secret_value(item, names, depth + 1, True)
                if found:
                    return found
        for item in value.values():
            found = find_secret_value(item, names, depth + 1)
            if found:
                return found
    return ""


def active_build_account(root: Path) -> dict | None:
    build = account_files(root).get("build") or {}
    accounts = build.get("accounts") if isinstance(build.get("accounts"), list) else []
    active_id = str(build.get("active_id") or "")
    active = next((account for account in accounts if str(account.get("id") or "") == active_id), None)
    if active_id:
        return active
    return accounts[0] if accounts else None


def active_build_store_and_account(root: Path) -> tuple[dict, dict]:
    build = account_files(root).get("build") or {}
    accounts = build.get("accounts") if isinstance(build.get("accounts"), list) else []
    active_id = str(build.get("active_id") or "")
    account = next((item for item in accounts if str(item.get("id") or "") == active_id), None)
    if active_id and not isinstance(account, dict):
        raise RuntimeError("Selected Build account is missing. Choose a Build account again.")
    account = account or (accounts[0] if accounts else None)
    if not isinstance(account, dict):
        raise RuntimeError("Build account is not set.")
    return build, account


def mark_build_oauth_invalid(root: Path, build: dict, account: dict, item: dict, detail_text: str, status_code: int) -> None:
    now = now_iso()
    if isinstance(item, dict):
        item["oauth_invalid"] = True
        item["requires_login"] = True
        item["oauth_error"] = "invalid_grant"
        item["oauth_error_at"] = now
        item["oauth_error_detail"] = str(detail_text or "")[:500]
    account["status"] = "login_required"
    account["oauth_error"] = "invalid_grant"
    account["oauth_error_at"] = now
    account["oauth_error_detail"] = str(detail_text or "")[:500]
    log_event(
        "build_oauth_invalid_grant "
        f"account={account.get('email') or account.get('label') or account.get('id') or ''} "
        f"status={status_code}"
    )
    write_build_auth(root, build)


def build_oauth_token_for_account(
    root: Path,
    build: dict,
    account: dict,
    force: bool = False,
    persist_invalid_grant: bool = True,
) -> str | None:
    auth = account.get("auth") if isinstance(account.get("auth"), dict) else {}
    candidates = auth_candidates(auth)
    if not candidates:
        return None
    valid_candidates = valid_auth_candidates(candidates)
    if not valid_candidates:
        raise RuntimeError("Build OAuth login expired. Run `grok login` again.")
    item = choose_auth_candidate(valid_candidates, force)
    if not token_needs_refresh(item, force):
        return str(item.get("key") or "")
    refresh_token = item.get("refresh_token")
    client_id = item.get("oidc_client_id")
    issuer = item.get("oidc_issuer") or "https://auth.x.ai"
    if not isinstance(refresh_token, str) or not isinstance(client_id, str):
        if force:
            raise RuntimeError("OAuth token was rejected and cannot be refreshed. Run `grok login` again.")
        return None
    form = urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }).encode("utf-8")
    request = urllib.request.Request(
        discover_oidc_token_endpoint(str(issuer)),
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if persist_invalid_grant and oauth_refresh_error_is_invalid_grant(exc.code, detail):
            mark_build_oauth_invalid(root, build, account, item, detail, exc.code)
        elif oauth_refresh_error_is_invalid_grant(exc.code, detail):
            log_event(
                "build_oauth_invalid_grant_ignored "
                f"account={account.get('email') or account.get('label') or account.get('id') or ''} "
                f"status={exc.code}"
            )
        raise RuntimeError(f"OAuth refresh failed HTTP {exc.code}. Run `grok login` again.\n{detail[:500]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OAuth refresh network error: {exc}") from exc
    try:
        refreshed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"OAuth refresh returned non-JSON response: {body[:500]}") from exc
    access_token = refreshed.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError("OAuth refresh did not return an access token. Run `grok login` again.")
    item["key"] = access_token
    if isinstance(refreshed.get("refresh_token"), str):
        item["refresh_token"] = refreshed["refresh_token"]
    expires_in = refreshed.get("expires_in")
    if isinstance(expires_in, (int, float)):
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=float(expires_in))
        item["expires_at"] = expires_at.isoformat().replace("+00:00", "Z")
    account["expires_at"] = str(item.get("expires_at") or "")
    account["status"] = build_account_status(account["expires_at"])
    write_build_auth(root, build)
    return access_token


def refresh_build_oauth_token(root: Path, force: bool = False) -> str | None:
    if os.environ.get("XAI_API_KEY") or os.environ.get("GROK_XAI_API_KEY"):
        return None
    build, account = active_build_store_and_account(root)
    return build_oauth_token_for_account(root, build, account, force)


def fetch_build_usage_tier_for_account(root: Path, build: dict, account: dict) -> dict:
    result = {
        "ok": False,
        "tier": normalize_account_tier(account.get("tier")),
        "message": "Usage tier unavailable",
    }
    try:
        token = build_oauth_token_for_account(root, build, account, persist_invalid_grant=False)
    except RuntimeError as exc:
        result["message"] = str(exc).splitlines()[0]
        return result
    if not token:
        result["message"] = "No OAuth bearer key found."
        return result
    request = urllib.request.Request(
        USAGE_URL,
        headers={
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Authorization": f"Bearer {token}",
            "User-Agent": "Grok Chameleon local tier checker",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            body = response.read(5_000_000).decode("utf-8", errors="replace")
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        result["message"] = f"Usage tier request HTTP {exc.code}"
        return result
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        result["message"] = f"Usage tier network error: {exc}"
        return result
    if "login" in body[:5000].lower():
        result["message"] = "Usage page needs a Grok web login"
        return result
    tier = parse_usage_tier_text(text_from_usage_body(body, content_type))
    return {
        "ok": True,
        "tier": normalize_account_tier(tier),
        "message": f"Usage tier detected: {tier}",
    }


def refresh_build_account_tiers(root: Path) -> None:
    build = account_files(root).get("build") or {}
    accounts = build.get("accounts") if isinstance(build.get("accounts"), list) else []
    changed = False
    for account in accounts:
        if not isinstance(account, dict):
            continue
        before = normalize_account_tier(account.get("tier"))
        result = fetch_build_usage_tier_for_account(root, build, account)
        if result.get("ok"):
            tier = normalize_account_tier(result.get("tier"))
            account["tier"] = tier
            account["tier_checked_at"] = now_iso()
            changed = True
            log_event(f"Build usage tier {tier} for {account.get('email') or account.get('label') or account.get('id')}: {result.get('message') or ''}")
        else:
            account["tier"] = before
            log_event(f"Build usage tier kept {before} for {account.get('email') or account.get('label') or account.get('id')}: {result.get('message') or ''}")
    if changed:
        write_build_auth(root, build)


def build_api_key(root: Path, force_refresh: bool = False) -> str:
    env_key = os.environ.get("XAI_API_KEY") or os.environ.get("GROK_XAI_API_KEY")
    if env_key:
        return find_secret_value(env_key, {"api_key"}, allow_plain_string=True)
    refreshed = refresh_build_oauth_token(root, force_refresh)
    if refreshed:
        return refreshed
    account = active_build_account(root) or {}
    candidates = auth_candidates(account.get("auth") if isinstance(account.get("auth"), dict) else {})
    if candidates:
        valid_candidates = valid_auth_candidates(candidates)
        if not valid_candidates:
            raise RuntimeError("Build OAuth login expired. Run `grok login` again.")
        chosen = choose_auth_candidate(valid_candidates)
        key = str(chosen.get("key") or "").strip()
    else:
        key = find_secret_value(account.get("auth") or account, {"api_key", "apikey", "xai_api_key", "key", "token", "access_token", "authorization"})
    if not key:
        raise RuntimeError("Build API key is not set.")
    return key


def post_field(meta, key: str):
    if not isinstance(meta, dict):
        return ""
    for candidate in (
        meta.get(key),
        (meta.get("imagine_media_post") or {}).get(key) if isinstance(meta.get("imagine_media_post"), dict) else "",
    ):
        if candidate:
            return candidate
    data = meta.get("data")
    if isinstance(data, list) and data:
        first = data[0] if isinstance(data[0], dict) else {}
        if first.get(key):
            return first.get(key)
        nested = first.get("imagine_media_post")
        if isinstance(nested, dict) and nested.get(key):
            return nested.get(key)
    raw_events = meta.get("raw_events")
    if isinstance(raw_events, list) and raw_events and isinstance(raw_events[0], dict):
        return raw_events[0].get(key) or ""
    return ""


def media_url(rel_path: str, source_path: Path | None = None) -> str:
    url = f"/api/media?path={quote(rel_path)}"
    if not source_path:
        return url
    try:
        stat = source_path.stat()
    except OSError:
        return url
    return f"{url}&v={stat.st_mtime_ns:x}-{stat.st_size:x}"


def library_media_object_url(rel_path: str, source_path: Path | None = None) -> str:
    return media_url(rel_path, source_path)


def card_preview_cache_root() -> Path:
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


def card_preview_cache_path(key: str) -> Path | None:
    value = str(key or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", value):
        return None
    cache_dir = card_preview_cache_dir()
    return cache_dir / f"{value}.jpg" if cache_dir else None


def thumbnail_candidates_for_video(video_name: str) -> list[str]:
    stem = file_stem(video_name)
    names = []
    for ext in THUMB_EXTS:
        names.append(f"{stem}.thumb.{ext}")
    for ext in THUMB_EXTS:
        names.append(f"{stem}.{ext}")
    return names


def is_apple_metadata_file_name(name: str) -> bool:
    """Return True for macOS AppleDouble sidecar files, never real media."""
    return Path(str(name or "")).name.startswith("._")


def thumbnail_for_video(folder: Path, rel_folder: str, video_name: str) -> dict:
    for name in thumbnail_candidates_for_video(video_name):
        thumbnail_path = folder / name
        if thumbnail_path.is_file():
            return {
                "thumbnail": name,
                "thumbnail_url": media_url(f"{rel_folder}/{name}".strip("/"), thumbnail_path),
            }
    return {}


def thumbnail_file_names(folder: Path) -> set[str]:
    video_names = [
        entry.name
        for entry in sorted_entries(folder)
        if entry.is_file()
        and not is_apple_metadata_file_name(entry.name)
        and media_type_for_name(entry.name) == "video"
    ]
    names = set()
    for video_name in video_names:
        for candidate in thumbnail_candidates_for_video(video_name):
            if (folder / candidate).is_file():
                names.add(candidate)
    return names


def media_items_in_folder(root: Path, folder: Path, rel_folder: str) -> list[dict]:
    items = []
    used_item_ids: set[str] = set()
    thumb_names = thumbnail_file_names(folder)
    for entry in sorted_entries(folder):
        if not entry.is_file():
            continue
        if is_apple_metadata_file_name(entry.name):
            continue
        media_type = media_type_for_name(entry.name)
        if not media_type:
            continue
        if media_type == "image" and entry.name in thumb_names:
            continue
        rel = f"{rel_folder}/{entry.name}".strip("/")
        stat = entry.stat()
        mime_type = mimetypes.guess_type(entry.name)[0] or f"{media_type}/{extension_for(entry.name)}"
        item = {
            "item_id": claim_unique_media_item_id(file_stem(entry.name), used_item_ids),
            "type": media_type,
            "file": entry.name,
            "mime_type": mime_type,
            "size": stat.st_size,
            "last_modified": int(stat.st_mtime * 1000),
            "object_url": media_url(rel, entry),
            "role": "result",
        }
        if media_type == "video":
            item.update(thumbnail_for_video(folder, rel_folder, entry.name))
        items.append(item)
    return sorted(items, key=lambda item: (-int(item.get("last_modified") or 0), str(item.get("file") or "")))


def remote_item_from_meta(meta) -> dict | None:
    url = post_field(meta, "media_url") or post_field(meta, "mediaUrl") or post_field(meta, "url")
    if not url:
        return None
    mime_type = post_field(meta, "mime_type") or post_field(meta, "mimeType") or ""
    media_type = "video" if str(mime_type).startswith("video/") or extension_for(urlparse(str(url)).path) in VIDEO_EXTS else "image"
    return {
        "item_id": post_field(meta, "imagine_image_id") or post_field(meta, "id") or file_stem(Path(urlparse(str(url)).path).name or "remote"),
        "type": media_type,
        "file": "",
        "url": url,
        "object_url": url,
        "mime_type": mime_type,
        "role": "remote",
    }


def media_items_from_meta(root: Path, folder: Path, rel_folder: str, meta) -> list[dict]:
    raw_items = meta.get("items") if isinstance(meta, dict) else []
    if not isinstance(raw_items, list):
        return []
    items = []
    used_item_ids: set[str] = set()
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("media_url") or item.get("mediaUrl") or ""
        file_name = item.get("file") or ""
        if file_name and is_apple_metadata_file_name(file_name):
            continue
        media_type = item.get("type") or media_type_for_name(file_name or url)
        if not media_type and str(item.get("mime_type") or item.get("mimeType") or "").startswith("video/"):
            media_type = "video"
        if not media_type:
            media_type = "image"
        object_url = url
        source_path = folder / file_name if file_name else None
        if source_path and source_path.exists():
            object_url = media_url(f"{rel_folder}/{file_name}".strip("/"), source_path)
        item_data = {
            **item,
            "item_id": claim_unique_media_item_id(
                item.get("item_id") or item.get("id") or file_stem(file_name or Path(urlparse(str(url)).path).name or f"item-{index + 1}"),
                used_item_ids,
            ),
            "type": media_type,
            "file": file_name,
            "url": url,
            "object_url": object_url,
            "mime_type": item.get("mime_type") or item.get("mimeType") or "",
            "role": item.get("role") or "result",
        }
        thumbnail = item.get("thumbnail") or item.get("poster") or ""
        thumbnail_url = item.get("thumbnail_url") or item.get("poster_url") or ""
        thumbnail_path = folder / thumbnail if thumbnail else None
        if thumbnail_path and thumbnail_path.exists():
            thumbnail_url = media_url(f"{rel_folder}/{thumbnail}".strip("/"), thumbnail_path)
        elif media_type == "video" and file_name and (folder / file_name).exists():
            thumb = thumbnail_for_video(folder, rel_folder, file_name)
            thumbnail = thumb.get("thumbnail") or thumbnail
            thumbnail_url = thumb.get("thumbnail_url") or thumbnail_url
        if thumbnail:
            item_data["thumbnail"] = thumbnail
        if thumbnail_url:
            item_data["thumbnail_url"] = thumbnail_url
        items.append(item_data)
    return [item for item in items if item.get("file") or item.get("url")]


def media_item_key(item: dict | None) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("item_id") or item.get("file") or item.get("url") or "")


def mark_lucky_media_item(item: dict | None, reason: str = "") -> dict | None:
    if not isinstance(item, dict):
        return item
    item["lucky"] = True
    if reason:
        item["lucky_reason"] = reason
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    metadata["lucky"] = True
    if reason:
        metadata["lucky_reason"] = reason
    item["metadata"] = metadata
    return item


def media_item_is_lucky(item: dict | None) -> bool:
    if not isinstance(item, dict):
        return False
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    return bool(item.get("lucky") or item.get("lucky_recovery") or metadata.get("lucky") or imagine.get("lucky"))


def merge_media_items(media_items: list[dict], meta_items: list[dict]) -> list[dict]:
    if not media_items or not meta_items:
        return media_items
    merged = []
    used_item_ids: set[str] = set()
    for media_item in media_items:
        meta_item = next((item for item in meta_items if item.get("file") and item.get("file") == media_item.get("file")), None)
        if not meta_item:
            meta_item = next((item for item in meta_items if item.get("url") and item.get("url") == media_item.get("url")), None)
        if not meta_item:
            meta_item = next((item for item in meta_items if item.get("item_id") and item.get("item_id") == media_item.get("item_id")), None)
        if meta_item:
            merged_item = {
                **meta_item,
                **media_item,
                "role": meta_item.get("role") or media_item.get("role"),
                "relation": meta_item.get("relation") or media_item.get("relation") or "",
                "prompt": meta_item.get("prompt") or media_item.get("prompt") or "",
                "title": meta_item.get("title") or media_item.get("title") or "",
            }
            merged_item["item_id"] = claim_unique_media_item_id(
                meta_item.get("item_id") or media_item.get("item_id") or file_stem(merged_item.get("file") or ""),
                used_item_ids,
            )
            merged.append(merged_item)
        else:
            media_item["item_id"] = claim_unique_media_item_id(
                media_item.get("item_id") or file_stem(media_item.get("file") or ""),
                used_item_ids,
            )
            merged.append(media_item)
    return merged


def representative_item(items: list[dict], meta) -> dict | None:
    def is_result(item: dict) -> bool:
        role = str(item.get("role") or item.get("relation") or item.get("source_type") or item.get("kind") or "").lower()
        return not re.search(r"(original|source|start|input|parent|reference|ref)", role)

    def time_value(item: dict, fallback_index: int) -> tuple[float, int]:
        for key in ("created_at", "createdAt", "timestamp", "updated_at", "updatedAt", "last_modified", "lastModified"):
            value = item.get(key)
            if isinstance(value, (int, float)):
                return float(value), fallback_index
            if value:
                try:
                    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
                    return parsed, fallback_index
                except ValueError:
                    pass
        file_name = str(item.get("file") or item.get("url") or item.get("item_id") or "")
        match = re.search(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_T ]?(\d{2})?[-_]?(\d{2})?[-_]?(\d{2})?", file_name)
        if match:
            year, month, day, hour, minute, second = match.groups()
            try:
                parsed = datetime(
                    int(year),
                    int(month),
                    int(day),
                    int(hour or 0),
                    int(minute or 0),
                    int(second or 0),
                    tzinfo=timezone.utc,
                ).timestamp()
                return parsed, fallback_index
            except ValueError:
                pass
        return float(fallback_index), fallback_index

    def latest(media_type: str, require_result: bool) -> dict | None:
        candidates = [
            (index, item)
            for index, item in enumerate(items)
            if item.get("type") == media_type and (not require_result or is_result(item))
        ]
        if not candidates:
            return None
        _, selected = max(candidates, key=lambda pair: time_value(pair[1], pair[0]))
        return selected

    wanted = ""
    if isinstance(meta, dict):
        wanted = meta.get("representative") or meta.get("representative_file") or ""
    return (
        latest("video", True)
        or latest("image", True)
        or latest("video", False)
        or latest("image", False)
        or (next((item for item in items if item.get("file") == wanted or item.get("url") == wanted or item.get("item_id") == wanted), None) if wanted else None)
        or (items[0] if items else None)
    )


def post_from_folder(root: Path, folder: Path, context: dict) -> dict | None:
    rel_folder = context["path"]
    meta = read_json(folder / "post.json", None)
    media_items = media_items_in_folder(root, folder, rel_folder)
    meta_items = media_items_from_meta(root, folder, rel_folder, meta or {})
    remote_item = remote_item_from_meta(meta) if meta else None
    items = merge_media_items(media_items, meta_items) if media_items else (meta_items or ([remote_item] if remote_item else []))
    if not meta and not items:
        return None
    representative = representative_item(items, meta)
    created_at = (
        (meta or {}).get("created_at")
        or post_field(meta, "createTime")
        or post_field(meta, "created_at")
        or (datetime.fromtimestamp((items[0].get("last_modified") or 0) / 1000, timezone.utc).isoformat().replace("+00:00", "Z") if items and items[0].get("last_modified") else now_iso())
    )
    source = (
        (meta or {}).get("source")
        or ("imagine" if post_field(meta, "provider") == "imagine" or post_field(meta, "imagine_post_id") else "")
        or context.get("source")
        or "local"
    )
    folder_name = context["folderName"]
    return {
        "post_id": (meta or {}).get("post_id") or post_field(meta, "imagine_post_id") or post_field(meta, "id") or folder_name,
        "source": source,
        "mode": (meta or {}).get("mode") or context.get("mode") or "",
        "folder_role": (meta or {}).get("folder_role") or "",
        "title": (meta or {}).get("title") or post_field(meta, "title") or post_field(meta, "prompt") or readable_name(folder_name),
        "prompt": (meta or {}).get("prompt") or post_field(meta, "prompt") or post_field(meta, "full_prompt") or "",
        "original_prompt": (meta or {}).get("original_prompt") or post_field(meta, "originalPrompt") or "",
        "created_at": created_at,
        "model": (meta or {}).get("model") or post_field(meta, "model") or post_field(meta, "modelName") or post_field(meta, "model_name") or "",
        "group_id": (meta or {}).get("group_id") or post_field(meta, "group_id") or "",
        "parent_id": (meta or {}).get("parent_id") or post_field(meta, "parent_id") or "",
        "root_post_id": (meta or {}).get("root_post_id") or post_field(meta, "root_post_id") or "",
        "original_post_id": (meta or {}).get("original_post_id") or "",
        "source_post_id": (meta or {}).get("source_post_id") or "",
        "split_from_post_id": (meta or {}).get("split_from_post_id") or "",
        "account_id": (meta or {}).get("account_id") or post_field(meta, "imagine_account_id") or "",
        "account_email": (meta or {}).get("account_email") or post_field(meta, "imagine_account_email") or "",
        "build_favorite": bool((meta or {}).get("build_favorite") or (meta or {}).get("favorite") or (meta or {}).get("liked")),
        "favorite": bool((meta or {}).get("favorite") or (meta or {}).get("build_favorite") or (meta or {}).get("liked")),
        "order": safe_int((meta or {}).get("order"), 0),
        "grid_slot": safe_int((meta or {}).get("grid_slot"), 0),
        "folder_path": rel_folder,
        "collection": context.get("collection"),
        "area": context["area"],
        "folderName": folder_name,
        "representative": (representative or {}).get("file") or (representative or {}).get("url") or "",
        "representative_item": representative,
        "items": items,
    }


def scan_post_tree(root: Path, folder: Path, context: dict, depth: int = 0) -> list[dict]:
    if depth > 5:
        return []
    posts = []
    post = post_from_folder(root, folder, context)
    if post:
        posts.append(post)
    for entry in sorted_entries(folder):
        if not entry.is_dir():
            continue
        posts.extend(scan_post_tree(root, entry, {
            **context,
            "path": f"{context['path']}/{entry.name}",
            "folderName": entry.name,
        }, depth + 1))
    return posts


def scan_created_area(root: Path, area: str, logical_area: str | None = None) -> list[dict]:
    area_path = root / area
    if not area_path.exists():
        return []
    post_area = logical_area or area
    posts = []
    if post_area == "upload":
        root_post = post_from_folder(root, area_path, {
            "area": post_area,
            "path": area,
            "folderName": area,
            "collection": None,
            "source": "local",
        })
        if root_post:
            posts.append(root_post)
    for entry in sorted_entries(area_path):
        if not entry.is_dir():
            continue
        posts.extend(scan_post_tree(root, entry, {
            "area": post_area,
            "path": f"{area}/{entry.name}",
            "folderName": entry.name,
            "collection": None,
            "source": "local" if post_area == "upload" else "",
        }))
    return posts


def post_from_unsaved_json(root: Path, file_path: Path, rel_path: str) -> dict | None:
    meta = read_json(file_path, None)
    if not isinstance(meta, dict):
        return None
    rel_folder = str(Path(rel_path).parent).replace("\\", "/")
    items = media_items_from_meta(root, file_path.parent, rel_folder, meta)
    remote_item = remote_item_from_meta(meta)
    if remote_item and not items:
        items.append(remote_item)
    representative = representative_item(items, meta)
    return {
        "post_id": meta.get("post_id") or post_field(meta, "imagine_post_id") or post_field(meta, "id") or file_stem(file_path.name),
        "source": meta.get("source") or ("imagine" if post_field(meta, "provider") == "imagine" else "build"),
        "mode": meta.get("mode") or "t2i",
        "status": meta.get("status") or "unsaved",
        "title": meta.get("title") or meta.get("prompt") or readable_name(file_path.name),
        "prompt": meta.get("prompt") or post_field(meta, "prompt") or "",
        "original_prompt": meta.get("original_prompt") or post_field(meta, "originalPrompt") or "",
        "created_at": meta.get("created_at") or post_field(meta, "createTime") or now_iso(),
        "model": meta.get("model") or post_field(meta, "model") or post_field(meta, "modelName") or "",
        "group_id": meta.get("group_id") or post_field(meta, "group_id") or "",
        "parent_id": meta.get("parent_id") or post_field(meta, "parent_id") or "",
        "root_post_id": meta.get("root_post_id") or post_field(meta, "root_post_id") or "",
        "original_post_id": meta.get("original_post_id") or "",
        "source_post_id": meta.get("source_post_id") or "",
        "split_from_post_id": meta.get("split_from_post_id") or "",
        "account_id": meta.get("account_id") or post_field(meta, "imagine_account_id") or "",
        "account_email": meta.get("account_email") or post_field(meta, "imagine_account_email") or "",
        "build_favorite": bool(meta.get("build_favorite") or meta.get("favorite") or meta.get("liked")),
        "favorite": bool(meta.get("favorite") or meta.get("build_favorite") or meta.get("liked")),
        "folder_path": rel_path,
        "collection": None,
        "area": "unsaved",
        "folderName": file_stem(file_path.name),
        "representative": (representative or {}).get("file") or (representative or {}).get("url") or "",
        "representative_item": representative,
        "items": items,
    }


def scan_unsaved_area(root: Path) -> list[dict]:
    unsaved = root / "unsaved"
    if not unsaved.exists():
        return []
    posts = []

    def walk(folder: Path, rel_path: str, depth: int = 0) -> None:
        if depth > 5:
            return
        folder_post = post_from_folder(root, folder, {
            "area": "unsaved",
            "path": rel_path,
            "folderName": Path(rel_path).name or "unsaved",
            "collection": None,
        })
        if folder_post:
            posts.append(folder_post)
        for entry in sorted_entries(folder):
            child_rel = f"{rel_path}/{entry.name}".strip("/")
            if entry.is_dir():
                walk(entry, child_rel, depth + 1)
            elif extension_for(entry.name) == "json" and entry.name != "post.json":
                post = post_from_unsaved_json(root, entry, child_rel)
                if post:
                    posts.append(post)

    walk(unsaved, "unsaved")
    return posts


def scan_collection_folders(root: Path) -> list[dict]:
    collection_root = root / "collection"
    if not collection_root.exists():
        return []
    library = merge_library_json(read_json(root / "library.json", {}))
    settings = library.get("settings") if isinstance(library.get("settings"), dict) else {}
    collection_order = [str(value) for value in settings.get("collection_order", []) if str(value)]
    collection_order_index = {path: index for index, path in enumerate(collection_order)}
    collection_sort = settings.get("collection_sort") if isinstance(settings.get("collection_sort"), dict) else {}

    def collection_sort_key(collection: dict) -> tuple[int, str]:
        path = str(collection.get("path") or "")
        return (collection_order_index.get(path, 10_000), str(collection.get("name") or "").lower())

    def normalize_post_slots(posts: list[dict]) -> list[dict]:
        groups: dict[str, list[dict]] = {}
        for post in posts:
            path_parts = Path(str(post.get("folder_path") or "")).parts
            parent_path = "/".join(path_parts[:-1])
            groups.setdefault(parent_path, []).append(post)
        for siblings in groups.values():
            normalized = sorted(siblings, key=lambda item: (
                safe_int(item.get("grid_slot"), 10_000),
                safe_int(item.get("order"), 10_000),
                str(item.get("created_at") or ""),
                str(item.get("folder_path") or ""),
            ))
            occupied: set[int] = set()
            next_slot = 0
            for post in normalized:
                slot = safe_int(post.get("grid_slot"), -1)
                if slot < 0 or slot in occupied:
                    while next_slot in occupied:
                        next_slot += 1
                    slot = next_slot
                    post["grid_slot"] = slot
                occupied.add(slot)
                next_slot = max(next_slot, slot + 1)
        return sorted(posts, key=lambda item: (
            "/".join(Path(str(item.get("folder_path") or "")).parts[:-1]),
            safe_int(item.get("grid_slot"), 10_000),
            safe_int(item.get("order"), 10_000),
            str(item.get("created_at") or ""),
        ))

    collections = []
    for entry in sorted_entries(collection_root):
        if not entry.is_dir():
            continue
        collection_path = f"collection/{entry.name}"
        collection = {
            "id": entry.name,
            "name": readable_name(entry.name),
            "path": collection_path,
            "order": collection_order_index.get(collection_path, 10_000),
            "sort_mode": str(collection_sort.get(collection_path) or ""),
            "posts": [],
        }
        direct_post = post_from_folder(root, entry, {
            "area": "collection",
            "path": collection["path"],
            "folderName": entry.name,
            "collection": entry.name,
        })
        if direct_post:
            collection["posts"].append(direct_post)
        for child in sorted_entries(entry):
            if not child.is_dir():
                continue
            collection["posts"].extend(scan_post_tree(root, child, {
                "area": "collection",
                "path": f"{collection['path']}/{child.name}",
                "folderName": child.name,
                "collection": entry.name,
            }))
        collection["posts"] = normalize_post_slots(collection["posts"])
        collections.append(collection)
    return sorted(collections, key=collection_sort_key)


def scan_prompt_files(root: Path) -> list[dict]:
    prompt_root = root / "prompt"
    if not prompt_root.exists():
        return []
    prompts = []
    for entry in sorted_entries(prompt_root):
        if not entry.is_file() or extension_for(entry.name) != "txt":
            continue
        stat = entry.stat()
        prompts.append({
            "id": file_stem(entry.name),
            "title": readable_name(entry.name),
            "file_name": entry.name,
            "path": f"prompt/{entry.name}",
            "text": entry.read_text(encoding="utf-8", errors="replace"),
            "updated_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
        })
    return sorted(prompts, key=lambda item: str(item.get("updated_at") or ""), reverse=True)


def post_summary(post: dict) -> dict:
    return {
        "post_id": post.get("post_id"),
        "source": post.get("source"),
        "mode": post.get("mode"),
        "folder_role": post.get("folder_role") or "",
        "title": post.get("title"),
        "prompt": post.get("prompt") or "",
        "path": post.get("folder_path"),
        "collection": post.get("collection"),
        "representative": post.get("representative"),
        "created_at": post.get("created_at"),
        "group_id": post.get("group_id") or "",
        "parent_id": post.get("parent_id") or "",
        "root_post_id": post.get("root_post_id") or "",
        "original_post_id": post.get("original_post_id") or "",
        "source_post_id": post.get("source_post_id") or "",
        "split_from_post_id": post.get("split_from_post_id") or "",
        "build_favorite": bool(post.get("build_favorite") or post.get("favorite") or post.get("liked")),
        "favorite": bool(post.get("favorite") or post.get("build_favorite") or post.get("liked")),
        "order": safe_int(post.get("order"), 0),
        "grid_slot": safe_int(post.get("grid_slot"), 0),
        "item_count": len(post.get("items") or []),
    }


def collection_summary(collection: dict) -> dict:
    return {
        "id": collection.get("id"),
        "name": collection.get("name"),
        "path": collection.get("path"),
        "order": safe_int(collection.get("order"), 0),
        "sort_mode": collection.get("sort_mode") or "",
        "post_count": len(collection.get("posts") or []),
    }


def prompt_summary(prompt: dict) -> dict:
    return {
        "id": prompt.get("id"),
        "title": prompt.get("title"),
        "path": prompt.get("path"),
        "updated_at": prompt.get("updated_at"),
    }


def empty_snapshot() -> dict:
    return {
        "ok": True,
        "library_root": "",
        "root_name": "",
        "library": default_library_json(),
        "posts": [],
        "collections": [],
        "prompts": [],
        "accounts": {"build": default_build_auth(), "imagine": default_imagine_auth()},
    }


def health_snapshot() -> dict:
    return {"ok": True, "status": "ready", "pid": os.getpid()}


def scan_library(root: Path | None = None) -> dict:
    root = root or library_root()
    if not root:
        return empty_snapshot()
    ensure_library_root(root)
    collections = scan_collection_folders(root)
    posts = [
        *scan_created_area(root, "created"),
        *scan_created_area(root, "upload"),
        *[post for collection in collections for post in collection.get("posts", [])],
    ]
    posts = sorted(posts, key=lambda item: str(item.get("created_at") or ""), reverse=True)
    prompts = scan_prompt_files(root)
    library = merge_library_json(read_json(root / "library.json", {}))
    library["updated_at"] = now_iso()
    library["posts"] = [post_summary(post) for post in posts]
    library["collections"] = [collection_summary(collection) for collection in collections]
    library["prompts"] = [prompt_summary(prompt) for prompt in prompts]
    write_json(root / "library.json", library)
    return {
        "ok": True,
        "library_root": str(root),
        "root_name": root.name,
        "library": library,
        "posts": posts,
        "collections": collections,
        "prompts": prompts,
        "accounts": account_files(root),
    }


def applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def unique_trash_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 1000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not find a free Trash filename near {path.name}.")


def move_path_to_windows_recycle_bin(path: Path) -> None:
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    fo_delete = 0x0003
    fof_silent = 0x0004
    fof_no_confirmation = 0x0010
    fof_allow_undo = 0x0040
    fof_no_error_ui = 0x0400
    # SHFileOperationW expects a double-NUL-terminated list, even for one path.
    source = ctypes.create_unicode_buffer(str(path) + "\0")
    operation = SHFILEOPSTRUCTW(
        hwnd=None,
        wFunc=fo_delete,
        pFrom=ctypes.cast(source, wintypes.LPCWSTR),
        pTo=None,
        fFlags=fof_allow_undo | fof_no_confirmation | fof_silent | fof_no_error_ui,
        fAnyOperationsAborted=False,
        hNameMappings=None,
        lpszProgressTitle=None,
    )
    shell_file_operation = ctypes.windll.shell32.SHFileOperationW
    shell_file_operation.argtypes = [ctypes.POINTER(SHFILEOPSTRUCTW)]
    shell_file_operation.restype = ctypes.c_int
    result = int(shell_file_operation(ctypes.byref(operation)))
    if result != 0:
        raise RuntimeError(f"Could not move to Windows Recycle Bin (SHFileOperationW error {result}).")
    if operation.fAnyOperationsAborted:
        raise RuntimeError("Windows Recycle Bin move was canceled.")


def move_path_to_trash(path: Path) -> None:
    path = path.expanduser().resolve()
    if not path.exists():
        return
    if sys.platform == "darwin":
        script = (
            "tell application \"Finder\"\n"
            f"delete (POSIX file {applescript_string(str(path))} as alias)\n"
            "end tell"
        )
        result = subprocess.run(
            ["osascript", "-e", script],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "Finder Trash move failed"
            raise RuntimeError(f"Could not move to Trash: {detail}")
        return
    if os.name == "nt":
        move_path_to_windows_recycle_bin(path)
        return
    trash_dir = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "Trash" / "files"
    trash_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(unique_trash_path(trash_dir / path.name)))


def choose_folder_in_finder(current: str = "", prompt: str = "Select a Library folder for Grok Chameleon") -> str | None:
    current_path = Path(current).expanduser() if current else None
    activate_app = (
        "try\n"
        f"tell application {applescript_string('Grok Chameleon')} to activate\n"
        "on error\n"
        "tell application \"Finder\" to activate\n"
        "end try\n"
        "delay 0.1\n"
    )
    if current_path and current_path.is_dir():
        script = (
            activate_app +
            f'set chosenFolder to choose folder with prompt {applescript_string(prompt)} '
            f'default location POSIX file {applescript_string(str(current_path))}\n'
            "return POSIX path of chosenFolder"
        )
    else:
        script = (
            activate_app +
            f'set chosenFolder to choose folder with prompt {applescript_string(prompt)}\n'
            "return POSIX path of chosenFolder"
        )
    result = subprocess.run(["osascript", "-e", script], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
    if result.returncode == 0:
        return result.stdout.strip() or None
    if "User canceled" in result.stderr or "(-128)" in result.stderr:
        return None
    raise RuntimeError(result.stderr.strip() or "Finder folder picker failed")


def choose_folder_in_windows(current: str = "", description: str = "Select a Library folder for Grok Chameleon") -> str | None:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        raise RuntimeError("PowerShell is required to select a library folder.")
    script = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); "
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$dialog.Description = $env:GROK_STUDIO_PICKER_DESCRIPTION; "
        "$dialog.ShowNewFolderButton = $true; "
        "$current = $env:GROK_STUDIO_PICKER_CURRENT; "
        "if ($current -and (Test-Path -LiteralPath $current -PathType Container)) { $dialog.SelectedPath = $current }; "
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }"
    )
    env = os.environ.copy()
    env["GROK_STUDIO_PICKER_CURRENT"] = current
    env["GROK_STUDIO_PICKER_DESCRIPTION"] = description
    result = subprocess.run([powershell, "-NoProfile", "-STA", "-Command", script], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=300, env=env)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Windows folder picker failed")
    return result.stdout.strip() or None


def choose_library_folder(current: str = "") -> str | None:
    if os.name == "nt":
        return choose_folder_in_windows(current)
    if sys.platform == "darwin":
        return choose_folder_in_finder(current)
    raise RuntimeError("Native folder selection is supported on Windows and macOS.")


def choose_download_folder(current: str = "") -> str | None:
    current = current or str(Path.home() / "Downloads")
    prompt = "Select a folder for Grok Studio downloads"
    if os.name == "nt":
        return choose_folder_in_windows(current, prompt)
    if sys.platform == "darwin":
        return choose_folder_in_finder(current, prompt)
    return choose_library_folder(current)


def windows_explorer_window_handles() -> set[int]:
    if os.name != "nt":
        return set()
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    enum_callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    handles: set[int] = set()
    explorer_classes = {"CabinetWClass", "ExploreWClass"}

    @enum_callback
    def collect(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        class_name = ctypes.create_unicode_buffer(256)
        if user32.GetClassNameW(hwnd, class_name, len(class_name)) and class_name.value in explorer_classes:
            handles.add(int(hwnd))
        return True

    user32.EnumWindows(collect, 0)
    return handles


def center_windows_explorer_window(previous_handles: set[int] | None = None) -> None:
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)

    class Rect(ctypes.Structure):
        _fields_ = [
            ("left", wintypes.LONG),
            ("top", wintypes.LONG),
            ("right", wintypes.LONG),
            ("bottom", wintypes.LONG),
        ]

    previous = set(previous_handles or ())
    target = 0
    for _ in range(40):
        time.sleep(0.1)
        current = windows_explorer_window_handles()
        foreground = int(user32.GetForegroundWindow() or 0)
        new_handles = [handle for handle in current if handle not in previous]
        if foreground in current:
            target = foreground
            break
        if new_handles:
            target = new_handles[-1]
            break
    if not target:
        log_event("open_library_folder_center_skipped platform=windows reason=window_not_found")
        return

    window_rect = Rect()
    work_area = Rect()
    if not user32.GetWindowRect(target, ctypes.byref(window_rect)):
        return
    if not user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(work_area), 0):
        return
    width = max(1, window_rect.right - window_rect.left)
    height = max(1, window_rect.bottom - window_rect.top)
    work_width = max(1, work_area.right - work_area.left)
    work_height = max(1, work_area.bottom - work_area.top)
    x = work_area.left + max(0, (work_width - width) // 2)
    y = work_area.top + max(0, (work_height - height) // 2)
    if user32.IsIconic(target):
        user32.ShowWindow(target, 9)
    user32.SetWindowPos(target, 0, x, y, 0, 0, 0x0001 | 0x0004 | 0x0010)
    log_event(f"open_library_folder_centered platform=windows hwnd={target} x={x} y={y}")


def open_library_folder(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    if sys.platform == "darwin":
        script = (
            f"set targetFolder to POSIX file {applescript_string(str(root))} as alias\n"
            "tell application \"Finder\"\n"
            "activate\n"
            "open targetFolder\n"
            "delay 0.15\n"
            "try\n"
            "set folderWindow to front window\n"
            "set screenBounds to bounds of window of desktop\n"
            "set windowBounds to bounds of folderWindow\n"
            "set windowWidth to (item 3 of windowBounds) - (item 1 of windowBounds)\n"
            "set windowHeight to (item 4 of windowBounds) - (item 2 of windowBounds)\n"
            "set screenWidth to (item 3 of screenBounds) - (item 1 of screenBounds)\n"
            "set screenHeight to (item 4 of screenBounds) - (item 2 of screenBounds)\n"
            "set centeredX to ((item 1 of screenBounds) + ((screenWidth - windowWidth) / 2)) as integer\n"
            "set centeredY to ((item 2 of screenBounds) + ((screenHeight - windowHeight) / 2)) as integer\n"
            "set centeredRight to centeredX + windowWidth\n"
            "set centeredBottom to centeredY + windowHeight\n"
            "set bounds of folderWindow to {centeredX, centeredY, centeredRight, centeredBottom}\n"
            "end try\n"
            "end tell\n"
        )
        subprocess.Popen(["osascript", "-e", script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif os.name == "nt":
        previous_handles = windows_explorer_window_handles()
        subprocess.Popen(["explorer", str(root)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        threading.Thread(
            target=center_windows_explorer_window,
            args=(previous_handles,),
            name="center-library-explorer",
            daemon=True,
        ).start()
    else:
        opener = shutil.which("xdg-open")
        if not opener:
            raise RuntimeError("Folder opener is not available.")
        subprocess.Popen([opener, str(root)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"ok": True, "library_root": str(root)}


def read_exact(sock: socket.socket, size: int) -> bytes:
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("Chrome DevTools connection closed.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


class RawWebSocket:
    def __init__(self, url: str, timeout: float = 20, headers: dict[str, str] | None = None) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"ws", "wss"}:
            raise RuntimeError(f"Unsupported WebSocket URL: {url}")
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        self.path = parsed.path or "/"
        if parsed.query:
            self.path += "?" + parsed.query
        self.socket = socket.create_connection((self.host, self.port), timeout=timeout)
        if parsed.scheme == "wss":
            self.socket = ssl.create_default_context().wrap_socket(self.socket, server_hostname=self.host)
        self.socket.settimeout(timeout)
        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        request_headers = {
            "Host": self.host if self.port in {80, 443} else f"{self.host}:{self.port}",
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": key,
            "Sec-WebSocket-Version": "13",
            **(headers or {}),
        }
        request_lines = [f"GET {self.path} HTTP/1.1"]
        request_lines.extend(f"{name}: {value}" for name, value in request_headers.items() if value)
        request = "\r\n".join([
            *request_lines,
            "\r\n",
        ])
        self.socket.sendall(request.encode("utf-8"))
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.socket.recv(4096)
            if len(response) > 65536:
                break
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            status = response.split(b"\r\n", 1)[0].decode("iso-8859-1", errors="replace")
            raise RuntimeError(f"WebSocket handshake failed: {status}")

    def send_json(self, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        header = bytearray([0x81])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.extend([0x80 | 126, (length >> 8) & 255, length & 255])
        else:
            header.extend([0x80 | 127])
            header.extend(length.to_bytes(8, "big"))
        mask = secrets.token_bytes(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self.socket.sendall(bytes(header) + mask + masked)

    def recv_text(self) -> str | None:
        fragments = []
        while True:
            first, second = read_exact(self.socket, 2)
            fin = bool(first & 0x80)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            length = second & 0x7F
            if length == 126:
                length = int.from_bytes(read_exact(self.socket, 2), "big")
            elif length == 127:
                length = int.from_bytes(read_exact(self.socket, 8), "big")
            mask = read_exact(self.socket, 4) if masked else b""
            data = read_exact(self.socket, length) if length else b""
            if masked:
                data = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
            if opcode == 8:
                return None
            if opcode == 9:
                continue
            if opcode in {0, 1}:
                fragments.append(data)
                if fin:
                    return b"".join(fragments).decode("utf-8", errors="replace")

    def close(self) -> None:
        try:
            self.socket.close()
        except OSError:
            pass


def cdp_targets(port: int = IMAGINE_DEBUG_PORT) -> list[dict]:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("Chrome login window is not reachable yet. Open Imagine Login first.") from exc
    return data if isinstance(data, list) else []


def cdp_targets_optional(port: int) -> list[dict]:
    try:
        return cdp_targets(port)
    except Exception:
        return []


def imagine_bridge_profile_dir(root: Path, account: dict) -> Path:
    account_id_value = safe_name(str(account.get("id") or account.get("email") or "imagine"), "imagine")
    return root / "account" / "imagine_profiles" / account_id_value


def imagine_bridge_port(account: dict) -> int:
    key = str(account.get("id") or account.get("email") or "imagine").encode("utf-8", errors="ignore")
    digest = hashlib.sha256(key).hexdigest()
    return IMAGINE_BRIDGE_BASE_PORT + (int(digest[:8], 16) % IMAGINE_BRIDGE_PORT_SPAN)


def launch_imagine_bridge_browser(root: Path, account: dict, url: str) -> dict:
    profile_dir = imagine_bridge_profile_dir(root, account)
    profile_dir.mkdir(parents=True, exist_ok=True)
    port = imagine_bridge_port(account)
    imagine_debug_event("chrome_bridge_launch_blocked", {
        "port": port,
        "profile_dir": str(profile_dir),
        "url": url,
        "account_id": account.get("id") or "",
        "launched": False,
    })
    raise RuntimeError("External Chrome bridge is disabled. Use the native WebView bridge.")


def open_chrome_cdp_tab(port: int, url: str) -> None:
    try:
        request = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{quote(url, safe=':/?&=%')}", method="PUT")
        with urllib.request.urlopen(request, timeout=5):
            pass
    except Exception:
        pass


def find_imagine_bridge_target(port: int) -> dict | None:
    candidates = [
        target for target in cdp_targets_optional(port)
        if isinstance(target, dict)
        and isinstance(target.get("webSocketDebuggerUrl"), str)
        and "grok.com" in str(target.get("url") or "")
    ]
    candidates.sort(key=lambda item: (0 if "/imagine" in str(item.get("url") or "") else 1, str(item.get("url") or "")))
    return candidates[0] if candidates else None


def chrome_bridge_eval_value(target: dict, expression: str, timeout: float = 8):
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    if not ws_url:
        raise RuntimeError("Chrome bridge target is missing a DevTools URL.")
    result = cdp_call(
        ws_url,
        "Runtime.evaluate",
        {
            "expression": expression,
            "awaitPromise": True,
            "returnByValue": True,
        },
        timeout=timeout,
    )
    if result.get("exceptionDetails"):
        raise RuntimeError(f"Chrome bridge evaluation failed: {result.get('exceptionDetails')}")
    remote = result.get("result") if isinstance(result.get("result"), dict) else {}
    return remote.get("value")


def chrome_bridge_page_state(target: dict) -> dict:
    value = chrome_bridge_eval_value(
        target,
        "({ href: location.href, host: location.hostname, readyState: document.readyState })",
        timeout=5,
    )
    return value if isinstance(value, dict) else {}


def wait_imagine_bridge_ready(port: int, timeout_seconds: int = IMAGINE_BRIDGE_READY_WAIT_SECONDS) -> dict | None:
    deadline = time.time() + max(1, int(timeout_seconds))
    last_error = ""
    while time.time() < deadline:
        target = find_imagine_bridge_target(port)
        if not target:
            time.sleep(0.35)
            continue
        try:
            state = chrome_bridge_page_state(target)
            host = str(state.get("host") or "")
            ready = str(state.get("readyState") or "")
            if "grok.com" in host and ready in {"interactive", "complete"}:
                imagine_debug_event("chrome_bridge_ready", {
                    "port": port,
                    "url": state.get("href") or target.get("url") or "",
                    "ready_state": ready,
                })
                return target
        except Exception as exc:
            last_error = str(exc)[:500]
        time.sleep(0.35)
    imagine_debug_event("chrome_bridge_ready_timeout", {"port": port, "error": last_error})
    return find_imagine_bridge_target(port)


def chrome_bridge_login_probe(target: dict) -> dict:
    js = """
(async () => {
  try {
    const response = await fetch('/rest/media/post/list', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/plain, */*'
      },
      body: JSON.stringify({ limit: 1, source: 'MEDIA_POST_SOURCE_LIKED', safeForWork: false })
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      login: /login|sign in|signin/i.test(text.slice(0, 2000)),
      text: text.slice(0, 300)
    };
  } catch (error) {
    return { ok: false, status: 0, login: false, text: String(error && error.message || error || '') };
  }
})()
"""
    value = chrome_bridge_eval_value(target, js, timeout=12)
    return value if isinstance(value, dict) else {"ok": False, "status": 0, "login": False, "text": ""}


def close_imagine_bridge_browser(root: Path, account: dict) -> None:
    port = imagine_bridge_port(account)
    target = find_imagine_bridge_target(port)
    if not target:
        return
    try:
        cdp_call(str(target.get("webSocketDebuggerUrl")), "Browser.close", timeout=2)
        imagine_debug_event("chrome_bridge_close", {
            "port": port,
            "profile_dir": str(imagine_bridge_profile_dir(root, account)),
            "account_id": account.get("id") or "",
        })
    except Exception as exc:
        imagine_debug_event("chrome_bridge_close_failed", {"port": port, "error": str(exc)[:500]})


def native_bridge_store_id(account: dict) -> str:
    key = str(account.get("id") or account.get("email") or "imagine")
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"grok-chameleon-imagine:{key}"))


def native_bridge_is_available(max_age_seconds: float = 8.0) -> bool:
    with NATIVE_BRIDGE_LOCK:
        if NATIVE_BRIDGE_ACTIVE_IDS:
            return True
        return (time.time() - float(NATIVE_BRIDGE_LAST_POLL_AT or 0.0)) <= max_age_seconds


def native_bridge_wait_available(timeout_seconds: float = 8.0, max_age_seconds: float = 8.0) -> bool:
    deadline = time.time() + max(0.1, float(timeout_seconds))
    with NATIVE_BRIDGE_CONDITION:
        while time.time() < deadline:
            if NATIVE_BRIDGE_ACTIVE_IDS:
                return True
            if (time.time() - float(NATIVE_BRIDGE_LAST_POLL_AT or 0.0)) <= max_age_seconds:
                return True
            NATIVE_BRIDGE_CONDITION.wait(timeout=max(0.05, min(0.25, deadline - time.time())))
    return native_bridge_is_available(max_age_seconds=max_age_seconds)


def native_bridge_next_command(payload: dict) -> dict:
    global NATIVE_BRIDGE_LAST_POLL_AT
    timeout = max(1.0, min(30.0, float((payload or {}).get("timeout") or 25)))
    deadline = time.time() + timeout
    with NATIVE_BRIDGE_CONDITION:
        NATIVE_BRIDGE_LAST_POLL_AT = time.time()
        NATIVE_BRIDGE_CONDITION.notify_all()
        while time.time() < deadline:
            if NATIVE_BRIDGE_COMMANDS:
                command = NATIVE_BRIDGE_COMMANDS.pop(0)
                command_id = str(command.get("id") or "")
                if command_id:
                    NATIVE_BRIDGE_ACTIVE_IDS.add(command_id)
                NATIVE_BRIDGE_LAST_POLL_AT = time.time()
                imagine_debug_event("native_bridge_command_sent", {
                    "id": command_id,
                    "type": command.get("type") or "",
                    "account_id": command.get("account_id") or "",
                })
                return {"ok": True, "command": command}
            NATIVE_BRIDGE_LAST_POLL_AT = time.time()
            NATIVE_BRIDGE_CONDITION.notify_all()
            NATIVE_BRIDGE_CONDITION.wait(timeout=max(0.05, min(1.0, deadline - time.time())))
        NATIVE_BRIDGE_LAST_POLL_AT = time.time()
        NATIVE_BRIDGE_CONDITION.notify_all()
    return {"ok": True, "command": None}


def native_bridge_result(payload: dict) -> dict:
    command_id = str((payload or {}).get("id") or "").strip()
    if not command_id:
        raise RuntimeError("Native bridge result id is missing.")
    with NATIVE_BRIDGE_CONDITION:
        NATIVE_BRIDGE_ACTIVE_IDS.discard(command_id)
        if command_id in NATIVE_BRIDGE_ASYNC_IDS:
            NATIVE_BRIDGE_ASYNC_IDS.discard(command_id)
        else:
            NATIVE_BRIDGE_RESULTS[command_id] = dict(payload or {})
        global NATIVE_BRIDGE_LAST_POLL_AT
        NATIVE_BRIDGE_LAST_POLL_AT = time.time()
        NATIVE_BRIDGE_CONDITION.notify_all()
    imagine_debug_event("native_bridge_result_received", {
        "id": command_id,
        "ok": bool((payload or {}).get("ok")),
        "error": str((payload or {}).get("error") or "")[:500],
    })
    return {"ok": True}


def native_bridge_send(command: dict, timeout_seconds: int) -> dict:
    command_id = str(command.get("id") or uuid.uuid4().hex)
    command["id"] = command_id
    deadline = time.time() + max(1, int(timeout_seconds))
    with NATIVE_BRIDGE_CONDITION:
        NATIVE_BRIDGE_COMMANDS.append(command)
        NATIVE_BRIDGE_CONDITION.notify_all()
        while time.time() < deadline:
            result = NATIVE_BRIDGE_RESULTS.pop(command_id, None)
            if result is not None:
                if not result.get("ok"):
                    raise RuntimeError(str(result.get("error") or "Native bridge command failed."))
                value = result.get("value")
                return value if isinstance(value, dict) else {}
            NATIVE_BRIDGE_CONDITION.wait(timeout=max(0.05, min(1.0, deadline - time.time())))
    with NATIVE_BRIDGE_CONDITION:
        NATIVE_BRIDGE_COMMANDS[:] = [item for item in NATIVE_BRIDGE_COMMANDS if item.get("id") != command_id]
        NATIVE_BRIDGE_ACTIVE_IDS.discard(command_id)
        NATIVE_BRIDGE_RESULTS.pop(command_id, None)
    raise RuntimeError("Native bridge did not respond in time.")


def native_bridge_send_async(command: dict) -> str:
    command_id = str(command.get("id") or uuid.uuid4().hex)
    command["id"] = command_id
    with NATIVE_BRIDGE_CONDITION:
        NATIVE_BRIDGE_COMMANDS.append(command)
        NATIVE_BRIDGE_ASYNC_IDS.add(command_id)
        NATIVE_BRIDGE_CONDITION.notify_all()
    return command_id


def native_bridge_account_command(root: Path, account: dict, command_type: str, extra: dict, timeout_seconds: int) -> dict:
    cookies = valid_imagine_cookies(account)
    command = {
        "type": command_type,
        "account_id": str(account.get("id") or ""),
        "account_email": str(account.get("email") or ""),
        "store_id": native_bridge_store_id(account),
        "url": IMAGINE_BASE + "/imagine",
        "cookies": cookies,
        **(extra or {}),
    }
    imagine_debug_event("native_bridge_command_queued", {
        "type": command_type,
        "account_id": command.get("account_id") or "",
        "store_id": command.get("store_id") or "",
        "timeout_seconds": timeout_seconds,
    })
    return native_bridge_send(command, timeout_seconds=timeout_seconds)


def native_bridge_account_command_async(root: Path, account: dict, command_type: str, extra: dict) -> str:
    cookies = valid_imagine_cookies(account)
    command = {
        "type": command_type,
        "account_id": str(account.get("id") or ""),
        "account_email": str(account.get("email") or ""),
        "store_id": native_bridge_store_id(account),
        "url": IMAGINE_BASE + "/imagine",
        "cookies": cookies,
        **(extra or {}),
    }
    command_id = native_bridge_send_async(command)
    imagine_debug_event("native_bridge_command_queued", {
        "type": command_type,
        "account_id": command.get("account_id") or "",
        "store_id": command.get("store_id") or "",
        "async": True,
        "command_id": command_id,
    })
    return command_id


def wait_imagine_bridge_login(
    port: int,
    timeout_seconds: int = IMAGINE_BRIDGE_LOGIN_WAIT_SECONDS,
    save_delay_seconds: int = IMAGINE_BRIDGE_LOGIN_SAVE_DELAY_SECONDS,
) -> tuple[dict | None, dict]:
    deadline = time.time() + max(1, int(timeout_seconds))
    last_probe: dict = {"ok": False, "status": 0, "login": False, "text": ""}
    while time.time() < deadline:
        target = wait_imagine_bridge_ready(port, timeout_seconds=3)
        if not target:
            time.sleep(0.5)
            continue
        try:
            probe = chrome_bridge_login_probe(target)
            last_probe = probe
            if probe.get("ok"):
                if save_delay_seconds > 0:
                    time.sleep(max(0, int(save_delay_seconds)))
                return target, probe
        except Exception as exc:
            last_probe = {"ok": False, "status": 0, "login": False, "text": str(exc)[:300]}
        time.sleep(1)
    return None, last_probe


def ensure_imagine_bridge_target(root: Path, account: dict, referer: str) -> tuple[dict, int, Path]:
    port = imagine_bridge_port(account)
    profile_dir = imagine_bridge_profile_dir(root, account)
    url = referer if referer and referer.startswith(IMAGINE_BASE) else IMAGINE_BASE + "/imagine"
    target = wait_imagine_bridge_ready(port, timeout_seconds=2)
    if target:
        probe = chrome_bridge_login_probe(target)
        if probe.get("ok"):
            return target, port, profile_dir
    if cdp_targets_optional(port):
        open_chrome_cdp_tab(port, url)
    else:
        launch_imagine_bridge_browser(root, account, url)
    target, probe = wait_imagine_bridge_login(port)
    if target:
        return target, port, profile_dir
    imagine_debug_event("chrome_bridge_login_needed", {
        "port": port,
        "profile_dir": str(profile_dir),
        "account_id": account.get("id") or "",
        "probe": probe,
    })
    raise RuntimeError("Imagine Chrome bridge needs login. Sign in to the opened Grok Chrome profile, then try again.")


def native_bridge_fetch_events(
    root: Path,
    account: dict,
    request_payload: dict,
    request_id: str,
    referer: str,
    max_wait_seconds: int,
    progress_callback=None,
    cancel_checker=None,
) -> tuple[list, set[str], set[str], str]:
    if not native_bridge_wait_available(timeout_seconds=8, max_age_seconds=60):
        raise RuntimeError("Native WebView bridge is not running. Launch Grok Chameleon.app.")
    if progress_callback:
        progress_callback(6, "running", {"action": "native_bridge", "request_id": request_id})
    value = native_bridge_account_command(
        root,
        account,
        "fetch_stream",
        {
            "request_id": request_id,
            "referer": referer,
            "url": referer if referer and referer.startswith(IMAGINE_BASE) else IMAGINE_BASE + "/imagine",
            "request_payload": request_payload,
            "max_wait_seconds": int(max_wait_seconds),
        },
        timeout_seconds=max(30, int(max_wait_seconds) + IMAGINE_BRIDGE_LOGIN_WAIT_SECONDS + 40),
    )
    status_code = int(value.get("status") or 0)
    events = value.get("events") if isinstance(value.get("events"), list) else []
    bridge_parent_ids: set[str] = set()
    bridge_baseline_ids: set[str] = set()
    canonical_container_id = (
        extract_imagine_post_id_from_text(value.get("canonicalContainerId"))
        or str(value.get("canonicalContainerId") or "").strip()
    )

    def add_bridge_id(target: set[str], raw_value) -> None:
        text = str(raw_value or "").strip()
        if not text:
            return
        target.add(extract_imagine_post_id_from_text(text) or text)

    for key in ("canonicalContainerId", "resolvedContainerId", "resolvedParentPostId", "sourceContainerId"):
        add_bridge_id(bridge_parent_ids, value.get(key))
    for raw_id in value.get("baselineIds") if isinstance(value.get("baselineIds"), list) else []:
        add_bridge_id(bridge_baseline_ids, raw_id)
    for event in events:
        if not isinstance(event, dict):
            continue
        for key in ("containerPostId", "rootPostId", "parentPostId", "originalPostId"):
            add_bridge_id(bridge_parent_ids, event.get(key))
    store_trace = value.get("storeTrace") if isinstance(value.get("storeTrace"), list) else []
    bridge_status = value.get("bridgeStatus") if isinstance(value.get("bridgeStatus"), dict) else {}
    imagine_debug_event("native_bridge_stream_done", {
        "request_id": request_id,
        "status_code": status_code,
        "ok": bool(value.get("ok", status_code < 400)),
        "event_count": len(events),
        "canonical_container_id": canonical_container_id,
        "elapsed_ms": value.get("elapsedMs"),
        "text": str(value.get("text") or "")[:500] if not value.get("ok", True) else "",
        "bridge_status": {
            "url": bridge_status.get("url"),
            "hasMediaStore": bridge_status.get("hasMediaStore"),
            "mediaStorePath": bridge_status.get("mediaStorePath"),
            "mediaStoreModule": bridge_status.get("mediaStoreModule"),
            "mediaStoreCount": bridge_status.get("mediaStoreCount"),
            "mediaStores": bridge_status.get("mediaStores"),
            "turbopackRuntimeCount": bridge_status.get("turbopackRuntimeCount"),
            "turbopackModuleCounts": bridge_status.get("turbopackModuleCounts"),
        },
        "store_trace_tail": store_trace[-120:],
        "store_trace_key_events": [
            entry for entry in store_trace
            if str((entry or {}).get("event") or "") in {
                "video_request_persistent_patch_ready",
                "video_request_final_patch_armed",
                "official_video_duration_arg_applied",
                "video_request_final_patch_applied",
                "video_request_final_patch_disarmed",
                "store_generation_ui_action_clicked",
                "store_generation_moderation_grace_start",
                "store_generation_moderation_grace_complete",
                "store_generation_candidate_still_in_progress",
                "store_generation_candidate_stable",
                "store_generation_poll_timeout",
            }
        ][-20:],
    })
    if status_code >= 400:
        raise RuntimeError(f"Imagine native bridge HTTP {status_code}: {str(value.get('text') or '')[:1000]}")
    for event in events:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")
        progress = imagine_event_numeric_progress(event)
        terminal = imagine_event_is_terminal_failure(event)
        if progress is not None and progress_callback:
            progress_callback(display_generation_progress(progress), "running", {"request_id": request_id, "progress_source": "native_bridge"})
        if progress is not None:
            imagine_debug_event("native_bridge_progress", {
                "request_id": request_id,
                "progress": progress,
                "terminal": terminal,
            })
        log_imagine_stream_event_if_needed(request_id, event, progress, terminal, "native_bridge")
    if not events:
        raise RuntimeError("Imagine native bridge response did not contain stream events.")
    return events, bridge_parent_ids, bridge_baseline_ids, canonical_container_id


def native_bridge_t2i_events(
    root: Path,
    account: dict,
    reset_payload: dict,
    create_payload: dict,
    request_id: str,
    max_wait_seconds: int,
    expected_count: int = 1,
    progress_callback=None,
    cancel_checker=None,
) -> list:
    if not native_bridge_wait_available(timeout_seconds=8, max_age_seconds=60):
        raise RuntimeError("Native WebView bridge is not running. Launch Grok Chameleon.app.")
    if progress_callback:
        progress_callback(6, "running", {"action": "t2i", "request_id": request_id, "progress_source": "native_bridge"})
    value = native_bridge_account_command(
        root,
        account,
        "t2i_ws",
        {
            "request_id": request_id,
            "url": IMAGINE_BASE + "/imagine/saved",
            "ws_url": IMAGINE_WS_URL,
            "reset_payload": reset_payload,
            "create_payload": create_payload,
            "max_wait_seconds": int(max_wait_seconds),
            "expected_count": int(expected_count),
        },
        timeout_seconds=max(30, int(max_wait_seconds) + IMAGINE_BRIDGE_LOGIN_WAIT_SECONDS + 40),
    )
    events = value.get("events") if isinstance(value.get("events"), list) else []
    imagine_debug_event("native_bridge_t2i_done", {
        "request_id": request_id,
        "event_count": len(events),
        "signal_seen": bool(value.get("signalSeen")),
        "elapsed_ms": value.get("elapsedMs"),
    })
    for event in events:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")
        progress = imagine_event_numeric_progress(event)
        if progress is not None and progress_callback:
            progress_callback(display_generation_progress(progress), "running", {"request_id": request_id, "action": "t2i", "progress_source": "native_bridge"})
        if progress is not None:
            imagine_debug_event("native_bridge_t2i_progress", {"request_id": request_id, "progress": progress})
            log_imagine_stream_event_if_needed(request_id, event, progress, imagine_event_is_terminal_failure(event), "native_bridge_t2i")
    if not events and not value.get("signalSeen"):
        raise RuntimeError(f"Imagine native bridge T2I did not emit a generation signal within {IMAGINE_DIRECT_FIRST_SIGNAL_SECONDS}s.")
    return events


def chrome_bridge_fetch_events(
    root: Path,
    account: dict,
    request_payload: dict,
    request_id: str,
    referer: str,
    max_wait_seconds: int,
    progress_callback=None,
    cancel_checker=None,
) -> list:
    target, port, profile_dir = ensure_imagine_bridge_target(root, account, referer)
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    body_json = json.dumps(request_payload, ensure_ascii=False)
    request_id_json = json.dumps(request_id)
    js = f"""
(async () => {{
  const requestId = {request_id_json};
  const body = {json.dumps(body_json)};
  const startedAt = Date.now();
  const events = [];
  const response = await fetch('/rest/app-chat/conversations/new', {{
    method: 'POST',
    credentials: 'include',
    headers: {{
      'content-type': 'application/json',
      'accept': 'text/event-stream, application/json, text/plain, */*',
      'x-xai-request-id': requestId
    }},
    body
  }});
  const status = response.status;
  if (!response.body) {{
    const text = await response.text();
    return {{ ok: response.ok, status, text, events, elapsedMs: Date.now() - startedAt }};
  }}
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';
  function pushLine(line) {{
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed === '[DONE]' || trimmed === 'data: [DONE]') return;
    let data = trimmed;
    if (data.startsWith('data:')) data = data.slice(5).trim();
    if (!data || !(data.startsWith('{{') || data.startsWith('['))) return;
    try {{
      events.push(JSON.parse(data));
    }} catch (error) {{
      events.push({{ text: data }});
    }}
  }}
  while (true) {{
    const next = await reader.read();
    if (next.done) break;
    const chunk = decoder.decode(next.value, {{ stream: true }});
    rawText += chunk;
    buffer += chunk;
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() || '';
    for (const line of lines) pushLine(line);
  }}
  buffer += decoder.decode();
  if (buffer) pushLine(buffer);
  return {{ ok: response.ok, status, text: rawText.slice(0, 4000), events, elapsedMs: Date.now() - startedAt }};
}})()
"""
    imagine_debug_event("chrome_bridge_stream_start", {
        "request_id": request_id,
        "port": port,
        "profile_dir": str(profile_dir),
        "target_url": target.get("url") or "",
        "max_wait_seconds": max_wait_seconds,
        "modelName": request_payload.get("modelName") if isinstance(request_payload, dict) else "",
    })
    if progress_callback:
        progress_callback(6, "running", {"action": "chrome_bridge", "request_id": request_id})
    result = cdp_call(
        ws_url,
        "Runtime.evaluate",
        {
            "expression": js,
            "awaitPromise": True,
            "returnByValue": True,
        },
        timeout=max(15, int(max_wait_seconds) + 30),
    )
    value = result.get("result", {}).get("value") if isinstance(result.get("result"), dict) else None
    if not isinstance(value, dict):
        raise RuntimeError("Imagine Chrome bridge did not return a response.")
    status_code = int(value.get("status") or 0)
    events = value.get("events") if isinstance(value.get("events"), list) else []
    imagine_debug_event("chrome_bridge_stream_done", {
        "request_id": request_id,
        "status_code": status_code,
        "ok": bool(value.get("ok")),
        "event_count": len(events),
        "elapsed_ms": value.get("elapsedMs"),
        "text": str(value.get("text") or "")[:500] if not value.get("ok") else "",
    })
    if status_code >= 400:
        raise RuntimeError(f"Imagine Chrome bridge HTTP {status_code}: {str(value.get('text') or '')[:1000]}")
    for event in events:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")
        progress = imagine_event_numeric_progress(event)
        terminal = imagine_event_is_terminal_failure(event)
        if progress is not None and progress_callback:
            progress_callback(display_generation_progress(progress), "running", {"request_id": request_id, "progress_source": "chrome_bridge"})
        if progress is not None:
            imagine_debug_event("chrome_bridge_progress", {
                "request_id": request_id,
                "progress": progress,
                "terminal": terminal,
            })
        log_imagine_stream_event_if_needed(request_id, event, progress, terminal, "chrome_bridge")
    if not events:
        raise RuntimeError("Imagine Chrome bridge response did not contain stream events.")
    return events


def chrome_bridge_t2i_events(
    root: Path,
    account: dict,
    reset_payload: dict,
    create_payload: dict,
    request_id: str,
    max_wait_seconds: int,
    expected_count: int = 1,
    progress_callback=None,
    cancel_checker=None,
) -> list:
    target, port, profile_dir = ensure_imagine_bridge_target(root, account, IMAGINE_BASE + "/imagine")
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    js = f"""
(async () => {{
  const wsUrl = {json.dumps(IMAGINE_WS_URL)};
  const requestId = {json.dumps(request_id)};
  const resetPayload = {json.dumps(reset_payload, ensure_ascii=False)};
  const createPayload = {json.dumps(create_payload, ensure_ascii=False)};
  const expectedCount = Math.max(1, Number({int(expected_count)}) || 1);
  const receiveLimit = expectedCount + 3;
  const startedAt = Date.now();
  const events = [];
  let signalSeen = false;
  let completedGraceStartedAt = 0;
  let lastCompletedCount = 0;
  const socket = new WebSocket(wsUrl);
  function push(raw) {{
    const text = typeof raw === 'string' ? raw : '';
    if (!text) return;
    if (text.slice(0, 32).includes('"type":"image"') || text.slice(0, 80).includes('"blob"')) {{
      signalSeen = true;
      return;
    }}
    try {{
      const parsed = JSON.parse(text);
      if (parsed && parsed.request_id === requestId) {{
        events.push(parsed);
        signalSeen = true;
      }}
    }} catch (error) {{}}
  }}
  await new Promise((resolve, reject) => {{
    const timer = setTimeout(() => reject(new Error('websocket open timeout')), 10000);
    socket.onopen = () => {{
      clearTimeout(timer);
      resolve();
    }};
    socket.onerror = () => {{
      clearTimeout(timer);
      reject(new Error('websocket error'));
    }};
  }});
  socket.onmessage = (event) => push(event.data);
  socket.send(JSON.stringify(resetPayload));
  await new Promise((resolve) => setTimeout(resolve, 250));
  socket.send(JSON.stringify(createPayload));
	  await new Promise((resolve) => {{
	    function done() {{
	      const completed = events.filter((event) => String(event.current_status || '').toLowerCase() === 'completed').length;
      const terminal = events.some((event) => {{
        const text = JSON.stringify(event || {{}}).toLowerCase();
        const status = String(event.current_status || event.status || '').toLowerCase();
        return status.includes('moderated')
          || status.includes('failed')
          || status.includes('error')
          || text.includes('content_policy_violation')
          || text.includes('content was moderated')
          || text.includes('rejected by content moderation');
      }});
	      if (terminal) return true;
	      if (completed >= receiveLimit) return true;
	      if (completed >= expectedCount) {{
	        if (completed !== lastCompletedCount) {{
	          lastCompletedCount = completed;
	          completedGraceStartedAt = Date.now();
	        }}
	        return completedGraceStartedAt && Date.now() - completedGraceStartedAt >= 2500;
	      }}
	      return false;
	    }}
    const timer = setInterval(() => {{
      if (done()) {{
        clearInterval(timer);
        resolve();
      }}
    }}, 250);
    socket.onclose = () => {{
      clearInterval(timer);
      resolve();
    }};
    socket.onerror = () => {{
      clearInterval(timer);
      resolve();
    }};
  }});
  try {{ socket.close(); }} catch (error) {{}}
  return {{ ok: true, events, signalSeen, elapsedMs: Date.now() - startedAt }};
}})()
"""
    imagine_debug_event("chrome_bridge_t2i_start", {
        "request_id": request_id,
        "port": port,
        "profile_dir": str(profile_dir),
        "target_url": target.get("url") or "",
        "max_wait_seconds": max_wait_seconds,
        "expected_count": expected_count,
        "receive_limit": expected_count + 3,
    })
    if progress_callback:
        progress_callback(6, "running", {"action": "t2i", "request_id": request_id, "progress_source": "chrome_bridge"})
    result = cdp_call(
        ws_url,
        "Runtime.evaluate",
        {
            "expression": js,
            "awaitPromise": True,
            "returnByValue": True,
        },
        timeout=max(15, int(max_wait_seconds) + 30),
    )
    value = result.get("result", {}).get("value") if isinstance(result.get("result"), dict) else None
    if not isinstance(value, dict):
        raise RuntimeError("Imagine Chrome bridge T2I did not return a response.")
    events = value.get("events") if isinstance(value.get("events"), list) else []
    imagine_debug_event("chrome_bridge_t2i_done", {
        "request_id": request_id,
        "event_count": len(events),
        "signal_seen": bool(value.get("signalSeen")),
        "elapsed_ms": value.get("elapsedMs"),
    })
    for event in events:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")
        progress = imagine_event_numeric_progress(event)
        if progress is not None and progress_callback:
            progress_callback(display_generation_progress(progress), "running", {"request_id": request_id, "action": "t2i", "progress_source": "chrome_bridge"})
        if progress is not None:
            imagine_debug_event("chrome_bridge_t2i_progress", {"request_id": request_id, "progress": progress})
            log_imagine_stream_event_if_needed(request_id, event, progress, imagine_event_is_terminal_failure(event), "chrome_bridge_t2i")
    if not events and not value.get("signalSeen"):
        raise RuntimeError("Imagine Chrome bridge T2I websocket closed before a generation signal.")
    return events


def cdp_call(ws_url: str, method: str, params: dict | None = None, timeout: float = 10) -> dict:
    ws = RawWebSocket(ws_url, timeout=max(2, timeout))
    try:
        ws.send_json({"id": 1, "method": method, "params": params or {}})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = ws.recv_text()
            if message is None:
                break
            try:
                parsed = json.loads(message)
            except json.JSONDecodeError:
                continue
            if parsed.get("id") != 1:
                continue
            if parsed.get("error"):
                raise RuntimeError(f"Chrome DevTools error: {parsed['error']}")
            result = parsed.get("result")
            return result if isinstance(result, dict) else {}
    finally:
        ws.close()
    raise RuntimeError("Chrome DevTools did not return a response.")


def find_imagine_cdp_target() -> dict:
    candidates = [
        target for target in cdp_targets()
        if isinstance(target, dict)
        and isinstance(target.get("webSocketDebuggerUrl"), str)
        and "grok.com" in str(target.get("url") or "")
    ]
    candidates.sort(key=lambda item: (0 if "/imagine" in str(item.get("url") or "") else 1, str(item.get("url") or "")))
    if not candidates:
        raise RuntimeError("Could not find a Chrome tab to capture. Open Imagine Login first.")
    return candidates[0]


def imagine_browser_executable() -> str | None:
    env_path = os.environ.get("GROK_STUDIO_CHROME") or os.environ.get("GROK_STUDIO_BROWSER")
    candidates = [env_path] if env_path else []
    if os.name == "nt":
        for root in [os.environ.get("LOCALAPPDATA"), os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)")]:
            if root:
                candidates.extend([
                    str(Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"),
                    str(Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
                ])
        names = ("chrome.exe", "msedge.exe", "chromium.exe")
    else:
        names = ("google-chrome", "chrome", "chromium", "chromium-browser", "microsoft-edge")
    for name in names:
        found = shutil.which(name)
        if found:
            candidates.append(found)
    for candidate in candidates:
        if candidate and Path(candidate).expanduser().is_file():
            return str(Path(candidate).expanduser())
    return None


def mac_main_screen_frame() -> tuple[int, int, int, int] | None:
    if sys.platform != "darwin":
        return None
    try:
        frame_text = subprocess.check_output(
            [
                "/usr/bin/osascript",
                "-l",
                "JavaScript",
                "-e",
                (
                    'ObjC.import("AppKit");'
                    "const f=$.NSScreen.mainScreen.frame;"
                    "[f.origin.x,f.origin.y,f.size.width,f.size.height].join(',')"
                ),
            ],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        x, y, width, height = [int(float(part.strip())) for part in frame_text.split(",")[:4]]
        if width > 0 and height > 0:
            return x, y, width, height
    except Exception:
        pass
    return None


def center_browser_window_on_main_screen(width: int, full_height: bool = False) -> tuple[int, int, int, int]:
    frame = mac_main_screen_frame()
    if not frame:
        return 120, 80, width, 760
    screen_left, screen_top, screen_width, screen_height = frame
    next_width = min(width, screen_width)
    next_height = screen_height if full_height else min(760, screen_height)
    next_left = screen_left + round((screen_width - next_width) / 2)
    return next_left, screen_top, next_width, next_height


def fit_chrome_front_window(left: int, top: int, width: int, height: int) -> None:
    if sys.platform != "darwin":
        return
    script = (
        "delay 0.8\n"
        'tell application "Google Chrome"\n'
        "  activate\n"
        f"  set bounds of front window to {{{left}, {top}, {left + width}, {top + height}}}\n"
        "end tell\n"
    )
    subprocess.Popen(["/usr/bin/osascript", "-e", script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def launch_imagine_browser(url: str) -> bool:
    IMAGINE_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    width, height = 960, 760
    left, top = 120, 80
    if sys.platform == "darwin":
        left, top, width, height = center_browser_window_on_main_screen(width, full_height=False)
    args = [
        f"--remote-debugging-port={IMAGINE_DEBUG_PORT}",
        f"--user-data-dir={IMAGINE_PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        f"--window-size={width},{height}",
        f"--window-position={left},{top}",
        "--new-window",
        url,
    ]
    if sys.platform == "darwin":
        subprocess.Popen(["/usr/bin/open", "-na", "Google Chrome", "--args", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        fit_chrome_front_window(left, top, width, height)
        return False
    browser = imagine_browser_executable()
    if browser:
        subprocess.Popen([browser, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return False
    webbrowser.open(url)
    return True


def close_imagine_browser() -> None:
    try:
        targets = cdp_targets()
        target = next((item for item in targets if isinstance(item, dict) and isinstance(item.get("webSocketDebuggerUrl"), str)), None)
        if target:
            try:
                cdp_call(str(target.get("webSocketDebuggerUrl")), "Browser.close", timeout=2)
            except Exception:
                pass
    except Exception:
        pass


def available_loopback_port(preferred: int = 0) -> int:
    if preferred:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(("127.0.0.1", preferred))
                return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def total_account_profile_dir(root: Path, session_id: str) -> Path:
    return root / "account" / "login_sessions" / safe_name(session_id, "session")


def launch_total_account_browser(url: str, profile_dir: Path, debug_port: int) -> None:
    profile_dir.mkdir(parents=True, exist_ok=True)
    width, height = 960, 760
    left, top = 120, 80
    if sys.platform == "darwin":
        left, top, width, height = center_browser_window_on_main_screen(width, full_height=True)
    args = [
        f"--remote-debugging-port={debug_port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        f"--window-size={width},{height}",
        f"--window-position={left},{top}",
        "--new-window",
        url,
    ]
    if sys.platform == "darwin":
        subprocess.Popen(["/usr/bin/open", "-na", "Google Chrome", "--args", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        fit_chrome_front_window(left, top, width, height)
        return
    browser = imagine_browser_executable()
    if not browser:
        raise RuntimeError("Chrome is required for Total Account registration.")
    subprocess.Popen([browser, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def find_total_account_target(debug_port: int, host_fragment: str = "grok.com") -> dict | None:
    candidates = [
        target for target in cdp_targets_optional(debug_port)
        if isinstance(target, dict)
        and isinstance(target.get("webSocketDebuggerUrl"), str)
        and host_fragment in str(target.get("url") or "")
    ]
    candidates.sort(key=lambda item: (0 if "/imagine" in str(item.get("url") or "") else 1, str(item.get("url") or "")))
    return candidates[0] if candidates else None


def wait_total_account_imagine_login(debug_port: int, timeout_seconds: int = 240) -> dict:
    deadline = time.monotonic() + max(1, timeout_seconds)
    last_probe = {}
    while time.monotonic() < deadline:
        target = find_total_account_target(debug_port, "grok.com")
        if target:
            try:
                last_probe = chrome_bridge_login_probe(target)
                if last_probe.get("ok"):
                    time.sleep(IMAGINE_BRIDGE_LOGIN_SAVE_DELAY_SECONDS)
                    return target
            except Exception as exc:
                last_probe = {"ok": False, "error": str(exc)[:240]}
        time.sleep(1)
    raise RuntimeError(f"Imagine login was not completed. {str(last_probe)[:240]}")


def capture_total_account_cookies(target: dict) -> list[dict]:
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    if not ws_url:
        raise RuntimeError("Could not reach the login window.")
    result = cdp_call(ws_url, "Network.getAllCookies", timeout=12)
    cookies = normalize_imagine_cookies(result.get("cookies") if isinstance(result.get("cookies"), list) else [])
    if not cookies:
        raise RuntimeError("No grok.com cookies were captured.")
    return cookies


def navigate_cdp_target(target: dict, url: str) -> None:
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    if not ws_url:
        raise RuntimeError("Could not navigate the login window.")
    cdp_call(ws_url, "Page.navigate", {"url": url}, timeout=5)


def close_cdp_browser(target: dict | None) -> None:
    if not isinstance(target, dict):
        return
    ws_url = str(target.get("webSocketDebuggerUrl") or "")
    if not ws_url:
        return
    try:
        cdp_call(ws_url, "Browser.close", timeout=2)
    except Exception:
        pass


def unique_file_name(parent: Path, preferred_stem: str, extension: str) -> str:
    base = safe_name(preferred_stem, "prompt")
    name = f"{base}.{extension}"
    index = 2
    while (parent / name).exists():
        name = f"{base}-{index}.{extension}"
        index += 1
    return name


def unique_media_file_name(parent: Path, preferred_stem: str, extension: str) -> str:
    base = safe_name(preferred_stem, "media")
    existing_stems = {
        file_stem(entry.name).casefold()
        for entry in parent.iterdir()
        if entry.is_file()
    }
    stem = base
    index = 2
    while stem.casefold() in existing_stems:
        stem = f"{base}-{index}"
        index += 1
    return f"{stem}.{extension}"


def unique_file_name_for_update(parent: Path, preferred_stem: str, extension: str, current_name: str = "") -> str:
    current = Path(str(current_name or "")).name
    base = safe_name(preferred_stem, "prompt")
    name = f"{base}.{extension}"
    if name == current:
        return current
    index = 2
    while (parent / name).exists():
        name = f"{base}-{index}.{extension}"
        if name == current:
            return current
        index += 1
    return name


def unique_directory_name(parent: Path, preferred: str) -> str:
    base = safe_name(preferred, "post")
    name = base
    index = 2
    while (parent / name).exists():
        name = f"{base}-{index}"
        index += 1
    return name


def safe_join(root: Path, rel_path: str) -> Path:
    root = root.resolve()
    target = (root / unquote(str(rel_path or ""))).resolve()
    if target != root and root not in target.parents:
        raise ValueError("Path is outside the library.")
    return target


def serializable_media_item(item: dict) -> dict:
    data = {
        "item_id": item.get("item_id") or media_item_key(item),
        "type": item.get("type") or media_type_for_name(item.get("file") or item.get("url") or "") or "image",
        "file": item.get("file") or "",
        "mime_type": item.get("mime_type") or "",
        "role": item.get("role") or "result",
        "url": item.get("url") or None,
    }
    for key in (
        "title",
        "prompt",
        "created_at",
        "updated_at",
        "model",
        "aspect_ratio",
        "duration",
        "relation",
        "source_type",
        "source",
        "source_item_id",
        "parent_item_id",
        "original_item_id",
        "root_item_id",
        "source_post_id",
        "parent_post_id",
        "original_post_id",
        "root_post_id",
        "source_url",
        "original_url",
        "media_url",
        "width",
        "height",
        "size",
        "duration_seconds",
        "reference_item_ids",
        "reference_urls",
        "upload_hash",
        "thumbnail",
        "thumbnail_url",
        "editor",
        "editor_save_target",
        "lucky",
        "lucky_reason",
    ):
        if item.get(key):
            data[key] = item.get(key)
    return data


def post_json_from_post(post: dict, **overrides) -> dict:
    items = overrides.get("items", post.get("items") or [])
    representative = overrides.get("representative") or post.get("representative") or (items[0].get("file") if items else "") or (items[0].get("url") if items else "") or ""
    return {
        "post_id": overrides.get("post_id", post.get("post_id")),
        "source": overrides.get("source", post.get("source")),
        "mode": overrides.get("mode", post.get("mode")),
        "title": overrides.get("title", post.get("title")),
        "prompt": overrides.get("prompt", post.get("prompt")),
        "original_prompt": overrides.get("original_prompt", post.get("original_prompt")),
        "created_at": overrides.get("created_at", post.get("created_at")),
        "updated_at": now_iso(),
        "model": overrides.get("model", post.get("model")),
        "group_id": overrides.get("group_id", post.get("group_id") or ""),
        "parent_id": overrides.get("parent_id", post.get("parent_id") or ""),
        "root_post_id": overrides.get("root_post_id", post.get("root_post_id") or ""),
        "original_post_id": overrides.get("original_post_id", post.get("original_post_id") or ""),
        "source_post_id": overrides.get("source_post_id", post.get("source_post_id") or ""),
        "split_from_post_id": overrides.get("split_from_post_id", post.get("split_from_post_id") or ""),
        "account_id": overrides.get("account_id", post.get("account_id") or ""),
        "account_email": overrides.get("account_email", post.get("account_email") or ""),
        "build_favorite": bool(overrides.get("build_favorite", post.get("build_favorite") or post.get("favorite") or post.get("liked") or False)),
        "favorite": bool(overrides.get("favorite", overrides.get("build_favorite", post.get("favorite") or post.get("build_favorite") or post.get("liked") or False))),
        "order": safe_int(overrides.get("order", post.get("order")), 0),
        "grid_slot": safe_int(overrides.get("grid_slot", post.get("grid_slot")), 0),
        "folder_path": overrides.get("folder_path", post.get("folder_path")),
        "collection": overrides.get("collection", post.get("collection")),
        "representative": representative,
        "items": [serializable_media_item(item) for item in items],
    }


def post_origin_key(post: dict) -> str:
    for key in ("split_from_post_id", "source_post_id", "group_id", "root_post_id", "original_post_id", "post_id"):
        if post.get(key):
            return str(post.get(key))
    return ""


def find_post(snapshot: dict, folder_path: str) -> dict | None:
    return next((post for post in snapshot.get("posts", []) if post.get("folder_path") == folder_path), None)


def copy_file_to_directory(source_dir: Path, file_name: str, target_dir: Path) -> str:
    if not file_name:
        return ""
    source = source_dir / file_name
    if not source.exists():
        return ""
    target_name = unique_file_name(target_dir, file_stem(file_name), extension_for(file_name) or "bin")
    shutil.copy2(source, target_dir / target_name)
    return target_name


def copy_thumbnail_to_directory(source_dir: Path, thumbnail_name: str, target_dir: Path) -> str:
    if not thumbnail_name:
        return ""
    source = source_dir / thumbnail_name
    if not source.exists():
        return ""
    target_name = unique_file_name(target_dir, file_stem(thumbnail_name), extension_for(thumbnail_name) or "jpg")
    shutil.copy2(source, target_dir / target_name)
    return target_name


def clean_option(value, fallback: str = "") -> str:
    return str(value or fallback).strip()


def option_seconds(value, default_value: int, min_value: int, max_value: int) -> int:
    raw = clean_option(value, str(default_value)).lower().rstrip("s")
    try:
        parsed = int(float(raw))
    except ValueError:
        parsed = default_value
    return max(min_value, min(max_value, parsed))


def option_float(value, default_value: float | None = None, min_value: float | None = None, max_value: float | None = None) -> float | None:
    raw = clean_option(value)
    if not raw:
        return default_value
    try:
        parsed = float(raw)
    except ValueError:
        return default_value
    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def option_count(value) -> int | None:
    raw = clean_option(value).lower()
    if not raw or raw == "auto":
        return None
    try:
        parsed = int(raw)
    except ValueError:
        return None
    return max(1, min(10, parsed))


def first_attachment(payload: dict, media_type: str) -> dict | None:
    for item in media_attachments(payload, media_type):
        return item
    return None


def media_attachments(payload: dict, media_type: str) -> list[dict]:
    attachments = payload.get("attachments") if isinstance(payload.get("attachments"), list) else []
    matches = []
    for item in attachments:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "").lower()
        name_type = media_type_for_name(item.get("name") or "")
        if item_type.startswith(f"{media_type}/") or name_type == media_type:
            matches.append(item)
    return matches


def file_to_data_url(path: Path, fallback_mime: str) -> str:
    if not path.is_file():
        raise RuntimeError("Attachment file is missing.")
    mime_type = mimetypes.guess_type(path.name)[0] or fallback_mime
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def attachment_source_value(attachment: dict, fallback_mime: str) -> str:
    for key in ("data_url", "url", "source_url", "object_url", "raw_url", "remote_url", "media_url", "mediaUrl"):
        value = str(attachment.get(key) or "").strip()
        if not value:
            continue
        if value.startswith("data:"):
            return value
        unwrapped = imagine_unwrap_remote_proxy(value)
        root = library_root()
        local_source = local_media_source_from_url(root, unwrapped) if root else None
        if local_source:
            return file_to_data_url(local_source, fallback_mime)
        if unwrapped.startswith("http://") or unwrapped.startswith("https://"):
            return unwrapped
        if value.startswith("/api/media"):
            local_source = local_media_source_from_url(root, value) if root else None
            if local_source:
                return file_to_data_url(local_source, fallback_mime)
        if value.startswith("/"):
            continue
        return value
    return ""


def attachment_source(attachment: dict, field_type: str = "") -> dict:
    media_kind = "image" if field_type == "image_url" else str(attachment.get("type") or "").split("/", 1)[0].lower()
    fallback_mime = "video/mp4" if media_kind == "video" else "image/png"
    source = attachment_source_value(attachment, fallback_mime)
    if not source:
        raise RuntimeError("Attachment is empty.")
    data = {"url": source}
    if field_type:
        data["type"] = field_type
    return data


def image_model_from_option(value: str) -> str:
    return "grok-imagine-image" if clean_option(value).lower() == "speed" else "grok-imagine-image-quality"


def image_file_extension(item: dict) -> str:
    mime_type = str(item.get("mime_type") or item.get("mimeType") or "").lower()
    if "png" in mime_type:
        return "png"
    if "webp" in mime_type:
        return "webp"
    if "gif" in mime_type:
        return "gif"
    url_ext = extension_for(Path(urlparse(str(item.get("url") or "")).path).name)
    if url_ext in IMAGE_EXTS:
        return url_ext
    return "jpg"


def video_file_extension(item: dict) -> str:
    url = str((item.get("video") or {}).get("url") or item.get("url") or "")
    ext = extension_for(Path(urlparse(url).path).name)
    return ext if ext in VIDEO_EXTS else "mp4"


def xai_error_text(data) -> str:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            code = str(error.get("code") or "").strip()
            message = str(error.get("message") or "").strip()
            if code and message:
                return f"{code}: {message}"
            if message or code:
                return message or code
        for key in ("message", "detail"):
            message = str(data.get(key) or "").strip()
            if message:
                return message
        return json.dumps(data, ensure_ascii=False)[:1000]
    return str(data or "").strip()[:1000]


def xai_usage_limit_message(data) -> str:
    text = xai_error_text(data).lower()
    if isinstance(data, dict):
        try:
            text += " " + json.dumps(data, ensure_ascii=False).lower()
        except Exception:
            pass
    compact = re.sub(r"[^a-z0-9가-힣]+", "", text)
    if any(token in text for token in (
        "usage_pool_exhausted",
        "insufficient balance",
        "used up your media generation credits",
        "usage limit reached",
        "credits exhausted",
        "insufficient credits",
        "quota exceeded",
    )) or any(token in compact for token in (
        "usagepoolexhausted",
        "insufficientbalance",
        "usagelimitreached",
        "creditsexhausted",
        "insufficientcredits",
        "quotaexceeded",
    )):
        return "Usage Limit Reached"
    return ""


def build_generation_http_error_can_wait(exc: XaiApiError) -> bool:
    if exc.status_code == 403:
        return True
    if exc.status_code != 400:
        return False
    text = xai_error_text(exc.detail).lower()
    return any(token in text for token in (
        "moderation",
        "moderated",
        "rejected",
        "content",
        "policy",
        "safety",
        "forbidden",
    ))


def build_video_moderation_signal(data) -> bool:
    text = xai_error_text(data).lower()
    if isinstance(data, dict):
        try:
            text += " " + json.dumps(data, ensure_ascii=False).lower()
        except Exception:
            pass
    return any(token in text for token in (
        "content-moderated",
        "content moderated",
        "content moderation",
        "rejected by content moderation",
        "moderation",
        "moderated",
        "policy_violation",
        "content_policy_violation",
        "safety",
    ))


def hold_build_initial_http_error(
    action: str,
    exc: XaiApiError,
    started_at: float,
    seconds: int,
    progress_callback=None,
    cancel_checker=None,
) -> None:
    hold_started_at = time.time()
    deadline = max(float(started_at or hold_started_at) + max(0, int(seconds)), hold_started_at)
    wait_seconds = remaining_seconds_until(deadline, seconds)
    if wait_seconds <= 0:
        return
    log_event(
        "build_initial_http_error_hold_start "
        f"action={action} status={exc.status_code} wait={wait_seconds}s"
    )
    if progress_callback:
        progress_callback(
            elapsed_display_progress(hold_started_at, deadline, 1, 89),
            "running",
            {"action": action, "http_status": exc.status_code},
        )
    sleep_with_optional_cancel(wait_seconds, cancel_checker)
    log_event(
        "build_initial_http_error_hold_done "
        f"action={action} status={exc.status_code} wait={wait_seconds}s"
    )


def xai_json_request(
    method: str,
    path: str,
    api_key: str,
    payload: dict | None = None,
    timeout: int = 180,
    auth_refresh=None,
    retried: bool = False,
    retry_forbidden: bool = True,
) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{XAI_API_BASE}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            parsed_detail = json.loads(detail)
        except json.JSONDecodeError:
            parsed_detail = detail
        if (exc.code == 401 or (exc.code == 403 and retry_forbidden)) and auth_refresh and not retried:
            next_key = auth_refresh()
            if next_key:
                return xai_json_request(method, path, next_key, payload, timeout, auth_refresh, True, retry_forbidden)
        usage_limit_message = xai_usage_limit_message(parsed_detail)
        if usage_limit_message:
            log_event(f"xai_api_error method={method} path={path} status={exc.code} detail={usage_limit_message}")
            raise RuntimeError(usage_limit_message) from exc
        log_event(f"xai_api_error method={method} path={path} status={exc.code} detail={xai_error_text(parsed_detail)}")
        raise XaiApiError(exc.code, parsed_detail) from exc
    return json.loads(text) if text.strip() else {}


def download_remote_file(url: str, target: Path, api_key: str = "") -> None:
    headers = {"Accept": "*/*"}
    if "api.x.ai" in urlparse(url).netloc and api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=300) as response:
        target.write_bytes(response.read())


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem or "media"
    suffix = path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def download_file_name_from_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
        query = parse_qs(parsed.query)
        source = query.get("url", [""])[0]
        if source:
            return download_file_name_from_url(source)
        media_path = query.get("path", [""])[0] if parsed.path == "/api/media" else ""
        if media_path:
            return safe_name(Path(unquote(media_path)).name, "")
        return safe_name(Path(unquote(parsed.path)).name, "")
    except Exception:
        return safe_name(Path(raw.split("?", 1)[0]).name, "")


def download_fallback_extension(item: dict, url: str = "") -> str:
    name_ext = extension_for(download_file_name_from_url(url))
    if name_ext:
        return name_ext
    media_type = str(item.get("type") or "").lower()
    return "mp4" if media_type == "video" else "jpg"


def download_payload_filename(item: dict, url: str) -> str:
    ext = download_fallback_extension(item, url)
    candidates = [
        item.get("file"),
        download_file_name_from_url(url),
        item.get("title"),
        item.get("item_id"),
        item.get("id"),
    ]
    for candidate in candidates:
        name = safe_name(str(candidate or "").strip(), "")
        if name:
            if not extension_for(name) and ext:
                name = f"{name}.{ext}"
            return name
    return f"grok-media.{ext}"


def local_media_source_from_url(root: Path, url: str) -> Path | None:
    parsed = urlparse(str(url or ""))
    if parsed.path != "/api/media":
        return None
    rel_path = parse_qs(parsed.query).get("path", [""])[0]
    if not rel_path:
        return None
    target = safe_join(root, rel_path)
    return target if target.is_file() else None


def download_library_items(payload: dict) -> dict:
    payload = payload or {}
    raw_items = payload.get("items")
    items = [item for item in raw_items if isinstance(item, dict)] if isinstance(raw_items, list) else []
    if not items:
        raise RuntimeError("No items selected.")
    selected = choose_download_folder(str(payload.get("current") or ""))
    if selected is None:
        return {"ok": True, "cancelled": True, "count": 0, "failed_count": 0}
    output_dir = Path(selected).expanduser()
    if not output_dir.exists() or not output_dir.is_dir():
        raise RuntimeError("Selected download folder does not exist.")
    root = library_root()
    saved: list[dict] = []
    failed: list[dict] = []
    seen: set[str] = set()
    for item in items:
        url = str(item.get("url") or item.get("object_url") or item.get("media_url") or item.get("mediaUrl") or "").strip()
        key = url or str(item.get("item_id") or item.get("id") or item.get("file") or "")
        if not url or key in seen:
            continue
        seen.add(key)
        try:
            filename = download_payload_filename(item, url)
            target = unique_path(output_dir / filename)
            local_source = local_media_source_from_url(root, url) if root else None
            if local_source:
                shutil.copy2(local_source, target)
            elif url.startswith("data:"):
                target.write_bytes(decode_data_url(url))
            elif url.startswith("http://") or url.startswith("https://"):
                download_remote_file(url, target)
            else:
                raise RuntimeError("Unsupported download URL.")
            saved.append({"id": key, "path": str(target), "name": target.name})
        except Exception as exc:
            failed.append({"id": key, "error": str(exc)})
    if not saved and failed:
        raise RuntimeError(f"No items were downloaded. {failed[0]['error']}")
    return {
        "ok": True,
        "cancelled": False,
        "folder": str(output_dir),
        "count": len(saved),
        "failed_count": len(failed),
        "items": saved,
        "failed": failed[:20],
    }


def decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise RuntimeError("Invalid data URL.")
    _, encoded = data_url.split(",", 1)
    return base64.b64decode(encoded)


def save_image_response_item(item: dict, folder: Path, index: int, api_key: str) -> dict:
    ext = image_file_extension(item)
    file_name = unique_media_file_name(folder, f"image-{index:02d}", ext)
    target = folder / file_name
    if item.get("b64_json"):
        target.write_bytes(base64.b64decode(str(item.get("b64_json"))))
    elif item.get("url"):
        download_remote_file(str(item.get("url")), target, api_key)
    else:
        raise RuntimeError("Image response has no downloadable media.")
    return {
        "item_id": file_stem(file_name),
        "type": "image",
        "file": file_name,
        "mime_type": mimetypes.guess_type(file_name)[0] or f"image/{ext}",
        "role": "result",
        "url": item.get("url") or None,
    }


def build_video_response_url(response: dict) -> str:
    if not isinstance(response, dict):
        return ""
    video = response.get("video") if isinstance(response.get("video"), dict) else {}
    return str(video.get("url") or response.get("url") or "").strip()


def build_video_response_request_id(response: dict) -> str:
    if not isinstance(response, dict):
        return ""
    video = response.get("video") if isinstance(response.get("video"), dict) else {}
    return str(
        response.get("request_id")
        or response.get("id")
        or video.get("request_id")
        or video.get("id")
        or ""
    ).strip()


def save_video_response_item(response: dict, folder: Path, api_key: str) -> dict:
    video = response.get("video") if isinstance(response.get("video"), dict) else {}
    url = build_video_response_url(response)
    if not url:
        if video.get("respect_moderation") is False or response.get("respect_moderation") is False:
            raise RuntimeError("Video response was filtered by moderation.")
        raise RuntimeError(f"Video response has no downloadable media: {xai_error_text(response)}")
    ext = video_file_extension({"video": video, "url": url})
    file_name = unique_file_name(folder, "video", ext)
    download_remote_file(url, folder / file_name, api_key)
    return {
        "item_id": file_stem(file_name),
        "type": "video",
        "file": file_name,
        "mime_type": mimetypes.guess_type(file_name)[0] or "video/mp4",
        "role": "result",
        "url": url,
    }


def normalize_build_video_resolution(value) -> str:
    text = str(value or "").strip().lower()
    if text in {"480", "480p", "sd"}:
        return "480"
    if text in {"720", "720p", "hd"}:
        return "720"
    if text in {"1080", "1080p", "fullhd", "full_hd", "fhd"}:
        return "1080"
    return ""


def data_url_mime_type(data_url: str) -> str:
    head = str(data_url or "").split(",", 1)[0]
    if not head.startswith("data:"):
        return ""
    return head[5:].split(";", 1)[0].strip().lower()


def extension_from_mime_type(mime_type: str, fallback: str) -> str:
    mime = str(mime_type or "").lower()
    if "jpeg" in mime or "jpg" in mime:
        return "jpg"
    if "png" in mime:
        return "png"
    if "webp" in mime:
        return "webp"
    if "gif" in mime:
        return "gif"
    if "mp4" in mime:
        return "mp4"
    if "quicktime" in mime:
        return "mov"
    guessed = mimetypes.guess_extension(mime) or ""
    return guessed.lower().lstrip(".") or fallback


def attachment_media_extension(attachment: dict, media_type: str, data_url: str) -> str:
    name_ext = extension_for(attachment.get("name") or "")
    if media_type == "image" and name_ext in IMAGE_EXTS:
        return name_ext
    if media_type == "video" and name_ext in VIDEO_EXTS:
        return name_ext
    fallback = "mp4" if media_type == "video" else "jpg"
    ext = extension_from_mime_type(str(attachment.get("type") or "") or data_url_mime_type(data_url), fallback)
    if media_type == "image" and ext in IMAGE_EXTS:
        return ext
    if media_type == "video" and ext in VIDEO_EXTS:
        return ext
    return fallback


def build_attachment_role(attachment: dict, action: str, index: int, has_source: bool) -> str:
    raw_role = str(attachment.get("role") or "").strip().lower()
    if attachment.get("detail_auto") or raw_role in {"source", "input", "original", "start"}:
        return "source"
    if raw_role in {"reference", "ref"}:
        if action in {"i2i", "i2v"} and index == 0 and not has_source:
            return "source"
        return "reference"
    if action in {"i2i", "i2v"} and index == 0 and not has_source:
        return "source"
    return "reference"


def save_build_attachment_item(attachment: dict, folder: Path, index: int, role: str, media_type: str, api_key: str) -> dict:
    data_url = str(attachment.get("data_url") or attachment.get("url") or "").strip()
    if not data_url:
        raise RuntimeError("Attachment is empty.")
    ext = attachment_media_extension(attachment, media_type, data_url)
    original_stem = file_stem(attachment.get("name") or "") or f"{role}-{index:02d}"
    preferred_stem = safe_name(f"{role}-{index:02d}-{original_stem}"[:90], f"{role}-{index:02d}")
    file_name = unique_file_name(folder, preferred_stem, ext)
    target = folder / file_name
    if data_url.startswith("data:"):
        target.write_bytes(decode_data_url(data_url))
    elif data_url.startswith("http://") or data_url.startswith("https://"):
        download_remote_file(data_url, target, api_key)
    else:
        raise RuntimeError("Attachment source is unsupported.")
    mime_type = mimetypes.guess_type(file_name)[0] or str(attachment.get("type") or "") or f"{media_type}/{ext}"
    item = {
        "item_id": file_stem(file_name),
        "type": media_type,
        "file": file_name,
        "mime_type": mime_type,
        "role": role,
    }
    source_post_path = attachment.get("detail_post_path") or attachment.get("upload_post_path") or ""
    source_item_id = attachment.get("detail_item_id") or attachment.get("upload_item_id") or ""
    if source_post_path:
        item["source_post_path"] = source_post_path
    if source_item_id:
        item["source_item_id"] = source_item_id
    return item


def attachment_media_type_for_save(attachment: dict, fallback: str) -> str:
    item_type = str(attachment.get("type") or "").lower()
    if item_type.startswith("video/"):
        return "video"
    if item_type.startswith("image/"):
        return "image"
    name_type = media_type_for_name(attachment.get("name") or "")
    return name_type or fallback or "image"


def save_build_attachment_items(attachments: list[dict], folder: Path, action: str, media_type: str, api_key: str) -> list[dict]:
    saved = []
    has_source = any(
        bool(item.get("detail_auto"))
        or str(item.get("role") or "").strip().lower() in {"source", "input", "original", "start"}
        for item in attachments
    )
    for index, attachment in enumerate(attachments, start=1):
        role = build_attachment_role(attachment, action, index - 1, has_source)
        if role == "source":
            has_source = True
        try:
            current_media_type = attachment_media_type_for_save(attachment, media_type)
            saved.append(save_build_attachment_item(attachment, folder, index, role, current_media_type, api_key))
        except Exception as exc:
            log_event(f"build_attachment_save_failed media_type={attachment_media_type_for_save(attachment, media_type)} role={role} detail={exc}")
    return saved


def build_source_attachments(action: str, image_attachments: list[dict], video_attachment: dict | None) -> tuple[list[dict], str]:
    if action in {"extend", "video_edit"} and video_attachment:
        return [video_attachment, *image_attachments], "video"
    if action in {"i2i", "i2v"}:
        return image_attachments, "image"
    return [], "image"


def build_append_target(root: Path, action: str, source_attachments: list[dict]) -> tuple[Path, str] | None:
    if action not in {"i2i", "i2v", "extend", "video_edit"}:
        return None
    for attachment in source_attachments:
        rel_path = str(attachment.get("detail_post_path") or "").strip()
        if not rel_path:
            continue
        try:
            folder = safe_join(root, rel_path)
        except ValueError:
            continue
        if folder.is_dir() and (folder / "post.json").is_file():
            return folder, rel_path
    return None


def build_persist_attachments(source_attachments: list[dict], target_folder_path: str = "") -> list[dict]:
    if not target_folder_path:
        return source_attachments
    return [
        attachment for attachment in source_attachments
        if str(attachment.get("detail_post_path") or "").strip() != target_folder_path
    ]


def ensure_existing_source_items(existing_items: list[dict], source_attachments: list[dict], target_folder_path: str) -> list[dict]:
    items = [dict(item) for item in existing_items if isinstance(item, dict)]
    for attachment in source_attachments:
        if str(attachment.get("detail_post_path") or "").strip() != target_folder_path:
            continue
        file_name = Path(str(attachment.get("name") or "")).name
        item_id = str(attachment.get("detail_item_id") or file_stem(file_name) or "").strip()
        if not item_id and not file_name:
            continue
        media_type = media_type_for_name(file_name) or ("video" if str(attachment.get("type") or "").lower().startswith("video/") else "image")
        found = next((
            item for item in items
            if (item_id and str(item.get("item_id") or "") == item_id)
            or (file_name and str(item.get("file") or "") == file_name)
        ), None)
        if found:
            found["role"] = "source"
            if not found.get("mime_type") and attachment.get("type"):
                found["mime_type"] = attachment.get("type")
            continue
        item = {
            "item_id": item_id or file_stem(file_name),
            "type": media_type,
            "file": file_name,
            "mime_type": attachment.get("type") or mimetypes.guess_type(file_name)[0] or f"{media_type}/{extension_for(file_name)}",
            "role": "source",
        }
        items.append(item)
    return items


def source_video_display_model(action: str, existing_post: dict, source_attachments: list[dict], target_folder_path: str) -> str:
    if action not in {"extend", "video_edit"} or not isinstance(existing_post, dict):
        return ""
    items = existing_post.get("items") if isinstance(existing_post.get("items"), list) else []
    for attachment in source_attachments:
        if str(attachment.get("detail_post_path") or "").strip() != target_folder_path:
            continue
        item_id = str(attachment.get("detail_item_id") or "").strip()
        file_name = Path(str(attachment.get("name") or "")).name
        for item in items:
            if not isinstance(item, dict):
                continue
            if item_id and str(item.get("item_id") or "") != item_id:
                continue
            if not item_id and file_name and str(item.get("file") or "") != file_name:
                continue
            if str(item.get("type") or "").lower() == "video":
                return str(item.get("model") or item.get("model_label") or item.get("display_model") or "").strip()
    return ""


def build_request_record(endpoint: str, action: str, request_body: dict) -> dict:
    return {
        "endpoint": endpoint,
        "action": action,
        "body": redacted_build_body(request_body),
    }


def append_build_request_history(existing: dict, request_record: dict) -> list[dict]:
    history = existing.get("build_requests") if isinstance(existing.get("build_requests"), list) else []
    previous = existing.get("build_request") if isinstance(existing.get("build_request"), dict) else None
    next_history = list(history)
    if previous and previous not in next_history:
        next_history.append(previous)
    next_history.append(request_record)
    return next_history[-40:]


def build_image_request(payload: dict, options: dict, prompt: str, image_attachments: list[dict]) -> tuple[str, dict, str]:
    model = image_model_from_option(options.get("image_model") or options.get("image-model"))
    body = {
        "model": model,
        "prompt": prompt,
        "response_format": "b64_json",
    }
    resolution = clean_option(options.get("resolution"), "1k").lower()
    if resolution in IMAGE_RESOLUTIONS:
        body["resolution"] = resolution
    count = option_count(options.get("count"))
    if count:
        body["n"] = count
    if image_attachments:
        if len(image_attachments) > 3:
            raise RuntimeError("Image editing supports 1 to 3 input images.")
        images = [attachment_source(attachment, "image_url") for attachment in image_attachments]
        body["image" if len(images) == 1 else "images"] = images[0] if len(images) == 1 else images
        return "/images/edits", body, "i2i"
    aspect = clean_option(options.get("aspect_ratio") or options.get("aspect"), "auto").lower()
    if aspect in IMAGE_ASPECT_RATIOS:
        body["aspect_ratio"] = aspect
    return "/images/generations", body, "t2i"


def video_model_from_option(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^0-9.]", "", str(value or ""))
    if normalized == "1.0":
        return DEFAULT_VIDEO_MODEL
    if normalized == "1.5":
        return DEFAULT_IMAGE_TO_VIDEO_MODEL
    return fallback


def build_video_request(payload: dict, options: dict, prompt: str, image_attachments: list[dict], video_attachment: dict | None) -> tuple[str, dict, str]:
    mode = clean_option(payload.get("mode"), "video")
    if mode == "video_edit":
        if not video_attachment:
            raise RuntimeError("Video Edit needs one source video.")
        source_ext = extension_for(video_attachment.get("name") or "")
        source_type = str(video_attachment.get("type") or "").lower()
        if source_ext != "mp4" and source_type != "video/mp4":
            raise RuntimeError("Video Edit source video must be .mp4.")
        body = {
            "model": DEFAULT_VIDEO_MODEL,
            "prompt": prompt,
            "video": attachment_source(video_attachment),
        }
        return "/videos/edits", body, "video_edit"

    if mode == "extend":
        if not video_attachment:
            raise RuntimeError("Extend needs one source video.")
        source_ext = extension_for(video_attachment.get("name") or "")
        source_type = str(video_attachment.get("type") or "").lower()
        if source_ext != "mp4" and source_type != "video/mp4":
            raise RuntimeError("Extend source video must be .mp4.")
        duration = option_seconds(options.get("duration"), 6, 2, 10)
        body = {
            "model": DEFAULT_VIDEO_MODEL,
            "prompt": prompt,
            "duration": duration,
            "video": attachment_source(video_attachment),
        }
        source_trim_end = option_float(options.get("source_trim_end"), None, 0, None)
        if source_trim_end is not None:
            body["source_trim_end"] = round(source_trim_end, 3)
            body["source_trim_quality"] = clean_option(options.get("source_trim_quality"), "high") or "high"
        return "/videos/extensions", body, "extend"

    if video_attachment and not image_attachments:
        raise RuntimeError("Video mode uses image attachment for i2v. Use Extend for source video.")
    resolution = clean_option(options.get("resolution"), "").lower()
    if resolution in {"480", "720", "1080"}:
        resolution = f"{resolution}p"
    if len(image_attachments) > 7:
        raise RuntimeError("Reference-to-video accepts up to 7 images.")
    image_attachment_count = len(image_attachments)
    is_single_source_image = image_attachment_count == 1
    is_reference_video = image_attachment_count > 1
    default_model = DEFAULT_VIDEO_MODEL if is_reference_video else DEFAULT_IMAGE_TO_VIDEO_MODEL
    model = video_model_from_option(options.get("video_model") or options.get("video-model"), default_model)
    if is_reference_video:
        model = DEFAULT_VIDEO_MODEL
    duration = option_seconds(options.get("duration"), 6, 1, 15)
    if is_reference_video or (is_single_source_image and model == DEFAULT_VIDEO_MODEL):
        duration = min(duration, 10)
    if resolution == "1080p" and model == DEFAULT_VIDEO_MODEL:
        resolution = "720p"
    if resolution not in VIDEO_RESOLUTIONS:
        resolution = "720p" if model == DEFAULT_VIDEO_MODEL else "480p"
    body = {
        "model": model,
        "prompt": prompt,
        "duration": duration,
    }
    if is_single_source_image:
        body["image"] = attachment_source(image_attachments[0])
    elif image_attachments:
        body["reference_images"] = [attachment_source(attachment) for attachment in image_attachments]
    aspect = clean_option(options.get("aspect_ratio") or options.get("aspect"), "").lower()
    if aspect in VIDEO_ASPECT_RATIOS:
        body["aspect_ratio"] = aspect
    if resolution in VIDEO_RESOLUTIONS:
        body["resolution"] = resolution
    return "/videos/generations", body, "i2v" if image_attachments else "t2v"


def redacted_build_body(body: dict) -> dict:
    cleaned = json.loads(json.dumps(body))
    def redact_source(source: dict) -> None:
        if isinstance(source, dict) and str(source.get("url") or "").startswith("data:"):
            prefix = str(source["url"]).split(",", 1)[0]
            source["url"] = f"{prefix},<omitted>"
    for field in ("image", "video"):
        redact_source(cleaned.get(field))
    for field in ("images", "reference_images"):
        sources = cleaned.get(field)
        if isinstance(sources, list):
            for source in sources:
                redact_source(source)
    return cleaned


def redacted_build_response(data: dict) -> dict:
    cleaned = json.loads(json.dumps(data))
    for item in cleaned.get("data") or []:
        if isinstance(item, dict) and isinstance(item.get("b64_json"), str):
            item["b64_json"] = f"<omitted len={len(item['b64_json'])}>"
    return cleaned


def parse_analyze_result(value: str) -> tuple[str, str]:
    text = value.strip().replace("\r\n", "\n")
    text = re.sub(r"^```(?:text|markdown)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = re.sub(r"(?im)^\s*[*#_`]*English\s*:?\s*[*#_`]*\s*$", "English", text)
    text = re.sub(r"(?im)^\s*[*#_`]*Korean\s*:?\s*[*#_`]*\s*$", "Korean", text)
    match = re.search(r"(?is)^\s*English\s+(.*?)\s+Korean\s+(.*?)\s*$", text)
    if not match:
        return text.strip(), ""
    return match.group(1).strip(), match.group(2).strip()


def analyze_image(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    image = str(payload.get("image") or "").strip()
    if not image:
        raise RuntimeError("Choose an image in the detail screen or attach an image first.")
    model = str(payload.get("model") or DEFAULT_ANALYZE_MODEL).strip()
    if model not in ANALYZE_MODELS:
        raise RuntimeError("Unsupported Analyze model.")
    api_key_state = {"key": build_api_key(root)}

    def auth_refresh():
        api_key_state["key"] = build_api_key(root, force_refresh=True)
        return api_key_state["key"]

    request_body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Analyze this image and write a detailed, reusable image-generation prompt in English. "
                            "Then translate that prompt naturally into Korean. Describe visible subjects, setting, "
                            "composition, lighting, colors, camera perspective, and style without inventing hidden "
                            "facts. Return exactly this plain-text structure with no markdown fences:\n"
                            "English\n\n<English prompt>\n\nKorean\n\n<Korean translation>"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": image},
                    },
                ],
            }
        ],
    }
    result = xai_json_request(
        "POST",
        "/chat/completions",
        api_key_state["key"],
        request_body,
        timeout=180,
        auth_refresh=auth_refresh,
    )
    choices = result.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise RuntimeError("Analyze response did not contain a result.")
    message = choices[0].get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "\n".join(
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("text")
        )
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Analyze response did not contain text.")
    english, korean = parse_analyze_result(content)
    return {"english": english, "korean": korean, "model": model}


def numeric_progress(value) -> int | None:
    return numeric_percentage(value)


def build_video_attachment_resolution(attachment: dict | None) -> str:
    if not isinstance(attachment, dict):
        return ""
    metadata = attachment.get("metadata") if isinstance(attachment.get("metadata"), dict) else {}
    for value in (
        attachment.get("resolution_name"),
        attachment.get("resolutionName"),
        attachment.get("video_resolution"),
        attachment.get("resolution"),
        metadata.get("resolution_name"),
        metadata.get("resolutionName"),
        metadata.get("video_resolution"),
        metadata.get("resolution"),
    ):
        resolution = normalize_build_video_resolution(value)
        if resolution:
            return f"{resolution}p"
    return ""


def build_video_progress_resolution(request_body: dict | None = None, options: dict | None = None, video_attachment: dict | None = None) -> str:
    request_body = request_body if isinstance(request_body, dict) else {}
    options = options if isinstance(options, dict) else {}
    for value in (
        request_body.get("resolution"),
        options.get("resolution"),
        build_video_attachment_resolution(video_attachment),
    ):
        resolution = normalize_build_video_resolution(value)
        if resolution:
            return f"{resolution}p"
    return BUILD_VIDEO_DISPLAY_DEFAULT_RESOLUTION


def build_video_progress_duration(action: str, request_body: dict | None = None, options: dict | None = None, video_attachment: dict | None = None) -> float:
    request_body = request_body if isinstance(request_body, dict) else {}
    options = options if isinstance(options, dict) else {}
    values = [request_body.get("duration"), options.get("duration")]
    if action == "video_edit" and isinstance(video_attachment, dict):
        values.append(imagine_attachment_video_duration(video_attachment))
    for value in values:
        try:
            duration = float(str(value).lower().rstrip("s").strip())
        except (TypeError, ValueError):
            continue
        if duration > 0:
            return max(1.0, min(float(BUILD_VIDEO_DISPLAY_BASE_DURATION_SECONDS), duration))
    return float(BUILD_VIDEO_DISPLAY_BASE_DURATION_SECONDS)


def build_long_video_wait_policy(action: str, request_body: dict | None = None, options: dict | None = None, video_attachment: dict | None = None) -> bool:
    if action not in {"i2v", "video_edit", "extend"}:
        return False
    resolution = build_video_progress_resolution(request_body, options, video_attachment)
    duration = build_video_progress_duration(action, request_body, options, video_attachment)
    return resolution in {"720p", "1080p"} and duration >= 10


def build_video_max_wait_seconds(action: str, request_body: dict | None = None, options: dict | None = None, video_attachment: dict | None = None) -> int:
    if build_long_video_wait_policy(action, request_body, options, video_attachment):
        return BUILD_VIDEO_LONG_MAX_WAIT_SECONDS
    if action == "extend":
        return BUILD_VIDEO_EXTEND_MAX_WAIT_SECONDS
    return BUILD_VIDEO_GENERATE_MAX_WAIT_SECONDS


def build_video_display_seconds(action: str, request_body: dict | None = None, options: dict | None = None, video_attachment: dict | None = None) -> int:
    resolution = build_video_progress_resolution(request_body, options, video_attachment)
    duration = build_video_progress_duration(action, request_body, options, video_attachment)
    base_seconds = BUILD_VIDEO_DISPLAY_SECONDS_BY_RESOLUTION.get(
        resolution,
        BUILD_VIDEO_DISPLAY_SECONDS_BY_RESOLUTION[BUILD_VIDEO_DISPLAY_DEFAULT_RESOLUTION],
    )
    scaled_seconds = round(base_seconds * (duration / BUILD_VIDEO_DISPLAY_BASE_DURATION_SECONDS))
    return max(10, int(scaled_seconds))


def build_video_elapsed_display_progress(started_at: float | None, deadline: float | None) -> int:
    if started_at is None or deadline is None or deadline <= started_at:
        return 1
    ratio = max(0.0, min(1.0, (time.time() - started_at) / (deadline - started_at)))
    if ratio <= BUILD_VIDEO_INITIAL_DISPLAY_RATIO:
        phase_ratio = ratio / BUILD_VIDEO_INITIAL_DISPLAY_RATIO
        progress = 1 + ((BUILD_VIDEO_INITIAL_DISPLAY_PROGRESS - 1) * phase_ratio)
    elif ratio <= BUILD_VIDEO_MAIN_DISPLAY_RATIO:
        phase_ratio = (
            (ratio - BUILD_VIDEO_INITIAL_DISPLAY_RATIO)
            / (BUILD_VIDEO_MAIN_DISPLAY_RATIO - BUILD_VIDEO_INITIAL_DISPLAY_RATIO)
        )
        progress = BUILD_VIDEO_INITIAL_DISPLAY_PROGRESS + (
            (BUILD_VIDEO_MAIN_DISPLAY_PROGRESS - BUILD_VIDEO_INITIAL_DISPLAY_PROGRESS) * phase_ratio
        )
    else:
        phase_ratio = (ratio - BUILD_VIDEO_MAIN_DISPLAY_RATIO) / (1.0 - BUILD_VIDEO_MAIN_DISPLAY_RATIO)
        progress = BUILD_VIDEO_MAIN_DISPLAY_PROGRESS + (
            (BUILD_VIDEO_DISPLAY_MAX_PROGRESS - BUILD_VIDEO_MAIN_DISPLAY_PROGRESS) * phase_ratio
        )
    return max(1, min(BUILD_VIDEO_DISPLAY_MAX_PROGRESS, int(progress)))


def terminal_error_message(result: dict, fallback_status: str = "") -> str:
    usage_limit_message = xai_usage_limit_message(result)
    if usage_limit_message:
        return usage_limit_message
    status = str(result.get("status") or fallback_status or "failed").strip().lower()
    if status == "expired":
        return "Video request expired."
    if status in {"cancelled", "canceled"}:
        return "Video request canceled."
    return f"Video request failed: {xai_error_text(result)}"


def poll_video_request(
    api_key: str,
    request_id: str,
    action: str,
    interval_seconds: int = BUILD_VIDEO_TERMINAL_RECHECK_POLL_SECONDS,
    started_at: float | None = None,
    deadline: float | None = None,
    start_signal_deadline: float | None = None,
    display_deadline: float | None = None,
    display_end_progress: int = BUILD_VIDEO_DISPLAY_MAX_PROGRESS,
    auth_refresh=None,
    progress_callback=None,
    cancel_checker=None,
    initial_lucky_reason: str = "",
) -> dict:
    max_wait_seconds = build_video_max_wait_seconds(action)
    progress_started_at = started_at or time.time()
    deadline = deadline or (progress_started_at + max_wait_seconds)
    start_signal_deadline = start_signal_deadline or (progress_started_at + BUILD_VIDEO_START_SIGNAL_WAIT_SECONDS)
    display_deadline = display_deadline or deadline
    display_end_progress = max(1, min(98, int(display_end_progress or BUILD_VIDEO_DISPLAY_MAX_PROGRESS)))
    last_data = {}
    current_key = api_key
    last_status_marker = None
    max_progress_seen = 0
    terminal_result: dict | None = None
    terminal_recheck_deadline: float | None = None
    terminal_recheck_is_start_signal = False
    start_signal_wait_completed = False
    lucky_recovery_reason = str(initial_lucky_reason or "").strip()
    no_candidate_moderation_count = 0

    def refresh_current_key():
        nonlocal current_key
        current_key = auth_refresh() if auth_refresh else current_key
        return current_key

    def check_cancelled() -> None:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")

    def report_progress(progress: int | None, status: str, data: dict | None = None) -> None:
        if progress is None or not progress_callback:
            return
        progress_callback(progress, status, data or {})

    def note_progress(progress: int | None) -> None:
        nonlocal max_progress_seen
        if progress is not None:
            max_progress_seen = max(max_progress_seen, progress)

    def remember_lucky_reason(reason: str) -> None:
        nonlocal lucky_recovery_reason
        reason = str(reason or "").strip()
        if reason and not lucky_recovery_reason:
            lucky_recovery_reason = reason

    def mark_lucky_response(data: dict, reason: str) -> dict:
        if isinstance(data, dict) and reason:
            data["_lucky_recovery"] = True
            data["_lucky_reason"] = reason
        return data

    def note_no_candidate_moderation(result: dict, reason: str, status_label: str) -> dict | None:
        nonlocal no_candidate_moderation_count
        if not build_video_moderation_signal(result):
            return None
        no_candidate_moderation_count += 1
        log_event(
            "build_video_no_candidate_moderation_seen "
            f"request_id={request_id} action={action} reason={reason} status={status_label} "
            f"count={no_candidate_moderation_count}/{BUILD_VIDEO_NO_CANDIDATE_MODERATION_LIMIT}"
        )
        if no_candidate_moderation_count >= BUILD_VIDEO_NO_CANDIDATE_MODERATION_LIMIT:
            log_event(
                "build_video_no_candidate_moderation_stop "
                f"request_id={request_id} action={action} reason={reason} status={status_label} "
                f"count={no_candidate_moderation_count}"
            )
            raise RuntimeError(f"Video request failed: {xai_error_text(result)}")
        return None

    def after_90_terminal_deadline() -> float:
        return max(display_deadline + BUILD_VIDEO_AFTER_90_TERMINAL_GRACE_SECONDS, deadline)

    def recheck_cap_deadline() -> float:
        return min(deadline, after_90_terminal_deadline())

    def active_deadline() -> float:
        return terminal_recheck_deadline or deadline

    def build_video_display_progress(progress_value: int | None, fallback_progress: int | None = None) -> int:
        paced_progress = numeric_progress(fallback_progress)
        if paced_progress is None:
            paced_progress = build_video_elapsed_display_progress(progress_started_at, display_deadline)
        raw_progress = numeric_progress(progress_value)
        if raw_progress is None:
            return paced_progress
        if raw_progress < BUILD_VIDEO_INITIAL_DISPLAY_PROGRESS:
            return max(raw_progress, paced_progress)
        paced_progress = max(paced_progress, min(raw_progress, paced_progress + 10))
        return display_generation_progress(paced_progress, end_progress=display_end_progress)

    def begin_terminal_recheck(reason: str, result: dict, status_label: str) -> bool:
        nonlocal terminal_result, terminal_recheck_deadline, terminal_recheck_is_start_signal
        terminal_result = result
        if terminal_recheck_deadline is None:
            now = time.time()
            if now < start_signal_deadline and not start_signal_wait_completed:
                terminal_recheck_is_start_signal = True
                terminal_recheck_deadline = min(start_signal_deadline, recheck_cap_deadline())
                log_event(
                    "build_video_start_signal_wait_start "
                    f"request_id={request_id} action={action} status={status_label} reason={reason} "
                    f"progress={max_progress_seen} wait={remaining_seconds_until(terminal_recheck_deadline, BUILD_VIDEO_START_SIGNAL_WAIT_SECONDS)}s"
                )
            else:
                terminal_recheck_is_start_signal = False
                terminal_recheck_deadline = min(now + BUILD_VIDEO_TERMINAL_RECHECK_SECONDS, recheck_cap_deadline())
                event_name = "build_video_http_error_recheck_start" if reason == "http_error" else "build_video_terminal_recheck_start"
                log_event(
                    f"{event_name} request_id={request_id} action={action} status={status_label} "
                    f"progress={max_progress_seen} wait={remaining_seconds_until(terminal_recheck_deadline, BUILD_VIDEO_TERMINAL_RECHECK_SECONDS)}s"
                )
        return True

    def sleep_with_cancel(seconds: float) -> None:
        deadline = time.time() + max(0.0, seconds)
        while True:
            check_cancelled()
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            time.sleep(min(0.5, remaining))

    def get_status() -> dict:
        check_cancelled()
        data = xai_json_request(
            "GET",
            f"/videos/{quote(request_id)}",
            current_key,
            timeout=180,
            auth_refresh=refresh_current_key if auth_refresh else None,
        )
        build_video_debug_event("poll_response", {
            "request_id": request_id,
            "action": action,
            "response": data,
        })
        return data

    while True:
        check_cancelled()
        remaining = active_deadline() - time.time()
        if remaining <= 0:
            if terminal_result:
                if terminal_recheck_is_start_signal:
                    log_event(
                        "build_video_start_signal_wait_done "
                        f"request_id={request_id} action={action} progress={max_progress_seen}"
                    )
                    terminal_result = None
                    terminal_recheck_deadline = None
                    terminal_recheck_is_start_signal = False
                    start_signal_wait_completed = True
                    continue
                raise RuntimeError(terminal_error_message(terminal_result, str(terminal_result.get("status") or "")))
            raise RuntimeError(f"Video request timed out: {xai_error_text(last_data)}")
        try:
            data = get_status()
        except XaiApiError as exc:
            build_video_debug_event("poll_error", {
                "request_id": request_id,
                "action": action,
                "status_code": exc.status_code,
                "detail": exc.detail,
            })
            if exc.status_code not in {400, 403}:
                raise
            if isinstance(exc.detail, dict) and build_video_response_url(exc.detail):
                media_url = build_video_response_url(exc.detail)
                log_event(
                    "build_video_url_found_after_http_error "
                    f"request_id={request_id} action={action} status={exc.status_code} url={media_url}"
                )
                return mark_lucky_response(exc.detail, f"http_{exc.status_code}")
            if isinstance(exc.detail, dict):
                recovered = note_no_candidate_moderation(exc.detail, "http_error", str(exc.status_code))
                if recovered:
                    return recovered
            remember_lucky_reason(f"http_{exc.status_code}")
            error_result = {
                "status": "failed",
                "error": {"message": str(exc)},
            }
            if not begin_terminal_recheck("http_error", error_result, str(exc.status_code)):
                raise
            fallback_progress = build_video_elapsed_display_progress(progress_started_at, display_deadline)
            report_progress(
                build_video_display_progress(max_progress_seen or None, fallback_progress),
                "running",
                error_result,
            )
            sleep_with_cancel(min(max(0.1, interval_seconds), max(0.0, active_deadline() - time.time())))
            continue
        last_data = data
        status = str(data.get("status") or "").lower()
        media_url = build_video_response_url(data)
        if media_url:
            log_event(
                "build_video_url_found "
                f"request_id={request_id} action={action} status={status or 'unknown'} url={media_url}"
            )
            return mark_lucky_response(data, lucky_recovery_reason)
        progress = numeric_progress(data.get("progress"))
        note_progress(progress)
        status_marker = (status, progress)
        if status_marker != last_status_marker:
            log_event(f"build_video_status request_id={request_id} status={status or 'unknown'} progress={progress if progress is not None else '?'}")
            last_status_marker = status_marker
        if status in BUILD_VIDEO_TERMINAL_STATUSES:
            remember_lucky_reason(status or "terminal")
            recovered = note_no_candidate_moderation(data, "terminal", status)
            if recovered:
                return recovered
            if not begin_terminal_recheck("terminal", data, status):
                raise RuntimeError(terminal_error_message(data, status))
        else:
            if (
                terminal_recheck_deadline is not None
                and terminal_recheck_is_start_signal
                and progress is not None
                and progress > BUILD_VIDEO_START_SIGNAL_PROGRESS_LIMIT
            ):
                terminal_result = None
                terminal_recheck_deadline = None
                terminal_recheck_is_start_signal = False
                log_event(
                    "build_video_start_signal_seen "
                    f"request_id={request_id} action={action} progress={progress}"
                )
            elif terminal_recheck_deadline is None:
                terminal_result = None
        if status == "done":
            return data
        fallback_progress = build_video_elapsed_display_progress(progress_started_at, display_deadline)
        report_progress(
            build_video_display_progress(progress, fallback_progress),
            "running" if terminal_recheck_deadline is not None else (status or "running"),
            data,
        )
        sleep_with_cancel(min(max(0.1, interval_seconds), max(0.0, active_deadline() - time.time())))


def created_post_folder(root: Path, prompt: str) -> tuple[Path, str]:
    date_name = datetime.now().strftime("%Y-%m-%d")
    parent = root / "created" / date_name
    parent.mkdir(parents=True, exist_ok=True)
    preferred = f"build-{uuid.uuid4().hex[:12]}"
    folder_name = unique_directory_name(parent, preferred)
    folder = parent / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    return folder, f"created/{date_name}/{folder_name}"


def title_from_prompt(prompt: str, fallback: str) -> str:
    return next((line.strip() for line in prompt.splitlines() if line.strip()), fallback)[:80] or fallback


def build_generate(payload: dict, progress_callback=None, cancel_checker=None) -> dict:
    job_started_at = time.time()

    def check_cancelled() -> None:
        if cancel_checker and cancel_checker():
            raise JobCancelled("Job cancelled.")

    def report_progress(progress: int, status: str = "running", data: dict | None = None) -> None:
        check_cancelled()
        if progress_callback:
            progress_callback(max(0, min(100, int(progress))), status, data or {})

    def start_t2i_display_progress(model: str = "") -> threading.Event:
        stop_event = threading.Event()

        def run() -> None:
            started = time.monotonic()
            last_progress = 0
            while not stop_event.wait(0.2):
                if cancel_checker and cancel_checker():
                    break
                elapsed = min(14.0, max(0.0, time.monotonic() - started))
                progress = 1 + int((elapsed / 14.0) * 91)
                progress = max(1, min(92, progress))
                if progress != last_progress:
                    try:
                        report_progress(progress, "running", {"action": "t2i", "model": model, "progress_source": "display_timer"})
                    except JobCancelled:
                        break
                    last_progress = progress
                if elapsed >= 14.0:
                    break

        threading.Thread(target=run, name="build-t2i-display-progress", daemon=True).start()
        return stop_event

    def start_i2i_display_progress(model: str = "") -> threading.Event:
        stop_event = threading.Event()

        def run() -> None:
            started = time.monotonic()
            last_progress = 0
            while not stop_event.wait(0.2):
                if cancel_checker and cancel_checker():
                    break
                elapsed = min(14.0, max(0.0, time.monotonic() - started))
                progress = 1 + int((elapsed / 14.0) * 91)
                progress = max(1, min(92, progress))
                if progress != last_progress:
                    try:
                        report_progress(progress, "running", {"action": "i2i", "model": model, "progress_source": "display_timer"})
                    except JobCancelled:
                        break
                    last_progress = progress
                if elapsed >= 14.0:
                    break

        threading.Thread(target=run, name="build-i2i-display-progress", daemon=True).start()
        return stop_event

    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    report_progress(1)
    ensure_library_root(root)
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise RuntimeError("Prompt is empty.")
    mode = clean_option(payload.get("mode"), "image")
    if mode not in {"image", "video", "extend", "video_edit"}:
        raise RuntimeError("This Build mode is not connected yet.")

    api_key_state = {"key": build_api_key(root)}
    api_key_refresh_lock = threading.Lock()
    def auth_refresh():
        with api_key_refresh_lock:
            api_key_state["key"] = build_api_key(root, force_refresh=True)
            return api_key_state["key"]
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    image_attachments = media_attachments(payload, "image")
    video_attachment = first_attachment(payload, "video")

    if mode == "image":
        endpoint, request_body, action = build_image_request(payload, options, prompt, image_attachments)
        log_event(f"build_generate_start action={action} endpoint={endpoint} model={request_body.get('model') or ''}")
        t2i_display_stop = start_t2i_display_progress(request_body.get("model") or "") if action == "t2i" else None
        i2i_display_stop = start_i2i_display_progress(request_body.get("model") or "") if action == "i2i" else None
        if action not in {"t2i", "i2i"}:
            report_progress(8, "running", {"action": action, "model": request_body.get("model") or ""})
        if action == "t2i":
            expected_count = max(1, int(request_body.get("n") or 1))
            candidate_request_body = dict(request_body)
            candidate_request_body["n"] = 1
            request_record = build_request_record(endpoint, action, request_body)
            batch_id = f"build-t2i-{uuid.uuid4().hex[:12]}"
            selected_paths = []
            selected_item_id = ""
            partial_posts = []
            candidate_errors = []

            def request_t2i_candidate(candidate_index: int) -> tuple[int, dict, dict]:
                check_cancelled()
                log_event(
                    f"build_t2i_candidate_start candidate={candidate_index}/{expected_count} "
                    f"endpoint={endpoint} model={candidate_request_body.get('model') or ''}"
                )
                candidate_response = xai_json_request(
                    "POST",
                    endpoint,
                    api_key_state["key"],
                    dict(candidate_request_body),
                    timeout=BUILD_IMAGE_REQUEST_TIMEOUT_SECONDS,
                    auth_refresh=auth_refresh,
                )
                candidate_items = [item for item in (candidate_response.get("data") or []) if isinstance(item, dict)]
                if not candidate_items:
                    raise RuntimeError("No media was returned.")
                return candidate_index, candidate_response, candidate_items[0]

            try:
                worker_count = min(BUILD_T2I_MAX_CONCURRENT_REQUESTS, expected_count)
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    futures = {
                        executor.submit(request_t2i_candidate, candidate_index): candidate_index
                        for candidate_index in range(1, expected_count + 1)
                    }
                    for future in as_completed(futures):
                        candidate_index = futures[future]
                        check_cancelled()
                        try:
                            _, candidate_response, item = future.result()
                        except JobCancelled:
                            raise
                        except Exception as exc:
                            candidate_errors.append((candidate_index, exc))
                            log_event(
                                f"build_t2i_candidate_failed candidate={candidate_index}/{expected_count} "
                                f"detail={str(exc) or 'Build request failed.'}"
                            )
                            continue

                        with BUILD_T2I_FILE_LOCK:
                            check_cancelled()
                            folder, folder_path = created_post_folder(root, prompt)
                            saved_item = save_image_response_item(item, folder, 1, api_key_state["key"])
                            saved_path = folder / str(saved_item.get("file") or "")
                            saved_item["object_url"] = library_media_object_url(
                                f"{folder_path}/{saved_item.get('file') or ''}".strip("/"),
                                saved_path,
                            )
                            saved_item["prompt"] = prompt
                            saved_item["created_at"] = now_iso()
                            saved_item["model"] = request_body.get("model") or candidate_response.get("model") or ""
                            representative = saved_item.get("file") or ""
                            post_json = {
                                "post_id": Path(folder_path).name,
                                "source": "build",
                                "mode": action,
                                "title": title_from_prompt(prompt, action),
                                "prompt": prompt,
                                "created_at": now_iso(),
                                "updated_at": now_iso(),
                                "model": request_body.get("model") or candidate_response.get("model") or "",
                                "group_id": batch_id,
                                "folder_path": folder_path,
                                "collection": None,
                                "build_favorite": False,
                                "favorite": False,
                                "representative": representative,
                                "items": [saved_item],
                                "build_request": request_record,
                                "build_response": redacted_build_response(candidate_response),
                            }
                            write_json(folder / "post.json", post_json)
                        selected_paths.append(folder_path)
                        if not selected_item_id:
                            selected_item_id = saved_item.get("item_id") or ""
                        partial_posts.append(post_json)
                        completed_count = len(partial_posts)
                        progress = min(92, 1 + int((completed_count / expected_count) * 91))
                        report_progress(progress, "running", {
                            "action": action,
                            "completed_count": completed_count,
                            "expected_count": expected_count,
                            "partial_result": {
                                "posts": list(partial_posts),
                                "selected_paths": list(selected_paths),
                                "selected_item_id": selected_item_id,
                            },
                        })
                        log_event(
                            f"build_t2i_candidate_done candidate={candidate_index}/{expected_count} "
                            f"completed={completed_count}/{expected_count}"
                        )
            finally:
                if t2i_display_stop:
                    t2i_display_stop.set()

            if not selected_paths:
                if candidate_errors:
                    raise candidate_errors[0][1]
                raise RuntimeError("No media was returned.")
            if candidate_errors:
                log_event(
                    f"build_t2i_partial_success completed={len(selected_paths)}/{expected_count} "
                    f"failed={len(candidate_errors)}"
                )
            report_progress(99, "running", {
                "action": action,
                "completed_count": len(selected_paths),
                "expected_count": expected_count,
            })
            data = scan_library(root)
            data["selected_path"] = selected_paths[0]
            data["selected_paths"] = selected_paths
            data["selected_item_id"] = selected_item_id
            data["expected_count"] = expected_count
            data["failed_count"] = len(candidate_errors)
            return data
        try:
            response = xai_json_request(
                "POST",
                endpoint,
                api_key_state["key"],
                request_body,
                timeout=BUILD_IMAGE_REQUEST_TIMEOUT_SECONDS,
                auth_refresh=auth_refresh,
            )
        except XaiApiError:
            raise
        finally:
            if t2i_display_stop:
                t2i_display_stop.set()
            if i2i_display_stop:
                i2i_display_stop.set()
        report_progress(92 if action in {"t2i", "i2i"} else 88, "running", {"action": action})
        media_items = []
        for index, item in enumerate(response.get("data") or [], start=1):
            if isinstance(item, dict):
                media_items.append(item)
    else:
        endpoint, request_body, action = build_video_request(payload, options, prompt, image_attachments, video_attachment)
        video_wait_seconds = build_video_max_wait_seconds(action, request_body, options, video_attachment)
        video_deadline = job_started_at + video_wait_seconds
        video_display_seconds = build_video_display_seconds(action, request_body, options, video_attachment)
        video_display_deadline = job_started_at + video_display_seconds
        start_signal_deadline = job_started_at + BUILD_VIDEO_START_SIGNAL_WAIT_SECONDS
        log_event(
            f"build_generate_start action={action} endpoint={endpoint} model={request_body.get('model') or ''} "
            f"resolution={request_body.get('resolution') or build_video_attachment_resolution(video_attachment) or ''} "
            f"duration={request_body.get('duration') or options.get('duration') or ''} "
            f"wait={video_wait_seconds}s display={video_display_seconds}s"
        )
        report_progress(1, "running", {"action": action, "model": request_body.get("model") or ""})
        try:
            started = xai_json_request("POST", endpoint, api_key_state["key"], request_body, auth_refresh=auth_refresh, retry_forbidden=False)
        except XaiApiError as exc:
            build_video_debug_event("start_error", {
                "action": action,
                "endpoint": endpoint,
                "status_code": exc.status_code,
                "detail": exc.detail,
            })
            if exc.status_code not in {400, 403} or not isinstance(exc.detail, dict):
                raise
            media_url = build_video_response_url(exc.detail)
            request_id = build_video_response_request_id(exc.detail)
            if request_id:
                build_video_debug_event("start_error_request_id", {
                    "request_id": request_id,
                    "action": action,
                    "endpoint": endpoint,
                    "status_code": exc.status_code,
                    "detail": exc.detail,
                })
            if media_url:
                response = exc.detail
                response["_lucky_recovery"] = True
                response["_lucky_reason"] = f"start_http_{exc.status_code}"
                log_event(
                    "build_video_start_url_found_after_http_error "
                    f"action={action} status={exc.status_code} url={media_url}"
                )
                report_progress(89, "running", {"action": action})
            elif request_id:
                log_event(
                    "build_video_start_request_id_after_http_error "
                    f"request_id={request_id} action={action} status={exc.status_code} "
                    f"start_signal_wait={BUILD_VIDEO_START_SIGNAL_WAIT_SECONDS}s"
                )
                api_key_state["key"] = build_api_key(root)
                response = poll_video_request(
                    api_key_state["key"],
                    request_id,
                    action,
                    started_at=job_started_at,
                    deadline=video_deadline,
                    start_signal_deadline=start_signal_deadline,
                    display_deadline=video_display_deadline,
                    display_end_progress=BUILD_VIDEO_DISPLAY_MAX_PROGRESS,
                    auth_refresh=auth_refresh,
                    progress_callback=progress_callback,
                    cancel_checker=cancel_checker,
                    initial_lucky_reason=f"start_http_{exc.status_code}",
                )
                report_progress(90, "running", {"action": action, "request_id": request_id})
            else:
                if build_generation_http_error_can_wait(exc):
                    hold_build_initial_http_error(
                        action,
                        exc,
                        job_started_at,
                        BUILD_VIDEO_START_SIGNAL_WAIT_SECONDS,
                        progress_callback,
                        cancel_checker,
                    )
                raise
        else:
            request_id = str(started.get("request_id") or started.get("id") or "")
            build_video_debug_event("start_response", {
                "request_id": request_id,
                "action": action,
                "endpoint": endpoint,
                "response": started,
            })
            if not request_id:
                raise RuntimeError(f"Video request did not return request_id: {json.dumps(started, ensure_ascii=False)[:1000]}")
            api_key_state["key"] = build_api_key(root)
            response = poll_video_request(
                api_key_state["key"],
                request_id,
                action,
                started_at=job_started_at,
                deadline=video_deadline,
                start_signal_deadline=start_signal_deadline,
                display_deadline=video_display_deadline,
                display_end_progress=BUILD_VIDEO_DISPLAY_MAX_PROGRESS,
                auth_refresh=auth_refresh,
                progress_callback=progress_callback,
                cancel_checker=cancel_checker,
            )
            report_progress(90, "running", {"action": action, "request_id": request_id})
        media_items = [response]

    check_cancelled()
    api_key = build_api_key(root)
    source_attachments, source_media_type = build_source_attachments(action, image_attachments, video_attachment)
    append_target = build_append_target(root, action, source_attachments)
    if append_target:
        folder, folder_path = append_target
    else:
        folder, folder_path = created_post_folder(root, prompt)
    saved_input_items = save_build_attachment_items(
        build_persist_attachments(source_attachments, folder_path if append_target else ""),
        folder,
        action,
        source_media_type,
        api_key,
    )
    saved_result_items = []
    if mode == "image":
        for index, item in enumerate(media_items, start=1):
            report_progress(90 + min(6, index), "running", {"action": action})
            saved_result_items.append(save_image_response_item(item, folder, index, api_key))
    else:
        report_progress(94, "running", {"action": action})
        saved_result_items.append(save_video_response_item(media_items[0], folder, api_key))
    if not saved_result_items:
        raise RuntimeError("No media was returned.")
    lucky_reason = str(response.get("_lucky_reason") or "").strip() if isinstance(response, dict) and response.get("_lucky_recovery") else ""
    existing_post = read_json(folder / "post.json", {}) if append_target else {}
    source_model = source_video_display_model(action, existing_post, source_attachments, folder_path) if append_target else ""
    result_model = source_model or request_body.get("model") or response.get("model") or ""
    result_resolution = normalize_build_video_resolution(request_body.get("resolution") or options.get("resolution"))
    for item in saved_result_items:
        item["prompt"] = prompt
        item["created_at"] = now_iso()
        item["model"] = result_model
        if item.get("type") == "video" and result_resolution:
            item["resolution_name"] = result_resolution
            item["resolution"] = result_resolution
            item["video_resolution"] = result_resolution
        if lucky_reason and item.get("type") == "video":
            mark_lucky_media_item(item, lucky_reason)
    existing_items = existing_post.get("items") if isinstance(existing_post.get("items"), list) else []
    if append_target:
        existing_items = ensure_existing_source_items(existing_items, source_attachments, folder_path)
    saved_items = existing_items + saved_input_items + saved_result_items if append_target else saved_input_items + saved_result_items

    post_id = existing_post.get("post_id") or Path(folder_path).name
    representative = (next((item for item in saved_result_items if item.get("type") == "video"), None) or saved_result_items[-1]).get("file") or ""
    request_record = build_request_record(endpoint, action, request_body)
    post_json = {
        **existing_post,
        "post_id": post_id,
        "source": existing_post.get("source") or "build",
        "mode": existing_post.get("mode") or action,
        "title": existing_post.get("title") or title_from_prompt(prompt, action),
        "prompt": existing_post.get("prompt") or prompt,
        "created_at": existing_post.get("created_at") or now_iso(),
        "updated_at": now_iso(),
        "model": source_model or request_body.get("model") or response.get("model") or existing_post.get("model") or "",
        "folder_path": folder_path,
        "collection": existing_post.get("collection") if append_target else None,
        "build_favorite": bool(existing_post.get("build_favorite") or existing_post.get("favorite") or append_target),
        "favorite": bool(existing_post.get("favorite") or existing_post.get("build_favorite") or append_target),
        "representative": representative,
        "items": saved_items,
        "build_request": request_record,
        "build_response": redacted_build_response(response),
    }
    if append_target:
        post_json["build_requests"] = append_build_request_history(existing_post, request_record)
    write_json(folder / "post.json", post_json)
    report_progress(98, "running", {"action": action})
    data = scan_library(root)
    data["selected_path"] = folder_path
    data["selected_item_id"] = saved_result_items[0].get("item_id") or ""
    data["lucky"] = any(media_item_is_lucky(item) for item in saved_result_items)
    return data


def build_job_snapshot(job: dict) -> dict:
    allowed = {
        "id",
        "kind",
        "status",
        "progress",
        "prompt",
        "error",
        "result",
        "partial_result",
        "context",
        "created_at",
        "updated_at",
    }
    return {key: value for key, value in job.items() if key in allowed}


def build_job_kind(payload: dict) -> str:
    mode = clean_option(payload.get("mode"), "image")
    return "video" if mode in {"video", "extend", "video_edit"} else "image"


def build_job_context(payload: dict) -> dict:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    mode = clean_option(payload.get("mode"), "image")
    image_attachments = media_attachments(payload, "image")
    attachments = list(media_attachments(payload, "image")) + list(media_attachments(payload, "video"))
    source_post_path = str(payload.get("source_post_path") or "").strip()
    source_item_id = str(payload.get("source_item_id") or "").strip()
    if not source_post_path:
        source_post_path = next((str(item.get("detail_post_path") or "").strip() for item in attachments if item.get("detail_post_path")), "")
    if not source_item_id:
        source_item_id = next((str(item.get("detail_item_id") or "").strip() for item in attachments if item.get("detail_item_id")), "")
    context_mode = "t2i" if mode == "image" and not image_attachments else ("i2i" if mode == "image" else mode)
    aspect_ratio = normalize_aspect_ratio_value(options.get("aspect_ratio") or options.get("aspect"))
    if not aspect_ratio and context_mode in {"i2i", "i2v", "extend", "video_edit"}:
        aspect_ratio = payload_source_aspect_ratio(payload, "image") or payload_source_aspect_ratio(payload, "video")
    return {
        "provider": "build",
        "generation_provider": "build",
        "mode": context_mode,
        "preview_url": str(payload.get("preview_url") or ""),
        "preview_type": str(payload.get("preview_type") or build_job_kind(payload)),
        "source_post_path": source_post_path,
        "source_item_id": source_item_id,
        "aspect_ratio": aspect_ratio,
        "resolution": str(options.get("resolution") or ""),
        "count": str(options.get("count") or ""),
        "scroll_continuation": bool(payload.get("scroll_continuation")),
        "model": str(options.get("image_model") or options.get("image-model") or options.get("video_model") or options.get("video-model") or ""),
    }


def update_build_job(job_id: str, **updates) -> dict | None:
    with BUILD_JOB_LOCK:
        job = BUILD_JOBS.get(job_id)
        if not job:
            return None
        context = updates.pop("context", None)
        if isinstance(context, dict):
            current_context = job.get("context") if isinstance(job.get("context"), dict) else {}
            current_context.update({key: value for key, value in context.items() if value not in (None, "")})
            job["context"] = current_context
        if "progress" in updates:
            updates["progress"] = monotonic_job_progress(job.get("progress"), updates.get("progress"), str(updates.get("status") or job.get("status") or "running"))
        for key, value in updates.items():
            job[key] = value
        job["updated_at"] = now_iso()
        return build_job_snapshot(job)


def build_job_cancelled(job_id: str) -> bool:
    with BUILD_JOB_LOCK:
        job = BUILD_JOBS.get(job_id)
        return bool(job and job.get("cancel_requested"))


def classify_build_job_error(message: str) -> str:
    text = str(message or "").lower()
    if any(token in text for token in (
        "content_policy_violation",
        "moderation",
        "moderate",
        "image_query_rejected",
        "image query is not allowed",
        "policy_violation",
        "http 403",
        "forbidden",
        "rejection_reason",
        "safety",
    )):
        return "moderated"
    return "failed"


def start_build_job(payload: dict) -> dict:
    job_id = uuid.uuid4().hex[:16]
    now = now_iso()
    job = {
        "id": job_id,
        "kind": build_job_kind(payload),
        "status": "queued",
        "progress": 1,
        "prompt": str(payload.get("prompt") or "").strip(),
        "error": "",
        "result": None,
        "partial_result": None,
        "context": build_job_context(payload),
        "created_at": now,
        "updated_at": now,
        "cancel_requested": False,
    }
    with BUILD_JOB_LOCK:
        BUILD_JOBS[job_id] = job

    smooth_video_progress = job["kind"] == "video"
    video_progress_lock = threading.Lock()
    video_progress_stop = threading.Event()
    video_progress_target = 1
    video_progress_status = "running"
    video_progress_context: dict = {}

    def progress(progress: int, status: str = "running", data: dict | None = None) -> None:
        nonlocal video_progress_target, video_progress_status, video_progress_context
        context = {}
        if isinstance(data, dict):
            if data.get("action"):
                context["mode"] = data.get("action")
            if data.get("model"):
                context["model"] = data.get("model")
            if data.get("request_id"):
                context["request_id"] = data.get("request_id")
            for key in ("completed_count", "expected_count"):
                if key in data:
                    context[key] = data.get(key)
        partial_result = data.get("partial_result") if isinstance(data, dict) and isinstance(data.get("partial_result"), dict) else None
        if smooth_video_progress:
            with video_progress_lock:
                video_progress_target = max(video_progress_target, min(98, max(1, int(progress or 1))))
                video_progress_status = status or "running"
                video_progress_context.update(context)
            return
        update_build_job(
            job_id,
            status=status or "running",
            progress=progress,
            context=context,
            **({"partial_result": partial_result} if partial_result is not None else {}),
        )

    def run_video_progress() -> None:
        displayed = 1
        while not video_progress_stop.wait(0.5):
            with video_progress_lock:
                target = video_progress_target
                status = video_progress_status
                context = dict(video_progress_context)
            if displayed < target:
                gap = target - displayed
                displayed += max(1, (gap + BUILD_VIDEO_PROGRESS_SMOOTH_TICKS - 1) // BUILD_VIDEO_PROGRESS_SMOOTH_TICKS)
                displayed = min(displayed, target)
            update_build_job(job_id, status=status, progress=displayed, context=context)

    video_progress_thread = None
    if smooth_video_progress:
        video_progress_thread = threading.Thread(
            target=run_video_progress,
            name=f"build-video-progress-{job_id}",
            daemon=True,
        )
        video_progress_thread.start()

    def stop_video_progress() -> None:
        if not video_progress_thread:
            return
        video_progress_stop.set()
        video_progress_thread.join(timeout=1)

    def worker() -> None:
        update_build_job(job_id, status="running", progress=1)
        try:
            result = build_generate(payload, progress_callback=progress, cancel_checker=lambda: build_job_cancelled(job_id))
            stop_video_progress()
            update_build_job(job_id, status="done", progress=100, result=result)
        except JobCancelled:
            stop_video_progress()
            update_build_job(job_id, status="cancelled", progress=0, error="Job cancelled.")
        except Exception as exc:
            stop_video_progress()
            message = str(exc) or "Build request failed."
            status = classify_build_job_error(message)
            update_build_job(job_id, status=status, progress=max(1, int(job.get("progress") or 1)), error=message)
            log_event(f"build_job_failed id={job_id} status={status} detail={message}")

    thread = threading.Thread(target=worker, name=f"build-job-{job_id}", daemon=True)
    thread.start()
    return build_job_snapshot(job)


def get_build_job(job_id: str) -> dict:
    with BUILD_JOB_LOCK:
        job = BUILD_JOBS.get(job_id)
        if not job:
            raise RuntimeError("Build job was not found.")
        return build_job_snapshot(job)


def list_build_jobs() -> dict:
    with BUILD_JOB_LOCK:
        jobs = [build_job_snapshot(job) for job in BUILD_JOBS.values()]
    jobs.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return {"ok": True, "jobs": jobs}


def cancel_build_job(payload: dict) -> dict:
    job_id = str(payload.get("id") or "").strip()
    if not job_id:
        raise RuntimeError("Build job id is missing.")
    with BUILD_JOB_LOCK:
        job = BUILD_JOBS.get(job_id)
        if not job:
            raise RuntimeError("Build job was not found.")
        if job.get("status") in {"done", "failed", "moderated", "cancelled"}:
            return {"ok": True, "job": build_job_snapshot(job)}
        job["cancel_requested"] = True
        job["status"] = "cancelled"
        job["updated_at"] = now_iso()
        return {"ok": True, "job": build_job_snapshot(job)}


def dismiss_build_job(payload: dict) -> dict:
    job_id = str(payload.get("id") or "").strip()
    if not job_id:
        raise RuntimeError("Build job id is missing.")
    with BUILD_JOB_LOCK:
        BUILD_JOBS.pop(job_id, None)
    return {"ok": True}


def set_build_favorite(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    rel_path = str(payload.get("path") or "").strip()
    if not rel_path:
        raise RuntimeError("Post path is missing.")
    folder = safe_join(root, rel_path)
    post_path = folder / "post.json"
    with BUILD_T2I_FILE_LOCK:
        if not folder.is_dir() or not post_path.is_file():
            raise RuntimeError("Build post was not found.")
        meta = read_json(post_path, {})
        if not isinstance(meta, dict):
            meta = {}
        favorite = bool(payload.get("favorite"))
        meta["build_favorite"] = favorite
        meta["favorite"] = favorite
        meta["updated_at"] = now_iso()
        write_json(post_path, meta)
    data = scan_library(root)
    data["selected_path"] = rel_path
    return data


def permanent_delete_unfavorite_build_t2i(root: Path | None = None, cancel_active_jobs: bool = True) -> dict:
    target_root = (root or library_root())
    if not target_root:
        return {"deleted_count": 0, "deleted_file_count": 0, "deleted_bytes": 0, "failed": []}
    target_root = Path(target_root).resolve()
    created_root = (target_root / "created").resolve()
    if created_root == target_root or target_root not in created_root.parents or not created_root.is_dir():
        return {"deleted_count": 0, "deleted_file_count": 0, "deleted_bytes": 0, "failed": []}

    if cancel_active_jobs:
        with BUILD_JOB_LOCK:
            for job in BUILD_JOBS.values():
                if str(job.get("status") or "").lower() in {"done", "failed", "moderated", "cancelled", "canceled"}:
                    continue
                job["cancel_requested"] = True
                job["status"] = "cancelled"
                job["progress"] = 0
                job["error"] = "Job cancelled during app shutdown."
                job["updated_at"] = now_iso()

    def enabled(value) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    deleted_count = 0
    deleted_file_count = 0
    deleted_bytes = 0
    failed = []
    with BUILD_T2I_FILE_LOCK:
        post_files = sorted(created_root.rglob("post.json"), key=lambda path: str(path).casefold())
        for post_file in post_files:
            folder = post_file.parent.resolve()
            if folder == created_root or created_root not in folder.parents:
                continue
            meta = read_json(post_file, {})
            if not isinstance(meta, dict):
                continue
            if str(meta.get("source") or "").strip().lower() != "build":
                continue
            if str(meta.get("mode") or "").strip().lower() != "t2i":
                continue
            if any(enabled(meta.get(key)) for key in ("build_favorite", "favorite", "liked")):
                continue
            try:
                files = [path for path in folder.rglob("*") if path.is_file()]
                folder_bytes = sum(path.stat().st_size for path in files)
                shutil.rmtree(folder)
                deleted_count += 1
                deleted_file_count += len(files)
                deleted_bytes += folder_bytes
            except Exception as exc:
                failed.append({"path": str(folder), "error": str(exc)})

    result = {
        "deleted_count": deleted_count,
        "deleted_file_count": deleted_file_count,
        "deleted_bytes": deleted_bytes,
        "failed": failed,
    }
    log_event(
        f"build_t2i_exit_cleanup deleted={deleted_count} files={deleted_file_count} "
        f"bytes={deleted_bytes} failed={len(failed)}"
    )
    return result


def save_prompt(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    text = str(payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("Prompt text is empty.")
    title = str(payload.get("title") or "").strip() or text[:48].strip() or "Prompt"
    prompt_dir = root / "prompt"
    current_name = Path(str(payload.get("file_name") or "")).name
    file_name = unique_file_name_for_update(prompt_dir, title, "txt", current_name) if current_name else unique_file_name(prompt_dir, title, "txt")
    (prompt_dir / file_name).write_text(text + "\n", encoding="utf-8")
    if current_name and current_name != file_name:
        try:
            (prompt_dir / current_name).unlink()
        except FileNotFoundError:
            pass
    return scan_library(root)


def delete_prompt(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    file_name = Path(str(payload.get("file_name") or "")).name
    if file_name:
        try:
            (root / "prompt" / file_name).unlink()
        except FileNotFoundError:
            pass
    return scan_library(root)


def translate_prompt(payload: dict) -> dict:
    text = str(payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("Prompt content is empty.")
    target_language = str(payload.get("target_language") or "Korean").strip()
    if target_language not in {"Korean", "English"}:
        raise RuntimeError("Unsupported translation language.")
    target_code = "ko" if target_language == "Korean" else "en"
    request = urllib.request.Request(
        f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={target_code}&dt=t",
        data=urlencode({"q": text}).encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": "Grok Chameleon local translator",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read(1000).decode("utf-8", errors="replace")
        raise RuntimeError(f"Google translation HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Google translation network error: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Google translation returned an invalid response.") from exc
    segments = result[0] if isinstance(result, list) and result and isinstance(result[0], list) else []
    translation = "".join(
        str(segment[0])
        for segment in segments
        if isinstance(segment, list) and segment and isinstance(segment[0], str)
    ).strip()
    if not translation:
        raise RuntimeError("Google translation response did not contain text.")
    return {
        "translation": translation,
        "target_language": target_language,
        "provider": "Google Translate",
    }


def save_accounts(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    build = payload.get("build") if isinstance(payload.get("build"), dict) else default_build_auth()
    imagine = payload.get("imagine") if isinstance(payload.get("imagine"), dict) else default_imagine_auth()
    write_build_auth(root, build)
    write_imagine_auth(root, imagine)
    return scan_library(root)


def create_collection(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    name = safe_name(str(payload.get("name") or "").strip(), "")
    if not name:
        raise RuntimeError("Collection name is empty.")
    parent_path = str(payload.get("parent_path") or "").strip("/")
    if parent_path:
        parent = safe_join(root, parent_path)
        parent_parts = Path(parent_path).parts
        if not parent.is_dir() or len(parent_parts) != 2 or parent_parts[0] != "collection":
            raise RuntimeError("Select a collection.")
        folder_name = unique_directory_name(parent, name)
        target = parent / folder_name
        target.mkdir(parents=True, exist_ok=False)
        folder_path = f"{parent_path}/{folder_name}"
        write_json(target / "post.json", {
            "post_id": folder_name,
            "source": "local",
            "mode": "",
            "title": readable_name(folder_name),
            "prompt": "",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "folder_path": folder_path,
            "collection": parent_parts[1],
            "representative": "",
            "items": [],
        })
        data = scan_library(root)
        data["selected_collection_path"] = parent_path
        data["selected_collection_post_path"] = folder_path
        return data
    (root / "collection" / name).mkdir(parents=True, exist_ok=True)
    data = scan_library(root)
    data["selected_collection_path"] = f"collection/{name}"
    data["selected_collection_post_path"] = ""
    return data


def collection_target(root: Path, target_path: str) -> tuple[Path, tuple[str, ...]]:
    rel_path = str(target_path or "").strip("/")
    parts = Path(rel_path).parts
    if len(parts) < 2 or parts[0] != "collection":
        raise RuntimeError("Select a collection folder.")
    target = safe_join(root, rel_path)
    if not target.is_dir():
        raise RuntimeError("Selected collection folder was not found.")
    return target, parts


def refresh_collection_post_jsons(root: Path, folder: Path) -> None:
    for post_json in folder.rglob("post.json"):
        meta = read_json(post_json, {})
        if not isinstance(meta, dict):
            meta = {}
        rel_folder = post_json.parent.relative_to(root).as_posix()
        parts = Path(rel_folder).parts
        meta["folder_path"] = rel_folder
        if len(parts) >= 2 and parts[0] == "collection":
            meta["collection"] = parts[1]
        meta.setdefault("post_id", post_json.parent.name)
        if post_json.parent == folder:
            meta["title"] = readable_name(post_json.parent.name)
        else:
            meta.setdefault("title", readable_name(post_json.parent.name))
        meta["updated_at"] = now_iso()
        write_json(post_json, meta)


def rename_collection_folder(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    target, parts = collection_target(root, str(payload.get("target_path") or ""))
    name = safe_name(str(payload.get("name") or "").strip(), "")
    if not name:
        raise RuntimeError("Collection name is empty.")
    destination = target.parent / name
    if destination.exists() and destination != target:
        raise RuntimeError("A folder with that name already exists.")
    if destination != target:
        target.rename(destination)
    refresh_collection_post_jsons(root, destination)
    destination_path = destination.relative_to(root).as_posix()
    data = scan_library(root)
    if len(parts) == 2:
        data["selected_collection_path"] = destination_path
        data["selected_collection_post_path"] = ""
    else:
        data["selected_collection_path"] = destination.parent.relative_to(root).as_posix()
        data["selected_collection_post_path"] = destination_path
    return data


def delete_collection_folder(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    target, parts = collection_target(root, str(payload.get("target_path") or ""))
    parent_path = target.parent.relative_to(root).as_posix()
    move_path_to_trash(target)
    data = scan_library(root)
    if len(parts) > 2:
        data["selected_collection_path"] = parent_path
        data["selected_collection_post_path"] = ""
    else:
        data["selected_collection_path"] = ""
        data["selected_collection_post_path"] = ""
    return data


def save_collection_layout(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})

    primary_order = payload.get("primary_order")
    if isinstance(primary_order, list):
        valid_paths = []
        for raw_path in primary_order:
            rel_path = str(raw_path or "").strip("/")
            parts = Path(rel_path).parts
            if len(parts) == 2 and parts[0] == "collection" and safe_join(root, rel_path).is_dir():
                valid_paths.append(rel_path)
        settings["collection_order"] = valid_paths

    posts = payload.get("posts")
    if isinstance(posts, list):
        for entry in posts:
            if not isinstance(entry, dict):
                continue
            rel_path = str(entry.get("path") or "").strip("/")
            parts = Path(rel_path).parts
            if len(parts) < 3 or parts[0] != "collection":
                continue
            post_dir = safe_join(root, rel_path)
            if not post_dir.is_dir():
                continue
            meta_path = post_dir / "post.json"
            meta = read_json(meta_path, {})
            if not isinstance(meta, dict):
                meta = {}
            meta["folder_path"] = rel_path
            meta["collection"] = parts[1]
            meta.setdefault("post_id", post_dir.name)
            meta.setdefault("title", readable_name(post_dir.name))
            if "order" in entry:
                meta["order"] = max(0, safe_int(entry.get("order"), 0))
            if "grid_slot" in entry:
                meta["grid_slot"] = max(0, safe_int(entry.get("grid_slot"), 0))
            meta["updated_at"] = now_iso()
            write_json(meta_path, meta)

    collection_path = str(payload.get("collection_path") or "").strip("/")
    if "sort_mode" in payload:
        sort_map = settings.setdefault("collection_sort", {})
        if isinstance(sort_map, dict) and collection_path:
            sort_mode = str(payload.get("sort_mode") or "")
            if sort_mode:
                sort_map[collection_path] = sort_mode
            else:
                sort_map.pop(collection_path, None)

    library["updated_at"] = now_iso()
    write_json(library_path, library)
    data = scan_library(root)
    if collection_path:
        data["selected_collection_path"] = collection_path
    selected_post_path = str(payload.get("selected_collection_post_path") or "").strip("/")
    if selected_post_path:
        data["selected_collection_post_path"] = selected_post_path
    return data


def assert_deletable_library_path(root: Path, rel_path: str) -> Path:
    rel_path = str(rel_path or "").strip("/")
    if not rel_path:
        raise RuntimeError("Select a local item.")
    parts = Path(rel_path).parts
    if not parts or parts[0] not in LIBRARY_FOLDERS:
        raise RuntimeError("Selected item is outside the library.")
    if len(parts) == 1:
        raise RuntimeError("Library root folders cannot be deleted here.")
    target = safe_join(root, rel_path)
    if not target.exists():
        raise RuntimeError("Selected item was not found.")
    return target


def path_inside(parent: Path, child: Path) -> bool:
    parent = parent.resolve()
    child = child.resolve()
    return child == parent or parent in child.parents


def post_child_file(post_dir: Path, name: str) -> Path | None:
    if not name:
        return None
    target = (post_dir / str(name)).resolve()
    if not path_inside(post_dir, target):
        raise RuntimeError("Selected media path is outside the post folder.")
    return target


def move_post_item_file_to_trash(post_dir: Path, name: str, remaining_items: list[dict], moved: set[str]) -> None:
    if not name or any(item.get("file") == name or item.get("thumbnail") == name for item in remaining_items):
        return
    target = post_child_file(post_dir, name)
    if not target or str(target) in moved or not target.exists():
        return
    move_path_to_trash(target)
    moved.add(str(target))


def representative_for_remaining_items(items: list[dict]) -> str:
    if not items:
        return ""
    representative = representative_item(items, {}) or items[-1]
    return representative.get("file") or representative.get("url") or media_item_key(representative)


def media_item_reference_values(item: dict | None) -> set[str]:
    if not isinstance(item, dict):
        return set()
    values = {media_item_key(item)}
    for key in (
        "item_id",
        "file",
        "url",
        "object_url",
        "thumbnail",
        "thumbnail_url",
        "source_url",
        "original_url",
        "media_url",
    ):
        value = str(item.get(key) or "").strip()
        if value:
            values.add(value)
    return {value for value in values if value}


def clear_deleted_media_item_references(item: dict, deleted_values: set[str]) -> dict:
    cleaned = dict(item)
    for key in ("source_item_id", "parent_item_id", "original_item_id", "root_item_id"):
        if str(cleaned.get(key) or "").strip() in deleted_values:
            cleaned.pop(key, None)
    for key in ("reference_item_ids", "reference_urls"):
        values = cleaned.get(key)
        if isinstance(values, list):
            remaining = [value for value in values if str(value or "").strip() not in deleted_values]
            if remaining:
                cleaned[key] = remaining
            else:
                cleaned.pop(key, None)
    return cleaned


def result_media_item(item: dict) -> bool:
    role = str(item.get("role") or item.get("relation") or item.get("source_type") or "").lower()
    return not bool(re.search(r"(original|source|start|input|parent|reference|ref)", role))


def clear_source_role_for_reassignment(item: dict) -> None:
    role = str(item.get("role") or "").lower()
    if role in {"source", "original", "start", "input", "parent"}:
        item["role"] = "result"
    relation = str(item.get("relation") or "").lower()
    if relation in {"source", "original", "start", "input", "parent"}:
        item.pop("relation", None)
    source_type = str(item.get("source_type") or "").lower()
    if source_type in {"source", "original", "start", "input", "parent"}:
        item.pop("source_type", None)


def collection_selection_for_deleted_post(post: dict) -> tuple[str, str]:
    folder_path = str(post.get("folder_path") or "")
    parts = Path(folder_path).parts
    if len(parts) >= 3 and parts[0] == "collection":
        return "/".join(parts[:2]), ""
    return "", ""


def delete_library_post(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    snapshot = scan_library(root)
    post = find_post(snapshot, str(payload.get("post_path") or ""))
    if not post:
        raise RuntimeError("Selected post was not found.")
    target = assert_deletable_library_path(root, post.get("folder_path") or "")
    move_path_to_trash(target)
    data = scan_library(root)
    collection_path, collection_post_path = collection_selection_for_deleted_post(post)
    data["selected_path"] = ""
    data["selected_item_id"] = ""
    if collection_path:
        data["selected_collection_path"] = collection_path
        data["selected_collection_post_path"] = collection_post_path
    return data


def delete_library_item(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    snapshot = scan_library(root)
    post = find_post(snapshot, str(payload.get("post_path") or ""))
    item_key = str(payload.get("item_key") or "")
    if not post:
        raise RuntimeError("Selected post was not found.")
    selected_item = next((item for item in post.get("items", []) if media_item_key(item) == item_key), None)
    if not selected_item:
        raise RuntimeError("Selected media item was not found.")
    post_dir = assert_deletable_library_path(root, post.get("folder_path") or "")
    if not post_dir.is_dir():
        move_path_to_trash(post_dir)
        data = scan_library(root)
        data["selected_path"] = ""
        data["selected_item_id"] = ""
        return data

    deleted_values = media_item_reference_values(selected_item)
    remaining_items = [
        clear_deleted_media_item_references(item, deleted_values)
        for item in post.get("items", [])
        if media_item_key(item) != item_key
    ]
    if not remaining_items:
        move_path_to_trash(post_dir)
        data = scan_library(root)
        data["selected_path"] = ""
        data["selected_item_id"] = ""
        return data

    moved: set[str] = set()
    move_post_item_file_to_trash(post_dir, str(selected_item.get("file") or ""), remaining_items, moved)
    move_post_item_file_to_trash(post_dir, str(selected_item.get("thumbnail") or ""), remaining_items, moved)

    next_item = remaining_items[0]
    post_json = post_json_from_post(
        post,
        items=remaining_items,
        representative=representative_for_remaining_items(remaining_items),
    )
    write_json(post_dir / "post.json", post_json)
    data = scan_library(root)
    data["selected_path"] = post.get("folder_path") or ""
    data["selected_item_id"] = media_item_key(next_item)
    return data


def set_post_source_item(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    snapshot = scan_library(root)
    post = find_post(snapshot, str(payload.get("post_path") or ""))
    source_key = str(payload.get("source_item_key") or "")
    if not post:
        raise RuntimeError("Selected post was not found.")
    if not post.get("folder_path") or str(post.get("folder_path")).startswith("__"):
        raise RuntimeError("Select a local post.")
    source_item = next((item for item in post.get("items", []) if media_item_key(item) == source_key), None)
    if not source_item:
        raise RuntimeError("Select an image thumbnail to use as source.")
    source_type = source_item.get("type") or media_type_for_name(source_item.get("file") or source_item.get("url") or "")
    if source_type != "image":
        raise RuntimeError("Source must be an image.")
    post_dir = safe_join(root, post.get("folder_path") or "")
    if not post_dir.is_dir():
        raise RuntimeError("Selected post folder was not found.")

    source_item_id = media_item_key(source_item)
    updated_items = []
    for item in post.get("items") or []:
        next_item = serializable_media_item(item)
        if media_item_key(item) == source_item_id:
            next_item["role"] = "source"
            next_item.pop("source_item_id", None)
            next_item.pop("parent_item_id", None)
        else:
            clear_source_role_for_reassignment(next_item)
            next_item["source_item_id"] = source_item_id
            next_item["parent_item_id"] = source_item_id
        updated_items.append(next_item)

    post_json = post_json_from_post(
        post,
        items=updated_items,
        representative=post.get("representative") or representative_for_remaining_items(updated_items),
    )
    write_json(post_dir / "post.json", post_json)
    data = scan_library(root)
    data["selected_path"] = post.get("folder_path") or ""
    data["selected_item_id"] = source_item_id
    collection_path = collection_path_for_post_path(post.get("folder_path") or "")
    if collection_path:
        data["selected_collection_path"] = collection_path
        data["selected_collection_post_path"] = post.get("folder_path") or ""
    return data


def collection_path_for_post_path(folder_path: str) -> str:
    parts = Path(str(folder_path or "")).parts
    if len(parts) >= 2 and parts[0] == "collection":
        return "/".join(parts[:2])
    return ""


def validate_collection_destination(root: Path, collection_path: str) -> Path:
    collection_path = str(collection_path or "").strip("/")
    parts = Path(collection_path).parts
    if len(parts) < 2 or parts[0] != "collection":
        raise RuntimeError("Select a collection folder.")
    target = safe_join(root, collection_path)
    if not target.is_dir():
        raise RuntimeError("Selected collection folder was not found.")
    return target


def validate_collection_target_parent(root: Path, collection_path: str, target_parent_path: str = "") -> Path:
    collection_dir = validate_collection_destination(root, collection_path)
    target_parent_path = str(target_parent_path or "").strip("/")
    if not target_parent_path:
        return collection_dir
    if target_parent_path == collection_path:
        return collection_dir
    if not target_parent_path.startswith(f"{collection_path}/"):
        raise RuntimeError("Selected item folder is outside the category.")
    target_parent = safe_join(root, target_parent_path)
    if not target_parent.is_dir():
        raise RuntimeError("Selected item folder was not found.")
    return target_parent


def copy_media_item_to_directory(source_dir: Path, item: dict, target_dir: Path) -> dict:
    copied_file = copy_file_to_directory(source_dir, item.get("file") or "", target_dir) if item.get("file") else ""
    if item.get("file") and not copied_file and not item.get("url"):
        raise RuntimeError("Selected media file was not found.")
    copied_thumbnail = copy_thumbnail_to_directory(source_dir, item.get("thumbnail") or "", target_dir)
    return serializable_media_item({
        **item,
        "file": copied_file or item.get("file") or "",
        "thumbnail": copied_thumbnail or item.get("thumbnail") or "",
    })


def remote_imagine_payload_post(payload: dict) -> dict:
    post = payload.get("source_post")
    if not isinstance(post, dict):
        return {}
    area = str(post.get("area") or "").strip()
    return post if post.get("remote") or area in {"imagine_remote", "imagine_upload_remote"} else {}


def remote_imagine_item_url(item: dict) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine_meta = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    for key in ("object_url", "media_url", "url", "source_url", "original_url", "remote_url"):
        value = imagine_unwrap_remote_proxy(str(item.get(key) or ""))
        value = imagine_remote_url(value)
        if value:
            return value
    for key in ("media_url", "mediaUrl", "url", "source_url", "original_url", "remote_url"):
        value = imagine_unwrap_remote_proxy(str(metadata.get(key) or imagine_meta.get(key) or ""))
        value = imagine_remote_url(value)
        if value:
            return value
    return ""


def remote_imagine_thumbnail_url(item: dict) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    imagine_meta = metadata.get("imagine") if isinstance(metadata.get("imagine"), dict) else {}
    for key in ("thumbnail_url", "poster_url", "preview_url", "thumbnailImageUrl", "previewImageUrl"):
        value = imagine_unwrap_remote_proxy(str(item.get(key) or ""))
        value = imagine_remote_url(value)
        if value:
            return value
    for key in ("thumbnail_url", "poster_url", "preview_url", "thumbnailImageUrl", "previewImageUrl"):
        value = imagine_unwrap_remote_proxy(str(metadata.get(key) or imagine_meta.get(key) or ""))
        value = imagine_remote_url(value)
        if value:
            return value
    return ""


def write_imagine_remote_url_to_file(url: str, target: Path, account: dict, kind: str = "image") -> None:
    raw_url = imagine_remote_url(imagine_unwrap_remote_proxy(url))
    if not raw_url:
        raise RuntimeError("Remote media URL was not found.")
    if raw_url.startswith("data:"):
        header, _, data = raw_url.partition(",")
        if not data:
            raise RuntimeError("Remote media data is empty.")
        content = base64.b64decode(data) if ";base64" in header else unquote(data).encode("utf-8")
        target.write_bytes(content)
        return
    headers = {
        "Accept": "video/*,*/*" if kind == "video" else "image/*,video/*,*/*",
        "Referer": IMAGINE_BASE + "/imagine",
        "User-Agent": imagine_user_agent(),
    }
    cookies = valid_imagine_cookies(account)
    if cookies:
        headers["Cookie"] = cookie_header(cookies)
    request = urllib.request.Request(raw_url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=300) as response:
        target.write_bytes(response.read())


def copy_imagine_remote_item_to_directory(root: Path, item: dict, target_dir: Path, account: dict, index: int = 0) -> dict:
    media_url = remote_imagine_item_url(item)
    if not media_url:
        raise RuntimeError("Remote media URL was not found.")
    media_type = str(item.get("type") or media_type_for_name(media_url) or "").lower() or "image"
    file_name = download_payload_filename(item, media_url)
    if not extension_for(file_name):
        file_name = f"{file_name}.{download_fallback_extension(item, media_url)}"
    target_file = unique_path(target_dir / file_name)
    write_imagine_remote_url_to_file(media_url, target_file, account, media_type)

    thumbnail_name = ""
    thumbnail_url = remote_imagine_thumbnail_url(item)
    if thumbnail_url and thumbnail_url != media_url:
        thumb_base = download_payload_filename({"type": "image", "item_id": f"{target_file.stem}-thumb"}, thumbnail_url)
        if not extension_for(thumb_base):
            thumb_base = f"{target_file.stem}-thumb.jpg"
        thumb_target = unique_path(target_dir / thumb_base)
        try:
            write_imagine_remote_url_to_file(thumbnail_url, thumb_target, account, "image")
            thumbnail_name = thumb_target.name
        except Exception:
            thumbnail_name = ""

    item_id = item.get("item_id") or item.get("id") or target_file.stem or f"imagine-{index + 1}"
    return serializable_media_item({
        **item,
        "item_id": item_id,
        "type": media_type,
        "file": target_file.name,
        "url": "",
        "source_url": media_url,
        "media_url": media_url,
        "thumbnail": thumbnail_name or item.get("thumbnail") or "",
        "thumbnail_url": thumbnail_url if not thumbnail_name else "",
    })


def copy_imagine_remote_post_to_collection(payload: dict, item_only: bool = False) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    source_post = remote_imagine_payload_post(payload)
    if not source_post:
        raise RuntimeError("Select a remote Imagine post.")
    collection_path = str(payload.get("collection_path") or "")
    target_parent_path = str(payload.get("target_parent_path") or "")
    target_parent = validate_collection_target_parent(root, collection_path, target_parent_path)
    selected_key = str(payload.get("item_key") or "")
    items = [item for item in source_post.get("items") or [] if isinstance(item, dict)]
    if item_only:
        items = [item for item in items if media_item_key(item) == selected_key]
        if not items:
            raise RuntimeError("Selected media item was not found.")
    if not items:
        raise RuntimeError("Remote media item was not found.")

    account = active_imagine_account(root, str(source_post.get("account_id") or ""))
    base_name = source_post.get("title") or source_post.get("post_id") or source_post.get("folderName") or "imagine"
    suffix = "-item" if item_only else ""
    target_dir = target_parent / unique_directory_name(target_parent, safe_name(f"{base_name}{suffix}", "imagine"))
    target_dir.mkdir(parents=True, exist_ok=True)
    copied_items = []
    try:
        for index, item in enumerate(items):
            copied_items.append(copy_imagine_remote_item_to_directory(root, item, target_dir, account, index))
        target_path = target_dir.relative_to(root).as_posix()
        collection_id = Path(collection_path).name
        post_json = post_json_from_post(
            source_post,
            post_id=target_dir.name,
            source="imagine",
            mode=source_post.get("mode") or "imagine",
            title=source_post.get("title") or readable_name(target_dir.name),
            folder_path=target_path,
            collection=collection_id,
            items=copied_items,
            representative=representative_for_merged_items(copied_items),
            source_post_id=source_post.get("post_id") or source_post.get("source_post_id") or "",
            original_post_id=source_post.get("original_post_id") or source_post.get("post_id") or "",
            group_id=source_post.get("group_id") or source_post.get("root_post_id") or source_post.get("post_id") or "",
            account_id=source_post.get("account_id") or "",
            account_email=source_post.get("account_email") or "",
            favorite=False,
            build_favorite=False,
        )
        write_json(target_dir / "post.json", post_json)
    except Exception:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise

    data = scan_library(root)
    data["selected_path"] = post_json["folder_path"]
    data["selected_item_id"] = media_item_key(copied_items[-1] if copied_items else {})
    data["selected_collection_path"] = collection_path
    data["selected_collection_post_path"] = target_parent_path or post_json["folder_path"]
    return data


def media_item_merge_keys(post: dict, item: dict) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    media_type = str(item.get("type") or media_type_for_name(item.get("file") or item.get("url") or "") or "media").lower()
    for key in ("item_id",):
        value = str(item.get(key) or "").strip()
        if value:
            keys.add((f"{media_type}:{key}", value))
    for key in ("url", "media_url", "source_url", "original_url"):
        value = str(item.get(key) or "").strip()
        if value:
            keys.add((f"{media_type}:url", value))
    file_name = str(item.get("file") or "").strip()
    if file_name:
        keys.add((f"{media_type}:file", f"{post.get('folder_path') or ''}/{file_name}"))
    role = str(item.get("role") or item.get("relation") or item.get("source_type") or "").lower()
    source_item_id = str(item.get("source_item_id") or "").strip()
    if source_item_id and (re.search(r"(original|source|reference|input|parent)", role) or not keys):
        keys.add((f"{media_type}:source_item_id", source_item_id))
    return keys


def item_generated_at_value(item: dict, fallback_index: int) -> tuple[str, int]:
    for key in ("created_at", "updated_at"):
        value = str(item.get(key) or "")
        if value:
            return value, fallback_index
    return "", fallback_index


def result_role_item(item: dict) -> bool:
    role = str(item.get("role") or item.get("relation") or item.get("source_type") or "").lower()
    return not re.search(r"(original|source|reference|input|parent)", role)


def representative_for_merged_items(items: list[dict]) -> str:
    if not items:
        return ""
    indexed = list(enumerate(items))
    videos = [
        (index, item)
        for index, item in indexed
        if item.get("type") == "video" and result_role_item(item)
    ]
    images = [
        (index, item)
        for index, item in indexed
        if item.get("type") == "image" and result_role_item(item)
    ]
    candidates = videos or images or indexed
    _, selected = max(candidates, key=lambda pair: item_generated_at_value(pair[1], pair[0]))
    return selected.get("file") or selected.get("url") or media_item_key(selected)


def merge_target_parent(root: Path, posts: list[dict]) -> tuple[Path, str | None]:
    target_parent = root / "created" / "merged_Item"
    target_parent.mkdir(parents=True, exist_ok=True)
    return target_parent, None


def merged_post_source(posts: list[dict]) -> str:
    sources = [str(post.get("source") or "").strip() for post in posts if str(post.get("source") or "").strip()]
    if not sources:
        return "build"
    if len(set(sources)) == 1:
        return sources[0]
    if "build" in sources:
        return "build"
    return sources[0]


def merge_selected_posts(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    root = root.resolve()
    raw_paths = payload.get("post_paths")
    if not isinstance(raw_paths, list):
        raise RuntimeError("Select cards to merge.")
    post_paths = []
    for raw_path in raw_paths:
        path = str(raw_path or "").strip("/")
        if path and path not in post_paths:
            post_paths.append(path)
    if len(post_paths) < 2:
        raise RuntimeError("Select two or more cards to merge.")

    snapshot = scan_library(root)
    posts = []
    for path in post_paths:
        post = find_post(snapshot, path)
        if not post:
            raise RuntimeError("Selected post was not found.")
        if post.get("area") not in {"created", "collection", "upload"}:
            raise RuntimeError("Only local Build or Collection cards can be merged.")
        post_dir = safe_join(root, post.get("folder_path") or "")
        if not post_dir.is_dir():
            raise RuntimeError("Selected post folder was not found.")
        posts.append(post)

    target_parent, collection_id = merge_target_parent(root, posts)
    source_dirs = [safe_join(root, post.get("folder_path") or "") for post in posts]
    if any(source_dir.resolve() == target_parent.resolve() or path_inside(source_dir, target_parent) for source_dir in source_dirs):
        target_parent = root / "created" / "merged_Item"
        target_parent.mkdir(parents=True, exist_ok=True)
        collection_id = None

    target_name = unique_directory_name(target_parent, "merged-item")
    temp_dir = target_parent / f".merge-{uuid.uuid4().hex}.tmp"
    final_dir = target_parent / target_name
    merged_items: list[dict] = []
    seen_keys: set[tuple[str, str]] = set()
    try:
        temp_dir.mkdir(parents=True, exist_ok=False)
        for post, source_dir in zip(posts, source_dirs):
            for item in post.get("items") or []:
                item_keys = media_item_merge_keys(post, item)
                if item_keys and seen_keys.intersection(item_keys):
                    continue
                copied_item = copy_media_item_to_directory(source_dir, item, temp_dir)
                if not copied_item.get("prompt") and post.get("prompt"):
                    copied_item["prompt"] = post.get("prompt")
                if not copied_item.get("created_at") and post.get("created_at"):
                    copied_item["created_at"] = post.get("created_at")
                merged_items.append(copied_item)
                seen_keys.update(item_keys)
                seen_keys.update(media_item_merge_keys({"folder_path": target_name}, copied_item))
        if not merged_items:
            raise RuntimeError("Selected cards have no media to merge.")

        target_path = final_dir.relative_to(root).as_posix()
        first_post = posts[0]
        post_json = post_json_from_post(
            first_post,
            post_id=target_name,
            source=merged_post_source(posts),
            mode=first_post.get("mode") or "",
            title=readable_name(target_name),
            prompt=first_post.get("prompt") or next((item.get("prompt") for item in merged_items if item.get("prompt")), ""),
            original_prompt=first_post.get("original_prompt") or "",
            created_at=min((str(post.get("created_at") or now_iso()) for post in posts), default=now_iso()),
            folder_path=target_path,
            collection=collection_id,
            representative=representative_for_merged_items(merged_items),
            items=merged_items,
            group_id=first_post.get("group_id") or post_origin_key(first_post) or target_name,
            source_post_id=first_post.get("source_post_id") or first_post.get("post_id") or "",
            original_post_id=first_post.get("original_post_id") or first_post.get("post_id") or "",
            split_from_post_id=first_post.get("split_from_post_id") or "",
            grid_slot=min((safe_int(post.get("grid_slot"), 0) for post in posts), default=0),
            order=min((safe_int(post.get("order"), 0) for post in posts), default=0),
        )
        write_json(temp_dir / "post.json", post_json)
        temp_dir.rename(final_dir)
    except Exception:
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
        if final_dir.exists() and final_dir.name == target_name:
            shutil.rmtree(final_dir, ignore_errors=True)
        raise

    for source_dir in source_dirs:
        if source_dir.exists() and source_dir.resolve() != final_dir.resolve():
            shutil.rmtree(source_dir)

    data = scan_library(root)
    data["selected_path"] = final_dir.relative_to(root).as_posix()
    data["selected_item_id"] = media_item_key(merged_items[-1])
    collection_path = collection_path_for_post_path(data["selected_path"])
    if collection_path:
        data["selected_collection_path"] = collection_path
        data["selected_collection_post_path"] = data["selected_path"]
    return data


def merge_items_into_post(source_post: dict, source_dir: Path, target_post: dict, target_dir: Path, items: list[dict]) -> dict:
    merged_items = [serializable_media_item(item) for item in target_post.get("items", [])]
    merged_items.extend(copy_media_item_to_directory(source_dir, item, target_dir) for item in items)
    deduped = []
    seen = set()
    for item in merged_items:
        key = media_item_key(item)
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        deduped.append(item)
    post_json = post_json_from_post(
        target_post,
        items=deduped,
        representative=target_post.get("representative") or representative_for_remaining_items(deduped),
        group_id=target_post.get("group_id") or source_post.get("group_id") or post_origin_key(source_post),
    )
    write_json(target_dir / "post.json", post_json)
    return post_json


def remove_source_post_after_move(source_dir: Path, post: dict, remaining_items: list[dict]) -> None:
    source_parts = Path(str(post.get("folder_path") or "")).parts
    if remaining_items:
        write_json(source_dir / "post.json", post_json_from_post(
            post,
            items=remaining_items,
            representative=representative_for_remaining_items(remaining_items),
        ))
        return
    if len(source_parts) <= 1:
        post_json = source_dir / "post.json"
        if post_json.exists():
            post_json.unlink()
        return
    shutil.rmtree(source_dir)


def move_post_to_collection(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    snapshot = scan_library(root)
    post = find_post(snapshot, str(payload.get("post_path") or ""))
    collection_path = str(payload.get("collection_path") or "")
    merge_path = str(payload.get("merge_path") or "")
    target_parent_path = str(payload.get("target_parent_path") or "")
    if not post or post.get("area") not in {"created", "collection", "upload"}:
        if remote_imagine_payload_post(payload):
            return copy_imagine_remote_post_to_collection(payload, item_only=False)
        raise RuntimeError("Select a local post.")
    source_dir = safe_join(root, post["folder_path"])
    if not source_dir.is_dir():
        raise RuntimeError("Selected post folder was not found.")
    target_parent = validate_collection_target_parent(root, collection_path, target_parent_path)
    if path_inside(source_dir, target_parent):
        raise RuntimeError("Cannot move a post inside itself.")
    if merge_path:
        merge_post = find_post(snapshot, merge_path)
        if not merge_post:
            raise RuntimeError("Selected collection target was not found.")
        target_dir = safe_join(root, merge_path)
        if source_dir.resolve() == target_dir.resolve():
            raise RuntimeError("The selected post is already in this folder.")
        post_json = merge_items_into_post(post, source_dir, merge_post, target_dir, post.get("items") or [])
        shutil.rmtree(source_dir)
        data = scan_library(root)
        data["selected_path"] = post_json["folder_path"]
        data["selected_item_id"] = media_item_key((post_json.get("items") or [])[-1] if post_json.get("items") else {})
        data["selected_collection_path"] = collection_path_for_post_path(post_json["folder_path"])
        data["selected_collection_post_path"] = post_json["folder_path"]
        return data
    target_name = unique_directory_name(target_parent, source_dir.name)
    target_dir = target_parent / target_name
    shutil.move(str(source_dir), str(target_dir))
    collection_id = Path(collection_path).name
    target_path = target_dir.relative_to(root).as_posix()
    post_json = post_json_from_post(post, folder_path=target_path, collection=collection_id)
    write_json(target_dir / "post.json", post_json)
    data = scan_library(root)
    data["selected_path"] = post_json["folder_path"]
    data["selected_collection_path"] = collection_path
    data["selected_collection_post_path"] = target_parent_path or post_json["folder_path"]
    return data


def move_item_to_collection(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    snapshot = scan_library(root)
    post = find_post(snapshot, str(payload.get("post_path") or ""))
    collection_path = str(payload.get("collection_path") or "")
    selected_key = str(payload.get("item_key") or "")
    merge_path = str(payload.get("merge_path") or "")
    target_parent_path = str(payload.get("target_parent_path") or "")
    if not post or post.get("area") not in {"created", "collection", "upload"}:
        if remote_imagine_payload_post(payload):
            return copy_imagine_remote_post_to_collection(payload, item_only=True)
        raise RuntimeError("Select a local post.")
    selected_item = next((item for item in post.get("items", []) if media_item_key(item) == selected_key), None)
    if not selected_item:
        raise RuntimeError("Selected media item was not found.")
    source_dir = safe_join(root, post["folder_path"])
    collection_dir = validate_collection_destination(root, collection_path)
    target_parent = validate_collection_target_parent(root, collection_path, target_parent_path)
    merge_post = find_post(snapshot, merge_path) if merge_path else None
    target_dir = safe_join(root, merge_path) if merge_post else target_parent / unique_directory_name(target_parent, f"{post.get('post_id') or post_origin_key(post) or 'post'}-split")
    if source_dir.resolve() == target_dir.resolve():
        raise RuntimeError("The selected item is already in this folder.")
    target_dir.mkdir(parents=True, exist_ok=True)
    moved_item = copy_media_item_to_directory(source_dir, selected_item, target_dir)
    if merge_post:
        merged_items = [serializable_media_item(item) for item in merge_post.get("items", [])]
        merged_items.append(moved_item)
        deduped = []
        seen = set()
        for item in merged_items:
            key = media_item_key(item)
            if key and key not in seen:
                seen.add(key)
                deduped.append(item)
        post_json = post_json_from_post(merge_post, items=deduped, representative=merge_post.get("representative") or moved_item.get("file") or moved_item.get("url"))
        write_json(target_dir / "post.json", post_json)
    else:
        target_path = target_dir.relative_to(root).as_posix()
        origin_key = post_origin_key(post)
        post_json = post_json_from_post(
            post,
            post_id=target_dir.name,
            folder_path=target_path,
            collection=Path(collection_path).name,
            items=[moved_item],
            representative=moved_item.get("file") or moved_item.get("url"),
            original_post_id=post.get("original_post_id") or post.get("post_id"),
            source_post_id=post.get("post_id"),
            split_from_post_id=origin_key,
            group_id=post.get("group_id") or origin_key,
        )
        write_json(target_dir / "post.json", post_json)

    moved_values = media_item_reference_values(selected_item)
    remaining_items = [
        clear_deleted_media_item_references(item, moved_values)
        for item in post.get("items", [])
        if media_item_key(item) != selected_key
    ]
    if selected_item.get("file") and not any(item.get("file") == selected_item.get("file") for item in remaining_items):
        try:
            (source_dir / selected_item["file"]).unlink()
        except FileNotFoundError:
            pass
    if selected_item.get("thumbnail") and not any(item.get("thumbnail") == selected_item.get("thumbnail") for item in remaining_items):
        try:
            (source_dir / selected_item["thumbnail"]).unlink()
        except FileNotFoundError:
            pass
    remove_source_post_after_move(source_dir, post, remaining_items)
    data = scan_library(root)
    data["selected_path"] = post_json["folder_path"]
    data["selected_item_id"] = media_item_key(moved_item)
    data["selected_collection_path"] = collection_path_for_post_path(post_json["folder_path"])
    data["selected_collection_post_path"] = target_parent_path or post_json["folder_path"]
    return data


def split_library_item(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    snapshot = scan_library(root)
    post = find_post(snapshot, str(payload.get("post_path") or ""))
    selected_key = str(payload.get("item_key") or "")
    if not post or post.get("area") not in {"created", "collection", "upload"}:
        raise RuntimeError("Select a local post.")
    items = post.get("items") or []
    if len(items) <= 1:
        raise RuntimeError("This card has only one item.")
    selected_item = next((item for item in items if media_item_key(item) == selected_key), None)
    if not selected_item:
        raise RuntimeError("Selected media item was not found.")

    source_dir = safe_join(root, post["folder_path"])
    if not source_dir.is_dir():
        raise RuntimeError("Selected post folder was not found.")
    parent_dir = source_dir.parent
    target_dir = parent_dir / unique_directory_name(parent_dir, f"{post.get('post_id') or post_origin_key(post) or source_dir.name}-split")
    target_dir.mkdir(parents=True, exist_ok=True)
    moved_item = copy_media_item_to_directory(source_dir, selected_item, target_dir)
    target_path = target_dir.relative_to(root).as_posix()
    origin_key = post_origin_key(post)
    post_json = post_json_from_post(
        post,
        post_id=target_dir.name,
        folder_path=target_path,
        collection=post.get("collection"),
        items=[moved_item],
        representative=moved_item.get("file") or moved_item.get("url") or media_item_key(moved_item),
        original_post_id=post.get("original_post_id") or post.get("post_id"),
        source_post_id=post.get("post_id"),
        split_from_post_id=origin_key,
        group_id=post.get("group_id") or origin_key,
    )
    write_json(target_dir / "post.json", post_json)

    moved_values = media_item_reference_values(selected_item)
    remaining_items = [
        clear_deleted_media_item_references(item, moved_values)
        for item in items
        if media_item_key(item) != selected_key
    ]
    if selected_item.get("file") and not any(item.get("file") == selected_item.get("file") for item in remaining_items):
        try:
            (source_dir / selected_item["file"]).unlink()
        except FileNotFoundError:
            pass
    if selected_item.get("thumbnail") and not any(item.get("thumbnail") == selected_item.get("thumbnail") for item in remaining_items):
        try:
            (source_dir / selected_item["thumbnail"]).unlink()
        except FileNotFoundError:
            pass
    remove_source_post_after_move(source_dir, post, remaining_items)

    data = scan_library(root)
    data["selected_path"] = post_json["folder_path"]
    data["selected_item_id"] = media_item_key(moved_item)
    collection_path = collection_path_for_post_path(post_json["folder_path"])
    if collection_path:
        data["selected_collection_path"] = collection_path
        data["selected_collection_post_path"] = post_json["folder_path"]
    return data


def editor_item_reference(item_id: str) -> tuple[str, str]:
    text = str(item_id or "")
    if "::" not in text:
        return "", text
    post_path, item_key = text.split("::", 1)
    return post_path.strip("/"), item_key


def editor_source_from_payload(root: Path, payload: dict) -> tuple[dict, dict | None, Path, str]:
    item_id = str(payload.get("item_id") or "")
    source_url = str(payload.get("source_url") or "").strip()
    post_path, item_key = editor_item_reference(item_id)
    source_path = local_media_source_from_url(root, source_url) if source_url else None
    if not post_path and source_path:
        post_path = source_path.parent.relative_to(root).as_posix()
    snapshot = scan_library(root)
    post = find_post(snapshot, post_path)
    if not post:
        raise RuntimeError("Editor source post was not found.")
    if post.get("area") not in {"created", "collection", "upload"}:
        raise RuntimeError("This item cannot be edited here.")
    post_dir = safe_join(root, post.get("folder_path") or "")
    if not post_dir.is_dir():
        raise RuntimeError("Editor source folder was not found.")
    source_file = source_path.name if source_path and source_path.parent == post_dir else ""
    source_item = next((
        item for item in post.get("items") or []
        if (item_key and media_item_key(item) == item_key)
        or (source_file and item.get("file") == source_file)
        or (source_url and item.get("object_url") == source_url)
    ), None)
    return post, source_item, post_dir, source_file


def save_image_editor_upload_result(payload: dict, mime_type: str, image_data: str) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    raw = decode_data_url(image_data)
    if not raw:
        raise RuntimeError("Edited image is empty.")
    upload_hash = hashlib.sha256(raw).hexdigest()
    existing = find_uploaded_media_by_hash(root, upload_hash)
    if existing:
        folder_path, item_id = existing
        unhide_saved_upload_refs(root, [(folder_path, item_id)])
        return {
            "ok": True,
            "item": {
                "id": f"{folder_path}::{item_id}",
                "folder_path": folder_path,
                "item_id": item_id,
                "metadata": {"editor_save_target": "upload"},
            },
        }
    source_name = str(payload.get("name") or "").strip()
    ext = extension_from_mime_type(mime_type, "png")
    now = now_iso()
    date_name = datetime.now().strftime("%Y-%m-%d")
    upload_root = root / "upload" / date_name
    upload_root.mkdir(parents=True, exist_ok=True)
    title = f"{file_stem(source_name) or 'image'}_edit"
    folder_name = unique_directory_name(upload_root, safe_name(title, f"edit-{upload_hash[:8]}"))
    folder = upload_root / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    file_name = unique_file_name(folder, safe_name(title, f"edit-{upload_hash[:8]}"), ext)
    (folder / file_name).write_bytes(raw)
    item_id = file_stem(file_name)
    item = {
        "item_id": item_id,
        "type": "image",
        "file": file_name,
        "mime_type": mime_type,
        "role": "source",
        "relation": "edited",
        "title": file_stem(file_name),
        "created_at": now,
        "updated_at": now,
        "size": len(raw),
        "upload_hash": upload_hash,
        "editor": "TOAST UI Image Editor",
        "editor_save_target": "upload",
    }
    folder_path = folder.relative_to(root).as_posix()
    post = {
        "post_id": folder_name,
        "source": "local",
        "mode": "upload",
        "title": title,
        "prompt": "",
        "created_at": now,
        "updated_at": now,
        "folder_path": folder_path,
        "collection": None,
        "representative": file_name,
        "items": [item],
    }
    write_json(folder / "post.json", post_json_from_post(post))
    unhide_saved_upload_refs(root, [(folder_path, item_id)])
    return {
        "ok": True,
        "item": {
            "id": f"{folder_path}::{item_id}" if folder_path and item_id else "",
            "folder_path": folder_path,
            "item_id": item_id,
            "metadata": {"editor_save_target": "upload"},
        },
    }


def save_image_editor_result(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    image_data = str(payload.get("image") or "").strip()
    if not image_data:
        raise RuntimeError("Edited image is empty.")
    mime_type = data_url_mime_type(image_data)
    if mime_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise RuntimeError("Edited images must be PNG, JPEG, or WebP.")
    save_target = str(payload.get("save_target") or "").strip().lower()
    provider = str(payload.get("provider") or "").strip().lower()
    if save_target == "upload" or provider == "imagine":
        return save_image_editor_upload_result(payload, mime_type, image_data)
    post, source_item, post_dir, source_file = editor_source_from_payload(root, payload)
    ext = extension_from_mime_type(mime_type, "png")
    source_name = str(payload.get("name") or "").strip()
    preferred_stem = (
        file_stem(source_name)
        or file_stem(source_item.get("file") if source_item else "")
        or file_stem(source_file)
        or "image"
    )
    file_name = unique_file_name(post_dir, f"{preferred_stem}_edit", ext)
    (post_dir / file_name).write_bytes(decode_data_url(image_data))
    now = now_iso()
    source_key = media_item_key(source_item) if source_item else ""
    source_url = str(payload.get("source_url") or "").strip()
    new_item = {
        "item_id": file_stem(file_name),
        "type": "image",
        "file": file_name,
        "mime_type": mime_type,
        "role": "result",
        "relation": "edited",
        "title": file_stem(file_name),
        "prompt": (source_item or {}).get("prompt") or post.get("prompt") or "",
        "created_at": now,
        "source_item_id": source_key,
        "source_post_id": post.get("post_id") or "",
        "source_url": source_url,
        "editor": "TOAST UI Image Editor",
        "editor_save_target": "detail",
    }
    existing_items = [dict(item) for item in post.get("items") or [] if isinstance(item, dict)]
    items = existing_items + [new_item]
    post_json = post_json_from_post(
        post,
        items=items,
        representative=new_item["file"],
        updated_at=now,
    )
    write_json(post_dir / "post.json", post_json)
    data = scan_library(root)
    data["selected_path"] = post.get("folder_path") or ""
    data["selected_item_id"] = new_item["item_id"]
    data["item"] = {
        "id": f"{post.get('folder_path') or ''}::{new_item['item_id']}",
        "folder_path": post.get("folder_path") or "",
        "item_id": new_item["item_id"],
        "metadata": {"editor_save_target": "detail"},
    }
    return data


def upload_media_extension(name: str, mime_type: str, media_type: str) -> str:
    name_ext = extension_for(name)
    if media_type == "image" and name_ext in IMAGE_EXTS:
        return name_ext
    if media_type == "video" and name_ext in VIDEO_EXTS:
        return name_ext
    fallback = "mp4" if media_type == "video" else "jpg"
    return extension_from_mime_type(mime_type, fallback)


def find_uploaded_media_by_hash(root: Path, upload_hash: str) -> tuple[str, str] | None:
    if not upload_hash:
        return None
    area_root = root / "upload"
    if not area_root.exists():
        return None
    for post_json in area_root.rglob("post.json"):
        meta = read_json(post_json, {})
        if not isinstance(meta, dict):
            continue
        rel_folder = post_json.parent.relative_to(root).as_posix()
        for item in meta.get("items") or []:
            if not isinstance(item, dict):
                continue
            if str(item.get("upload_hash") or "") != upload_hash:
                continue
            file_name = str(item.get("file") or "")
            if file_name and (post_json.parent / file_name).is_file():
                return rel_folder, str(item.get("item_id") or file_stem(file_name))
    return None


def upload_hidden_keys_for_item(root: Path, folder_path: str, item_id: str) -> set[str]:
    folder = safe_join(root, folder_path)
    meta = read_json(folder / "post.json", {})
    if not isinstance(meta, dict):
        return set()
    post_title = str(meta.get("title") or "").strip()
    keys = {f"upload-item:{folder_path}::{item_id}"}
    for item in meta.get("items") or []:
        if not isinstance(item, dict):
            continue
        if media_item_key(item) != item_id and str(item.get("item_id") or "") != item_id:
            continue
        item_key = media_item_key(item)
        if item_key:
            keys.add(f"upload-item:{folder_path}::{item_key}")
        file_name = str(item.get("file") or "").strip()
        if file_name:
            keys.add(f"upload-history:url:{media_url(f'{folder_path}/{file_name}'.strip('/'))}")
        raw_url = str(item.get("object_url") or item.get("url") or item.get("media_url") or item.get("mediaUrl") or "").strip()
        if raw_url:
            keys.add(f"upload-history:url:{raw_url}")
        title = str(item.get("title") or post_title or file_name or "").strip().lower()
        mime = str(item.get("mime_type") or item.get("mime") or "").strip().lower()
        if title and not re.match(r"^[0-9a-f]{8}-[0-9a-f-]{27,}$", title, re.I):
            keys.add(f"upload-history:name:{title}:{mime}")
        break
    return keys


def unhide_saved_upload_refs(root: Path, saved_refs: list[tuple[str, str]]) -> None:
    if not saved_refs:
        return
    keys_to_remove: set[str] = set()
    for folder_path, item_id in saved_refs:
        keys_to_remove.update(upload_hidden_keys_for_item(root, folder_path, item_id))
    if not keys_to_remove:
        return
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})
    hidden = [str(value) for value in settings.get("hidden_upload_keys", []) if str(value)]
    next_hidden = [key for key in hidden if key not in keys_to_remove]
    if len(next_hidden) == len(hidden):
        return
    settings["hidden_upload_keys"] = next_hidden
    library["updated_at"] = now_iso()
    write_json(library_path, library)


def uploaded_item_from_snapshot(snapshot: dict, folder_path: str, item_id: str) -> dict:
    for post in snapshot.get("posts") or []:
        if str(post.get("folder_path") or "") != folder_path:
            continue
        for item in post.get("items") or []:
            if media_item_key(item) == item_id:
                return {
                    "folder_path": folder_path,
                    "item_id": item_id,
                    "post": post,
                    "item": item,
                }
    return {"folder_path": folder_path, "item_id": item_id}


def save_composer_uploads(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    files = payload.get("files") if isinstance(payload.get("files"), list) else []
    if not files:
        raise RuntimeError("Upload file is missing.")
    saved_refs: list[tuple[str, str]] = []
    date_name = datetime.now().strftime("%Y-%m-%d")
    upload_root = root / "upload" / date_name
    upload_root.mkdir(parents=True, exist_ok=True)
    now = now_iso()

    for index, file_payload in enumerate(files, start=1):
        if not isinstance(file_payload, dict):
            continue
        data_url = str(file_payload.get("data_url") or "").strip()
        if not data_url:
            continue
        mime_type = data_url_mime_type(data_url) or str(file_payload.get("type") or "").strip().lower()
        media_type = "video" if mime_type.startswith("video/") else "image" if mime_type.startswith("image/") else ""
        if media_type not in {"image", "video"}:
            raise RuntimeError("Upload must be an image or video.")
        raw = decode_data_url(data_url)
        if not raw:
            raise RuntimeError("Upload file is empty.")
        upload_hash = hashlib.sha256(raw).hexdigest()
        existing = find_uploaded_media_by_hash(root, upload_hash)
        if existing:
            saved_refs.append(existing)
            continue

        original_name = Path(str(file_payload.get("name") or "")).name
        title = file_stem(original_name) or f"upload-{upload_hash[:8]}"
        folder_name = unique_directory_name(upload_root, safe_name(title, f"upload-{index:02d}"))
        folder = upload_root / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        ext = upload_media_extension(original_name, mime_type, media_type)
        file_name = unique_file_name(folder, safe_name(title, f"upload-{index:02d}"), ext)
        (folder / file_name).write_bytes(raw)
        item = {
            "item_id": file_stem(file_name),
            "type": media_type,
            "file": file_name,
            "mime_type": mime_type,
            "role": "source",
            "title": title,
            "created_at": now,
            "updated_at": now,
            "size": len(raw),
            "upload_hash": upload_hash,
        }
        rel_folder = folder.relative_to(root).as_posix()
        post = {
            "post_id": folder_name,
            "source": "local",
            "mode": "upload",
            "title": title,
            "prompt": "",
            "created_at": now,
            "updated_at": now,
            "folder_path": rel_folder,
            "collection": None,
            "representative": file_name,
            "items": [item],
        }
        write_json(folder / "post.json", post_json_from_post(post))
        saved_refs.append((rel_folder, item["item_id"]))

    if not saved_refs:
        raise RuntimeError("No upload files were saved.")
    unhide_saved_upload_refs(root, saved_refs)
    snapshot = scan_library(root)
    snapshot["saved"] = [uploaded_item_from_snapshot(snapshot, folder_path, item_id) for folder_path, item_id in saved_refs]
    return snapshot


def remove_upload_from_composer_list(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    key = str((payload or {}).get("key") or "").strip()
    if not key:
        post_path = str((payload or {}).get("post_path") or "").strip()
        item_id = str((payload or {}).get("item_id") or "").strip()
        key = f"upload-item:{post_path}::{item_id}" if post_path and item_id else ""
    if not key:
        raise RuntimeError("Upload item key is missing.")
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})
    removed = [str(value) for value in settings.get("hidden_upload_keys", []) if str(value)]
    if key not in removed:
        removed.append(key)
    settings["hidden_upload_keys"] = removed
    library["updated_at"] = now_iso()
    write_json(library_path, library)
    return scan_library(root)


def hide_imagine_item_from_remote_lists(payload: dict) -> dict:
    root = library_root()
    if not root:
        raise RuntimeError("Library path is not set.")
    ensure_library_root(root)
    raw_keys = payload.get("keys") if isinstance(payload.get("keys"), list) else []
    keys = [str(value).strip() for value in raw_keys if str(value).strip()]
    if not keys:
        raise RuntimeError("Imagine item key is missing.")
    library_path = root / "library.json"
    library = merge_library_json(read_json(library_path, {}))
    settings = library.setdefault("settings", {})
    hidden = [str(value) for value in settings.get("hidden_imagine_item_keys", []) if str(value)]
    seen = set(hidden)
    for key in keys:
        if key not in seen:
            hidden.append(key)
            seen.add(key)
    settings["hidden_imagine_item_keys"] = hidden
    library["updated_at"] = now_iso()
    write_json(library_path, library)
    return {"ok": True, "keys": keys}


POST_JSON_ROUTES = {
    "/api/library/scan": lambda payload: scan_library(),
    "/api/open-library-folder": open_library_folder,
    "/api/prompts/save": save_prompt,
    "/api/prompts/delete": delete_prompt,
    "/api/translate": translate_prompt,
    "/api/uploads/save": save_composer_uploads,
    "/api/uploads/remove-from-list": remove_upload_from_composer_list,
    "/api/imagine/item/hide": hide_imagine_item_from_remote_lists,
    "/api/accounts/save": save_accounts,
    "/api/accounts/total/register": register_total_account,
    "/api/accounts/register": register_build_account,
    "/api/accounts/select": select_build_account,
    "/api/accounts/delete": delete_build_account,
    "/api/accounts/tier": update_account_tier,
    "/api/accounts/reorder": lambda payload: reorder_account_store(payload, "build"),
    "/api/native-bridge/next": native_bridge_next_command,
    "/api/native-bridge/result": native_bridge_result,
    "/api/imagine/bridge/prepare": prepare_imagine_bridge_session,
    **imagine_post_routes(
        start_imagine_login=start_imagine_login,
        open_imagine_usage_page=open_imagine_usage_page,
        list_imagine_saved=list_imagine_saved,
        list_imagine_discover=list_imagine_discover,
        list_imagine_unsaved=list_imagine_unsaved,
        search_imagine_media=search_imagine_media,
        load_imagine_remote_link_post=load_imagine_remote_link_post,
        list_imagine_uploads=list_imagine_uploads,
        start_imagine_job=start_imagine_job,
        get_imagine_job=get_imagine_job,
        cancel_imagine_job=cancel_imagine_job,
        dismiss_imagine_job=dismiss_imagine_job,
        delete_imagine_media_post=delete_imagine_media_post,
        like_imagine_media_post=like_imagine_media_post,
        unsave_imagine_media_post=unsave_imagine_media_post,
        upscale_imagine_video_post=upscale_imagine_video_post,
        crop_imagine_image_post=crop_imagine_image_post,
        capture_imagine_login=capture_imagine_login,
        select_imagine_account=select_imagine_account,
        logout_imagine_account=logout_imagine_account,
        delete_imagine_account=delete_imagine_account,
        reorder_imagine_accounts=lambda payload: reorder_account_store(payload, "imagine"),
        imagine_account_statuses=imagine_account_statuses,
    ),
    "/api/image-editor/save": save_image_editor_result,
    **build_post_routes(
        start_build_job=start_build_job,
        get_build_job=get_build_job,
        cancel_build_job=cancel_build_job,
        dismiss_build_job=dismiss_build_job,
        set_build_favorite=set_build_favorite,
        analyze_image=analyze_image,
        build_generate=build_generate,
    ),
    "/api/collection/create": create_collection,
    "/api/collection/rename": rename_collection_folder,
    "/api/collection/delete": delete_collection_folder,
    "/api/collection/layout": save_collection_layout,
    "/api/library/delete-post": delete_library_post,
    "/api/library/delete-item": delete_library_item,
    "/api/library/set-source": set_post_source_item,
    "/api/library/split-item": split_library_item,
    "/api/library/download-items": download_library_items,
    "/api/library/merge-posts": merge_selected_posts,
    "/api/collection/move-post": move_post_to_collection,
    "/api/collection/move-item": move_item_to_collection,
}


class Handler(SimpleHTTPRequestHandler):
    server_version = "GrokStudioLabQ/1.0"

    def log_message(self, format, *args):
        return

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        rel = unquote(parsed.path.lstrip("/")) or "index.html"
        if rel == "":
            rel = "index.html"
        target = (WEB_ROOT / rel).resolve()
        if WEB_ROOT.resolve() not in target.parents and target != WEB_ROOT.resolve():
            return str(WEB_ROOT / "index.html")
        return str(target)

    def end_headers(self) -> None:
        headers = getattr(self, "_headers_buffer", ())
        has_cache_control = any(header.lower().startswith(b"cache-control:") for header in headers)
        if not has_cache_control:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, data, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    def send_local_file(
        self,
        path: Path,
        content_type: str,
        head_only: bool = False,
        cache_control: str = "private, max-age=300",
    ) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        stat = path.stat()
        size = stat.st_size
        etag = f'"{stat.st_mtime_ns:x}-{size:x}"'
        last_modified = self.date_time_string(stat.st_mtime)
        range_header = self.headers.get("Range") or ""

        if not range_header and self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", last_modified)
            self.send_header("Cache-Control", cache_control)
            self.end_headers()
            return

        if range_header.startswith("bytes=") and size > 0:
            range_spec = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
            start_text, _, end_text = range_spec.partition("-")
            try:
                if not start_text:
                    suffix_size = int(end_text)
                    start = max(0, size - suffix_size)
                    end = size - 1
                else:
                    start = int(start_text)
                    end = int(end_text) if end_text else size - 1
            except ValueError:
                start = size
                end = size - 1
            end = min(end, size - 1)
            if start < 0 or start > end or start >= size:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("ETag", etag)
                self.send_header("Last-Modified", last_modified)
                self.send_header("Cache-Control", cache_control)
                self.end_headers()
                return

            length = end - start + 1
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", last_modified)
            self.send_header("Cache-Control", cache_control)
            self.end_headers()
            if head_only:
                return
            try:
                with path.open("rb") as file:
                    file.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = file.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                return
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", last_modified)
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        if head_only:
            return
        try:
            with path.open("rb") as file:
                while True:
                    chunk = file.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return

    def send_imagine_remote_media(self, parsed, head_only: bool = False) -> None:
        query = parse_qs(parsed.query, keep_blank_values=True)
        raw_url = str(query.get("url", [""])[0] or "").strip()
        if not raw_url:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing url")
            return
        nested = urlparse(raw_url)
        if nested.path == "/api/imagine/remote/media":
            nested_query = parse_qs(nested.query, keep_blank_values=True)
            raw_url = str(nested_query.get("url", [""])[0] or "").strip()
            if not query.get("kind") and nested_query.get("kind"):
                query["kind"] = nested_query["kind"]
            if not query.get("account_id") and nested_query.get("account_id"):
                query["account_id"] = nested_query["account_id"]
        remote = urlparse(raw_url)
        if remote.scheme not in {"http", "https"}:
            self.send_error(HTTPStatus.BAD_REQUEST, "Unsupported media URL")
            return
        kind = str(query.get("kind", [""])[0] or "").strip().lower()
        accept = "video/*,*/*" if kind == "video" else "image/*,video/*,*/*"
        headers = {
            "Accept": accept,
            "Referer": IMAGINE_BASE + "/imagine",
            "User-Agent": imagine_user_agent(),
        }
        range_header = self.headers.get("Range")
        if range_header:
            headers["Range"] = range_header
        root = library_root()
        account = active_imagine_account(root, str(query.get("account_id", [""])[0] or "")) if root else {}
        cookies = valid_imagine_cookies(account)
        if cookies:
            headers["Cookie"] = cookie_header(cookies)
        request = urllib.request.Request(raw_url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                status = int(getattr(response, "status", 200) or 200)
                self.send_response(status)
                response_headers = response.headers
                content_type = response_headers.get("Content-Type") or mimetypes.guess_type(urlparse(raw_url).path)[0] or "application/octet-stream"
                self.send_header("Content-Type", content_type)
                for header in ("Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"):
                    value = response_headers.get(header)
                    if value:
                        self.send_header(header, value)
                if not response_headers.get("Accept-Ranges"):
                    self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", response_headers.get("Cache-Control") or "private, max-age=300")
                self.end_headers()
                if head_only:
                    return
                while True:
                    chunk = response.read(1024 * 512)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as exc:
            detail = exc.read(4096)
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type") or "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(detail)))
            self.end_headers()
            if not head_only and detail:
                self.wfile.write(detail)
        except (BrokenPipeError, ConnectionResetError):
            return
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            detail = f"Could not load Imagine media: {exc}".encode("utf-8", errors="replace")
            self.send_response(HTTPStatus.BAD_GATEWAY)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(detail)))
            self.end_headers()
            if not head_only:
                self.wfile.write(detail)

    def handle_error(self, exc: Exception) -> None:
        log_event(f"request_error path={self.path} detail={exc}")
        try:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        parsed = urlparse(self.path)
        cancel_scheduled_shutdown_for_request(parsed.path, "GET")
        try:
            if parsed.path == "/api/health":
                self.send_json(health_snapshot())
                return
            if parsed.path == "/api/state" or parsed.path == "/api/library/scan":
                self.send_json(scan_library())
                return
            if parsed.path == "/api/accounts":
                root = library_root()
                if root:
                    refresh_build_account_tiers(root)
                self.send_json(scan_library(root))
                return
            if parsed.path == "/api/build/jobs":
                self.send_json(list_build_jobs())
                return
            if parsed.path == "/api/media":
                root = library_root()
                if not root:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                query = parse_qs(parsed.query)
                target = safe_join(root, query.get("path", [""])[0])
                if not target.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                self.send_local_file(target, mime_type)
                return
            if parsed.path == "/api/card-preview/cache-info":
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
            if parsed.path == "/api/card-preview":
                query = parse_qs(parsed.query)
                target = card_preview_cache_path(query.get("key", [""])[0])
                if not target or not target.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                self.send_local_file(target, "image/jpeg", cache_control="private, max-age=31536000, immutable")
                return
            if parsed.path == "/api/imagine/remote/media":
                self.send_imagine_remote_media(parsed)
                return
        except Exception as exc:
            self.handle_error(exc)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        cancel_scheduled_shutdown_for_request(parsed.path, "HEAD")
        try:
            if parsed.path == "/api/media":
                root = library_root()
                if not root:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                query = parse_qs(parsed.query)
                target = safe_join(root, query.get("path", [""])[0])
                if not target.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                self.send_local_file(target, mime_type, head_only=True)
                return
            if parsed.path == "/api/card-preview":
                query = parse_qs(parsed.query)
                target = card_preview_cache_path(query.get("key", [""])[0])
                if not target or not target.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                self.send_local_file(
                    target,
                    "image/jpeg",
                    head_only=True,
                    cache_control="private, max-age=31536000, immutable",
                )
                return
            if parsed.path == "/api/imagine/remote/media":
                self.send_imagine_remote_media(parsed, head_only=True)
                return
        except Exception as exc:
            self.handle_error(exc)
            return
        super().do_HEAD()

    def do_POST(self):
        parsed = urlparse(self.path)
        payload = self.read_body_json()
        try:
            if parsed.path == "/api/browser/closing":
                self.send_json({"ok": True})
                schedule_server_shutdown(self.server)
                return
            if parsed.path == "/api/shutdown":
                event = str((payload or {}).get("event") or "")
                cleanup = permanent_delete_unfavorite_build_t2i() if event == "electron-shutdown" else None
                self.send_json({
                    "ok": True,
                    "delay": 0.3 if event == "restart-cleanup" else 2.0,
                    **({"cleanup": cleanup} if cleanup is not None else {}),
                })
                schedule_server_shutdown(self.server, 0.3 if event == "restart-cleanup" else 2.0)
                return
            cancel_scheduled_shutdown_for_request(parsed.path, "POST")
            if parsed.path == "/api/choose-library-folder":
                selected = choose_library_folder(str(payload.get("current") or ""))
                if selected is None:
                    data = scan_library()
                    data["cancelled"] = True
                    self.send_json(data)
                    return
                self.send_json(scan_library(set_library_root(selected)))
                return
            route_handler = POST_JSON_ROUTES.get(parsed.path)
            if route_handler:
                self.send_json(route_handler(payload))
                return
            self.send_json({"ok": False, "error": "Unknown API path."}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.handle_error(exc)


def main() -> None:
    port = int(os.environ.get("GROK_CHAMELEON_PORT") or "8797")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(url, flush=True)
    if os.environ.get("GROK_CHAMELEON_NO_BROWSER") != "1":
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
