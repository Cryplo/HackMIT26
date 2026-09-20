import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { extractReceipt, type ExtractionResult } from '../intake/extract';
import { boundedMultipart } from '../intake/http';
import { detectType, IntakeError, MAX_FILE_BYTES, type Claim, type Receipt } from '../intake/schema';
import type { IntakeStore } from '../intake/store';
import { uploadSupporting, type SupportingOriginals } from '../intake/supporting-documents';
import type { CoreService } from '../core/service';
import { reviewRevision } from '../core/safety';
import { ConfirmImport, type InboxDocument, type ImportResult } from './schema';

type StoredInbox = InboxDocument & { extraction: ExtractionResult; created_at: string };
type Confirmation = { fingerprint: string; submission_id: string; status: 'saving' | 'saved' | 'failed'; result?: ImportResult };
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export function inboxDirectory() {
  // ponytail: single-server private staging; use shared object storage before deploying across replicas.
  return path.resolve(/* turbopackIgnore: true */ process.env.RECONCILIATION_INBOX_DIR || path.join(tmpdir(), `sift-inbox-${hash(process.cwd() + (process.env.RECONCILIATION_INTAKE_DEMO_DIR ?? '')).slice(0, 16)}`));
}
function filename(dir: string, id: string, extension: string) {
  if (!z.uuid().safeParse(id).success) throw new IntakeError('invalid_id', 'Invalid inbox document ID.');
  return path.join(/* turbopackIgnore: true */ dir, `${id}.${extension}`);
}
async function saveJson(file: string, value: unknown) {
  const staging = `${file}.${randomUUID()}.tmp`;
  await writeFile(staging, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(staging, file);
}
async function optionalJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function readInbox(id: string, dir = inboxDirectory()): Promise<StoredInbox> {
  const document = await optionalJson<StoredInbox>(filename(dir, id, 'json'));
  if (!document) throw new IntakeError('not_found', 'Imported document not found. Upload it again.', 404);
  return document;
}
export function publicInbox({ extraction: _extraction, created_at: _created, ...document }: StoredInbox): InboxDocument { return document; }
export async function inboxOriginal(id: string, dir = inboxDirectory()) {
  const document = await readInbox(id, dir);
  const bytes = await readFile(filename(dir, id, 'bin'));
  if (hash(bytes) !== document.sha256) throw new IntakeError('document_changed', 'Original document no longer matches its saved evidence.', 409);
  return { document, bytes };
}
export async function stageUpload(request: Request, mode: 'demo' | 'live', dir = inboxDirectory(), extract = extractReceipt): Promise<InboxDocument> {
  const form = await boundedMultipart(request);
  if ([...form.keys()].some(k => k !== 'file') || form.getAll('file').length !== 1) throw new IntakeError('invalid_form', 'Upload one document per request.');
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES) throw new IntakeError('invalid_file', 'Choose a nonempty PDF, PNG, or JPG up to 8 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileType = detectType(bytes, file.type), id = randomUUID();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(filename(dir, id, 'bin'), bytes, { mode: 0o600, flag: 'wx' });
  const extraction = await extract(bytes, fileType, id, mode, fetch, { inbox: true, signal: request.signal });
  const document: StoredInbox = {
    id, filename: path.basename(file.name).slice(0, 200), file_type: fileType, sha256: hash(bytes),
    evidence: extraction.inbox ?? null, error: extraction.error ?? (!extraction.inbox ? 'No usable document evidence was extracted.' : null),
    provenance: mode === 'demo' ? 'Simulated · authored sample extraction' : `${extraction.usage?.provider ?? 'live'}:${extraction.usage?.model ?? 'unavailable'}`,
    latency_ms: extraction.usage?.latency_ms ?? null, extraction, created_at: new Date().toISOString(),
  };
  await saveJson(filename(dir, id, 'json'), document);
  return publicInbox(document);
}

export async function confirmImport(body: unknown, dependencies: { core: CoreService; intake: IntakeStore; originals: SupportingOriginals; dir?: string }): Promise<ImportResult> {
  const parsed = ConfirmImport.safeParse(body);
  if (!parsed.success) throw new IntakeError('invalid_import', 'Confirm the documents, name, email, requested USD amount, category, and travel origin.');
  const input = parsed.data, dir = dependencies.dir ?? inboxDirectory();
  const fingerprint = hash(JSON.stringify({ ...input, supporting_ids: [...input.supporting_ids].sort() }));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const confirmationFile = filename(dir, input.receipt_id, 'confirmation.json');
  let confirmation: Confirmation | null = null;
  let reserved = false;
  let pendingReceipt: Receipt | null = null;
  let receiptFinished = false;
  try {
    const prior = await optionalJson<Confirmation>(confirmationFile);
    if (prior) {
      if (prior.status === 'saved' && prior.fingerprint === fingerprint && prior.result) return prior.result;
      throw new IntakeError('already_confirmed', `This import was already attempted. Check claim ${prior.submission_id} in the review workspace before taking further action.`, 409);
    }
    const ids = [input.receipt_id, ...input.supporting_ids];
    const sources = await Promise.all(ids.map(id => inboxOriginal(id, dir)));
    if (sources.some(s => s.document.error || !s.document.evidence)) throw new IntakeError('unreadable_document', 'Remove documents with failed extraction before confirming.');
    if (new Set(sources.map(s => s.document.sha256)).size !== sources.length) throw new IntakeError('duplicate_document', 'The same file was selected more than once. Remove its duplicate.');
    for (const id of ids) {
      if (await optionalJson(filename(dir, id, 'assigned.json'))) throw new IntakeError('document_used', 'A selected document already belongs to another import. Refresh the inbox.', 409);
    }
    const now = new Date().toISOString(), claimId = randomUUID(), receiptId = randomUUID();
    confirmation = { fingerprint, submission_id: claimId, status: 'saving' };
    // Exclusive reservations survive restarts; unrelated documents never wait on a global lock.
    try { await writeFile(confirmationFile, JSON.stringify(confirmation), { mode: 0o600, flag: 'wx' }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new IntakeError('import_busy', 'This receipt is already being confirmed. Wait and check the workspace.', 409);
      throw e;
    }
    reserved = true;
    for (const id of ids) await writeFile(filename(dir, id, 'assigned.json'), JSON.stringify({ submission_id: claimId }), { mode: 0o600, flag: 'wx' });
    const claim: Claim = { ...input.submission, id: claimId, submitted_at: now, updated_at: now, status: 'pending', latest_run_id: null };
    const source = sources[0], evidence = source.document.evidence!;
    const receipt: Receipt = {
      id: receiptId, submission_id: claimId, sha256: source.document.sha256, storage_path: `synthetic/${claimId}/${receiptId}`,
      file_type: source.document.file_type, extraction_status: 'pending', extraction_error: null, extracted_at: null,
      parsed_fields_json: null, raw_extracted_text: null, extraction_provenance: source.document.provenance,
    };
    // Keep the receipt pending until all selected supporting originals are durably attached.
    pendingReceipt = receipt;
    await dependencies.intake.create(claim, receipt, source.bytes);
    for (const support of sources.slice(1)) {
      const document = support.document, facts = document.evidence!.facts;
      const snapshot = await dependencies.core.store.snapshot();
      const kind = document.evidence!.document_kind;
      const attached = await uploadSupporting(dependencies.core, claimId, {
        bytes: support.bytes, fileType: document.file_type,
        kind: kind === 'booking_confirmation' || kind === 'itinerary' ? kind : 'other',
        revision: reviewRevision(snapshot, claimId),
      }, dependencies.originals, async () => ({
        fields: null, raw: (document.provenance.startsWith('Simulated') ? 'SIMULATED authored sample extraction\n' : '') + document.evidence!.raw_extracted_text, supporting_facts: facts, error: null,
        usage: document.extraction.usage,
      }), AbortSignal.timeout(30000));
      if (attached.document.extraction_status !== 'succeeded') throw new IntakeError('supporting_failed', 'A supporting document could not be saved.', 503);
    }
    if (source.document.extraction.usage) await dependencies.intake.usage({ ...source.document.extraction.usage, receipt_id: receiptId });
    const f = evidence.facts;
    Object.assign(receipt, {
      extraction_status: 'succeeded', extracted_at: now, raw_extracted_text: evidence.raw_extracted_text,
      parsed_fields_json: { schema_version: 1, vendor: f.vendor, receipt_date: f.purchase_date, amount_minor: f.amount_minor, currency: f.currency, names: f.names, receipt_number: f.receipt_number },
    });
    await dependencies.intake.finish(receipt);
    receiptFinished = true;
    const result: ImportResult = { submission_id: claimId, receipt_id: receiptId, supporting_count: sources.length - 1 };
    await saveJson(confirmationFile, { ...confirmation, status: 'saved', result });
    return result;
  } catch (error) {
    if (reserved && confirmation) {
      if (!receiptFinished && pendingReceipt) {
        // Storage rejects this if a prior finish committed despite a lost acknowledgement.
        await dependencies.intake.finish({ ...pendingReceipt, extraction_status: 'failed', extraction_error: 'Import interrupted while saving evidence. Inspect supporting documents before retrying extraction.', extracted_at: new Date().toISOString() }).catch(() => {});
      }
      await saveJson(confirmationFile, { ...confirmation, status: 'failed' });
      throw new IntakeError('partial_import', `Import stopped. Originals are retained; claim ${confirmation.submission_id} may be partially saved. Check the review workspace before re-importing.`, 503);
    }
    throw error;
  }
}
