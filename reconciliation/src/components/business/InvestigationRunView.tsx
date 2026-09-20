"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approvalBlock } from "@/lib/dashboard/review";
import { statusLabel } from "@/lib/dashboard/helpers";
import { claimReason } from "@/lib/dashboard/human-actions";
import { investigationFailureDetails } from "@/lib/intelligence/investigation-errors";
import type { DashboardClient } from "@/lib/dashboard/ui-contracts";
import type { EvidenceRef, InvestigationRun, ReviewRow, SupportingDocument } from "@/lib/dashboard/types";
import styles from "./investigations.module.css";

type EvidenceProps = {
  refs: EvidenceRef[]; claimId: string; rows: ReviewRow[]; documents: SupportingDocument[];
  client: DashboardClient; onOpenClaim: (id: string) => void;
};

/** Only link records supplied by the server; model-authored IDs are not routes. */
export function InvestigationEvidenceLinks({ refs, claimId, rows, documents, client, onOpenClaim }: EvidenceProps) {
  if (!refs.length) return <p className={styles.muted}>No supporting references recorded.</p>;
  return <ul className={styles.evidenceLinks}>{Array.from(new Map(refs.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()).map(ref => {
    const owner = ref.kind === "receipt" ? rows.find(row => row.receipt?.id === ref.id) : undefined;
    const claim = ref.kind === "claim" ? rows.find(row => row.id === ref.id) : undefined;
    const document = ref.kind === "supporting_document" ? documents.find(doc => doc.id === ref.id && doc.claim_id === claimId) : undefined;
    const url = owner ? client.receiptUrl(owner) : document ? client.supportingDocumentUrl(claimId, document.id) : null;
    return <li key={`${ref.kind}:${ref.id}`}>{url ? <a href={url} target="_blank" rel="noreferrer">Open {document ? statusLabel(document.kind) : "original receipt"}<span className="sr-only"> (opens in a new tab)</span></a> : claim ? <button type="button" onClick={() => onOpenClaim(claim.id)}>Open claim: {claim.attendee_name}</button> : <span>{statusLabel(ref.kind)} — unavailable</span>}</li>;
  })}</ul>;
}

export function investigationIsCurrent(run: InvestigationRun, row: ReviewRow | undefined, knowledgeRevision: number) {
  const after = run.after_assessment;
  return !!row && run.status === "completed" && !!after && row.id === run.claim_id
    && row.latest_investigation?.run_id === run.run_id
    && row.assessment_knowledge_revision === after.knowledge_revision
    && after.knowledge_revision === knowledgeRevision
    && (row.review_revision === after.review_revision || (row.decision_status === "approved" && row.review_revision > after.review_revision));
}

function Elapsed({ run }: { run: InvestigationRun }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (run.status !== "running") return;
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [run.run_id, run.status]);
  const start = Date.parse(run.started_at);
  const finish = run.completed_at ? Date.parse(run.completed_at) : run.status === "running" ? now : null;
  const seconds = finish !== null && Number.isFinite(start) && Number.isFinite(finish) ? Math.max(0, Math.floor((finish - start) / 1000)) : null;
  return <span>Elapsed: {seconds === null ? "unavailable" : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>;
}

export function InvestigationRunView({ run, row, rows, documents, client, knowledgeRevision, onOpenClaim, showClaimLink = true }: {
  run: InvestigationRun; row?: ReviewRow; rows: ReviewRow[]; documents: SupportingDocument[];
  client: DashboardClient; knowledgeRevision: number; onOpenClaim: (id: string) => void; showClaimLink?: boolean;
}) {
  const steps = Array.from(new Map(run.steps.map(step => [step.id, step])).values()).sort((a, b) => a.sequence - b.sequence || a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
  const current = investigationIsCurrent(run, row, knowledgeRevision);
  const ready = current && row?.decision_status === "pending" && row.assessment_status === "matched" && run.outcome === "resolved" && !approvalBlock(row, knowledgeRevision, rows, true);
  const completed = run.status === "completed";
  const exception = run.status === "failed" || run.status === "superseded" || run.outcome === "needs_human" || run.outcome === "discrepancy_found" || (completed && !run.outcome);
  const completedSteps = steps.filter(step => step.status === "completed").length;
  const activeStep = steps.find(step => step.status === "running");
  const outcome = run.status === "running" ? "Checking evidence" : !completed ? statusLabel(run.status) : ready ? "Checks passed" : run.outcome === "needs_human" ? "Needs your input" : run.outcome === "discrepancy_found" ? "Discrepancy found" : run.outcome === "resolved" ? "Question resolved" : "Result unavailable";
  const evidence = { claimId: run.claim_id, rows, documents, client, onOpenClaim };
  const failure = investigationFailureDetails(run.error);
  const before = run.before_assessment;
  const after = completed ? run.after_assessment : null;
  const fields = [...new Set([...before.checks, ...(after?.checks ?? [])].filter(check => check.check_method !== "human" && check.field_checked !== "overall_status").map(check => check.field_checked))];

  return <section aria-label="Investigation details" className={styles.runView}>
    <div className={styles.conclusion} data-failed={run.status === "failed" || undefined} data-warning={exception || undefined} role="status">
      <h2 className={styles.activity}>{run.status === "running" ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : exception ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}{outcome}</h2>
      {run.status === "failed" ? <><p>{failure.message} Review the saved claim evidence before deciding.</p>{failure.detail && <details className={styles.disclosure}><summary>Technical details</summary><p><code>{failure.detail}</code></p></details>}</> : run.status === "superseded" ? <p>The evidence changed during this check. Review the latest claim result.</p> : current && row ? <p>{claimReason(row)}</p> : completed && run.unresolved_question ? <p>{run.unresolved_question}</p> : null}
      {run.status === "running" && <p>{activeStep ? `${statusLabel(activeStep.tool)}…` : "Reviewing available evidence…"}{completedSteps > 0 && ` · ${completedSteps} ${completedSteps === 1 ? "check" : "checks"} completed`}</p>}
      {completed && !current && <p className={styles.muted}>Earlier result. Open the claim for its current status.</p>}
      {run.mode === "simulated" && <span className={styles.mode}>Simulated check</span>}
    </div>
    {!!run.findings.length && <section className={styles.findings} aria-label="Key findings"><h3>Key findings</h3>{run.findings.map(finding => <article key={finding.id} className={styles.finding}><strong>{statusLabel(finding.check)}</strong><p>{finding.statement}</p>{!!finding.evidence_refs.length && <InvestigationEvidenceLinks refs={finding.evidence_refs} {...evidence} />}</article>)}</section>}
    <details className={styles.disclosure}><summary>How this was checked{steps.length > 0 && ` · ${completedSteps} of ${steps.length} recorded checks completed`}</summary><div className={styles.detailContent}>
    {steps.length ? <ol className={styles.steps}>{steps.map(step => <li key={step.id} data-state={step.status} className={step.status === "running" && run.status === "running" ? styles.activeStep : undefined}>
      <details className={styles.stepDetails}><summary><span className={styles.stepHeading}>{step.status === "running" && run.status === "running" ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : step.status === "completed" ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}<strong>{statusLabel(step.tool)}</strong><span className={styles.muted}>{step.status === "running" && run.status !== "running" ? "Incomplete" : statusLabel(step.status)}</span></span></summary>
      <div className={styles.stepContent}><p>{step.summary || "No summary recorded."}</p>
      {step.error && <p className={styles.error}>{investigationFailureDetails(step.error).message}</p>}{!!step.evidence_refs.length && <InvestigationEvidenceLinks refs={step.evidence_refs} {...evidence} />}
      <p className={styles.muted}><time dateTime={step.started_at}>{step.started_at}</time>{step.completed_at && <> → <time dateTime={step.completed_at}>{step.completed_at}</time></>}</p></div>
      </details>
    </li>)}</ol> : <p className={styles.muted}>No check details were saved.</p>}
    <details className={styles.disclosure}><summary>Run details</summary>
    {run.summary && <p>{run.summary}</p>}
    <p className={styles.meta}><span>Model: {run.model || "Not recorded"}</span><Elapsed run={run} /></p>
    <p className={styles.muted}>Started <time dateTime={run.started_at}>{run.started_at}</time>{run.completed_at && <> · Finished <time dateTime={run.completed_at}>{run.completed_at}</time></>}</p>
    <p className={styles.muted}>Run: {run.run_id}</p>
    </details>
    <details className={styles.disclosure}><summary>Before and after assessment</summary><p className={styles.muted}>Before: {before.assessment_status ? statusLabel(before.assessment_status) : "Not assessed"} · After: {after?.assessment_status ? statusLabel(after.assessment_status) : "No published assessment"}</p>
      <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Server-recorded check changes</caption><thead><tr><th>Check</th><th>Before</th><th>After</th><th>Recorded reason</th></tr></thead><tbody>{fields.map(field => {
        const previous = before.checks.filter(check => check.field_checked === field);
        const next = after?.checks.filter(check => check.field_checked === field) ?? [];
        return <tr key={field}><th scope="row">{statusLabel(field)}</th><td>{previous.map(check => check.verdict).join(", ") || "Not recorded"}</td><td>{next.map(check => check.verdict).join(", ") || "Not published"}</td><td>{(next.length ? next : previous).map(check => check.rationale_text).filter(Boolean).join(" ") || "No reason recorded"}</td></tr>;
      })}</tbody></table></div>
    </details>
    </div></details>
    {showClaimLink && (row ? <Button variant={ready ? "default" : "outline"} onClick={() => onOpenClaim(run.claim_id)}>Open claim</Button> : <Button variant="outline" asChild><Link href={`/business-demo?${client.mode === "preview" ? "preview=1&" : ""}claim=${encodeURIComponent(run.claim_id)}`}>Open claim</Link></Button>)}
  </section>;
}
