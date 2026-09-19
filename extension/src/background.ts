import {
  BASE,
  type Action,
  type Snapshot,
  type Result,
  type UIState,
} from "./shared/protocol";
import { TurnGate, normalize, route } from "./voice/router";

const gate = new TurnGate();
gate.generation = Date.now();
let token = "",
  sessionId = "",
  tabId: number | undefined,
  pinned: string | undefined,
  pinnedDoc: string | undefined;
let controller: AbortController | undefined;
type GoalHistory = {
  operation: string;
  label: string;
  text?: string;
  verified: boolean;
};
type Goal = {
  text: string;
  turnId: string;
  g: number;
  steps: number;
  history: GoalHistory[];
  started: number;
  committed?: Set<string>;
};
let activeGoal: Goal | undefined;
let expectingNavigation = false;
let clarification: string | undefined;
let pending:
  | { action: Action; snapshot: Snapshot; token: string; goal?: Goal }
  | undefined;
let speechSession = "",
  listenStart = 0;
const state: UIState = {
  status: "OFF",
  message: "Pair with the local backend, then choose a tab.",
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
const ready = (async () => {
  const saved = await chrome.storage.session.get([
    "token",
    "sessionId",
    "tabId",
    "ui",
  ]);
  token = typeof saved.token === "string" ? saved.token : "";
  sessionId = typeof saved.sessionId === "string" ? saved.sessionId : "";
  tabId = typeof saved.tabId === "number" ? saved.tabId : undefined;
  state.paired = !!token;
  state.tabId = tabId;
  const previous = saved.ui as Partial<UIState> | undefined;
  for (const key of [
    "calls",
    "successfulCalls",
    "inputTokens",
    "outputTokens",
    "listeningSeconds",
  ] as const) {
    const value = previous?.[key];
    if (typeof value === "number" && Number.isFinite(value)) state[key] = value;
  }
  if (tabId !== undefined)
    state.tabTitle = (await chrome.tabs.get(tabId).catch(() => undefined))
      ?.title;
  // A restarted worker never resumes unfinished work or an existing microphone session.
  if (await chrome.offscreen.hasDocument())
    await chrome.runtime
      .sendMessage({ to: "offscreen", type: "stop" })
      .catch(() => {});
  if (tabId !== undefined)
    await sendContent({ type: "cancel", generation: gate.generation }).catch(
      () => {},
    );
  state.message = token
    ? "Ready. Select a tab or repeat your command."
    : "Pair with the local backend to enable Jev.";
  await publish();
})();
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
async function publish() {
  await chrome.storage.session.set({ ui: state });
  chrome.runtime
    .sendMessage({ to: "panel", type: "state", state })
    .catch(() => {});
}
async function sendContent(message: object) {
  if (tabId === undefined) throw Error("Choose a supported web tab first.");
  return chrome.tabs.sendMessage(
    tabId,
    { to: "content", ...message },
    { frameId: 0 },
  );
}
async function api(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : `Backend returned ${response.status}.`,
    );
  return data;
}
function invalidate(clearPending = true) {
  controller?.abort();
  controller = undefined;
  gate.cancel();
  activeGoal = undefined;
  expectingNavigation = false;
  clarification = undefined;
  if (clearPending) pending = undefined;
  state.pending = undefined;
  return gate.generation;
}
async function cancel(message = "Cancelled. Ready for your next command.") {
  const g = invalidate();
  pinned = undefined;
  pinnedDoc = undefined;
  state.mode = "command";
  await sendContent({ type: "cancel", generation: g }).catch(() => {});
  state.status = state.listening ? "LISTENING" : "OFF";
  state.message = message;
  await publish();
}
async function stop() {
  speechSession = "";
  await cancel("Microphone off. Use Start listening to resume.");
  if (await chrome.offscreen.hasDocument())
    await chrome.runtime
      .sendMessage({ to: "offscreen", type: "stop" })
      .catch(() => {});
  if (listenStart)
    state.listeningSeconds += Math.round((Date.now() - listenStart) / 1000);
  listenStart = 0;
  state.listening = false;
  state.status = "OFF";
  await publish();
}
async function snapshot(g: number): Promise<Snapshot> {
  if (tabId === undefined) throw Error("Select a tab first.");
  const tab = await chrome.tabs.get(tabId);
  if (
    !tab.url ||
    !/^https?:/.test(tab.url) ||
    !(await chrome.permissions.contains({
      origins: [new URL(tab.url).origin + "/*"],
    }))
  )
    throw Error("Site permission is missing. Select and allow this tab again.");
  try {
    return await sendContent({ type: "snapshot", generation: g });
  } catch {
    throw Error(
      "Page unavailable. Select the tab again and allow this site. Internal pages and PDFs are unsupported.",
    );
  }
}
async function execute(a: Action, s: Snapshot, g: number, confirmed?: string) {
  if (!gate.current(g)) return;
  state.status = "EXECUTING";
  await publish();
  if (!gate.current(g)) return;
  const started = performance.now();
  let result: Result;
  try {
    result = await sendContent({
      type: "execute",
      request: {
        action: a,
        documentId: s.documentId,
        guard: s.guard,
        generation: g,
        confirmed,
      },
    });
  } catch {
    if (gate.current(g)) {
      state.message =
        "Page navigated or acknowledgement was lost. Check the page; the action will not be replayed.";
      state.status = "OFF";
      await publish();
    }
    return;
  }
  if (!gate.current(g)) return;
  state.executionMs = Math.round(performance.now() - started);
  state.message = result.message;
  if (result.status === "confirmation") {
    pending = { action: a, snapshot: s, token: result.confirmation! };
    state.pending = result.label;
    state.status = "AWAITING_CONFIRMATION";
  } else {
    state.status =
      result.status === "executed"
        ? state.mode === "dictation"
          ? "DICTATING"
          : state.listening
            ? "LISTENING"
            : "OFF"
        : "ERROR";
    if (result.status === "executed" && a.operation === "focus") {
      pinned = a.target;
      pinnedDoc = s.documentId;
    }
    if (
      result.verified === false &&
      ["type", "clear", "select", "undo", "focus"].includes(a.operation)
    )
      state.status = "ERROR";
  }
  await publish();
  return result;
}
async function command(text: string, turnId: string = crypto.randomUUID()) {
  if (!text.trim() || text.length > 2000 || !gate.accept(turnId)) return;
  const started = performance.now(),
    r = route(text, state.mode);
  state.transcript = text;
  if (r.kind === "stop") {
    await stop();
    return;
  }
  if (r.kind === "cancel") {
    await cancel();
    return;
  }
  if (r.kind === "confirm") {
    const p = pending;
    pending = undefined;
    state.pending = undefined;
    if (!p) {
      state.message = "No action is awaiting confirmation.";
      await publish();
      return;
    }
    const g = gate.generation;
    if (p.goal) {
      activeGoal = p.goal;
      expectingNavigation = ["click", "back"].includes(p.action.operation);
    }
    const confirmed = await execute(
      { ...p.action, id: crypto.randomUUID() },
      p.snapshot,
      g,
      p.token,
    );
    if (p.goal && confirmed?.status === "executed" && gate.current(g)) {
      (p.goal.committed ||= new Set()).add(
        `${p.snapshot.documentId}:${p.action.operation}:${p.action.target}`,
      );
      p.goal.history.push({
        operation: p.action.operation,
        label:
          p.snapshot.candidates.find((c) => c.target === p.action.target)
            ?.label || "",
        text: p.action.text,
        verified: confirmed.verified === true,
      });
      await runGoal(p.goal);
    } else {
      activeGoal = undefined;
      expectingNavigation = false;
    }
    return;
  }
  const followup = clarification;
  const goalText = followup ? `${followup}\nUser clarification: ${text}` : text;
  const g = invalidate();
  // New commands invalidate any pending confirmation in the document.
  await sendContent({ type: "cancel", generation: g });
  if (!gate.current(g)) return;
  if (r.kind === "finish") {
    state.mode = "command";
    pinned = undefined;
    pinnedDoc = undefined;
    state.message = "Command mode.";
    await publish();
    return;
  }
  const s = await snapshot(g);
  if (!gate.current(g)) return;
  state.elements = s.elements;
  state.omitted = s.omitted;
  if (r.kind === "dictate") {
    const target = s.elements.find(
      (e) =>
        e.id === (pinnedDoc === s.documentId ? pinned : s.active) && e.editable,
    );
    if (!target) throw Error("Focus a text field before starting dictation.");
    pinned = target.id;
    pinnedDoc = s.documentId;
    state.mode = "dictation";
    state.status = "DICTATING";
    state.message = `Dictating into ${target.label}. Say “finish dictation” to return to commands.`;
    await publish();
    return;
  }
  let action: Action | undefined;
  const id = crypto.randomUUID();
  if (r.kind === "type" || r.kind === "clear") {
    const target =
      (pinnedDoc === s.documentId ? pinned : undefined) || s.active;
    if (!s.elements.some((e) => e.id === target && e.editable))
      throw Error("Focus a visible text field first.");
    action = {
      id,
      operation: r.kind === "type" ? "type" : "clear",
      target,
      text: r.kind === "type" ? r.text : undefined,
      dictation: state.mode === "dictation",
    };
  } else if (r.kind === "undo") action = { id, operation: "undo" };
  else if (r.kind === "target") {
    const c = s.candidates.find(
      (c) => c.target === r.id && c.operation === r.operation,
    );
    if (!c)
      throw Error(
        "That numbered target does not support this command. Try “focus” for text fields.",
      );
    action = { ...c, id };
  } else if (r.kind === "scroll")
    action = {
      id,
      operation: r.direction === "up" ? "scroll_up" : "scroll_down",
    };
  else if (r.kind === "back") action = { id, operation: "back" };
  else {
    await runGoal({
      text: goalText,
      turnId,
      g,
      steps: 0,
      history: [],
      started: performance.now(),
    });
    return;
  }
  if (action) await execute(action, s, g);
  if (gate.current(g)) {
    state.totalMs = Math.round(performance.now() - started);
    await publish();
  }
}
async function runGoal(goal: Goal) {
  if (!token) throw Error("Pair the backend to run a goal.");
  if (goal.text.length > 2000)
    throw Error("Please restate the goal in fewer than 2,000 characters.");
  activeGoal = goal;
  try {
    while (
      gate.current(goal.g) &&
      goal.steps < 20 &&
      performance.now() - goal.started < 120000
    ) {
      let s: Snapshot | undefined;
      // Navigation can detach the old content script. Observe the new page; never replay the click.
      for (let attempt = 0; attempt < 30 && gate.current(goal.g); attempt++) {
        try {
          const tab = await chrome.tabs.get(tabId!);
          if (tab.status !== "loading") {
            s = await snapshot(goal.g);
            break;
          }
        } catch (error) {
          if (!expectingNavigation || attempt === 29) throw error;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      expectingNavigation = false;
      if (!gate.current(goal.g)) return;
      if (!s)
        throw Error(
          "The page is still loading. Repeat the goal when it is ready.",
        );
      state.elements = s.elements;
      state.omitted = s.omitted;
      state.status = "DECIDING";
      state.message = `Working on your goal · step ${goal.steps + 1} of 20`;
      state.calls++;
      await publish();
      if (!gate.current(goal.g)) return;
      controller = new AbortController();
      const context = {
        sessionId,
        turnId: `${goal.turnId}:${goal.steps++}`,
        generation: goal.g,
        tabId: tabId!,
        documentId: s.documentId,
        snapshotVersion: s.version,
      };
      let d;
      try {
        d = await api(
          "/v1/decide",
          {
            context,
            mode: "goal",
            transcript: goal.text,
            title: s.title,
            page_text: s.text,
            candidates: s.candidates.filter(
              (c) =>
                !goal.committed?.has(
                  `${s.documentId}:${c.operation}:${c.target}`,
                ),
            ),
            history: goal.history.slice(-20),
          },
          controller.signal,
        );
      } catch (error) {
        if (!gate.current(goal.g)) return;
        throw error;
      }
      if (
        !gate.current(goal.g) ||
        JSON.stringify(d.context) !== JSON.stringify(context)
      )
        return;
      state.successfulCalls++;
      state.modelMs = d.model_ms;
      if (d.helper_model) {
        state.calls++;
        state.successfulCalls++;
      }
      for (const [source, target] of [
        ["input_tokens", "inputTokens"],
        ["output_tokens", "outputTokens"],
      ] as const) {
        const value = d.usage?.[source];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0)
          state[target] += value;
      }
      if (d.needs_clarification || d.choice === "CLARIFY") {
        clarification = goal.text;
        state.status = "CLARIFYING";
        state.message = d.question || "Which field or value did you mean?";
        await publish();
        return;
      }
      const ranked = Object.values(d.probabilities || {})
        .filter((v): v is number => typeof v === "number")
        .sort((a, b) => b - a);
      if (
        d.confidence < 0.65 ||
        (ranked.length > 1 && ranked[0] - ranked[1] < 0.15)
      ) {
        clarification = goal.text;
        state.status = "CLARIFYING";
        state.message =
          "I am unsure about the next step. Please clarify the target or requested result.";
        await publish();
        return;
      }
      if (d.choice === "DONE") {
        state.status = state.listening ? "LISTENING" : "OFF";
        state.message =
          "Goal completed based on the current page and verified actions. Please review the result.";
        await publish();
        return;
      }
      if (d.choice === "UNSUPPORTED")
        throw Error(
          "This goal needs an unavailable page control or more specific instructions.",
        );
      if (d.choice === "WAIT") {
        await new Promise((r) => setTimeout(r, 750));
        continue;
      }
      const c = s.candidates.find((c) => c.id === d.choice);
      if (!c)
        throw Error("Model selected an unavailable action. Nothing executed.");
      if (
        c.operation === "type" &&
        (typeof d.text !== "string" || !d.text.trim() || d.text.length > 2000)
      )
        throw Error("No valid field value returned. Nothing typed.");
      const entry = {
        operation: c.operation,
        label: c.label,
        text: c.operation === "type" ? d.text : undefined,
        verified: false,
      };
      if (
        goal.history.filter(
          (h) =>
            h.operation === entry.operation &&
            h.label === entry.label &&
            h.text === entry.text,
        ).length >= 2
      )
        throw Error(
          "Stopped because the same action was repeating. Please clarify the goal.",
        );
      expectingNavigation = ["click", "back"].includes(c.operation);
      const result = await execute(
        {
          ...c,
          id: crypto.randomUUID(),
          text: d.text,
          replace: c.operation === "type",
        },
        s,
        goal.g,
      );
      if (!gate.current(goal.g)) return;
      if (result?.status === "confirmation") {
        if (pending) pending.goal = goal;
        return;
      }
      if (
        result?.status !== "executed" ||
        (result.verified === false &&
          ["type", "select", "focus", "undo"].includes(c.operation))
      )
        return;
      entry.verified = result.verified === true;
      goal.history.push(entry);
      state.totalMs = Math.round(performance.now() - goal.started);
      await new Promise((r) => setTimeout(r, 350));
    }
    if (gate.current(goal.g))
      throw Error(
        "Task paused at its step/time limit. Review the page before continuing.",
      );
  } finally {
    if (activeGoal === goal) {
      activeGoal = undefined;
      expectingNavigation = false;
    }
  }
}
async function bind(id: number) {
  await stop();
  const tab = await chrome.tabs.get(id);
  if (!tab.url || !/^https?:/.test(tab.url))
    throw Error("Choose an ordinary HTTP or HTTPS page.");
  const origin = new URL(tab.url).origin + "/*";
  if (!(await chrome.permissions.contains({ origins: [origin] })))
    throw Error("Allow this site using “Use current tab”.");
  await chrome.scripting.executeScript({
    target: { tabId: id },
    files: ["content.js"],
  });
  tabId = id;
  state.tabId = id;
  state.tabTitle = tab.title;
  await chrome.storage.session.set({ tabId: id });
  const s = await snapshot(gate.generation);
  state.elements = s.elements;
  state.omitted = s.omitted;
  state.message = "Tab selected. Try “focus” followed by a field name.";
  await publish();
  const registrations = await chrome.scripting.getRegisteredContentScripts();
  if (!registrations.some((x) => x.matches?.includes(origin)))
    await chrome.scripting.registerContentScripts([
      {
        id: "site-" + crypto.randomUUID(),
        matches: [origin],
        js: ["content.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
}
async function start() {
  if (!token) throw Error("Pair the backend first.");
  if (tabId === undefined) throw Error("Select a tab first.");
  await stop();
  if (!(await chrome.offscreen.hasDocument()))
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification:
        "Capture microphone audio for explicitly enabled voice commands.",
    });
  const session = crypto.randomUUID();
  speechSession = session;
  const result = await chrome.runtime.sendMessage({
    to: "offscreen",
    type: "start",
    session,
  });
  if (!result?.ok)
    throw Error(
      result?.error || "Microphone start failed. Open microphone setup.",
    );
  if (speechSession !== session) return;
  state.listening = true;
  listenStart = Date.now();
  state.status = "LISTENING";
  state.message = "Listening. Say one command at a time.";
  await publish();
}
async function handle(m: any) {
  await ready;
  if (m.type === "get") return state;
  if (m.type === "pair") {
    const p = await api("/v1/pair", { code: m.code });
    token = p.token;
    sessionId = p.sessionId;
    state.paired = true;
    await chrome.storage.session.set({ token, sessionId });
    state.message = "Paired. Choose a web tab.";
    await publish();
    return state;
  }
  if (m.type === "bind") await bind(m.tabId);
  if (m.type === "command") await command(m.text);
  if (m.type === "stop") await stop();
  if (m.type === "start") await start();
  if (m.type === "cancel") await cancel();
  if (m.type === "refresh") {
    const s = await snapshot(gate.generation);
    state.elements = s.elements;
    state.omitted = s.omitted;
    await publish();
  }
  if (m.type === "overlay") {
    await sendContent({ type: "overlay", enabled: m.enabled });
  }
  if (m.type === "speech-token") {
    if (m.session !== speechSession) throw Error("Speech session cancelled.");
    return api("/v1/speech/token", {});
  }
  if (m.type === "speech-event") {
    if (m.session !== speechSession) return;
    const event = m.event;
    if (event.type === "connected") {
      state.status = "LISTENING";
      state.message = "Listening. Say one command at a time.";
      await publish();
      return;
    }
    if (event.type === "error") {
      await cancel("Speech disconnected. Reconnecting with a fresh stream…");
      state.status = "ERROR";
      await publish();
      return;
    }
    if (event.type === "closed") {
      await stop();
      state.message =
        event.message || "Speech stopped. Use Start listening to resume.";
      await publish();
      return;
    }
    if (event.type === "TurnInfo" && typeof event.transcript === "string") {
      state.transcript = event.transcript;
      const n = normalize(event.transcript);
      if (n === "stop listening" || n === "pause listening") {
        await stop();
        return;
      }
      if (state.mode === "command" && (n === "stop" || n === "cancel")) {
        await cancel();
        return;
      }
      if (event.event === "EndOfTurn")
        await command(
          event.transcript,
          `${m.session}:${m.stream}:${event.turn_index}`,
        );
      else await publish();
    }
  }
  return state;
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (
    m.to !== "background" ||
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL("")) ||
    (sender.tab &&
      !sender.url.startsWith(chrome.runtime.getURL("panel.html")) &&
      !(
        sender.url === chrome.runtime.getURL("microphone.html") &&
        ["start", "get"].includes(m.type)
      ))
  )
    return;
  // Only bundled extension pages can command the coordinator; content scripts cannot.
  handle(m)
    .then((value) => reply({ ok: true, value }))
    .catch(async (error) => {
      if (error?.name === "AbortError") {
        reply({ ok: false, error: "Cancelled" });
        return;
      }
      state.status = "ERROR";
      state.message =
        error instanceof Error ? error.message : "Operation failed.";
      await publish();
      reply({ ok: false, error: state.message });
    });
  return true;
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.status === "loading" || change.url)) {
    if (activeGoal && expectingNavigation && gate.current(activeGoal.g)) return;
    void ready.then(() =>
      cancel("Page changed. Wait for it to load, then repeat your command."),
    );
  }
});
chrome.tabs.onRemoved.addListener((id) => {
  if (id === tabId)
    void ready.then(async () => {
      await stop();
      tabId = undefined;
      state.tabId = undefined;
      await chrome.storage.session.remove("tabId");
      await publish();
    });
});
chrome.permissions.onRemoved.addListener(
  () =>
    void ready.then(async () => {
      await stop();
      state.message =
        "Site permission changed. Select and allow the tab again.";
      await publish();
    }),
);

chrome.tabs.onActivated.addListener((info) => {
  if (tabId !== undefined && info.tabId !== tabId)
    void ready.then(() =>
      cancel(
        "Active tab changed. Commands still target the selected tab shown in the panel.",
      ),
    );
});
