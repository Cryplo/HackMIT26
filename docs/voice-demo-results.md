# Voice extension validation — September 19, 2026

Prototype validation on macOS ARM64, Python 3.13, Node 25, and Playwright Chromium
153.0.8010.12. No participant study or real-microphone transcription trial has
been performed. The replacement Deepgram key successfully issues 30-second temporary tokens.

## Automated browser evidence

The production extension bundles were loaded into an isolated browser profile.
The test build alone pregrants the local fixture and example.com, and replaces the
Deepgram socket with a deterministic provider adapter. Chrome's fake microphone
feeds the real offscreen AudioWorklet. The model backend in browser tests is a
fixture; separate Python tests validate the actual backend, and the live Gateway
probe below validates real Jev responses.

- **20/20 repeated form trials:** focus, append literal text, enter/exit dictation,
  undo an incorrect email, select a native option, preview submission, and confirm.
  Repeated confirmation did not submit twice.
- **At-most-once execution:** the same action ID cannot append twice. An undo after
  a manual edit is rejected rather than overwriting the user's work.
- **Stale state:** replaced nodes, covering elements, disabled fields, cancelled
  generations, wrong documents, changed forms, and expired confirmations block
  the pending mutation.
- **React compatibility:** native value setters and input/change events update a
  controlled React input and its state-driven output. Undo restores both.
- **Speech wiring:** 16 kHz PCM packets arrive at the simulated socket; interim
  transcripts do not mutate; repeated final turns execute once; command-like words
  in dictation remain literal. Audio continues after panel closure. Pause stops
  packet output and closes the socket. A dropped stream reconnects with a new
  session stream ID.
- **Recovery:** cancelling an in-flight semantic request prevents the late result
  from focusing another field. Stopping the service worker clears pending approval
  and stops existing audio when it restarts.
- **Public-page smoke:** the same numbered-link executor followed example.com's
  link to IANA. This is a basic navigation check, not broad website coverage.
- **Panel:** 380px viewport with no horizontal overflow; screenshot inspected.

The suite contains 12 browser tests (the public network smoke is opt-in), plus
three routing/deduplication unit tests. Python tests include retained regression
coverage and voice origin/authentication, single-use pairing, expiry, request
bounds, budgets, cancellation, invalid choices, provider failure, and temporary
speech credentials.

## Latency evidence

A 20-trial local typed-command run measured approximately **1–2 ms** from coordinator
command receipt to mutation acknowledgement for a short field append (median
2 ms, nearest-rank p95 2 ms). Other development runs ranged up to 9 ms. The clock
is local `performance.now()`. This excludes panel-to-worker delivery, human input,
audio, speech recognition, model inference, and page loading. It establishes the
fast local path on a small fixture, not a general end-to-end latency guarantee.

Five real Jev requests through Vercel AI Gateway used synthetic form labels:

| Command | Correct selection | Gateway round trip | Whole backend request |
| --- | --- | ---: | ---: |
| Focus the email field | Yes | 629 ms | 632 ms |
| Select creative coding | Yes | 518 ms | 541 ms |
| Focus full name | Yes | 410 ms | 433 ms |
| Register for the workshop | Yes | 310 ms | 326 ms |
| Scroll down | Yes | 310 ms | 322 ms |

First request includes a cold connection. Median Gateway round trip was 410 ms.
These timings combine transport and provider work; they do **not** measure Jev's
internal inference time. Five samples are insufficient for a useful tail-latency
claim. The scroll request deliberately exercised the provider contract; ordinary
`Scroll down` commands take the extension's local path.

Reported token usage across those five calls: **3,371 input / 421 output tokens**.
No authoritative billed dollar cost was returned by this probe. Consult Vercel's
dashboard for actual charges. No Deepgram usage was incurred by the simulated
speech tests. The panel counts attempted calls, successful responses, observed
input/output tokens, completed listening seconds, and last measured latencies;
cancelled requests can incur usage that is unavailable to the client.

## Still pending

- Token issuance now returns HTTP 200. A real Flux `/v2/listen` WebSocket emitted
  `Connected` using the same bearer subprotocol as the extension. The probe sent
  720 ms of synthetic 16 kHz PCM silence and closed the stream; it did not record
  microphone audio or test speech recognition. Full extension-to-provider testing
  with actual speech remains pending.
- Actual Chrome/OS microphone permission onboarding on the user's profile.
- Speech accuracy, acoustic-end-to-action timing, and 20 genuinely spoken trials.
- Intended-user feedback on fatigue, discoverability, correction, and feedback.
- Rich widgets, document editors, nested scrolling, frames, and additional sites.
- Permission-revocation and backend-restart UX in the user's installed extension.

The browser-control prototype and simulated voice plumbing are implemented. The
full voice/accessibility acceptance gate remains open until the real speech and
user tests above are completed. Sub-100ms semantic or acoustic latency is not
claimed.

## Reproduce

See [setup and test commands](VOICE_EXTENSION.md). Run the optional public check
with `VOICE_PUBLIC_SMOKE=1 npm run test:browser` from `extension/`. The opt-in
`uv run python scripts/check_voice_jev.py` makes five real requests and writes the
result to ignored `artifacts/voice-jev-results.json`.

## Flexible goal execution — September 19 update

The extension now interprets natural-language goals across multiple actions. A
real Gateway browser run with Jev and Mercury filled the local fixture's name and
email fields, paused for confirmation, submitted exactly once, and reached DONE
(3.4 seconds for the automated test; this is not a voice latency measurement).
The live run exposed an incorrect paraphrased field value and repeated submission
selection. Value grounding and suppression of already-confirmed actions fixed
those failures; the rerun passed.

Regression validation: 83 Python tests passed, followed by an additional grounding
regression (all 17 backend tests pass); four router tests and 16 browser tests
passed, with the opt-in public-site test skipped. Coverage includes clarification
and follow-up answers, multi-field goals, cancellation, microphone onboarding with
simulated permission, confirmation expiry, and stale-target rejection. Actual
microphone recognition remains pending as described above.

## Listening between commands — September 19 fix

A missing offscreen-to-worker heartbeat left the coordinator eligible for Chrome's
30-second idle shutdown, despite audio streaming in the separate offscreen page.
Worker startup intentionally stops an existing microphone session, so a later
speech event could wake the worker only to have its session discarded. The fix
sends a local heartbeat every ten seconds only while listening; cleanup removes
it on stop or reconnect. It adds no provider requests.

The new browser regression failed against the old build (zero heartbeat events).
With the fix, two simulated spoken turns execute, a third executes after more than
30 seconds without speech, and heartbeat events cease after pause. Validation:
84 Python tests, four router tests, and 17 browser tests passed; the opt-in public
site test was skipped. This verifies the lifecycle fix with simulated speech,
not the precise cause of every failure in the user's live microphone session.

Reference: [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Active websites and minimal panel — September 19 update

The panel now follows the active Chrome website after an optional website-access
grant. It no longer opens or directs users to the fixture. Page switching cancels
unfinished actions and speech turns tied to the old page. Settings holds microphone
selection, patient turn-taking, custom recognition vocabulary, optional numbered
targets and diagnostics; the main panel has microphone, text command and status.

Generic executor coverage now includes open shadow DOM, plain editable regions,
ARIA options/tabs, nested scrolling, Enter for fields without an available submit
button, and exclusion of controls covered by overlays. A stable field remains
usable when an unrelated sidebar or layout changes. Target identity/value guards
and full confirmation guards remain enforced.

Validation: 89 Python tests and six TypeScript tests passed. The complete browser
suite passed 25 tests, with three opt-in network checks skipped. Later focused
backend tests cover the final planner changes. A final real-Gateway run passed
both multi-field registration (exactly one approved submission) and a Wikipedia
search that navigated to the Browser extension article. A separate public Hacker
News navigation test passed. The compact panel was visually checked at 380px width;
`artifacts/voice-panel-public.png` is an ignored local screenshot.

Live tests also exposed intermittent network disconnection and provider timeouts.
The backend reports a timeout without replaying a step. Jev can be uncertain about
whether a task is finished even after the requested action succeeds; it now stops
with an explicit result-review message instead of selecting an unnecessary next
action. Do not interpret a stopped task or dispatched click as verified site success.

The release improves the local browser extension; it is not a universal website
compatibility or production-accessibility certification. Live microphone accuracy
still needs representative user speech. English Flux is retained with optional
vocabulary hints and slower end-of-turn settings, not an accuracy guarantee.
