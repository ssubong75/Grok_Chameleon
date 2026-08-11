#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from datetime import datetime, timezone


ACCOUNT_TIERS = {"free", "super", "heavy"}
IMAGINE_BASE_DEFAULT = "https://grok.com"
USAGE_URL_DEFAULT = os.environ.get("GROK_STUDIO_USAGE_URL", IMAGINE_BASE_DEFAULT + "/?_s=usage")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_account_tier(value) -> str:
    tier = str(value or "").strip().lower()
    return tier if tier in ACCOUNT_TIERS else "free"


def account_id(prefix: str, key: str) -> str:
    raw = str(key or uuid.uuid4().hex).strip().lower()
    stable = uuid.uuid5(uuid.NAMESPACE_URL, f"grok-chameleon:{prefix}:{raw}").hex
    return f"{prefix}_{stable[:24]}"


def find_email_in_value(value, depth: int = 0) -> str:
    if depth > 6 or value is None:
        return ""
    if isinstance(value, str):
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


def normalize_cookie(cookie) -> dict | None:
    if not isinstance(cookie, dict):
        return None
    name = str(cookie.get("name") or "")
    value = str(cookie.get("value") or "")
    domain = str(cookie.get("domain") or "")
    if not name or not value or "grok.com" not in domain:
        return None
    return {
        "name": name,
        "value": value,
        "domain": domain,
        "path": str(cookie.get("path") or "/"),
        "expires": cookie.get("expires"),
        "secure": bool(cookie.get("secure")),
        "httpOnly": bool(cookie.get("httpOnly")),
        "sameSite": cookie.get("sameSite") or "",
    }


def normalize_imagine_cookies(cookies) -> list[dict]:
    if not isinstance(cookies, list):
        return []
    return [cookie for cookie in (normalize_cookie(item) for item in cookies) if cookie]


def valid_imagine_cookies(account) -> list[dict]:
    current_time = time.time()
    valid = []
    for cookie in normalize_imagine_cookies((account or {}).get("cookies") if isinstance(account, dict) else []):
        expires = cookie.get("expires")
        if isinstance(expires, (int, float)) and expires > 0 and expires < current_time:
            continue
        valid.append(cookie)
    return valid


def normalize_imagine_account(account) -> dict:
    cookies = normalize_imagine_cookies((account or {}).get("cookies") if isinstance(account, dict) else [])
    email = str((account or {}).get("email") or find_email_in_value(account) or "").strip()
    key = email or str((account or {}).get("id") or "") or json.dumps(cookies, sort_keys=True)[:200]
    status = str((account or {}).get("status") or "").strip()
    if status not in {"expired", "login_required", "oauth_error"}:
        status = "ok" if valid_imagine_cookies({"cookies": cookies}) else "expired"
    return {
        "id": str((account or {}).get("id") or account_id("imagine", key)),
        "store_id": str((account or {}).get("store_id") or ""),
        "provider": "imagine",
        "label": str((account or {}).get("label") or email or "Imagine"),
        "email": email,
        "tier": normalize_account_tier((account or {}).get("tier")),
        "captured_at": str((account or {}).get("captured_at") or now_iso()),
        "source_url": str((account or {}).get("source_url") or ""),
        "status": status,
        "oauth_error": str((account or {}).get("oauth_error") or ""),
        "oauth_error_at": str((account or {}).get("oauth_error_at") or ""),
        "cookies": cookies,
        "identity_values": [str(value) for value in ((account or {}).get("identity_values") or []) if str(value)],
    }


def cookie_header(cookies: list[dict]) -> str:
    pairs = []
    seen = set()
    for cookie in cookies:
        name = str(cookie.get("name") or "")
        value = str(cookie.get("value") or "")
        if not name or not value:
            continue
        pairs.append((name, value))
        seen.add(name)
    sso = next((value for name, value in pairs if name == "sso"), "")
    if sso and "sso-rw" not in seen:
        pairs.append(("sso-rw", sso))
    return "; ".join(f"{name}={value}" for name, value in pairs)


def imagine_user_agent() -> str:
    return (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
    )


def fetch_imagine_identity(cookies: list[dict], imagine_base: str = IMAGINE_BASE_DEFAULT) -> dict:
    header = cookie_header(cookies)
    if not header:
        return {}
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Cookie": header,
        "Referer": imagine_base + "/imagine",
        "User-Agent": imagine_user_agent(),
    }
    for path in (
        "/rest/app-chat/user",
        "/rest/app-chat/users/me",
        "/rest/app-chat/session",
        "/rest/app-chat/bootstrap",
        "/rest/app-chat/settings",
        "/api/auth/session",
    ):
        request = urllib.request.Request(imagine_base + path, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read(1_000_000).decode("utf-8", errors="replace")
        except Exception:
            continue
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
        email = find_email_in_value(parsed) or find_email_in_value(body)
        if email:
            return {"email": email, "label": email, "identity_values": [email.lower()]}
    return {}


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
    if (
        re.search(r'"issupergrokprouser"\s*:\s*true', normalized)
        or re.search(r'"bestsubscription"\s*:\s*"subscription_tier_super_grok_pro"', normalized)
        or re.search(r'"activesubscriptions"\s*:\s*\[[^\]]{0,4000}"tier"\s*:\s*"subscription_tier_super_grok_pro"', normalized)
    ):
        return "heavy"
    if (
        re.search(r'"issupergrokuser"\s*:\s*true', normalized)
        or re.search(r'"bestsubscription"\s*:\s*"subscription_tier_grok_pro"', normalized)
        or re.search(r'"activesubscriptions"\s*:\s*\[[^\]]{0,4000}"tier"\s*:\s*"subscription_tier_grok_pro"', normalized)
    ):
        return "super"
    return "free"


def fetch_imagine_usage_tier(
    account: dict,
    usage_url: str = USAGE_URL_DEFAULT,
    imagine_base: str = IMAGINE_BASE_DEFAULT,
) -> dict:
    cookies = valid_imagine_cookies(account)
    result = {
        "ok": False,
        "tier": normalize_account_tier(account.get("tier")),
        "message": "Usage tier unavailable",
    }
    if not cookies:
        result["message"] = "Imagine login session is unavailable"
        return result
    request = urllib.request.Request(
        usage_url,
        headers={
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cookie": cookie_header(cookies),
            "Referer": imagine_base + "/",
            "User-Agent": imagine_user_agent(),
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


def apply_imagine_account_tier(
    account: dict,
    *,
    usage_url: str = USAGE_URL_DEFAULT,
    imagine_base: str = IMAGINE_BASE_DEFAULT,
    log_event: Callable[[str], None] | None = None,
) -> bool:
    previous_tier = normalize_account_tier(account.get("tier"))
    result = fetch_imagine_usage_tier(account, usage_url=usage_url, imagine_base=imagine_base)
    if result.get("ok"):
        tier = normalize_account_tier(result.get("tier"))
        changed = tier != previous_tier or not account.get("tier_checked_at")
        account["tier"] = tier
        account["tier_checked_at"] = now_iso()
        if log_event:
            log_event(f"Imagine usage tier {account['tier']} for {account.get('email') or account.get('label') or account.get('id')}: {result.get('message') or ''}")
        return changed
    account["tier"] = previous_tier
    if log_event:
        log_event(f"Imagine usage tier kept {previous_tier} for {account.get('email') or account.get('label') or account.get('id')}: {result.get('message') or ''}")
    return False


def imagine_account_status(account: dict, imagine_base: str = IMAGINE_BASE_DEFAULT) -> dict:
    account_id_value = str(account.get("id") or "")
    cookies = valid_imagine_cookies(account)
    if not cookies:
        return {"id": account_id_value, "status": "expired"}
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookie_header(cookies),
        "Referer": imagine_base + "/imagine",
        "User-Agent": imagine_user_agent(),
    }
    for path in ("/rest/app-chat/user", "/rest/app-chat/users/me", "/rest/app-chat/session", "/api/auth/session"):
        request = urllib.request.Request(imagine_base + path, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read(1_000_000).decode("utf-8", errors="replace")
                status = int(getattr(response, "status", 200) or 200)
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403}:
                return {"id": account_id_value, "status": "expired"}
            continue
        except (urllib.error.URLError, OSError, TimeoutError):
            continue
        if status in {401, 403}:
            return {"id": account_id_value, "status": "expired"}
        if "login" in body[:5000].lower() or "sign in" in body[:5000].lower():
            continue
        return {"id": account_id_value, "status": "ok"}
    return {"id": account_id_value, "status": "unknown"}
