import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type UIState,
} from "../shared/protocol";
import "./style.css";
const initial: UIState = {
  status: "OFF",
  message: "Connecting…",
  transcript: "",
  paired: false,
  listening: false,
  mode: "command",
  elements: [],
  omitted: 0,
  calls: 0,
  successfulCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  listeningSeconds: 0,
};
async function send(type: string, extra: object = {}) {
  const reply = await chrome.runtime.sendMessage({
    to: "background",
    type,
    ...extra,
  });
  if (!reply?.ok)
    throw Error(
      reply?.error ||
        "Reload Jev in chrome://extensions, then reopen this panel.",
    );
  return reply.value;
}
function Mic({ paused }: { paused: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {paused ? (
        <>
          <path d="M8 5v14M16 5v14" />
        </>
      ) : (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
        </>
      )}
    </svg>
  );
}
function App() {
  const [state, setState] = useState(initial),
    [text, setText] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [vocabulary, setVocabulary] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const prefs = state.preferences || DEFAULT_PREFERENCES;
  useEffect(() => {
    send("get")
      .then(setState)
      .then(() => send("sync-tab"))
      .then(setState)
      .catch((e) => setError(e.message));
    const listener = (m: any) => {
      if (m.to === "panel" && m.type === "state") setState(m.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    setVocabulary(prefs.vocabulary);
  }, [prefs.vocabulary]);
  useEffect(() => {
    if (settingsOpen)
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === "audioinput")))
        .catch(() => {});
  }, [settingsOpen]);
  async function perform(type: string, data: object = {}) {
    setError("");
    try {
      const value = await send(type, data);
      if (value) setState(value);
      return value;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(value: Partial<Preferences>) {
    await perform("preferences", { value: { ...prefs, ...value } });
  }
  async function pair(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await perform("pair", { code: code.trim() });
    setCode("");
    setBusy(false);
  }
  async function allowWebsites() {
    setError("");
    try {
      const allowed = await chrome.permissions.request({
        origins: ["https://*/*", "http://*/*"],
      });
      if (!allowed)
        throw Error(
          "Website access wasn't granted. You can try again whenever you're ready.",
        );
      await perform("sync-tab");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggleListening() {
    if (state.listening) {
      await perform("stop");
      return;
    }
    const permission = await navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .catch(() => null);
    if (permission?.state !== "granted") {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("microphone.html"),
      });
      return;
    }
    await perform("start");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    const draft = text;
    const result = await perform("command", { text: draft.trim() });
    if (result) setText((current) => (current === draft ? "" : current));
  }
  const working = ["DECIDING", "EXECUTING"].includes(state.status);
  const ready = state.paired && state.pageStatus === "ready";
  const label = working
    ? "Working"
    : state.pending
      ? "Review action"
      : state.status === "ERROR"
        ? "Needs attention"
        : state.listening
          ? "Listening"
          : "Ready";
  let hostname = "No website open";
  try {
    hostname = new URL(state.tabUrl!).hostname;
  } catch {
    /* Restricted or loading tab. */
  }
  return (
    <main>
      <header>
        <div className="brand">
          jev<span>.</span>
        </div>
        <span className="header-note">Your voice, on the web</span>
        <button
          className="icon-button"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="3" fill="var(--paper)" />
            <circle cx="15" cy="17" r="3" fill="var(--paper)" />
          </svg>
        </button>
      </header>
      <section className="page-context" aria-label="Current page">
        <span
          className={
            "page-dot " + (state.pageStatus === "ready" ? "available" : "")
          }
        />
        <div>
          <strong>{hostname}</strong>
          <p title={state.tabTitle}>
            {state.tabTitle || "Open a website to get started"}
          </p>
        </div>
        <span className="current-label">Current tab</span>
      </section>
      {!state.paired && (
        <form className="setup" onSubmit={pair}>
          <h1>Connect Jev</h1>
          <p>Enter the pairing code from your local backend.</p>
          <label className="sr-only" htmlFor="pair">
            Pairing code
          </label>
          <div className="row">
            <input
              id="pair"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              placeholder="Pairing code"
              required
            />
            <button disabled={busy || !code.trim()}>Connect</button>
          </div>
          <details>
            <summary>Backend setup</summary>
            <p>Run this in your project folder:</p>
            <code>uv run hackmit serve --extension-id {chrome.runtime.id}</code>
          </details>
        </form>
      )}
      {state.pageStatus === "permission" && (
        <section className="access">
          <h2>Use Jev across websites</h2>
          <p>
            Allow website access once. Jev follows your active tab and reads
            page content when you give a command.
          </p>
          <button onClick={allowWebsites}>Allow website access</button>
        </section>
      )}
      <section
        className={"status " + (state.listening ? "live" : "")}
        aria-label="Agent status"
      >
        <div className="status-line">
          <span className="indicator" />
          <strong>{label}</strong>
          {state.mode === "dictation" && (
            <span className="mode">Dictation</span>
          )}
        </div>
        <p role="status" aria-live="polite">
          {state.message}
        </p>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {state.pending && (
        <section className="pending">
          <h2>{state.pending}</h2>
          <p>
            Check the page before confirming. This approval expires after 20
            seconds.
          </p>
          <div className="row">
            <button
              onClick={() => perform("command", { text: "confirm action" })}
            >
              Confirm action
            </button>
            <button className="secondary" onClick={() => perform("cancel")}>
              Cancel
            </button>
          </div>
        </section>
      )}
      <button
        className={"listen " + (state.listening ? "listening" : "")}
        disabled={!ready && !state.listening}
        onClick={toggleListening}
      >
        <Mic paused={state.listening} />
        <span>{state.listening ? "Pause microphone" : "Start listening"}</span>
        {state.listening && <span className="live-dot" />}
      </button>
      <p className="listen-note">
        {state.listening
          ? "Microphone stays on until paused, up to 10 minutes."
          : "Speak a goal, or type it below."}
      </p>
      <form className="command" onSubmit={submit}>
        <label className="sr-only" htmlFor="command">
          Command
        </label>
        <textarea
          ref={input}
          id="command"
          rows={3}
          value={text}
          maxLength={2000}
          placeholder="What would you like to do?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="command-footer">
          <span>⌘ / Ctrl + Enter</span>
          <button disabled={!text.trim() || !ready}>
            Run command <span aria-hidden="true">↗</span>
          </button>
        </div>
      </form>
      {state.transcript && (
        <section className="transcript">
          <div className="transcript-heading">
            <span>Last command</span>
            <button
              className="text-button"
              onClick={() => {
                setText(state.transcript);
                input.current?.focus();
              }}
            >
              Edit
            </button>
          </div>
          <p>{state.transcript}</p>
        </section>
      )}
      {(working || state.mode === "dictation") && (
        <button className="secondary full" onClick={() => perform("cancel")}>
          {state.mode === "dictation" ? "Finish dictation" : "Stop task"}
        </button>
      )}
      {settingsOpen && (
        <section className="settings" aria-label="Settings">
          <h2>Settings</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.patientSpeech}
              onChange={(e) => save({ patientSpeech: e.target.checked })}
            />
            <span>
              Give me more time to speak
              <small>
                Wait longer through pauses before running a command.
              </small>
            </span>
          </label>
          <label htmlFor="microphone">Microphone</label>
          <select
            id="microphone"
            value={prefs.microphoneId}
            onChange={(e) => save({ microphoneId: e.target.value })}
          >
            <option value="">System default</option>
            {devices
              .filter((d) => d.deviceId && d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
          </select>
          <label htmlFor="vocabulary">Words to recognize</label>
          <input
            id="vocabulary"
            value={vocabulary}
            maxLength={1200}
            placeholder="Names or terms, separated by commas"
            onChange={(e) => setVocabulary(e.target.value)}
            onBlur={() => {
              if (vocabulary !== prefs.vocabulary) void save({ vocabulary });
            }}
          />
          <p className="note">
            Speech settings apply next time you start listening. Custom words
            are sent to Deepgram.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.overlay}
              onChange={(e) => save({ overlay: e.target.checked })}
            />
            <span>
              Show numbered targets
              <small>Say “click 4” or “focus 2” for an exact target.</small>
            </span>
          </label>
          <details>
            <summary>Voice controls</summary>
            <p>
              “Stop” cancels a task. “Stop listening” turns off the microphone.
              “Start dictation” enters text in the focused field; “finish
              dictation” returns to commands. “Undo last entry” restores the
              previous value.
            </p>
          </details>
          <details>
            <summary>Privacy & access</summary>
            <p>
              While listening, audio goes to Deepgram. Commands, page text and
              supported field values go through Vercel to Jev and the text
              helper. No audio or transcript files are saved.
            </p>
            <p>
              Chrome pages, PDFs, embedded frames, password/payment fields and
              canvas editors are not supported.
            </p>
            <button
              className="secondary full"
              onClick={() =>
                chrome.tabs.create({
                  url: chrome.runtime.getURL("microphone.html"),
                })
              }
            >
              Microphone permissions
            </button>
            <button className="secondary full" onClick={allowWebsites}>
              Allow website access
            </button>
            <button
              className="secondary full"
              onClick={async () => {
                await perform("stop");
                const grants = await chrome.permissions.getAll();
                const origins = (grants.origins || []).filter(
                  (x) => !x.startsWith("http://127.0.0.1:8767/"),
                );
                if (origins.length)
                  await chrome.permissions.remove({ origins });
              }}
            >
              Remove website access
            </button>
          </details>
          <details>
            <summary>Connection & diagnostics</summary>
            <p>
              {state.paired ? "Backend connected" : "Backend not connected"}
            </p>
            <code>{chrome.runtime.id}</code>
            <p>
              {state.calls} model requests ·{" "}
              {state.inputTokens + state.outputTokens} observed tokens
              {state.totalMs !== undefined
                ? ` · Last command ${state.totalMs} ms`
                : ""}
            </p>
            <button
              className="secondary full"
              onClick={() => perform("sync-tab")}
            >
              Refresh current page
            </button>
          </details>
        </section>
      )}
      <footer>Follows your active tab. You stay in control.</footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
