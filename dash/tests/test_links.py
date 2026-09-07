from sandcastle_dash.links import issue_link, issue_url, link_text, pr_url

BASE = "https://github.com/jorgeper/marky-mark"


def test_urls_follow_github_layout() -> None:
    assert issue_url(BASE, 31) == f"{BASE}/issues/31"
    assert pr_url(BASE, "7") == f"{BASE}/pull/7"
    assert issue_url(None, 31) is None


def test_link_text_carries_click_action_and_osc8_link() -> None:
    text = link_text("#31", f"{BASE}/issues/31", "bold")
    span_style = text.spans[0].style if text.spans else text.style
    assert span_style.link == f"{BASE}/issues/31"
    assert span_style.meta["@click"] == f"app.open('{BASE}/issues/31')"
    assert span_style.bold
    assert text.plain == "#31"


def test_link_text_without_url_is_plain() -> None:
    text = link_text("#31", None, "bold")
    assert text.plain == "#31" and text.style == "bold"


def test_issue_link_falls_back_to_scope() -> None:
    assert issue_link(None, BASE, fallback="main").plain == "main"
    assert issue_link("31", BASE).plain == "#31"
