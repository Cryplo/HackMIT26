"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money, statusLabel } from "@/lib/dashboard/helpers";
import type { DashboardClient, DecisionAndSendInput } from "@/lib/dashboard/ui-contracts";
import type { ClaimMessage, ReviewRow } from "@/lib/review-contracts";
import styles from "./panels.module.css";

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
  const [applicantReason, setApplicantReason] = useState("");
  const failedChecks = row.decisions.filter(check => check.check_method !== "human" && check.field_checked !== "overall_status" && check.verdict === "fail");
  const [reasonIds, setReasonIds] = useState<string[]>(decision === "rejected" ? failedChecks.map(check => check.id) : []);
  const [busy, setBusy] = useState<"loading" | "generating" | "saving" | "confirming" | "checking" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [replacePrompt, setReplacePrompt] = useState(false);
  const [pending, setPending] = useState<DecisionAndSendInput | null>(null);
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
  const shownDecision = pending?.human_verdict ?? decision;
  const mayGenerate = decision === "approved" || currentReasonIds.length > 0 || !!applicantReason.trim();

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
    if (cached) { setNote(cached.note); onNoteChange(cached.note); setApplicantReason(cached.applicantReason); }
    const savedPending = readSession<DecisionAndSendInput>(pendingKey);
    if (savedPending?.request_id && savedPending.message_id) { pendingRef.current = savedPending; setPending(savedPending); setNote(savedPending.human_note); onNoteChange(savedPending.human_note); }
    void (async () => {
      try {
        if (!client.getMessages) throw new Error("Message history is unavailable.");
        const result = await client.getMessages(row.id);
        const confirmed = savedPending && result.messages.find(item => item.request_id === savedPending.request_id && item.correction_id);
        if (confirmed) { completed.current = true; clearSession(pendingKey); clearSession(cacheKey); await onConfirmed(confirmed); return; }
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
    completed.current = true; clearSession(pendingKey); clearSession(cacheKey); pendingRef.current = null; setPending(null);
    await onConfirmed(found); return true;
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
      completed.current = true; clearSession(pendingKey); clearSession(cacheKey); pendingRef.current = null; setPending(null);
      await onConfirmed(result.message, result.row);
    } catch (failure) {
      const failureCode = errorCode(failure);
      const definiteRejection = ["STALE_MESSAGE", "STALE_REVIEW", "STALE_ASSESSMENT", "APPROVAL_BLOCKED", "DUPLICATE_BLOCKED", "RECIPIENT_NOT_ALLOWED", "EMAIL_UNAVAILABLE", "INVALID_INPUT", "INVALID_BODY", "COMMUNICATION_IN_FLIGHT"].includes(failureCode);
      if (pendingRef.current) {
        try { if (await checkSaved()) return; } catch { /* Preserve exact request identity when the read also fails. */ }
        if (definiteRejection) { pendingRef.current = null; setPending(null); clearSession(pendingKey); }
      }
      if (["STALE_MESSAGE", "STALE_REVIEW", "STALE_ASSESSMENT"].includes(failureCode)) setServerStale(true);
      setError(pendingRef.current ? `The confirmation response is uncertain. Your exact request is retained. ${errorText(failure)}` : errorText(failure));
    } finally { lock.current = false; setBusy(null); }
  }

  const confirmLabel = preview ? `Save ${decision === "approved" ? "approval" : "rejection"} & preview` : decision === "approved" ? "Approve & send" : "Reject & send";
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`${styles.confirmation} max-h-[90dvh] overflow-y-auto sm:max-w-2xl`} showCloseButton={!busy} onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader><DialogTitle>{shownDecision === "approved" ? "Approve reimbursement" : "Reject reimbursement"}</DialogTitle><DialogDescription>Review the decision and applicant message together. Approval is for reimbursement; it does not send payment.</DialogDescription></DialogHeader>
      <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{row.attendee_name} · {money(row.amount_requested_minor, row.currency)}</span>{draft && <Badge variant="outline">{draft.mode === "preview" ? "Preview — no email sent" : draft.mode === "live" ? "Live email" : "Email unavailable"}</Badge>}</div>
        <p className="break-all text-xs text-muted-foreground">Claim {row.id}</p><p className="break-all">To: <span className="font-medium">{draft?.recipient || row.email || "No claimant email on file"}</span></p><p className="text-xs text-muted-foreground">Recipient comes from the saved claim and cannot be changed here.</p>
      </div>
      <div className="space-y-2"><Label htmlFor="email-internal-note">Internal review note — not sent</Label><Textarea id="email-internal-note" value={note} maxLength={2000} rows={3} disabled={!!busy || !!pending} onChange={event => { setNote(event.target.value); onNoteChange(event.target.value); }} placeholder="Explain what you verified for the audit record." /><p className="text-xs text-muted-foreground">Required. Kept separate from message generation and email content.</p></div>
      {decision === "rejected" && !pending && <details className="rounded-lg border p-3" open={!draft}>
        <summary className="cursor-pointer font-medium">Applicant-facing reasons</summary>
        <div className="mt-3 space-y-3">{failedChecks.length > 0 && <fieldset className="space-y-2"><legend className="mb-2 text-xs text-muted-foreground">Select relevant failed checks for this explanation</legend>{failedChecks.map(check => <label key={check.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!!busy} checked={reasonIds.includes(check.id)} onChange={event => setReasonIds(ids => event.target.checked ? [...ids, check.id] : ids.filter(id => id !== check.id))} /><span>{statusLabel(check.field_checked)}<span className="mt-1 block text-xs text-muted-foreground">{check.rationale_text}</span></span></label>)}</fieldset>}
          <Label htmlFor="applicant-reason">Reason that may be shared with the applicant{reasonIds.length === 0 ? " (required)" : " (optional)"}</Label><Textarea id="applicant-reason" value={applicantReason} maxLength={1500} rows={2} disabled={!!busy} onChange={event => setApplicantReason(event.target.value)} />
          {failedChecks.length === 0 && <p className="text-xs text-muted-foreground">No failed check supports this rejection. Provide your applicant-facing reason explicitly. If evidence is missing, requesting information is a separate workflow; it is not available in this release.</p>}
        </div>
      </details>}
      {busy === "loading" || busy === "generating" ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 motion-safe:animate-spin" />{busy === "loading" ? "Loading saved draft…" : "Preparing applicant message…"}</p> : null}
      {draft && <div className="space-y-3"><h3 className="font-semibold">Message to applicant</h3><div className="space-y-2"><Label htmlFor="applicant-subject">Subject</Label><Input id="applicant-subject" value={subject} maxLength={200} disabled={!!busy || !!pending} onChange={event => setSubject(event.target.value)} /></div>
        <div className="rounded border bg-muted/30 p-3 text-xs">{row.attendee_name} — claim {row.id} ({row.category}): {shownDecision === "approved" ? "Approved for reimbursement" : "Rejected"}. {row.currency} {(row.amount_requested_minor / 100).toFixed(2)} {shownDecision === "approved" ? "approved" : "requested"}.<p className="mt-1 text-muted-foreground">This decision header is added by Sift and cannot be edited.</p></div>
        <Textarea aria-label="Message to applicant" value={body} maxLength={8000} rows={8} disabled={!!busy || !!pending} onChange={event => setBody(event.target.value)} />
        <p className="text-xs text-muted-foreground">{dirty ? "You have unsaved edits. Confirmation saves them first." : "Draft saved."} Generation: {draft.generation_provenance}{draft.reason_check_ids.length > 0 ? ` · Based on ${draft.reason_check_ids.length} selected check(s)` : ""}.</p>
        {generationError && <p role="alert" className="text-sm text-[var(--status-review)]">AI drafting was unavailable. The editable template was retained. {generationError}</p>}
      </div>}
      {!pending && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy || !mayGenerate || row.review_revision !== expectedRevision} onClick={() => void generate(!!draft)}>{draft ? "Regenerate" : "Generate draft"}</Button>{draft && <Button variant="outline" disabled={!!busy || stale || !dirty || !subject.trim() || !body.trim()} onClick={() => void saveOnly()}>Save draft</Button>}</div>}
      {replacePrompt && <div role="alert" className="space-y-3 rounded border p-3"><p>Regeneration will replace this draft’s applicant message. Your internal note will be kept.</p><div className="flex gap-2"><Button variant="outline" onClick={() => setReplacePrompt(false)}>Keep current message</Button><Button onClick={() => void generate(true)}>Replace with new draft</Button></div></div>}
      {stale && !pending && <div role="alert" className="space-y-2 rounded border p-3 text-sm"><p>This claim or draft changed. Your edits and note are preserved. Refresh the claim, close this dialog to inspect its evidence, and generate a current draft before confirming.</p><Button variant="outline" disabled={!!busy} onClick={() => void onRefresh()}>Refresh claim</Button></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {pending && <div className="space-y-2 rounded border p-3 text-sm"><p>The {pending.human_verdict === "approved" ? "approval" : "rejection"} confirmation may already be saved. Editing is paused until its result is known.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy} onClick={() => void recover()}>Check saved status</Button><Button variant="outline" disabled={!!busy} onClick={() => void confirm()}>Retry same confirmation</Button></div></div>}
      <DialogFooter><Button variant="outline" disabled={!!busy} onClick={onClose}>{pending ? "Close — keep recovery details" : "Cancel"}</Button>{!pending && <Button variant={decision === "rejected" ? "destructive" : "default"} disabled={!!busy || !draft || !draft.mode || stale || !note.trim() || !subject.trim() || !body.trim() || (decision === "approved" && !!approvalBlocked)} onClick={() => void confirm()}>{busy === "confirming" ? "Saving decision…" : confirmLabel}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
