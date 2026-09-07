"""Rate-limit meters from the OAuth usage endpoint, and the poll backoff.
Ported from claude-usage-tui (src/claude_usage/limits.py, burn.py); the
parsers are pure, the fetch shells out to the macOS keychain for the Claude
Code token and makes the one HTTPS call Claude Code itself makes."""

from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
KEYCHAIN_SERVICE = "Claude Code-credentials"
POLL_SECONDS = 30 * 60
POLL_MAX_SECONDS = 2 * 60 * 60
MIN_PROJECTION_SPAN_SECONDS = 180


@dataclass(frozen=True)
class Limit:
    kind: str
    percent: float
    severity: str = "normal"
    resets_at: datetime | None = None


def _parse_ts(value) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def parse_usage_payload(payload: dict) -> list[Limit]:
    limits: list[Limit] = []
    # is_active flags the currently-binding constraint, not applicability —
    # inactive meters (e.g. the weekly bars) must still be shown.
    for entry in payload.get("limits") or []:
        limits.append(
            Limit(
                kind=str(entry.get("kind", "?")),
                percent=float(entry.get("percent") or 0),
                severity=str(entry.get("severity", "normal")),
                resets_at=_parse_ts(entry.get("resets_at")),
            )
        )
    if limits:
        return limits
    for key, kind in (("five_hour", "session"), ("seven_day", "seven_day")):
        entry = payload.get(key)
        if entry and entry.get("utilization") is not None:
            limits.append(Limit(kind, float(entry["utilization"]), resets_at=_parse_ts(entry.get("resets_at"))))
    return limits


def _oauth_token() -> str:
    raw = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True, timeout=10, check=True,
    ).stdout
    return json.loads(raw)["claudeAiOauth"]["accessToken"]


def fetch_limits() -> list[Limit]:
    """Live meters. Raises on any failure; the caller keeps its last value."""
    req = urllib.request.Request(
        USAGE_URL,
        headers={
            "Authorization": f"Bearer {_oauth_token()}",
            "anthropic-beta": "oauth-2025-04-20",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return parse_usage_payload(json.load(resp))


def describe_error(exc: BaseException) -> str:
    """One line for the section title, e.g. 'HTTP 429 Too Many Requests · rate_limit_error'."""
    if isinstance(exc, urllib.error.HTTPError):
        text = f"HTTP {exc.code} {exc.reason}"
        try:
            kind = (json.loads(exc.read()).get("error") or {}).get("type")
        except (ValueError, TypeError, AttributeError, OSError):
            kind = None
        return f"{text} · {kind}" if kind else text
    msg = str(exc)
    return f"{type(exc).__name__}: {msg}" if msg else type(exc).__name__


def next_poll_delay(previous: float, failed: bool) -> float:
    """Base interval after a success; double the previous delay (capped) after a failure."""
    return min(previous * 2, POLL_MAX_SECONDS) if failed else POLL_SECONDS


def project_exhaustion(samples: list[tuple[datetime, float]], now: datetime) -> datetime | None:
    """Linear extrapolation of (time, percent) samples to 100%."""
    if len(samples) < 2:
        return None
    (t0, p0), (t1, p1) = samples[0], samples[-1]
    span = (t1 - t0).total_seconds()
    if span < MIN_PROJECTION_SPAN_SECONDS or p1 <= p0:
        return None
    return now + timedelta(seconds=(100.0 - p1) / ((p1 - p0) / span))
