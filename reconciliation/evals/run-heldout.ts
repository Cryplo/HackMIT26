import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReconcileResult, SubmissionStatus } from '../src/lib/contracts';
import type { ReviewsResponse, ReviewRow } from '../src/lib/review-contracts';
import { generate, receiptBytes, sha256, uploadFields, validateReview, writeDataset, type ClaimInput, type Cohort, type EvalCase } from './dataset';
import { buildReport, casesCsv, markdownReport, type CaseOutcome, type PhaseResult, type RunContext, type ScoredCase } from './report';

/** Hold-out benchmark entry point. Generation is the default and never touches the network.
 * Seeding and evaluation are explicit, spend provider budget, and refuse to run against an unsupported backend.
 */
export interface Options { generate: boolean; seedRehearsal: boolean; live: boolean; exploratory: boolean; seed: number; out: string; dataset: string | null; review: string | null; baseUrl: string | null; ruleId: string | null }

export function parseArgs(argv: string[]): Options {
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1] ?? null; };
  const flag = (name: string) => argv.includes(`--${name}`);
  const seed = Number(value('seed') ?? 20260919);
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative integer.');
  const live = flag('live');
  const seedRehearsal = flag('seed-rehearsal');
  return {
    generate: flag('generate') || (!live && !seedRehearsal), seedRehearsal, live, exploratory: flag('exploratory'), seed,
    out: value('out') ?? `evals/results/dataset-${seed}`,
    dataset: value('dataset'), review: value('review'), baseUrl: value('base-url'), ruleId: value('rule-id')
  };
}

/** The v2 workspace is the only reviews surface the benchmark reads or gates on. */
export const REVIEWS_PATH = '/api/workspace/reviews';
export interface Preflight { ok: boolean; missing: string[]; observed: { contract_version: number | null; demo_mode: boolean | null; rules_endpoint: number | null; execution: ReviewsResponse['execution'] | null } }
/** The brief blocks a live benchmark against v1, preview data, simulated providers or a missing rule API. */
export async function preflight(baseUrl: string, transport: typeof fetch = fetch): Promise<Preflight> {
  const missing: string[] = [];
  const reviews = await transport(`${baseUrl}${REVIEWS_PATH}`, { headers: { Accept: 'application/json' } });
  if (!reviews.ok) throw new Error(`GET ${REVIEWS_PATH} returned HTTP ${reviews.status}.`);
  const body = (await reviews.json()) as ReviewsResponse & { contract_version?: number };
  const contract = typeof body.contract_version === 'number' ? body.contract_version : null;
  if (contract !== 2) missing.push(`Reviews API reports contract_version=${contract ?? 'absent'}; the benchmark requires the v2 contract.`);
  if (body.demo_mode) missing.push('Server is in demo mode; benchmark evidence must come from a live deployment.');
  const execution = body.execution ?? null;
  for (const [name, mode] of Object.entries(execution ?? {})) if (typeof mode === 'string' && /simulat|fixture|preview/i.test(mode)) missing.push(`${name} is ${mode}; a benchmark run requires live ${name}.`);
  if (!execution) missing.push('Reviews API does not report provider execution modes, so live/simulated cannot be labeled honestly.');
  const rules = await transport(`${baseUrl}/api/rules`, { headers: { Accept: 'application/json' } });
  if (!rules.ok) missing.push(`GET /api/rules returned HTTP ${rules.status}; a draft rule cannot be tested or activated.`);
  return { ok: !missing.length, missing, observed: { contract_version: contract, demo_mode: body.demo_mode ?? null, rules_endpoint: rules.status, execution } };
}

export interface Upload { case_id: string; submission_id: string; receipt_id: string; extraction_status: string; document_sha256: string }
/** Only the seven documented multipart fields are sent; evaluator metadata never reaches the app. */
export async function upload(baseUrl: string, c: UploadableCase, transport: typeof fetch = fetch): Promise<Upload> {
  const form = new FormData();
  for (const [key, value] of Object.entries(uploadFields(c))) form.set(key, value);
  const bytes = c.bytes;
  form.set('file', new File([new Uint8Array(bytes)], `${c.case_id}.pdf`, { type: 'application/pdf' }));
  const response = await transport(`${baseUrl}/api/submissions`, { method: 'POST', body: form, headers: { Origin: baseUrl }, signal: AbortSignal.timeout(120000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Upload of ${c.case_id} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  return { case_id: c.case_id, submission_id: body.submission_id, receipt_id: body.receipt_id, extraction_status: body.extraction_status, document_sha256: sha256(c.bytes) };
}

/** A per-claim failure is returned inside a successful HTTP envelope, so the body is checked too. */
export async function reconcile(baseUrl: string, submissionId: string, transport: typeof fetch = fetch): Promise<{ result: ReconcileResult; latency_ms: number }> {
  const started = process.hrtime.bigint();
  const response = await transport(`${baseUrl}/api/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ submission_ids: [submissionId] }), signal: AbortSignal.timeout(300000) });
  const latency_ms = Number(process.hrtime.bigint() - started) / 1e6;
  const body = await response.json();
  if (!response.ok) throw new Error(`Reconcile of ${submissionId} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  const result: ReconcileResult | undefined = body.results?.[0];
  if (!result) throw new Error(`Reconcile of ${submissionId} returned no result.`);
  if (result.error) throw new Error(`Reconcile of ${submissionId} failed: ${result.error}`);
  return { result, latency_ms };
}

/** Checks are read back from the v2 workspace so the recorded evidence is the server's, not the runner's.
 * The machine assessment is scored; the separate human decision is never treated as an assessment. */
export async function readReviews(baseUrl: string, transport: typeof fetch = fetch): Promise<ReviewRow[]> {
  const response = await transport(`${baseUrl}${REVIEWS_PATH}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${REVIEWS_PATH} returned HTTP ${response.status}.`);
  return ((await response.json()) as ReviewsResponse).submissions;
}
export async function outcomes(baseUrl: string, uploads: Upload[], timings: Map<string, number>, errors: Map<string, string>, transport: typeof fetch = fetch): Promise<CaseOutcome[]> {
  const rows = await readReviews(baseUrl, transport);
  return uploads.map(u => {
    const row = rows.find(r => r.id === u.submission_id) ?? null;
    const checks: CaseOutcome['checks'] = {};
    for (const d of row?.decisions ?? []) if (d.field_checked !== 'overall_status' && d.check_method !== 'human') checks[d.field_checked] = d.verdict;
    const assessment = row?.assessment_status ?? null;
    return {
      case_id: u.case_id, submission_id: u.submission_id, run_id: row?.latest_run_id ?? null,
      status: assessment === 'matched' ? 'approved' : assessment,
      assessment_status: assessment, decision_status: row?.decision_status ?? null,
      extraction_provenance: row?.receipt?.extraction_provenance ?? null,
      checks,
      needs_investigation: Object.values(checks).includes('unknown'),
      error: errors.get(u.case_id) ?? null, latency_ms: timings.get(u.case_id) ?? null
    };
  });
}

/** One upload and one reconcile per case, serialized, in frozen order. Failures are recorded, never dropped,
 * and every mapping already created is persisted before a later upload can abort the phase. */
export async function runPhase(baseUrl: string, cases: UploadableCase[], phase: 'before' | 'after', existing: Upload[] | null, transport: typeof fetch = fetch, persist: (uploads: Upload[]) => Promise<void> = async () => {}): Promise<{ phase: PhaseResult; uploads: Upload[] }> {
  const uploads: Upload[] = existing ? [...existing] : [];
  const timings = new Map<string, number>();
  const errors = new Map<string, string>();
  if (!existing) {
    for (const c of cases) {
      try { uploads.push(await upload(baseUrl, c, transport)); }
      catch (error) { await persist(uploads); throw error; }
      await persist(uploads);
    }
  }
  for (const u of uploads) {
    try { timings.set(u.case_id, (await reconcile(baseUrl, u.submission_id, transport)).latency_ms); }
    catch (e) { errors.set(u.case_id, e instanceof Error ? e.message : String(e)); }
  }
  return { phase: { phase, outcomes: await outcomes(baseUrl, uploads, timings, errors, transport) }, uploads };
}

export interface UploadableCase { case_id: string; input: ClaimInput; bytes: Buffer }
export type ReviewedCase = ScoredCase & UploadableCase & { duplicate_of: string | null };
/** The reviewed dataset on disk is the only truth a scored run may use: labels come from expected.json,
 * documents come from the reviewed PDFs, and every byte is bound to its manifest hash. Nothing is regenerated. */
export async function loadReviewedDataset(dir: string): Promise<ReviewedCase[]> {
  const read = async (file: string) => JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  const inputs = await read('inputs.json') as { cases: ({ case_id: string } & ClaimInput)[] };
  const expected = await read('expected.json') as { cases: { case_id: string; cohort: Cohort; expected: SubmissionStatus; duplicate_of: string | null }[] };
  const manifest = await read('manifest.json') as { cases: { case_id: string; file: string; sha256: string }[] };
  const labels = new Map(expected.cases.map(c => [c.case_id, c]));
  const documents = new Map(manifest.cases.map(c => [c.case_id, c]));
  const cases: ReviewedCase[] = [];
  for (const { case_id, ...input } of inputs.cases) {
    const label = labels.get(case_id);
    const document = documents.get(case_id);
    if (!label) throw new Error(`${case_id} has no reviewed label in ${path.join(dir, 'expected.json')}.`);
    if (!document) throw new Error(`${case_id} has no reviewed document in ${path.join(dir, 'manifest.json')}.`);
    const bytes = await readFile(path.join(dir, document.file));
    const actual = sha256(bytes);
    if (actual !== document.sha256) throw new Error(`Reviewed document ${document.file} hashes ${actual}, not the reviewed ${document.sha256}.`);
    cases.push({ case_id, cohort: label.cohort, expected: label.expected, duplicate_of: label.duplicate_of, input, bytes });
  }
  return cases;
}

const commit = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

/** A reused run directory would overwrite one run's evidence with another's, so it is refused before
 * anything is uploaded. Retrying a failed run needs a new --out. */
export async function claimOutputDir(dir: string): Promise<void> {
  for (const artifact of ['before.json', 'results.json', 'report.md', 'preflight.json', 'uploads.json', 'rehearsal-uploads.json']) {
    if (await access(path.join(dir, artifact)).then(() => true, () => false)) throw new Error(`Refusing to reuse ${dir}: it already holds ${artifact} from an earlier run. Choose a new --out.`);
  }
  await mkdir(dir, { recursive: true });
}

/** Provenance is whatever the server reported for the receipts it actually extracted; a deployment running
 * demo extraction behind live decisions must never be labeled live. */
export function observedExtraction(outcomes: CaseOutcome[]): string {
  const observed = [...new Set(outcomes.map(o => o.extraction_provenance).filter((p): p is string => !!p))];
  return observed.length ? observed.sort().join('; ') : 'unknown';
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.generate) {
    const dataset = generate(options.seed);
    const manifest = await writeDataset(options.out, dataset);
    console.log(`Wrote ${dataset.scored.length} scored claims, 1 source example and ${dataset.rehearsal.length} rehearsal cases to ${options.out}`);
    console.log(`inputs.json ${manifest.inputs_sha256}\nexpected.json ${manifest.expected_sha256}`);
    console.log('Have the team review review.html against the receipts, then record reviewers and both hashes in review.json before any live run.');
    return 0;
  }
  if (!options.baseUrl) throw new Error('--base-url is required for live modes.');
  if (!options.live) throw new Error('Live modes must be requested explicitly with --live.');

  if (options.seedRehearsal) {
    // Rehearsal data only. This spends provider budget when extraction is live and is not evidence of accuracy.
    const dataset = generate(options.seed);
    await claimOutputDir(options.out);
    const uploads: Upload[] = [];
    const record = () => writeFile(path.join(options.out, 'rehearsal-uploads.json'), JSON.stringify(uploads, null, 2));
    for (const c of dataset.rehearsal) {
      try { uploads.push(await upload(options.baseUrl, { case_id: c.case_id, input: c.input, bytes: receiptBytes(c) }, fetch)); }
      catch (error) { await record(); throw error; }
      await record();
    }
    for (const u of uploads) console.log(`${u.case_id} -> submission ${u.submission_id} receipt ${u.receipt_id} extraction ${u.extraction_status} (${options.baseUrl}/api/receipts/${u.receipt_id})`);
    console.log(`Workspace: ${options.baseUrl}/business-demo`);
    return 0;
  }

  // --exploratory measures whatever deployment is in front of it and says so in every artifact. It is not a benchmark:
  // it cannot satisfy the review gate, the v2 contract or live providers, and its numbers must never be quoted as accuracy.
  if (!options.dataset) throw new Error('An evaluation needs --dataset.');
  if (!options.review && !options.exploratory) throw new Error('A benchmark run needs --review; use --exploratory to measure an unvalidated deployment.');
  const review = options.review ? await validateReview(options.dataset, options.review) : null;
  await claimOutputDir(options.out);
  const gates = await preflight(options.baseUrl, fetch);
  const context: RunContext = {
    run_id: path.basename(options.out), source_commit: commit(), started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    dataset_dir: options.dataset, inputs_sha256: review?.inputs_sha256 ?? 'unreviewed', expected_sha256: review?.expected_sha256 ?? 'unreviewed',
    review: review ? { reviewers: review.reviewers, reviewed_at: review.reviewed_at } : null,
    providers: { extraction: 'unknown', decisions: String(gates.observed.execution?.decisions ?? 'unknown'), retrieval: String(gates.observed.execution?.retrieval ?? 'unknown'), storage: String(gates.observed.execution?.storage ?? 'unknown') },
    rule: options.ruleId ? { id: options.ruleId, version: null, activated: false, gate_report: null } : null,
    isolation: 'not established',
    limitations: options.exploratory ? ['EXPLORATORY RUN: unreviewed dataset against a deployment that fails benchmark preflight. These numbers describe this deployment only and are not benchmark accuracy.', ...gates.missing] : gates.missing
  };
  if (!gates.ok && !options.exploratory) {
    await writeFile(path.join(options.out, 'preflight.json'), JSON.stringify({ ...gates, context }, null, 2));
    console.error('Preflight failed; no benchmark was run. Missing prerequisites:');
    for (const m of gates.missing) console.error(`- ${m}`);
    return 2;
  }
  const cases = await loadReviewedDataset(options.dataset);
  if (options.exploratory) console.warn(`EXPLORATORY: results are not benchmark accuracy${gates.ok ? '' : '; preflight gates failed'}.`);
  const before = await runPhase(options.baseUrl, cases, 'before', null, fetch, uploads => writeFile(path.join(options.out, 'uploads.json'), JSON.stringify(uploads, null, 2)));
  await writeFile(path.join(options.out, 'before.json'), JSON.stringify(before.phase, null, 2));
  // Activation goes through the reviewed rule API only; this runner never edits storage or learns on its own.
  const report = buildReport(cases, before.phase, null, { ...context, finished_at: new Date().toISOString(), providers: { ...context.providers, extraction: observedExtraction(before.phase.outcomes) }, limitations: [...context.limitations, 'Rule activation and the after phase were not executed by this runner.'] }, []);
  await writeFile(path.join(options.out, 'results.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(options.out, 'cases.csv'), casesCsv(report));
  await writeFile(path.join(options.out, 'report.md'), markdownReport(report));
  console.log(`Baseline complete. Artifacts in ${options.out}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
