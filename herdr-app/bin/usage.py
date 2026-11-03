#!/usr/bin/env python3
"""Plan usage for the herdr sidebar: Claude (5h / weekly) and Factory Droid (5h / weekly / monthly).

Prints one JSON object. Results are cached and re-fetched at most every few minutes, with
backoff on rate limits, so calling this often is cheap. Tokens are read at run time, only to
call each provider's own usage endpoint for the account they belong to. They are never
printed, written to the cache, or refreshed (refreshing would rotate the proxy's token).

Claude token, first that works:
  $HERDR_USAGE_CLAUDE_TOKEN_FILE, ~/.cli-proxy-api/claude-*.json, ~/.claude/.credentials.json
Factory API key (create one at https://app.factory.ai/settings/api-keys), first that exists:
  $FACTORY_API_KEY, ~/.config/herdr-app/secrets/factory-api-key
"""
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.join(HOME, ".cache")), "herdr-usage", "state.json")
REFRESH_S = 300  # a provider is asked again at most this often
MAX_BACKOFF_S = 1800
UA = "herdr-usage/1.0"


def load_cache():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_cache(state):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, CACHE)


def parse_time(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def http_get(url, headers):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def claude_token():
    paths = [os.environ.get("HERDR_USAGE_CLAUDE_TOKEN_FILE")]
    paths += sorted(glob.glob(os.path.join(HOME, ".cli-proxy-api", "claude-*.json")))
    paths.append(os.path.join(HOME, ".claude", ".credentials.json"))
    expired = False
    for path in filter(None, paths):
        try:
            with open(path) as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if data.get("disabled"):
            continue
        oauth = data.get("claudeAiOauth") or {}
        token = data.get("access_token") or oauth.get("accessToken")
        if not token:
            continue
        end = parse_time(data.get("expired"))
        if end is None and oauth.get("expiresAt"):
            end = datetime.fromtimestamp(oauth["expiresAt"] / 1000, timezone.utc)
        if end is not None and end <= datetime.now(timezone.utc):
            expired = True
            continue
        return token, False
    return None, expired


def window(entry, pct_key):
    if not isinstance(entry, dict) or entry.get(pct_key) is None:
        return None
    return {"pct": round(float(entry[pct_key]), 1), "resets_at": entry.get("resets_at") or entry.get("windowEnd")}


def fetch_claude():
    token, expired = claude_token()
    if not token:
        return {"ok": False, "error": "token-expired" if expired else "no-token"}
    data = http_get(
        "https://api.anthropic.com/api/oauth/usage",
        {"Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20"},
    )
    return {"ok": True, "five_hour": window(data.get("five_hour"), "utilization"), "weekly": window(data.get("seven_day"), "utilization")}


def factory_key():
    key = os.environ.get("FACTORY_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(os.path.join(HOME, ".config", "herdr-app", "secrets", "factory-api-key")) as f:
            return f.read().strip()
    except OSError:
        return ""


def fetch_factory():
    key = factory_key()
    if not key:
        return {"ok": False, "error": "no-key"}
    data = http_get("https://api.factory.ai/api/billing/limits", {"Authorization": f"Bearer {key}"})
    standard = (data.get("limits") or {}).get("standard") or {}
    if not standard:
        return {"ok": False, "error": "no-plan" if data.get("hasActiveSubscription") is False else "no-limits"}
    out = {"ok": True}
    for name, field in (("five_hour", "fiveHour"), ("weekly", "weekly"), ("monthly", "monthly")):
        w = window(standard.get(field), "usedPercent")
        # A window that has already ended is stale: it counts from zero again.
        end = parse_time((w or {}).get("resets_at"))
        out[name] = None if w is None or (end and end < datetime.now(timezone.utc)) else w
    if data.get("extraUsageBalanceCents") is not None:
        out["extra_usd"] = round(data["extraUsageBalanceCents"] / 100, 2)
    return out


def refresh(state, name, fetch, now):
    entry = state.get(name) or {}
    if now < entry.get("next_try", 0):
        return
    try:
        entry = {"data": fetch(), "at": now, "next_try": now + REFRESH_S, "failures": 0}
    except urllib.error.HTTPError as e:
        failures = entry.get("failures", 0) + 1
        wait = min(MAX_BACKOFF_S, REFRESH_S * 2 ** failures) if e.code == 429 else REFRESH_S
        entry = {**entry, "failures": failures, "next_try": now + wait, "last_error": f"http-{e.code}"}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        entry = {**entry, "next_try": now + 60, "last_error": type(e).__name__}
    state[name] = entry


def main():
    now = time.time()
    state = load_cache()
    for name, fetch in (("claude", fetch_claude), ("factory", fetch_factory)):
        refresh(state, name, fetch, now)
    save_cache(state)
    out = {}
    for name in ("claude", "factory"):
        entry = state.get(name) or {}
        data = entry.get("data") or {"ok": False, "error": entry.get("last_error", "pending")}
        out[name] = {**data, "age_s": int(now - entry["at"]) if entry.get("at") else None, "stale": bool(entry.get("last_error") and entry.get("data"))}
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
