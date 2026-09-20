import type { SubmissionStatus } from '../src/lib/contracts';
import { csvRow, type Cohort } from './dataset';

/** Scoring needs only the reviewed label of a case, whether it came from a generator or from disk. */
export interface ScoredCase { case_id: string; cohort: Cohort; expected: SubmissionStatus }

/** Pure metric calculation and export. Nothing here talks to the app, and nothing rewrites an expectation. */
export type Phase = 'before' | 'after';
export interface CaseOutcome {
  case_id: string;
  submission_id: string | null;
  run_id: string | null;
  /** Scored label, projected from the machine assessment only. */
  status: SubmissionStatus | null;
  /** v2 assessment and the separate human decision, kept apart so a reviewer never scores the machine. */
  assessment_status?: 'matched' | 'flagged' | 'needs_review' | null;
  decision_status?: 'pending' | 'approved' | 'rejected' | null;
  /** Provenance reported by the server for this receipt's extraction, never inferred from other providers. */
  extraction_provenance?: string | null;
  /** Deterministic and semantic check verdicts by field, exactly as returned. */
  checks: Record<string, 'pass' | 'fail' | 'unknown'>;
  needs_investigation: boolean;
  error: string | null;
  latency_ms: number | null;
}
export interface PhaseResult { phase: Phase; outcomes: CaseOutcome[] }
export interface UsageTotal { phase: string; model: string; calls: number; input_tokens: number | null; output_tokens: number | null; estimated_cost_usd: number | null }
export interface RunContext {
  run_id: string; source_commit: string; started_at: string; finished_at: string;
  dataset_dir: string; inputs_sha256: string; expected_sha256: string; review: { reviewers: string[]; reviewed_at: string } | null;
  providers: { extraction: string; decisions: string; retrieval: string; storage: string };
  rule: { id: string; version: number | null; activated: boolean; gate_report: unknown } | null;
  isolation: string; limitations: string[];
}
export interface Report { context: RunContext; metrics: Metrics; cases: CaseRow[]; usage: UsageTotal[] }
export interface CaseRow { case_id: string; cohort: Cohort; expected: SubmissionStatus; before: SubmissionStatus | null; after: SubmissionStatus | null; changed: boolean; worsened: boolean; error_before: string | null; error_after: string | null; latency_before_ms: number | null; latency_after_ms: number | null }
export interface PhaseMetrics {
  scored: number; errors: number;
  incorrect_matches: { count: number; of: number };
  violations_caught: { count: number; of: number; unsafe_matches: string[] };
  duplicates_caught: { count: number; of: number };
  valid_needing_investigation: { count: number; of: number };
  valid_incorrectly_flagged: { count: number; of: number };
  confusion: Record<string, Record<string, number>>;
  latency: { samples: number; median_ms: number | null; p95_ms: number | null };
}
export interface Metrics { before: PhaseMetrics; after: PhaseMetrics | null; learning: { improved: string[]; worsened: string[]; unchanged: number } | null; safety: { passed: boolean; violations: string[] } }

const LABELS: SubmissionStatus[] = ['approved', 'flagged', 'needs_review'];
const HARD_CHECKS = ['amount', 'currency', 'policy', 'receipt_date', 'policy_cap', 'duplicate'];

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
const by = <T>(rows: T[], f: (row: T) => boolean) => rows.filter(f);

export function phaseMetrics(cases: ScoredCase[], phase: PhaseResult): PhaseMetrics {
  const outcome = new Map(phase.outcomes.map(o => [o.case_id, o]));
  const paired = cases.map(c => ({ c, o: outcome.get(c.case_id) ?? null }));
  const valid = by(paired, x => x.c.expected === 'approved');
  const violations = by(paired, x => x.c.cohort === 'violation');
  const duplicates = by(paired, x => x.c.cohort === 'duplicate');
  const nonMatch = by(paired, x => x.c.expected !== 'approved');
  const confusion: Record<string, Record<string, number>> = Object.fromEntries(LABELS.map(e => [e, Object.fromEntries(LABELS.map(a => [a, 0]))]));
  let errors = 0;
  for (const { c, o } of paired) {
    if (!o || o.error || !o.status) { errors++; continue; }
    confusion[c.expected][o.status]++;
  }
  const latencies = paired.flatMap(x => (x.o?.latency_ms ?? null) === null ? [] : [x.o!.latency_ms!]);
  const unsafe = violations.concat(duplicates).flatMap(x => x.o?.status === 'approved' ? [x.c.case_id] : []);
  return {
    scored: cases.length, errors,
    incorrect_matches: { count: by(nonMatch, x => x.o?.status === 'approved').length, of: nonMatch.length },
    violations_caught: { count: by(violations, x => x.o?.status === 'flagged').length, of: violations.length, unsafe_matches: unsafe },
    duplicates_caught: { count: by(duplicates, x => x.o?.status === 'flagged').length, of: duplicates.length },
    valid_needing_investigation: { count: by(valid, x => x.o?.status === 'needs_review' || x.o?.needs_investigation === true).length, of: valid.length },
    valid_incorrectly_flagged: { count: by(valid, x => x.o?.status === 'flagged').length, of: valid.length },
    confusion,
    latency: { samples: latencies.length, median_ms: percentile(latencies, 50), p95_ms: percentile(latencies, 95) }
  };
}

/** An alias may never turn a failed financial, policy or duplicate check into a pass. Evidence, not just status. */
export function safetyViolations(before: PhaseResult, after: PhaseResult): string[] {
  const first = new Map(before.outcomes.map(o => [o.case_id, o]));
  return after.outcomes.flatMap(o => {
    const prior = first.get(o.case_id);
    if (!prior) return [];
    const flipped = HARD_CHECKS.filter(field => prior.checks[field] === 'fail' && o.checks[field] === 'pass');
    const promoted = prior.status !== 'approved' && o.status === 'approved' && flipped.length ? [`${o.case_id}: assessment became matched after a hard check flipped`] : [];
    return [...flipped.map(field => `${o.case_id}: ${field} changed fail -> pass after learning`), ...promoted];
  });
}

export function buildReport(cases: ScoredCase[], before: PhaseResult, after: PhaseResult | null, context: RunContext, usage: UsageTotal[]): Report {
  const firstOutcome = new Map(before.outcomes.map(o => [o.case_id, o]));
  const secondOutcome = new Map((after?.outcomes ?? []).map(o => [o.case_id, o]));
  const rows: CaseRow[] = cases.map(c => {
    const a = firstOutcome.get(c.case_id) ?? null;
    const b = after ? secondOutcome.get(c.case_id) ?? null : null;
    const correct = (status: SubmissionStatus | null | undefined) => status === c.expected;
    return {
      case_id: c.case_id, cohort: c.cohort, expected: c.expected,
      before: a?.status ?? null, after: b?.status ?? null,
      changed: !!after && a?.status !== b?.status,
      worsened: !!after && correct(a?.status) && !correct(b?.status),
      error_before: a?.error ?? null, error_after: b?.error ?? null,
      latency_before_ms: a?.latency_ms ?? null, latency_after_ms: b?.latency_ms ?? null
    };
  });
  const safety = after ? safetyViolations(before, after) : [];
  return {
    context, usage, cases: rows,
    metrics: {
      before: phaseMetrics(cases, before),
      after: after ? phaseMetrics(cases, after) : null,
      learning: after ? {
        improved: rows.filter(r => r.changed && r.after === r.expected).map(r => r.case_id),
        worsened: rows.filter(r => r.worsened).map(r => r.case_id),
        unchanged: rows.filter(r => !r.changed).length
      } : null,
      safety: { passed: !safety.length, violations: safety }
    }
  };
}

export function casesCsv(report: Report): string {
  const header = ['case_id', 'cohort', 'expected', 'before', 'after', 'changed', 'worsened', 'error_before', 'error_after', 'latency_before_ms', 'latency_after_ms'];
  return [csvRow(header), ...report.cases.map(r => csvRow([r.case_id, r.cohort, r.expected, r.before, r.after, String(r.changed), String(r.worsened), r.error_before, r.error_after, r.latency_before_ms, r.latency_after_ms]))].join('\n') + '\n';
}

const fraction = (x: { count: number; of: number }) => `${x.count} / ${x.of}`;
export function markdownReport(report: Report): string {
  const { context: c, metrics: m } = report;
  const phase = (name: string, p: PhaseMetrics | null) => p ? [
    `### ${name}`, '',
    `| Metric | Value |`, `| --- | --- |`,
    `| Incorrect matches (expected flagged/needs_review, observed matched) | ${fraction(p.incorrect_matches)} |`,
    `| Violations caught | ${fraction(p.violations_caught)} |`,
    `| Duplicates caught | ${fraction(p.duplicates_caught)} |`,
    `| Valid cases needing investigation | ${fraction(p.valid_needing_investigation)} |`,
    `| Valid cases incorrectly flagged | ${fraction(p.valid_incorrectly_flagged)} |`,
    `| Cases with errors (kept in denominators) | ${p.errors} / ${p.scored} |`,
    `| Latency median / p95 (n=${p.latency.samples}) | ${p.latency.median_ms ?? 'unknown'} ms / ${p.latency.p95_ms ?? 'unknown'} ms |`,
    `| Unsafe matches | ${p.violations_caught.unsafe_matches.join(', ') || 'none'} |`, '',
    '| expected \\ observed | matched | flagged | needs_review |', '| --- | ---: | ---: | ---: |',
    ...LABELS.map(e => `| ${e} | ${p.confusion[e].approved} | ${p.confusion[e].flagged} | ${p.confusion[e].needs_review} |`), ''
  ].join('\n') : `### ${name}\n\nNot run.\n`;
  return [
    `# Sift hold-out benchmark — run ${c.run_id}`, '',
    `Source commit ${c.source_commit}; dataset ${c.dataset_dir} (inputs ${c.inputs_sha256.slice(0, 12)}, labels ${c.expected_sha256.slice(0, 12)}).`,
    `Providers: extraction ${c.providers.extraction}, decisions ${c.providers.decisions}, retrieval ${c.providers.retrieval}, storage ${c.providers.storage}.`,
    `Human review: ${c.review ? `${c.review.reviewers.join(', ')} on ${c.review.reviewed_at}` : 'NOT PERFORMED — this run is not a validated benchmark.'}`,
    `Rule: ${c.rule ? `${c.rule.id} v${c.rule.version ?? '?'} ${c.rule.activated ? 'activated' : 'not activated'}` : 'none'}. Isolation: ${c.isolation}.`, '',
    phase('Baseline', m.before), phase('After learning', m.after), '',
    '### Learning', '',
    m.learning ? `Improved: ${m.learning.improved.join(', ') || 'none'}. Worsened: ${m.learning.worsened.join(', ') || 'none'}. Unchanged: ${m.learning.unchanged}.` : 'Only one phase was executed.', '',
    `### Safety`, '', m.safety.passed ? 'No hard check flipped fail to pass.' : m.safety.violations.map(v => `- ${v}`).join('\n'), '',
    '### Model usage', '', '| Phase | Model | Calls | Input tokens | Output tokens | Estimated cost |', '| --- | --- | ---: | ---: | ---: | ---: |',
    ...(report.usage.length ? report.usage.map(u => `| ${u.phase} | ${u.model} | ${u.calls} | ${u.input_tokens ?? 'unknown'} | ${u.output_tokens ?? 'unknown'} | ${u.estimated_cost_usd === null ? 'unknown' : `$${u.estimated_cost_usd.toFixed(4)}`} |`) : ['| — | — | 0 | unknown | unknown | unknown |']), '',
    '### Limitations', '', ...c.limitations.map(l => `- ${l}`), ''
  ].join('\n');
}
