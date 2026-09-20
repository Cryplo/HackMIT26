"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, FileText, LoaderCircle, RotateCw, Send, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, money, statusLabel } from "@/lib/dashboard/helpers";
import { checkFacts } from "@/lib/dashboard/check-facts";
import { decisionReason } from "@/lib/dashboard/decision-reason";
import { approvalBlock, machineChecks, normalizeVendor as normalize } from "@/lib/dashboard/review";
import type { ReviewSheetProps } from "@/lib/dashboard/ui-contracts";
import type { InvestigationRun, ReviewRow } from "@/lib/dashboard/types";
import { LearningStatus } from "./ProcedurePanel";
import { ClaimEvidence } from "./ClaimEvidence";
import type { DecisionRequest } from "@/lib/review-contracts";
import { CommunicationHistory } from "./CommunicationHistory";
import styles from "./panels.module.css";

const message = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";
const neutralRejectionMessage = "Your reimbursement request was not approved after review. Please contact your reviewer if you need clarification.";
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "";

interface JustificationView {
  summary: string;
  reasons: string[];
  next_step: string;
  model: string;
  simulated: boolean;
  error: string | null;
}

/** Narrative stored with the run; it restates the outcome and never sets it. */
function justificationOf(decisions: ReviewRow["decisions"]): JustificationView | null {
  const evidence = decisions.find((decision) => decision.field_checked === "overall_status")?.evidence_json;
  const value = typeof evidence === "object" && evidence !== null
    ? (evidence as { justification?: unknown }).justification
    : null;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<JustificationView>;
  if (typeof candidate.summary !== "string" || typeof candidate.next_step !== "string" || !Array.isArray(candidate.reasons)) return null;
  return {
    summary: candidate.summary,
    reasons: candidate.reasons.filter((reason): reason is string => typeof reason === "string"),
    next_step: candidate.next_step,
    model: typeof candidate.model === "string" ? candidate.model : "unknown",
    simulated: candidate.simulated !== false,
    error: typeof candidate.error === "string" ? candidate.error : null,
  };
}

function JustificationPanel({ decisions }: { decisions: ReviewRow["decisions"] }) {
  const justification = justificationOf(decisions);
  if (!justification) return null;
  return <section aria-labelledby="justification-title" className="space-y-3 text-sm leading-6">
    <h3 id="justification-title" className="font-semibold">Recorded explanation</h3>
    <p>{justification.summary}</p>
    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
      {justification.reasons.map((reason) => <li key={reason}>{reason}</li>)}
    </ul>
    <p>{justification.next_step}</p>
    <p className="text-xs text-muted-foreground">
      {justification.simulated ? "Deterministic summary" : `Written by ${justification.model}`}
      {justification.error ? ` · model unavailable (${justification.error}), outcome unchanged` : ""}
    </p>
  </section>;
}

export function ReviewSheet(props: ReviewSheetProps) {
  const origin = useRef<HTMLElement | null>(null);
  const [closingRow, setClosingRow] = useState(props.row);
  if (props.row && props.row !== closingRow) setClosingRow(props.row);
  const visibleRow = props.row ?? (props.open ? null : closingRow);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={styles.sheet} showCloseButton={false}
        onOpenAutoFocus={(event) => {
          origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          document.querySelector<HTMLElement>("[data-claim-heading]")?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (origin.current?.isConnected) origin.current.focus();
          else document.querySelector<HTMLElement>("[data-review-focus-fallback]")?.focus();
        }}>
        {visibleRow ? <ReviewContent key={visibleRow.id} {...props} row={visibleRow} /> : <DialogHeader className="p-5"><DialogTitle>Claim unavailable</DialogTitle><DialogDescription>Close this review and refresh the queue.</DialogDescription><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogHeader>}
      </DialogContent>
    </Dialog>
  );
}

function ReviewContent({ row: incoming, rows, client, knowledgeRevision, simulatedEnvironment, capabilities, onChanged, onDecisionSaved, queueRemaining, queueProgress, onOpenRules, onOpenChange, onOpenClaim, backId, onBack }: ReviewSheetProps & { row: ReviewRow }) {
  const [updated, setUpdated] = useState<ReviewRow | null>(null);
  const row = updated && updated.review_revision > incoming.review_revision ? updated : incoming;
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [decisionRevision, setDecisionRevision] = useState(0);
  const [decisionKnowledgeRevision, setDecisionKnowledgeRevision] = useState(knowledgeRevision);
  const [note, setNote] = useState("");
  const [applicantMessage, setApplicantMessage] = useState("");
  const [noteVerdict, setNoteVerdict] = useState<"approved" | "rejected" | null>(null);
  const [canonical, setCanonical] = useState("");
  const [busy, setBusy] = useState<"decision" | "retry" | "recheck" | "proposal" | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [shownInvestigation, setShownInvestigation] = useState<InvestigationRun | null>(incoming.latest_investigation ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [communicationRefresh, setCommunicationRefresh] = useState(0);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [uncertainDecision, setUncertainDecision] = useState(false);
  const pendingDecision = useRef<DecisionRequest | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [savingVerdict, setSavingVerdict] = useState<"approved" | "rejected" | null>(null);
  const decisionOrigin = useRef<HTMLButtonElement | null>(null);
  const mutationLock = useRef(false);
  const evidenceLock = useRef(false);
  const onEvidenceBusyChange = useCallback((value: boolean) => { evidenceLock.current = value; setEvidenceBusy(value); }, []);
  const actionsBusy = !!busy || uncertainDecision || evidenceBusy || (capabilities?.investigations === true && shownInvestigation?.status === "running");
  const parsed = row.receipt?.parsed_fields_json;
  const receiptUrl = client.receiptUrl(row);
  const checks = machineChecks(row);
  const humanCheck = row.decisions.findLast((check) => check.check_method === "human");
  const blocked = approvalBlock(row, knowledgeRevision, rows, capabilities?.knowledge_revisions === true);
  const stale = capabilities?.knowledge_revisions === true && !!row.assessment_status && !!row.latest_run_id && row.assessment_knowledge_revision !== knowledgeRevision;
  const automatic = row.decision_source === "automatic";
  const merchantException = row.decision_status === "approved" && !automatic && !!parsed?.vendor?.trim() && row.receipt?.extraction_status === "succeeded";
  const approvalReason = decisionReason(row, "approved", knowledgeRevision, rows, capabilities?.knowledge_revisions === true);
  const rejectionReason = decisionReason(row, "rejected", knowledgeRevision, rows, capabilities?.knowledge_revisions === true);
  const running = busy === "retry" || (row.processing_status === "running" && row.receipt?.extraction_status === "pending") ? "Reading the receipt…"
    : shownInvestigation?.status === "running" ? "Investigating this claim…"
    : busy === "recheck" || row.processing_status === "running" ? "Checking this claim…" : null;
  const savedVerdict = !running && !automatic && row.decision_status !== "pending" ? row.decision_status : null;
  const primaryConcern = checks.find(check => check.verdict === "fail");
  const facts = checkFacts(row, knowledgeRevision, capabilities?.knowledge_revisions === true, !!running);
  const failedFact = facts.find(fact => fact.verdict === "fail");
  const unresolvedFact = facts.find(fact => fact.verdict === "unknown");
  const concernFact = failedFact ?? unresolvedFact;
  const currentFailure = !running && !stale && (failedFact || primaryConcern?.verdict === "fail" || row.processing_status === "failed");
  const finding = running ? "Checks are in progress. Previous results are labeled below."
    : stale ? "These saved checks do not have the current policy version. Recheck to get current results."
    : row.receipt?.extraction_status !== "succeeded" ? "The receipt could not be verified. Review the original document and try reading it again."
    : concernFact ? `${concernFact.observed}. ${concernFact.reason}`
    : primaryConcern ? "A saved receipt check failed. Review the original document and recheck."
    : row.decision_status !== "pending" ? "The receipt checks are recorded below with the saved decision."
    : blocked ? blocked : "The receipt and required checks passed. This claim is ready for your decision.";
  const findingTitle = running || (row.processing_status === "failed" ? "Check could not finish"
    : row.receipt?.extraction_status !== "succeeded" ? "Receipt needs attention"
    : stale ? "Recheck needed"
    : concernFact ? `${concernFact.label} ${concernFact.verdict === "fail" ? "failed" : "is inconclusive"}`
    : primaryConcern ? "Receipt check failed"
    : row.decision_status !== "pending" ? "Saved decision"
    : blocked ? "Review before approving" : "Checks passed");
  const advance = !!onDecisionSaved && (queueRemaining ?? 0) > 1;
  const outcome = row.decision_status !== "pending"
    ? automatic && row.decision_status === "approved" ? "Automatically approved" : `${row.decision_status === "approved" ? "Approved" : "Rejected"} by reviewer`
    : row.processing_status === "running" ? "Checking this claim…"
    : stale ? "Recheck this claim after the policy change."
    : approvalReason ? "Ready for approval."
    : rejectionReason ? "Review the issue before deciding."
    : row.receipt?.extraction_status !== "succeeded" ? "The receipt needs another look."
    : "Confirm the unresolved details.";
  const section = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      section.current?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [incoming.id]);
  const simulation = client.mode === "preview" || row.investigation?.mode === "simulated" || checks.some((check) => check.evidence_json.simulated === true);
  const emailEnabled = capabilities?.automatic_decision_emails === true;
  const reasonLimit = 2000;
  const changedDuringDecision = decision !== null && (decisionRevision !== row.review_revision || decisionKnowledgeRevision !== knowledgeRevision || row.processing_status === "running" || evidenceBusy);

  async function refresh(savedDecision = false) {
    try { await onChanged(); return true; }
    catch (failure) {
      setError(`${savedDecision ? "Your decision was saved, but the queue could not refresh. Refresh the queue before continuing." : "The queue could not refresh."} ${message(failure)}`);
      return false;
    }
  }

  async function fail(failure: unknown) {
    const staleError = ["STALE_REVIEW", "STALE_ASSESSMENT"].includes(code(failure));
    setError(staleError ? `${message(failure)} Review the updated claim before trying again. Your note is preserved.` : message(failure));
    setDecision(null);
    try { await onChanged(); } catch { /* Keep the original error and entered note; never repeat a write. */ }
  }

  function chooseDecision(verdict: "approved" | "rejected", origin: HTMLButtonElement, edit = false) {
    if (mutationLock.current || evidenceLock.current || actionsBusy || row.processing_status === "running" || row.decision_status === verdict || (verdict === "approved" && blocked)) return;
    decisionOrigin.current = origin;
    setError(null);
    const suggestion = verdict === "approved" ? approvalReason : rejectionReason;
    const hasDraft = noteVerdict === verdict && !!note.trim();
    if (suggestion && !edit && !hasDraft) { void saveDecision(verdict, suggestion, row.review_revision); return; }
    if (!hasDraft) {
      setNote(suggestion ?? "");
      setApplicantMessage(verdict === "rejected" ? suggestion ?? neutralRejectionMessage : "");
    }
    setNoteVerdict(verdict);
    setDecisionRevision(row.review_revision);
    setDecisionKnowledgeRevision(knowledgeRevision);
    setDecision(verdict);
  }

  async function saveDecision(verdict = decision, reason = note, revision = decisionRevision) {
    const retained = uncertainDecision ? pendingDecision.current : null;
    if (mutationLock.current || evidenceLock.current || busy) return;
    if (!retained && (!verdict || !reason.trim() || reason.length > reasonLimit || revision !== row.review_revision || actionsBusy || row.processing_status === "running" || changedDuringDecision || (verdict === "approved" && blocked))) return;
    const request = retained ?? {
      submission_id: row.id, expected_review_revision: revision, human_verdict: verdict!, human_note: reason.trim(),
      correction_type: "decision_override" as const, correction_payload_json: {}, request_id: crypto.randomUUID(),
      ...(emailEnabled && verdict === "rejected" && decision === "rejected" ? { applicant_reason: applicantMessage.trim() || neutralRejectionMessage } : {}),
    };
    pendingDecision.current = request;
    mutationLock.current = true;
    setBusy("decision"); setSavingVerdict(request.human_verdict); setError(null); setNotice(null); setEmailNotice(null);
    try {
      const result = await client.decide(request);
      pendingDecision.current = null; setUncertainDecision(false);
      if (!result.row) {
        setDecision(null); setSavingVerdict(null);
        setNotice("Decision saved.");
        setError("The updated claim could not be loaded. Refresh the claim and its applicant communication before continuing.");
        await refresh(true);
        return;
      }
      setUpdated(result.row); setDecision(null); setNote(""); setApplicantMessage(""); setNoteVerdict(null); setSavingVerdict(null);
      setCommunicationRefresh(value => value + 1);
      const status = result.message?.status;
      const notification = status === "previewed" ? "Email simulated" : status === "accepted" ? "Email accepted for delivery"
        : status === "queued" || status === "sending" ? "Email queued" : null;
      const deliveryProblem = result.email_error || (status === "failed" ? "Email failed."
        : status === "delivery_unknown" ? "Email delivery outcome is unknown."
        : status && !notification ? "Email was not queued." : emailEnabled && !result.message ? "Email status is unavailable." : null);
      setNotice(result.row.decision_status === "approved" ? "Approval saved. No payment was made." : "Rejection saved.");
      setEmailNotice(notification);
      if (deliveryProblem) setError(`Decision saved. ${deliveryProblem} Review Applicant communication before retrying email.`);
      if (!deliveryProblem && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise<void>(resolve => window.setTimeout(resolve, notification ? 750 : 350));
      }
      if (await refresh(true) && !deliveryProblem) {
        try { await onDecisionSaved?.(result.row); }
        catch (failure) { setError(`Your decision was saved, but the next claim could not open. ${message(failure)}`); }
      }
    } catch (failure) {
      const rejected = ["STALE_REVIEW", "STALE_ASSESSMENT", "APPROVAL_BLOCKED", "DUPLICATE_BLOCKED", "RECIPIENT_NOT_ALLOWED", "EMAIL_UNAVAILABLE", "INVALID_INPUT", "INVALID_BODY", "COMMUNICATION_IN_FLIGHT", "MESSAGE_CONFLICT"].includes(code(failure));
      if (rejected) pendingDecision.current = null;
      setUncertainDecision(!rejected);
      await fail(failure);
      if (!rejected) setError(`The response is uncertain; this decision may already be saved. Retry the same decision to check its result safely. ${message(failure)}`);
    }
    finally { mutationLock.current = false; setBusy(null); setSavingVerdict(null); }
  }

  async function recheckOrRetry(action: "recheck" | "retry") {
    if (mutationLock.current || evidenceLock.current || actionsBusy || row.processing_status === "running" || (action === "retry" && (!capabilities?.extraction_retry || row.decision_status !== "pending"))) return;
    mutationLock.current = true;
    setBusy(action); setError(null); setNotice(null); setEmailNotice(null);
    try {
      if (action === "retry") {
        const result = await client.retryExtraction(row.id, row.review_revision);
        setUpdated(result.row);
        if (result.row.receipt?.extraction_status === "succeeded") setNotice(capabilities?.automatic_processing ? "Receipt reparsed. Checks will run automatically." : "Receipt reparsed. Recheck this claim to assess the new evidence.");
        else setError(result.row.receipt?.extraction_error || "Extraction did not succeed. The original receipt is retained.");
      } else {
        const result = await client.reconcile({ submission_ids: [row.id] });
        const item = result.results.find((entry) => entry.submission_id === row.id);
        if (!item || item.error) setError(item?.error || "The server did not return a result for this claim.");
        else setNotice("Recheck finished.");
      }
      await refresh();
    } catch (failure) { await fail(failure); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  async function propose() {
    if (!capabilities?.rule_learning || !merchantException || !canonical.trim() || canonical.trim().length > 120 || normalize(canonical) === normalize(parsed?.vendor || "") || mutationLock.current || evidenceLock.current || actionsBusy || row.processing_status === "running") return;
    mutationLock.current = true;
    setBusy("proposal"); setError(null);
    try {
      await client.proposeRule({ submission_id: row.id, expected_review_revision: row.review_revision, canonical_vendor: canonical.trim() });
      await refresh();
      onOpenChange(false); onOpenRules();
    } catch (failure) { await fail(failure); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  const tone = row.decision_status !== "pending" ? row.decision_status : currentFailure ? "rejected"
    : running || concernFact || blocked || stale ? "review" : "neutral";
  return <div className={styles.review} data-tone={tone}>
    <DialogHeader className={`${styles.reviewHeader} shrink-0 gap-3 border-b px-5 py-4`}>
      {backId && <Button variant="ghost" className="self-start" onClick={onBack}>Back to {rows.find(r => r.id === backId)?.attendee_name || "previous claim"}</Button>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><DialogTitle ref={heading} tabIndex={-1} data-claim-heading className="text-lg outline-none">{row.attendee_name}</DialogTitle><DialogDescription className="mt-1 break-words">{statusLabel(row.category)} · {formatDate(row.submitted_at)}</DialogDescription></div>
        <div className="flex items-center gap-3"><span className="text-lg font-semibold tabular-nums">{money(row.amount_requested_minor, row.currency)}</span><DialogClose asChild><Button aria-label="Close review" size="icon" variant="ghost"><X /></Button></DialogClose></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${styles.decisionStatus} text-sm font-medium`} data-decision={row.decision_status} role="status">{row.decision_status === "pending" && queueRemaining !== undefined ? `${queueRemaining} ${queueRemaining === 1 ? "claim" : "claims"} left to review` : outcome}</p>
        {simulation && <Badge variant="outline" className="rounded">{row.decisions.some(check => check.evidence_json.demo_baseline === true) ? "Prepared demo history" : client.mode === "preview" ? "Preview" : "Simulated checks"}</Badge>}
      </div>
      {queueProgress && queueProgress.total > 0 && <div className={styles.queueProgress}>
        <label htmlFor="review-queue-progress" className="text-xs text-muted-foreground">{queueProgress.completed} of {queueProgress.total} reviewed</label>
        <progress id="review-queue-progress" max={queueProgress.total} value={queueProgress.completed} />
      </div>}
    </DialogHeader>

    <Tabs defaultValue="details" className={styles.body}>
      <TabsList variant="line" aria-label="Receipt review" className="mx-4 my-2 shrink-0 min-[1024px]:hidden"><TabsTrigger value="document">Document</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList>
      <div className={styles.columns}>
        <TabsContent value="document" forceMount className={styles.document}>
          <div className="mb-4 flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><FileText className="size-4" aria-hidden="true" />Original receipt</span>{receiptUrl && <Button asChild variant="outline" size="sm"><a href={receiptUrl} target="_blank" rel="noreferrer">Open original<ArrowUpRight /></a></Button>}</div>
          {!receiptUrl ? <p className="text-sm text-muted-foreground">No original receipt is available.</p> : row.receipt?.file_type === "application/pdf" ? <object data={receiptUrl} type="application/pdf" aria-label={`Original receipt for ${row.attendee_name}`} className={styles.pdf}><p>Preview unavailable. <a href={receiptUrl} target="_blank" rel="noreferrer" className="underline">Open the original receipt</a>.</p></object> : imageFailed ? <p className="text-sm text-muted-foreground">The preview could not load. Use Open original to view the retained document.</p> : <>{!imageLoaded && <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />Loading receipt preview…</p>}<img src={receiptUrl} alt={`Original receipt for ${row.attendee_name}`} className={styles.receipt} onLoad={() => setImageLoaded(true)} onError={() => setImageFailed(true)} /></>}
          {client.mode === "preview" && <p className="mt-3 text-xs text-muted-foreground">Synthetic receipt for this preview.</p>}
        </TabsContent>

        <TabsContent value="details" forceMount ref={section} className={`${styles.evidence} space-y-6`}>
          <section aria-labelledby="finding-title" data-decision={savedVerdict ?? "pending"} className={`${styles.finding} ${running ? styles.findingRunning : savedVerdict === "approved" ? styles.findingPassed : savedVerdict === "rejected" || currentFailure ? styles.findingFailed : concernFact || blocked || stale ? styles.findingReview : styles.findingPassed}`}>
            <div className={styles.findingHeading}>{running ? <LoaderCircle aria-hidden="true" className="size-5 shrink-0 motion-safe:animate-spin" /> : savedVerdict === "rejected" ? <X aria-hidden="true" className="size-5 shrink-0" /> : savedVerdict === "approved" ? <Check aria-hidden="true" className="size-5 shrink-0" /> : concernFact || blocked ? <TriangleAlert aria-hidden="true" className="size-5 shrink-0" /> : <Check aria-hidden="true" className="size-5 shrink-0" />}<h3 id="finding-title" className="font-semibold" role={running || savedVerdict ? "status" : undefined}>{savedVerdict ? outcome : findingTitle}</h3></div>
            <p className={`mt-2 text-sm leading-6 ${savedVerdict && currentFailure ? "text-destructive" : savedVerdict && (concernFact || blocked || stale) ? "text-[var(--status-review)]" : ""}`}>{finding}</p>
            {row.receipt?.extraction_status !== "succeeded" && row.receipt && capabilities?.extraction_retry && <Button className="mt-3" variant="outline" disabled={actionsBusy || row.processing_status === "running" || row.decision_status !== "pending"} aria-busy={busy === "retry"} onClick={() => void recheckOrRetry("retry")}><RotateCw aria-hidden="true" className={busy === "retry" ? "motion-safe:animate-spin" : undefined} />{busy === "retry" ? "Reading…" : "Read receipt again"}</Button>}
            {stale && <Button className="mt-3" variant="outline" disabled={actionsBusy || row.processing_status === "running" || row.receipt?.extraction_status !== "succeeded"} onClick={() => void recheckOrRetry("recheck")}><RotateCw aria-hidden="true" />Recheck claim</Button>}
          </section>

          <LearningStatus row={row} onRetry={client.retryLearning ? async () => { const result = await client.retryLearning!(row.id, row.review_revision); setUpdated(result.row); await onChanged(); } : undefined} />

          <section aria-labelledby="receipt-checks-title">
            <h3 id="receipt-checks-title" className="mb-3 font-semibold">Receipt checks</h3>
            <ul className={styles.facts}>
              {facts.map(fact => <li key={fact.field} className={styles.fact} data-check={fact.field} data-verdict={fact.verdict}>
                <div className={styles.factHeading}><h4>{fact.label}</h4><span className={styles.factStatus}>
                  {fact.verdict === "pass" ? <Check aria-hidden="true" /> : fact.verdict === "fail" ? <X aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
                  {fact.verdict === "pass" ? "Pass" : fact.verdict === "fail" ? "Fail" : "Inconclusive"}
                </span></div>
                <p className={styles.factObserved}>{fact.observed}</p>
                {fact.verdict !== "pass" && <p className={styles.factReason}>{fact.reason}</p>}
                {fact.field === "duplicate" && capabilities?.duplicate_links && row.duplicate_submission_ids.length > 0 && <div data-review-section="duplicates" className="mt-2 space-y-2">{row.duplicate_submission_ids.map(id => {
                  const prior = rows.find(other => other.id === id);
                  return prior ? <Button key={id} variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left" onClick={() => onOpenClaim(id)}>Compare {prior.attendee_name} · {money(prior.amount_requested_minor, prior.currency)} · {statusLabel(prior.decision_status)}</Button> : <p key={id} className="break-all text-sm">Claim {id} is not loaded. Refresh the queue to compare it.</p>;
                })}</div>}
              </li>)}
            </ul>
          </section>

          <details className="text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">Claim metadata</summary>
            <div className="mt-3 space-y-2 break-words text-xs text-muted-foreground"><p>Origin: {row.origin_location || "—"}</p><p className="break-all">{row.email}</p><p>Submitted: {formatDate(row.submitted_at)}</p>{parsed?.receipt_number && <p>Receipt {parsed.receipt_number}</p>}<p className="break-all">Claim {row.id}</p></div>
          </details>

          {automatic && row.decision_status === "approved" ? <section data-review-section="human-decision" className="text-sm text-muted-foreground">This claim was automatically approved using the checks saved at that time.</section> : humanCheck && <section data-review-section="human-decision"><h3 className="mb-2 font-semibold">Decision reason</h3><p className="text-sm leading-6 text-muted-foreground">{humanCheck.rationale_text}</p></section>}

          {row.investigation && !(capabilities?.investigations === true && shownInvestigation) && <details className="text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">Investigation details</summary><p className="mt-2 leading-6">{row.investigation.summary || "The investigation did not return a summary."}</p>{row.investigation.status === "unavailable" && <p className="mt-2 text-xs text-destructive">Investigation unavailable. Review the receipt and checks directly.</p>}<ol className="mt-3 space-y-3 text-xs">{row.investigation.steps.map((step, index) => <li key={`${step.tool}-${index}`}><p className="font-medium">{statusLabel(step.tool)}</p><p className="mt-1 leading-5 text-muted-foreground">{step.summary}</p><p className="mt-1 break-all text-muted-foreground">{step.evidence_refs.join(", ")}</p></li>)}</ol></details>}

          <ClaimEvidence row={row} rows={rows} client={client} capabilities={capabilities} knowledgeRevision={knowledgeRevision} simulatedEnvironment={simulatedEnvironment} busy={!!busy} onBusyChange={onEvidenceBusyChange} onRunChange={setShownInvestigation} onRowChange={setUpdated} onChanged={onChanged} onOpenClaim={onOpenClaim} />
          {client.getMessages && <CommunicationHistory claimId={row.id} client={client} revision={row.review_revision + communicationRefresh} />}

          {capabilities?.rule_learning && merchantException && <details className="border-t pt-3 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">Remember this merchant name</summary><p className="mt-2 text-muted-foreground">Link {parsed?.vendor} to its full name for future {row.category} claims. Test the draft before using it.</p><form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void propose(); }}><Label htmlFor="canonical-vendor">Full merchant name</Label><Input id="canonical-vendor" value={canonical} onChange={(event) => setCanonical(event.target.value)} maxLength={120} required disabled={actionsBusy} placeholder="Full merchant name" /><Button type="submit" variant="outline" size="lg" aria-busy={busy === "proposal"} disabled={actionsBusy || !canonical.trim() || canonical.trim().length > 120 || normalize(canonical) === normalize(parsed?.vendor || "")}>{busy === "proposal" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy === "proposal" ? "Saving draft…" : "Create draft rule"}</Button></form></details>}

          <details className="border-t pt-3 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">Check details</summary>
            <div className="mt-3 space-y-4">
              <Button variant="outline" size="sm" disabled={actionsBusy || row.processing_status === "running" || row.receipt?.extraction_status !== "succeeded"} aria-busy={busy === "recheck"} onClick={() => void recheckOrRetry("recheck")}><RotateCw aria-hidden="true" className={busy === "recheck" ? "motion-safe:animate-spin" : undefined} />{busy === "recheck" ? "Rechecking…" : "Recheck claim"}</Button>
              <JustificationPanel decisions={row.decisions} />
              <details className="text-xs"><summary className="cursor-pointer py-2 text-muted-foreground">Technical evidence</summary><p className="my-3 break-all text-muted-foreground">Claim {row.id}</p><p className="my-3 text-muted-foreground">Extraction: {row.receipt?.extraction_provenance || "Not recorded"}</p>{row.receipt?.extraction_error && <p className="my-3 text-destructive">{row.receipt.extraction_error}</p>}<p className="my-3 text-muted-foreground">Revision {row.review_revision} · Rule set {row.assessment_knowledge_revision ?? "not assessed"}. Provider probabilities are not calibrated accuracy.</p><pre className={styles.json}>{JSON.stringify({ checks: row.decisions, investigation: row.investigation }, null, 2)}</pre></details>
            </div>
          </details>
        </TabsContent>
      </div>
    </Tabs>

    <footer className={`${styles.reviewFooter} shrink-0 space-y-3 border-t px-5 py-4`}>
      {error && <p role="alert" className="motion-enter text-sm text-destructive">{error}</p>}
      {notice && <div role="status" data-decision={row.decision_status} className={`${styles.decisionStatus} ${styles.savedNotice}`}>
        {emailNotice && <Send aria-hidden="true" className={styles.noticePlane} />}
        <div><p>{notice}</p>{emailNotice && <p className="font-medium">{emailNotice}</p>}</div>
      </div>}
      {uncertainDecision && <Button variant="outline" disabled={!!busy || evidenceBusy} onClick={() => void saveDecision()}>Retry same decision</Button>}
      {(rejectionReason || approvalReason) && <div className={styles.decisionReason}>
        <details className="min-w-0 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">{rejectionReason ? "Suggested rejection reason" : "Approval reason"}</summary><p className="mt-1">{rejectionReason || approvalReason}</p></details>
        <Button variant="ghost" size="sm" disabled={actionsBusy} onClick={(event) => chooseDecision(rejectionReason ? "rejected" : "approved", event.currentTarget, true)}>Edit reason</Button>
      </div>}
      {!emailEnabled && capabilities?.email_error && <p className="text-xs text-muted-foreground">Applicant email is unavailable: {capabilities.email_error}. Decisions can still be recorded without email.</p>}
      {blocked && row.decision_status !== "approved" && <p id="approval-blocked" className="text-xs text-muted-foreground">{blocked}</p>}
      <div className={styles.decisionActions}>
        <Button variant="destructive" size="lg" disabled={actionsBusy || row.processing_status === "running" || row.decision_status === "rejected"} aria-busy={busy === "decision"} onClick={(event) => chooseDecision("rejected", event.currentTarget)}>{savingVerdict === "rejected" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{savingVerdict === "rejected" ? (emailEnabled ? "Saving & notifying…" : "Saving rejection…") : row.decision_status === "rejected" ? "Rejected" : emailEnabled ? "Reject & notify" : advance ? "Reject and next" : "Reject claim"}</Button>
        <Button variant="success" size="lg" aria-describedby={blocked && row.decision_status !== "approved" ? "approval-blocked" : undefined} aria-busy={busy === "decision"} disabled={actionsBusy || !!blocked || row.decision_status === "approved"} onClick={(event) => chooseDecision("approved", event.currentTarget)}>{savingVerdict === "approved" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{savingVerdict === "approved" ? (emailEnabled ? "Saving & notifying…" : "Saving approval…") : row.decision_status === "approved" ? "Approved" : emailEnabled ? "Approve & notify" : advance ? "Approve and next" : "Approve claim"}</Button>
      </div>
    </footer>

    <Dialog open={decision !== null} onOpenChange={(open) => { if (!open && busy !== "decision") setDecision(null); }}>
      <DialogContent className={styles.confirmation} showCloseButton={busy !== "decision"} onCloseAutoFocus={(event) => { event.preventDefault(); decisionOrigin.current?.focus(); }}>
        <DialogHeader><DialogTitle>{decision === "approved" ? "Approve reimbursement" : "Reject reimbursement"}</DialogTitle><DialogDescription>{row.decision_status !== "pending" ? "Why are you changing this decision?" : (decision === "approved" ? approvalReason : rejectionReason) ? "This reason will be saved with your decision." : decision === "approved" ? "What confirms that the unresolved details are acceptable?" : "Why should this claim be rejected?"}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void saveDecision(); }} className="space-y-4"><div className="space-y-2"><Label htmlFor="decision-reason">Internal review reason</Label><Textarea id="decision-reason" value={note} onChange={(event) => setNote(event.target.value)} required maxLength={reasonLimit} aria-describedby="internal-reason-help" rows={3} disabled={actionsBusy} placeholder="What evidence supports your decision?" /><p id="internal-reason-help" className="text-xs text-muted-foreground">Saved with your review and checked for reusable learning. Not included in applicant emails.</p></div>{emailEnabled && decision === "rejected" && <details className="space-y-2 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">Applicant message (optional)</summary><Label htmlFor="applicant-message">Message to the applicant</Label><Textarea id="applicant-message" value={applicantMessage} onChange={event => setApplicantMessage(event.target.value)} maxLength={1500} rows={3} disabled={actionsBusy} /><p className="text-xs text-muted-foreground">Only this message is shared. Leave it blank to use the standard rejection notice.</p></details>}{changedDuringDecision && <p role="alert" className="motion-enter text-sm text-[var(--status-review)]">This claim changed. Review the updated evidence before deciding. Your note is kept.</p>}{error && <p role="alert" className="motion-enter text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy === "decision"} onClick={() => setDecision(null)}>{changedDuringDecision ? "Review updated claim" : "Cancel"}</Button><Button type="submit" variant={decision === "rejected" ? "destructive" : "success"} size="lg" aria-busy={busy === "decision"} disabled={actionsBusy || !note.trim() || note.length > reasonLimit || changedDuringDecision || (decision === "approved" && !!blocked)}>{busy === "decision" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy === "decision" ? (emailEnabled ? "Saving & notifying…" : "Saving…") : emailEnabled ? (decision === "approved" ? "Approve & notify" : "Reject & notify") : decision === "approved" ? "Confirm approval" : "Confirm rejection"}</Button></DialogFooter></form>
      </DialogContent>
    </Dialog>
  </div>;
}
