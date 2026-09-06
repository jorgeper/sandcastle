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

STATUS_GLYPH = {"success": "✓", "failed": "✗", "running": "●", "interrupted": "○"}

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
