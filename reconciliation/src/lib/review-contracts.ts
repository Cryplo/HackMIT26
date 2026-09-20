/** Frozen v2 seams. Copy unchanged to reconciliation/src/lib/review-contracts.ts.
 * Runtime validation belongs to B. Unknown money stays null; known money is integer cents.
 * These types are independent of the legacy internal contracts so agents can start in parallel.
 */
export type Category = 'flight' | 'hotel' | 'train' | 'bus' | 'other';
export type Assessment = 'matched' | 'flagged' | 'needs_review';
export type HumanDecision = 'pending' | 'approved' | 'rejected';
export type Verdict = 'pass' | 'fail' | 'unknown';
export type ProviderMode = 'live' | 'simulated';
export type LegacyStatus = 'pending' | 'approved' | 'flagged' | 'needs_review' | 'rejected';
export interface ParsedReceipt {
  schema_version: 1; vendor: string | null; receipt_date: string | null;
  amount_minor: number | null; currency: string | null; names: string[];
  receipt_number: string | null;
}
export interface ClaimFacts {
  id: string; attendee_name: string; email: string; amount_requested_minor: number;
  currency: 'USD'; category: Category; origin_location: string; submitted_at: string;
}
export interface ReceiptEvidence {
  id: string; submission_id: string; file_type: string; sha256: string | null;
  extraction_status: 'pending' | 'succeeded' | 'failed'; extraction_error: string | null;
  extraction_provenance?: string | null;
  parsed_fields_json: ParsedReceipt | null; raw_extracted_text: string | null;
}
export interface PolicyRule {
  id: string; category: Category; region_or_route: string; currency: 'USD';
  max_amount_minor: number; date_range_start: string; date_range_end: string; created_at: string;
}
export interface Check {
  id: string; field_checked: string; check_method: 'deterministic' | 'jev' | 'human';
  verdict: Verdict; answer_json: { value: unknown }; probability: number | null;
  confidence_score: number | null; rationale_text: string; evidence_json: Record<string, unknown>;
}
export interface RelatedClaim {
  submission: ClaimFacts; receipt: ReceiptEvidence | null; decision_status: HumanDecision;
}
export interface AliasPayload {
  observed_vendor: string; canonical_vendor: string; scope: { category: Category; currency: 'USD' };
}
export interface ActiveAlias {
  id: string; source_correction_id: string; payload: AliasPayload;
}
export type InvestigationTool = 'read_receipt' | 'read_policy' | 'find_related_claims' | 'read_active_aliases';
export interface InvestigationStep {
  tool: InvestigationTool; evidence_refs: string[]; summary: string;
}
export interface InvestigationResult {
  status: 'completed' | 'unavailable'; mode: ProviderMode; model: string | null;
  summary: string; next_action: 'human_review' | 'request_document' | 'propose_alias';
  evidence_refs: string[]; steps: InvestigationStep[]; error_code: string | null;
}
export interface ReviewRow extends ClaimFacts {
  updated_at: string; latest_run_id: string | null; review_revision: number;
  assessment_status: Assessment | null; decision_status: HumanDecision;
  assessment_knowledge_revision: number | null;
  processing_status: 'idle' | 'running' | 'failed'; processing_error: string | null;
  /** Compatibility projection; v2 UI must use the separate statuses above. */
  status: LegacyStatus;
  receipt: Omit<ReceiptEvidence, 'raw_extracted_text' | 'submission_id'> | null;
  decisions: Check[]; duplicate_submission_ids: string[];
  investigation: InvestigationResult | null;
}
export interface WorkspaceCapabilities {
  rule_learning: boolean; extraction_retry: boolean; export: boolean;
  custom_checks: boolean; duplicate_links: boolean; knowledge_revisions: boolean;
}
export interface RetryExtractionRequest { expected_review_revision: number }
export interface RetryExtractionResponse { row: ReviewRow }
export interface ExportRequest { snapshot_token: string; submission_ids: string[] }
export interface ReviewsResponse {
  capabilities?: WorkspaceCapabilities;
  coverage?: { complete: boolean; returned: number; total: number };
  contract_version: 2; snapshot_token: string; knowledge_revision: number;
  submissions: ReviewRow[];
  summary: {
    approved_amount_minor: number; pending_review_count: number; matched_count: number;
    flagged_count: number; needs_review_count: number;
  };
  demo_mode: boolean;
  execution: { extraction: string; decisions: string; retrieval: string; storage: string; investigation: string };
}
export interface ApiError { error: { code: string; message: string } }
export interface ReconcileRequest { submission_ids: string[] }
export interface ReconcileResult {
  submission_id: string; run_id: string | null; assessment_status: Assessment | null;
  decision_status: HumanDecision; review_revision: number; error?: string;
}
export interface ReconcileResponse { results: ReconcileResult[] }
export interface DecisionRequest {
  submission_id: string; expected_review_revision: number;
  human_verdict: 'approved' | 'rejected'; human_note: string;
  correction_type: 'decision_override'; correction_payload_json: Record<string, never>;
}
export interface DecisionResponse { correction_id: string; row: ReviewRow }
export interface RuleProposalRequest {
  submission_id: string; expected_review_revision: number; canonical_vendor: string;
}
export interface RuleMutationRequest { expected_rule_version: number }
export interface EvaluationMetrics {
  total: number; correct: number; false_matches: number; needs_review: number;
}
export interface RuleTestReport {
  rule_id: string; rule_version: number; knowledge_revision: number; suite_version: 'alias-v1';
  mode: ProviderMode; tested_at: string; passed: boolean; improved_case_ids: string[];
  regressed_case_ids: string[]; reasons: string[];
  before: EvaluationMetrics; after: EvaluationMetrics;
}
export interface MerchantRule {
  id: string; version: number; state: 'draft' | 'active' | 'disabled';
  source_submission_id: string; source_correction_id: string; payload: AliasPayload;
  created_at: string; latest_test: RuleTestReport | null;
  latest_test_error?: string | null;
}
export interface RulesResponse { rules: MerchantRule[]; knowledge_revision: number }
export interface RuleResponse { rule: MerchantRule; knowledge_revision: number }
export interface SearchFilters { assessment_status?: Assessment; decision_status?: HumanDecision; category?: Category }
export interface SearchRequest { query: string; snapshot_token: string; filters: SearchFilters }
export interface SearchRow {
  submission_id: string; attendee_name: string; category: Category;
  amount_requested_minor: number; currency: 'USD';
  vendor: string | null; receipt_amount_minor: number | null; receipt_date: string | null;
  has_receipt: boolean; extraction_status: ReceiptEvidence['extraction_status'] | null;
  assessment_status: Assessment | null; decision_status: HumanDecision;
  failed_checks: string[]; unknown_checks: string[]; duplicate_submission_ids: string[];
}
export interface SearchJudgment {
  submission_id: string; result: 'match' | 'no_match' | 'uncertain'; confidence: number | null;
}
export interface SearchEvaluation {
  judgments: SearchJudgment[]; mode: ProviderMode; model: string | null; latency_ms: number;
}
export interface SearchResponse {
  snapshot_token: string; evaluated_count: number; matches: ReviewRow[]; possible_matches: ReviewRow[];
  mode: ProviderMode; model: string | null; latency_ms: number;
}
export interface InvestigationInput { submission: ClaimFacts; checks: Check[] }
export interface InvestigationTools {
  read_receipt(): Promise<ReceiptEvidence | null>;
  read_policy(): Promise<PolicyRule[]>;
  find_related_claims(): Promise<RelatedClaim[]>;
  read_active_aliases(): Promise<ActiveAlias[]>;
}
export interface UsageRecord {
  provider: string; model: string; input_tokens: number | null; output_tokens: number | null;
  latency_ms: number; estimated_cost_usd: number | null;
}
export interface ProviderOptions {
  mode: ProviderMode; signal: AbortSignal;
  log_usage(record: UsageRecord): Promise<void>;
}
/** Evaluator-only truth must be stripped before calling any model. */
export interface EvaluationCase {
  id: string;
  facts: {
    submission: ClaimFacts; receipt: ReceiptEvidence | null; policies: PolicyRule[];
    related_claims: RelatedClaim[]; exact_duplicate_ids: string[];
  };
  expected_assessment: Assessment;
}
/** B supplies the real financial + Jev assessment path without saving runs or invoking investigation. */
export type AssessExample = (
  facts: EvaluationCase['facts'], aliases: ActiveAlias[], signal: AbortSignal
) => Promise<Assessment>;
export interface RuleEvaluationInput {
  rule: MerchantRule; active_aliases: ActiveAlias[]; knowledge_revision: number;
  examples: EvaluationCase[]; mode: ProviderMode; signal: AbortSignal;
}
export interface IntelligencePort {
  investigate(input: InvestigationInput, tools: InvestigationTools, options: ProviderOptions): Promise<InvestigationResult>;
  search(input: { query: string; rows: SearchRow[] }, options: ProviderOptions): Promise<SearchEvaluation>;
  build_rule_suite(rule: MerchantRule): EvaluationCase[];
  evaluate_rule(input: RuleEvaluationInput, assess: AssessExample): Promise<RuleTestReport>;
}
export type IntelligenceErrorCode = 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'INVALID_PROVIDER_OUTPUT' | 'UNSUPPORTED_QUERY';
/** C exports intelligence: IntelligencePort from src/lib/intelligence/index.ts. */
