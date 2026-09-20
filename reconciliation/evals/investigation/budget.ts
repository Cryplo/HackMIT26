/** Proposed provider-call ceiling for the budgeted live vertical slice, and the ledger that enforces it.
 *
 * Nothing here spends anything. The ceiling is a proposal until a human approves it; the
 * ledger exists so a later live run counts every attempt, including retries and failures,
 * and stops instead of quietly re-running.
 */
export type CallKind = 'extraction' | 'investigation_planning' | 'jev_assessment' | 'jev_reassessment' | 'procedure_test' | 'search';

export interface BudgetLine { kind: CallKind; ceiling: number; basis: string }

/** The slice is one narrow flow, not the pack: two investigated claims plus the activation test. */
export const PROPOSED_SLICE: BudgetLine[] = [
  { kind: 'extraction', ceiling: 8, basis: 'Two booking-linked claims and two identity claims, one original plus one supporting document each; one Azure extraction per document, no automatic retry.' },
  { kind: 'jev_assessment', ceiling: 6, basis: 'One Jev evaluation per initial assessment for those four claims, plus two spare for a failed attempt.' },
  { kind: 'investigation_planning', ceiling: 6, basis: 'At most three Azure planning requests per investigated claim, for two investigated claims. Read tools cost no provider call.' },
  { kind: 'jev_reassessment', ceiling: 4, basis: 'One core reassessment per investigation, plus two spare for a retried run after a visible failure.' },
  { kind: 'procedure_test', ceiling: 24, basis: 'The fixed booking-reference-v1 suite: 12 cases evaluated before and after the candidate procedure, one Jev evaluation each.' },
  { kind: 'search', ceiling: 2, basis: 'Workspace search demonstrated at most twice during the recorded walkthrough.' }
];

export const PROPOSED_TOTAL = PROPOSED_SLICE.reduce((n, l) => n + l.ceiling, 0);
/** Wall-clock cap for the whole slice, independent of the per-run 90,000 ms investigation deadline. */
export const PROPOSED_TIME_CAP_MINUTES = 45;

export interface CallRecord {
  kind: CallKind; case_id: string | null; started_at: string; latency_ms: number;
  outcome: 'succeeded' | 'failed' | 'aborted';
  provider: string; model: string | null;
  input_tokens: number | null; output_tokens: number | null; estimated_cost_usd: number | null;
  error: string | null;
}

export class BudgetExceeded extends Error {
  constructor(public kind: CallKind, public ceiling: number) {
    super(`Provider-call ceiling reached for ${kind} (${ceiling}). Stop and get a new approved budget; do not raise it silently.`);
  }
}

/** Counts attempts before they happen, so a failure or retry still consumes budget. */
export class CallLedger {
  private readonly ceilings = new Map<CallKind, number>();
  readonly records: CallRecord[] = [];
  private readonly reserved = new Map<CallKind, number>();

  constructor(lines: BudgetLine[] = PROPOSED_SLICE) {
    for (const line of lines) this.ceilings.set(line.kind, line.ceiling);
  }

  /** Call immediately before issuing a provider request. Throws when the ceiling is reached. */
  reserve(kind: CallKind): void {
    const ceiling = this.ceilings.get(kind) ?? 0;
    const used = (this.reserved.get(kind) ?? 0) + 1;
    if (used > ceiling) throw new BudgetExceeded(kind, ceiling);
    this.reserved.set(kind, used);
  }

  record(record: CallRecord): void { this.records.push(record); }

  used(kind: CallKind): number { return this.reserved.get(kind) ?? 0; }
  get total(): number { return [...this.reserved.values()].reduce((a, b) => a + b, 0); }

  /** Log format written beside every live run: one row per attempt, failures included. */
  log(): string {
    const header = ['kind', 'case_id', 'started_at', 'latency_ms', 'outcome', 'provider', 'model', 'input_tokens', 'output_tokens', 'estimated_cost_usd', 'error'];
    const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [header.join(','), ...this.records.map(r => header.map(k => cell(r[k as keyof CallRecord])).join(','))].join('\n') + '\n';
  }

  summary() {
    return {
      total_attempts: this.total,
      by_kind: Object.fromEntries([...this.ceilings].map(([kind, ceiling]) => [kind, { used: this.used(kind), ceiling }])),
      failures: this.records.filter(r => r.outcome !== 'succeeded').length,
      estimated_cost_usd: this.records.reduce((a, r) => a + (r.estimated_cost_usd ?? 0), 0),
      cost_complete: this.records.every(r => r.estimated_cost_usd !== null)
    };
  }
}
