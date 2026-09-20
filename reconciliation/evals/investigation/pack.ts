/** The 20-claim investigation development pack (`demo20`).
 *
 * This is development/demo material used to build and exercise the investigation and
 * booking-reference features. It is NOT independent accuracy evidence and must never be
 * relabelled as a held-out benchmark: any later independent claim needs a fresh reviewed
 * pack untouched by tuning or activation tests.
 *
 * Only `ClaimInput` values and rendered document bytes may reach the application. Cohort
 * names, expected assessments, rationales and dependencies live in the evaluator-only
 * label file, never in filenames, uploads, extraction prompts or app-visible metadata.
 */
import type { Assessment, Category, DocumentKind } from './contract-types';
import {
  bookingConfirmation, itinerary, paymentConfirmation, receiptDocument, sha256,
  type PrintedReceipt
} from './documents';

export const PACK_VERSION = 'demo20-v1';
/** Mirrors the seeded policy rows; a live run re-reads actual policy evidence before scoring. */
export const CAPS: Record<Category, number> = { flight: 50000, hotel: 25000, train: 20000, bus: 10000, other: 5000 };
export const POLICY_WINDOW = { start: '2026-09-01', end: '2026-09-30' };
export const KNOWN_VENDOR: Record<Exclude<Category, 'other'>, string> = {
  flight: 'Synthetic Sky Airlines', hotel: 'Synthetic Harbor Hotel', train: 'Synthetic Rail', bus: 'Synthetic Coach'
};
/** The single procedure candidate's scope: one unfamiliar hotel descriptor in USD. */
export const PROCEDURE_DESCRIPTOR = 'SYN HRBRVW 4471';
export const PROCEDURE_CANONICAL = 'Synthetic Harborview Suites';

export type Cohort =
  | 'straightforward_valid' | 'unfamiliar_linked_booking' | 'similar_distinct'
  | 'duplicate_purchase' | 'itinerary_identity' | 'incomplete' | 'violation';
export type CheckVerdict = 'pass' | 'fail' | 'unknown';

export interface ClaimInput {
  attendee_name: string; email: string; amount_requested_minor: number;
  currency: 'USD'; category: Category; origin_location: string;
}
export interface PackDocument {
  /** `original_receipt` is the one reimbursable document; supporting documents add evidence only. */
  role: 'original_receipt' | 'supporting';
  kind: DocumentKind | 'receipt';
  file: string;
  bytes: Buffer;
}
export interface PackLabel {
  cohort: Cohort;
  /** Expected assessment on current main, with no investigation and no active procedure. */
  expected_assessment: Assessment;
  /** Expected assessment once the proposed reviewed policy or procedure applies, when different. */
  expected_after_feature: Assessment | null;
  /** The reviewed reason the available evidence supports this label. */
  rationale: string;
  expected_checks: Partial<Record<'currency' | 'amount' | 'policy' | 'receipt_date' | 'policy_cap' | 'merchant' | 'name' | 'duplicate', CheckVerdict>>;
  duplicate_of: string | null;
  /** Case IDs that must be submitted before this one for its evidence to exist. */
  depends_on: string[];
}
export interface PackCase {
  case_id: string;
  sequence: number;
  input: ClaimInput;
  printed: PrintedReceipt;
  documents: PackDocument[];
  label: PackLabel;
}

/** Deterministic neutral identifiers: no cohort, verdict or ordering hint is readable. */
function ids(seed: number, count: number): string[] {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const out: string[] = [];
  while (out.length < count) {
    const candidate = `clm-${next().toString(16).padStart(8, '0').slice(0, 6)}`;
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

const email = (name: string, n: number) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${n}@example.invalid`;
const claim = (attendee: string, n: number, category: Category, minor: number): ClaimInput =>
  ({ attendee_name: attendee, email: email(attendee, n), amount_requested_minor: minor, currency: 'USD', category, origin_location: 'Synthetic City' });

interface Spec {
  attendee: string;
  category: Category;
  requested_minor: number;
  printed: PrintedReceipt;
  /** Rendered from the case's own printed facts unless the case supplies its own bytes. */
  original?: (printed: PrintedReceipt) => Buffer;
  supporting?: { kind: DocumentKind; bytes: (printed: PrintedReceipt, attendee: string) => Buffer }[];
  label: Omit<PackLabel, 'duplicate_of' | 'depends_on'> & { duplicate_of_index?: number; depends_on_index?: number[] };
}

const printedReceipt = (over: Partial<PrintedReceipt> & Pick<PrintedReceipt, 'vendor' | 'receipt_date' | 'amount_minor' | 'currency' | 'names' | 'receipt_number'>): PrintedReceipt => ({ ...over });

const VALID_ROTATION: Exclude<Category, 'other'>[] = ['flight', 'hotel', 'train', 'bus'];
const VALID_PEOPLE = ['Avery Sample', 'Blake Fixture', 'Casey Placeholder', 'Devon Stand-in', 'Ellis Sample', 'Finley Fixture', 'Gray Placeholder', 'Harper Stand-in', 'Indigo Sample', 'Jules Fixture'];

function specs(): Spec[] {
  const out: Spec[] = [];
  // 1-10: straightforward valid purchases from familiar merchants, distinct in every case.
  VALID_PEOPLE.forEach((attendee, i) => {
    const category = VALID_ROTATION[i % VALID_ROTATION.length];
    const amount = 3100 + i * 700;
    const date = `2026-09-${String(2 + i).padStart(2, '0')}`;
    out.push({
      attendee, category, requested_minor: amount,
      printed: printedReceipt({
        vendor: KNOWN_VENDOR[category], receipt_date: date, amount_minor: amount, currency: 'USD',
        names: [attendee], receipt_number: `SYN-D20-${String(i + 1).padStart(3, '0')}`,
        purchase_detail: `${category} purchase for one traveler`
      }),
      label: {
        cohort: 'straightforward_valid', expected_assessment: 'matched', expected_after_feature: null,
        rationale: 'Familiar merchant for the claimed category, printed traveler matches the claimant, exact USD total inside the cap and policy window, and no earlier claim shares this purchase.',
        expected_checks: { currency: 'pass', amount: 'pass', policy: 'pass', receipt_date: 'pass', policy_cap: 'pass', merchant: 'pass', name: 'pass', duplicate: 'pass' }
      }
    });
  });

  // 11-12: unfamiliar hotel descriptor with a booking confirmation carrying the same reference.
  const bookingPair: { attendee: string; amount: number; date: string; reference: string; stay: string }[] = [
    { attendee: 'Kerry Sample', amount: 14200, date: '2026-09-12', reference: 'HRV-4471-88213', stay: '2026-09-11 to 2026-09-12, one room, one night' },
    { attendee: 'Lane Fixture', amount: 16800, date: '2026-09-21', reference: 'HRV-4471-90557', stay: '2026-09-20 to 2026-09-21, one room, one night' }
  ];
  bookingPair.forEach((b, i) => {
    out.push({
      attendee: b.attendee, category: 'hotel', requested_minor: b.amount,
      printed: printedReceipt({
        vendor: PROCEDURE_DESCRIPTOR, legal_name: null, receipt_date: b.date, amount_minor: b.amount, currency: 'USD',
        names: [b.attendee], receipt_number: `SYN-D20-${String(11 + i).padStart(3, '0')}`,
        booking_reference: b.reference, purchase_detail: 'Room charge, one night'
      }),
      supporting: [{
        kind: 'booking_confirmation',
        bytes: (printed, attendee) => bookingConfirmation({
          vendor: PROCEDURE_DESCRIPTOR, legal_name: PROCEDURE_CANONICAL, booking_reference: printed.booking_reference!,
          guest: attendee, stay_dates: b.stay, amount_minor: printed.amount_minor!, currency: 'USD',
          detail: 'One room, one night, breakfast not included'
        })
      }],
      label: {
        cohort: 'unfamiliar_linked_booking',
        expected_assessment: 'needs_review', expected_after_feature: 'matched',
        rationale: 'The billing descriptor alone does not establish merchant identity, so the merchant check is unresolved today. The booking confirmation carries the same booking reference, guest and total, which is the evidence an investigation or the activated booking-reference procedure uses to resolve identity; every financial and duplicate check must still pass on its own.',
        expected_checks: { currency: 'pass', amount: 'pass', policy: 'pass', receipt_date: 'pass', policy_cap: 'pass', merchant: 'unknown', name: 'pass', duplicate: 'pass' },
        depends_on_index: i === 1 ? [10] : undefined
      }
    });
  });

  // 13-14: similar merchant, date and amount, but two genuinely different purchases.
  ['Marlow Sample', 'Noor Fixture'].forEach((attendee, i) => {
    const amount = 9300;
    out.push({
      attendee, category: 'train', requested_minor: amount,
      printed: printedReceipt({
        vendor: KNOWN_VENDOR.train, receipt_date: '2026-09-15', amount_minor: amount, currency: 'USD',
        names: [attendee], receipt_number: `SYN-D20-${String(13 + i).padStart(3, '0')}`,
        purchase_detail: i === 0 ? 'Seat 14A, 08:05 departure, ticket SYN-T-5501' : 'Seat 22C, 17:40 departure, ticket SYN-T-6720'
      }),
      label: {
        cohort: 'similar_distinct', expected_assessment: 'matched', expected_after_feature: null,
        rationale: 'Shared merchant, date and total describe two separate tickets with different receipt numbers, travelers and departures. Surface similarity alone must not make either claim a duplicate.',
        expected_checks: { currency: 'pass', amount: 'pass', policy: 'pass', receipt_date: 'pass', policy_cap: 'pass', merchant: 'pass', name: 'pass', duplicate: 'pass' }
      }
    });
  });

  // 15-16: later claims for purchases already represented by cases 2 and 6.
  [1, 5].forEach((originalIndex, i) => {
    const original = out[originalIndex];
    out.push({
      attendee: original.attendee, category: original.category, requested_minor: original.requested_minor,
      printed: { ...original.printed, purchase_detail: 'Reprinted confirmation of an earlier charge' },
      original: printed => paymentConfirmation(printed),
      label: {
        cohort: 'duplicate_purchase', expected_assessment: 'flagged', expected_after_feature: null,
        rationale: 'A different document for a purchase already claimed earlier: the merchant, receipt number, total and date match the earlier claim, so this is the same purchase presented again rather than a second eligible expense.',
        expected_checks: { currency: 'pass', amount: 'pass', policy: 'pass', receipt_date: 'pass', policy_cap: 'pass', merchant: 'pass', name: 'pass', duplicate: 'fail' },
        duplicate_of_index: originalIndex, depends_on_index: [originalIndex]
      }
    });
    void i;
  });

  // 17-18: receipt prints no traveler; an itinerary carries the explicit name and reference link.
  [{ attendee: 'Oakley Sample', amount: 20500, date: '2026-09-09', trip: 'SKY-TRP-33415' },
   { attendee: 'Quinn Fixture', amount: 17400, date: '2026-09-23', trip: 'SKY-TRP-51908' }].forEach((t, i) => {
    out.push({
      attendee: t.attendee, category: 'flight', requested_minor: t.amount,
      printed: printedReceipt({
        vendor: KNOWN_VENDOR.flight, receipt_date: t.date, amount_minor: t.amount, currency: 'USD',
        names: [], receipt_number: `SYN-D20-${String(17 + i).padStart(3, '0')}`,
        booking_reference: t.trip, purchase_detail: 'Single itinerary, economy fare, no traveler name printed'
      }),
      supporting: [{
        kind: 'itinerary',
        bytes: (printed, attendee) => itinerary({
          carrier: KNOWN_VENDOR.flight, trip_reference: printed.booking_reference!, traveler: attendee,
          segments: ['Synthetic City to Fixture Harbor, 09:15', 'Fixture Harbor to Synthetic City, 19:40'],
          purchase_date: printed.receipt_date!, receipt_number: printed.receipt_number!
        })
      }],
      label: {
        cohort: 'itinerary_identity', expected_assessment: 'needs_review', expected_after_feature: 'matched',
        rationale: 'The receipt prints no traveler, so claimant identity is unresolved under the default receipt-only policy. The itinerary names the claimant and repeats the trip reference and receipt number, which resolves identity only if the applicable policy is explicitly reviewed to accept a linked itinerary.',
        expected_checks: { currency: 'pass', amount: 'pass', policy: 'pass', receipt_date: 'pass', policy_cap: 'pass', merchant: 'pass', name: 'unknown', duplicate: 'pass' }
      }
    });
  });

  // 19: genuinely incomplete; no hidden answer is seeded anywhere in the evidence.
  out.push({
    attendee: 'Reese Sample', category: 'hotel', requested_minor: 11900,
    printed: printedReceipt({
      vendor: 'SYN ????? 00', receipt_date: null, amount_minor: null, currency: 'USD',
      names: ['Reese Sample'], receipt_number: null, purchase_detail: 'Thermal print faded; totals unreadable'
    }),
    label: {
      cohort: 'incomplete', expected_assessment: 'needs_review', expected_after_feature: null,
      rationale: 'The essential evidence is genuinely absent: no readable total, date or merchant. No supporting document exists, so investigation can only return a specific question for the reviewer.',
      expected_checks: { amount: 'unknown', receipt_date: 'unknown', merchant: 'unknown' }
    }
  });

  // 20: unambiguous cap violation that stays blocked after investigation and learning.
  out.push({
    attendee: 'Sage Fixture', category: 'bus', requested_minor: 14800,
    printed: printedReceipt({
      vendor: KNOWN_VENDOR.bus, receipt_date: '2026-09-26', amount_minor: 14800, currency: 'USD',
      names: ['Sage Fixture'], receipt_number: 'SYN-D20-020', purchase_detail: 'Long-distance coach fare'
    }),
    label: {
      cohort: 'violation', expected_assessment: 'flagged', expected_after_feature: null,
      rationale: `The requested total exceeds the bus cap of ${(CAPS.bus / 100).toFixed(2)} USD. A cap violation is a mandatory failure, so no investigation, alias or procedure may clear it.`,
      expected_checks: { currency: 'pass', amount: 'pass', policy: 'pass', receipt_date: 'pass', policy_cap: 'fail', merchant: 'pass', name: 'pass', duplicate: 'pass' }
    }
  });

  return out;
}

export function buildPack(seed: number): PackCase[] {
  const raw = specs();
  const caseIds = ids(seed, raw.length);
  return raw.map((spec, index) => {
    const case_id = caseIds[index];
    const printed = spec.printed;
    const documents: PackDocument[] = [
      { role: 'original_receipt', kind: 'receipt', file: `documents/${case_id}-original.pdf`, bytes: (spec.original ?? receiptDocument)(printed) },
      ...(spec.supporting ?? []).map((s, n) => ({
        role: 'supporting' as const, kind: s.kind,
        file: `documents/${case_id}-support-${n + 1}.pdf`, bytes: s.bytes(printed, spec.attendee)
      }))
    ];
    const { duplicate_of_index, depends_on_index, ...label } = spec.label;
    return {
      case_id, sequence: index + 1,
      input: claim(spec.attendee, index + 1, spec.category, spec.requested_minor),
      printed, documents,
      label: {
        ...label,
        duplicate_of: duplicate_of_index === undefined ? null : caseIds[duplicate_of_index],
        depends_on: (depends_on_index ?? []).map(i => caseIds[i])
      }
    };
  });
}

export const COHORT_COUNTS: Record<Cohort, number> = {
  straightforward_valid: 10, unfamiliar_linked_booking: 2, similar_distinct: 2,
  duplicate_purchase: 2, itinerary_identity: 2, incomplete: 1, violation: 1
};

/** Only these fields may be submitted to the application. */
export const uploadFields = (c: PackCase) => ({ ...c.input, amount_requested_minor: String(c.input.amount_requested_minor) });

/** Terms that would leak evaluator intent if they appeared in app-visible material. */
export const LABEL_TERMS = ['cohort', 'expected', 'duplicate_of', 'straightforward', 'violation', 'incomplete', 'needs_review', 'matched', 'flagged', 'approve this'];

export function documentHashes(pack: PackCase[]) {
  return pack.flatMap(c => c.documents.map(d => ({ case_id: c.case_id, file: d.file, role: d.role, kind: d.kind, sha256: sha256(d.bytes) })));
}
