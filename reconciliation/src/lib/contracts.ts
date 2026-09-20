/** Shared wire contracts. Money is integer USD cents; absent extraction values stay null. */
export type Category = 'flight' | 'hotel' | 'train' | 'bus' | 'other';
export type SubmissionStatus = 'pending' | 'approved' | 'flagged' | 'needs_review' | 'rejected';
export type Verdict = 'pass' | 'fail' | 'unknown';
export interface ParsedReceipt { schema_version: 1; vendor: string | null; receipt_date: string | null; amount_minor: number | null; currency: string | null; names: string[]; receipt_number: string | null }
export interface Submission { id: string; attendee_name: string; email: string; amount_requested_minor: number; currency: 'USD'; category: Category; origin_location: string; submitted_at: string; updated_at: string; status: SubmissionStatus; latest_run_id: string | null }
export interface Receipt { id: string; submission_id: string; storage_path: string; file_type: string; raw_extracted_text: string | null; parsed_fields_json: ParsedReceipt | null; extraction_status: 'pending' | 'succeeded' | 'failed'; extraction_error: string | null; extracted_at: string | null }
export interface PolicyRule { id: string; category: Category; region_or_route: string; currency: 'USD'; max_amount_minor: number; date_range_start: string; date_range_end: string; created_at: string }
export interface DecisionSummary { id: string; field_checked: string; check_method: 'deterministic' | 'jev' | 'human'; verdict: Verdict; answer_json: { value: unknown }; probability: number | null; confidence_score: number | null; rationale_text: string; evidence_json: Record<string, unknown> }
export interface Decision extends DecisionSummary { run_id: string; submission_id: string; question_type: 'boolean' | 'choice' | 'score' | 'rule'; state_snapshot_json: Record<string, unknown>; model_used: string | null; created_at: string }
export interface ReconciliationRun { id: string; submission_id: string; status: 'running' | 'completed' | 'failed'; started_at: string; completed_at: string | null; error: string | null }
export interface AliasPayload { observed_vendor: string; canonical_vendor: string; scope: { category: Category; currency: 'USD' } }
export interface CorrectionInput { submission_id: string; decision_id?: string; human_verdict: 'approved' | 'rejected'; human_note: string; correction_type: 'decision_override' | 'vendor_alias'; correction_payload_json: Record<string, unknown> }
export interface Correction extends CorrectionInput { id: string; corrected_at: string }
export interface ModelCall { id: string; run_id: string | null; receipt_id: string | null; provider: string; model: string; input_tokens: number | null; output_tokens: number | null; latency_ms: number; estimated_cost_usd: number | null; created_at: string }
export type ReviewRow = Submission & { receipt: Pick<Receipt, 'id' | 'file_type' | 'extraction_status' | 'parsed_fields_json'> | null; decisions: DecisionSummary[] };
export interface ReviewsResponse { submissions: ReviewRow[]; summary: { approved_amount_minor: number; flag_rate: number; top_flag_reasons: { reason: string; count: number }[] }; demo_mode: boolean; execution?: { decisions: string; retrieval: string; storage: string; justification?: string } }
export interface ReconcileResult { submission_id: string; run_id: string | null; status: SubmissionStatus; error?: string }
export interface ApiError { error: { code: string; message: string } }
