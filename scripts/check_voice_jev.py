"""Opt-in real Gateway contract and latency probe using synthetic form labels only.

Run: uv run python scripts/check_voice_jev.py
This makes five paid model requests. No audio or personal page content is used.
"""
import json
import secrets
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient

from hackmit26.server.app import create_app

load_dotenv()
origin = 'chrome-extension://' + 'a' * 32
code = secrets.token_urlsafe(16)
app = create_app(origin, code)
candidates = [
    {'id': 'focus:1', 'operation': 'focus', 'target': '1', 'label': 'Full name'},
    {'id': 'focus:2', 'operation': 'focus', 'target': '2', 'label': 'Email address'},
    {'id': 'select:3:1', 'operation': 'select', 'target': '3', 'option': 'code',
     'label': 'Workshop: Creative coding'},
    {'id': 'click:4', 'operation': 'click', 'target': '4', 'label': 'Register for workshop'},
    {'id': 'scroll_down', 'operation': 'scroll_down', 'label': 'Scroll page down'},
]
trials = [('Focus the email field', 'focus:2'), ('Select creative coding', 'select:3:1'),
          ('Focus full name', 'focus:1'), ('Register for the workshop', 'click:4'),
          ('Scroll down', 'scroll_down')]
results = []
with TestClient(app, base_url='http://127.0.0.1:8767', headers={'Origin': origin}) as client:
    token = client.post('/v1/pair', json={'code': code}).json()['token']
    client.headers['Authorization'] = 'Bearer ' + token
    for i, (command, expected) in enumerate(trials):
        started = time.perf_counter()
        response = client.post('/v1/decide', json={
            'context': {'sessionId': 'probe', 'turnId': str(i), 'generation': 1, 'tabId': 1,
                        'documentId': 'fixture', 'snapshotVersion': 0},
            'transcript': command, 'title': 'Workshop registration', 'candidates': candidates})
        data = response.json()
        row = {'command': command, 'http_status': response.status_code, 'choice': data.get('choice'),
               'correct': data.get('choice') == expected, 'confidence': data.get('confidence'),
               'model_ms': data.get('model_ms'), 'total_ms': round((time.perf_counter() - started) * 1000),
               'usage': data.get('usage', {})}
        results.append(row)
        print(json.dumps(row), flush=True)
        time.sleep(1.5)
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/voice-jev-results.json').write_text(json.dumps(results, indent=2) + '\n')
