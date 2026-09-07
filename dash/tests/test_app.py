"""Headless boot of the Textual app against fixture logs in a throwaway repo.
No git, no gh: every source degrades, nothing crashes, every section stamps."""

import asyncio
import shutil
from pathlib import Path

from textual.widgets import Collapsible

from sandcastle_dash.app import DashApp
from sandcastle_dash.limits import Limit

FIXTURES = Path(__file__).parent / "fixtures"


def test_app_boots_renders_and_toggles(tmp_path: Path) -> None:
    logs = tmp_path / ".sandcastle" / "logs"
    logs.mkdir(parents=True)
    for path in (FIXTURES / "logs").iterdir():
        shutil.copy(path, logs / path.name)
    shutil.copy(FIXTURES / "config.mts", tmp_path / ".sandcastle" / "config.mts")

    async def drive() -> None:
        calls = {"n": 0}

        def fake_fetch() -> list[Limit]:
            calls["n"] += 1
            if calls["n"] == 1:
                raise TimeoutError("timed out")
            return [Limit("session", 3.0), Limit("weekly_scoped", 1.0)]

        app = DashApp(tmp_path, fetch=fake_fetch, transcripts=tmp_path / "no-transcripts")
        async with app.run_test(size=(120, 40)) as pilot:
            await app.workers.wait_for_complete()
            await pilot.pause()
            titles = {
                cid: app.query_one(f"#sec-{cid}", Collapsible).title
                for cid in ("limits", "now", "runs", "queue", "resolved", "stats")
            }
            assert all("updated" in title for title in titles.values()), titles
            # first poll failed: the error is named, the next poll is armed with backoff
            assert "unavailable: TimeoutError: timed out" in titles["limits"] and "next" in titles["limits"]
            assert app._limits_delay == 60 * 60
            await pilot.press("r")
            await app.workers.wait_for_complete()
            await pilot.pause()
            limits_title = app.query_one("#sec-limits", Collapsible).title
            assert "live · Session (5h) 3%" in limits_title and app._limits_delay == 30 * 60
            titles["stats"] = app.query_one("#sec-stats", Collapsible).title
            assert "runs" in titles["runs"]
            assert "gh:" in titles["queue"]  # no gh here → the error is named, not fatal
            stats = app.query_one("#sec-stats", Collapsible)
            assert stats.collapsed
            await pilot.press("6")
            assert not stats.collapsed
            assert "resolved" in titles["resolved"]
            # the fixture log is running → the live cache holds phase stats for the bar
            assert app._live is not None and "implementer" in app._live[2]
            await pilot.pause(0.6)  # a tick redraws without error
            opened: list[str] = []
            app.open_url = lambda url, **kw: opened.append(url)  # type: ignore[method-assign]
            app.base_url = "https://github.com/x/y"
            await pilot.press("o")
            assert opened == ["https://github.com/x/y/issues/31"]
            # a click on a linked "#31" dispatches this action through the app namespace
            await app.run_action("app.open('https://github.com/x/y/issues/31')")
            assert opened[-1] == "https://github.com/x/y/issues/31"
            await pilot.press("r")
            await app.workers.wait_for_complete()
            await pilot.press("q")

    asyncio.run(drive())
