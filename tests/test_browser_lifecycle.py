"""Closing an already-closed demo tab must not prevent the next run."""

from unittest.mock import Mock

import pytest

from jev_ultrafast import browser, demo


def test_reset_recovers_after_user_closed_previous_tab(monkeypatch):
    old_browser = browser.Browser.__new__(browser.Browser)
    old_browser.target = "closed-tab"
    cdp = Mock(side_effect=RuntimeError("{'code': -32602, 'message': 'No target with given id found'}"))
    monkeypatch.setattr(browser, "cdp", cdp)
    old_agent = Mock(close=old_browser.close)
    monkeypatch.setattr(demo, "AGENT", old_agent)
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")
    new_agent = Mock()
    new_agent.state = {}
    new_agent.snapshot.return_value = {"status": "ready"}
    factory = Mock(return_value=new_agent)
    monkeypatch.setattr(demo, "Agent", factory)

    result = demo.command("reset", {"scenario": "flights", "goal": "Find flights, without booking"})

    assert result["status"] == "ready"
    assert demo.AGENT is new_agent
    assert factory.call_args.args[0] == "https://www.google.com/travel/flights?hl=en"
    assert old_browser.target is None
    old_browser.close()
    cdp.assert_called_once_with("Target.closeTarget", targetId="closed-tab")


def test_close_does_not_swallow_other_connection_errors(monkeypatch):
    instance = browser.Browser.__new__(browser.Browser)
    instance.target = "tab"
    monkeypatch.setattr(browser, "cdp", Mock(side_effect=RuntimeError("Connection lost")))
    with pytest.raises(RuntimeError, match="Connection lost"):
        instance.close()
    assert instance.target == "tab"
