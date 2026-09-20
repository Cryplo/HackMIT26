import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { AliasPayload, Category, ParsedReceipt, SubmissionStatus } from '../src/lib/contracts';
import { receiptPdf, sampleReceipts } from '../src/lib/demo/samples';

/** Offline generation of the reviewable hold-out set. Every document is synthetic and invalid for payment.
 * A fixed seed must produce identical inputs, receipt bytes and case IDs: no clock, no random UUIDs, no locale.
 */
export type Cohort = 'valid' | 'unfamiliar' | 'violation' | 'duplicate' | 'incomplete';
export interface ClaimInput { attendee_name: string; email: string; amount_requested_minor: number; currency: 'USD'; category: Category; origin_location: string }
export interface EvalCase {
  case_id: string;
  cohort: Cohort;
  /** Human-reviewed expected assessment, identical before and after learning. Never the baseline prediction. */
  expected: SubmissionStatus;
  note: string;
  duplicate_of: string | null;
  input: ClaimInput;
  fields: ParsedReceipt;
}
export interface Dataset { seed: number; alias: AliasPayload; source: EvalCase; scored: EvalCase[]; rehearsal: EvalCase[]; rehearsal_alias: AliasPayload }

export const COHORT_COUNTS: Record<Cohort, number> = { valid: 20, unfamiliar: 10, violation: 8, duplicate: 6, incomplete: 6 };
/** Mirrors the seeded policy rows; the runner re-reads live policy evidence before any live run. */
export const CAPS: Record<Category, number> = { flight: 50000, hotel: 25000, train: 20000, bus: 10000, other: 5000 };
export const POLICY_WINDOW = { start: '2026-09-01', end: '2026-09-30' };
const KNOWN_VENDOR: Record<Category, string> = { flight: 'Synthetic Sky Airlines', hotel: 'Synthetic Harbor Hotel', train: 'Synthetic Rail', bus: 'Synthetic Coach', other: 'Synthetic Sundries' };
const UNFAMILIAR_VENDOR = 'SYN NRTHWND 77';
const UNFAMILIAR_CATEGORY: Category = 'train';
const ROTATION: Category[] = ['flight', 'hotel', 'train', 'bus'];
const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Ellis', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jules', 'Kerry', 'Lane', 'Marlow', 'Noor', 'Oakley', 'Quinn', 'Reese', 'Sage', 'Tatum', 'Vale'];
const LAST = ['Sample', 'Fixture', 'Placeholder', 'Stand-in'];

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const person = (index: number) => `${FIRST[index % FIRST.length]} ${LAST[Math.floor(index / FIRST.length) % LAST.length]}`;
const email = (name: string, index: number) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${index}@example.invalid`;
const day = (n: number) => `2026-09-${String((n % 29) + 1).padStart(2, '0')}`;
const caseId = (n: number) => `case-${String(n).padStart(2, '0')}`;

function claim(index: number, category: Category, amountRequested: number, fields: ParsedReceipt, cohort: Cohort, expected: SubmissionStatus, note: string, duplicateOf: string | null = null): EvalCase {
  const attendee = person(index);
  return {
    case_id: caseId(index + 1), cohort, expected, note, duplicate_of: duplicateOf,
    input: { attendee_name: attendee, email: email(attendee, index + 1), amount_requested_minor: amountRequested, currency: 'USD', category, origin_location: 'Synthetic City' },
    fields
  };
}
const receiptFields = (vendor: string | null, date: string | null, amount: number | null, currency: string | null, names: string[], number: string | null): ParsedReceipt =>
  ({ schema_version: 1, vendor, receipt_date: date, amount_minor: amount, currency, names, receipt_number: number });

/** The 50 scored claims plus the separate source example and rehearsal pack. Counts are asserted by the harness tests. */
export function generate(seed: number): Dataset {
  const next = random(seed);
  const pick = (max: number) => Math.floor(next() * max);
  const cases: EvalCase[] = [];
  const add = (c: EvalCase) => { cases.push(c); return c; };

  for (let i = 0; i < COHORT_COUNTS.valid; i++) {
    const category = ROTATION[i % ROTATION.length];
    const amount = 2000 + pick(Math.floor(CAPS[category] * 0.6) / 100) * 100;
    const attendee = person(i);
    add(claim(i, category, amount, receiptFields(KNOWN_VENDOR[category], day(i + 1), amount, 'USD', [attendee], `SYN-EV-${caseId(i + 1)}`), 'valid', 'approved', 'Ordinary in-policy purchase from a familiar merchant.'));
  }
  for (let i = 0; i < COHORT_COUNTS.unfamiliar; i++) {
    const index = COHORT_COUNTS.valid + i;
    const amount = 2500 + pick(Math.floor(CAPS[UNFAMILIAR_CATEGORY] * 0.5) / 100) * 100;
    const attendee = person(index);
    add(claim(index, UNFAMILIAR_CATEGORY, amount, receiptFields(UNFAMILIAR_VENDOR, day(index + 1), amount, 'USD', [attendee], `SYN-EV-${caseId(index + 1)}`), 'unfamiliar', 'approved', 'Valid purchase whose merchant descriptor is unfamiliar; the baseline may need investigation.'));
  }
  // Financial counterexamples carry the learned descriptor so an alias really has the opportunity to be unsafe.
  const violations: { category: Category; vendor: string; requested: number; amount: number | null; currency: string; date: string; note: string }[] = [
    { category: UNFAMILIAR_CATEGORY, vendor: UNFAMILIAR_VENDOR, requested: 14500, amount: 11200, currency: 'USD', date: day(3), note: 'Requested amount exceeds the receipt total.' },
    { category: 'hotel', vendor: KNOWN_VENDOR.hotel, requested: 21000, amount: 18000, currency: 'USD', date: day(7), note: 'Requested amount exceeds the receipt total.' },
    { category: UNFAMILIAR_CATEGORY, vendor: UNFAMILIAR_VENDOR, requested: 26500, amount: 26500, currency: 'USD', date: day(11), note: 'Requested amount exceeds the category cap.' },
    { category: 'bus', vendor: KNOWN_VENDOR.bus, requested: 14000, amount: 14000, currency: 'USD', date: day(13), note: 'Requested amount exceeds the category cap.' },
    { category: UNFAMILIAR_CATEGORY, vendor: UNFAMILIAR_VENDOR, requested: 9900, amount: 9900, currency: 'EUR', date: day(17), note: 'Receipt is not denominated in USD.' },
    { category: 'flight', vendor: KNOWN_VENDOR.flight, requested: 32000, amount: 32000, currency: 'GBP', date: day(19), note: 'Receipt is not denominated in USD.' },
    { category: UNFAMILIAR_CATEGORY, vendor: UNFAMILIAR_VENDOR, requested: 8800, amount: 8800, currency: 'USD', date: '2026-08-20', note: 'Receipt date falls before the policy window.' },
    { category: 'hotel', vendor: KNOWN_VENDOR.hotel, requested: 16500, amount: 16500, currency: 'USD', date: '2026-10-05', note: 'Receipt date falls after the policy window.' }
  ];
  violations.forEach((v, i) => {
    const index = COHORT_COUNTS.valid + COHORT_COUNTS.unfamiliar + i;
    add(claim(index, v.category, v.requested, receiptFields(v.vendor, v.date, v.amount, v.currency, [person(index)], `SYN-EV-${caseId(index + 1)}`), 'violation', 'flagged', v.note));
  });
  const incomplete: { fields: (attendee: string, id: string) => ParsedReceipt; note: string }[] = [
    { fields: (a, id) => receiptFields(KNOWN_VENDOR.flight, day(5), null, 'USD', [a], `SYN-EV-${id}`), note: 'Receipt total is missing.' },
    { fields: (a, id) => receiptFields(KNOWN_VENDOR.hotel, day(9), null, 'USD', [a], `SYN-EV-${id}`), note: 'Receipt total is missing.' },
    { fields: (_a, id) => receiptFields(KNOWN_VENDOR.train, day(12), 6400, 'USD', [], `SYN-EV-${id}`), note: 'Receipt prints no traveler name.' },
    { fields: (_a, id) => receiptFields(KNOWN_VENDOR.bus, day(14), 4200, 'USD', [], `SYN-EV-${id}`), note: 'Receipt prints no traveler name.' },
    { fields: a => receiptFields('SYN ??? 00', day(16), 5100, 'USD', [a], null), note: 'Merchant descriptor is unreadable and the receipt number is missing.' },
    { fields: a => receiptFields(null, null, 7300, 'USD', [a], null), note: 'Merchant and date are unreadable.' }
  ];
  incomplete.forEach((spec, i) => {
    const index = COHORT_COUNTS.valid + COHORT_COUNTS.unfamiliar + COHORT_COUNTS.violation + i;
    const attendee = person(index);
    const fields = spec.fields(attendee, caseId(index + 1));
    add(claim(index, ROTATION[i % ROTATION.length], fields.amount_minor ?? 6400, fields, 'incomplete', 'needs_review', spec.note));
  });
  // Later duplicates reuse an earlier original's exact bytes and claimant; two groups use the unfamiliar descriptor.
  const originals = [cases[0], cases[3], cases[6], cases[20], cases[23], cases[26]];
  originals.forEach((original, i) => {
    const index = COHORT_COUNTS.valid + COHORT_COUNTS.unfamiliar + COHORT_COUNTS.violation + COHORT_COUNTS.incomplete + i;
    cases.push({
      case_id: caseId(index + 1), cohort: 'duplicate', expected: 'flagged', note: 'Exact copy of an earlier claimed receipt.', duplicate_of: original.case_id,
      input: { ...original.input }, fields: { ...original.fields, names: [...original.fields.names] }
    });
  });

  const sourceAttendee = 'Rowan Source';
  const source: EvalCase = {
    case_id: 'source-01', cohort: 'unfamiliar', expected: 'approved', note: 'Separate reviewed example a human approves before baseline; never scored.', duplicate_of: null,
    input: { attendee_name: sourceAttendee, email: 'rowan.source@example.invalid', amount_requested_minor: 7700, currency: 'USD', category: UNFAMILIAR_CATEGORY, origin_location: 'Synthetic City' },
    fields: receiptFields(UNFAMILIAR_VENDOR, day(2), 7700, 'USD', [sourceAttendee], 'SYN-EV-source-01')
  };
  const rehearsalVendor = 'SYN STHWND 12';
  const rehearsalSpecs: { cohort: Cohort; expected: SubmissionStatus; category: Category; vendor: string | null; requested: number; amount: number | null; currency: string | null; date: string | null; names: boolean; note: string }[] = [
    { cohort: 'valid', expected: 'approved', category: 'flight', vendor: KNOWN_VENDOR.flight, requested: 18000, amount: 18000, currency: 'USD', date: day(4), names: true, note: 'Clean familiar purchase.' },
    { cohort: 'unfamiliar', expected: 'approved', category: 'bus', vendor: rehearsalVendor, requested: 5600, amount: 5600, currency: 'USD', date: day(6), names: true, note: 'Rehearsal source purchase for the rehearsal alias.' },
    { cohort: 'unfamiliar', expected: 'approved', category: 'bus', vendor: rehearsalVendor, requested: 6100, amount: 6100, currency: 'USD', date: day(8), names: true, note: 'Unseen purchase from the rehearsal descriptor.' },
    { cohort: 'violation', expected: 'flagged', category: 'bus', vendor: rehearsalVendor, requested: 8900, amount: 6500, currency: 'USD', date: day(10), names: true, note: 'Overclaim carrying the rehearsal descriptor.' },
    { cohort: 'violation', expected: 'flagged', category: 'bus', vendor: rehearsalVendor, requested: 12500, amount: 12500, currency: 'USD', date: day(12), names: true, note: 'Over-cap purchase carrying the rehearsal descriptor.' },
    { cohort: 'incomplete', expected: 'needs_review', category: 'hotel', vendor: KNOWN_VENDOR.hotel, requested: 9000, amount: null, currency: 'USD', date: day(15), names: true, note: 'Rehearsal receipt with no total.' },
    { cohort: 'unfamiliar', expected: 'approved', category: 'hotel', vendor: rehearsalVendor, requested: 9400, amount: 9400, currency: 'USD', date: day(18), names: true, note: 'Rehearsal descriptor outside the alias scope category.' },
    { cohort: 'valid', expected: 'approved', category: 'train', vendor: KNOWN_VENDOR.train, requested: 4300, amount: 4300, currency: 'USD', date: day(20), names: true, note: 'Second clean purchase; its copy below must stay blocked.' }
  ];
  const rehearsal: EvalCase[] = rehearsalSpecs.map((spec, i) => {
    const attendee = `${FIRST[i]} Rehearsal`;
    return {
      case_id: `rehearsal-${String(i + 1).padStart(2, '0')}`, cohort: spec.cohort, expected: spec.expected, note: spec.note, duplicate_of: null,
      input: { attendee_name: attendee, email: email(attendee, 900 + i), amount_requested_minor: spec.requested, currency: 'USD', category: spec.category, origin_location: 'Synthetic Town' },
      fields: receiptFields(spec.vendor, spec.date, spec.amount, spec.currency, spec.names ? [attendee] : [], `SYN-RH-${i + 1}`)
    };
  });
  const last = rehearsal[rehearsal.length - 1];
  rehearsal.push({ ...last, case_id: 'rehearsal-09', cohort: 'duplicate', expected: 'flagged', note: 'Later copy of rehearsal-08.', duplicate_of: last.case_id, input: { ...last.input }, fields: { ...last.fields, names: [...last.fields.names] } });

  return {
    seed, source, scored: cases, rehearsal,
    alias: { observed_vendor: UNFAMILIAR_VENDOR, canonical_vendor: 'Synthetic Rail', scope: { category: UNFAMILIAR_CATEGORY, currency: 'USD' } },
    rehearsal_alias: { observed_vendor: rehearsalVendor, canonical_vendor: 'Synthetic Coach', scope: { category: 'bus', currency: 'USD' } }
  };
}

/** A duplicate's bytes are its original's bytes: the duplicate check, not a vendor string, must catch it. */
export function receiptBytes(c: EvalCase): Buffer { return receiptPdf(c.fields); }
export interface Manifest { seed: number; generated_by: string; cases: { case_id: string; file: string; sha256: string }[]; inputs_sha256: string; expected_sha256: string }

/** Only neutral IDs, ordinary claim fields and receipt bytes may reach the application. */
export const uploadFields = (c: Pick<EvalCase, 'input'>) => ({ ...c.input, amount_requested_minor: String(c.input.amount_requested_minor) });

export async function writeDataset(dir: string, dataset: Dataset): Promise<Manifest> {
  const all = [dataset.source, ...dataset.scored];
  const exists = await access(path.join(dir, 'manifest.json')).then(() => true, () => false);
  if (exists) throw new Error(`Refusing to overwrite an existing dataset at ${dir}.`);
  await mkdir(path.join(dir, 'receipts'), { recursive: true });
  await mkdir(path.join(dir, 'rehearsal'), { recursive: true });
  const entries: Manifest['cases'] = [];
  for (const c of all) {
    const file = `receipts/${c.case_id}.pdf`;
    const bytes = receiptBytes(c);
    await writeFile(path.join(dir, file), bytes);
    entries.push({ case_id: c.case_id, file, sha256: sha256(bytes) });
  }
  for (const c of dataset.rehearsal) {
    const file = `rehearsal/${c.case_id}.pdf`;
    const bytes = receiptBytes(c);
    await writeFile(path.join(dir, file), bytes);
    entries.push({ case_id: c.case_id, file, sha256: sha256(bytes) });
  }
  // Inputs and answers are written separately so reviewers, and the runtime request builder, never share a file.
  const inputs = JSON.stringify({ seed: dataset.seed, cases: dataset.scored.map(c => ({ case_id: c.case_id, ...c.input })), source: { case_id: dataset.source.case_id, ...dataset.source.input }, rehearsal: dataset.rehearsal.map(c => ({ case_id: c.case_id, ...c.input })) }, null, 2);
  const expected = JSON.stringify({ seed: dataset.seed, alias: dataset.alias, rehearsal_alias: dataset.rehearsal_alias, cases: dataset.scored.map(c => ({ case_id: c.case_id, cohort: c.cohort, expected: c.expected, note: c.note, duplicate_of: c.duplicate_of, printed_fields: c.fields })), rehearsal: dataset.rehearsal.map(c => ({ case_id: c.case_id, cohort: c.cohort, expected: c.expected, duplicate_of: c.duplicate_of })) }, null, 2);
  await writeFile(path.join(dir, 'inputs.json'), inputs);
  await writeFile(path.join(dir, 'expected.json'), expected);
  await writeFile(path.join(dir, 'review.csv'), reviewCsv(dataset));
  await writeFile(path.join(dir, 'review.html'), reviewHtml(dataset));
  const manifest: Manifest = { seed: dataset.seed, generated_by: 'evals/dataset.ts', cases: entries, inputs_sha256: sha256(inputs), expected_sha256: sha256(expected) };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function csvRow(values: (string | number | null)[]): string {
  return values.map(v => { const s = v === null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
}
function reviewCsv(dataset: Dataset): string {
  const header = ['case_id', 'cohort', 'expected', 'note', 'duplicate_of', 'category', 'requested_minor', 'printed_vendor', 'printed_date', 'printed_amount_minor', 'printed_currency', 'printed_names', 'printed_receipt_number', 'reviewer', 'agrees', 'correction'];
  return [csvRow(header), ...dataset.scored.map(c => csvRow([c.case_id, c.cohort, c.expected, c.note, c.duplicate_of, c.input.category, c.input.amount_requested_minor, c.fields.vendor, c.fields.receipt_date, c.fields.amount_minor, c.fields.currency, c.fields.names.join('; '), c.fields.receipt_number, '', '', '']))].join('\n') + '\n';
}
function reviewHtml(dataset: Dataset): string {
  const escape = (v: unknown) => String(v ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  const rows = dataset.scored.map(c => `<tr><td><a href="receipts/${c.case_id}.pdf">${c.case_id}</a></td><td>${escape(c.cohort)}</td><td>${escape(c.expected)}</td><td>${escape(c.note)}</td><td>${escape(c.duplicate_of)}</td><td>${escape(c.input.category)}</td><td>${(c.input.amount_requested_minor / 100).toFixed(2)}</td><td>${escape(c.fields.vendor)}</td><td>${escape(c.fields.receipt_date)}</td><td>${c.fields.amount_minor === null ? '' : (c.fields.amount_minor / 100).toFixed(2)}</td><td>${escape(c.fields.currency)}</td><td>${escape(c.fields.names.join('; '))}</td><td>${escape(c.fields.receipt_number)}</td></tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Sift hold-out review</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>
<h1>Sift hold-out review (seed ${dataset.seed})</h1>
<p>All claims, merchants and people are synthetic and invalid for payment. Open each receipt and confirm the expected assessment against the policy window ${POLICY_WINDOW.start} to ${POLICY_WINDOW.end} and the seeded caps. Record disagreements in review.csv, then record reviewers and hashes in review.json.</p>
<table><tr><th>case</th><th>cohort</th><th>expected</th><th>why</th><th>copy of</th><th>category</th><th>requested</th><th>vendor</th><th>date</th><th>receipt total</th><th>currency</th><th>names</th><th>receipt #</th></tr>
${rows}</table>`;
}

export interface Review { dataset_dir: string; reviewers: string[]; reviewed_at: string; minutes_spent: number; inputs_sha256: string; expected_sha256: string; corrections: { case_id: string; from: SubmissionStatus; to: SubmissionStatus; reason: string }[] }
/** A live run may only score a dataset whose reviewed hashes still match what is on disk. */
export async function validateReview(dir: string, reviewPath: string): Promise<Review> {
  const review: Review = JSON.parse(await readFile(reviewPath, 'utf8'));
  const inputs = sha256(await readFile(path.join(dir, 'inputs.json')));
  const expected = sha256(await readFile(path.join(dir, 'expected.json')));
  if (!review.reviewers?.length) throw new Error('review.json lists no reviewers; a human gate cannot be inferred.');
  if (review.inputs_sha256 !== inputs || review.expected_sha256 !== expected) throw new Error('Reviewed hashes do not match the dataset on disk; the review is stale.');
  return review;
}

/** No scored receipt may reuse a bundled sample, the source example or a rehearsal document. */
export function bundledSampleHashes(): Set<string> { return new Set(Object.values(sampleReceipts()).map(fields => sha256(receiptPdf(fields)))); }
