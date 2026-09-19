"""Expired dashboard tokens must never execute browser commands."""

import threading
from unittest.mock import Mock

import httpx
import pytest

from jev_ultrafast import demo


@pytest.fixture
def server(monkeypatch):
    command = Mock(return_value={"status": "ready"})
    monkeypatch.setattr(demo, "command", command)
    server = demo.ThreadingHTTPServer(("127.0.0.1", 0), demo.Handler)
    monkeypatch.setattr(demo, "PORT", server.server_port)
    origin = f"http://127.0.0.1:{server.server_port}"
    monkeypatch.setattr(demo, "ORIGIN", origin)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        with httpx.Client(base_url=origin) as client:
            yield client, command, origin
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


def test_expired_token_explains_refresh_without_execution(server):
    client, command, origin = server
    response = client.post('/api/tick', headers={'Origin': origin, 'X-Demo-Token': 'old-token'}, json={})
    assert response.status_code == 403
    assert response.json()['code'] == 'session_expired'
    command.assert_not_called()
    assert demo.TOKEN in client.get('/').text


def test_cross_origin_stays_blocked_even_with_valid_token(server):
    client, command, _ = server
    response = client.post('/api/tick', headers={
        'Origin': 'https://other.example', 'X-Demo-Token': demo.TOKEN,
    }, json={})
    assert response.status_code == 403
    assert 'code' not in response.json()
    command.assert_not_called()


def test_current_token_executes_once(server):
    client, command, origin = server
    response = client.post('/api/tick', headers={'Origin': origin, 'X-Demo-Token': demo.TOKEN}, json={})
    assert response.status_code == 200
    command.assert_called_once_with('tick', {})
