import { DEFAULT_PREFERENCES, type Preferences } from "./protocol";

export function preferences(value: unknown): Preferences {
  const p =
    value && typeof value === "object" ? (value as Partial<Preferences>) : {};
  return {
    overlay:
      typeof p.overlay === "boolean" ? p.overlay : DEFAULT_PREFERENCES.overlay,
    patientSpeech:
      typeof p.patientSpeech === "boolean"
        ? p.patientSpeech
        : DEFAULT_PREFERENCES.patientSpeech,
    vocabulary:
      typeof p.vocabulary === "string" ? p.vocabulary.slice(0, 1200) : "",
    microphoneId:
      typeof p.microphoneId === "string" ? p.microphoneId.slice(0, 300) : "",
  };
}

export function speechParameters(p: Preferences, rate: number) {
  const params = new URLSearchParams({
    model: "flux-general-en",
    encoding: "linear16",
    sample_rate: String(rate),
    eot_threshold: p.patientSpeech ? "0.85" : "0.7",
    eot_timeout_ms: p.patientSpeech ? "7000" : "5000",
  });
  for (const term of [
    ...new Set(
      p.vocabulary
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20))
    params.append("keyterm", term.slice(0, 60));
  return params;
}
