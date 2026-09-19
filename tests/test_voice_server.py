import json

import httpx
import pytest
from fastapi.testclient import TestClient

from hackmit26.server.app import create_app

ORIGIN = 'chrome-extension://' + 'a' * 32


def body(turn='one'):
    return {'context': {'sessionId': 's', 'turnId': turn, 'generation': 1, 'tabId': 1,
                        'documentId': 'd', 'snapshotVersion': 1},
            'transcript': 'focus name', 'title': 'form',
            'candidates': [{'id': 'focus:1', 'operation': 'focus', 'label': 'Name', 'target': '1'}]}


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv('AI_GATEWAY_API_KEY', 'test-key')
    seen = []

    def provider(request):
        seen.append(request)
        return httpx.Response(200, json={'answers': {'action': {'choice': 'focus:1', 'confidence': .95,
                                          'probabilities': {'focus:1': .95, 'CLARIFY': .03, 'UNSUPPORTED': .02}}},
                                         'usage': {'input_tokens': 10}})
    app = create_app(ORIGIN, 'pair-secret', httpx.MockTransport(provider))
    with TestClient(app, base_url='http://127.0.0.1:8767', headers={'Origin': ORIGIN}) as client:
        token = client.post('/v1/pair', json={'code': 'pair-secret'}).json()['token']
        client.headers['Authorization'] = 'Bearer ' + token
        yield client, app, seen


def test_auth_origin_and_host(api):
    client, _, seen = api
    assert client.post('/v1/decide', json=body(), headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/v1/decide', json=body(), headers={'Host': 'evil.example'}).status_code == 403
    assert client.post('/v1/decide', json=body(), headers={'Authorization': ''}).status_code == 401
    assert not seen


def test_pair_is_single_use_and_expiry(api):
    client, app, _ = api
    assert client.post('/v1/pair', json={'code': 'pair-secret'}).status_code == 403
    next(iter(app.state.sessions.values())).expires = 0
    assert client.post('/v1/decide', json=body()).status_code == 401


def test_choice_contract_no_text_generation_and_no_duplicate_calls(api):
    client, _, seen = api
    result = client.post('/v1/decide', json=body())
    assert result.status_code == 200
    assert result.json()['choice'] == 'focus:1'
    payload = json.loads(seen[0].content)
    assert payload['model'] == 'typesafe-ai/jev'
    assert 'CLARIFY' in payload['questions']['action']['criteria']
    assert client.post('/v1/decide', json=body()).status_code == 409
    assert len(seen) == 1


def test_budget_and_schema_before_provider(api):
    client, app, seen = api
    data = body()
    data['candidates'] *= 199
    assert client.post('/v1/decide', json=data).status_code == 422
    assert client.post('/v1/decide', content='x' * 100001).status_code == 413
    next(iter(app.state.sessions.values())).attempts = 120
    assert client.post('/v1/decide', json=body()).status_code == 429
    assert not seen


def test_invalid_output_and_429_are_not_retried(api):
    client, app, seen = api
    def fail(request):
        seen.append(request)
        return httpx.Response(429, json={'secret': 'must not leak'})
    app.state.client._transport = httpx.MockTransport(fail)
    response = client.post('/v1/decide', json=body())
    assert response.status_code == 502
    assert '429' in response.text and 'must not leak' not in response.text
    assert len(seen) == 1


def test_speech_missing_key_actionable(api, monkeypatch):
    client, _, seen = api
    monkeypatch.delenv('DEEPGRAM_API_KEY', raising=False)
    assert client.post('/v1/speech/token').status_code == 503
    assert not seen


def test_speech_uses_short_lived_token(api, monkeypatch):
    client, app, seen = api
    monkeypatch.setenv('DEEPGRAM_API_KEY', 'permanent-secret')
    def grant(request):
        seen.append(request)
        assert request.headers['Authorization'] == 'Token permanent-secret'
        assert json.loads(request.content) == {'ttl_seconds': 30}
        return httpx.Response(200, json={'access_token': 'temporary', 'expires_in': 30})
    app.state.client._transport = httpx.MockTransport(grant)
    response = client.post('/v1/speech/token')
    assert response.json() == {'access_token': 'temporary', 'expires_in': 30}
    assert 'permanent-secret' not in response.text


def test_health_and_demo_do_not_expose_credentials(api):
    client, _, _ = api
    assert client.get('/health').json()['gateway'] is True
    assert 'test-key' not in client.get('/health').text
    assert client.get('/demo', headers={'Origin': ''}).status_code == 200


def test_disconnect_cancels_inflight_model(monkeypatch):
    import asyncio

    from fastapi import HTTPException

    from hackmit26.server.app import Session
    from hackmit26.server.schemas import DecisionRequest

    monkeypatch.setenv('AI_GATEWAY_API_KEY', 'test-key')
    events = []

    async def slow_provider(request):
        events.append('started')
        try:
            await asyncio.sleep(10)
        finally:
            events.append('cancelled')

    class Disconnected:
        headers = {'authorization': 'Bearer test-session'}
        polls = 0

        async def is_disconnected(self):
            self.polls += 1
            return self.polls > 1

    async def check():
        app = create_app(ORIGIN, 'code')
        app.state.sessions['test-session'] = Session(float('inf'))
        async with httpx.AsyncClient(transport=httpx.MockTransport(slow_provider)) as client:
            app.state.client = client
            endpoint = next(route.endpoint for route in app.routes if route.path == '/v1/decide')
            with pytest.raises(HTTPException) as error:
                await endpoint(DecisionRequest.model_validate(body()), Disconnected())
            assert error.value.status_code == 499
        assert events == ['started', 'cancelled']
    asyncio.run(check())


def test_invented_model_action_cannot_escape_choices(api):
    client, app, _ = api
    app.state.client._transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        'answers': {'action': {'choice': 'invented', 'confidence': 1, 'probabilities': {'invented': 1}}}}))
    assert client.post('/v1/decide', json=body()).status_code == 502


def test_speech_insufficient_permission_explains_member_requirement(api, monkeypatch):
    client, app, _ = api
    monkeypatch.setenv('DEEPGRAM_API_KEY', 'test-speech-secret')
    app.state.client._transport = httpx.MockTransport(lambda request: httpx.Response(
        403, json={'err_code': 'FORBIDDEN', 'err_msg': 'Insufficient permissions.'}))
    response = client.post('/v1/speech/token')
    assert response.status_code == 502
    assert 'Member permission' in response.json()['detail']
    assert 'test-speech-secret' not in response.text


def goal_body(turn='goal'):
    data = body(turn)
    data.update(mode='goal', transcript='My name is Dylan Li; enter it in the form', page_text='Full name')
    data['candidates'] = [{'id': 'type:1', 'operation': 'type', 'target': '1', 'label': 'Full name',
                           'current_value': '', 'required': True}]
    return data


def goal_provider(text='Dylan Li', question=None, truncated=False):
    def respond(request):
        if request.url.path.endswith('systemone'):
            criteria = json.loads(request.content)['questions']['action']['criteria']
            return httpx.Response(200, json={'answers': {'action': {
                'choice': 'type:1', 'confidence': .99,
                'probabilities': {key: int(key == 'type:1') for key in criteria}}},
                'usage': {'input_tokens': 50, 'output_tokens': 10}})
        payload = json.loads(request.content)
        assert payload['reasoning'] == {'enabled': False}
        return httpx.Response(200, json={'choices': [{'finish_reason': 'length' if truncated else 'stop',
            'message': {'content': json.dumps({'text': text, 'question': question})}}],
            'usage': {'prompt_tokens': 30, 'completion_tokens': 5}})
    return respond


def test_goal_prepares_field_text_and_counts_both_models(api):
    client, app, _ = api
    app.state.client._transport = httpx.MockTransport(goal_provider())
    result = client.post('/v1/decide', json=goal_body())
    assert result.status_code == 200
    data = result.json()
    assert data['text'] == 'Dylan Li'
    assert data['attempts'] == 2
    assert data['usage'] == {'input_tokens': 80, 'output_tokens': 15}


def test_goal_missing_information_returns_question_without_text(api):
    client, app, _ = api
    app.state.client._transport = httpx.MockTransport(goal_provider(None, 'What name should I enter?'))
    data = client.post('/v1/decide', json=goal_body()).json()
    assert data['needs_clarification'] is True
    assert data['question'] == 'What name should I enter?'
    assert 'text' not in data


def test_goal_truncated_helper_never_returns_a_field_value(api):
    client, app, _ = api
    app.state.client._transport = httpx.MockTransport(goal_provider(truncated=True))
    assert client.post('/v1/decide', json=goal_body()).status_code == 502


def test_goal_helper_respects_remaining_request_budget(api):
    client, app, _ = api
    next(iter(app.state.sessions.values())).attempts = 119
    app.state.client._transport = httpx.MockTransport(goal_provider())
    assert client.post('/v1/decide', json=goal_body()).status_code == 429


def test_goal_terminal_choices_do_not_generate_text(api):
    client, app, seen = api
    def done(request):
        seen.append(request)
        criteria = json.loads(request.content)['questions']['action']['criteria']
        return httpx.Response(200, json={'answers': {'action': {'choice': 'DONE', 'confidence': 1,
            'probabilities': {key: int(key == 'DONE') for key in criteria}}}})
    app.state.client._transport = httpx.MockTransport(done)
    result = client.post('/v1/decide', json=goal_body())
    assert result.json()['choice'] == 'DONE'
    assert len(seen) == 1


def test_goal_ungrounded_helper_value_requires_clarification(api):
    client, app, _ = api
    app.state.client._transport = httpx.MockTransport(goal_provider('I will fill in the name for you'))
    data = client.post('/v1/decide', json=goal_body()).json()
    assert data['needs_clarification'] is True
    assert 'text' not in data
    assert 'exact value' in data['question']
