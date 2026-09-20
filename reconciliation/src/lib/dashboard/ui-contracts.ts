import type {
  DecisionRequest, DecisionResponse, ReconcileRequest, ReconcileResponse,
  ReviewRow, ReviewsResponse, RuleProposalRequest, RuleMutationRequest,
  RuleResponse, RulesResponse, SearchRequest, SearchResponse,
} from "../review-contracts";

/** UI-only seam: the API implementation and explicit synthetic preview share it. */
export interface DashboardClient {
  readonly mode: "api" | "preview";
  getReviews(signal?: AbortSignal): Promise<ReviewsResponse>;
  getRules(signal?: AbortSignal): Promise<RulesResponse>;
  reconcile(input: ReconcileRequest): Promise<ReconcileResponse>;
  decide(input: DecisionRequest): Promise<DecisionResponse>;
  proposeRule(input: RuleProposalRequest): Promise<RuleResponse>;
  testRule(id: string, input: RuleMutationRequest): Promise<RuleResponse>;
  activateRule(id: string, input: RuleMutationRequest): Promise<RuleResponse>;
  disableRule(id: string, input: RuleMutationRequest): Promise<RuleResponse>;
  search(input: SearchRequest): Promise<SearchResponse>;
  retryExtraction(id: string, expectedRevision: number): Promise<{ row: ReviewRow }>;
  receiptUrl(row: ReviewRow): string | null;
}

export interface ReviewSheetProps {
  row: ReviewRow | null;
  rows: ReviewRow[];
  open: boolean;
  onOpenChange(open: boolean): void;
  client: DashboardClient;
  knowledgeRevision: number;
  onChanged(): Promise<void>;
  onOpenRules(): void;
}

export interface RulesPanelProps {
  client: DashboardClient;
  rows: ReviewRow[];
  knowledgeRevision: number;
  onChanged(): Promise<void>;
  onRecheck(ids: string[]): Promise<void>;
}
