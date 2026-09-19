"""Project runner contracts; no browser or paid API access."""

import argparse
import json
from unittest.mock import Mock

import pytest

from hackmit26 import cli


@pytest.mark.parametrize("url", ["file:///etc/passwd", "javascript:alert(1)", "https://", "https://u:p@host"])
def test_invalid_url(url):
    with pytest.raises(argparse.ArgumentTypeError):
        cli.web_url(url)


def test_independent_checks():
    page = {"url": "https://example.test/done", "text": "Result: ADA Lovelace"}
    assert all(c["passed"] for c in cli.verify(page, "ada lovelace", page["url"]))
    assert not all(c["passed"] for c in cli.verify(page, "missing", "https://example.test/other"))
    assert cli.verify(page, None, None) == []


@pytest.fixture
def runner(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-only")
    agent = Mock()
    agent.__enter__ = Mock(return_value=agent)
    agent.__exit__ = Mock(return_value=False)
    state = {"status": "done", "history": [], "page": {"url": "https://example.test", "text": "done"},
             "elapsed_ms": 1}
    agent.snapshot.return_value = state
    agent.command.return_value = state
    agent.browser.observe.return_value = state["page"]
    factory = Mock(return_value=agent)
    monkeypatch.setattr(cli, "Agent", factory)
    return agent, factory


def args(tmp_path, **overrides):
    return argparse.Namespace(**{
        "url": "https://example.test", "goal": "Do the task", "max_steps": 3,
        "trace": tmp_path / "trace.jsonl", "screenshots": False, "expect_text": "done", "expect_url": None,
        **overrides,
    })


def test_done_verifies_fresh_page_and_writes_trace(runner, tmp_path):
    agent, _ = runner
    options = args(tmp_path)
    assert cli.run(options) == 0
    agent.browser.observe.assert_called_once_with(screenshot=False)
    agent.__exit__.assert_called_once()
    result = json.loads(options.trace.read_text().splitlines()[-1])["result"]
    assert result["verified"] is True


def test_done_does_not_override_failed_verification(runner, tmp_path):
    agent, _ = runner
    agent.browser.observe.return_value = {"url": "https://example.test", "text": "not ready"}
    assert cli.run(args(tmp_path)) == 2


def test_unverified_done_is_explicit(runner, tmp_path):
    options = args(tmp_path, expect_text=None)
    assert cli.run(options) == 0
    assert json.loads(options.trace.read_text().splitlines()[-1])["result"]["verified"] is None


def test_budget_includes_no_action_cycles(runner, tmp_path):
    agent, _ = runner
    agent.command.return_value["status"] = "ready"
    options = args(tmp_path)
    assert cli.run(options) == 2
    assert agent.command.call_count == 3
    assert json.loads(options.trace.read_text().splitlines()[-1])["result"]["status"] == "budget_exhausted"


def test_runtime_failure_closes_browser(runner, tmp_path):
    agent, _ = runner
    agent.command.side_effect = RuntimeError("provider failure")
    with pytest.raises(RuntimeError, match="provider failure"):
        cli.run(args(tmp_path))
    agent.__exit__.assert_called_once()


def test_missing_key_never_opens_browser(runner, tmp_path, monkeypatch):
    _, factory = runner
    monkeypatch.delenv("AI_GATEWAY_API_KEY")
    with pytest.raises(ValueError, match="AI_GATEWAY_API_KEY"):
        cli.run(args(tmp_path))
    factory.assert_not_called()


def test_existing_trace_is_not_overwritten(runner, tmp_path):
    _, factory = runner
    options = args(tmp_path)
    options.trace.write_text("existing run")
    with pytest.raises(FileExistsError):
        cli.run(options)
    factory.assert_not_called()
    assert options.trace.read_text() == "existing run"
