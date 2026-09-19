"""Opt-in browser test bridge to the real backend and paid Gateway models.

Only synthetic fixture commands are used by the live browser tests.
"""
import json
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient

from hackmit26.server.app import create_app

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
origin = 'chrome-extension://' + 'a' * 32
code = secrets.token_urlsafe(16)
with TestClient(create_app(origin, code), base_url='http://127.0.0.1:8767', headers={'Origin': origin}) as client:
    token = client.post('/v1/pair', json={'code': code}).json()['token']
    client.headers['Authorization'] = 'Bearer ' + token
    for line in sys.stdin:
        request = json.loads(line)
        response = client.post('/v1/decide', json=request['body'])
        print(json.dumps({'id': request['id'], 'status': response.status_code, 'body': response.json()}), flush=True)
