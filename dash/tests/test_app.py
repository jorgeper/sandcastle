"""Headless boot of the Textual app against fixture logs in a throwaway repo.
No git, no gh: every source degrades, nothing crashes, every section stamps."""

import asyncio
import shutil
from pathlib import Path

from textual.widgets import Collapsible

from sandcastle_dash.app import DashApp

FIXTURES = Path(__file__).parent / "fixtures"


def test_app_boots_renders_and_toggles(tmp_path: Path) -> None:
    logs = tmp_path / ".sandcastle" / "logs"
    logs.mkdir(parents=True)
    for path in (FIXTURES / "logs").iterdir():
        shutil.copy(path, logs / path.name)
    shutil.copy(FIXTURES / "config.mts", tmp_path / ".sandcastle" / "config.mts")

    async def drive() -> None:
        app = DashApp(tmp_path)
        async with app.run_test(size=(120, 40)) as pilot:
            await app.workers.wait_for_complete()
            await pilot.pause()
            titles = {
                cid: app.query_one(f"#sec-{cid}", Collapsible).title
                for cid in ("now", "runs", "queue", "stats")
            }
            assert all("updated" in title for title in titles.values()), titles
            assert "runs" in titles["runs"]
            assert "gh:" in titles["queue"]  # no gh here → the error is named, not fatal
            stats = app.query_one("#sec-stats", Collapsible)
            assert stats.collapsed
            await pilot.press("4")
            assert not stats.collapsed
            await pilot.press("r")
            await app.workers.wait_for_complete()
            await pilot.press("q")

    asyncio.run(drive())
