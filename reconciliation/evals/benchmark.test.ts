import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundledSampleHashes, COHORT_COUNTS, csvRow, generate, receiptBytes, sha256, uploadFields, validateReview, writeDataset } from './dataset';
import { buildReport, casesCsv, markdownReport, percentile, phaseMetrics, safetyViolations, type CaseOutcome, type PhaseResult, type RunContext } from './report';
import { claimOutputDir, loadReviewedDataset, main, observedExtraction, outcomes, parseArgs, preflight, runPhase, upload, type UploadableCase } from './run-heldout';

const uploadable = (c: { case_id: string; input: UploadableCase['input'] } & { fields?: unknown }): UploadableCase =>
  ({ case_id: c.case_id, input: c.input, bytes: receiptBytes(c as never) });
const workspaceRow = (id: string, assessment: string | null, decisions: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id, assessment_status: assessment, decision_status: 'pending', latest_run_id: `run-${id}`, review_revision: 0, decisions, ...extra });
const workspaceBody = (rows: unknown[]) => ({ contract_version: 2, snapshot_token: 'a'.repeat(64), knowledge_revision: 0, submissions: rows, summary: {}, demo_mode: false });

const SEED = 20260919;
const context = (): RunContext => ({
  run_id: 'test-run', source_commit: 'test', started_at: '2026-09-20T00:00:00.000Z', finished_at: '2026-09-20T00:10:00.000Z',
  dataset_dir: 'evals/results/dataset-test', inputs_sha256: 'a'.repeat(64), expected_sha256: 'b'.repeat(64),
  review: { reviewers: ['Synthetic Reviewer'], reviewed_at: '2026-09-20' }, providers: { extraction: 'live', decisions: 'live', retrieval: 'live', storage: 'live' },
  rule: null, isolation: 'two copies of a quiescent local store', limitations: []
});
const outcome = (case_id: string, status: CaseOutcome['status'], checks: CaseOutcome['checks'] = {}, extra: Partial<CaseOutcome> = {}): CaseOutcome =>
  ({ case_id, submission_id: `sub-${case_id}`, run_id: `run-${case_id}`, status, checks, needs_investigation: false, error: null, latency_ms: 100, ...extra });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a seed reproduces identical claims, receipts and cohort counts', () => {
  const a = generate(SEED), b = generate(SEED);
  assert.deepEqual(a, b);
  assert.deepEqual(a.scored.map(c => sha256(receiptBytes(c))), b.scored.map(c => sha256(receiptBytes(c))));
  assert.notDeepEqual(generate(SEED + 1).scored.map(c => c.input.amount_requested_minor), a.scored.map(c => c.input.amount_requested_minor));
  assert.equal(a.scored.length, 50);
  for (const [cohort, count] of Object.entries(COHORT_COUNTS)) assert.equal(a.scored.filter(c => c.cohort === cohort).length, count, cohort);
  assert.equal(new Set(a.scored.map(c => c.case_id)).size, 50);
  assert.deepEqual([...new Set(a.scored.map(c => c.expected))].sort(), ['approved', 'flagged', 'needs_review']);
});

test('every duplicate copies an earlier original byte for byte, and no scored receipt reuses reserved evidence', () => {
  const dataset = generate(SEED);
  const order = new Map(dataset.scored.map((c, i) => [c.case_id, i]));
  const duplicates = dataset.scored.filter(c => c.cohort === 'duplicate');
  assert.equal(duplicates.length, 6);
  for (const copy of duplicates) {
    const original = dataset.scored.find(c => c.case_id === copy.duplicate_of)!;
    assert.equal(sha256(receiptBytes(copy)), sha256(receiptBytes(original)));
    assert.ok(order.get(original.case_id)! < order.get(copy.case_id)!, `${copy.case_id} must be uploaded after its original`);
    assert.equal(copy.input.attendee_name, original.input.attendee_name);
  }
  assert.ok(duplicates.filter(c => dataset.scored.find(o => o.case_id === c.duplicate_of)!.cohort === 'unfamiliar').length >= 2);
  const reserved = new Set([...bundledSampleHashes(), sha256(receiptBytes(dataset.source)), ...dataset.rehearsal.map(c => sha256(receiptBytes(c)))]);
  for (const c of dataset.scored) assert.ok(!reserved.has(sha256(receiptBytes(c))), `${c.case_id} reuses reserved evidence`);
  // The learned descriptor must appear on financial counterexamples, or learning cannot be caught being unsafe.
  const alias = dataset.alias.observed_vendor;
  assert.ok(dataset.scored.filter(c => c.cohort === 'violation' && c.fields.vendor === alias).length >= 4);
  assert.equal(dataset.scored.filter(c => c.cohort === 'unfamiliar' && c.fields.vendor === alias).length, 10);
});

test('an upload carries only the seven documented fields and no answer-key text', async () => {
  const dataset = generate(SEED);
  const violation = dataset.scored.find(c => c.cohort === 'violation')!;
  assert.deepEqual(Object.keys(uploadFields(violation)).sort(), ['amount_requested_minor', 'attendee_name', 'category', 'currency', 'email', 'origin_location'].sort());
  let sent: FormData | null = null;
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = init!.body as FormData;
    return jsonResponse({ submission_id: 'sub-1', receipt_id: 'rec-1', extraction_status: 'succeeded' }, 201);
  }) as unknown as typeof fetch;
  const result = await upload('http://127.0.0.1:3000', uploadable(violation), transport);
  assert.equal(result.submission_id, 'sub-1');
  const keys = [...sent!.keys()].sort();
  assert.deepEqual(keys, ['amount_requested_minor', 'attendee_name', 'category', 'currency', 'email', 'file', 'origin_location']);
  const serialized = keys.filter(k => k !== 'file').map(k => String(sent!.get(k))).join(' ');
  for (const leak of [violation.cohort, violation.expected, violation.note, violation.case_id]) assert.ok(!serialized.includes(leak), `upload leaked ${leak}`);
  assert.equal((sent!.get('file') as File).name, `${violation.case_id}.pdf`);
});

test('preflight refuses a live benchmark against the v1 backend and names every prerequisite', async () => {
  const transport = (async (url: string | URL | Request) => String(url).endsWith('/api/rules')
    ? new Response('Not found', { status: 404 })
    : jsonResponse({ submissions: [], summary: {}, demo_mode: true, execution: { decisions: 'simulated fixtures', retrieval: 'simulated', storage: 'local files' } })) as unknown as typeof fetch;
  const gates = await preflight('http://127.0.0.1:3000', transport);
  assert.equal(gates.ok, false);
  assert.equal(gates.observed.contract_version, null);
  assert.equal(gates.observed.rules_endpoint, 404);
  assert.ok(gates.missing.some(m => m.includes('contract_version')));
  assert.ok(gates.missing.some(m => m.includes('demo mode')));
  assert.ok(gates.missing.some(m => m.includes('/api/rules returned HTTP 404')));
  assert.ok(gates.missing.some(m => m.includes('decisions is simulated fixtures')));
});

test('preflight reads the v2 workspace endpoint and passes only on live providers and a rule API', async () => {
  const seen: string[] = [];
  const transport = (async (url: string | URL | Request) => {
    seen.push(new URL(String(url)).pathname);
    return String(url).endsWith('/api/rules')
      ? jsonResponse({ rules: [] })
      : jsonResponse({ contract_version: 2, submissions: [], summary: {}, demo_mode: false, execution: { extraction: 'See each receipt extraction provenance', decisions: 'live jev', retrieval: 'elasticsearch', storage: 'supabase', investigation: 'not enabled' } });
  }) as unknown as typeof fetch;
  assert.deepEqual(await preflight('http://127.0.0.1:3000', transport).then(g => g.missing), []);
  assert.ok(seen.includes('/api/workspace/reviews'), `preflight read ${seen.join(', ')}`);
  assert.ok(!seen.includes('/api/reviews'));
});

test('a phase records server evidence, keeps failed cases and never drops a case', async () => {
  const cases = generate(SEED).scored.slice(0, 3).map(uploadable);
  const rows = cases.map((c, i) => workspaceRow(`sub-${i}`, ['matched', 'flagged', 'needs_review'][i], [{ field_checked: 'amount', check_method: 'deterministic', verdict: i === 1 ? 'fail' : 'pass' }, { field_checked: 'overall_status', check_method: 'deterministic', verdict: 'pass' }]));
  let uploads = 0;
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/api/submissions')) return jsonResponse({ submission_id: `sub-${uploads++}`, receipt_id: `rec-${uploads}`, extraction_status: 'succeeded' }, 201);
    if (href.endsWith('/api/reconcile')) return JSON.parse(String(init!.body)).submission_ids[0] === 'sub-2'
      ? jsonResponse({ error: { code: 'DEMO_BUSY', message: 'busy' } }, 503)
      : jsonResponse({ results: [{ submission_id: 'x', run_id: 'r', status: 'approved' }] });
    return jsonResponse(workspaceBody(rows));
  }) as unknown as typeof fetch;
  const { phase } = await runPhase('http://127.0.0.1:3000', cases, 'before', null, transport);
  assert.equal(phase.outcomes.length, 3);
  assert.equal(phase.outcomes[2].error?.includes('HTTP 503'), true);
  assert.deepEqual(phase.outcomes.map(o => o.status), ['approved', 'flagged', 'needs_review']);
  assert.deepEqual(phase.outcomes[1].checks, { amount: 'fail' });
  assert.equal(phase.outcomes[0].latency_ms !== null, true);
});

test('a missing review, stale hashes or a mismatched seed block a live evaluation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'evals-review-'));
  try {
    const dataset = generate(SEED);
    const manifest = await writeDataset(dir, dataset);
    await assert.rejects(writeDataset(dir, dataset), /Refusing to overwrite/);
    const reviewPath = path.join(dir, 'review.json');
    const review = { dataset_dir: dir, reviewers: ['Synthetic Reviewer'], reviewed_at: '2026-09-20', minutes_spent: 90, inputs_sha256: manifest.inputs_sha256, expected_sha256: manifest.expected_sha256, corrections: [] };
    await writeFileJson(reviewPath, review);
    assert.equal((await validateReview(dir, reviewPath)).reviewers.length, 1);
    await writeFileJson(reviewPath, { ...review, reviewers: [] });
    await assert.rejects(validateReview(dir, reviewPath), /no reviewers/);
    await writeFileJson(reviewPath, { ...review, expected_sha256: 'c'.repeat(64) });
    await assert.rejects(validateReview(dir, reviewPath), /stale/);
    assert.equal((await loadReviewedDataset(dir)).length, 50);
    // Answers, cohorts and duplicate links live only in the answer key.
    const inputs = await readFile(path.join(dir, 'inputs.json'), 'utf8');
    for (const leak of ['cohort', 'expected', 'duplicate_of', 'violation']) assert.ok(!inputs.includes(leak), `inputs.json leaks ${leak}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('metrics count unsafe matches, keep errors in the denominator and compute paired learning', () => {
  const cases = generate(SEED).scored;
  const violation = cases.find(c => c.cohort === 'violation')!;
  const duplicate = cases.find(c => c.cohort === 'duplicate')!;
  const unfamiliar = cases.find(c => c.cohort === 'unfamiliar')!;
  const base = (status: (c: typeof cases[number]) => CaseOutcome['status']): PhaseResult =>
    ({ phase: 'before', outcomes: cases.map(c => outcome(c.case_id, status(c), { amount: c.case_id === violation.case_id ? 'fail' : 'pass' })) });
  const before = base(c => c.cohort === 'unfamiliar' ? 'needs_review' : c.expected);
  before.outcomes[0] = outcome(cases[0].case_id, null, {}, { error: 'HTTP 503', latency_ms: null });
  const metrics = phaseMetrics(cases, before);
  assert.equal(metrics.scored, 50);
  assert.equal(metrics.errors, 1);
  assert.deepEqual(metrics.violations_caught, { count: 8, of: 8, unsafe_matches: [] });
  assert.deepEqual(metrics.duplicates_caught, { count: 6, of: 6 });
  assert.equal(metrics.valid_needing_investigation.count, 10);
  assert.equal(metrics.valid_needing_investigation.of, 30);
  assert.equal(metrics.incorrect_matches.of, 20);
  assert.equal(metrics.latency.median_ms, 100);

  const after: PhaseResult = { phase: 'after', outcomes: cases.map(c => outcome(c.case_id, c.expected, { amount: c.case_id === violation.case_id ? 'fail' : 'pass' })) };
  const report = buildReport(cases, before, after, context(), []);
  assert.ok(report.metrics.learning!.improved.includes(unfamiliar.case_id));
  assert.ok(report.metrics.learning!.improved.includes(cases[0].case_id));
  assert.equal(report.metrics.safety.passed, true);
  assert.ok(!report.metrics.learning!.worsened.length);
  assert.ok(markdownReport(report).includes('Violations caught | 8 / 8'));
  assert.ok(markdownReport(report).includes(duplicate.case_id) === false);
});

test('an unsafe alias that flips a hard check fails the safety report even when accuracy rises', () => {
  const cases = generate(SEED).scored;
  const violation = cases.find(c => c.cohort === 'violation')!;
  const before: PhaseResult = { phase: 'before', outcomes: cases.map(c => outcome(c.case_id, c.expected, { amount: c.case_id === violation.case_id ? 'fail' : 'pass' })) };
  const after: PhaseResult = { phase: 'after', outcomes: cases.map(c => outcome(c.case_id, c.case_id === violation.case_id ? 'approved' : c.expected, { amount: 'pass' })) };
  const violations = safetyViolations(before, after);
  assert.ok(violations.some(v => v.includes(`${violation.case_id}: amount changed fail -> pass`)));
  assert.ok(violations.some(v => v.includes('became matched')));
  const report = buildReport(cases, before, after, context(), []);
  assert.equal(report.metrics.safety.passed, false);
  assert.ok(markdownReport(report).includes('amount changed fail -> pass'));
  assert.equal(report.metrics.before.incorrect_matches.count, 0);
  assert.equal(report.metrics.after!.incorrect_matches.count, 1);
});

test('exports escape separators and arguments default to offline generation', () => {
  assert.equal(csvRow(['a,b', 'say "hi"', 'line\nbreak', null, 3]), '"a,b","say ""hi""","line\nbreak",,3');
  const cases = generate(SEED).scored.slice(0, 2);
  const before: PhaseResult = { phase: 'before', outcomes: [outcome(cases[0].case_id, 'approved', {}, { error: 'failed, twice' }), outcome(cases[1].case_id, 'flagged')] };
  const csv = casesCsv(buildReport(cases, before, null, context(), []));
  assert.equal(csv.split('\n')[0], 'case_id,cohort,expected,before,after,changed,worsened,error_before,error_after,latency_before_ms,latency_after_ms');
  assert.ok(csv.includes('"failed, twice"'));
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  const offline = parseArgs([]);
  assert.deepEqual([offline.generate, offline.live, offline.seedRehearsal], [true, false, false]);
  assert.equal(parseArgs(['--seed', '7']).out, 'evals/results/dataset-7');
  assert.deepEqual(parseArgs(['--live', '--base-url', 'http://x']).generate, false);
  assert.throws(() => parseArgs(['--seed', 'abc']), /non-negative integer/);
  assert.equal(offline.exploratory, false);
  assert.equal(parseArgs(['--live', '--exploratory', '--base-url', 'http://x']).exploratory, true);
});

test('an evaluation without human review is refused unless it is declared exploratory', async () => {
  await assert.rejects(
    main(['--live', '--base-url', 'http://127.0.0.1:1', '--dataset', 'evals/results/nonexistent']),
    /needs --review/
  );
});

test('outcomes score the machine assessment, never the human decision, and tolerate a missing row', async () => {
  const rows = [
    workspaceRow('sub-a', 'needs_review', [{ field_checked: 'merchant', check_method: 'jev', verdict: 'unknown' }], { receipt: { extraction_provenance: 'demo hash fixture' } }),
    // A human already approved this claim; the machine still says flagged and that is what is scored.
    workspaceRow('sub-b', 'flagged', [{ field_checked: 'amount', check_method: 'deterministic', verdict: 'fail' }, { field_checked: 'overall_status', check_method: 'human', verdict: 'pass' }], { decision_status: 'approved' })
  ];
  const transport = (async () => jsonResponse(workspaceBody(rows))) as unknown as typeof fetch;
  const outcomeRows = await outcomes('http://127.0.0.1:3000', [
    { case_id: 'case-01', submission_id: 'sub-a', receipt_id: 'rec-a', extraction_status: 'succeeded', document_sha256: 'a'.repeat(64) },
    { case_id: 'case-02', submission_id: 'sub-b', receipt_id: 'rec-b', extraction_status: 'succeeded', document_sha256: 'b'.repeat(64) },
    { case_id: 'case-03', submission_id: 'sub-missing', receipt_id: 'rec-c', extraction_status: 'failed', document_sha256: 'c'.repeat(64) }
  ], new Map([['case-01', 42]]), new Map(), transport);
  assert.equal(outcomeRows[0].needs_investigation, true);
  assert.equal(outcomeRows[0].latency_ms, 42);
  assert.deepEqual([outcomeRows[1].status, outcomeRows[1].decision_status], ['flagged', 'approved']);
  assert.deepEqual(outcomeRows[1].checks, { amount: 'fail' });
  assert.deepEqual([outcomeRows[2].status, outcomeRows[2].run_id, outcomeRows[2].latency_ms], [null, null, null]);
  // Extraction provenance is the server's, not the decision provider's.
  assert.equal(observedExtraction(outcomeRows), 'demo hash fixture');
  assert.equal(observedExtraction([]), 'unknown');
});

test('a reviewed label, not the generator, decides the score and every uploaded PDF is its reviewed document', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'evals-reviewed-'));
  try {
    const dataset = generate(SEED);
    await writeDataset(dir, dataset);
    const expectedPath = path.join(dir, 'expected.json');
    const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
    const corrected = expected.cases[0].case_id;
    expected.cases[0].expected = 'needs_review'; // A reviewer corrected the generated label.
    await writeFileJson(expectedPath, expected);
    const reviewed = await loadReviewedDataset(dir);
    assert.equal(reviewed.find(c => c.case_id === corrected)!.expected, 'needs_review');
    assert.notEqual(generate(SEED).scored[0].expected, 'needs_review');
    // Uploaded bytes are the reviewed document, bound to the manifest hash.
    const document = await readFile(path.join(dir, `receipts/${corrected}.pdf`));
    assert.equal(sha256(reviewed.find(c => c.case_id === corrected)!.bytes), sha256(document));
    await writeFileJson(path.join(dir, `receipts/${corrected}.pdf`), { tampered: true });
    await assert.rejects(loadReviewedDataset(dir), /not the reviewed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a per-claim error inside a 200 response is an error outcome, not a silent result', async () => {
  const cases = generate(SEED).scored.slice(0, 1).map(uploadable);
  const transport = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith('/api/submissions')) return jsonResponse({ submission_id: 'sub-0', receipt_id: 'rec-0', extraction_status: 'succeeded' }, 201);
    if (href.endsWith('/api/reconcile')) return jsonResponse({ results: [{ submission_id: 'sub-0', run_id: null, status: 'needs_review', error: 'Reconciliation failed; review required.' }] });
    return jsonResponse(workspaceBody([workspaceRow('sub-0', 'needs_review', [])]));
  }) as unknown as typeof fetch;
  const { phase } = await runPhase('http://127.0.0.1:3000', cases, 'before', null, transport);
  assert.match(phase.outcomes[0].error!, /review required/);
  assert.equal(phase.outcomes[0].latency_ms, null);
});

test('a reused run directory is refused before any upload, and partial upload progress is persisted', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'evals-out-'));
  try {
    await claimOutputDir(dir);
    await writeFileJson(path.join(dir, 'before.json'), { phase: 'before' });
    await assert.rejects(claimOutputDir(dir), /Refusing to reuse/);
    const cases = generate(SEED).scored.slice(0, 3).map(uploadable);
    let uploads = 0;
    const transport = (async (url: string | URL | Request) => {
      if (!String(url).endsWith('/api/submissions')) return jsonResponse(workspaceBody([]));
      if (uploads === 2) return jsonResponse({ error: { code: 'DEMO_BUSY', message: 'busy' } }, 503);
      return jsonResponse({ submission_id: `sub-${uploads++}`, receipt_id: `rec-${uploads}`, extraction_status: 'succeeded' }, 201);
    }) as unknown as typeof fetch;
    const persisted: unknown[][] = [];
    await assert.rejects(runPhase('http://127.0.0.1:3000', cases, 'before', null, transport, async u => { persisted.push(structuredClone(u)); }), /HTTP 503/);
    assert.deepEqual(persisted.at(-1)!.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function writeFileJson(file: string, value: unknown) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify(value, null, 2));
}
