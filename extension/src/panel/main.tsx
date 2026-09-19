import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { UIState } from "../shared/protocol";
import "./style.css";
const initial: UIState = {
  status: "OFF",
  message: "Connecting to the extension…",
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
        "Extension unavailable. Reload it in chrome://extensions.",
    );
  return reply.value;
}
function App() {
  const [state, setState] = useState(initial),
    [text, setText] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [overlay, setOverlay] = useState(true);
  useEffect(() => {
    send("get")
      .then(setState)
      .catch((e) => setError(e.message));
    const listener = (m: any) => {
      if (m.to === "panel" && m.type === "state") setState(m.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  async function perform(type: string, data: object = {}) {
    setError("");
    try {
      return await send(type, data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function pair(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await perform("pair", { code });
    setCode("");
    setBusy(false);
  }
  async function useTab() {
    setError("");
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined || !tab.url)
        throw Error(
          "Chrome has not exposed this tab. Reload Jev at chrome://extensions, then reopen its panel on the page you want to control.",
        );
      if (!/^https?:/.test(tab.url))
        throw Error(
          "This Chrome page cannot be controlled. Open http://127.0.0.1:8767/demo in a Google Chrome tab, then choose Use current tab.",
        );
      const allowed = await chrome.permissions.request({
        origins: [new URL(tab.url).origin + "/*"],
      });
      if (!allowed)
        throw Error(
          "Site permission was not granted. No page content was accessed.",
        );
      await perform("bind", { tabId: tab.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggleListening() {
    if (state.listening) {
      await perform("stop");
      return;
    }
    if (!state.paired || state.tabId === undefined) {
      setError(
        "Pair the backend and choose Use current tab before starting voice.",
      );
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
    const command = text;
    setText("");
    await perform("command", { text: command });
  }
  return (
    <main>
      <header>
        <div className="brand" aria-label="Jev">
          j<span>e</span>v<span className="dot">.</span>
        </div>
        <span className="edition">
          VOICE / WEB
          <br />
          HACKMIT 26
        </span>
      </header>
      <section className="intro">
        <p className="eyebrow">YOUR WORDS. YOUR BROWSER.</p>
        <h1>
          A little less
          <br />
          between you
          <br />
          <em>and the web.</em>
        </h1>
      </section>
      <section
        className={"status " + (state.listening ? "live" : "")}
        aria-label="Agent status"
      >
        <div className="status-line">
          <span className="indicator" />
          <strong>{state.status.replaceAll("_", " ").toLowerCase()}</strong>
          <span className="mode">{state.mode}</span>
        </div>
        <p role="status" aria-live="polite">
          {state.message}
        </p>
        {state.pending && (
          <div className="pending">
            <strong>Review: {state.pending}</strong>
            <p>
              Confirm within 20 seconds. Changing the form cancels approval.
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
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!state.paired && (
        <form className="setup" onSubmit={pair}>
          <h2>Connect once</h2>
          <p>Start the local backend using this extension ID:</p>
          <code className="extension-id">{chrome.runtime.id}</code>
          <label htmlFor="pair">Pairing code from your terminal</label>
          <div className="row">
            <input
              id="pair"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              required
            />
            <button disabled={busy}>Pair</button>
          </div>
        </form>
      )}
      <section className="tab">
        <div>
          <p className="eyebrow">SELECTED TAB</p>
          <strong>{state.tabTitle || "No page selected"}</strong>
        </div>
        <button className="secondary" onClick={useTab}>
          Use current tab
        </button>
      </section>
      <section>
        <div className="row">
          <button className="listen" onClick={toggleListening}>
            {state.listening ? "Pause microphone" : "Start listening"}
            <span aria-hidden="true">{state.listening ? "Ⅱ" : "●"}</span>
          </button>
          <button className="secondary" onClick={() => perform("cancel")}>
            Cancel action
          </button>
        </div>
        <p className="note">
          Pausing closes the speech stream. The microphone stays on when this
          panel closes, for up to 10 minutes.
        </p>
      </section>
      <form className="command" onSubmit={submit}>
        <label htmlFor="command">Speak naturally. Or type here.</label>
        <textarea
          id="command"
          rows={2}
          value={text}
          maxLength={2000}
          placeholder="Fill out my full name as Dylan Li"
          onChange={(e) => setText(e.target.value)}
        />
        <button disabled={!text.trim()}>
          Run command <span aria-hidden="true">↗</span>
        </button>
      </form>
      {state.transcript && (
        <section className="transcript">
          <p className="eyebrow">LAST HEARD</p>
          <p>“{state.transcript}”</p>
        </section>
      )}
      <details open>
        <summary>Try these commands</summary>
        <div className="examples">
          {[
            "Fill out my full name as Dylan Li",
            "Scroll down",
            "Focus 3",
            "Type: hello@example.com",
            "Start dictation",
            "Finish dictation",
            "Undo last entry",
            "Confirm action",
            "Stop listening",
          ].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <p className="note">
          Describe your goal naturally, including values to enter. You can fill
          multiple fields in one request. Missing details prompt a question.
          “Type:” and dictation append literal text to the focused field.
        </p>
      </details>
      <details>
        <summary>Page targets · {state.elements.length}</summary>
        <label className="check">
          <input
            type="checkbox"
            checked={overlay}
            onChange={(e) => {
              setOverlay(e.target.checked);
              void perform("overlay", { enabled: e.target.checked });
            }}
          />
          Show numbers on the page
        </label>
        <button className="secondary" onClick={() => perform("refresh")}>
          Refresh targets
        </button>
        <ol className="targets">
          {state.elements.map((e) => (
            <li key={e.id}>
              <b>{e.id}</b>
              <span>{e.label}</span>
              <small>{e.editable ? "focus" : "target"}</small>
            </li>
          ))}
        </ol>
        {state.omitted > 0 && (
          <p>{state.omitted} actions omitted. Scroll or narrow your request.</p>
        )}
      </details>
      <details>
        <summary>Setup & privacy</summary>
        <p>
          Audio is sent to Deepgram while listening. Natural-language goals,
          page text, control labels, and supported field values go through Vercel
          to Jev and the text helper (Mercury by default). We do not save audio
          or transcripts to disk. Numbered commands and dictation insertion run
          locally after transcription.
        </p>
        <p>
          This prototype supports ordinary visible HTML controls. Passwords,
          payments, embedded frames, canvas apps, and uploads are unsupported.
        </p>
        <button
          className="secondary"
          onClick={() =>
            chrome.tabs.create({
              url: chrome.runtime.getURL("microphone.html"),
            })
          }
        >
          Set up microphone permission
        </button>
        <button
          className="secondary"
          onClick={() =>
            chrome.tabs.create({ url: "http://127.0.0.1:8767/demo" })
          }
        >
          Open practice form
        </button>
        <button
          className="secondary"
          onClick={async () => {
            await perform("stop");
            const [tab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (tab?.url && /^https?:/.test(tab.url))
              await chrome.permissions.remove({
                origins: [new URL(tab.url).origin + "/*"],
              });
          }}
        >
          Revoke current site permission
        </button>
      </details>
      <footer>
        <span>
          {state.calls} model attempts · {state.successfulCalls} responses
        </span>
        <span>
          {state.inputTokens} input / {state.outputTokens} output tokens
          observed
        </span>
        <span>{state.listeningSeconds}s completed listening</span>
        <span>
          {state.modelMs !== undefined
            ? `Jev ${state.modelMs} ms`
            : "Local first"}
        </span>
        <span>
          {state.totalMs !== undefined
            ? `Command ${state.totalMs} ms`
            : "Ready when you are"}
        </span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
