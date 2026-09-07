import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sandcastle_dash.usage import Usage, burn_rate, cost_usd, parse_line, rates_for, scan_recent

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def _line(ts: datetime, out: int = 100, mid: str = "m1", req: str = "r1", model: str = "claude-fable-5-1") -> str:
    return json.dumps({
        "type": "assistant", "timestamp": ts.isoformat().replace("+00:00", "Z"), "requestId": req,
        "message": {"id": mid, "model": model, "usage": {
            "input_tokens": 10, "output_tokens": out, "cache_read_input_tokens": 1000,
            "cache_creation": {"ephemeral_5m_input_tokens": 100, "ephemeral_1h_input_tokens": 0}}},
    })


def test_parse_line_reads_usage_and_ignores_the_rest() -> None:
    u = parse_line(_line(NOW))
    assert u and u.output_tokens == 100 and u.cache_read == 1000 and u.key == ("m1", "r1")
    assert parse_line('{"type":"user","timestamp":"2026-09-07T12:00:00Z"}') is None
    assert parse_line("not json") is None


def test_cost_uses_model_rates_and_cache_multipliers() -> None:
    assert rates_for("claude-fable-5-1") == (10.0, 50.0)
    assert rates_for("claude-sonnet-5") == (3.0, 15.0)
    assert rates_for("mystery") == (5.0, 25.0)
    u = Usage(NOW, "claude-fable-5-1", 10, 100, 1000, 100, 0, ("", ""))
    assert abs(cost_usd(u) - (10 * 10 + 100 * 50 + 1000 * 1 + 100 * 12.5) / 1e6) < 1e-12


def test_scan_recent_reads_only_touched_files_and_dedups(tmp_path: Path) -> None:
    fresh = tmp_path / "p" / "a.jsonl"
    fresh.parent.mkdir()
    fresh.write_text("\n".join([
        _line(NOW - timedelta(minutes=5)),
        _line(NOW - timedelta(minutes=5)),  # duplicate key
        _line(NOW - timedelta(minutes=90), mid="old", req="old"),  # outside the window
        _line(NOW - timedelta(minutes=1), mid="m2", req="r2", out=50),
    ]) + "\n")
    stale = tmp_path / "p" / "b.jsonl"
    stale.write_text(_line(NOW - timedelta(minutes=2), mid="m3", req="r3") + "\n")
    old = (NOW - timedelta(hours=3)).timestamp()
    os.utime(stale, (old, old))
    records = scan_recent(tmp_path, NOW)
    assert sorted(u.key for u in records) == [("m1", "r1"), ("m2", "r2")]
    burn = burn_rate(records)
    assert burn.calls == 2 and abs(burn.output_tokens_per_min - 150 / 60) < 1e-9
    assert burn.cost_per_hour > 0
