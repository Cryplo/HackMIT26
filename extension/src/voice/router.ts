export type Route =
  | {
      kind:
        | "stop"
        | "cancel"
        | "confirm"
        | "undo"
        | "clear"
        | "dictate"
        | "finish"
        | "semantic";
    }
  | { kind: "type"; text: string }
  | { kind: "target"; operation: "click" | "focus"; id: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "back" };
export function normalize(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, "");
}
export function route(text: string, mode: "command" | "dictation"): Route {
  const t = normalize(text);
  // Dictation keeps normal words literal; only these explicit escape phrases act as commands.
  if (t === "stop listening" || t === "pause listening")
    return { kind: "stop" };
  if (t === "finish dictation") return { kind: "finish" };
  if (mode === "dictation") return { kind: "type", text };
  if (["stop", "cancel"].includes(t)) return { kind: "cancel" };
  if (t === "confirm submit" || t === "confirm action")
    return { kind: "confirm" };
  if (t === "undo last entry") return { kind: "undo" };
  if (t === "clear this field") return { kind: "clear" };
  if (t === "start dictation") return { kind: "dictate" };
  const type = text.match(/^type\s*:\s*(.+)$/is);
  if (type) return { kind: "type", text: type[1] };
  const target = t.match(/^(click|focus) (\d+)$/);
  if (target)
    return {
      kind: "target",
      operation: target[1] as "click" | "focus",
      id: target[2],
    };
  if (t === "scroll down" || t === "scroll up")
    return { kind: "scroll", direction: t.endsWith("down") ? "down" : "up" };
  if (t === "go back") return { kind: "back" };
  return { kind: "semantic" };
}
export class TurnGate {
  generation = 0;
  private seen = new Set<string>();
  accept(id: string) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 2000)
      this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  cancel() {
    return ++this.generation;
  }
  current(generation: number) {
    return generation === this.generation;
  }
}
