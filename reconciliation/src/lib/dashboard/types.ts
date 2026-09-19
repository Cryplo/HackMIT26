/** Read-side mirror of RECONCILIATION_CONTRACT.md; no dependency on another module's files. */
export type Status =
  | "pending"
  | "approved"
  | "flagged"
  | "needs_review"
  | "rejected";
export type Category = "flight" | "hotel" | "train" | "bus" | "other";
export interface DecisionSummary {
  id: string;
  field_checked: string;
  check_method: "deterministic" | "jev" | "human";
  verdict: "pass" | "fail" | "unknown";
  answer_json: { value: unknown };
  probability: number | null;
  confidence_score: number | null;
  rationale_text: string;
  evidence_json: unknown;
}
export interface ReviewRow {
  id: string;
  attendee_name: string;
  email: string;
  amount_requested_minor: number;
  currency: "USD";
  category: Category;
  origin_location: string;
  submitted_at: string;
  updated_at: string;
  status: Status;
  latest_run_id: string | null;
  receipt: {
    id: string;
    file_type: string;
    extraction_status: "pending" | "succeeded" | "failed";
    parsed_fields_json: {
      schema_version: 1;
      vendor: string | null;
      receipt_date: string | null;
      amount_minor: number | null;
      currency: string | null;
      names: string[];
      receipt_number: string | null;
    } | null;
  } | null;
  decisions: DecisionSummary[];
}
export interface ReviewsResponse {
  submissions: ReviewRow[];
  summary: {
    approved_amount_minor: number;
    flag_rate: number;
    top_flag_reasons: { reason: string; count: number }[];
  };
  demo_mode: boolean;
}
export interface CorrectionInput {
  submission_id: string;
  decision_id?: string;
  human_verdict: "approved" | "rejected";
  human_note: string;
  correction_type: "decision_override" | "vendor_alias";
  correction_payload_json: Record<string, unknown>;
}
