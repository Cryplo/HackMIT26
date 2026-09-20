import type { DashboardClient } from "./ui-contracts";
import type { ClaimMessage, ReviewsResponse } from "./types";
import { api, DashboardError, validateReviews } from "./helpers";
import { createPreviewClient } from "./preview";

export function createDashboardClient(mode: "api" | "preview"): DashboardClient {
  if (mode === "preview") return createPreviewClient();
  return {
    mode: "api",
    getReviews: async signal => validateReviews(await api<ReviewsResponse>("/api/workspace/reviews", undefined, signal)),
    getMessages: (id, signal) => api(`/api/submissions/${encodeURIComponent(id)}/messages`, undefined, signal),
    draftMessage: (id, input) => api(`/api/submissions/${encodeURIComponent(id)}/messages/draft`, input),
    async editMessage(id, input) {
      const response = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new DashboardError(data?.error?.code || "MESSAGE_SAVE_FAILED", data?.error?.message || `Draft could not be saved (${response.status}).`, response.status);
      if (!data?.message) throw new DashboardError("INVALID_RESPONSE", "The server did not return a saved draft.");
      return data as { message: ClaimMessage };
    },
    decisionAndSend: (id, input) => api(`/api/submissions/${encodeURIComponent(id)}/decision-and-send`, input),
    retryMessage: (id, input) => api(`/api/messages/${encodeURIComponent(id)}/retry`, input),
    getRules: signal => api("/api/rules", undefined, signal),
    reconcile: input => api("/api/workspace/reconcile", input),
    decide: input => api("/api/workspace/decisions", input),
    proposeRule: input => api("/api/rules", input),
    testRule: (id, input) => api(`/api/rules/${encodeURIComponent(id)}/test`, input),
    activateRule: (id, input) => api(`/api/rules/${encodeURIComponent(id)}/activate`, input),
    disableRule: (id, input) => api(`/api/rules/${encodeURIComponent(id)}/disable`, input),
    search: input => api("/api/search", input),
    retryExtraction: (id, expectedRevision) => api(`/api/submissions/${encodeURIComponent(id)}/retry-extraction`, { expected_review_revision: expectedRevision }),
    async exportReviews(input) {
      const response = await fetch("/api/workspace/export", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new DashboardError(data?.error?.code || "EXPORT_FAILED", data?.error?.message || `Export failed (${response.status}).`, response.status);
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/csv")) throw new DashboardError("INVALID_RESPONSE", "Export did not return a CSV file.");
      return response.blob();
    },
    receiptUrl: row => row.receipt ? `/api/receipts/${encodeURIComponent(row.receipt.id)}` : null,
  };
}
