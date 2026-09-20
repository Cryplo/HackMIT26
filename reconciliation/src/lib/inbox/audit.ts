import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IntakeError } from '../intake/schema';
import { inboxSamples } from './samples';
import { confirmImport, inboxDirectory, stageUpload } from './service';
import { suggestLinks } from './matching';
import { caseSummary, defaultDraft, requestCents } from './presentation';
import type { ImportResult, SourceAudit } from './schema';
import { getCore } from '../core/runtime';
import type { CoreService } from '../core/service';

export async function readSourceAudit(dir = inboxDirectory(), core?: CoreService): Promise<SourceAudit> {
  let state: SourceAudit;
  try { state = JSON.parse(await readFile(path.join(dir, 'source-audit.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { enabled: true, phase: 'idle', total: inboxSamples().length, cursor: 0, current: null, documents: [], imports: [], held: [], duplicates: 0, error: '' };
  }
  // Manual resolutions in Data sources also survive reloads of the audit batch.
  const assigned = new Map<string, string>();
  for (const document of state.documents) {
    try {
      const record = JSON.parse(await readFile(path.join(dir, `${document.id}.assigned.json`), 'utf8'));
      assigned.set(document.id, record.submission_id);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const document of state.documents.filter(item => item.evidence?.document_kind === 'receipt')) {
    if (state.imports.some(item => item.document_ids.includes(document.id))) continue;
    try {
      const confirmation: { status: string; result?: ImportResult } = JSON.parse(await readFile(path.join(dir, `${document.id}.confirmation.json`), 'utf8'));
      if (confirmation.status === 'saved' && confirmation.result) state.imports.push({ result: confirmation.result,
        document_ids: [...assigned].filter(([, claimId]) => claimId === confirmation.result!.submission_id).map(([id]) => id) });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const used = new Set(state.imports.flatMap(item => item.document_ids));
  state.held = state.held.filter(item => !used.has(item.document_id));
  if (state.imports.length) {
    const workspace = await (core ?? getCore()).store.snapshot();
    if (state.imports.some(({ result }) => !workspace.submissions.some(claim => claim.id === result.submission_id)
      || !workspace.receipts.some(receipt => receipt.id === result.receipt_id && receipt.submission_id === result.submission_id))) {
      state.phase = 'failed';
      state.current = null;
      state.error = 'Saved source imports are no longer in the workspace, possibly after a reset. Restart the isolated launcher for a fresh source batch; retained originals have not been deleted.';
    }
  }
  return state;
}

// ponytail: one persisted sample batch per isolated demo. Restart the launcher for a new batch;
// use a durable job queue before running ingestion across multiple servers.
export async function advanceSourceAudit(request: Request, mode: 'demo' | 'live', dependencies: Parameters<typeof confirmImport>[1]) {
  const dir = dependencies.dir ?? inboxDirectory(), lock = path.join(dir, 'source-audit.lock');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new IntakeError('source_busy', 'Another audit is reading sources. Wait for it to finish. If its server was interrupted, start a fresh isolated demo.', 409);
    throw error;
  }
  let state: SourceAudit | undefined;
  async function save() {
    const temporary = path.join(dir, `source-audit.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, path.join(dir, 'source-audit.json'));
  }
  try {
    state = await readSourceAudit(dir, dependencies.core);
    if (state.phase === 'ready' || state.phase === 'failed') return state;
    const sample = inboxSamples()[state.cursor];
    if (sample) {
      state.phase = 'reading';
      state.current = { name: sample.name, source: sample.source };
      await save();
      const sha = createHash('sha256').update(sample.bytes).digest('hex');
      if (state.documents.some(document => document.sha256 === sha)) state.duplicates++;
      else {
        const body = new FormData();
        body.set('file', new File([new Uint8Array(sample.bytes)], sample.name, { type: sample.file_type }));
        state.documents.push(await stageUpload(new Request(request.url, {
          method: 'POST', headers: { origin: request.headers.get('origin')! }, body, signal: request.signal,
        }), mode, dir));
      }
      state.cursor++;
      const next = inboxSamples()[state.cursor];
      state.current = next ? { name: next.name, source: next.source } : null;
      if (!next) state.phase = 'linking';
      await save();
      return state;
    }
    state.phase = 'linking';
    await save();
    const suggestions = suggestLinks(state.documents);
    for (const receipt of state.documents.filter(document => document.evidence?.document_kind === 'receipt' && !document.error)) {
      if (state.imports.some(item => item.document_ids.includes(receipt.id))) continue;
      const links = suggestions.filter(item => item.suggested_receipt_id === receipt.id);
      const supporting = state.documents.filter(document => links.some(link => link.document_id === document.id));
      const draft = defaultDraft(receipt, supporting);
      const summary = caseSummary(receipt, supporting, draft, links.flatMap(link => link.candidates.filter(candidate => candidate.receipt_id === receipt.id)));
      const facts = receipt.evidence!.facts;
      // Amount mismatches belong in the audit; uncertain ownership and missing request fields do not.
      if (summary.missing.length || summary.amountConflict || supporting.length > 8
        || summary.warnings.some(warning => warning !== 'Requested amount differs from the receipt total.' && warning !== 'Document totals differ. Keep this discrepancy for review.')
        || !facts.vendor || !facts.purchase_date || facts.amount_minor == null || facts.currency !== 'USD' || !facts.names.length) continue;
      const result = await confirmImport({ receipt_id: receipt.id, supporting_ids: supporting.map(document => document.id), confirmed: true,
        submission: { attendee_name: draft.attendee_name, email: draft.email, amount_requested_minor: String(requestCents(draft.amount)), currency: 'USD', category: draft.category, origin_location: draft.origin_location },
      }, dependencies);
      state.imports.push({ document_ids: [receipt.id, ...supporting.map(document => document.id)], result });
      await save();
    }
    const used = new Set(state.imports.flatMap(item => item.document_ids));
    state.held = state.documents.filter(document => !used.has(document.id)).map(document => {
      const suggestion = suggestions.find(item => item.document_id === document.id);
      return { document_id: document.id, reason: document.error || (suggestion?.candidates.length ? 'More than one possible receipt or an unsafe match. Confirm the connection.'
        : document.evidence?.document_kind === 'receipt' ? 'No complete, unambiguous reimbursement request linked to this receipt.' : 'No supported connection to a claim.') };
    });
    state.phase = 'ready';
    state.current = null;
    await save();
    return state;
  } catch (error) {
    if (state) {
      state.phase = 'failed';
      state.error = error instanceof IntakeError ? error.message : 'Source ingestion stopped. Inspect saved inputs before starting a fresh demo; completed imports are retained.';
      await save();
    }
    throw error;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
