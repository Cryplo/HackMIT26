import type {
  CheckMutationRequest, CheckResponse, ChecksResponse, CustomCheckUpsert,
  DecisionRequest, DecisionResponse, ReconcileRequest, ReconcileResponse,
  ClaimMessage, ReviewRow, ReviewsResponse, RuleProposalRequest, RuleMutationRequest,
  RuleResponse, RulesResponse, RuleTestReport, SearchRequest, SearchResponse, WorkspaceCapabilities, ExportRequest,
  DocumentKind, SupportingDocument, InvestigationRun, ResolutionProcedure, ProcedureTestReport,
} from "./types";

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
  retryLearning?(id: string, expectedRevision: number): Promise<{ row: ReviewRow }>;
  retryExtraction(id: string, expectedRevision: number): Promise<{ row: ReviewRow }>;
  exportReviews(input: ExportRequest): Promise<Blob>;
  receiptUrl(row: ReviewRow): string | null;
  getSupportingDocuments(claimId: string, signal?: AbortSignal): Promise<{ documents: SupportingDocument[] }>;
  uploadSupportingDocument(claimId: string, file: File, kind: DocumentKind, expectedRevision: number): Promise<{ document: SupportingDocument; row: ReviewRow }>;
  supportingDocumentUrl(claimId: string, documentId: string): string | null;
  getInvestigations(claimId?: string, signal?: AbortSignal): Promise<{ runs: InvestigationRun[]; coverage: { complete: boolean; returned: number; total: number } }>;
  getInvestigation(runId: string, signal?: AbortSignal): Promise<{ run: InvestigationRun }>;
  investigate(claimId: string, expectedRevision: number): Promise<{ run: InvestigationRun; row: ReviewRow }>;
  getProcedures(signal?: AbortSignal): Promise<{ procedures: ResolutionProcedure[]; knowledge_revision: number }>;
  proposeProcedure(runId: string, expectedRevision: number): Promise<{ procedure: ResolutionProcedure; knowledge_revision: number }>;
  testProcedure(id: string, expectedVersion: number): Promise<ProcedureTestReport>;
  activateProcedure(id: string, expectedVersion: number): Promise<{ procedure: ResolutionProcedure; knowledge_revision: number }>;
  disableProcedure(id: string, expectedVersion: number): Promise<{ procedure: ResolutionProcedure; knowledge_revision: number }>;
  getChecks(signal?: AbortSignal): Promise<ChecksResponse>;
  createCheck(input: CustomCheckUpsert): Promise<CheckResponse>;
  updateCheck(id: string, input: CustomCheckUpsert & CheckMutationRequest): Promise<CheckResponse>;
  enableCheck(id: string, input: CheckMutationRequest): Promise<CheckResponse>;
  disableCheck(id: string, input: CheckMutationRequest): Promise<CheckResponse>;
  getNotifications?(signal?: AbortSignal): Promise<{ snapshot_token: string; mode: "preview" | "live" | "disabled"; messages: ClaimMessage[] }>;
  sendNotifications?(input: { snapshot_token: string; message_ids: string[]; confirmed: true }): Promise<{ messages: ClaimMessage[]; processed: number; mode: "preview" | "live"; delivery_error: string | null }>;
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
  simulatedEnvironment: boolean;
  capabilities?: WorkspaceCapabilities;
  onOpenClaim(id: string): void;
  onChanged(): Promise<void>;
  onDecisionSaved?(row: ReviewRow): Promise<void>;
  /** Unresolved claims in the current review scope, including this claim. */
  queueRemaining?: number;
  /** Human decisions completed in the current queue, independent of machine checks. */
  queueProgress?: { completed: number; total: number };
  onOpenRules(): void;
  backId: string | null;
  onBack(): void;
}

export interface ChecksPanelProps {
  simulatedEnvironment: boolean;
  client: DashboardClient;
  knowledgeRevision: number;
  capabilities?: WorkspaceCapabilities;
  onChanged(): Promise<void>;
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
