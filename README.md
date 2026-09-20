# HackMIT 26 — Sift reimbursement project

The current hackathon project lives in **[reconciliation/](reconciliation/README.md)**.
It includes receipt intake, Jev reconciliation, scoped correction learning, and an organizer dashboard.

For the new Sift interface, follow [the current build instructions](BUILD_INSTRUCTIONS.md) and open `/business-demo?preview=1`. The UI uses the v2 contract; the backend upgrade is still pending. Preview data and learning results are explicitly simulated.

```sh
cd reconciliation
npm ci
npm run demo:jev
```

`demo:jev` can reuse the existing Gateway key and makes live Jev calls; `npm run demo`
is the no-credential, fully simulated alternative. Open http://127.0.0.1:3000/demo.
See the linked guide for live OpenAI/Supabase/Elasticsearch setup and verification.

The original browser prototype is preserved below and on `codex/jev-browser-agent`.

## Original Jev browser agent

## Voice extension

The new Chrome extension supports typed and spoken commands, Jev action selection
through Vercel AI Gateway, numbered page targets, direct dictation, guarded field
undo, and submission confirmation. It uses content scripts and does not need
Chrome remote debugging. **[Setup and commands](docs/VOICE_EXTENSION.md)** ·
[Implementation plan](docs/VOICE_EXTENSION_PLAN.md) · [Measured results](docs/voice-demo-results.md).

Live speech requires a `DEEPGRAM_API_KEY`; the typed path uses the existing Gateway key.


A working starter for natural-language browser tasks using TypeSafe's **Jev** and
**Browser Use's Browser Harness**. The browser executor runs in local Chrome;
Jev chooses structured operations and indexed DOM targets. An OpenAI-compatible
text model is called only when a field needs text.

Adapted from [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast).
See [third-party attribution](THIRD_PARTY_NOTICES.md). This uses Browser Use's
Browser Harness, not the separate `browser-use.Agent` LLM loop or Browserbase cloud.

## Setup

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and desktop Google Chrome.

```sh
uv sync
cp .env.example .env
# Set AI_GATEWAY_API_KEY in .env.
uv run browser-harness --doctor
```

The doctor command explains how to connect Chrome; enable remote debugging when
prompted. Browser Harness opens and closes an owned tab in your existing Chrome
profile, so the agent can access that profile's signed-in sites.

Create an [AI Gateway API key](https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys)
and set `AI_GATEWAY_API_KEY` in `.env`. This single key authenticates both models:

- Jev: `typesafe-ai/jev`, configurable with `JEV_MODEL`, via
  `https://ai-gateway.vercel.sh/typesafe/v1/systemone`.
- Text helper: `inception/mercury-2.5`, configurable with `TEXT_MODEL`, via
  `https://ai-gateway.vercel.sh/v1/chat/completions`.

The [TypeSafe-compatible Gateway API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)
preserves the structured questions, answers, and probabilities used by our Python
agent. The text helper uses Gateway's OpenAI-compatible API only for `TYPE_TEXT`.
No separate TypeSafe or OpenRouter key is needed. Environment variables override
`.env`; the key stays server-side and is never included in inspector responses or
traces. Legacy `TYPESAFE_API_KEY`, `TEXT_MODEL_API_KEY`, `TEXT_MODEL_BASE_URL`, and
`TEXT_MODEL_REASONING` settings are no longer used.

## Run a task

```sh
uv run hackmit run \
  --url https://en.wikipedia.org/wiki/Main_Page \
  --goal 'Find and open the Wikipedia article about Ada Lovelace.' \
  --expect-url https://en.wikipedia.org/wiki/Ada_Lovelace \
  --expect-text 'Ada Lovelace' \
  --max-steps 30 \
  --trace artifacts/ada.jsonl
```

Progress is emitted as JSON, followed by a final result. `--max-steps` bounds all
decision cycles, including stale-page retries and waits. The browser tab closes
on completion, error, or interruption. Each model request has a 25-second timeout;
transient provider errors have bounded retries. Browser mutations are not retried.

Exit codes: **0** model returned DONE and any supplied checks passed; **2** blocked,
budget exhausted, or failed checks; **1** configuration/runtime error; **130** interrupted.
Without checks, `verified` is `null`: DONE is a model prediction, not proof of success.
Checks read fresh final visible text or compare the exact URL; add task-specific
verification for more complex outcomes. Traces require a new filename and contain
page text, decisions, and typed values. Keep them private; `artifacts/` is ignored.

## Visual inspector

```sh
uv run hackmit demo
# Alias: uv run jev
```

Open [127.0.0.1:8766](http://127.0.0.1:8766). The upstream inspector includes local
travel/research fixtures and a Google Flights scenario. Choose a scenario, start,
then step through predictions or run automatically. It shows observed elements,
screenshots, action probabilities, timings, and execution history. The fixtures
are local, but predictions still call paid model APIs. The historical upstream
flight date is an example; update the goal to a future date before using it.
Use the CLI for arbitrary URLs and goals.

### Google Snake: Jev plays

Choose **Google Snake · Jev plays (paced)**, click **Start demo**, then **Run
automatically**. You can also use **Choose next → Execute choice** to inspect each
direction. The example opens the actual Google Snake in a separate, temporary
browser context and reads the classic board from its canvas pixels. Jev chooses
each arrow direction through Vercel Gateway; Mercury is not used. Code filters
immediately occupied cells, walls, and reverse turns but does not choose a path.

This is **paced gameplay**: Chrome's virtual clock pauses while Jev thinks and
advances in small increments for each move. It is not a native-speed gameplay or
sub-100ms benchmark. The inspector shows the actual canvas, direction probabilities,
score, and history. Requests are spaced at least 1.25 seconds apart to reduce
Gateway rate limiting; account limits can still apply. Pause stops future moves;
one in-flight move may finish.

The run stops when the observed score reaches **3 apples**, after **150 model
decisions**, or when no safe move/progress is observed. Editing the goal changes
Jev's instructions, not those fixed limits. It supports only Google's standard
17 × 15 board, blue snake, and red apple. Changed themes, settings, overlays, or
Google implementation changes may prevent board recognition. This game-specific
adapter does not add arbitrary canvas support to the general DOM agent.

```sh
uv run --env-file .env python examples/snake.py
```

## Python API

```python
from dotenv import load_dotenv
from hackmit26 import Agent

load_dotenv()
with Agent("https://en.wikipedia.org/wiki/Main_Page", "Open the Ada Lovelace article") as agent:
    for state in agent.run():
        print(state["status"], state["page"]["url"])
```

The library has an internal 60-action / 120-decision budget. The CLI adds its own
tighter cycle budget. The local inspector is loopback-only, with host/origin and
request-token checks; it is a developer tool, not a multi-user hosted service.

## Architecture

`browser.py` + `snapshot.js` observe visible DOM controls in one read and preserve
node identity. `model.py` submits one Jev request containing the operation and
compatible target questions. Only the target corresponding to the chosen operation
is used. `agent.py` validates freshness, obtains text if necessary, executes, logs,
and observes again. `hackmit26/cli.py` adds configuration checks, task input, budgets,
JSONL traces, and final verification.

Supported operations: click, type, native select, scroll, wait, done, blocked.
Targets must come from observed DOM nodes; model output never becomes executable
JavaScript or selectors. Changed/covered controls are rejected before input.
The inherited MVP does not cover frames, shadow DOM, canvas, uploads, popup tabs,
nested scrolling, or arbitrary keyboard widgets. Live reliability and latency
depend on Gateway model availability, the website, and model providers.

## Development

```sh
uv run ruff check .
uv run pytest
node --check jev_ultrafast/snapshot.js
node --check jev_ultrafast/static/app.js
uv build
# Real Chrome checks, no model calls:
uv run python scripts/check_guards.py
```

CI runs offline contracts and packaging checks. Model tests mock provider responses;
they do not demonstrate live Jev quality or make paid API calls. Optional upstream
video-rendering scripts require Pillow (available transitively through Browser Harness).
