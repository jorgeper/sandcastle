from datetime import datetime, timedelta, timezone

from sandcastle_dash.activity import (
    activity_buckets,
    bucket_categories,
    doing,
    duration_bar,
    heartbeat,
    line_category,
    line_stamps,
    recent_lines,
    sparkline,
    stamped_lines,
)
from sandcastle_dash.logs import Run
from sandcastle_dash.stats import PhaseStat

UTC = timezone.utc
NOW = datetime(2026, 9, 6, 23, 10, 0, tzinfo=UTC)


def _run(text: str, started: datetime | None = NOW - timedelta(minutes=5)) -> Run:
    return Run("x.log", 0, "implementer", "issue", "31", "running", started, None, None,
               None, None, "", NOW, None, text)


def test_line_stamps_resolve_against_the_run_start() -> None:
    run = _run("[23:05:10] Read(a)\n[23:09:59] Edit(b)\nno stamp here\n")
    assert line_stamps(run) == [NOW - timedelta(minutes=4, seconds=50), NOW - timedelta(seconds=1)]
    assert line_stamps(_run("[23:05:10] x", started=None)) == []


def test_recent_lines_skips_blanks_and_the_run_marker() -> None:
    run = _run("--- Run started: x ---\n[23:05:10] a\n\n[23:05:11] b\n[23:05:12] c\n[23:05:13] d\n")
    assert recent_lines(run) == ["[23:05:11] b", "[23:05:12] c", "[23:05:13] d"]
    assert recent_lines(_run("")) == []


def test_activity_buckets_count_lines_oldest_first() -> None:
    stamps = [NOW - timedelta(seconds=s) for s in (1, 5, 40, 299, 301)]
    counts = activity_buckets(stamps, NOW)
    assert len(counts) == 10
    assert counts[-1] == 2 and counts[-2] == 1 and counts[0] == 1  # 301s is outside the strip
    assert sum(counts) == 4


def test_sparkline_scales_to_the_busiest_bucket() -> None:
    assert sparkline([0, 1, 7, 14]).plain == "▁▁▅█"
    assert sparkline([0, 0]).plain == "▁▁"


def test_heartbeat_fades_with_silence() -> None:
    fresh = heartbeat(NOW - timedelta(seconds=1), NOW)
    stale = heartbeat(NOW - timedelta(seconds=8), NOW)
    silent = heartbeat(NOW - timedelta(seconds=30), NOW)
    assert fresh.plain == "●" and "bold" in str(fresh.style)
    assert stale.plain == "●" and str(stale.style) != str(fresh.style)
    assert silent.plain == "○"


def test_duration_bar_fills_toward_median_then_warns() -> None:
    stat = PhaseStat("implementer", 5, 5, 600_000, 1_200_000)
    half = duration_bar(300_000, stat)
    assert half.plain == "█████░░░░░" and "#b8bb26" in str(half.spans[0].style)
    over = duration_bar(700_000, stat)
    assert over.plain == "██████████" and "#fabd2f" in str(over.spans[0].style)
    beyond = duration_bar(1_300_000, stat)
    assert "#fb4934" in str(beyond.spans[0].style)
    assert duration_bar(300_000, None).plain == "░░░░░░░░░░"
    assert duration_bar(None, stat).plain == "░░░░░░░░░░"


def test_stamped_lines_and_doing_classify_the_newest_line() -> None:
    run = _run("[23:05:10] Read(a.ts)\n[23:09:30] Bash(npm run validate:quick)\n")
    assert [c for _, c in stamped_lines(run)] == ["explore", "verify"]
    label, age = doing(run, NOW)
    assert label == "tests / verify" and age == timedelta(seconds=30)
    assert doing(_run("no stamps"), NOW) is None
    assert line_category("[23:05:10] Edit(x)") == "edit" and line_category("hmm") == "think"


def test_bucket_categories_pick_the_dominant_one_and_color_the_sparkline() -> None:
    stamped = [
        (NOW - timedelta(seconds=5), "explore"),
        (NOW - timedelta(seconds=8), "verify"),
        (NOW - timedelta(seconds=9), "verify"),
        (NOW - timedelta(seconds=40), "think"),
    ]
    cats = bucket_categories(stamped, NOW)
    assert cats[-1] == "verify" and cats[-2] == "think" and cats[0] is None
    text = sparkline(activity_buckets([m for m, _ in stamped], NOW), cats)
    styles = [str(sp.style) for sp in text.spans]
    assert styles[-1] == "#b8bb26" and styles[-2] == "#fe8019"
