import type { ReviewRow, ReviewsResponse, Status, Category } from "./types";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function claim(
  n: number,
  name: string,
  amount: number,
  category: Category,
  vendor: string | null,
  status: Status,
  rationale: string,
): ReviewRow {
  const row: ReviewRow = {
    id: uuid(n),
    attendee_name: name,
    email: `attendee${n}@example.test`,
    amount_requested_minor: amount,
    currency: "USD",
    category,
    origin_location: n === 5 ? "Boston, MA" : "New York, NY",
    submitted_at: "2026-09-19T14:00:00Z",
    updated_at: "2026-09-19T14:05:00Z",
    status,
    latest_run_id: status === "pending" ? null : uuid(n + 100),
    receipt: {
      id: uuid(n + 200),
      file_type: "application/pdf",
      extraction_status: "succeeded",
      parsed_fields_json: {
        schema_version: 1,
        vendor,
        receipt_date: "2026-09-18",
        amount_minor: amount,
        currency: "USD",
        names: [name],
        receipt_number: n <= 2 ? "TRAIN-001" : `DEMO-${n}`,
      },
    },
    decisions:
      status === "pending"
        ? []
        : [
            {
              id: uuid(n + 300),
              field_checked:
                n === 2
                  ? "duplicate"
                  : n === 3 || n === 5
                    ? "merchant"
                    : "overall_status",
              check_method: n === 1 ? "deterministic" : "jev",
              verdict:
                status === "approved"
                  ? "pass"
                  : status === "flagged"
                    ? "fail"
                    : "unknown",
              answer_json: {
                value: status === "approved" ? "approved" : "requires_review",
              },
              probability: null,
              confidence_score: null,
              rationale_text: rationale,
              evidence_json: {
                simulated: true,
                scenario: rationale,
                ...(n === 2
                  ? { duplicate_candidate_submission_id: uuid(1) }
                  : {}),
                ...(n === 5
                  ? {
                      proposed_alias_scope: {
                        category: "train",
                        currency: "USD",
                      },
                      actual_category: "hotel",
                      applicable: false,
                    }
                  : {}),
              },
            },
          ],
  };
  if (
    status !== "pending" &&
    !row.decisions.some((item) => item.field_checked === "overall_status")
  ) {
    row.decisions.push({
      id: uuid(n + 400),
      field_checked: "overall_status",
      check_method: "deterministic",
      verdict:
        status === "approved"
          ? "pass"
          : status === "flagged" || status === "rejected"
            ? "fail"
            : "unknown",
      answer_json: { value: status },
      probability: null,
      confidence_score: null,
      rationale_text: `Simulated aggregate result: ${status}.`,
      evidence_json: { simulated: true },
    });
  }
  return row;
}
/** Illustrative contract fixtures, never presented as actual provider output. */
export const fixtureReviews: ReviewsResponse = {
  demo_mode: true,
  submissions: [
    claim(
      1,
      "Alex Morgan",
      8600,
      "train",
      "Northeast Rail",
      "approved",
      "Synthetic clean claim: receipt amount and travel policy checks pass.",
    ),
    claim(
      2,
      "Jordan Lee",
      8600,
      "train",
      "Northeast Rail",
      "flagged",
      "Synthetic duplicate: matching receipt is associated with an earlier submission.",
    ),
    claim(
      3,
      "Sam Rivera",
      12400,
      "train",
      "NE RAIL WEB",
      "needs_review",
      "Synthetic ambiguous merchant: reviewer can teach a scoped vendor alias.",
    ),
    claim(
      4,
      "Taylor Chen",
      11800,
      "train",
      "NE RAIL WEB",
      "pending",
      "New related claim: reconcile after saving the train/USD alias to demonstrate learning.",
    ),
    claim(
      5,
      "Casey Park",
      16500,
      "hotel",
      "NE RAIL WEB",
      "needs_review",
      "Synthetic counterexample: a train/USD alias does not apply to a hotel claim.",
    ),
  ],
  summary: {
    approved_amount_minor: 8600,
    flag_rate: 0.75,
    top_flag_reasons: [
      { reason: "Ambiguous merchant", count: 2 },
      { reason: "Possible duplicate", count: 1 },
    ],
  },
};
