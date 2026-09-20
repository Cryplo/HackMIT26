/** Offline commands for the investigation development pack. Nothing here calls a provider.
 *
 *   node --conditions=react-server --import tsx evals/investigation/cli.ts generate [--seed N] [--out DIR]
 *   node --conditions=react-server --import tsx evals/investigation/cli.ts budget
 *   node --conditions=react-server --import tsx evals/investigation/cli.ts review-status --dir DIR
 */
import path from 'node:path';
import { PROPOSED_SLICE, PROPOSED_TIME_CAP_MINUTES, PROPOSED_TOTAL } from './budget';
import { requireReview, writePack } from './write';

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
const command = argv[0];

async function main() {
  if (command === 'generate') {
    const seed = Number(flag('seed') ?? 20260927);
    if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer.');
    const dir = path.resolve(flag('out') ?? `evals/results/investigation/demo20-${seed}`);
    const manifest = await writePack(dir, seed);
    console.log(`Wrote ${manifest.case_count} cases and ${manifest.documents.length} documents to ${dir}`);
    console.log(`inputs ${manifest.inputs_sha256.slice(0, 12)}  labels ${manifest.labels_sha256.slice(0, 12)}  policy ${manifest.policy_sha256.slice(0, 12)}`);
    console.log('Unreviewed. Open review.html, record agreement in review.csv, then write review.json.');
    return;
  }
  if (command === 'budget') {
    for (const line of PROPOSED_SLICE) console.log(`${line.kind.padEnd(24)} ${String(line.ceiling).padStart(3)}  ${line.basis}`);
    console.log(`${'TOTAL (proposed)'.padEnd(24)} ${String(PROPOSED_TOTAL).padStart(3)}  plus a ${PROPOSED_TIME_CAP_MINUTES}-minute wall-clock cap. Proposed only: no live call until a human approves it.`);
    return;
  }
  if (command === 'review-status') {
    const dir = path.resolve(flag('dir') ?? '');
    try {
      const review = await requireReview(dir, path.join(dir, 'review.json'));
      console.log(`reviewed by ${review.reviewers.join(', ')} at ${review.reviewed_at}; ${review.corrections.length} label correction(s).`);
    } catch (error) {
      console.log(`not reviewed: ${(error as Error).message}`);
      process.exitCode = 2;
    }
    return;
  }
  console.error('Commands: generate | budget | review-status');
  process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
