"""Burn over the last hour from Claude Code transcripts. Ported from
claude-usage-tui (transcripts.py, pricing.py, burn.py) and trimmed: only
transcript files touched since the window opened are read, so the whole
history is never scanned. Pure apart from scan_recent."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_ROOT = Path.home() / ".claude" / "projects"
WINDOW = timedelta(minutes=60)
_SLACK = timedelta(minutes=5)

# USD per million tokens (input, output); substring match, first hit wins.
# Cache multipliers: read 0.1x input, 5m write 1.25x, 1h write 2x. Cached 2026-09.
_RATES: list[tuple[str, float, float]] = [
    ("fable", 10.0, 50.0),
    ("mythos", 10.0, 50.0),
    ("opus-4-1", 15.0, 75.0),
    ("opus-4-2025", 15.0, 75.0),
    ("opus", 5.0, 25.0),
    ("sonnet", 3.0, 15.0),
    ("haiku-4", 1.0, 5.0),
    ("haiku-3-5", 0.8, 4.0),
    ("haiku", 0.25, 1.25),
]
_FALLBACK = (5.0, 25.0)


@dataclass(frozen=True)
class Usage:
    timestamp: datetime
    model: str
    input_tokens: int
    output_tokens: int
    cache_read: int
    cache_5m: int
    cache_1h: int
    key: tuple[str, str]


@dataclass(frozen=True)
class Burn:
    output_tokens_per_min: float
    cost_per_hour: float
    calls: int


def rates_for(model: str) -> tuple[float, float]:
    return next(((i, o) for needle, i, o in _RATES if needle in model), _FALLBACK)


def cost_usd(u: Usage) -> float:
    inp, out = rates_for(u.model)
    return (
        u.input_tokens * inp + u.output_tokens * out + u.cache_read * inp * 0.1
        + u.cache_5m * inp * 1.25 + u.cache_1h * inp * 2.0
    ) / 1e6


def parse_line(line: str) -> Usage | None:
    """An assistant line with usage → Usage; anything else → None."""
    try:
        data = json.loads(line)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or data.get("type") != "assistant":
        return None
    message = data.get("message") or {}
    usage = message.get("usage")
    if not usage:
        return None
    try:
        ts = datetime.fromisoformat(str(data.get("timestamp")).replace("Z", "+00:00"))
    except ValueError:
        return None
    create = usage.get("cache_creation") or {}
    return Usage(
        timestamp=ts.astimezone(timezone.utc),
        model=str(message.get("model", "")),
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        cache_read=int(usage.get("cache_read_input_tokens") or 0),
        cache_5m=int(create.get("ephemeral_5m_input_tokens") or 0),
        cache_1h=int(create.get("ephemeral_1h_input_tokens") or 0),
        key=(str(message.get("id", "")), str(data.get("requestId", ""))),
    )


def scan_recent(root: Path, now: datetime, window: timedelta = WINDOW) -> list[Usage]:
    """Usage records inside the window, from files modified since it opened.
    Dedups by (message id, request id): continued sessions copy lines."""
    since = now - window
    cutoff = (since - _SLACK).timestamp()
    seen: set[tuple[str, str]] = set()
    out: list[Usage] = []
    try:
        paths = list(root.glob("**/*.jsonl"))
    except OSError:
        return out
    for path in paths:
        try:
            if path.stat().st_mtime < cutoff:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for raw in text.splitlines():
            if '"assistant"' not in raw:
                continue
            u = parse_line(raw)
            if u is None or u.timestamp < since:
                continue
            if u.key != ("", ""):
                if u.key in seen:
                    continue
                seen.add(u.key)
            out.append(u)
    return out


def burn_rate(records: list[Usage], minutes: int = 60) -> Burn:
    out = sum(u.output_tokens for u in records)
    cost = sum(cost_usd(u) for u in records)
    return Burn(out / minutes, cost * 60 / minutes, len(records))
