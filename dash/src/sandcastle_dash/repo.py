"""Locate the repository whose .sandcastle/logs the dashboard reads."""

from __future__ import annotations

from pathlib import Path


def find_repo(start: Path | None = None) -> Path | None:
    """First ancestor (inclusive) of `start` that has a .sandcastle/logs dir."""
    here = (start or Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / ".sandcastle" / "logs").is_dir():
            return candidate
    return None


def logs_dir(repo: Path) -> Path:
    return repo / ".sandcastle" / "logs"
