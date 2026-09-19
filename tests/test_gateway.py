"""Vercel HTTP contracts, without credentials or network calls."""

import json

import httpx
import pytest

from jev_ultrafast import model


def test_both_models_use_gateway_bearer_key(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "gateway-test-key")
    monkeypatch.delenv("JEV_MODEL", raising=False)
    monkeypatch.delenv("TEXT_MODEL", raising=False)
    # Legacy keys/endpoints must never receive the Gateway key or control routing.
    monkeypatch.setenv("TYPESAFE_API_KEY", "legacy-typesafe")
    monkeypatch.setenv("TEXT_MODEL_API_KEY", "legacy-text")
    monkeypatch.setenv("TEXT_MODEL_BASE_URL", "https://legacy.invalid")
    requests = []

    def handle(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer gateway-test-key"
        body = json.loads(request.content)
        if request.url.path == "/typesafe/v1/systemone":
            assert body["model"] == "typesafe-ai/jev"
            assert "state" in body and "questions" in body
            criteria = body["questions"]["operation"]["criteria"]
            return httpx.Response(200, json={
                "model": body["model"],
                "answers": {"operation": {
                    "choice": "DONE", "confidence": .9,
                    "probabilities": {key: float(key == "DONE") for key in criteria},
                }},
                "usage": {"input_tokens": 10},
            })
        assert request.url.path == "/v1/chat/completions"
        assert body["model"] == "inception/mercury-2.5"
        assert body["reasoning"] == {"enabled": False}
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text":"Boston"}'}}]})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(model, "CLIENT", client)
        decision = model.choose({"actions": [], "url": "https://example.test", "title": "Done", "text": "Done"},
                                "Finish", [])
        text, helper = model.field_text({"goal": "Enter Boston"})
    assert decision["choice"] == "DONE"
    assert decision["confidence"] == .9
    assert decision["usage"] == {"input_tokens": 10}
    assert text == "Boston"
    assert [str(r.url) for r in requests] == [
        "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
        "https://ai-gateway.vercel.sh/v1/chat/completions",
    ]
    assert "gateway-test-key" not in json.dumps([decision, helper])


@pytest.mark.parametrize("key", ["", "   "])
def test_empty_gateway_key_rejected(monkeypatch, key):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", key)
    with pytest.raises(ValueError, match="AI_GATEWAY_API_KEY"):
        model.gateway_key()


def test_gateway_auth_error_does_not_expose_provider_body(monkeypatch):
    def handle(request):
        return httpx.Response(401, json={"error": "private provider error"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(model, "CLIENT", client)
        with pytest.raises(RuntimeError, match="HTTP 401") as error:
            model.post_json(model.GATEWAY_URL + "/typesafe/v1/systemone", "secret", {})
    assert "secret" not in str(error.value)
    assert "private" not in str(error.value)
