import io
import urllib.error
from datetime import datetime, timedelta, timezone
from email.message import Message

from sandcastle_dash.limits import (
    POLL_MAX_SECONDS,
    POLL_SECONDS,
    describe_error,
    next_poll_delay,
    parse_usage_payload,
    project_exhaustion,
)

SAMPLE = {
    "limits": [
        {"kind": "session", "percent": 52, "severity": "normal", "resets_at": "2026-09-06T06:10:00+00:00", "is_active": True},
        {"kind": "seven_day", "percent": 26, "severity": "normal", "resets_at": "2026-09-07T12:00:00+00:00", "is_active": True},
        {"kind": "weekly_scoped", "percent": 44, "severity": "normal", "resets_at": "2026-09-07T12:00:00+00:00", "is_active": False},
    ]
}


def test_parses_all_limits_including_inactive() -> None:
    limits = parse_usage_payload(SAMPLE)
    assert [l.kind for l in limits] == ["session", "seven_day", "weekly_scoped"]
    assert limits[0].percent == 52 and limits[0].resets_at.day == 6


def test_falls_back_to_legacy_fields() -> None:
    (limit,) = parse_usage_payload({"five_hour": {"utilization": 10.0, "resets_at": "2026-09-06T06:10:00+00:00"}})
    assert limit.kind == "session" and limit.percent == 10.0


def test_describe_error_variants() -> None:
    body = io.BytesIO(b'{"error": {"type": "rate_limit_error", "message": "x"}}')
    exc = urllib.error.HTTPError("https://x", 429, "Too Many Requests", Message(), body)
    assert describe_error(exc) == "HTTP 429 Too Many Requests · rate_limit_error"
    exc = urllib.error.HTTPError("https://x", 502, "Bad Gateway", Message(), io.BytesIO(b"<html>"))
    assert describe_error(exc) == "HTTP 502 Bad Gateway"
    assert describe_error(TimeoutError("timed out")) == "TimeoutError: timed out"
    assert describe_error(KeyError()) == "KeyError"


def test_poll_delay_backs_off_and_resets() -> None:
    d1 = next_poll_delay(POLL_SECONDS, failed=True)
    d2 = next_poll_delay(d1, failed=True)
    assert d1 == POLL_SECONDS * 2 and d2 == POLL_MAX_SECONDS
    assert next_poll_delay(d2, failed=True) == POLL_MAX_SECONDS
    assert next_poll_delay(d2, failed=False) == POLL_SECONDS


def test_project_exhaustion_extrapolates_linearly() -> None:
    now = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
    samples = [(now - timedelta(minutes=10), 40.0), (now, 50.0)]
    assert project_exhaustion(samples, now) == now + timedelta(minutes=50)
    assert project_exhaustion([(now, 50.0)], now) is None
    assert project_exhaustion([(now - timedelta(seconds=60), 40.0), (now, 50.0)], now) is None
    assert project_exhaustion([(now - timedelta(minutes=10), 50.0), (now, 50.0)], now) is None
