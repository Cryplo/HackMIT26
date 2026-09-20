import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReconcileResult, ReviewsResponse, SubmissionStatus } from '../src/lib/contracts';
import { generate, receiptBytes, uploadFields, validateReview, writeDataset, type EvalCase } from './dataset';
import { buildReport, casesCsv, markdownReport, type CaseOutcome, type PhaseResult, type RunContext } from './report';

/** Hold-out benchmark entry point. Generation is the default and never touches the network.
 * Seeding and evaluation are explicit, spend provider budget, and refuse to run against an unsupported backend.
 */
export interface Options { generate: boolean; seedRehearsal: boolean; live: boolean; seed: number; out: string; dataset: string | null; review: string | null; baseUrl: string | null; ruleId: string | null }

export function parseArgs(argv: string[]): Options {
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1] ?? null; };
  const flag = (name: string) => argv.includes(`--${name}`);
  const seed = Number(value('seed') ?? 20260919);
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative integer.');
  const live = flag('live');
  const seedRehearsal = flag('seed-rehearsal');
  return {
    generate: flag('generate') || (!live && !seedRehearsal), seedRehearsal, live, seed,
    out: value('out') ?? `evals/results/dataset-${seed}`,
    dataset: value('dataset'), review: value('review'), baseUrl: value('base-url'), ruleId: value('rule-id')
  };
}

export interface Preflight { ok: boolean; missing: string[]; observed: { contract_version: number | null; demo_mode: boolean | null; rules_endpoint: number | null; execution: ReviewsResponse['execution'] | null } }
/** The brief blocks a live benchmark against v1, preview data, simulated providers or a missing rule API. */
export async function preflight(baseUrl: string, transport: typeof fetch = fetch): Promise<Preflight> {
  const missing: string[] = [];
  const reviews = await transport(`${baseUrl}/api/reviews`, { headers: { Accept: 'application/json' } });
  if (!reviews.ok) throw new Error(`GET /api/reviews returned HTTP ${reviews.status}.`);
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

export interface Upload { case_id: string; submission_id: string; receipt_id: string; extraction_status: string }
/** Only the seven documented multipart fields are sent; evaluator metadata never reaches the app. */
export async function upload(baseUrl: string, c: EvalCase, transport: typeof fetch = fetch): Promise<Upload> {
  const form = new FormData();
  for (const [key, value] of Object.entries(uploadFields(c))) form.set(key, value);
  const bytes = receiptBytes(c);
  form.set('file', new File([new Uint8Array(bytes)], `${c.case_id}.pdf`, { type: 'application/pdf' }));
  const response = await transport(`${baseUrl}/api/submissions`, { method: 'POST', body: form, headers: { Origin: baseUrl }, signal: AbortSignal.timeout(120000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Upload of ${c.case_id} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  return { case_id: c.case_id, submission_id: body.submission_id, receipt_id: body.receipt_id, extraction_status: body.extraction_status };
}

export async function reconcile(baseUrl: string, submissionId: string, transport: typeof fetch = fetch): Promise<{ result: ReconcileResult; latency_ms: number }> {
  const started = process.hrtime.bigint();
  const response = await transport(`${baseUrl}/api/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ submission_ids: [submissionId] }), signal: AbortSignal.timeout(300000) });
  const latency_ms = Number(process.hrtime.bigint() - started) / 1e6;
  const body = await response.json();
  if (!response.ok) throw new Error(`Reconcile of ${submissionId} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  const result: ReconcileResult | undefined = body.results?.[0];
  if (!result) throw new Error(`Reconcile of ${submissionId} returned no result.`);
  return { result, latency_ms };
}

/** Checks are read back from the reviews ledger so the recorded evidence is the server's, not the runner's. */
export async function outcomes(baseUrl: string, uploads: Upload[], timings: Map<string, number>, errors: Map<string, string>, transport: typeof fetch = fetch): Promise<CaseOutcome[]> {
  const response = await transport(`${baseUrl}/api/reviews`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET /api/reviews returned HTTP ${response.status}.`);
  const rows = ((await response.json()) as ReviewsResponse).submissions;
  return uploads.map(u => {
    const row = rows.find(r => r.id === u.submission_id) ?? null;
    const checks: CaseOutcome['checks'] = {};
    for (const d of row?.decisions ?? []) if (d.field_checked !== 'overall_status') checks[d.field_checked] = d.verdict;
    return {
      case_id: u.case_id, submission_id: u.submission_id, run_id: row?.latest_run_id ?? null,
      status: (row?.status as SubmissionStatus | undefined) ?? null, checks,
      needs_investigation: Object.values(checks).includes('unknown'),
      error: errors.get(u.case_id) ?? null, latency_ms: timings.get(u.case_id) ?? null
    };
  });
}

/** One upload and one reconcile per case, serialized, in frozen order. Failures are recorded, never dropped. */
export async function runPhase(baseUrl: string, cases: EvalCase[], phase: 'before' | 'after', existing: Upload[] | null, transport: typeof fetch = fetch): Promise<{ phase: PhaseResult; uploads: Upload[] }> {
  const uploads: Upload[] = existing ? [...existing] : [];
  const timings = new Map<string, number>();
  const errors = new Map<string, string>();
  if (!existing) for (const c of cases) uploads.push(await upload(baseUrl, c, transport));
  for (const u of uploads) {
    try { timings.set(u.case_id, (await reconcile(baseUrl, u.submission_id, transport)).latency_ms); }
    catch (e) { errors.set(u.case_id, e instanceof Error ? e.message : String(e)); }
  }
  return { phase: { phase, outcomes: await outcomes(baseUrl, uploads, timings, errors, transport) }, uploads };
}

/** The scored claims must be exactly the reviewed ones; a seed mismatch invalidates the comparison. */
export async function datasetForReview(dir: string, seed: number) {
  const dataset = generate(seed);
  const inputs = JSON.parse(await readFile(path.join(dir, 'inputs.json'), 'utf8'));
  const onDisk = JSON.stringify(inputs.cases);
  const regenerated = JSON.stringify(dataset.scored.map(c => ({ case_id: c.case_id, ...c.input })));
  if (onDisk !== regenerated) throw new Error(`Seed ${seed} does not reproduce the reviewed dataset in ${dir}.`);
  return dataset;
}

const commit = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

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
    await mkdir(options.out, { recursive: true });
    const uploads: Upload[] = [];
    for (const c of dataset.rehearsal) {
      uploads.push(await upload(options.baseUrl, c, fetch));
      await writeFile(path.join(options.out, 'rehearsal-uploads.json'), JSON.stringify(uploads, null, 2));
    }
    for (const u of uploads) console.log(`${u.case_id} -> submission ${u.submission_id} receipt ${u.receipt_id} extraction ${u.extraction_status} (${options.baseUrl}/api/receipts/${u.receipt_id})`);
    console.log(`Workspace: ${options.baseUrl}/business-demo`);
    return 0;
  }

  if (!options.dataset || !options.review) throw new Error('A live evaluation needs --dataset and --review.');
  const review = await validateReview(options.dataset, options.review);
  const gates = await preflight(options.baseUrl, fetch);
  await mkdir(options.out, { recursive: true });
  const context: RunContext = {
    run_id: path.basename(options.out), source_commit: commit(), started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    dataset_dir: options.dataset, inputs_sha256: review.inputs_sha256, expected_sha256: review.expected_sha256,
    review: { reviewers: review.reviewers, reviewed_at: review.reviewed_at },
    providers: { extraction: String(gates.observed.execution?.decisions ?? 'unknown'), decisions: String(gates.observed.execution?.decisions ?? 'unknown'), retrieval: String(gates.observed.execution?.retrieval ?? 'unknown'), storage: String(gates.observed.execution?.storage ?? 'unknown') },
    rule: options.ruleId ? { id: options.ruleId, version: null, activated: false, gate_report: null } : null,
    isolation: 'not established', limitations: gates.missing
  };
  if (!gates.ok) {
    await writeFile(path.join(options.out, 'preflight.json'), JSON.stringify({ ...gates, context }, null, 2));
    console.error('Preflight failed; no benchmark was run. Missing prerequisites:');
    for (const m of gates.missing) console.error(`- ${m}`);
    return 2;
  }
  const dataset = await datasetForReview(options.dataset, options.seed);
  const before = await runPhase(options.baseUrl, dataset.scored, 'before', null, fetch);
  await writeFile(path.join(options.out, 'before.json'), JSON.stringify(before.phase, null, 2));
  // Activation goes through the reviewed rule API only; this runner never edits storage or learns on its own.
  const report = buildReport(dataset.scored, before.phase, null, { ...context, finished_at: new Date().toISOString(), limitations: [...context.limitations, 'Rule activation and the after phase were not executed by this runner.'] }, []);
  await writeFile(path.join(options.out, 'results.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(options.out, 'cases.csv'), casesCsv(report));
  await writeFile(path.join(options.out, 'report.md'), markdownReport(report));
  console.log(`Baseline complete. Artifacts in ${options.out}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
