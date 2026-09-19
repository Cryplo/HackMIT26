# Jev voice extension

The Chrome extension is the main path for voice-controlled browsing. It executes
ordinary HTML actions through an isolated content script, with no remote-debugging
connection or Browser Use daemon required. The existing inspector at port 8766 is
still available separately.

## Start the prototype

1. Install dependencies and build:

   ```sh
   uv sync --locked
   npm ci --prefix extension
   npm run build --prefix extension
   ```

2. In Google Chrome, open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and select this project's `extension/dist` folder. Copy the
   extension ID shown on its card.
3. Start the backend from the repository directory:

   ```sh
   uv run hackmit serve --extension-id YOUR_EXTENSION_ID
   ```

   The backend binds only to `127.0.0.1:8767` and prints a single-use pairing code
   valid for ten minutes. The existing `AI_GATEWAY_API_KEY` in `.env` is reused.
4. Click the Jev extension toolbar button to open its side panel. Paste the pairing
   code. Open the **practice form** under **Setup & privacy**, then click
   **Use current tab** and grant access to that site.
5. Try a natural-language goal: `My name is Sam Lee and my email is
   sam@example.com. Fill out the form and select Creative coding.` You can also
   ask it to register; submission pauses for `Confirm action`. Missing details
   prompt a question—answer in the same command box. Submission on the practice
   form is local only.

For voice, add `DEEPGRAM_API_KEY` to the ignored local `.env` and restart the
backend. The Deepgram key needs at least **Member** permission to mint temporary
tokens. Re-pair after a backend restart. Choose **Set up microphone permission**
in the panel, allow Chrome/OS microphone access, return to the panel, and choose
**Start listening**. If permission has not been granted, Start listening opens
the visible microphone setup page automatically. Click **Allow microphone**,
accept Chrome's prompt, then click **Return to selected page**. The permanent speech key never enters the extension.

The current local Deepgram key successfully mints temporary tokens. A live Flux
WebSocket authenticated using the browser-compatible bearer subprotocol and
accepted a short synthetic-silence connection test. Real-microphone recognition
and end-to-end voice workflows still need validation. Typed commands do not need Deepgram.

Reload the extension in `chrome://extensions` after rebuilding its source, and
select the page again. A worker restart stops speech and discards unfinished work.

## Commands and scope

| Command | Behavior |
| --- | --- |
| `Fill out full name as Dylan Li` | Choose the field with Jev and replace its value with the literal supplied text; undo is available. |
| `Focus the destination field` | Jev selects a visible, supported field. |
| `Focus 3`, `Click 8` | Local numbered-target selection, no model request. |
| `Type: London` | Append exactly this text to the pinned/focused field. |
| `Start dictation` | Pin the current field; subsequent final turns become text. |
| `Finish dictation` | Return to command mode. |
| `Clear this field` | Preview clearing; requires `Confirm action`. |
| `Undo last entry` | Restore the previous value only if it has not changed. |
| `Select Creative coding` | Jev chooses an observed native select option. |
| `Scroll down`, `Scroll up`, `Go back` | Local page controls. |
| `Play the video`, `Pause the video` | Jev selects a visible native media element; browser autoplay restrictions still apply. |
| `Cancel`, `Stop` | Cancel pending commands in command mode; keep listening. |
| `Stop listening`, `Pause listening` | Stop audio capture and disconnect speech in either mode. |
| `Confirm action`, `Confirm submit` | Execute only the current unchanged, unexpired preview. |

In dictation mode, `click 12` and `cancel` are literal text. Only `Finish dictation`
and `Stop listening` / `Pause listening` escape dictation. A fresh final turn
supersedes unfinished inference; commands do not accumulate in a queue.

Supported: visible main-frame HTML inputs, textarea, native select, checkboxes,
radios, links, buttons, scrolling, history back, and native media. React-controlled
text inputs are covered by a browser fixture. Each site must be explicitly
permitted. Custom controls may reject synthetic events.

Unsupported: password/payment fields, file uploads, date-picker automation,
canvas, iframes, closed shadow roots, rich document editors, browser-internal pages,
and prose composition (field values must come from your request). This is not an arbitrary-website
compatibility claim. Speech-driven tab switching and trusted native key input are
not part of this first extension slice.

## Architecture and safety properties

- **Content script:** stable document-scoped element IDs, bounded candidate lists,
  noninteractive number overlays, accessible labels, fresh identity/value/geometry/
  visibility/occlusion guards, and an execution ledger. Replacement nodes get new
  IDs. At most 196 actions are sent to the backend; omitted actions are reported.
- **Coordinator:** selected tab, command/dictation modes, final-turn deduplication,
  cancellation generation, pinned field, confirmation preview, and timing counters.
  It restores pairing and tab metadata from `chrome.storage.session`, but never
  resumes unfinished actions after a worker restart. Page scripts cannot command
  the worker via `window.postMessage`.
- **Goal loop:** up to 20 steps / two minutes, refreshing the page snapshot after
  each action. Jev chooses one observed action, clarification, wait, unsupported,
  or done. A successful confirmation resumes the goal, with that confirmed
  action removed from subsequent choices to prevent repeat submission.
- **Jev backend:** calls Vercel's TypeSafe-compatible endpoint. Field entry and
  clarification use a text helper (`TEXT_MODEL`, Mercury by default) through the
  same Gateway. Extracted values must occur in the user request; ungrounded or
  missing values prompt a question. No generated JavaScript or selectors.
- **Speech:** offscreen document → AudioWorklet → mono signed 16-bit little-endian
  PCM in 60 ms chunks → Deepgram Flux `/v2/listen`. AudioContext requests 16 kHz;
  if Chrome chooses another supported rate, that actual rate is advertised.
  Temporary JWTs use the `bearer` WebSocket subprotocol. Partial transcripts only
  update the panel, except explicit stop/cancel phrases. Only `EndOfTurn` executes.
- **Confirmation:** submit-like controls, destructive labels, and field clearing
  require a preview. It expires after 20 seconds and binds to the original action,
  document, and form state. This heuristic does not identify every consequential
  custom widget; test any real sending/purchasing workflow separately.
- **Execution:** duplicate action IDs return their original result, including
  failed attempts. Lost acknowledgements are never replayed. Field changes are
  read back; clicks and navigation are reported as requests, not verified success.
- **Privacy:** model requests contain the spoken/typed goal, page title, up to
  6,000 characters of visible page text, bounded labels/options, supported field
  values, and recent action history. The local execution guard stays in the browser.
  These requests can contain personal information. No application audio
  recording or disk transcript log is created. The panel retains the last heard
  text in session storage while Chrome runs. Provider retention is governed by
  your provider account settings.

## Limits and recovery

`VOICE_MAX_REQUESTS` configures the backend's model-call budget (default 120 per
paired session); every attempt counts, including failures and text-helper calls. The backend also caps
requests at 45/minute. It does not automatically retry model calls. Local commands
can still work without an available model. These are application limits, not a
statement of your provider quota.

While listening, a local heartbeat every ten seconds keeps the coordinator active
between spoken turns. It stops when listening stops and makes no provider calls.
An actual worker restart still discards pending actions and stops audio.

Listening stops after ten minutes per activation. Speech reconnects at most twice
with a new token and stream ID, drops old buffered audio, and invalidates pending
actions. A paired session can mint at most 20 tokens. Pairing expires after eight
hours. Pausing closes the stream; silence while connected can still incur speech
charges. A wake phrase cannot resume a stopped microphone.

Goal-initiated navigation can continue on a permitted origin. Manual navigation
cancels the goal. On a new origin,
choose **Use current tab** and grant that site's permission. Revoking permission
stops listening; reselect and allow the page to resume. Site registration survives
Chrome restarts, while pairing is session-only. Revocation is available in the
panel or Chrome's extension site-access settings.

A changed form, obscured control, replaced target, or expired preview yields an
actionable error. Refresh targets or repeat the original command; do not assume
that a click means the site's task completed.

## Test and inspect

```sh
uv run pytest
uv run ruff check .
npm run build --prefix extension
npm test --prefix extension
cd extension
npx playwright install chromium
npm run test:browser
```

Browser tests install the actual built extension into an isolated Chromium profile.
Only the temporary test manifest pregrants the fixture origin. By default a test-only provider
adapter supplies deterministic transcripts and a fake microphone; no real audio
or paid provider is used in CI. Native and React form tests exercise the production
content script and coordinator. See [measured results](voice-demo-results.md).

Optional live Gateway probe (five potentially billable requests, synthetic data):

```sh
uv run python scripts/check_voice_jev.py
```

Primary API references: [Chrome offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen),
[Deepgram temporary tokens](https://developers.deepgram.com/guides/fundamentals/token-based-authentication),
[Flux state events](https://developers.deepgram.com/docs/flux/state), and
[Deepgram browser authentication implementation](https://github.com/deepgram/deepgram-js-sdk/blob/main/src/CustomClient.ts).

### Tab selection troubleshooting

After updating, click Reload on Jev's card in `chrome://extensions` and reopen
the side panel. The extension requests the `tabs` permission to identify the
current page before requesting that site's optional access. This reads tab
metadata; page control still requires the site's separate permission. If Chrome
asks you to accept the updated permission, do so to enable tab selection.

Open the practice form at `http://127.0.0.1:8767/demo` in Google Chrome itself.
The extension cannot control Codex's embedded browser, `chrome://extensions`,
the new-tab page, or its own microphone setup page.

Opt-in real Jev + text-helper browser test (billable, synthetic local form only):

```sh
VOICE_LIVE=1 npm run test:browser --prefix extension -- --grep "free-form multi-field"
```
