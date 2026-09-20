import { describe, expect, it } from "vitest";
import { preferences, speechParameters } from "../src/shared/preferences";
describe("speech preferences", () => {
  it("defaults to patient turn-taking and keeps vocabulary encoded and bounded", () => {
    const p = preferences({ vocabulary: "Dylan Li, C++, Dylan Li, a&b" });
    const query = speechParameters(p, 48000);
    expect(query.get("eot_threshold")).toBe("0.85");
    expect(query.get("eot_timeout_ms")).toBe("7000");
    expect(query.get("sample_rate")).toBe("48000");
    expect(query.getAll("keyterm")).toEqual(["Dylan Li", "C++", "a&b"]);
    expect(new URLSearchParams(query.toString()).getAll("keyterm")).toEqual(
      query.getAll("keyterm"),
    );
  });
  it("rejects malformed settings and permits standard timing without changing the model", () => {
    expect(preferences({ overlay: "yes", microphoneId: 2 }).overlay).toBe(
      false,
    );
    expect(preferences({ microphoneId: 2 }).microphoneId).toBe("");
    const query = speechParameters(
      preferences({ patientSpeech: false }),
      16000,
    );
    expect(query.get("eot_threshold")).toBe("0.7");
    expect(query.get("model")).toBe("flux-general-en");
  });
});
