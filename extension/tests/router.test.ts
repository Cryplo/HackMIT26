import { describe, it, expect } from "vitest";
import { route, TurnGate } from "../src/voice/router";
describe("voice routing", () => {
  it("keeps literal dictation literal", () => {
    expect(route("click 12", "dictation")).toEqual({
      kind: "type",
      text: "click 12",
    });
    expect(route("cancel", "dictation")).toEqual({
      kind: "type",
      text: "cancel",
    });
    expect(route("finish dictation.", "dictation")).toEqual({ kind: "finish" });
    expect(route("Stop listening.", "dictation")).toEqual({ kind: "stop" });
  });
  it("uses exact grammar only", () => {
    expect(route("click 12", "command")).toEqual({
      kind: "target",
      operation: "click",
      id: "12",
    });
    expect(route("click 12 then send", "command")).toEqual({
      kind: "semantic",
    });
    expect(route("Type: A.B@example.com", "command")).toEqual({
      kind: "type",
      text: "A.B@example.com",
    });
    expect(route("confirm submit", "command")).toEqual({ kind: "confirm" });
    expect(route("yes", "command")).toEqual({ kind: "semantic" });
  });
  it("deduplicates turns and invalidates old generations", () => {
    const gate = new TurnGate();
    expect(gate.accept("s:1")).toBe(true);
    expect(gate.accept("s:1")).toBe(false);
    const g = gate.generation;
    gate.cancel();
    expect(gate.current(g)).toBe(false);
    expect(gate.accept("s:2")).toBe(true);
  });
});

it("routes free-form goals to the planner and keeps dictation literal", () => {
  expect(route("fill out fullname as Dylan Li", "command")).toEqual({
    kind: "semantic",
  });
  expect(
    route(
      "Put Dylan Li into my name and dylan@example.com into email",
      "command",
    ),
  ).toEqual({ kind: "semantic" });
  expect(route("Type Dylan Li into the full name field", "command")).toEqual({
    kind: "semantic",
  });
  expect(route("fill out fullname as Dylan Li", "dictation")).toEqual({
    kind: "type",
    text: "fill out fullname as Dylan Li",
  });
});
