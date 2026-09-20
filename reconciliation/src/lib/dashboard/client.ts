import type { DashboardClient } from "./ui-contracts";
import type { ReviewsResponse } from "./types";
import { api, validateReviews } from "./helpers";
import { createPreviewClient } from "./preview";

export function createDashboardClient(mode: "api" | "preview"): DashboardClient {
  if (mode === "preview") return createPreviewClient();
  return {
    mode: "api",
    getReviews: async signal => validateReviews(await api<ReviewsResponse>("/api/workspace/reviews", undefined, signal)),
    getRules: signal => api("/api/rules", undefined, signal),
    reconcile: input => api("/api/workspace/reconcile", input),
    decide: input => api("/api/workspace/decisions", input),
    proposeRule: input => api("/api/rules", input),
    testRule: (id, input) => api(`/api/rules/${encodeURIComponent(id)}/test`, input),
    activateRule: (id, input) => api(`/api/rules/${encodeURIComponent(id)}/activate`, input),
    disableRule: (id, input) => api(`/api/rules/${encodeURIComponent(id)}/disable`, input),
    search: input => api("/api/search", input),
    retryExtraction: (id, expectedRevision) => api(`/api/submissions/${encodeURIComponent(id)}/retry-extraction`, { expected_review_revision: expectedRevision }),
    receiptUrl: row => row.receipt ? `/api/receipts/${encodeURIComponent(row.receipt.id)}` : null,
  };
}
