export type Operation =
  | "type"
  | "click"
  | "focus"
  | "select"
  | "scroll_up"
  | "scroll_down"
  | "back"
  | "play"
  | "pause";
export type Candidate = {
  id: string;
  operation: Operation;
  label: string;
  target?: string;
  option?: string;
  current_value?: string;
  focused?: boolean;
  required?: boolean;
};
export type ElementInfo = {
  id: string;
  label: string;
  editable: boolean;
  value?: string;
};
export type Snapshot = {
  documentId: string;
  version: number;
  title: string;
  text: string;
  url: string;
  candidates: Candidate[];
  elements: ElementInfo[];
  omitted: number;
  guard: string;
  active?: string;
};
export type Context = {
  sessionId: string;
  turnId: string;
  generation: number;
  tabId: number;
  documentId: string;
  snapshotVersion: number;
};
export type Action = {
  id: string;
  operation: Operation | "type" | "undo" | "clear";
  target?: string;
  option?: string;
  text?: string;
  dictation?: boolean;
  replace?: boolean;
};
export type Execute = {
  action: Action;
  documentId: string;
  guard: string;
  generation: number;
  confirmed?: string;
};
export type Result = {
  status: "executed" | "stale" | "unsupported" | "failed" | "confirmation";
  message: string;
  verified?: boolean;
  confirmation?: string;
  label?: string;
};
export type UIState = {
  status: string;
  message: string;
  tabId?: number;
  tabTitle?: string;
  transcript: string;
  paired: boolean;
  listening: boolean;
  mode: "command" | "dictation";
  elements: ElementInfo[];
  omitted: number;
  pending?: string;
  calls: number;
  successfulCalls: number;
  inputTokens: number;
  outputTokens: number;
  modelMs?: number;
  totalMs?: number;
  executionMs?: number;
  listeningSeconds: number;
};
export const BASE = "http://127.0.0.1:8767";
