let session = "",
  streamId = "",
  socket: WebSocket | undefined,
  media: MediaStream | undefined,
  context: AudioContext | undefined;
let worklet: AudioWorkletNode | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  heartbeat: ReturnType<typeof setInterval> | undefined;
let attempts = 0,
  deadline = 0,
  epoch = 0;
async function emit(event: unknown) {
  if (session)
    await chrome.runtime
      .sendMessage({
        to: "background",
        type: "speech-event",
        session,
        stream: streamId,
        event,
      })
      .catch(() => {});
}
function cleanup() {
  clearTimeout(timer);
  clearInterval(heartbeat);
  heartbeat = undefined;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  socket = undefined;
  worklet?.disconnect();
  worklet = undefined;
  media?.getTracks().forEach((t) => t.stop());
  media = undefined;
  void context?.close().catch(() => {});
  context = undefined;
}
function stop() {
  epoch++;
  session = "";
  cleanup();
}
async function connect(expected: number) {
  if (expected !== epoch) return;
  const response = await chrome.runtime.sendMessage({
    to: "background",
    type: "speech-token",
    session,
  });
  if (expected !== epoch) return;
  if (!response?.ok)
    throw Error(response?.error || "Unable to get speech credentials.");
  const captured = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  if (expected !== epoch) {
    captured.getTracks().forEach((t) => t.stop());
    return;
  }
  media = captured;
  context = new AudioContext({ sampleRate: 16000 });
  await context.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
  if (expected !== epoch) return;
  const rate = context.sampleRate;
  if (![8000, 16000, 24000, 44100, 48000].includes(rate))
    throw Error("Unsupported microphone sample rate.");
  streamId = crypto.randomUUID();
  const ws = new WebSocket(
    `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=${rate}`,
    ["bearer", response.value.access_token],
  );
  socket = ws;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Speech connection timed out.")),
      10000,
    );
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(
        Error(
          "Deepgram connection failed. Check credentials and connectivity.",
        ),
      );
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      reject(Error("Speech connection closed."));
    };
  });
  if (expected !== epoch) {
    ws.close();
    return;
  }
  ws.onmessage = (event) => {
    if (socket !== ws || expected !== epoch) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === "Error") {
        void emit({ type: "error" });
        ws.close();
      } else void emit(data);
    } catch {
      /* Ignore malformed provider telemetry; no action. */
    }
  };
  const source = context.createMediaStreamSource(media);
  worklet = new AudioWorkletNode(context, "pcm");
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(worklet);
  worklet.connect(silent);
  silent.connect(context.destination);
  worklet.port.onmessage = (event) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > rate * 2) {
        ws.close();
        return;
      }
      ws.send(event.data);
    }
  };
  await context.resume();
  await emit({ type: "connected" });
  if (expected !== epoch) return;
  // Audio/WebSocket activity is in this document, not in the service worker.
  // Keep the coordinator alive during the explicitly enabled listening session,
  // including silence, without making model or provider requests.
  heartbeat = setInterval(() => {
    if (expected === epoch && session) void emit({ type: "heartbeat" });
  }, 10000);
  ws.onclose = () => {
    if (expected !== epoch || session === "") return;
    void reconnect(expected);
  };
  ws.onerror = () => ws.close();
  timer = setTimeout(
    () => {
      void emit({
        type: "closed",
        message:
          "Ten-minute listening limit reached. Start listening for another session.",
      });
      stop();
    },
    Math.max(0, deadline - Date.now()),
  );
}
async function reconnect(expected: number) {
  cleanup();
  await emit({ type: "error" });
  if (++attempts > 2 || Date.now() >= deadline) {
    await emit({
      type: "closed",
      message:
        "Speech disconnected. Check the connection and start listening again.",
    });
    stop();
    return;
  }
  await new Promise((r) => setTimeout(r, 500 * 2 ** attempts));
  if (expected !== epoch) return;
  try {
    await connect(expected);
  } catch {
    if (expected === epoch) await reconnect(expected);
  }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to !== "offscreen" || sender.id !== chrome.runtime.id) return;
  if (m.type === "stop") {
    stop();
    reply({ ok: true });
  }
  if (m.type === "start") {
    stop();
    session = m.session;
    attempts = 0;
    deadline = Date.now() + 600000;
    connect(epoch)
      .then(() => reply({ ok: true }))
      .catch((error) => {
        stop();
        reply({ ok: false, error: error.message });
      });
    return true;
  }
});
