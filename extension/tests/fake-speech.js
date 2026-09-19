// Test-only provider adapter, copied exclusively into a temporary extension build.
// The production extension never loads this file.
let latest,
  chunks = 0,
  bytes = 0;
class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
  constructor(url, protocols) {
    if (!url.includes("sample_rate=16000") || protocols[0] !== "bearer")
      throw Error("Invalid speech contract");
    latest = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 5);
  }
  send(data) {
    if (data instanceof ArrayBuffer) {
      chunks++;
      bytes += data.byteLength;
    }
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
}
globalThis.WebSocket = FakeWebSocket;
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to !== "test-speech") return;
  if (m.event) latest?.onmessage?.({ data: JSON.stringify(m.event) });
  if (m.disconnect) latest?.close();
  reply({ chunks, bytes, open: latest?.readyState === 1 });
});
