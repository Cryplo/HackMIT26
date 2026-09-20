import type { DashboardClient } from "./ui-contracts";
import type { ClaimMessage, ReviewRow, ReviewsResponse } from "./types";
import { api, DashboardError, validateReviews } from "./helpers";
import { createPreviewClient } from "./preview";

function createTransport(mode: "api" | "preview"): DashboardClient {
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
    retryLearning: (id, expectedRevision) => api(`/api/submissions/${encodeURIComponent(id)}/feedback-learning/retry`, { expected_review_revision: expectedRevision }),
    retryExtraction: (id, expectedRevision) => api(`/api/submissions/${encodeURIComponent(id)}/retry-extraction`, { expected_review_revision: expectedRevision }),
    getSupportingDocuments: (claimId, signal) => api(`/api/submissions/${encodeURIComponent(claimId)}/supporting-documents`, undefined, signal),
    uploadSupportingDocument(claimId, file, kind, expectedRevision) {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);
      body.set("expected_review_revision", String(expectedRevision));
      return api(`/api/submissions/${encodeURIComponent(claimId)}/supporting-documents`, body);
    },
    supportingDocumentUrl: (claimId, documentId) => `/api/submissions/${encodeURIComponent(claimId)}/supporting-documents/${encodeURIComponent(documentId)}`,
    getInvestigations: (claimId, signal) => api(`/api/investigations${claimId === undefined ? "" : `?claim_id=${encodeURIComponent(claimId)}`}`, undefined, signal),
    getInvestigation: (runId, signal) => api(`/api/investigations/${encodeURIComponent(runId)}`, undefined, signal),
    investigate: (claimId, expectedRevision) => api(`/api/submissions/${encodeURIComponent(claimId)}/investigate`, { expected_review_revision: expectedRevision }),
    getChecks: signal => api("/api/checks", undefined, signal),
    createCheck: input => api("/api/checks", input),
    updateCheck: (id, input) => api(`/api/checks/${encodeURIComponent(id)}`, input, undefined, "PATCH"),
    enableCheck: (id, input) => api(`/api/checks/${encodeURIComponent(id)}/enable`, input),
    disableCheck: (id, input) => api(`/api/checks/${encodeURIComponent(id)}/disable`, input),
    getProcedures: signal => api("/api/procedures", undefined, signal),
    proposeProcedure: (runId, expectedRevision) => api("/api/procedures", { run_id: runId, expected_review_revision: expectedRevision }),
    testProcedure: (id, expectedVersion) => api(`/api/procedures/${encodeURIComponent(id)}/test`, { expected_procedure_version: expectedVersion }),
    activateProcedure: (id, expectedVersion) => api(`/api/procedures/${encodeURIComponent(id)}/activate`, { expected_procedure_version: expectedVersion }),
    disableProcedure: (id, expectedVersion) => api(`/api/procedures/${encodeURIComponent(id)}/disable`, { expected_procedure_version: expectedVersion }),
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


const emptySnapshot = { data: null as ReviewsResponse | null, loading: true, error: "", updatedAt: 0 };

function createWorkspaceStore(mode: "api" | "preview") {
  const transport = createTransport(mode);
  let snapshot = emptySnapshot;
  let generation = 0;
  let pendingMutations = 0;
  let inFlight: Promise<ReviewsResponse> | null = null;
  let lastAttempt = 0;
  const listeners = new Set<() => void>();
  let stopPolling: (() => void) | undefined;
  let channel: BroadcastChannel | undefined;
  let lastBroadcastToken = "";
  function publish(next: typeof snapshot) {
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  function invalidate() {
    ++generation;
    inFlight = null;
    if (snapshot.data) publish({ ...snapshot, data: { ...snapshot.data, snapshot_token: "" } });
  }
  function read(force = false, background = false): Promise<ReviewsResponse> {
    if (inFlight) return inFlight;
    if (!force && snapshot.data?.snapshot_token && Date.now() - snapshot.updatedAt < 30_000) return Promise.resolve(snapshot.data);
    const version = generation;
    lastAttempt = Date.now();
    if (!background || !snapshot.data) publish({ ...snapshot, loading: true });
    const request = transport.getReviews().then(data => {
      // A read begun before a mutation must never replace its returned rows.
      if (version !== generation) return snapshot.data ?? data;
      publish({ data, loading: false, error: "", updatedAt: Date.now() });
      if (pendingMutations && data.snapshot_token !== lastBroadcastToken) {
        lastBroadcastToken = data.snapshot_token;
        channel?.postMessage("changed");
      }
      return data;
    }, failure => {
      if (version === generation) publish({ ...snapshot, loading: false, error: failure instanceof Error ? failure.message : "Unable to load reviews." });
      throw failure;
    }).finally(() => { if (inFlight === request) inFlight = null; });
    inFlight = request;
    return request;
  }
  async function mutate<T>(operation: () => Promise<T>, ownedIds: string[] = []): Promise<T> {
    const originalIds = snapshot.data?.submissions.map(row => row.id);
    pendingMutations++;
    invalidate();
    channel?.postMessage("changed");
    let authoritative = false;
    try {
      const result = await operation();
      invalidate();
      const update = result as { row?: ReviewRow; rows?: ReviewRow[]; snapshot_token?: string; knowledge_revision?: number };
      authoritative = !!update.row || Array.isArray(update.rows);
      if (snapshot.data) {
        const currentRows = new Map(snapshot.data.submissions.map(row => [row.id, row]));
        const returnedById = new Map(update.rows?.map(row => [row.id, row]));
        const membershipChanged = !!originalIds && (originalIds.length !== currentRows.size || originalIds.some(id => !currentRows.has(id)));
        const returnedRows = update.rows && (membershipChanged
          ? snapshot.data.submissions.map(row => returnedById.get(row.id) ?? row)
          : update.rows);
        const submissions = returnedRows
          ? returnedRows.map(row => {
            const current = currentRows.get(row.id);
            // Starting a run does not advance review_revision. A batch response cannot
            // replace a different claim's equal-revision progress with its older snapshot.
            return current && (current.review_revision > row.review_revision ||
              (current.review_revision === row.review_revision && !ownedIds.includes(row.id) && JSON.stringify(current) !== JSON.stringify(row))) ? current : row;
          })
          : snapshot.data.submissions.map(row => update.row?.id === row.id && update.row.review_revision >= row.review_revision ? update.row : row);
        const coherent = Array.isArray(update.rows) && !!update.snapshot_token && Number.isInteger(update.knowledge_revision)
          && update.knowledge_revision! >= snapshot.data.knowledge_revision && pendingMutations === 1 && !membershipChanged
          && submissions.every((row, index) => row === update.rows![index]);
        publish({ ...snapshot, loading: false, updatedAt: Date.now(), error: "", data: {
          ...snapshot.data, submissions, ...(update.rows && !membershipChanged ? { coverage: { complete: true, returned: submissions.length, total: submissions.length } } : {}), snapshot_token: coherent ? update.snapshot_token! : "",
          knowledge_revision: Math.max(snapshot.data.knowledge_revision, update.knowledge_revision ?? 0),
          summary: {
            approved_amount_minor: submissions.filter(row => row.decision_status === "approved").reduce((sum, row) => sum + row.amount_requested_minor, 0),
            pending_review_count: submissions.filter(row => row.decision_status === "pending").length,
            matched_count: submissions.filter(row => row.assessment_status === "matched").length,
            flagged_count: submissions.filter(row => row.assessment_status === "flagged").length,
            needs_review_count: submissions.filter(row => row.assessment_status === "needs_review").length,
          },
        } });
      }
      return result;
    } catch (failure) {
      invalidate();
      throw failure;
    } finally {
      pendingMutations--;
      channel?.postMessage("changed");
      if (!pendingMutations && !snapshot.data?.snapshot_token) {
        // Reads may be retried; uncertain writes are never retried automatically.
        invalidate();
        const revalidation = read(true, true).catch(() => {});
        if (!authoritative) await revalidation;
      }
    }
  }
  const client: DashboardClient = {
    ...transport,
    async getReviews(signal) {
      signal?.throwIfAborted();
      const request = read();
      // A leaving consumer cancels only its wait, never another consumer's shared read.
      if (!signal) return structuredClone(await request);
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        request.then(data => { if (!signal.aborted) resolve(structuredClone(data)); }, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
    },
    reconcile: input => mutate(() => transport.reconcile(input), input.submission_ids),
    decide: input => mutate(() => transport.decide(input)),
    decisionAndSend: transport.decisionAndSend ? (id, input) => mutate(() => transport.decisionAndSend!(id, input)) : undefined,
    retryLearning: transport.retryLearning ? (id, revision) => mutate(() => transport.retryLearning!(id, revision)) : undefined,
    retryExtraction: (id, revision) => mutate(() => transport.retryExtraction(id, revision)),
    uploadSupportingDocument: (id, file, kind, revision) => mutate(() => transport.uploadSupportingDocument(id, file, kind, revision)),
    investigate: (id, revision) => mutate(() => transport.investigate(id, revision)),
    proposeRule: input => mutate(() => transport.proposeRule(input)),
    testRule: (id, input) => mutate(() => transport.testRule(id, input)),
    activateRule: (id, input) => mutate(() => transport.activateRule(id, input)),
    disableRule: (id, input) => mutate(() => transport.disableRule(id, input)),
    createCheck: input => mutate(() => transport.createCheck(input)),
    updateCheck: (id, input) => mutate(() => transport.updateCheck(id, input)),
    enableCheck: (id, input) => mutate(() => transport.enableCheck(id, input)),
    disableCheck: (id, input) => mutate(() => transport.disableCheck(id, input)),
    proposeProcedure: (id, revision) => mutate(() => transport.proposeProcedure(id, revision)),
    testProcedure: (id, version) => mutate(() => transport.testProcedure(id, version)),
    activateProcedure: (id, version) => mutate(() => transport.activateProcedure(id, version)),
    disableProcedure: (id, version) => mutate(() => transport.disableProcedure(id, version)),
  };
  return {
    client,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => emptySnapshot,
    refresh: async () => { await read(true); },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof document !== "undefined") {
        const refreshVisible = (force = false) => {
          if (document.visibilityState === "hidden") return;
          const interval = pendingMutations || snapshot.data?.submissions.some(row => row.processing_status === "running" || row.latest_investigation?.status === "running" || ["queued", "checking", "testing"].includes(row.learning?.status ?? "")) ? 2000 : 30_000;
          if (force || Date.now() - lastAttempt >= interval) void read(true, true).catch(() => {});
        };
        const onFocus = () => refreshVisible(true);
        if (mode === "api" && typeof BroadcastChannel !== "undefined") {
          channel = new BroadcastChannel("sift-workspace");
          channel.onmessage = event => {
            if (event.data !== "changed") return;
            invalidate();
            refreshVisible(true);
          };
        }
        const timer = setInterval(() => refreshVisible(), 2000);
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);
        stopPolling = () => {
          clearInterval(timer);
          channel?.close(); channel = undefined;
          window.removeEventListener("focus", onFocus);
          document.removeEventListener("visibilitychange", onFocus);
        };
        if (document.visibilityState !== "hidden") void read().catch(() => {});
      }
      return () => { listeners.delete(listener); if (!listeners.size) { stopPolling?.(); stopPolling = undefined; } };
    },
  };
}

/** Isolated clients remain useful for synthetic fixtures; routes share getWorkspaceStore. */
export function createDashboardClient(mode: "api" | "preview"): DashboardClient {
  return createWorkspaceStore(mode).client;
}
const workspaces = new Map<"api" | "preview", ReturnType<typeof createWorkspaceStore>>();
export function getWorkspaceStore(mode: "api" | "preview") {
  let workspace = workspaces.get(mode);
  if (!workspace) { workspace = createWorkspaceStore(mode); workspaces.set(mode, workspace); }
  return workspace;
}


export interface CheckProgress { done: number; total: number; checkingIds: string[]; completedIds: string[] }
/** Small sequential batches expose progress; stop never cancels an already submitted write. */
export async function checkClaims(client: DashboardClient, ids: string[], onProgress: (progress: CheckProgress) => void, shouldStop = () => false) {
  if (!ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error("Select 1–1000 unique claims to check.");
  let done = 0;
  const emailWarnings: string[] = [];
  for (let offset = 0; offset < ids.length && !shouldStop(); offset += 5) {
    const batch = ids.slice(offset, offset + 5);
    onProgress({ done, total: ids.length, checkingIds: batch, completedIds: [] });
    const result = await client.reconcile({ submission_ids: batch });
    for (const row of result.results) if (row.email_error) emailWarnings.push(`${row.submission_id}: ${row.email_error}`);
    const completedIds = batch.filter(id => result.results.some(row => row.submission_id === id && !row.error));
    done += completedIds.length;
    onProgress({ done, total: ids.length, checkingIds: [], completedIds });
    const failed = batch.filter(id => !completedIds.includes(id));
    if (failed.length) throw new Error(`${done} completed; stopped after ${failed.length} failed or missing results: ${failed.map(id => `${id}: ${result.results.find(row => row.submission_id === id)?.error || "No result"}`).join("; ")}`);
  }
  return { done, stopped: done < ids.length, ...(emailWarnings.length ? { emailWarnings } : {}) };
}
