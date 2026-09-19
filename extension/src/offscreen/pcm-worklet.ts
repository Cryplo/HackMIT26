declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
// AudioContext is requested at 16 kHz; if Chrome chooses another rate we advertise
// that actual rate to Deepgram. No mislabeled or discarded input samples.
class PCM extends AudioWorkletProcessor {
  private buffer: number[] = [];
  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let v = 0;
      for (const channel of channels) v += channel[i] || 0;
      v = Math.max(-1, Math.min(1, v / channels.length));
      this.buffer.push(v < 0 ? Math.round(v * 32768) : Math.round(v * 32767));
    }
    const length = Math.round(sampleRate * 0.06);
    while (this.buffer.length >= length) {
      const bytes = new ArrayBuffer(length * 2),
        view = new DataView(bytes);
      for (let i = 0; i < length; i++)
        view.setInt16(i * 2, this.buffer[i], true);
      this.buffer.splice(0, length);
      this.port.postMessage(bytes, [bytes]);
    }
    return true;
  }
}
registerProcessor("pcm", PCM);
