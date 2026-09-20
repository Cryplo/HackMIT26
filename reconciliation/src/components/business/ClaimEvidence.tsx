"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DocumentKind, InvestigationRun, ReviewRow, SupportingDocument, WorkspaceCapabilities } from "@/lib/dashboard/types";
import type { DashboardClient } from "@/lib/dashboard/ui-contracts";
import { machineChecks } from "@/lib/dashboard/review";
import { InvestigationRunView } from "./InvestigationRunView";
import { ProcedurePanel } from "./ProcedurePanel";
import styles from "./claim-evidence.module.css";

const kinds: Record<DocumentKind, string> = {
  booking_confirmation: "Booking confirmation", itemized_document: "Itemized document",
  itinerary: "Itinerary", payment_confirmation: "Payment confirmation", other: "Other",
};
const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : "The request failed.";

interface Props {
  row: ReviewRow;
  rows: ReviewRow[];
  client: DashboardClient;
  capabilities?: WorkspaceCapabilities;
  knowledgeRevision: number;
  simulatedEnvironment: boolean;
  busy: boolean;
  onBusyChange(busy: boolean): void;
  onRunChange(run: InvestigationRun | null): void;
  onRowChange(row: ReviewRow): void;
  onChanged(): Promise<void>;
  onOpenClaim(id: string): void;
}

export function ClaimEvidence({ row, rows, client, capabilities, knowledgeRevision, simulatedEnvironment, busy, onBusyChange, onRunChange, onRowChange, onChanged, onOpenClaim }: Props) {
  const documentsEnabled = capabilities?.supporting_documents === true;
  const investigationsEnabled = capabilities?.investigations === true;
  const [documents, setDocuments] = useState<SupportingDocument[] | null>(null);
  const [run, setRun] = useState<InvestigationRun | null>(row.latest_investigation ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocumentKind>("booking_confirmation");
  const [operation, setOperation] = useState<"upload" | null>(null);
  const [procedureBusy, setProcedureBusy] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [error, setError] = useState("");
  const [documentsError, setDocumentsError] = useState("");
  const [runsError, setRunsError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentRun = useRef(run);
  const currentOperation = useRef(operation);
  const locked = useRef(false);
  const lifetime = useRef(new AbortController());
  const runRead = useRef<Promise<void> | null>(null);
  const documentRead = useRef<Promise<void> | null>(null);

  const installRun = useCallback((next: InvestigationRun | null) => {
    if (next && next.claim_id !== row.id) return;
    const previous = currentRun.current;
    if (previous && next && (previous.started_at > next.started_at || (previous.run_id === next.run_id && previous.status !== "running" && next.status === "running"))) return;
    currentRun.current = next;
    setRun(next);
    onRunChange(next);
    if (next?.status === "running") onBusyChange(true);
  }, [row.id, onRunChange, onBusyChange]);

  const readDocuments = useCallback(async (signal: AbortSignal) => {
    if (!documentsEnabled) return;
    while (documentRead.current) await documentRead.current.catch(() => {});
    if (signal.aborted) return;
    const request = (async () => {
      try {
        const result = await client.getSupportingDocuments(row.id, signal);
        if (!signal.aborted) { setDocuments(result.documents); setDocumentsError(""); }
      } catch (failure) {
        if (!signal.aborted) { setDocumentsError(failureMessage(failure)); throw failure; }
      }
    })();
    documentRead.current = request;
    try { await request; } finally { if (documentRead.current === request) documentRead.current = null; }
  }, [client, row.id, documentsEnabled]);

  const readRuns = useCallback(async (signal: AbortSignal) => {
    if (!investigationsEnabled) return;
    while (runRead.current) await runRead.current.catch(() => {});
    if (signal.aborted) return;
    const request = (async () => {
      try {
        const result = await client.getInvestigations(row.id, signal);
        if (signal.aborted) return;
        const saved = result.runs.filter(item => item.claim_id === row.id);
        const next = saved.find(item => item.status === "running") ?? saved[0] ?? null;
        if (!next && currentRun.current && !result.coverage.complete) throw new Error("The last saved investigation was not returned. Its previous snapshot is retained.");
        const finished = currentRun.current?.status === "running" && next?.status !== "running";
        // Keep the last saved run visible if a read has incomplete coverage.
        if (next || result.coverage.complete) installRun(next);
        setRunsError("");
        if (finished) {
          try { await onChanged(); }
          catch (failure) { if (!signal.aborted) setRecoveryRequired(true); throw failure; }
        }
      } catch (failure) {
        if (!signal.aborted) { setRunsError(failureMessage(failure)); throw failure; }
      }
    })();
    runRead.current = request;
    try { await request; } finally { if (runRead.current === request) runRead.current = null; }
  }, [client, row.id, investigationsEnabled, installRun, onChanged]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [readDocuments]);

  useEffect(() => {
    void readDocuments(lifetime.current.signal).catch(() => {});
  }, [readDocuments, row.review_revision]);

  useEffect(() => {
    if (row.latest_investigation) {
      const resume = currentRun.current?.status !== "running" && row.latest_investigation.status === "running";
      installRun(row.latest_investigation);
      if (resume) setPollEpoch(value => value + 1);
    } else if (row.latest_investigation === null && !currentOperation.current) {
      installRun(null);
    }
  }, [row.latest_investigation, installRun]);

  useEffect(() => {
    if (!investigationsEnabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    let failures = 0;
    async function poll() {
      if (controller.signal.aborted || document.hidden || reading) return;
      reading = true;
      try { await readRuns(controller.signal); failures = 0; }
      catch { failures += 1; }
      finally {
        reading = false;
        if (!controller.signal.aborted && !document.hidden && failures < 3 && currentRun.current?.status === "running") timer = setTimeout(() => {
          if (currentRun.current?.status === "running") void poll();
        }, 1000);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (!document.hidden) { failures = 0; void poll(); }
    }
    void poll();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [investigationsEnabled, readRuns, pollEpoch]);

  const ownsLock = !!operation || procedureBusy || recoveryRequired || (investigationsEnabled && run?.status === "running");
  useEffect(() => { onBusyChange(ownsLock); }, [ownsLock, onBusyChange]);
  const onProcedureBusyChange = useCallback((value: boolean) => {
    setProcedureBusy(value);
    if (value) onBusyChange(true);
  }, [onBusyChange]);

  const refreshAuthoritative = useCallback(async () => {
    const signal = lifetime.current.signal;
    const results = await Promise.allSettled([readDocuments(signal), readRuns(signal), onChanged()]);
    if (signal.aborted) return;
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    setRecoveryRequired(false);
  }, [readDocuments, readRuns, onChanged]);

  async function refreshSaved() {
    if (refreshing) return;
    setRefreshing(true);
    try { await refreshAuthoritative(); setPollEpoch(value => value + 1); }
    catch (failure) { if (!lifetime.current.signal.aborted) setError(`Saved state could not refresh. ${failureMessage(failure)}`); }
    finally { if (!lifetime.current.signal.aborted) setRefreshing(false); }
  }

  async function upload() {
    if (locked.current || busy || ownsLock || row.processing_status === "running" || row.decision_status !== "pending" || !Number.isSafeInteger(row.review_revision) || row.review_revision < 0) return;
    if (!documentsEnabled || !file || !documents || documents.length >= 8) return;
    if (!Object.hasOwn(kinds, kind) || !["application/pdf", "image/png", "image/jpeg"].includes(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024) {
      setError("Choose one PDF, PNG, or JPEG document up to 8 MiB and a document kind.");
      return;
    }
    locked.current = true;
    currentOperation.current = "upload";
    onBusyChange(true);
    setOperation("upload"); setError(""); setNotice("");
    const signal = lifetime.current.signal;
    try {
      const result = await client.uploadSupportingDocument(row.id, file, kind, row.review_revision);
      if (signal.aborted) return;
      onRowChange(result.row);
      setDocuments(previous => [...(previous ?? []).filter(item => item.id !== result.document.id), result.document]);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      if (result.document.extraction_status === "failed") setError(`Document saved; extraction failed. ${result.document.extraction_error || "The original remains available."}`);
      else setNotice(result.document.extraction_status === "pending" ? "Document saved; extraction is pending. The original remains available." : capabilities?.automatic_processing ? "Document saved. Checks will run automatically." : "Document saved. Recheck this claim to assess the new evidence.");
    } catch (failure) {
      if (signal.aborted) return;
      setRecoveryRequired(true);
      setError(`${failureMessage(failure)} Reading saved state before another attempt. Your reviewer note is preserved; this request will not be repeated automatically.`);
    } finally {
      currentOperation.current = null;
      if (!signal.aborted) {
        try { await refreshAuthoritative(); }
        catch (failure) { setRecoveryRequired(true); setError(previous => `${previous ? `${previous} ` : ""}Refresh saved state before another action. ${failureMessage(failure)}`); }
        locked.current = false;
        setOperation(null);
        if (currentRun.current?.status === "running") setPollEpoch(value => value + 1);
      }
    }
  }

  const disabled = busy || ownsLock || row.processing_status === "running";
  const uploadBlocked = !documentsEnabled ? "Supporting documents are unavailable on this backend." : row.decision_status !== "pending" ? "Supporting documents can only be added to pending claims." : documents === null ? "Load saved documents before adding evidence." : documents.length >= 8 ? "This claim already has the maximum of eight supporting documents." : null;
  const shownRun = investigationsEnabled ? run : null;
  const needsDocument = row.decision_status === "pending" && (shownRun?.outcome === "needs_human" || machineChecks(row).some(check => check.verdict === "unknown" && ["merchant", "name"].includes(check.field_checked)));

  return <div className={styles.root}>
    {shownRun && <InvestigationRunView run={shownRun} row={row} rows={rows} documents={documents ?? []} client={client} knowledgeRevision={knowledgeRevision} onOpenClaim={onOpenClaim} showClaimLink={false} />}
    {(operation === "upload" || refreshing) && <p role="status" className={styles.activity}><LoaderCircle aria-hidden="true" className={styles.spinner} />{operation === "upload" ? "Uploading and reading document…" : "Refreshing saved evidence…"}</p>}
    {runsError && <p role="alert" className={styles.error}>{runsError} Refresh from More actions to try again.</p>}
    {documentsEnabled && <section aria-label="Supporting documents" className={styles.section}>
        {!!documents?.length && <><h3>Supporting documents</h3><ul className={styles.documents}>{documents.map(item => {
          const url = client.supportingDocumentUrl(row.id, item.id);
          return <li key={item.id}>
          <strong>{kinds[item.kind]}</strong>
          {item.extraction_status === "pending" && <span>Document reading pending</span>}
          {item.extraction_error && <p className={styles.error}>{item.extraction_error}</p>}
          {url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`Open original ${kinds[item.kind].toLowerCase()}`}>Open document <ArrowUpRight aria-hidden="true" /></a> : <span>Original document unavailable</span>}
          <details className={styles.documentDetails}><summary>Document details</summary><p className={styles.identifier}>Document {item.id}<br />{item.file_type} · Extraction {item.extraction_status}<br />Source: {item.extraction_provenance || "Not recorded"}</p></details>
        </li>; })}</ul></>}
      {documents === null && !documentsError && <p role="status" className={styles.activity}><LoaderCircle aria-hidden="true" className={styles.spinner} />Loading supporting documents…</p>}
      <details className={styles.disclosure} open={needsDocument}>
        <summary>Add supporting document</summary>
        <p>{needsDocument ? "Add evidence that answers the open question." : "Attach evidence for this purchase, such as a booking confirmation or itemized receipt."}</p>
        <form className={styles.form} onSubmit={(event: FormEvent) => { event.preventDefault(); void upload(); }}>
          <Label htmlFor="supporting-kind">Document kind</Label>
          <select id="supporting-kind" value={kind} disabled={disabled || !!uploadBlocked} onChange={event => setKind(event.target.value as DocumentKind)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <Label htmlFor="supporting-file">Supporting file</Label>
          <input ref={fileInput} id="supporting-file" type="file" accept="application/pdf,image/png,image/jpeg" disabled={disabled || !!uploadBlocked} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} aria-describedby="supporting-limits" />
          <p id="supporting-limits">PDF, PNG, or JPEG · up to 8 MiB each · maximum 8 documents</p>
          <Button type="submit" variant="outline" disabled={disabled || !!uploadBlocked || !file} aria-busy={operation === "upload"}>{operation === "upload" && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{operation === "upload" ? "Uploading…" : "Upload document"}</Button>
        </form>
        {uploadBlocked && <p>{uploadBlocked}</p>}
      </details>
      {documentsError && <p role="alert" className={styles.error}>{documentsError}</p>}
    </section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <details className={styles.disclosure} open={!!documentsError || !!runsError || recoveryRequired}>
      <summary>More actions</summary>
      <div className={styles.form}>
        <Button variant="outline" disabled={refreshing || !!operation} aria-busy={refreshing} onClick={() => void refreshSaved()}>{refreshing && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{refreshing ? "Refreshing…" : "Refresh saved result"}</Button>
        {shownRun && <Link href={{ pathname: "/investigations", query: { run: shownRun.run_id, ...(client.mode === "preview" ? { preview: "1" } : {}) } }}>View check history <ArrowUpRight aria-hidden="true" /></Link>}
      </div>
    </details>
    <ProcedurePanel run={shownRun} row={row} rows={rows} documents={documents ?? []} client={client} knowledgeRevision={knowledgeRevision} simulatedEnvironment={simulatedEnvironment} enabled={capabilities?.resolution_procedures === true} onChanged={refreshAuthoritative} onOpenClaim={onOpenClaim} busy={busy || !!operation || recoveryRequired || row.processing_status === "running" || shownRun?.status === "running"} onBusyChange={onProcedureBusyChange} />
  </div>;
}
