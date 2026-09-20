import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { showcaseFixture } from '../src/lib/demo/showcase';
import { FileStore } from '../src/lib/core/file-store';
import { CoreService } from '../src/lib/core/service';
import { DatabaseRetrieval } from '../src/lib/core/retrieval';
import { SimulatedJev } from '../src/lib/core/jev';
import { workspaceRows } from '../src/lib/core/projection';
import { intelligence } from '../src/lib/intelligence';
import { LocalStore } from '../src/lib/intake/store';
import { LocalSupportingOriginals } from '../src/lib/intake/supporting-originals';

/** Creates only a fresh private directory. No reset, provider calls, or environment-selected store. */
export async function seedShowcase(target: string, auditReady = false) {
  const automationMode = process.env.RECONCILIATION_AUTOMATION_MODE ?? 'policy-caps';
  if (!['policy-caps', 'disabled'].includes(automationMode)) throw new Error('RECONCILIATION_AUTOMATION_MODE must be policy-caps or disabled.');
  const resolved = path.resolve(target);
  const parent = await realpath(path.dirname(resolved));
  const directory = path.join(parent, path.basename(resolved));
  if (directory.split(path.sep).includes('public')) throw new Error('Showcase evidence must stay outside public/.');
  await mkdir(directory, { mode: 0o700 }); // EEXIST intentionally refuses even an empty previous store.
  const fixture = showcaseFixture();
  const originals = new LocalStore(directory), documents = new LocalSupportingOriginals(directory);
  // Install an explicit empty-history snapshot before FileStore can create its legacy five-claim seed.
  await writeFile(path.join(directory, 'core-state.json'), JSON.stringify({ version: 1, state: fixture.state, calls: [] }), { mode: 0o600, flag: 'wx' });
  for (const { receipt, bytes } of fixture.originals) {
    const claim = fixture.state.submissions.find(s => s.id === receipt.submission_id)!;
    await originals.create({ ...claim, status: 'pending', latest_run_id: null }, receipt, bytes);
  }
  for (const { document, bytes } of fixture.supporting) await documents.put(document, bytes);
  const store = new FileStore(directory);
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence, 'simulated', automationMode === 'policy-caps');
  // The fixture already has empty history; audit-ready preserves it without running checks.
  const assessed = auditReady ? { results: [] } : await core.reconcile(fixture.cases.map(c => c.id));
  if (assessed.results.some(r => r.error)) throw new Error('Initial simulation failed; retain this directory for inspection and seed another fresh directory.');
  const state = await store.snapshot(), rows = workspaceRows(state);
  const counts = { approved: rows.filter(r => r.decision_status === 'approved').length, pending: rows.filter(r => r.decision_status === 'pending').length, investigations: state.investigations?.length ?? 0 };
  return { directory, cases: fixture.cases, results: assessed.results, counts };
}

async function main() {
  const auditReady = process.argv.includes('--audit-ready');
  const args = process.argv.slice(2).filter(arg => arg !== '--audit-ready');
  if (args.length > 1 || args.some(arg => arg.startsWith('--'))) throw new Error('Usage: seed-showcase.ts [new-private-directory] [--audit-ready]');
  const result = await seedShowcase(args[0] || path.join(tmpdir(), `sift-showcase-${randomUUID()}`), auditReady);
  console.log(`Showcase ready: 14 claims, ${result.results.length} simulated assessments, ${result.counts.approved} automatic approvals, ${result.counts.pending} pending, ${result.counts.investigations} investigations, no human decisions.\nPrivate store: ${result.directory}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
