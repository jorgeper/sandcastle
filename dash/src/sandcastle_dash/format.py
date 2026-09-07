"""Formatting helpers shared by the panels and the --once snapshot."""

from __future__ import annotations

from datetime import datetime

from rich.text import Text

# Gruvbox (dark) accents for Rich renderables; the app chrome uses Textual's
# built-in "gruvbox" theme.
GRUVBOX = {
    "green": "#b8bb26",
    "yellow": "#fabd2f",
    "red": "#fb4934",
    "aqua": "#8ec07c",
    "blue": "#83a598",
    "purple": "#d3869b",
    "orange": "#fe8019",
    "gray": "#928374",
    "track": "#504945",
}

# One color per step category (see breakdown.CATEGORIES); the stats bar and
# the Now section share it so "olive = tests" holds everywhere.
CATEGORY_COLOR = {
    "verify": GRUVBOX["green"],
    "edit": GRUVBOX["yellow"],
    "explore": GRUVBOX["blue"],
    "git": GRUVBOX["purple"],
    "think": GRUVBOX["orange"],
    "other": GRUVBOX["gray"],
}

STATUS_GLYPH = {"success": "✓", "failed": "✗", "running": "●", "interrupted": "○"}

KIND_LABELS = {
    "session": "Session (5h)",
    "five_hour": "Session (5h)",
    "seven_day": "Week (all models)",
    "weekly_all": "Week (all models)",
    "weekly_scoped": "Week (Opus/Fable)",
    "seven_day_opus": "Week (Opus)",
    "seven_day_sonnet": "Week (Sonnet)",
}


def limit_label(kind: str) -> str:
    return KIND_LABELS.get(kind, kind.replace("_", " ").title())


def fmt_tokens(n: int) -> str:
    if n >= 1_000_000_000:
        return f"{n / 1e9:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}K"
    return str(n)


def fmt_countdown(delta_seconds: float) -> str:
    """'2h 10m', '1d 3h 5m', or 'now' once the moment has passed."""
    secs = int(delta_seconds)
    if secs <= 0:
        return "now"
    days, rem = divmod(secs, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    return f"{days}d {hours}h {minutes}m" if days else f"{hours}h {minutes}m"


def fmt_when(moment: datetime, now: datetime) -> str:
    """Local weekday + clock, then how far away: 'Sat 23:49 (in 2h 10m)'."""
    countdown = fmt_countdown((moment - now).total_seconds())
    tail = "now" if countdown == "now" else f"in {countdown}"
    return f"{moment.astimezone():%a %H:%M} ({tail})"


def fmt_resets(until: datetime | None, now: datetime) -> str:
    if until is None:
        return ""
    if (until - now).total_seconds() <= 0:
        return "resetting…"
    return f"resets {fmt_when(until, now)}"


def meter(percent: float, width: int = 40) -> Text:
    """A rate-limit bar with its percentage; green under 60, yellow under 85, then red."""
    percent = max(0.0, min(100.0, percent))
    filled = round(width * percent / 100)
    color = GRUVBOX["green"] if percent < 60 else GRUVBOX["yellow"] if percent < 85 else GRUVBOX["red"]
    text = Text()
    text.append("█" * filled, style=color)
    text.append("░" * (width - filled), style=GRUVBOX["track"])
    text.append(f" {percent:3.0f}%", style=f"bold {color}")
    return text

_STATUS_COLOR = {
    "success": GRUVBOX["green"],
    "failed": GRUVBOX["red"],
    "running": GRUVBOX["aqua"],
    "interrupted": GRUVBOX["gray"],
}


def status_style(status: str) -> str:
    return _STATUS_COLOR.get(status, _STATUS_COLOR["interrupted"])


def fmt_duration(ms: float | None) -> str:
    if ms is None:
        return "—"
    secs = ms / 1000
    if secs < 1:
        return f"{secs:.1f}s"
    if secs < 60:
        return f"{int(secs)}s"
    minutes, rem = divmod(int(secs), 60)
    if minutes < 60:
        return f"{minutes}m {rem:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes:02d}m"


def fmt_ago(moment: datetime | None, now: datetime) -> str:
    if moment is None:
        return "—"
    secs = max(0, int((now - moment).total_seconds()))
    if secs < 60:
        return f"{secs}s ago"
    minutes, _ = divmod(secs, 60)
    if minutes < 60:
        return f"{minutes}m ago"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes:02d}m ago"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h ago"


def fmt_clock(moment: datetime | None) -> str:
    return "—" if moment is None else f"{moment.astimezone():%H:%M}"


def segment_bar(parts: list[tuple[str, float, str]], width: int) -> Text:
    """Stacked bar: parts are (key, percent, color). Rounds so the bar always
    fills `width`; an empty list renders an empty track."""
    text = Text()
    total = sum(p for _, p, _ in parts)
    if total <= 0:
        text.append("░" * width, style=GRUVBOX["track"])
        return text
    used = 0
    for i, (_, percent, color) in enumerate(parts):
        cells = width - used if i == len(parts) - 1 else round(width * percent / total)
        text.append("█" * cells, style=color)
        used += cells
    return text
