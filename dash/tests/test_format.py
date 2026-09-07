from datetime import datetime, timedelta, timezone

from sandcastle_dash.format import fmt_ago, fmt_duration, segment_bar, status_style


def test_fmt_duration_scales() -> None:
    assert fmt_duration(None) == "—"
    assert fmt_duration(900) == "0.9s"
    assert fmt_duration(42_000) == "42s"
    assert fmt_duration(152_210) == "2m 32s"
    assert fmt_duration(3_725_000) == "1h 02m"


def test_fmt_ago_is_coarse() -> None:
    now = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
    assert fmt_ago(None, now) == "—"
    assert fmt_ago(now - timedelta(seconds=20), now) == "20s ago"
    assert fmt_ago(now - timedelta(minutes=7, seconds=30), now) == "7m ago"
    assert fmt_ago(now - timedelta(hours=3, minutes=5), now) == "3h 05m ago"
    assert fmt_ago(now - timedelta(days=2, hours=1), now) == "2d 1h ago"


def test_status_style_names_a_color_per_status() -> None:
    assert status_style("success") != status_style("failed")
    assert status_style("unknown") == status_style("interrupted")


def test_segment_bar_fills_the_width() -> None:
    bar = segment_bar([("a", 50, "red"), ("b", 50, "green")], width=10)
    assert bar.plain == "█████" + "█████"
    assert segment_bar([], width=10).plain == "░" * 10


def test_meter_and_reset_formatting() -> None:
    from datetime import datetime, timedelta, timezone

    from sandcastle_dash.format import fmt_resets, fmt_tokens, limit_label, meter

    now = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
    assert meter(3, width=10).plain == "░░░░░░░░░░   3%"
    assert meter(90, width=10).plain == "█████████░  90%"
    assert fmt_resets(now + timedelta(hours=4, minutes=50), now).startswith("resets ")
    assert fmt_resets(now + timedelta(hours=4, minutes=50), now).endswith("(in 4h 50m)")
    assert fmt_resets(now - timedelta(seconds=1), now) == "resetting…" and fmt_resets(None, now) == ""
    assert limit_label("weekly_scoped") == "Week (Opus/Fable)" and limit_label("odd_kind") == "Odd Kind"
    assert fmt_tokens(701) == "701" and fmt_tokens(1500) == "1.5K"
