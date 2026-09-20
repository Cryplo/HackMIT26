"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/dashboard/workspace-store";
import { formatDate, statusLabel } from "@/lib/dashboard/helpers";
import type { InvestigationRun, SupportingDocument } from "@/lib/dashboard/types";
import { AppShell } from "./AppShell";
import { InvestigationRunView } from "./InvestigationRunView";
import { ProcedurePanel } from "./ProcedurePanel";
import { ReviewSheet } from "./ReviewSheet";
import styles from "./investigations.module.css";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "Unable to read saved investigations.";

export default function InvestigationsWorkspace({ preview = false, initialRun = null }: { preview?: boolean; initialRun?: string | null }) {
  const router = useRouter();
  const { client, data: reviews, refresh: refreshWorkspace, loading: workspaceLoading, error: workspaceError } = useWorkspace(preview);
  const [runs, setRuns] = useState<InvestigationRun[] | null>(null);
  const [documents, setDocuments] = useState<SupportingDocument[]>([]);
  const [selectedId, setSelectedId] = useState(initialRun);
  const [selectedMissing, setSelectedMissing] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [activeClaim, setActiveClaim] = useState<string | null>(null);
  const [backIds, setBackIds] = useState<string[]>([]);
  const [procedureBusy, setProcedureBusy] = useState(false);
  const [coverage, setCoverage] = useState<{ complete: boolean; returned: number; total: number } | null>(null);
  const [evidenceEpoch, setEvidenceEpoch] = useState(0);
  const listController = useRef<AbortController | null>(null);
  const latestRuns = useRef<InvestigationRun[]>([]);
  const investigationsEnabled = reviews?.capabilities?.investigations === true;
  const documentsEnabled = reviews?.capabilities?.supporting_documents === true;
  const loading = workspaceLoading || loadingRuns;

  const installRuns = useCallback((next: InvestigationRun[], complete = false) => {
    setRuns(previous => {
      const ids = new Set(next.map(run => run.run_id));
      const merged = new Map((previous ?? []).filter(run => !complete || ids.has(run.run_id)).map(run => [run.run_id, run]));
      for (const run of next) {
        const current = merged.get(run.run_id);
        if (current && current.status !== "running" && run.status === "running") continue;
        merged.set(run.run_id, run);
      }
      return [...merged.values()].sort((a, b) => b.started_at.localeCompare(a.started_at) || a.run_id.localeCompare(b.run_id));
    });
  }, []);

  const readRuns = useCallback(async (background = false) => {
    if (background && listController.current && !listController.current.signal.aborted) return;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    if (!background) setLoadingRuns(true);
    try {
      const saved = await client.getInvestigations(undefined, controller.signal);
      if (controller.signal.aborted) return;
      installRuns([...saved.runs, ...latestRuns.current], saved.coverage.complete);
      setCoverage(saved.coverage);
      setError(null);
    } catch (failure) {
      if (!controller.signal.aborted) { setError(message(failure)); throw failure; }
    } finally {
      if (listController.current === controller) listController.current = null;
      if (!controller.signal.aborted) setLoadingRuns(false);
    }
  }, [client, installRuns]);

  useEffect(() => {
    if (investigationsEnabled) void readRuns(true).catch(() => {});
  }, [investigationsEnabled, readRuns, reviews?.submissions]);

  useEffect(() => () => listController.current?.abort(), [client]);

  // Review mutations publish their current run into the shared claim snapshot.
  useEffect(() => {
    const saved = reviews?.submissions.flatMap(row => row.latest_investigation ? [row.latest_investigation] : []) ?? [];
    latestRuns.current = saved;
    if (saved.length) installRuns(saved);
  }, [reviews, installRuns]);

  const chosenId = selectedId ?? runs?.[0]?.run_id ?? null;
  const selectedClaimId = runs?.find(run => run.run_id === chosenId)?.claim_id;
  const selectedClaimRevision = reviews?.submissions.find(row => row.id === selectedClaimId)?.review_revision;
  useEffect(() => {
    if (!chosenId || !investigationsEnabled) return;
    const controller = new AbortController();
    setSelectedMissing(false);
    void client.getInvestigation(chosenId, controller.signal).then(({ run }) => {
      if (controller.signal.aborted) return;
      if (run.run_id !== chosenId) throw new Error("The server returned a different investigation. Refresh to recover the selected run.");
      installRuns([run]);
      setError(null);
    }).catch(failure => {
      if (!controller.signal.aborted) { setSelectedMissing(true); setError(message(failure)); }
    });
    return () => controller.abort();
  }, [client, chosenId, investigationsEnabled, evidenceEpoch, installRuns]);

  useEffect(() => {
    setDocumentError(null);
    if (!selectedClaimId || !documentsEnabled) return;
    const controller = new AbortController();
    void client.getSupportingDocuments(selectedClaimId, controller.signal).then(result => {
      if (!controller.signal.aborted) setDocuments(result.documents);
    }).catch(failure => { if (!controller.signal.aborted) setDocumentError(message(failure)); });
    return () => controller.abort();
  }, [client, selectedClaimId, selectedClaimRevision, documentsEnabled, evidenceEpoch]);

  const runningIds = (runs ?? []).filter(run => run.status === "running").map(run => run.run_id).sort().join(",");
  useEffect(() => {
    if (!runningIds) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    let paused = false;
    async function poll() {
      if (controller.signal.aborted || document.hidden || reading || paused) return;
      reading = true;
      try {
        const results = await Promise.all(runningIds.split(",").map(id => client.getInvestigation(id, controller.signal)));
        if (controller.signal.aborted) return;
        installRuns(results.map(result => result.run));
        if (results.some(result => result.run.status !== "running")) await refreshWorkspace();
      } catch (failure) {
        if (!controller.signal.aborted) { paused = true; setError(`${message(failure)} Automatic updates are paused. Refresh history to resume.`); }
      } finally {
        reading = false;
        if (!controller.signal.aborted && !document.hidden && !paused) timer = setTimeout(() => void poll(), 2000);
      }
    }
    function visibilityChanged() { clearTimeout(timer); if (!document.hidden) void poll(); }
    timer = setTimeout(() => void poll(), 2000);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [client, runningIds, refreshWorkspace, installRuns, evidenceEpoch]);

  const refresh = useCallback(async () => {
    await refreshWorkspace();
    if (investigationsEnabled) await readRuns();
    setEvidenceEpoch(value => value + 1);
  }, [refreshWorkspace, investigationsEnabled, readRuns]);

  useEffect(() => {
    const restoreSelection = () => setSelectedId(new URLSearchParams(window.location.search).get("run"));
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, []);

  const rows = reviews?.submissions ?? [];
  const selected = runs?.find(run => run.run_id === selectedId) ?? (!selectedId ? runs?.[0] : undefined);
  const row = rows.find(item => item.id === selected?.claim_id);
  const activeRow = rows.find(item => item.id === activeClaim) ?? null;
  const onOpenClaim = (id: string) => { if (activeClaim && activeClaim !== id) setBackIds(ids => [...ids, activeClaim]); setActiveClaim(id); };
  const openView = (view: "reviews" | "rules") => {
    const params = new URLSearchParams();
    if (preview) params.set("preview", "1");
    if (view === "rules") params.set("view", "rules");
    router.push(`/business-demo${params.size ? `?${params}` : ""}`);
  };
  const chooseRun = (id: string) => {
    if (id === chosenId) return;
    setSelectedId(id); setSelectedMissing(false); setDocuments([]); setDocumentError(null);
    const url = new URL(window.location.href); url.searchParams.set("run", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  return <AppShell view="investigations" onViewChange={openView} preview={preview}>
    <header className={styles.header}><div><h1>Check history</h1><p className={styles.muted}>See what Sift found while reviewing unclear evidence.</p></div><Button variant="outline" disabled={loading || procedureBusy} aria-busy={loading} onClick={() => void refresh().catch(() => {})}>{loading ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : <RefreshCw aria-hidden="true" />}{loading ? "Refreshing…" : "Refresh history"}</Button></header>
    {preview && <p className={styles.notice}>Preview data. All checks here are simulated.</p>}
    {(error || workspaceError) && <p role="alert" className={styles.error}>{error || workspaceError}</p>}
    {!reviews && loading && <p role="status" className={styles.activity}><LoaderCircle aria-hidden="true" className={styles.spinner} />Loading check history…</p>}
    {reviews && !reviews.capabilities?.investigations && <section className={styles.empty}><h2>History unavailable</h2><p>Open Claims to review the available evidence.</p></section>}
    {reviews?.capabilities?.investigations && <>
      {!runs && loading && <p role="status" className={styles.activity}><LoaderCircle aria-hidden="true" className={styles.spinner} />Loading check history…</p>}
      {coverage && (!coverage.complete || coverage.returned !== coverage.total) && <p className={styles.notice}>Showing {coverage.returned} of {coverage.total} saved checks. Some history is unavailable.</p>}
      {runs?.length === 0 && !error && <section className={styles.empty}><h2>No evidence checks yet</h2><p>When Sift investigates an unclear claim, its findings appear here.</p></section>}
      {!!runs?.length && <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Evidence check history</caption><thead><tr><th>Claim</th><th>Result</th><th>Date</th></tr></thead><tbody>{runs.map(run => {
        const claim = rows.find(item => item.id === run.claim_id);
        return <tr key={run.run_id} data-failed={run.status === "failed" || undefined} aria-selected={selected?.run_id === run.run_id}><td><button type="button" className={styles.runButton} onClick={() => chooseRun(run.run_id)} aria-pressed={selected?.run_id === run.run_id} aria-label={`View evidence check for ${claim?.attendee_name || "unavailable claim"}`}><strong>{claim?.attendee_name || "Claim unavailable"}</strong><span>{claim?.receipt?.parsed_fields_json?.vendor || "Merchant unavailable"}</span></button></td><td><span className={styles.activity} data-failed={run.status === "failed" || undefined} data-warning={run.status !== "running" && (run.status !== "completed" || run.outcome !== "resolved") || undefined}>{run.status === "running" ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : run.status === "completed" && run.outcome === "resolved" ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{run.status === "running" ? "Checking evidence" : run.status === "failed" ? "Needs review" : run.status !== "completed" ? statusLabel(run.status) : run.outcome === "needs_human" ? "Needs your input" : run.outcome === "resolved" ? "Question resolved" : run.outcome === "discrepancy_found" ? "Discrepancy found" : "No result"}</span></td><td><time dateTime={run.started_at} title={run.started_at}>{formatDate(run.started_at)}</time></td></tr>;
      })}</tbody></table></div>}
      {(selectedMissing || (selectedId && runs && !selected)) && <p role="status" className={styles.notice}>The selected investigation could not be refreshed. Any previous saved snapshot remains visible.</p>}
      {documentError && <p role="alert" className={styles.error}>Supporting evidence could not be refreshed. {documentError} Refresh history to retry.</p>}
      {selected && <><InvestigationRunView run={selected} row={row} rows={rows} documents={documents.filter(doc => doc.claim_id === selected.claim_id)} client={client} knowledgeRevision={reviews.knowledge_revision} onOpenClaim={onOpenClaim} />{row && <ProcedurePanel simulatedEnvironment={reviews.demo_mode} key={row.id} run={selected} row={row} rows={rows} documents={documents.filter(doc => doc.claim_id === selected.claim_id)} client={client} knowledgeRevision={reviews.knowledge_revision} enabled={reviews.capabilities.resolution_procedures === true} onChanged={refresh} onOpenClaim={onOpenClaim} onBusyChange={setProcedureBusy} />}</>}
    </>}
    <ReviewSheet simulatedEnvironment={reviews?.demo_mode === true} row={activeRow} rows={rows} open={!!activeClaim} onOpenChange={open => { if (!open) { setActiveClaim(null); setBackIds([]); } }} client={client} knowledgeRevision={reviews?.knowledge_revision ?? 0} capabilities={reviews?.capabilities} onOpenClaim={onOpenClaim} onChanged={refresh} onOpenRules={() => { setActiveClaim(null); openView("rules"); }} backId={backIds.at(-1) ?? null} onBack={() => { const previous = backIds.at(-1); if (previous) { setBackIds(ids => ids.slice(0, -1)); setActiveClaim(previous); } }} />
  </AppShell>;
}
