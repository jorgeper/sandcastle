"""Clickable issue and PR references. A link carries two mechanisms at
once: a Textual `@click` action, which the app resolves to open_url in any
terminal with mouse support, and a Rich `link` style (OSC 8), which
terminals such as iTerm2 and Kitty open on Cmd/Ctrl+click natively.
Without a base URL every helper degrades to plain text."""

from __future__ import annotations

from rich.style import Style
from rich.text import Text

OPEN_ACTION = "app.open"


def issue_url(base: str | None, number: int | str) -> str | None:
    return f"{base}/issues/{number}" if base else None


def pr_url(base: str | None, number: int | str) -> str | None:
    return f"{base}/pull/{number}" if base else None


def link_text(label: str, url: str | None, style: str = "") -> Text:
    """`label` styled with `style`; clickable when `url` is given."""
    if not url:
        return Text(label, style=style)
    base = Style.parse(style) if style else Style()
    click = Style(link=url, meta={"@click": f"{OPEN_ACTION}({url!r})"}, underline=False)
    return Text(label, style=base + click)


def issue_link(number: int | str | None, base: str | None, style: str = "", fallback: str = "") -> Text:
    """'#31' linking to the issue, or `fallback` (e.g. a run's scope) unlinked."""
    if number is None or number == "":
        return Text(fallback, style=style)
    return link_text(f"#{number}", issue_url(base, number), style)
