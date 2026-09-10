"""The few knobs of .sandcastle/config.mts the dashboard needs, read by
regex over their literal blocks. Never executes the file; a miss is None."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_SPEC_DIR = re.compile(r'export const SPEC_DIR\s*=\s*"([^"]+)"')
_TIERS_BLOCK = re.compile(r"export const EFFORT_TIERS\s*=\s*\[(.*?)\]", re.S)
# Tolerates extra fields between name and model (e.g. harness: "codex").
_TIER = re.compile(r'\{\s*name:\s*"([^"]+)"[^}]*?\bmodel:\s*"([^"]+)"')
_AGENTS_BLOCK = re.compile(r"export const AGENT_TIERS\s*=\s*\{(.*?)\}", re.S)
_AGENT = re.compile(r'^\s*"?([\w-]+)"?\s*:\s*"([^"]+)"', re.M)


@dataclass(frozen=True)
class TemplateConfig:
    tiers: tuple[tuple[str, str], ...] | None
    agent_tiers: dict[str, str] | None
    spec_dir: str | None


def parse_config(text: str) -> TemplateConfig:
    spec = _SPEC_DIR.search(text)
    tiers_block = _TIERS_BLOCK.search(text)
    tiers = tuple(_TIER.findall(tiers_block.group(1))) if tiers_block else None
    agents_block = _AGENTS_BLOCK.search(text)
    agents = None
    if agents_block:
        body = re.sub(r"//[^\n]*", "", agents_block.group(1))
        agents = {role: tier for role, tier in _AGENT.findall(body)}
    return TemplateConfig(
        tiers=tiers or None,
        agent_tiers=agents or None,
        spec_dir=spec.group(1) if spec else None,
    )


def load_config(repo: Path) -> TemplateConfig:
    try:
        return parse_config((repo / ".sandcastle" / "config.mts").read_text(encoding="utf-8"))
    except OSError:
        return parse_config("")
