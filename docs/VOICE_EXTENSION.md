# Jev browser extension

Jev follows the active Google Chrome tab. Speak or type a goal against the website
you are using; the practice form is only a test fixture. The extension uses a
local backend, Jev through Vercel AI Gateway, and Deepgram Flux for speech.

## Install and run

```sh
uv sync --locked
npm ci --prefix extension
npm run build --prefix extension
```

1. In `chrome://extensions`, enable Developer mode and load `extension/dist` as an
   unpacked extension. Copy its extension ID.
2. Start the backend: `uv run hackmit serve --extension-id YOUR_EXTENSION_ID`.
   `.env` holds `AI_GATEWAY_API_KEY` and `DEEPGRAM_API_KEY`; permanent keys never
   enter the extension. Deepgram token issuance requires Member permission.
3. Open the Jev panel and enter the single-use pairing code printed in the terminal.
4. Open an ordinary website. Click **Allow website access** and accept Chrome's
   permission prompt. This optional grant allows use across HTTP/HTTPS websites;
   Chrome's own site-access settings can further restrict it.
5. Type a goal, or click **Start listening**. If necessary, the microphone setup
   page opens so Chrome can show a visible permission prompt. Return to your web
   page after allowing it.

Example goals: “Fill my name as Sam Lee and my email as sam@example.com”,
“Search Wikipedia for browser extensions”, “Select Creative coding”, or “Open the
new stories”. Only requested submissions execute, after confirmation. Missing
personal details prompt a question; answer it in the command box or by voice.

Switching tabs updates the current page automatically and cancels unfinished
commands, dictation targets, and approvals. A spoken turn begun on the old page
is discarded. Listening stays enabled while switching tabs, until explicitly
paused or the ten-minute limit is reached. Restricted pages show an explanation
and cannot redirect commands to a background tab.

After rebuilding, reload Jev in `chrome://extensions` and refresh the web page
so its content script updates. A backend restart requires a new pairing code.
Settings persist locally; pairing is limited to the Chrome session.

## Minimal controls

The panel shows the current website, status, microphone button, command box, and
last transcript. **Edit** copies a misheard command into the box for correction.
Settings contains voice controls, permissions, and diagnostics.

- **Give me more time to speak**, enabled by default, uses Flux `eot_threshold=0.85`
  and `eot_timeout_ms=7000`. Standard mode uses 0.7 / 5000 ms. This reduces premature
  turn endings at the cost of some response time; it does not guarantee accuracy.
- **Microphone** selects an input device. Grant microphone permission to see device
  names. Speech settings apply on the next listening session.
- **Words to recognize** supplies up to 20 comma-separated vocabulary hints to
  Deepgram. Names and specialized terms can benefit; hints are not exact spelling
  guarantees. Do not enter secrets into this field.
- **Show numbered targets** is off by default. Enable it to use exact local
  commands such as “focus 3” or “click 8”.

“Stop” cancels a task. “Stop listening” or “pause listening” closes audio capture.
“Start dictation” pins the focused field; “finish dictation” returns to command
mode. While dictating, ordinary phrases including “click 12” are literal text.
`Type: literal text` appends text locally; “undo last entry” restores a value only
if it has not changed. “Confirm action” executes the current unchanged preview.

## Compatibility

Supported controls include visible inputs, textarea, native selects, checkboxes,
radios, links, buttons, ARIA tabs/options/menu items/switches, native media, open
shadow DOM controls, and plain contenteditable fields. Scrolling prefers a focused
nested scroll pane, then the document or main scroll region. Enter is available
for editable fields without a visible native submit button and requires approval.

This is a generic DOM executor, not a site-specific script. It cannot guarantee
compatibility with every web application. Browser settings, the Chrome Web Store,
PDF viewers, protected/cross-origin frames, closed shadow roots, canvas-based
editors, rich document editors, file uploads, password/payment fields and controls
requiring trusted native input remain unsupported. Text extraction is grounded
in the supplied goal; arbitrary prose composition is not implemented. Native date
pickers need further coverage. Custom widgets may reject synthetic input events.

## Architecture and boundaries

- **Jev:** one model call scores observed actions directly for small control sets,
  or uses separate operation/target heads for larger pages. Only validated offered
  choices can execute. Confidence and margin checks apply before page actions.
  Uncertain completion stops with a review message. No generated selectors or
  JavaScript execute.
- **Goal coordinator:** fresh snapshots after each step, at most 20 steps / two
  minutes per goal, cancellation across tab/document changes, no command queue,
  no replay after a lost acknowledgement, and duplicate-turn/action protection.
- **Text helper:** `TEXT_MODEL` (Mercury by default) extracts exact field values or
  asks a clarification through the same Gateway. Missing or ungrounded values
  cannot be typed. Both model attempts count toward the budget.
- **Executor:** stable document-scoped IDs, current visibility/occlusion checks,
  target identity/value/semantic guards, and at most 196 offered actions. Layout
  changes or unrelated fields do not invalidate a stable target. Replaced targets
  and edits to the selected field do. Field writes are read back.
- **Approval:** submit-like actions, Enter, destructive labels and clearing need
  confirmation, expiring after 20 seconds. Approval binds to the document and full
  form/page guard. Confirmed actions are removed from the remainder of that goal.
  Custom consequential widgets still require site-specific acceptance testing.
- **Speech:** AudioWorklet streams mono PCM16 in 60 ms chunks using the actual
  AudioContext sample rate. Flux partial turns update the display; only EndOfTurn
  executes (explicit stop phrases can interrupt). Temporary JWTs authenticate
  through the bearer WebSocket subprotocol. A local ten-second heartbeat prevents
  worker idling during silence; it stops with listening and makes no model calls.
- **Recovery:** speech reconnects at most twice with a fresh stream and drops old
  buffered audio. A worker restart stops audio and discards unfinished actions.
  Backend fetches time out and expired authentication returns to pairing.

## Privacy and cost

Audio is sent to Deepgram only while listening. Silence while connected may still
incur speech charges. Commands, page address/title, up to 6,000 characters of page text,
control labels/options, supported field values and recent action history are sent
to Gateway models for semantic commands. Website text is untrusted input, never
permission to act. The local execution guard stays in the browser.

No application audio recording or disk transcript log is created. The last
transcript stays in session storage while Chrome runs. Preferences and custom
vocabulary are stored locally. Provider retention follows your provider settings.
Website permissions can be removed in Settings or Chrome extension site access.

The backend binds to loopback, checks Host/extension Origin, and issues an eight-hour
session after a ten-minute single-use pairing code. `VOICE_MAX_REQUESTS` defaults
to 120 model attempts per session, with 45/minute and no automatic model retry.
A session can mint at most 20 speech tokens. These application limits are separate
from provider quotas. This local deployment is not a hosted multi-user service.

## Verification

```sh
uv run pytest
uv run ruff check .
npm run build --prefix extension
npm test --prefix extension
cd extension
npx playwright install chromium
npm run test:browser
```

Default browser tests install the built extension in an isolated profile and use
simulated speech/provider responses. Tests cover actual content scripts, React
inputs, tab switching, stale responses, confirmations, microphone onboarding,
idle listening, open shadow DOM, plain editors, nested scrolling and settings.

Opt-in network tests, from the project root:

```sh
VOICE_PUBLIC_SMOKE=1 npm run test:browser --prefix extension -- --grep public
VOICE_LIVE=1 VOICE_PUBLIC_SMOKE=1 npm run test:browser --prefix extension -- --grep "public Wikipedia"
VOICE_LIVE=1 npm run test:browser --prefix extension -- --grep "free-form multi-field"
```

`VOICE_LIVE=1` uses paid Gateway calls with synthetic test goals and public page
content. See [verification results](voice-demo-results.md). Actual voice accuracy
and accessibility acceptance require representative speech and intended-user
validation; a successful synthetic test is not evidence of universal reliability.

References: [Flux settings](https://developers.deepgram.com/docs/flux/configuration),
[keyterm prompting](https://developers.deepgram.com/docs/keyterm),
[Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
