"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, Check, FileText, LoaderCircle, RotateCw, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, money, statusLabel } from "@/lib/dashboard/helpers";
import type { ReviewSheetProps } from "@/lib/dashboard/ui-contracts";
import type { ReviewRow } from "@/lib/review-contracts";
import { AssessmentBadge, DecisionBadge } from "./ReviewStatus";
import styles from "./panels.module.css";

const financialFields = ["currency", "amount", "policy", "receipt_date", "policy_cap"];
const fieldLabels: Record<string, string> = {
  currency: "Currency", amount: "Amount", policy: "Policy coverage", receipt_date: "Receipt date",
  policy_cap: "Policy limit", merchant: "Merchant", name: "Traveler", duplicate: "Duplicate receipt",
  exact_duplicate: "Same document", extraction: "Receipt extraction",
};
const message = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "";
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

function approvalBlock(row: ReviewRow, knowledgeRevision: number, rows: ReviewRow[]) {
  if (row.processing_status === "running") return "Wait for the current check to finish before approving.";
  if (row.receipt?.extraction_status !== "succeeded") return "Extract the original receipt and recheck before approving.";
  if (!row.assessment_status || !row.latest_run_id) return "Recheck this claim before approving.";
  if (row.assessment_knowledge_revision !== knowledgeRevision) return "Rules changed — recheck before approving.";
  const checks = row.decisions.filter((check) => check.check_method !== "human" && check.field_checked !== "overall_status");
  const incomplete = financialFields.find((field) => !checks.some((check) => check.field_checked === field && check.verdict === "pass"));
  if (incomplete) return `${fieldLabels[incomplete]} must pass before approval.`;
  if (!checks.some((check) => check.field_checked === "duplicate" && check.verdict === "pass") || checks.some((check) => check.field_checked.includes("duplicate") && check.verdict !== "pass")) {
    return "Resolve the duplicate receipt check before approving.";
  }
  if (checks.some((check) => financialFields.includes(check.field_checked) && check.verdict !== "pass")) return "Financial checks must pass before approval.";
  if (row.receipt.sha256 && rows.some((other) => other.id !== row.id && other.decision_status === "approved" && other.receipt?.sha256 === row.receipt?.sha256)) return "Another approved claim uses the same receipt.";
  return null;
}

export function ReviewSheet(props: ReviewSheetProps) {
  const origin = useRef<HTMLElement | null>(null);
  const [closingRow, setClosingRow] = useState(props.row);
  if (props.row && props.row !== closingRow) setClosingRow(props.row);
  const visibleRow = props.row ?? (props.open ? null : closingRow);
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={styles.sheet} showCloseButton={false}
        onOpenAutoFocus={() => { origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (origin.current?.isConnected) origin.current.focus();
          else document.querySelector<HTMLElement>("[data-review-focus-fallback]")?.focus();
        }}>
        {visibleRow ? <ReviewContent key={visibleRow.id} {...props} row={visibleRow} /> : <SheetHeader><SheetTitle>Claim unavailable</SheetTitle><SheetDescription>Close this review and refresh the queue.</SheetDescription><SheetClose asChild><Button variant="outline">Close</Button></SheetClose></SheetHeader>}
      </SheetContent>
    </Sheet>
  );
}

function ReviewContent({ row: incoming, rows, client, knowledgeRevision, onChanged, onOpenRules, onOpenChange }: ReviewSheetProps & { row: ReviewRow }) {
  const [updated, setUpdated] = useState<ReviewRow | null>(null);
  const row = updated && updated.review_revision >= incoming.review_revision ? updated : incoming;
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [decisionRevision, setDecisionRevision] = useState(0);
  const [note, setNote] = useState("");
  const [canonical, setCanonical] = useState("");
  const [busy, setBusy] = useState<"decision" | "retry" | "recheck" | "proposal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const decisionOrigin = useRef<HTMLButtonElement | null>(null);
  const mutationLock = useRef(false);
  const parsed = row.receipt?.parsed_fields_json;
  const receiptUrl = client.receiptUrl(row);
  const checks = row.decisions.filter((check) => check.field_checked !== "overall_status" && check.check_method !== "human");
  const humanCheck = row.decisions.findLast((check) => check.check_method === "human");
  const blocked = approvalBlock(row, knowledgeRevision, rows);
  const stale = row.assessment_status !== null && row.assessment_knowledge_revision !== knowledgeRevision;
  const difference = parsed?.amount_minor != null && parsed.currency === row.currency ? row.amount_requested_minor - parsed.amount_minor : null;
  const duplicateNames = row.duplicate_submission_ids.map((id) => rows.find((other) => other.id === id)?.attendee_name || `claim ${id.slice(0, 8)}`);
  const merchantException = row.decision_status === "approved" && !blocked && !!parsed?.vendor?.trim()
    && checks.some((check) => check.field_checked === "merchant" && check.verdict === "unknown")
    && checks.every((check) => check.field_checked === "merchant" ? check.verdict === "unknown" : check.verdict === "pass");
  const simulation = client.mode === "preview" || row.investigation?.mode === "simulated" || checks.some((check) => check.evidence_json.simulated === true);
  const changedDuringDecision = decision !== null && decisionRevision !== row.review_revision;

  async function refresh() {
    try { await onChanged(); }
    catch (failure) { setError(`The change was saved, but the queue could not refresh. ${message(failure)}`); }
  }

  async function fail(failure: unknown) {
    const staleError = ["STALE_REVIEW", "STALE_ASSESSMENT"].includes(code(failure));
    setError(staleError ? `${message(failure)} Review the updated claim before trying again. Your note is preserved.` : message(failure));
    if (staleError) {
      setDecision(null);
      try { await onChanged(); } catch { /* Keep the original error and entered note. */ }
    }
  }

  async function saveDecision() {
    if (!decision || !note.trim() || mutationLock.current || changedDuringDecision || (decision === "approved" && blocked)) return;
    mutationLock.current = true;
    setBusy("decision"); setError(null); setNotice(null);
    try {
      const result = await client.decide({ submission_id: row.id, expected_review_revision: decisionRevision, human_verdict: decision, human_note: note.trim(), correction_type: "decision_override", correction_payload_json: {} });
      setUpdated(result.row); setDecision(null); setNote("");
      setNotice(result.row.decision_status === "approved" ? "Approved for reimbursement. No payment was made." : "Rejection recorded.");
      await refresh();
    } catch (failure) { await fail(failure); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  async function recheckOrRetry(action: "recheck" | "retry") {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(action); setError(null); setNotice(null);
    try {
      if (action === "retry") {
        const result = await client.retryExtraction(row.id, row.review_revision);
        setUpdated(result.row);
        if (result.row.receipt?.extraction_status === "succeeded") setNotice("Receipt extracted. Recheck this claim to assess the new evidence.");
        else setError(result.row.receipt?.extraction_error || "Extraction did not succeed. The original receipt is retained.");
      } else {
        const result = await client.reconcile({ submission_ids: [row.id] });
        const item = result.results.find((entry) => entry.submission_id === row.id);
        if (!item || item.error) setError(item?.error || "The server did not return a result for this claim.");
        else setNotice("Recheck finished. The human decision is preserved.");
      }
      await refresh();
    } catch (failure) { await fail(failure); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  async function propose() {
    if (!merchantException || !canonical.trim() || normalize(canonical) === normalize(parsed?.vendor || "") || mutationLock.current) return;
    mutationLock.current = true;
    setBusy("proposal"); setError(null);
    try {
      await client.proposeRule({ submission_id: row.id, expected_review_revision: row.review_revision, canonical_vendor: canonical.trim() });
      await refresh();
      onOpenChange(false); onOpenRules();
    } catch (failure) { await fail(failure); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  return <>
    <SheetHeader className="shrink-0 gap-3 border-b px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><SheetTitle className="text-lg">{row.attendee_name}</SheetTitle><SheetDescription className="mt-1 break-words">{statusLabel(row.category)} · {formatDate(row.submitted_at)}</SheetDescription></div>
        <div className="flex items-center gap-3"><span className="text-lg font-semibold tabular-nums">{money(row.amount_requested_minor, row.currency)}</span><SheetClose asChild><Button aria-label="Close review" size="icon" variant="ghost"><X /></Button></SheetClose></div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Assessment</span><AssessmentBadge status={row.assessment_status} processingStatus={row.processing_status} /></div>
        <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Decision</span><DecisionBadge status={row.decision_status} /></div>
        {simulation && <Badge variant="outline" className="rounded">{client.mode === "preview" ? "Synthetic preview" : "Simulated assessment"}</Badge>}
      </div>
    </SheetHeader>

    <Tabs defaultValue="details" className={styles.body}>
      <TabsList variant="line" aria-label="Receipt review" className="mx-4 my-2 shrink-0 min-[1200px]:hidden"><TabsTrigger value="document">Document</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList>
      <div className={styles.columns}>
        <TabsContent value="document" forceMount className={styles.document}>
          <div className="mb-4 flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><FileText className="size-4" aria-hidden="true" />Original receipt</span>{receiptUrl && <Button asChild variant="outline" size="sm"><a href={receiptUrl} target="_blank" rel="noreferrer">Open original<ArrowUpRight /></a></Button>}</div>
          {!receiptUrl ? <p className="text-sm text-muted-foreground">No original receipt is available.</p> : row.receipt?.file_type === "application/pdf" ? <object data={receiptUrl} type="application/pdf" aria-label={`Original receipt for ${row.attendee_name}`} className={styles.pdf}><p>Preview unavailable. <a href={receiptUrl} target="_blank" rel="noreferrer" className="underline">Open the original receipt</a>.</p></object> : imageFailed ? <p className="text-sm text-muted-foreground">The preview could not load. Use Open original to view the retained document.</p> : <img src={receiptUrl} alt={`Original receipt for ${row.attendee_name}`} className={styles.receipt} onError={() => setImageFailed(true)} />}
          {client.mode === "preview" && <p className="mt-3 text-xs text-muted-foreground">Synthetic receipt for this preview.</p>}
        </TabsContent>

        <TabsContent value="details" forceMount className={`${styles.evidence} space-y-6`}>
          {(row.processing_status === "running" || busy === "recheck") && <p role="status" className="motion-enter text-sm text-muted-foreground">Checking this claim. Previous evidence remains visible.</p>}
          {stale && <div className="rounded border border-[var(--status-review)]/30 bg-[var(--status-review-bg)] p-3 text-[var(--status-review)]"><p className="font-medium">Rules changed — recheck</p><p className="mt-1 text-xs">This assessment used an earlier rule set. The human decision is unchanged.</p></div>}
          {row.processing_error && <p className="text-sm text-destructive">{row.processing_error}</p>}
          {row.receipt?.extraction_status !== "succeeded" && <section className="rounded border p-4"><h3 className="font-medium">{row.receipt?.extraction_status === "failed" ? "Receipt extraction failed" : "Receipt needs extraction"}</h3><p className="mt-2 text-sm text-muted-foreground">{row.receipt?.extraction_error || "The original document is retained. Extract it before checking the claim."}</p>{row.receipt && <Button className="mt-3" variant="outline" size="lg" disabled={!!busy || row.processing_status === "running" || row.decision_status !== "pending"} aria-busy={busy === "retry"} onClick={() => void recheckOrRetry("retry")}><RotateCw aria-hidden="true" className={busy === "retry" ? "motion-safe:animate-spin" : undefined} />{busy === "retry" ? "Extracting…" : "Retry extraction"}</Button>}{row.decision_status !== "pending" && <p className="mt-2 text-xs text-muted-foreground">Extraction retries require a pending decision.</p>}</section>}

          <section aria-labelledby="comparison-title"><h3 id="comparison-title" className="mb-3 font-semibold">Claim and receipt</h3>
            <table className="w-full table-fixed text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="w-[26%] py-2 text-left font-normal">Field</th><th className="w-[37%] px-2 py-2 text-left font-normal">Claim</th><th className="w-[37%] py-2 text-left font-normal">Receipt</th></tr></thead><tbody className="[&_td]:break-words [&_td]:py-3 [&_tr]:border-b">
              <tr><td className="text-muted-foreground">Amount</td><td className="px-2 font-medium tabular-nums">{money(row.amount_requested_minor, row.currency)}</td><td className="font-medium tabular-nums">{money(parsed?.amount_minor, parsed?.currency)}</td></tr>
              <tr><td className="text-muted-foreground">Merchant</td><td className="px-2 text-muted-foreground">Not provided</td><td>{parsed?.vendor || "—"}</td></tr>
              <tr><td className="text-muted-foreground">Date</td><td className="px-2">{formatDate(row.submitted_at)}<span className="block text-xs text-muted-foreground">Submitted</span></td><td>{formatDate(parsed?.receipt_date)}</td></tr>
              <tr><td className="text-muted-foreground">Traveler</td><td className="px-2">{row.attendee_name}</td><td>{parsed?.names.length ? parsed.names.join(", ") : "—"}</td></tr>
            </tbody></table>
            {difference !== null && difference !== 0 && <p className="mt-3 flex items-start gap-2 text-sm font-medium text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{difference > 0 ? `Claim exceeds receipt by ${money(difference, row.currency)}` : `Claim is ${money(-difference, row.currency)} below receipt`}</p>}
            {duplicateNames.length > 0 && <p className="mt-3 text-sm text-destructive">Same receipt appears in {duplicateNames.join(", ")}&apos;s claim{duplicateNames.length > 1 ? "s" : ""}.</p>}
            {checks.some((check) => check.field_checked === "merchant" && check.verdict === "unknown") && <p className="mt-3 text-sm text-[var(--status-review)]">Merchant needs confirmation.</p>}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>Origin: {row.origin_location || "—"}</span><span className="break-all">{row.email}</span>{parsed?.receipt_number && <span>Receipt {parsed.receipt_number}</span>}</div>
          </section>

          <section><h3 className="mb-3 font-semibold">Checks</h3>{checks.length ? <ul className="space-y-3">{checks.map((check) => <li key={check.id} className="flex gap-2">{check.verdict === "pass" ? <Check className="mt-0.5 size-4 shrink-0 text-[var(--status-good)]" aria-hidden="true" /> : <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${check.verdict === "fail" ? "text-destructive" : "text-[var(--status-review)]"}`} aria-hidden="true" />}<div className="min-w-0"><p className="text-sm font-medium">{fieldLabels[check.field_checked] || statusLabel(check.field_checked)} <span className="font-normal text-muted-foreground">· {check.verdict === "pass" ? "Passed" : check.verdict === "fail" ? "Failed" : "Needs confirmation"}</span></p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{check.rationale_text}</p></div></li>)}</ul> : <p className="text-sm text-muted-foreground">No completed checks. Recheck after receipt extraction.</p>}</section>

          {humanCheck && <section><h3 className="mb-2 font-semibold">Reviewer decision</h3><DecisionBadge status={row.decision_status} /><p className="mt-2 text-sm leading-6 text-muted-foreground">{humanCheck.rationale_text}</p></section>}

          {row.investigation && <section><h3 className="mb-2 font-semibold">Investigation</h3><Badge variant="outline" className="mb-2 rounded">{row.investigation.mode === "simulated" ? "Simulated investigation" : "Live investigation"}</Badge><p className="text-sm leading-6 text-muted-foreground">{row.investigation.summary || "The investigation did not return a summary."}</p>{row.investigation.status === "unavailable" && <p className="mt-2 text-xs text-destructive">Investigation unavailable{row.investigation.error_code ? ` (${row.investigation.error_code})` : ""}. Review the receipt and checks directly.</p>}{row.investigation.steps.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer py-2 font-medium">Tool observations ({row.investigation.steps.length})</summary><ol className="mt-2 space-y-3">{row.investigation.steps.map((step, index) => <li key={`${step.tool}-${index}`}><p className="font-medium">{statusLabel(step.tool)}</p><p className="mt-1 leading-5 text-muted-foreground">{step.summary}</p><p className="mt-1 break-all text-muted-foreground">{step.evidence_refs.join(", ")}</p></li>)}</ol></details>}</section>}

          {merchantException && <section className="rounded border p-4"><h3 className="font-semibold">Remember this merchant name</h3><p className="mt-2 text-sm text-muted-foreground">Save a draft mapping from <span className="font-medium text-foreground">{parsed?.vendor}</span> to its canonical name, only for {row.category} claims in {row.currency}. You will test it before activation.</p><form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void propose(); }}><Label htmlFor="canonical-vendor">Canonical merchant name</Label><Input id="canonical-vendor" value={canonical} onChange={(event) => setCanonical(event.target.value)} maxLength={200} required disabled={!!busy} placeholder="Full merchant name" /><Button type="submit" variant="outline" size="lg" aria-busy={busy === "proposal"} disabled={!!busy || !canonical.trim() || normalize(canonical) === normalize(parsed?.vendor || "")}>{busy === "proposal" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy === "proposal" ? "Saving draft…" : "Create draft rule"}</Button></form></section>}

          <details className="border-t pt-3 text-xs"><summary className="cursor-pointer py-2 text-muted-foreground">Technical evidence</summary><p className="my-3 text-muted-foreground">Revision {row.review_revision} · Rule set {row.assessment_knowledge_revision ?? "not assessed"}. Provider probabilities are not calibrated accuracy.</p><pre className={styles.json}>{JSON.stringify({ checks: row.decisions, investigation: row.investigation }, null, 2)}</pre></details>
        </TabsContent>
      </div>
    </Tabs>

    <footer className="shrink-0 space-y-3 border-t bg-background px-5 py-4">
      {error && <p role="alert" className="motion-enter text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="motion-enter text-sm text-[var(--status-good)]">{notice}</p>}
      {blocked && row.decision_status !== "approved" && <p id="approval-blocked" className="text-xs text-muted-foreground">{blocked}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" size="lg" disabled={!!busy || row.processing_status === "running" || row.receipt?.extraction_status !== "succeeded"} aria-busy={busy === "recheck"} onClick={() => void recheckOrRetry("recheck")}><RotateCw aria-hidden="true" className={busy === "recheck" ? "motion-safe:animate-spin" : undefined} />{busy === "recheck" ? "Rechecking…" : "Recheck"}</Button><div className="flex gap-2"><Button variant="outline" size="lg" disabled={!!busy || row.decision_status === "rejected"} onClick={(event) => { decisionOrigin.current = event.currentTarget; setDecisionRevision(row.review_revision); setDecision("rejected"); setError(null); }}>Reject</Button><Button size="lg" aria-describedby={blocked && row.decision_status !== "approved" ? "approval-blocked" : undefined} disabled={!!busy || !!blocked || row.decision_status === "approved"} onClick={(event) => { decisionOrigin.current = event.currentTarget; setDecisionRevision(row.review_revision); setDecision("approved"); setError(null); }}>{row.decision_status === "approved" ? "Approved" : "Approve"}</Button></div></div>
    </footer>

    <Dialog open={decision !== null} onOpenChange={(open) => { if (!open && !busy) setDecision(null); }}>
      <DialogContent className={styles.confirmation} showCloseButton={!busy} onCloseAutoFocus={(event) => { event.preventDefault(); decisionOrigin.current?.focus(); }}>
        <DialogHeader><DialogTitle>{decision === "approved" ? "Approve reimbursement" : "Reject reimbursement"}</DialogTitle><DialogDescription>{decision === "approved" ? `Approve ${money(row.amount_requested_minor, row.currency)} for ${row.attendee_name}. This records approval; it does not send payment.` : `Record why ${row.attendee_name}'s claim is being rejected.`}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void saveDecision(); }} className="space-y-4"><div className="space-y-2"><Label htmlFor="decision-reason">Decision reason</Label><Textarea id="decision-reason" value={note} onChange={(event) => setNote(event.target.value)} required maxLength={2000} rows={4} disabled={!!busy} placeholder="Explain what you verified and why." /><p className="text-xs text-muted-foreground">Required · saved with this decision</p></div>{changedDuringDecision && <p role="alert" className="motion-enter text-sm text-[var(--status-review)]">This claim changed while the confirmation was open. Cancel and inspect the updated evidence. Your note will be kept.</p>}{error && <p role="alert" className="motion-enter text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={!!busy} onClick={() => setDecision(null)}>Cancel</Button><Button type="submit" variant={decision === "rejected" ? "destructive" : "default"} size="lg" aria-busy={busy === "decision"} disabled={!!busy || !note.trim() || changedDuringDecision || (decision === "approved" && !!blocked)}>{busy === "decision" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy === "decision" ? "Saving…" : decision === "approved" ? "Confirm approval" : "Confirm rejection"}</Button></DialogFooter></form>
      </DialogContent>
    </Dialog>
  </>;
}
