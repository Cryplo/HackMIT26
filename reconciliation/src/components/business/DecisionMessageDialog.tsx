"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FileCheck2, FileX2, LoaderCircle, Mail, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money, statusLabel } from "@/lib/dashboard/helpers";
import type { DashboardClient, DecisionAndSendInput } from "@/lib/dashboard/ui-contracts";
import type { ClaimMessage, ReviewRow } from "@/lib/review-contracts";
import { communicationStatus } from "./CommunicationHistory";
import styles from "./decision-message.module.css";

const errorText = (failure: unknown) => failure instanceof Error ? failure.message : "The request could not be completed.";
const errorCode = (failure: unknown) => failure && typeof failure === "object" && "code" in failure ? String(failure.code) : "";
function readSession<T>(key: string): T | null { try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; } }
function saveSession(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* The current dialog still retains its exact request and edits. */ } }
function clearSession(key: string) { try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable in private browser contexts. */ } }
interface CachedEdits { messageId: string | null; subject: string; body: string; note: string; applicantReason: string }
interface Props {
  row: ReviewRow; decision: "approved" | "rejected"; expectedRevision: number;
  client: DashboardClient; approvalBlocked: string | null; initialNote: string;
  onNoteChange(note: string): void; onClose(): void; onRefresh(): Promise<void>;
  onConfirmed(message: ClaimMessage, row?: ReviewRow): Promise<void>;
  onCloseAutoFocus(event: Event): void;
}

export function DecisionMessageDialog({ row, decision, expectedRevision, client, approvalBlocked, initialNote, onNoteChange, onClose, onRefresh, onConfirmed, onCloseAutoFocus }: Props) {
  const [draft, setDraft] = useState<ClaimMessage | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState(initialNote);
  const [noteOpen, setNoteOpen] = useState(!initialNote.trim());
  const [applicantReason, setApplicantReason] = useState("");
  const failedChecks = row.decisions.filter(check => check.check_method !== "human" && check.field_checked !== "overall_status" && check.verdict === "fail");
  const [reasonIds, setReasonIds] = useState<string[]>(decision === "rejected" ? failedChecks.map(check => check.id) : []);
  const [busy, setBusy] = useState<"loading" | "generating" | "saving" | "confirming" | "checking" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [replacePrompt, setReplacePrompt] = useState(false);
  const [pending, setPending] = useState<DecisionAndSendInput | null>(null);
  const [savedResult, setSavedResult] = useState<{ message: ClaimMessage; row?: ReviewRow } | null>(null);
  const [flightComplete, setFlightComplete] = useState(false);
  const [serverStale, setServerStale] = useState(false);
  const initialized = useRef(false);
  const completed = useRef(false);
  const lock = useRef(false);
  const pendingRef = useRef<DecisionAndSendInput | null>(null);
  const cacheKey = `sift:decision-draft:${row.id}:${decision}`;
  const pendingKey = `sift:decision-confirmation:${row.id}`;
  const stale = serverStale || row.review_revision !== expectedRevision || row.processing_status === "running" || (!!draft && draft.source_review_revision !== row.review_revision);
  const dirty = !!draft && (subject !== draft.subject || body !== draft.body);
  const preview = draft?.mode === "preview";
  const currentReasonIds = reasonIds.filter(id => failedChecks.some(check => check.id === id));
  const shownDecision = savedResult?.message.intended_verdict ?? pending?.human_verdict ?? decision;
  const mayGenerate = decision === "approved" || currentReasonIds.length > 0 || !!applicantReason.trim();

  const simulated = savedResult?.message.mode === "preview" && savedResult.message.status === "previewed";
  const flying = !!simulated && !flightComplete;

  useEffect(() => {
    if (!simulated) return;
    const timer = window.setTimeout(() => setFlightComplete(true), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400);
    return () => window.clearTimeout(timer);
  }, [simulated]);

  function acceptConfirmation(message: ClaimMessage, savedRow?: ReviewRow) {
    if (!message.correction_id) throw new Error("The decision has not been confirmed. Check its saved status before retrying.");
    completed.current = true;
    clearSession(pendingKey); clearSession(cacheKey);
    pendingRef.current = null; setPending(null); setError(null); setNotice(null);
    setSavedResult({ message, row: savedRow });
  }
  async function continueReview() {
    if (!savedResult || lock.current || flying) return;
    lock.current = true; setBusy("checking"); setError(null);
    try { await onConfirmed(savedResult.message, savedResult.row); }
    catch (failure) { setError(`Your decision is saved. Could not refresh the review: ${errorText(failure)}`); }
    finally { lock.current = false; setBusy(null); }
  }

  function installDraft(message: ClaimMessage, cached?: CachedEdits | null) {
    setDraft(message);
    const restore = cached && cached.messageId === message.id;
    setSubject(restore ? cached.subject : message.subject); setBody(restore ? cached.body : message.body);
    setReasonIds(message.reason_check_ids.filter(id => failedChecks.some(check => check.id === id))); setGenerationError(message.generation_error);
    setServerStale(false);
  }
  async function generate(replace = false) {
    if (lock.current || pendingRef.current || !client.draftMessage || !mayGenerate) return;
    if (replace && draft && !replacePrompt) { setReplacePrompt(true); return; }
    lock.current = true; setBusy("generating"); setError(null); setNotice(null); setReplacePrompt(false);
    try {
      const result = await client.draftMessage(row.id, {
        kind: decision === "approved" ? "approval" : "rejection", expected_review_revision: expectedRevision,
        reason_check_ids: decision === "rejected" ? currentReasonIds : [],
        ...(applicantReason.trim() ? { applicant_reason: applicantReason.trim() } : {}),
      });
      installDraft(result.message); setGenerationError(result.generation_error);
      setNotice("Draft saved. Review the applicant message before confirming.");
    } catch (failure) { setError(errorText(failure)); }
    finally { lock.current = false; setBusy(null); }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const cached = readSession<CachedEdits>(cacheKey);
    if (cached) { if (!cached.note.trim()) setNoteOpen(true); setNote(cached.note); onNoteChange(cached.note); setApplicantReason(cached.applicantReason); }
    const savedPending = readSession<DecisionAndSendInput>(pendingKey);
    if (savedPending?.request_id && savedPending.message_id) { pendingRef.current = savedPending; setPending(savedPending); setNote(savedPending.human_note); onNoteChange(savedPending.human_note); }
    void (async () => {
      try {
        if (!client.getMessages) throw new Error("Message history is unavailable.");
        const result = await client.getMessages(row.id);
        const confirmed = savedPending && result.messages.find(item => item.request_id === savedPending.request_id && item.correction_id);
        if (confirmed) { acceptConfirmation(confirmed); return; }
        const existing = savedPending ? result.messages.find(item => item.id === savedPending.message_id) : [...result.messages].sort((a, b) => b.created_at.localeCompare(a.created_at)).find(item => item.status === "draft" && item.intended_verdict === decision);
        if (existing) installDraft(existing, savedPending ? null : cached);
        else if (!savedPending && (decision === "approved" || failedChecks.length > 0)) await generate();
        if (savedPending) setError("The previous confirmation has an uncertain response. Check saved status, or retry that exact confirmation. Do not create a new decision.");
      } catch (failure) { setError(errorText(failure)); }
      finally { setBusy(null); }
    })();
    // Initialize exactly once per opened decision. Refreshes must not regenerate or overwrite edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (busy === "loading" || completed.current) return;
    saveSession(cacheKey, { messageId: draft?.id ?? null, subject, body, note, applicantReason } satisfies CachedEdits);
  }, [cacheKey, draft?.id, subject, body, note, applicantReason, busy]);

  async function saveDraft(): Promise<ClaimMessage> {
    if (!draft || !client.editMessage) throw new Error("Generate a draft before saving.");
    if (!dirty) return draft;
    const result = await client.editMessage(draft.id, { expected_draft_revision: draft.draft_revision, subject, body });
    setDraft(result.message); setSubject(result.message.subject); setBody(result.message.body);
    return result.message;
  }
  async function saveOnly() {
    if (lock.current || pendingRef.current || stale) return;
    lock.current = true; setBusy("saving"); setError(null);
    try { await saveDraft(); setNotice("Applicant message saved. No decision recorded or email sent."); }
    catch (failure) { setError(errorText(failure)); if (errorCode(failure) === "STALE_MESSAGE") setServerStale(true); }
    finally { lock.current = false; setBusy(null); }
  }
  async function checkSaved(): Promise<boolean> {
    if (!client.getMessages || !pendingRef.current) return false;
    const result = await client.getMessages(row.id);
    const found = result.messages.find(item => item.request_id === pendingRef.current?.request_id && !!item.correction_id);
    if (!found) return false;
    acceptConfirmation(found); return true;
  }
  async function recover() {
    if (lock.current) return;
    lock.current = true; setBusy("checking"); setError(null);
    try { if (!await checkSaved()) setNotice("No saved confirmation is visible yet. Retry the same confirmation to recover safely; its request ID will stay unchanged."); }
    catch (failure) { setError(`Could not verify the saved state. ${errorText(failure)}`); }
    finally { lock.current = false; setBusy(null); }
  }
  async function confirm() {
    if (lock.current || !client.decisionAndSend) return;
    if (!pendingRef.current && (!draft || stale || !note.trim() || !subject.trim() || !body.trim() || (decision === "approved" && approvalBlocked))) return;
    lock.current = true; setBusy("confirming"); setError(null); setNotice(null);
    try {
      if (pendingRef.current && await checkSaved()) return;
      let request = pendingRef.current;
      if (!request) {
        const saved = await saveDraft();
        request = { expected_review_revision: expectedRevision, human_verdict: decision, human_note: note.trim(), message_id: saved.id, expected_draft_revision: saved.draft_revision, request_id: crypto.randomUUID() };
        pendingRef.current = request; setPending(request); saveSession(pendingKey, request);
      }
      const result = await client.decisionAndSend(row.id, request);
      acceptConfirmation(result.message, result.row);
    } catch (failure) {
      const failureCode = errorCode(failure);
      const definiteRejection = ["STALE_MESSAGE", "STALE_REVIEW", "STALE_ASSESSMENT", "APPROVAL_BLOCKED", "DUPLICATE_BLOCKED", "RECIPIENT_NOT_ALLOWED", "EMAIL_UNAVAILABLE", "INVALID_INPUT", "INVALID_BODY", "COMMUNICATION_IN_FLIGHT", "MESSAGE_ALREADY_CONFIRMED", "MESSAGE_CONFLICT"].includes(failureCode);
      if (pendingRef.current) {
        try { if (await checkSaved()) return; } catch { /* Preserve exact request identity when the read also fails. */ }
        if (definiteRejection) { pendingRef.current = null; setPending(null); clearSession(pendingKey); }
      }
      if (["STALE_MESSAGE", "STALE_REVIEW", "STALE_ASSESSMENT", "MESSAGE_ALREADY_CONFIRMED", "MESSAGE_CONFLICT"].includes(failureCode)) setServerStale(true);
      setError(pendingRef.current ? `The confirmation response is uncertain. Your exact request is retained. ${errorText(failure)}` : errorText(failure));
    } finally { lock.current = false; setBusy(null); }
  }

  const confirmLabel = `${decision === "approved" ? "Approve" : "Reject"} & ${preview ? "simulate" : "send"} email`;
  return <Dialog open onOpenChange={open => { if (!open && !busy && !flying) { if (savedResult) void continueReview(); else onClose(); } }}>
    <DialogContent className={styles.dialog} data-decision={shownDecision} data-was-uncertain={row.assessment_status === "needs_review" || undefined} showCloseButton={!busy && !savedResult} onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader className={styles.header}>
        <div className={styles.headingIcon} aria-hidden="true"><Mail size={21} /></div>
        <div><DialogTitle className={styles.title}>{savedResult ? (simulated ? "Applicant email" : "Decision recorded") : shownDecision === "approved" ? "Approve & notify" : "Reject & notify"}</DialogTitle>
          <DialogDescription>{row.attendee_name} · {money(row.amount_requested_minor, row.currency)} reimbursement</DialogDescription></div>
      </DialogHeader>
      {savedResult ? <>
        <div className={styles.result} role="status" aria-live="polite" aria-atomic="true">
          <div className={styles.flightStage} aria-hidden="true">
            {flying ? <><span className={styles.flightTrail} /><span className={styles.plane}><Send size={48} strokeWidth={1.4} /></span></> : <span className={styles.successIcon}>{shownDecision === "approved" ? <Check size={35} strokeWidth={1.6} /> : <FileX2 size={35} strokeWidth={1.6} />}</span>}
          </div>
          <h3>{flying ? "Simulating email…" : simulated ? "Email simulated" : "Decision saved"}</h3>
          <p>{simulated ? "No email was sent." : communicationStatus(savedResult.message)}</p>
          <p className={styles.resultDetail}>{shownDecision === "approved" ? "Approval" : "Rejection"} recorded for {row.attendee_name}.<br />{simulated ? "Your message is saved in applicant communication." : "Provider acceptance does not confirm inbox delivery."}</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
        <DialogFooter className={styles.footer}><Button variant="outline" disabled={!!busy || flying} onClick={() => void continueReview()}>{busy && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}Continue review</Button></DialogFooter>
      </> : <>
        <div className={styles.content}>
          <div className={styles.modeLine}><Badge variant="outline" className={preview ? styles.previewBadge : ""}>{preview ? "Email simulation" : draft?.mode === "live" ? "Live email" : "Applicant message"}</Badge><span>{preview ? "Save the decision. Preview the send. No email leaves Sift." : draft?.mode === "live" ? "Confirming queues a real email to the applicant." : "Review your message before confirming."}</span></div>
          {busy === "confirming" && <p role="status" className={styles.saving}><LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />Saving decision and message…</p>}
          <div className={styles.email}>
            <div className={styles.emailRow}><span className={styles.fieldLabel}>To</span><span className={styles.recipient}>{draft?.recipient || row.email || "No claimant email on file"}</span><Mail size={15} aria-hidden="true" /></div>
            <div className={styles.emailRow}><Label htmlFor="applicant-subject" className={styles.fieldLabel}>Subject</Label><Input id="applicant-subject" className={styles.subject} value={subject} maxLength={200} disabled={!draft || !!busy || !!pending} placeholder="Preparing your email…" onChange={event => setSubject(event.target.value)} /></div>
            {draft ? <>
              <div className={styles.decisionHeader} data-decision={shownDecision}>{shownDecision === "approved" ? <FileCheck2 size={17} aria-hidden="true" /> : <FileX2 size={17} aria-hidden="true" />}<div><strong>{shownDecision === "approved" ? "Approved for reimbursement" : "Reimbursement rejected"}</strong><span>{row.attendee_name} · {row.category} · {money(row.amount_requested_minor, row.currency)} {shownDecision === "approved" ? "approved" : "requested"}</span></div></div>
              <Textarea aria-label="Message to applicant" className={styles.body} value={body} maxLength={8000} rows={9} disabled={!!busy || !!pending} onChange={event => setBody(event.target.value)} />
            </> : <div className={styles.emptyDraft}>{busy ? <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" /> : <Mail aria-hidden="true" className="size-6" />}<p role="status">{busy === "loading" ? "Loading saved draft…" : busy === "generating" ? "Preparing applicant message…" : decision === "rejected" ? "Add an applicant-facing reason below, then generate your draft." : "Generate a draft to write your applicant email."}</p></div>}
            {draft && <div className={styles.draftActions}><span role="status">{busy === "generating" ? "Preparing applicant message…" : dirty ? "Unsaved edits" : "Draft saved"}</span>{!pending && <div><Button variant="ghost" size="sm" disabled={!!busy || !mayGenerate || row.review_revision !== expectedRevision} onClick={() => void generate(true)}>Regenerate</Button><Button variant="ghost" size="sm" disabled={!!busy || stale || !dirty || !subject.trim() || !body.trim()} onClick={() => void saveOnly()}>Save draft</Button></div>}</div>}
          </div>
          <details className={styles.details} open={noteOpen} onToggle={event => setNoteOpen(event.currentTarget.open)}>
            <summary><span>Private review note <span className={styles.detailHint}>{note.trim() ? "Saved with decision" : "Required"}</span></span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className={styles.detailContent}><Label htmlFor="email-internal-note">Internal review note — not sent</Label><Textarea id="email-internal-note" value={note} maxLength={2000} rows={3} required disabled={!!busy || !!pending} onChange={event => { setNote(event.target.value); onNoteChange(event.target.value); }} placeholder="Explain what you verified for the audit record." /><p>This note stays private and is never used to write the email.</p></div>
          </details>
          {decision === "rejected" && !pending && <details className={styles.details} open={!draft || undefined}>
            <summary><span>Applicant-facing reasons</span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className={styles.detailContent}>{failedChecks.length > 0 && <fieldset className="space-y-2"><legend className="mb-2 text-xs text-muted-foreground">Select relevant failed checks for this explanation</legend>{failedChecks.map(check => <label key={check.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!!busy} checked={reasonIds.includes(check.id)} onChange={event => setReasonIds(ids => event.target.checked ? [...ids, check.id] : ids.filter(id => id !== check.id))} /><span>{statusLabel(check.field_checked)}<span className="mt-1 block text-xs text-muted-foreground">{check.rationale_text}</span></span></label>)}</fieldset>}
              <Label htmlFor="applicant-reason">Reason to share with the applicant{currentReasonIds.length === 0 ? " (required)" : " (optional)"}</Label><Textarea id="applicant-reason" value={applicantReason} maxLength={1500} rows={2} disabled={!!busy} onChange={event => setApplicantReason(event.target.value)} />
              {failedChecks.length === 0 && <p>No failed check supports this rejection. Add the reason the applicant should receive.</p>}
            </div>
          </details>}
          {!draft && !pending && <Button variant="outline" disabled={!!busy || !mayGenerate || row.review_revision !== expectedRevision} onClick={() => void generate()}>Generate draft</Button>}
          {draft && <details className={styles.details}><summary><span>Message details</span><ChevronDown size={16} aria-hidden="true" /></summary><div className={styles.detailContent}><p>Claim {row.id}. The recipient comes from the saved claim. Sift adds the decision header automatically.</p><p>Generation: {draft.generation_provenance}{draft.reason_check_ids.length > 0 ? ` · Based on ${draft.reason_check_ids.length} selected check(s)` : ""}.</p><p>Approval records a reimbursement decision; it does not send payment.</p></div></details>}
          {generationError && <p role="alert" className={styles.warning}>AI drafting was unavailable. The editable template was retained. {generationError}</p>}
          {replacePrompt && <div role="alert" className={styles.warning}><p>Replace this draft’s applicant message? Your private note will be kept.</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setReplacePrompt(false)}>Keep current message</Button><Button onClick={() => void generate(true)}>Replace with new draft</Button></div></div>}
          {stale && !pending && <div role="alert" className={styles.warning}><p>This claim or draft changed. Your edits are preserved. Refresh the claim, close this dialog to inspect its evidence, then generate a current draft.</p><Button className="mt-3" variant="outline" disabled={!!busy} onClick={() => void onRefresh()}>Refresh claim</Button></div>}
          {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
          {pending && busy !== "confirming" && <div className={styles.warning}><p>The {pending.human_verdict === "approved" ? "approval" : "rejection"} may already be saved. Editing is paused until its result is known.</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy} onClick={() => void recover()}>Check saved status</Button><Button variant="outline" disabled={!!busy} onClick={() => void confirm()}>Retry same confirmation</Button></div></div>}
        </div>
        <DialogFooter className={styles.footer}><Button variant="ghost" disabled={!!busy} onClick={onClose}>{pending ? "Close — keep recovery details" : "Cancel"}</Button>{!pending && <Button variant={decision === "rejected" ? "destructive" : "success"} aria-busy={busy === "confirming"} disabled={!!busy || !draft || !draft.mode || stale || !note.trim() || !subject.trim() || !body.trim() || (decision === "approved" && !!approvalBlocked)} onClick={() => void confirm()}>{busy === "confirming" ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Send size={16} aria-hidden="true" />}{busy === "confirming" ? "Saving decision…" : confirmLabel}</Button>}</DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
