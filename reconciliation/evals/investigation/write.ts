/** Writes the development pack to disk and reads back the human review record.
 *
 * Application-visible inputs and evaluator-only labels are separate files so a runner can
 * build upload requests without ever opening the answers. Nothing here marks the pack as
 * reviewed: `review.json` is written by a human after reading `review.html`.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './documents';
import { buildPack, documentHashes, PACK_VERSION, POLICY_WINDOW, type PackCase } from './pack';

export interface PackManifest {
  pack_version: string; seed: number; generated_by: string;
  case_count: number;
  documents: { case_id: string; file: string; role: string; kind: string; sha256: string }[];
  inputs_sha256: string; labels_sha256: string; policy_sha256: string;
  /** Submission order; a duplicate is meaningless before its original exists. */
  order: string[];
}

/** The policy assumptions the labels were written against, hashed into the manifest. */
export function policyAssumptions() {
  return {
    window: POLICY_WINDOW,
    caps_minor: { flight: 50000, hotel: 25000, train: 20000, bus: 10000, other: 5000 },
    currency: 'USD',
    claimant_identity_evidence: 'receipt_only',
    note: 'Labels assume the seeded policy rows. A live run must re-read actual policy evidence and re-review if it differs.'
  };
}

export function appVisibleInputs(pack: PackCase[]) {
  return {
    pack_version: PACK_VERSION,
    cases: pack.map(c => ({
      case_id: c.case_id, sequence: c.sequence, ...c.input,
      documents: c.documents.map(d => ({ role: d.role, kind: d.kind, file: d.file }))
    }))
  };
}

export function evaluatorLabels(pack: PackCase[], seed: number) {
  return {
    pack_version: PACK_VERSION, seed,
    warning: 'Evaluator-only. Never upload, never include in a model prompt, never expose in app metadata.',
    cases: pack.map(c => ({ case_id: c.case_id, sequence: c.sequence, printed_facts: c.printed, ...c.label }))
  };
}

export async function writePack(dir: string, seed: number): Promise<PackManifest> {
  const pack = buildPack(seed);
  if (await access(path.join(dir, 'manifest.json')).then(() => true, () => false))
    throw new Error(`Refusing to overwrite an existing pack at ${dir}.`);
  await mkdir(path.join(dir, 'documents'), { recursive: true });
  for (const c of pack) for (const d of c.documents) await writeFile(path.join(dir, d.file), d.bytes);

  const inputs = JSON.stringify(appVisibleInputs(pack), null, 2);
  const labels = JSON.stringify(evaluatorLabels(pack, seed), null, 2);
  const policy = JSON.stringify(policyAssumptions(), null, 2);
  await writeFile(path.join(dir, 'inputs.json'), inputs);
  await writeFile(path.join(dir, 'labels.evaluator-only.json'), labels);
  await writeFile(path.join(dir, 'policy.json'), policy);
  await writeFile(path.join(dir, 'review.html'), reviewPacket(pack, seed));
  await writeFile(path.join(dir, 'review.csv'), reviewCsv(pack));

  const manifest: PackManifest = {
    pack_version: PACK_VERSION, seed, generated_by: 'evals/investigation/cli.ts generate',
    case_count: pack.length, documents: documentHashes(pack),
    inputs_sha256: sha256(inputs), labels_sha256: sha256(labels), policy_sha256: sha256(policy),
    order: pack.map(c => c.case_id)
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export interface PackReview {
  pack_version: string;
  reviewers: string[];
  reviewed_at: string;
  minutes_spent: number;
  inputs_sha256: string;
  labels_sha256: string;
  policy_sha256: string;
  /** Labels the reviewer changed; an unresolved disagreement stays open and blocks scoring. */
  corrections: { case_id: string; from: string; to: string; reason: string }[];
  open_disagreements: { case_id: string; question: string }[];
}

/** A scored or demonstrated run may only use a pack whose reviewed hashes still match disk. */
export async function requireReview(dir: string, reviewPath: string): Promise<PackReview> {
  const review: PackReview = JSON.parse(await readFile(reviewPath, 'utf8'));
  const manifest: PackManifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const inputs = sha256(await readFile(path.join(dir, 'inputs.json')));
  const labels = sha256(await readFile(path.join(dir, 'labels.evaluator-only.json')));
  const policy = sha256(await readFile(path.join(dir, 'policy.json')));
  if (!review.reviewers?.length || !review.reviewed_at) throw new Error('review.json names no reviewer; a human gate cannot be inferred.');
  if (review.pack_version !== manifest.pack_version) throw new Error('review.json reviewed a different pack version.');
  if (review.inputs_sha256 !== inputs || review.labels_sha256 !== labels || review.policy_sha256 !== policy)
    throw new Error('Reviewed hashes do not match the pack on disk; evidence or policy changed and re-review is required.');
  if (review.open_disagreements?.length) throw new Error(`${review.open_disagreements.length} label disagreement(s) are still open.`);
  return review;
}

const escape = (v: unknown) => String(v ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
const dollars = (minor: number | null | undefined) => minor === null || minor === undefined ? '' : (minor / 100).toFixed(2);

function reviewCsv(pack: PackCase[]): string {
  const row = (values: (string | number | null)[]) =>
    values.map(v => { const s = v === null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
  const header = ['case_id', 'sequence', 'cohort', 'expected_assessment', 'expected_after_feature', 'duplicate_of', 'depends_on', 'category', 'requested_minor', 'printed_vendor', 'printed_date', 'printed_amount_minor', 'printed_currency', 'printed_names', 'printed_receipt_number', 'booking_reference', 'supporting_documents', 'rationale', 'reviewer', 'agrees_yes_no', 'correction_or_question'];
  return [row(header), ...pack.map(c => row([
    c.case_id, c.sequence, c.label.cohort, c.label.expected_assessment, c.label.expected_after_feature, c.label.duplicate_of,
    c.label.depends_on.join(' '), c.input.category, c.input.amount_requested_minor, c.printed.vendor, c.printed.receipt_date,
    c.printed.amount_minor, c.printed.currency, c.printed.names.join('; '), c.printed.receipt_number,
    c.printed.booking_reference ?? null, c.documents.filter(d => d.role === 'supporting').map(d => d.kind).join(' '),
    c.label.rationale, '', '', ''
  ]))].join('\n') + '\n';
}

/** One readable page: every original, its linked supporting documents, the policy and the expected answer. */
function reviewPacket(pack: PackCase[], seed: number): string {
  const sections = pack.map(c => `<section>
<h2>${escape(c.case_id)} <small>(submission order ${c.sequence})</small></h2>
<p><strong>Claim as submitted:</strong> ${escape(c.input.attendee_name)} &lt;${escape(c.input.email)}&gt;, ${escape(c.input.category)}, requesting USD ${dollars(c.input.amount_requested_minor)}.</p>
<p><strong>Documents:</strong> ${c.documents.map(d => `<a href="${escape(d.file)}">${escape(d.role === 'original_receipt' ? 'original receipt' : d.kind)}</a>`).join(', ')}</p>
<p><strong>Printed on the original:</strong> merchant ${escape(c.printed.vendor)}, date ${escape(c.printed.receipt_date)}, total ${escape(c.printed.currency)} ${dollars(c.printed.amount_minor) || 'not printed'}, traveler ${escape(c.printed.names.join('; ') || 'not printed')}, receipt number ${escape(c.printed.receipt_number)}${c.printed.booking_reference ? `, booking reference ${escape(c.printed.booking_reference)}` : ''}.</p>
<p><strong>Expected assessment today:</strong> ${escape(c.label.expected_assessment)}${c.label.expected_after_feature ? ` &rarr; <strong>${escape(c.label.expected_after_feature)}</strong> once the reviewed investigation/procedure or policy applies` : ''}. ${c.label.duplicate_of ? `Same purchase as ${escape(c.label.duplicate_of)}.` : ''}</p>
<p><strong>Why:</strong> ${escape(c.label.rationale)}</p>
<p><strong>Reviewer:</strong> agree / disagree (record in review.csv, then fill review.json)</p>
</section>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Investigation development pack review (${PACK_VERSION})</title>
<style>body{font:15px/1.5 system-ui;margin:2rem;max-width:60rem}section{border-top:1px solid #ddd;padding:.5rem 0}small{color:#666;font-weight:400}code{background:#f4f4f4;padding:0 .2rem}</style>
<h1>Investigation development pack review — ${PACK_VERSION} (seed ${seed})</h1>
<p>Every merchant, person, reference and total below is synthetic and invalid for payment. This pack is development and demonstration material for the investigation and booking-reference work; it is not independent accuracy evidence.</p>
<p><strong>Policy the labels assume:</strong> USD only, window ${POLICY_WINDOW.start} to ${POLICY_WINDOW.end}, caps flight 500.00, hotel 250.00, train 200.00, bus 100.00, other 50.00, claimant identity from the receipt only unless a specific reviewed policy says otherwise.</p>
<p><strong>What to do:</strong> open each original and its supporting documents, decide the correct answer yourself, then mark agreement in <code>review.csv</code>. When every case is settled, write <code>review.json</code> with your name, the date, minutes spent and the three hashes from <code>manifest.json</code>. Leave any unsettled case in <code>open_disagreements</code>: an open disagreement blocks scoring. Automated agreement is not review.</p>
${sections}`;
}
