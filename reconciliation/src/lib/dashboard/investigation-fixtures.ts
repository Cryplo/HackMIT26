import type { InvestigationAssessment, InvestigationRun, ProcedureCandidate, ReviewRow, SupportingDocument } from "./types";
import { fixtureId } from "./fixtures";

const started = "2026-09-19T14:01:00.000Z";
const finished = "2026-09-19T14:01:02.000Z";

/** These references exist only in the two explicitly synthetic hotel originals. */
export const fixtureBookingReference = (row: ReviewRow) => row.id === fixtureId(3) ? "SYN-BOOK-003" : row.id === fixtureId(4) ? "SYN-BOOK-004" : null;

export function investigationAssessment(row: ReviewRow, evidenceRevision: number, knowledgeRevision: number): InvestigationAssessment {
  return structuredClone({ assessment_status: row.assessment_status, checks: row.decisions.filter(check => check.check_method !== "human"),
    review_revision: row.review_revision, evidence_revision: evidenceRevision, knowledge_revision: knowledgeRevision });
}

export function fixtureSupportingDocuments(rows: ReviewRow[]): SupportingDocument[] {
  return rows.filter(row => fixtureBookingReference(row)).map(row => ({
    id: fixtureId(9000 + Number(row.id.slice(-12))), claim_id: row.id, kind: "booking_confirmation", file_type: "text/plain",
    sha256: String(Number(row.id.slice(-12)) + 6).padStart(64, "0"), created_at: started,
    extraction_status: "succeeded", extraction_error: null, extraction_provenance: "Simulated fixture; no provider extraction",
    extracted_text: `SIMULATED BOOKING CONFIRMATION — NOT VALID FOR REIMBURSEMENT\nHarbor Hotel\nName on receipt: Harbor Reservations\nBooking reference: ${fixtureBookingReference(row)}\nGuest: ${row.attendee_name}\nPurchase: 2026-09-18\nUSD ${(row.amount_requested_minor / 100).toFixed(2)}`,
    facts: { vendor: "Harbor Hotel", booking_reference: fixtureBookingReference(row), receipt_number: null, names: [row.attendee_name],
      purchase_date: "2026-09-18", currency: "USD", amount_minor: row.amount_requested_minor },
  }));
}

export function fixtureProcedureCandidate(row: ReviewRow, document: SupportingDocument): ProcedureCandidate {
  return { kind: "booking_reference_identity", trigger_scope: { category: "hotel", currency: "USD", observed_vendor: "Harbor Reservations", canonical_vendor: "Harbor Hotel" },
    required_evidence: ["receipt", "booking_confirmation"], matching_fields: ["booking_reference"],
    source_evidence_refs: [{ kind: "receipt", id: row.receipt!.id }, { kind: "supporting_document", id: document.id }] };
}

/** Saved snapshots, never timer-driven activity. Explicit actions create separate simulated runs. */
export function fixtureInvestigations(rows: ReviewRow[]): InvestigationRun[] {
  return [1, 2, 3, 4, 6].map(n => {
    const row = rows.find(item => item.id === fixtureId(n))!;
    const status = n === 4 ? "superseded" : n === 6 ? "failed" : "completed";
    const outcome = status !== "completed" ? null : n === 1 ? "resolved" : n === 2 ? "discrepancy_found" : "needs_human";
    const headline = n === 1 ? "Receipt checks complete" : n === 2 ? "Requested amount exceeds the receipt" : n === 3 ? "Hotel identity needs supporting evidence" : n === 4 ? "Evidence changed before publication" : "Receipt could not be read";
    const snapshot = investigationAssessment(row, 0, 0);
    return { run_id: fixtureId(9100 + n), claim_id: row.id, trigger: "manual", status, outcome,
      headline: `Simulated fixture: ${headline}`, summary: `Saved simulated example. ${headline}. No provider calls were made.`,
      unresolved_question: outcome === "needs_human" ? "The receipt says Harbor Reservations. Does the booking confirmation show that Harbor Hotel received the payment? Run the simulated investigation to inspect the available fixture." : null,
      findings: outcome === "resolved" || outcome === "discrepancy_found" ? [{ id: fixtureId(9200 + n), check: "amount", statement: `Simulated fixture: ${n === 2 ? "the claim is $12.00 above the receipt" : "the receipt and claimed total agree"}.`, evidence_refs: [{ kind: "receipt", id: row.receipt!.id }] }] : [],
      before_assessment: snapshot, after_assessment: status === "completed" ? structuredClone(snapshot) : null, proposed_learning: null,
      steps: [{ id: fixtureId(9300 + n), run_id: fixtureId(9100 + n), sequence: 1, tool: "read_receipt", status: n === 6 ? "failed" : "completed",
        started_at: started, completed_at: finished, summary: "Simulated fixture: inspected the saved synthetic receipt.",
        evidence_refs: [{ kind: "receipt", id: row.receipt!.id }], error: n === 6 ? "Simulated extraction failure; original retained." : null }],
      started_at: started, completed_at: finished, mode: "simulated", model: null,
      error: n === 6 ? "Simulated extraction failure; retry extraction before investigating." : n === 4 ? "Simulated stale run: changed evidence prevented publication." : null,
    };
  });
}
