import type { SupportingCommand, InvestigationCommand } from './investigation-state';
import type { ProcedureCommand } from './procedure-state';
import 'server-only';
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { CorrectionInput, Decision, ModelCall, Receipt, Submission, SubmissionStatus } from '../contracts';
import { MemoryStore, type Snapshot, type Store } from './store';
import { demoSnapshot } from './fixtures';
import { receiptPdf } from '../demo/samples';
import type { RuleCommand } from './rule-state';
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
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, path.join(this.dir, name));
    } catch (e) { await rm(temporary, { force: true }).catch(() => undefined); throw e; }
  }
  /** Recovery can race: only the holder of this exact token may commit or release. */
  private async ownsLock(lock: string, token: string) {
    return await readFile(path.join(lock, 'owner'), 'utf8').catch(() => '') === token;
  }
  private async recoverLock(lock: string) {
    let owner: string | null = null;
    try { owner = await readFile(path.join(lock, 'owner'), 'utf8'); }
    catch (e) { if (!missing(e) && (e as NodeJS.ErrnoException).code !== 'EISDIR') throw e; }
    const pid = Number(owner?.split(':')[0]);
    if (Number.isInteger(pid) && pid > 0) {
      // A live owner is never disturbed; only a dead PID releases the lock.
      try { process.kill(pid, 0); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return; }
    } else {
      // A crash between mkdir and the owner write leaves no readable owner; expire it by age.
      const age = await stat(lock).then(s => Date.now() - s.mtimeMs, () => 0);
      if (age < 60000) return;
    }
    await rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
  private async transaction<T>(operation: (store: MemoryStore) => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true });
    const lock = path.join(this.dir, '.core-lock');
    const token = `${process.pid}:${randomUUID()}`;
    let acquired = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { await mkdir(lock); acquired = true; await writeFile(path.join(lock, 'owner'), token); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        await this.recoverLock(lock);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!acquired) throw new CoreError('DEMO_BUSY', 'Local demo storage is busy. Please retry.', 503);
    try {
      let saved: Saved;
      try { saved = JSON.parse(await readFile(path.join(this.dir, 'core-state.json'), 'utf8')); }
      catch (e) {
        if (e instanceof SyntaxError) throw new CoreError('DEMO_CORRUPT', 'Local demo state is unreadable. Archive or delete core-state.json and restart.', 503);
        if (!missing(e)) throw e;
        const state = demoSnapshot();
        for (const r of state.receipts) {
          r.file_type = 'application/pdf';
          r.raw_extracted_text = `SYNTHETIC fixture: ${JSON.stringify(r.parsed_fields_json)}`;
          const bytes=receiptPdf(r.parsed_fields_json!);r.sha256=createHash('sha256').update(bytes).digest('hex');r.extraction_provenance='simulated fixture';
          await writeFile(path.join(this.dir, `${r.id}.bin`), bytes, { mode: 0o600 });
          await this.put(`${r.id}.receipt.json`, r);
          await this.put(`${r.submission_id}.submission.json`, state.submissions.find(s => s.id === r.submission_id));
        }
        saved = { version: 1, state, calls: [] };
      }
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new CoreError('DEMO_CORRUPT', 'Local demo state is unreadable. Archive or delete core-state.json and restart.', 503);
      if (saved.version !== 1) throw new CoreError('DEMO_VERSION', 'Unsupported local demo data version.', 503);
      if (!saved.state || !Array.isArray(saved.state.submissions) || !Array.isArray(saved.state.runs) || !Array.isArray(saved.state.decisions) || !Array.isArray(saved.calls)) throw new CoreError('DEMO_CORRUPT', 'Local demo state is incomplete. Archive or delete core-state.json and restart.', 503);
      const store = new MemoryStore(saved.state); store.calls = saved.calls;
      // A killed process must not strand a submission forever. Five-minute leases match live SQL.
      for (const run of store.state.runs) if (run.status === 'running' && Date.now() - Date.parse(run.started_at) > 300000) await store.fail(run.id, 'Interrupted run expired. Reconcile again.');
      // Intake is the authoritative source of receipt metadata; core owns review outcomes.
      // One unreadable or conflicting intake file quarantines that claim, never the whole ledger.
      for (const file of await readdir(this.dir)) {
        if (!file.endsWith('.receipt.json')) continue;
        try {
          const receipt: Receipt = JSON.parse(await readFile(path.join(this.dir, file), 'utf8'));
          let submission: Submission;
          try { submission = JSON.parse(await readFile(path.join(this.dir, `${receipt.submission_id}.submission.json`), 'utf8')); }
          catch (e) { if (missing(e)) continue; throw e; }
          const current=store.state.receipts.find(r=>r.id===receipt.id);
          if(current?.extracted_at && (!receipt.extracted_at||current.extracted_at>receipt.extracted_at))continue;
          receipt.sha256??=current?.sha256;receipt.extraction_provenance??=current?.extraction_provenance;
          await store.importIntakeRecord(submission, receipt);
        } catch (e) {
          if (e instanceof CoreError && e.code === 'RUN_ACTIVE') continue;
          console.warn(`[core] skipping unusable intake record ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const result = await operation(store);
      if (!await this.ownsLock(lock, token)) throw new CoreError('DEMO_BUSY', 'Local demo storage lock was recovered by another process. Please retry.', 503);
      await this.put('core-state.json', { version: 1, state: store.state, calls: store.calls });
      return result;
    } finally { if (await this.ownsLock(lock, token)) await rm(lock, { recursive: true, force: true }); }
  }
  finishInitialExtraction(receipt:Receipt){return this.transaction(async store=>{
    const old=store.state.receipts.find(r=>r.id===receipt.id);
    if(!old||old.extraction_status!=='pending'||store.state.runs.some(r=>r.submission_id===old.submission_id&&r.status==='running'))throw new CoreError('STALE_REVIEW','Initial extraction was superseded; refresh the saved claim.',409);
    if(old.sha256&&old.sha256!==receipt.sha256)throw new CoreError('RECEIPT_CONFLICT','Original receipt hash changed.',409);
    const submission=store.state.submissions.find(s=>s.id===old.submission_id)!;
    await store.importIntakeRecord(submission,receipt);
    await this.put(`${receipt.id}.receipt.json`,receipt);
  });}
  supporting(command:SupportingCommand){return this.transaction(store=>store.supporting(command));}
  investigation(command:InvestigationCommand){return this.transaction(store=>store.investigation(command));}
  procedure(command:ProcedureCommand){return this.transaction(store=>store.procedure(command));}
  snapshot() { return this.transaction(store => store.snapshot()); }
  begin(id: string) { return this.transaction(store => store.begin(id)); }
  finish(id: string, ds: Decision[], status: SubmissionStatus) { return this.transaction(store => store.finish(id, ds, status)); }
  /** A run must never be stranded as `running` because the lock was busy for a moment. */
  async fail(id: string, message: string) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.transaction(store => store.fail(id, message)); }
      catch (e) {
        if (attempt === 3 || !(e instanceof CoreError) || (e.code !== 'DEMO_BUSY' && e.code !== 'DEMO_CORRUPT')) throw e;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  correct(input: CorrectionInput) { return this.transaction(store => store.correct(input)); }
  rule(command:RuleCommand){return this.transaction(store=>store.rule(command));}
  beginExtraction(id:string,revision:number){return this.transaction(store=>store.beginExtraction(id,revision));}
  finishExtraction(lease:string,receipt:Receipt){return this.transaction(store=>store.finishExtraction(lease,receipt));}
  receiptHash(id:string,hash:string){return this.transaction(store=>store.receiptHash(id,hash));}
  usage(call: ModelCall) { return this.transaction(store => store.usage(call)); }
  importIntakeRecord(s: Submission, r: Receipt) { return this.transaction(store => store.importIntakeRecord(s, r)); }
}
