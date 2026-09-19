import 'server-only';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CorrectionInput, Decision, ModelCall, Receipt, Submission, SubmissionStatus } from '../contracts';
import { MemoryStore, type Snapshot, type Store } from './store';
import { demoSnapshot } from './fixtures';
import { receiptPdf } from '../demo/samples';
import { CoreError } from './validation';

type Saved = { version: 1; state: Snapshot; calls: ModelCall[] };
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
export function demoDirectory(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.RECONCILIATION_INTAKE_DEMO_DIR || '.intake-demo');
}

/** Local demo only. Atomic snapshots and a cross-process lock share state across Next routes.
 * Live deployments use Supabase. Never put this directory under public/.
 */
export class FileStore implements Store {
  constructor(private dir: string) {}
  private async put(name: string, value: unknown) {
    const temporary = path.join(this.dir, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path.join(this.dir, name));
  }
  private async transaction<T>(operation: (store: MemoryStore) => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true });
    const lock = path.join(this.dir, '.core-lock');
    let acquired = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { await mkdir(lock); acquired = true; await writeFile(path.join(lock, 'owner'), String(process.pid)); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        // Recover a lock left by a process that has exited. Never steal a live lock.
        try { const pid = Number(await readFile(path.join(lock, 'owner'), 'utf8')); if (Number.isInteger(pid) && pid > 0) process.kill(pid, 0); }
        catch (ownerError) { if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH') await rm(lock, { recursive: true, force: true }); }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!acquired) throw new CoreError('DEMO_BUSY', 'Local demo storage is busy. Please retry.', 503);
    try {
      let saved: Saved;
      try { saved = JSON.parse(await readFile(path.join(this.dir, 'core-state.json'), 'utf8')); }
      catch (e) {
        if (!missing(e)) throw e;
        const state = demoSnapshot();
        for (const r of state.receipts) {
          r.file_type = 'application/pdf';
          r.raw_extracted_text = `SYNTHETIC fixture: ${JSON.stringify(r.parsed_fields_json)}`;
          await writeFile(path.join(this.dir, `${r.id}.bin`), receiptPdf(r.parsed_fields_json!), { mode: 0o600 });
          await this.put(`${r.id}.receipt.json`, r);
          await this.put(`${r.submission_id}.submission.json`, state.submissions.find(s => s.id === r.submission_id));
        }
        saved = { version: 1, state, calls: [] };
      }
      if (saved.version !== 1) throw new CoreError('DEMO_VERSION', 'Unsupported local demo data version.', 503);
      const store = new MemoryStore(saved.state); store.calls = saved.calls;
      // A killed process must not strand a submission forever. Five-minute leases match live SQL.
      for (const run of store.state.runs) if (run.status === 'running' && Date.now() - Date.parse(run.started_at) > 300000) await store.fail(run.id, 'Interrupted run expired. Reconcile again.');
      // Intake is the authoritative source of receipt metadata; core owns review outcomes.
      for (const file of await readdir(this.dir)) {
        if (!file.endsWith('.receipt.json')) continue;
        const receipt: Receipt = JSON.parse(await readFile(path.join(this.dir, file), 'utf8'));
        let submission: Submission;
        try { submission = JSON.parse(await readFile(path.join(this.dir, `${receipt.submission_id}.submission.json`), 'utf8')); }
        catch (e) { if (missing(e)) continue; throw e; }
        try { await store.importIntakeRecord(submission, receipt); }
        catch (e) { if (!(e instanceof CoreError) || e.code !== 'RUN_ACTIVE') throw e; }
      }
      const result = await operation(store);
      await this.put('core-state.json', { version: 1, state: store.state, calls: store.calls });
      return result;
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
  snapshot() { return this.transaction(store => store.snapshot()); }
  begin(id: string) { return this.transaction(store => store.begin(id)); }
  finish(id: string, ds: Decision[], status: SubmissionStatus) { return this.transaction(store => store.finish(id, ds, status)); }
  fail(id: string, message: string) { return this.transaction(store => store.fail(id, message)); }
  correct(input: CorrectionInput) { return this.transaction(store => store.correct(input)); }
  usage(call: ModelCall) { return this.transaction(store => store.usage(call)); }
  importIntakeRecord(s: Submission, r: Receipt) { return this.transaction(store => store.importIntakeRecord(s, r)); }
}
