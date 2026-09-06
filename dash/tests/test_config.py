from pathlib import Path

from sandcastle_dash.config import load_config, parse_config

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_config_reads_the_three_blocks() -> None:
    cfg = parse_config((FIXTURES / "config.mts").read_text())
    assert cfg.spec_dir == "issue-specs"
    assert cfg.tiers == (("normal", "claude-opus-5"), ("hard", "claude-fable-5-1"))
    assert cfg.agent_tiers is not None
    assert cfg.agent_tiers["spec-writer"] == "hard"
    assert cfg.agent_tiers["planner"] == "normal"
    assert len(cfg.agent_tiers) == 11


def test_parse_config_degrades_to_none() -> None:
    cfg = parse_config('export const SPEC_DIR = "specs";\n')
    assert cfg.spec_dir == "specs" and cfg.tiers is None and cfg.agent_tiers is None


def test_load_config_without_a_file(tmp_path: Path) -> None:
    cfg = load_config(tmp_path)
    assert cfg == parse_config("")
