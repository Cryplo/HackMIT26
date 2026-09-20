import type {
  DecisionRequest, DecisionResponse, ReconcileRequest, ReconcileResponse,
  ClaimMessage, ReviewRow, ReviewsResponse, RuleProposalRequest, RuleMutationRequest,
  RuleResponse, RulesResponse, RuleTestReport, SearchRequest, SearchResponse, WorkspaceCapabilities, ExportRequest,
} from "../review-contracts";

/** UI-only seam: the API implementation and explicit synthetic preview share it. */
export interface DashboardClient {
  readonly mode: "api" | "preview";
  getReviews(signal?: AbortSignal): Promise<ReviewsResponse>;
  getRules(signal?: AbortSignal): Promise<RulesResponse>;
  reconcile(input: ReconcileRequest): Promise<ReconcileResponse>;
  decide(input: DecisionRequest): Promise<DecisionResponse>;
  proposeRule(input: RuleProposalRequest): Promise<RuleResponse>;
  testRule(id: string, input: RuleMutationRequest): Promise<RuleTestReport>;
  activateRule(id: string, input: RuleMutationRequest): Promise<RuleResponse>;
  disableRule(id: string, input: RuleMutationRequest): Promise<RuleResponse>;
  search(input: SearchRequest): Promise<SearchResponse>;
  retryExtraction(id: string, expectedRevision: number): Promise<{ row: ReviewRow }>;
  exportReviews(input: ExportRequest): Promise<Blob>;
  receiptUrl(row: ReviewRow): string | null;
  getMessages?(id: string, signal?: AbortSignal): Promise<{ messages: ClaimMessage[] }>;
  draftMessage?(id: string, input: DraftMessageInput): Promise<{ message: ClaimMessage; generation_error: string | null }>;
  editMessage?(id: string, input: { expected_draft_revision: number; subject: string; body: string }): Promise<{ message: ClaimMessage }>;
  decisionAndSend?(id: string, input: DecisionAndSendInput): Promise<{ correction_id: string; row?: ReviewRow; message: ClaimMessage; refresh_required?: boolean }>;
  retryMessage?(id: string, input: { expected_message_revision: number }): Promise<{ message: ClaimMessage }>;
}

export interface DraftMessageInput {
  kind: "approval" | "rejection";
  expected_review_revision: number;
  reason_check_ids: string[];
  applicant_reason?: string;
}
export interface DecisionAndSendInput {
  expected_review_revision: number;
  human_verdict: "approved" | "rejected";
  human_note: string;
  message_id: string;
  expected_draft_revision: number;
  request_id: string;
}

export interface ReviewSheetProps {
  row: ReviewRow | null;
  rows: ReviewRow[];
  open: boolean;
  onOpenChange(open: boolean): void;
  client: DashboardClient;
  knowledgeRevision: number;
  capabilities?: WorkspaceCapabilities;
  onOpenClaim(id: string): void;
  onChanged(): Promise<void>;
  onOpenRules(): void;
  backId: string | null;
  onBack(): void;
}

export interface RulesPanelProps {
  simulatedEnvironment: boolean;
  client: DashboardClient;
  rows: ReviewRow[];
  knowledgeRevision: number;
  capabilities?: WorkspaceCapabilities;
  onOpenClaim(id: string): void;
  onChanged(): Promise<void>;
  onRecheck(ids: string[]): Promise<void>;
}
