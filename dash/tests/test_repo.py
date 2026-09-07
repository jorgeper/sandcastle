from pathlib import Path

from sandcastle_dash.repo import find_repo, logs_dir


def test_find_repo_walks_up_to_the_logs_dir(tmp_path: Path) -> None:
    (tmp_path / ".sandcastle" / "logs").mkdir(parents=True)
    deep = tmp_path / "src" / "lib"
    deep.mkdir(parents=True)
    assert find_repo(deep) == tmp_path.resolve()
    assert logs_dir(tmp_path) == tmp_path / ".sandcastle" / "logs"


def test_find_repo_returns_none_without_logs(tmp_path: Path) -> None:
    assert find_repo(tmp_path) is None
