"""Regression cases from Mercury exhausting its output budget on Flights."""

from unittest.mock import Mock

import pytest

from jev_ultrafast import model


@pytest.mark.parametrize("content", ['{"text": "London"}', '[{"text": "London"}, {"text": null}]'])
def test_truncated_completion_never_becomes_browser_input(monkeypatch, content):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")
    monkeypatch.setattr(model, "post_json", Mock(return_value={"choices": [{
        "finish_reason": "length", "message": {"content": content},
    }]}))
    with pytest.raises(ValueError, match="output limit; nothing typed"):
        model.field_text({"goal": "Fly to London"})


@pytest.mark.parametrize("result", [{"choices": []}, {"choices": [None]}, {"choices": [{}]}])
def test_missing_completion_has_actionable_error(monkeypatch, result):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")
    monkeypatch.setattr(model, "post_json", Mock(return_value=result))
    with pytest.raises(ValueError, match="Choose next to retry"):
        model.field_text({"goal": "Fly to London"})


def test_mercury_returns_field_value_without_reasoning(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")
    monkeypatch.setenv("TEXT_MODEL", "inception/mercury-2.5")
    post = Mock(return_value={"choices": [{"finish_reason": "stop", "message": {"content": '{"text":"London"}'}}]})
    monkeypatch.setattr(model, "post_json", post)
    assert model.field_text({"goal": "Fly to London"})[0] == "London"
    assert post.call_args.args[2]["reasoning"] == {"enabled": False}
