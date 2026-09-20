import type { Category, Check, MerchantRule, ReviewRow, ReviewsResponse } from "./types";

export const fixtureId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-09-19T14:00:00.000Z";
export const normalizeVendor = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export function fixtureCheck(n: number, field: string, verdict: Check["verdict"], rationale: string, value: unknown = verdict): Check {
  return { id: fixtureId(n), field_checked: field, check_method: ["merchant", "name", "duplicate"].includes(field) ? "jev" : "deterministic",
    verdict, answer_json: { value }, probability: null, confidence_score: null,
    rationale_text: rationale, evidence_json: { simulated: true } };
}
function claim(n: number, name: string, amount: number, category: Category, vendor: string): ReviewRow {
  const unknownMerchant = n === 3 || n === 4;
  const receiptAmount = n === 2 ? 10000 : amount;
  const row: ReviewRow = {
    id: fixtureId(n), attendee_name: name, email: `${name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
    amount_requested_minor: amount, currency: "USD", category, origin_location: "New York, NY",
    submitted_at: date, updated_at: date,
    latest_run_id: fixtureId(100 + n), review_revision: 1, assessment_status: n === 2 || n === 5 ? "flagged" : unknownMerchant || n === 6 ? "needs_review" : "matched",
    decision_status: n === 4 ? "approved" : n === 5 ? "rejected" : "pending", assessment_knowledge_revision: 0,
    processing_status: "idle", processing_error: null, status: n === 4 ? "approved" : n === 5 ? "rejected" : n === 2 ? "flagged" : unknownMerchant || n === 6 ? "needs_review" : "pending",
    receipt: { id: fixtureId(200 + n), file_type: "image/svg+xml", sha256: String(n === 5 ? 1 : n).repeat(64),
      extraction_status: n === 6 ? "failed" : "succeeded", extraction_error: n === 6 ? "Synthetic extraction failure: receipt could not be read. Original retained." : null,
      parsed_fields_json: n === 6 ? null : { schema_version: 1, vendor, receipt_date: "2026-09-18", amount_minor: receiptAmount, currency: "USD",
        names: [n === 5 ? "Maya Chen" : name], receipt_number: n === 5 ? "SYN-001" : `SYN-00${n}` } },
    decisions: n === 6 ? [fixtureCheck(600, "extraction", "unknown", "Synthetic extraction failure; the original document is retained.")] : [
      fixtureCheck(n * 1000 + 1, "amount", n === 2 ? "fail" : "pass", n === 2 ? "Claim exceeds receipt by $12.00." : "Requested and receipt totals agree.", receiptAmount === amount),
      fixtureCheck(n * 1000 + 2, "currency", "pass", "Receipt and claim are in USD.", "USD"),
      fixtureCheck(n * 1000 + 3, "receipt_date", "pass", "September 18 is within the event policy dates.", "2026-09-18"),
      fixtureCheck(n * 1000 + 4, "policy", "pass", "One travel policy applies to this receipt.", 1),
      fixtureCheck(n * 1000 + 5, "policy_cap", "pass", `Claim is within the ${category === "hotel" ? "$250" : "$200"} cap.`, true),
      fixtureCheck(n * 1000 + 6, "duplicate", n === 5 ? "fail" : "pass", n === 5 ? "Same receipt appears in Maya Chen’s claim." : "No duplicate purchase in this synthetic example."),
      fixtureCheck(n * 1000 + 7, "merchant", unknownMerchant ? "unknown" : "pass", unknownMerchant ? "SYN HBR042 needs confirmation as a hotel billing descriptor." : "Merchant is consistent with the travel category."),
      fixtureCheck(n * 1000 + 8, "name", n === 5 ? "fail" : "pass", n === 5 ? "The receipt names Maya Chen, not Alex Demo." : "Traveler name matches the claim."),
    ], duplicate_submission_ids: n === 5 ? [fixtureId(1)] : [],
    investigation: unknownMerchant ? { status: "completed", mode: "simulated", model: null,
      summary: "Synthetic investigation: the receipt supports the amount and traveler, but the hotel billing descriptor needs a reviewer’s confirmation.",
      next_action: "human_review", evidence_refs: [`receipt:${fixtureId(200 + n)}`],
      steps: [{ tool: "read_receipt", evidence_refs: [`receipt:${fixtureId(200 + n)}`], summary: "Fixture receipt has a matching total and guest; merchant identity remains unresolved." }], error_code: null } : null,
  };
  if (n === 4 || n === 5) row.decisions.push({ ...fixtureCheck(700 + n, "human_decision", n === 4 ? "pass" : "fail", n === 4 ? "Synthetic reviewer verified Harbor Hotel and approved this claim." : "Synthetic reviewer rejected this duplicate.", row.decision_status), check_method: "human" });
  return row;
}
export function previewResponse(rows: ReviewRow[], knowledgeRevision: number): ReviewsResponse {
  return {
    contract_version: 2, snapshot_token: `preview:${knowledgeRevision}:${rows.map(row => `${row.id}:${row.review_revision}`).sort().join("|")}`,
    knowledge_revision: knowledgeRevision, submissions: rows, demo_mode: true,
    summary: { approved_amount_minor: rows.filter(r => r.decision_status === "approved").reduce((sum, r) => sum + r.amount_requested_minor, 0),
      pending_review_count: rows.filter(r => r.decision_status === "pending").length,
      matched_count: rows.filter(r => r.assessment_status === "matched").length,
      flagged_count: rows.filter(r => r.assessment_status === "flagged").length,
      needs_review_count: rows.filter(r => r.assessment_status === "needs_review").length },
    execution: { extraction: "simulated", decisions: "simulated", investigation: "simulated", retrieval: "simulated", storage: "in-memory preview; resets on reload" },
  };
}
/** Every fixture and receipt is explicitly synthetic; these are not provider results. */
export const fixtureReviews = previewResponse([
  claim(1, "Maya Chen", 8420, "train", "Synthetic Rail"),
  claim(2, "Jordan Lee", 11200, "train", "Synthetic Rail"),
  claim(3, "Sam Example", 16500, "hotel", "SYN HBR042"),
  claim(4, "Taylor Example", 14800, "hotel", "SYN HBR042"),
  claim(5, "Alex Demo", 8420, "train", "Synthetic Rail"),
  claim(6, "Riley Park", 23000, "flight", "Synthetic Air"),
], 0);
export const fixtureRules: MerchantRule[] = [
  { id: fixtureId(801), version: 1, state: "draft", source_submission_id: fixtureId(4), source_correction_id: fixtureId(704),
    payload: { observed_vendor: "SYN HBR042", canonical_vendor: "Harbor Hotel", scope: { category: "hotel", currency: "USD" } }, created_at: date, latest_test: null },
  { id: fixtureId(802), version: 2, state: "disabled", source_submission_id: fixtureId(4), source_correction_id: fixtureId(704),
    payload: { observed_vendor: "SYN HBR042", canonical_vendor: "Synthetic Rail", scope: { category: "hotel", currency: "USD" } }, created_at: date, latest_test: null },
];
export function previewReceiptUrl(row: ReviewRow): string | null {
  if (!row.receipt) return null;
  const n = Number(row.id.slice(-12));
  return n >= 1 && n <= 6 ? `/ui/receipt-${n === 5 ? 1 : n}.svg` : null;
}
