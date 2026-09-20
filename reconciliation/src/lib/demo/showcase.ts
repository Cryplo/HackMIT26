import { createHash } from 'node:crypto';
import type { Category, ParsedReceipt, PolicyRule, Receipt, Submission } from '../contracts';
import type { StoredDocument } from '../core/investigation-state';
import type { Snapshot } from '../core/store';
import { showcaseDocument, type ShowcaseDocument } from './showcase-documents';

const id = (kind: number, n: number) => `${kind}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const provenance = 'synthetic showcase: cached transcription of generated original';
const created = '2026-09-20T09:00:00.000Z';
const descriptor = 'Harbor Reservations';
const hotel = 'Harbor Hotel';

type Case = {
  title: string; name: string; category: Category; vendor: string; amount: number;
  number: string; reference?: string; requested?: number; missingName?: boolean;
  booking?: 'matching' | 'conflicting'; itinerary?: boolean; payment?: boolean; unassessed?: boolean;
  date: string; origin: string; destination: string; travelDate: string; departure: string; arrival: string;
  service: string; seat: string; stayEnd?: string; room?: string; submitted: string;
};

const cases: Case[] = [
  { title: 'Ordinary flight', name: 'Avery Rowan', category: 'flight', vendor: 'Northstar Airlines', amount: 24000, number: 'SHOW-FLIGHT-101', date: '2026-09-03', origin: 'New York (JFK)', destination: 'Boston (BOS)', travelDate: '2026-09-17', departure: '08:20 AM', arrival: '09:36 AM', service: 'NS 214', seat: '14A', submitted: '2026-09-18T12:24:00.000Z' },
  { title: 'Ordinary train / lookalike A', name: 'Maya Ellis', category: 'train', vendor: 'Maple Rail', amount: 8900, number: 'SHOW-RAIL-201', date: '2026-09-09', origin: 'New York Penn', destination: 'Boston South', travelDate: '2026-09-17', departure: '07:10 AM', arrival: '11:32 AM', service: 'MR 172', seat: 'Car 3 / 12A', submitted: '2026-09-18T13:05:00.000Z' },
  { title: 'Hotel learning source', name: 'Sam Mercer', category: 'hotel', vendor: descriptor, amount: 18000, number: 'SHOW-HOTEL-301', reference: 'HARBOR-SAM-301', booking: 'matching', date: '2026-09-07', origin: 'Chicago, IL', destination: 'Cambridge, MA', travelDate: '2026-09-17', stayEnd: '2026-09-18', room: '418', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-18T15:42:00.000Z' },
  { title: 'Later hotel / learned procedure', name: 'Taylor Quinn', category: 'hotel', vendor: descriptor, amount: 19500, number: 'SHOW-HOTEL-302', reference: 'HARBOR-TAYLOR-302', booking: 'matching', unassessed: true, date: '2026-09-12', origin: 'Philadelphia, PA', destination: 'Boston, MA', travelDate: '2026-09-18', stayEnd: '2026-09-19', room: '306', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-19T17:16:00.000Z' },
  { title: 'Conflicting hotel confirmations', name: 'Morgan Blake', category: 'hotel', vendor: descriptor, amount: 17200, number: 'SHOW-HOTEL-303', reference: 'HARBOR-MORGAN-303', booking: 'conflicting', date: '2026-09-08', origin: 'Providence, RI', destination: 'Cambridge, MA', travelDate: '2026-09-17', stayEnd: '2026-09-18', room: '512', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-18T16:08:00.000Z' },
  { title: 'Hotel booking missing', name: 'Casey Reed', category: 'hotel', vendor: descriptor, amount: 16800, number: 'SHOW-HOTEL-304', reference: 'HARBOR-CASEY-304', date: '2026-09-14', origin: 'New York, NY', destination: 'Boston, MA', travelDate: '2026-09-18', stayEnd: '2026-09-19', room: '209', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-19T18:37:00.000Z' },
  { title: 'Traveler missing / receipt-only policy', name: 'Riley Chen', category: 'hotel', vendor: descriptor, amount: 16000, number: 'SHOW-HOTEL-305', reference: 'HBR-8F4Q2', booking: 'matching', missingName: true, date: '2026-09-11', origin: 'Seattle, WA', destination: 'Cambridge, MA', travelDate: '2026-09-16', stayEnd: '2026-09-17', room: '324', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-18T17:53:00.000Z' },
  { title: 'Policy-authorized itinerary identity', name: 'Alex Jordan', category: 'flight', vendor: 'Northstar Airlines', amount: 28500, number: 'SHOW-FLIGHT-401', reference: 'NS-7Q2M4A', missingName: true, itinerary: true, date: '2026-09-04', origin: 'Chicago (ORD)', destination: 'Boston (BOS)', travelDate: '2026-09-17', departure: '10:15 AM', arrival: '01:38 PM', service: 'NS 406', seat: '19C', submitted: '2026-09-18T19:11:00.000Z' },
  { title: 'Overclaim / receipt total differs', name: 'Jamie Park', category: 'hotel', vendor: descriptor, amount: 18000, requested: 19000, number: 'SHOW-HOTEL-501', reference: 'HARBOR-JAMIE-501', booking: 'matching', date: '2026-09-13', origin: 'Philadelphia, PA', destination: 'Boston, MA', travelDate: '2026-09-18', stayEnd: '2026-09-19', room: '610', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-19T20:22:00.000Z' },
  { title: 'Hotel policy cap exceeded', name: 'Cameron Lee', category: 'hotel', vendor: descriptor, amount: 27500, number: 'SHOW-HOTEL-502', reference: 'HARBOR-CAMERON-502', booking: 'matching', date: '2026-09-15', origin: 'Washington, DC', destination: 'Cambridge, MA', travelDate: '2026-09-19', stayEnd: '2026-09-20', room: '702', departure: '', arrival: '', service: '', seat: '', submitted: '2026-09-20T08:34:00.000Z' },
  { title: 'First claim for a purchase', name: 'Drew Santos', category: 'flight', vendor: 'Northstar Airlines', amount: 31000, number: 'SHOW-FLIGHT-601', reference: 'SKY-DREW-601', date: '2026-09-06', origin: 'Seattle (SEA)', destination: 'Boston (BOS)', travelDate: '2026-09-17', departure: '07:30 AM', arrival: '03:54 PM', service: 'NS 318', seat: '22F', submitted: '2026-09-18T21:47:00.000Z' },
  { title: 'Same purchase / different document', name: 'Drew Santos', category: 'flight', vendor: 'Northstar Airlines', amount: 31000, number: 'SHOW-FLIGHT-601', reference: 'SKY-DREW-601', payment: true, date: '2026-09-06', origin: 'Seattle (SEA)', destination: 'Boston (BOS)', travelDate: '2026-09-17', departure: '07:30 AM', arrival: '03:54 PM', service: 'NS 318', seat: '22F', submitted: '2026-09-19T13:18:00.000Z' },
  { title: 'Distinct lookalike train B', name: 'Maya Ellis', category: 'train', vendor: 'Maple Rail', amount: 8900, number: 'SHOW-RAIL-202', date: '2026-09-09', origin: 'New York Penn', destination: 'Boston South', travelDate: '2026-09-18', departure: '08:40 AM', arrival: '01:02 PM', service: 'MR 174', seat: 'Car 2 / 8D', submitted: '2026-09-19T14:49:00.000Z' },
  { title: 'Unassessed bus claim', name: 'Jordan Vale', category: 'bus', vendor: 'Cedar Bus', amount: 4200, number: 'SHOW-BUS-701', unassessed: true, date: '2026-09-16', origin: 'Providence, RI', destination: 'Boston South', travelDate: '2026-09-18', departure: '09:10 AM', arrival: '10:25 AM', service: 'CB 108', seat: '16', submitted: '2026-09-19T16:06:00.000Z' },
];

export const LIVE_SHOWCASE_COUNT = 80;

const expandedNames = `Nora Ashford, Leo Bennett, Isla Brooks, Owen Calder, Elena Dalton, Finn Emerson,
Zoe Fairchild, Miles Foster, Clara Grant, Eli Hartwell, Ada Iverson, Noah Jennings,
Lila Kendall, Felix Lawson, Nina Marlow, Theo Nolan, Iris Oakley, Luca Prescott,
Eva Ramsey, Milo Sterling, Leah Thornton, Arlo Underwood, June Voss, Ellis Whitaker,
Sofia Alden, Oscar Bellamy, Cora Camden, Hugo Delaney, Freya Easton, Simon Fletcher,
Vera Grayson, Isaac Hollis, Esme Ingram, Julian Keaton, Willa Langley, Jasper Monroe,
Alice Norwood, Silas Osborne, Maeve Palmer, Emmett Rhodes, Hazel Sullivan, Louis Tate,
Stella Vaughn, Rowan Winslow, Anya Archer, Callum Barrett, Daisy Collins, Tobias Drake,
Mira Everett, Jonah Finch, Phoebe Gardner, Adrian Hayes, Celia Irving, Nolan Kerr,
Tessa Linden, Wesley Marsh, Daphne Nash, Everett Pierce, Gemma Roswell, Bennett Shaw,
Audrey Talbot, Gideon Vale, Amara Westbrook, Ronan York, Sylvia Lindenhurst, Nathan Bramble`
  .split(',').map(name => name.trim());

function expandedCases(): Case[] {
  const categories: Category[] = ['flight', 'flight', 'flight', 'flight', 'train', 'train', 'train', 'bus', 'bus', 'hotel', 'hotel'];
  const origins = {
    flight: ['New York (JFK)', 'Chicago (ORD)', 'Seattle (SEA)', 'Atlanta (ATL)'],
    train: ['New York Penn', 'New Haven Union', 'Providence Station'],
    bus: ['Portland, ME', 'Hartford, CT', 'Providence, RI'],
    hotel: ['Chicago, IL', 'Philadelphia, PA', 'Seattle, WA', 'Portland, ME'],
  };
  const merchants = {
    flight: ['Northstar Airlines', 'Summit Air', 'Juniper Airways'],
    train: ['Maple Rail', 'Birch Rail', 'Coastline Rail'],
    bus: ['Cedar Bus', 'Willow Coach', 'Elm Express'],
    hotel: [descriptor],
  };
  return expandedNames.map((name, i): Case => {
    const group = Math.floor(i / 11), slot = i % 11;
    const category = categories[slot] as keyof typeof origins;
    const travelDay = 16 + group % 4;
    const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
    const mismatch = (slot === 0 && group % 2 === 0) || (slot === 9 && group === 1);
    const capped = i === 15 || i === 29 || i === 53;
    const booking = category !== 'hotel' ? undefined : slot === 10 && (group === 1 || group === 4) ? 'conflicting'
      : slot === 10 && (group === 2 || group === 5) ? undefined : 'matching';
    const amount = capped ? { flight: 54000, train: 22400, bus: 11800, hotel: 28900 }[category]
      : { flight: 18600 + (i * 137) % 21500, train: 5400 + (i * 211) % 8500,
        bus: 2800 + (i * 97) % 3800, hotel: 15200 + (i * 173) % 7400 }[category];
    const origin = origins[category][i % origins[category].length];
    const reference = `SHOW-${category.toUpperCase()}-${801 + i}`;
    return {
      title: mismatch ? 'Receipt total differs' : capped ? 'Policy cap exceeded'
        : booking === 'conflicting' ? 'Conflicting hotel confirmations'
          : category === 'hotel' && !booking ? 'Hotel booking missing'
            : category === 'hotel' ? 'Matching hotel booking' : `Ordinary ${category}`,
      name, category, vendor: merchants[category][group % merchants[category].length], amount,
      requested: mismatch ? amount + 1500 : undefined, number: `${reference}-R`, reference, booking,
      date: day(1 + i % 14), origin, destination: category === 'flight' ? 'Boston (BOS)'
        : category === 'hotel' ? (i % 2 ? 'Cambridge, MA' : 'Boston, MA') : 'Boston South',
      travelDate: day(travelDay), stayEnd: category === 'hotel' ? day(travelDay + 1) : undefined,
      room: category === 'hotel' ? String(210 + i) : undefined,
      departure: category === 'hotel' ? '' : '08:15 AM',
      arrival: category === 'hotel' ? '' : category === 'flight' ? ['09:31 AM', '11:38 AM', '04:39 PM', '10:50 AM'][i % 4]
        : category === 'train' ? ['12:37 PM', '10:42 AM', '09:07 AM'][i % 3]
          : ['10:10 AM', '10:20 AM', '09:30 AM'][i % 3],
      service: category === 'hotel' ? '' : `${{ flight: 'FL', train: 'RL', bus: 'BC' }[category]} ${801 + i}`,
      seat: category === 'hotel' ? '' : category === 'flight' ? `${10 + i % 20}${['A', 'C', 'F'][i % 3]}`
        : category === 'train' ? `Car ${1 + i % 4} / ${2 + i % 18}A` : String(2 + i % 30),
      submitted: `${day(travelDay + 1)}T${String(10 + i % 9).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
    };
  });
}

/** Labels remain outside receipt text and model evidence. Every fact below is printed in its PDF. */
export function showcaseFixture(count: 14 | 80 = 14) {
  const selectedCases = count === LIVE_SHOWCASE_COUNT ? [...cases, ...expandedCases()] : cases;
  const state: Snapshot = { submissions: [], receipts: [], policies: [], supporting_documents: [], decisions: [], corrections: [], runs: [] };
  const originals: { receipt: Receipt; bytes: Buffer }[] = [];
  const supporting: { document: StoredDocument; bytes: Buffer }[] = [];
  const caseMap = selectedCases.map((c, index) => ({ id: id(41, index + 1), title: c.title, assess: !c.unassessed }));
  const categories: Category[] = ['flight', 'hotel', 'train', 'bus', 'other'];
  state.policies = categories.map((category, index): PolicyRule => ({
    id: id(43, index + 1), category, currency: 'USD', region_or_route: '*',
    max_amount_minor: [50000, 25000, 20000, 10000, 5000][index],
    date_range_start: '2026-09-01', date_range_end: '2026-09-30', created_at: created,
    claimant_identity_evidence: category === 'flight' || category === 'train' ? 'receipt_or_linked_itinerary' : 'receipt_only',
  }));
  // New original IDs preserve archived PDFs from the earlier showcase seeds.
  selectedCases.forEach((c, index) => {
    const claimId = caseMap[index].id, receiptId = id(62, index + 1);
    const timestamp = c.submitted;
    const submission: Submission = {
      id: claimId, attendee_name: c.name, email: `${c.name.toLowerCase().replaceAll(' ', '.')}@example.invalid`,
      amount_requested_minor: c.requested ?? c.amount, currency: 'USD', category: c.category,
      origin_location: c.origin, submitted_at: timestamp, updated_at: timestamp,
      status: 'pending', decision_status: 'pending', latest_run_id: null, review_revision: 0, evidence_revision: 0,
    };
    const fields: ParsedReceipt = {
      schema_version: 1, vendor: c.vendor, receipt_date: c.date, amount_minor: c.amount,
      currency: 'USD', names: c.missingName ? [] : [c.name], receipt_number: c.number,
    };
    const printable: ShowcaseDocument = { ...c, name: c.missingName ? undefined : c.name, kind: c.payment ? 'payment' : 'receipt' };
    const rendered = showcaseDocument(printable);
    const { bytes } = rendered;
    const receipt: Receipt = {
      id: receiptId, submission_id: claimId, storage_path: `synthetic/${claimId}/${receiptId}`, file_type: 'application/pdf',
      sha256: hash(bytes), raw_extracted_text: rendered.text, parsed_fields_json: fields,
      extraction_status: 'succeeded', extraction_error: null, extracted_at: timestamp, extraction_provenance: provenance,
    };
    state.submissions.push(submission); state.receipts.push(receipt); originals.push({ receipt, bytes });
    if (!c.booking && !c.itinerary) return;
    for (let copy = 0; copy < (c.booking === 'conflicting' ? 2 : 1); copy++) {
      const documentId = id(64, index * 2 + copy + 1);
      const facts: NonNullable<StoredDocument['facts']> = {
        vendor: c.itinerary ? c.vendor : hotel, booking_reference: `${c.reference}${copy ? '-OTHER' : ''}`,
        receipt_number: c.number, names: [c.name], purchase_date: fields.receipt_date,
        currency: 'USD', amount_minor: c.amount,
      };
      const documentRendered = showcaseDocument({
        ...printable, kind: c.itinerary ? 'itinerary' : 'booking', vendor: facts.vendor!,
        name: c.name, reference: facts.booking_reference!, descriptor: c.itinerary ? undefined : c.vendor,
      });
      const documentBytes = documentRendered.bytes;
      const document: StoredDocument = {
        id: documentId, claim_id: claimId, kind: c.itinerary ? 'itinerary' : 'booking_confirmation',
        storage_path: `synthetic/${claimId}/supporting/${documentId}`, file_type: 'application/pdf',
        sha256: hash(documentBytes), created_at: timestamp, extraction_status: 'succeeded',
        extraction_error: null, extraction_provenance: provenance, extracted_text: documentRendered.text, facts,
      };
      state.supporting_documents!.push(document); supporting.push({ document, bytes: documentBytes });
    }
  });
  return { state, originals, supporting, cases: caseMap };
}

/** Explicit offline reparse recognizes original bytes only, never a claim ID or filename. */
export function recognizedShowcaseReceipt(bytes: Uint8Array): { fields: ParsedReceipt; raw: string } | null {
  const digest = hash(bytes);
  const match = showcaseFixture(LIVE_SHOWCASE_COUNT).originals.find(original => original.receipt.sha256 === digest)?.receipt;
  return match ? { fields: structuredClone(match.parsed_fields_json!), raw: match.raw_extracted_text! } : null;
}
