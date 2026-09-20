"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, CircleHelp, Copy, FileImage, Files, FileText, Link2, LoaderCircle, Mail, Paperclip, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InboxDocument, InboxSuggestion, ImportResult, SourceAudit } from "@/lib/inbox/schema";
import { suggestLinks } from '@/lib/inbox/matching';

import { caseSummary, clarificationDraft, defaultDraft as defaults, money, requestCents, type Draft } from "@/lib/inbox/presentation";
import { SourceWorkbench, type SourceSample } from './source-workbench';
import { recordSourceActivity } from '@/lib/inbox/activity';
import { SourceIcon, type SourceKind } from '@/components/business/SourceIcon';
import styles from "./import.module.css";

type UploadItem = { source: SourceKind; id: string; name: string; status: "queued" | "reading" | "done" | "error"; documentId?: string; duplicateOf?: string; message?: string };
const selectClass = styles.select;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "This request failed. Please try again.");
  return data;
}

function Evidence({ document }: { document: InboxDocument }) {
  const facts = document.evidence?.facts;
  const Icon = document.file_type.startsWith("image/") ? FileImage : document.evidence?.document_kind === "email" ? Mail : FileText;
  return <div className={styles.evidence}>
    <div className={styles.evidenceTitle}><Icon aria-hidden="true" size={16} /><a href={`/api/inbox/${document.id}`} target="_blank" rel="noreferrer">{document.filename}<ArrowUpRight aria-hidden="true" size={13} /></a></div>
    {document.file_type.startsWith("image/") && <a href={`/api/inbox/${document.id}`} target="_blank" rel="noreferrer" aria-label={`View image ${document.filename}`}><img src={`/api/inbox/${document.id}`} alt={`Original synthetic receipt: ${document.filename}`} className={styles.receiptThumbnail} loading="lazy" /></a>}
    {facts && <p>{[facts.vendor, ...facts.names, facts.purchase_date, facts.amount_minor == null ? null : `${facts.currency || "?"} ${(facts.amount_minor / 100).toFixed(2)}`].filter(Boolean).join(" · ") || "No purchase facts found."}</p>}
    {facts?.booking_reference && <p className={styles.reference}><Link2 size={12} aria-hidden="true" />Booking {facts.booking_reference}</p>}
    {document.evidence?.raw_extracted_text && <details className={styles.excerpt}><summary>Source text</summary><p>{document.evidence.raw_extracted_text}</p></details>}
  </div>;
}

export default function ImportWorkspace({ mode, simulatedReview }: { mode: "demo" | "live" | "unconfigured"; simulatedReview: boolean }) {
  const [documents, setDocuments] = useState<InboxDocument[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [anchors, setAnchors] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<InboxSuggestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  const [consumed, setConsumed] = useState<string[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(true);
  const [composer, setComposer] = useState<{ documentId: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const manuallyAssigned = useRef(new Set<string>());
  const editedDrafts = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    setBusy('Loading saved audit inputs…');
    json<SourceAudit>('/api/inbox/audit').then(batch => {
      if (cancelled || !batch.enabled || !batch.documents.length) return;
      const links = suggestLinks(batch.documents);
      const assigned = Object.fromEntries(links.map(link => [link.document_id, link.suggested_receipt_id || '']));
      const used = batch.imports.flatMap(item => item.document_ids);
      setDocuments(batch.documents);
      setSuggestions(links);
      setAssignments(assigned);
      setConsumed(used);
      setResults(batch.imports.map(item => item.result));
      const receipts = batch.documents.filter(document => document.evidence?.document_kind === 'receipt');
      setAnchors(receipts.filter(document => !used.includes(document.id)).map(document => document.id));
      setDrafts(Object.fromEntries(receipts.map(receipt => [receipt.id, defaults(receipt, batch.documents.filter(document => assigned[document.id] === receipt.id))])));
      setUploads(batch.documents.map(document => ({ id: document.id, name: document.filename, documentId: document.id, status: document.error ? 'error' : 'done', message: document.error || undefined,
        source: document.file_type === 'text/csv' ? 'forms' : document.evidence?.document_kind === 'email' ? 'email' : 'dropbox' })));
      setUploadOpen(false);
      if (batch.error) setError(batch.error);
    }).catch(failure => { if (!cancelled) setError(failure.message); }).finally(() => { if (!cancelled) setBusy(''); });
    return () => { cancelled = true; };
  }, []);
  const available = documents.filter(d => !consumed.includes(d.id));
  const receipts = available.filter(d => anchors.includes(d.id));
  const supporting = available.filter(d => !anchors.includes(d.id));
  const linked = (id: string) => supporting.filter(d => assignments[d.id] === id);
  const summaries = receipts.filter(r => drafts[r.id]).map(receipt => ({ receipt, summary: caseSummary(receipt, linked(receipt.id), drafts[receipt.id], suggestions.flatMap(s => s.candidates.filter(c => c.receipt_id === receipt.id && assignments[s.document_id] === receipt.id))) }));
  const ambiguous = supporting.filter(d => !assignments[d.id] && suggestions.some(s => s.document_id === d.id && s.candidates.length));
  const unmatched = supporting.filter(d => !assignments[d.id] && !ambiguous.includes(d));
  const duplicates = uploads.filter(u => u.duplicateOf).length;
  const finished = uploads.filter(u => u.status === "done" || u.status === "error").length;

  function assign(documentId: string, receiptId: string) {
    manuallyAssigned.current.add(documentId);
    setAssignments(previous => ({ ...previous, [documentId]: receiptId }));
    setConfirmations(previous => ({ ...previous, [assignments[documentId] || ""]: false, [receiptId]: false }));
  }

  async function suggest(all: InboxDocument[], receiptIds: string[]) {
    const data = await json<{ suggestions: InboxSuggestion[] }>("/api/inbox/suggest", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_ids: all.map(d => d.id) }),
    });
    setSuggestions(data.suggestions);
    // Preserve deliberate assignments, including an explicit Unassigned selection.
    const next = { ...assignments };
    for (const suggestion of data.suggestions) {
      if (!manuallyAssigned.current.has(suggestion.document_id)) next[suggestion.document_id] = suggestion.suggested_receipt_id && receiptIds.includes(suggestion.suggested_receipt_id) ? suggestion.suggested_receipt_id : "";
    }
    setAssignments(next);
    setConfirmations({});
    setDrafts(previous => {
      const updated = { ...previous };
      for (const receipt of all.filter(d => receiptIds.includes(d.id))) {
        if (!editedDrafts.current.has(receipt.id)) updated[receipt.id] = defaults(receipt, all.filter(d => next[d.id] === receipt.id));
      }
      return updated;
    });
  }

  async function upload(files: File[], sources: SourceKind[] = []) {
    if (!files.length) return;
    if (uploads.length + files.length > 12) throw new Error("This inbox supports up to 12 files per session. Refresh to start another batch after saving your claims.");
    const items = files.map((file, index) => ({ source: sources[index] || "upload" as SourceKind, id: crypto.randomUUID(), name: file.name, status: "queued" as const }));
    setUploads(previous => [...previous, ...items]);
    setUploadOpen(false);
    const pendingHashes = new Map(documents.map(document => [document.sha256, Promise.resolve(document)]));
    const added: InboxDocument[] = [];
    let cursor = 0;
    setBusy("Reading source files…");
    async function worker() {
      while (cursor < files.length) {
        const index = cursor++;
        const file = files[index], item = items[index];
        const update = (patch: Partial<UploadItem>) => setUploads(previous => previous.map(u => u.id === item.id ? { ...u, ...patch } : u));
        update({ status: "reading" });
        recordSourceActivity({ id: item.id, name: item.name, source: item.source, status: "reading", at: Date.now() });
        try {
          if (!file.size || file.size > 8 * 1024 * 1024 ) throw new Error("Choose a file up to 8 MB. Text exports must be under 100 KB.");
          const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
          const duplicate = pendingHashes.get(contentHash);
          if (duplicate) {
            const document = await duplicate;
            update({ status: document.error ? 'error' : 'done', message: document.error || 'Repeated copy · counted once', duplicateOf: document.id, documentId: document.id });
            recordSourceActivity({ id: item.id, name: item.name, source: item.source, status: document.error ? "failed" : "parsed", at: Date.now() });
            continue;
          }
          const body = new FormData();
          body.set("file", file);
          const reading = json<InboxDocument>("/api/inbox", { method: "POST", body });
          pendingHashes.set(contentHash, reading);
          const document = await reading;
          recordSourceActivity({ id: item.id, name: item.name, source: item.source, status: document.error ? "failed" : "parsed", at: Date.now() });
          added.push(document);
          setDocuments(previous => [...previous, document]);
          update({ status: document.error ? "error" : "done", documentId: document.id, message: document.error || undefined });
        } catch (e) { update({ status: "error", message: e instanceof Error ? e.message : "Upload failed." }); recordSourceActivity({ id: item.id, name: item.name, source: item.source, status: "failed", at: Date.now() }); }
      }
    }
    await Promise.all([worker(), worker()]);
    const all = [...available, ...added].filter(d => d.evidence && !d.error);
    const receiptIds = [...anchors, ...added.filter(d => d.evidence?.document_kind === "receipt" && !d.error).map(d => d.id)];
    setAnchors(receiptIds);
    if (all.length) {
      setBusy("Matching documents…");
      try { await suggest(all, receiptIds); }
      catch (e) {
        setDrafts(previous => ({ ...Object.fromEntries(all.filter(d => receiptIds.includes(d.id)).map(d => [d.id, defaults(d, [])])), ...previous }));
        throw e;
      }
    }
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setError("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); }
    finally { lock.current = false; setBusy(""); }
  }

  async function samples(samples: SourceSample[]) {
    setBusy("Loading source inputs…");
    const files = await Promise.all(samples.map(async sample => {
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error("Could not load sample inputs.");
      return new File([await response.blob()], sample.name, { type: sample.file_type });
    }));
    await upload(files, samples.map(sample => sample.source));
  }

  async function confirm(event: FormEvent<HTMLFormElement>, receipt: InboxDocument) {
    event.preventDefault();
    await run(async () => {
      if (!confirmations[receipt.id]) throw new Error("Please check the current documents and request before confirming.");
      const draft = drafts[receipt.id];
      const cents = requestCents(draft.amount);
      if (cents === null) throw new Error("Enter a valid USD amount with no more than two decimal places.");
      const selected = linked(receipt.id);
      if (selected.length > 8) throw new Error("Attach no more than eight supporting documents to a claim.");
      setBusy("Saving claim…");
      const result = await json<ImportResult>("/api/inbox/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_id: receipt.id, supporting_ids: selected.map(d => d.id), confirmed: true,
          submission: { attendee_name: draft.attendee_name, email: draft.email, amount_requested_minor: String(cents), currency: "USD", category: draft.category, origin_location: draft.origin_location } }),
      });
      for (const item of uploads.filter(item => [receipt.id, ...selected.map(d => d.id)].includes(item.documentId || ""))) recordSourceActivity({ id: item.id, name: item.name, source: item.source, status: "confirmed", at: Date.now() });
      setResults(previous => [...previous, result]);
      setConsumed(previous => [...previous, receipt.id, ...selected.map(d => d.id)]);
      setAnchors(previous => previous.filter(id => id !== receipt.id));
    });
  }

  return <div className={styles.workspace}>
        <p className={styles.mode}>{mode === "demo" ? "Simulated reading · sample facts are authored" : mode === "live" ? (simulatedReview ? "Live AI reading · simulated review sandbox" : "Live AI reading · check facts against originals") : "Extraction needs server configuration"}</p>
    <div className={styles.journey} aria-label="Paperwork workflow">
      <span data-active={!documents.length}><Files aria-hidden="true" />Bring your files</span><ArrowRight className={styles.journeyArrow} aria-hidden="true" />
      <span data-active={!!documents.length && !results.length}><Link2 aria-hidden="true" />Understand the connections</span><ArrowRight className={styles.journeyArrow} aria-hidden="true" />
      <span data-active={!!results.length}><CheckCircle2 aria-hidden="true" />Take the next step</span>
    </div>
    <SourceWorkbench documents={documents} busy={!!busy} onRead={selected => void run(() => samples(selected))}>
    <details className={styles.uploadDisclosure} open={uploadOpen} onToggle={event => setUploadOpen(event.currentTarget.open)}><summary><Upload size={15} aria-hidden="true" />{uploads.length ? "Add more files" : "Add source files"}<span>Documents · photos · exports</span><ChevronDown size={14} aria-hidden="true" /></summary>
    <section className={styles.uploadPanel} aria-labelledby="upload-heading">
      <div className={styles.uploadIntro}>
        <h2 id="upload-heading">Drop in your files.</h2>
        <p>Add receipts, form exports, messages, and booking documents together. Sift reads the evidence and finds the connections.</p>
      </div>
      <div className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy && mode !== 'unconfigured') void run(() => upload(Array.from(event.dataTransfer.files))); }}>
        <Upload size={22} aria-hidden="true" />
        <Label htmlFor="paperwork">Drop files here, or choose files</Label>
        <input id="paperwork" type="file" multiple disabled={!!busy || mode === "unconfigured" || uploads.length >= 12} aria-label="Upload source files" aria-describedby="paperwork-help" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void run(() => upload(files)); }} />
        <p id="paperwork-help">PDF, PNG, JPG, CSV, TXT, EML · up to 12 files · 8 MB each (text: 100 KB) · fictional data</p>
      </div>
    </section></details>
    </SourceWorkbench>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    <div className={styles.progressLine} id="source-results" role="status" aria-live="polite">
      {busy ? <><LoaderCircle className="motion-safe:animate-spin" size={16} aria-hidden="true" />{busy} <span>{finished} of {uploads.length} files read</span></> : documents.length ? <><CheckCircle2 size={16} aria-hidden="true" />{available.length} unique documents in this inbox{duplicates > 0 && <span>{duplicates} repeated {duplicates === 1 ? 'copy' : 'copies'} counted once</span>}</> : <>Your files stay together. Claims are created only when you confirm.</>}
    </div>
    {!!uploads.length && <div className={styles.board}>
      <aside className={styles.sourceRail} aria-label="Source files">
        <div className={styles.railHeading}><h2>Source files</h2><span>{uploads.length}</span></div>
        <p className={styles.muted}>Originals stay a click away.</p>
        <ul>{uploads.map(item => {
          const document = documents.find(d => d.id === (item.duplicateOf || item.documentId));
          const Icon = item.name.match(/\.(png|jpe?g)$/i) ? FileImage : document?.evidence?.document_kind === 'email' ? Mail : FileText;
          return <li key={item.id} data-failed={item.status === 'error'} data-duplicate={!!item.duplicateOf}>
            <div className={styles.fileIcon}>{item.source !== "upload" && item.status !== "reading" ? <SourceIcon source={item.source} size={20} /> : item.status === 'reading' ? <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}</div>
            <div>{item.documentId ? <a href={`/api/inbox/${item.documentId}`} target="_blank" rel="noreferrer">{item.name}<ArrowUpRight size={11} aria-hidden="true" /></a> : <strong>{item.name}</strong>}<small>{item.message || (item.status === 'done' ? document?.evidence?.document_kind.replaceAll('_', ' ') || 'Read' : item.status === 'reading' ? 'Reading…' : 'Queued')}</small></div>
          </li>;
        })}</ul>
        <p className={styles.sessionNote}>Keep this tab open until you save your cases.</p>
      </aside>
      <div className={styles.results}>
        <div className={styles.resultsHeading}><div><h2>From files to next steps</h2><p>Confirm complete cases. Spend your attention on the exceptions.</p></div><span className={styles.caseCount}>{summaries.length} receipt {summaries.length === 1 ? 'case' : 'cases'}</span></div>
        {!!summaries.length && <div className={styles.outcomes} aria-label="Intake outcomes">
          <div><span className={styles.greenDot} /><strong>{summaries.filter(s => s.summary.state === 'ready').length}</strong>ready to confirm</div>
          <div><span className={styles.redDot} /><strong>{summaries.filter(s => s.summary.state === 'issue').length}</strong>amount to resolve</div>
          <div><span className={styles.amberDot} /><strong>{summaries.filter(s => s.summary.state === 'attention').length}</strong>need details</div>
        </div>}
        {busy && !summaries.length && <div className={styles.waiting}><Link2 size={28} aria-hidden="true" /><h3>Reading the evidence</h3><p>Each finished file appears on the left. Suggested cases appear when the batch is read.</p></div>}
        {summaries.map(({ receipt, summary }) => {
          const draft = drafts[receipt.id], selected = linked(receipt.id);
          const update = (field: keyof Draft, value: string) => { editedDrafts.current.add(receipt.id); setDrafts(previous => ({ ...previous, [receipt.id]: { ...previous[receipt.id], [field]: value } })); setConfirmations(previous => ({ ...previous, [receipt.id]: false })); };
          return <article key={receipt.id} className={styles.case} data-state={summary.state} aria-label={`Case for ${receipt.evidence?.facts.names[0] || 'unknown traveler'}: ${receipt.filename}`}>
            <details>
              <summary className={styles.caseSummary}>
                <div className={styles.personIcon}>{(receipt.evidence?.facts.names[0] || '?').slice(0, 1)}</div>
                <div className={styles.caseIdentity}><h3>{receipt.evidence?.facts.names[0] || 'Confirm traveler'}</h3><p>{receipt.evidence?.facts.vendor || 'Unknown merchant'}{receipt.evidence?.facts.amount_minor != null ? ` · ${money(receipt.evidence.facts.amount_minor, receipt.evidence.facts.currency || 'USD')}` : ''}</p><small>{receipt.filename} + {selected.length} supporting {selected.length === 1 ? 'file' : 'files'}</small></div>
                <div className={styles.caseOutcome}><span className={styles.badge}>{summary.label}</span><small>{summary.state === 'issue' && summary.delta !== null ? `${money(Math.abs(summary.delta))} ${summary.delta > 0 ? 'above' : 'below'} receipt` : 'Review case'}</small></div><ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
              </summary>
              <div className={styles.caseDetail}>
                <p className={styles.finding}>{summary.explanation}</p>
                {summary.state === 'issue' && <div className={styles.comparison}><div><small>Requested</small><strong>{money(requestCents(draft.amount)!)}</strong><span>{selected.find(d => d.evidence?.request.amount_requested_minor === requestCents(draft.amount))?.filename || 'Your edited request'}</span></div><ArrowRight aria-hidden="true" /><div><small>Receipt supports</small><strong>{money(receipt.evidence!.facts.amount_minor!)}</strong><span>{receipt.filename}</span></div></div>}
                <div className={styles.evidenceChain} aria-label="Linked evidence"><div><h4>Receipt</h4><Evidence document={receipt} /></div>{selected.map(document => <div key={document.id}><h4>{document.evidence?.document_kind === 'email' ? 'Request email' : 'Supporting evidence'}</h4><Evidence document={document} /><div className={styles.connectionReason}><Link2 size={12} aria-hidden="true" />{suggestions.find(s => s.document_id === document.id)?.candidates.find(c => c.receipt_id === receipt.id)?.reasons.join(' · ') || 'Manually linked — verify this connection'}</div></div>)}</div>
                {summary.warnings.map(w => <p key={w} className={styles.warning}>{w}</p>)}
                <form onSubmit={event => void confirm(event, receipt)}>
                  <fieldset disabled={!!busy}>
                    <details className={styles.requestFields} open={summary.missing.length > 0}><summary>{summary.missing.length ? 'Complete request details' : 'Edit request details'}</summary>
                      <div className={styles.fieldGrid}>
                        <div><Label htmlFor={`name-${receipt.id}`}>Attendee name</Label><Input id={`name-${receipt.id}`} value={draft.attendee_name} onChange={event => update('attendee_name', event.target.value)} required maxLength={200} /></div>
                        <div><Label htmlFor={`email-${receipt.id}`}>Email</Label><Input id={`email-${receipt.id}`} type="email" value={draft.email} onChange={event => update('email', event.target.value)} required maxLength={254} /></div>
                        <div><Label htmlFor={`amount-${receipt.id}`}>Requested amount · USD</Label><Input id={`amount-${receipt.id}`} value={draft.amount} onChange={event => update('amount', event.target.value)} required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="Confirm requested amount" /></div>
                        <div><Label htmlFor={`category-${receipt.id}`}>Category</Label><select id={`category-${receipt.id}`} required value={draft.category} onChange={event => update('category', event.target.value)} className={selectClass}><option value="">Choose category</option>{['flight','hotel','train','bus','other'].map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
                        <div><Label htmlFor={`origin-${receipt.id}`}>Traveling from</Label><Input id={`origin-${receipt.id}`} value={draft.origin_location} onChange={event => update('origin_location', event.target.value)} required maxLength={200} /></div>
                        <Button type="button" variant="outline" onClick={() => { setDrafts(previous => ({ ...previous, [receipt.id]: defaults(receipt, selected) })); setConfirmations(previous => ({ ...previous, [receipt.id]: false })); }}>Refresh from linked request</Button>
                      </div>
                      {summary.amountConflict && <p className={styles.warning}>Linked requests disagree on the amount. Check the sources and enter the correct requested amount.</p>}
                      <p className={styles.muted}>Receipt totals are never used as the requested amount. Refresh replaces your edits using the linked request.</p>
                    </details>
                    <div className={styles.confirmRow}><label><input type="checkbox" required checked={!!confirmations[receipt.id]} onChange={event => setConfirmations(previous => ({ ...previous, [receipt.id]: event.target.checked }))} />I checked the documents, traveler, and requested amount.</label><Button type="submit" disabled={!!busy || selected.length > 8 || !confirmations[receipt.id]}>Confirm & send for review <ArrowRight size={15} aria-hidden="true" /></Button></div>
                    <p className={styles.muted}>This creates a claim for Sift’s policy and duplicate checks. It does not approve or pay it.</p>
                  </fieldset>
                </form>
                <details className={styles.organize}><summary>Change document connections</summary>
                  {supporting.filter(d => d.evidence && !d.error).map(document => <div key={document.id}><Label htmlFor={`case-assign-${receipt.id}-${document.id}`}>{document.filename}</Label><select id={`case-assign-${receipt.id}-${document.id}`} value={assignments[document.id] || ''} disabled={!!busy} onChange={event => assign(document.id, event.target.value)} className={selectClass}><option value="">Unassigned</option>{receipts.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}</select></div>)}
                  <Button variant="ghost" disabled={!!busy} onClick={() => { setAnchors(previous => previous.filter(id => id !== receipt.id)); setAssignments(previous => Object.fromEntries(Object.entries(previous).map(([id, target]) => [id, target === receipt.id || id === receipt.id ? '' : target]))); setDrafts(previous => { const next = { ...previous }; delete next[receipt.id]; return next; }); setConfirmations(previous => ({ ...previous, [receipt.id]: false })); }}>Use this receipt as supporting evidence</Button>
                </details>
              </div>
            </details>
          </article>;
        })}
        {!!ambiguous.length && <section className={styles.needsConnection} aria-labelledby="connection-heading"><h3 id="connection-heading"><CircleHelp size={18} aria-hidden="true" />Connections that need your help</h3><p>The evidence supports more than one match. Keep the question open until you know.</p>
          {ambiguous.map(document => {
            const suggestion = suggestions.find(s => s.document_id === document.id)!;
            const candidates = receipts.filter(r => suggestion.candidates.some(c => c.receipt_id === r.id));
            return <article key={document.id} className={styles.ambiguousCard}><Evidence document={document} /><div className={styles.candidateList}>{candidates.map(r => <div key={r.id}><FileText size={15} aria-hidden="true" /><span>{r.filename}<small>Receipt {r.evidence?.facts.receipt_number || 'number unknown'}</small></span><strong>{r.evidence?.facts.amount_minor != null ? money(r.evidence.facts.amount_minor, r.evidence.facts.currency || 'USD') : 'Unknown total'}</strong></div>)}</div>
              <p className={styles.warning}>Possible match — choose a receipt after checking the evidence.</p>
              {suggestion.candidates.flatMap(c => c.warnings).filter((w, i, all) => all.indexOf(w) === i).map(w => <p className={styles.warning} key={w}>{w}</p>)}
              <div className={styles.connectionActions}><div><Label htmlFor={`assign-${document.id}`}>Attach to receipt</Label><select id={`assign-${document.id}`} value={assignments[document.id] || ''} disabled={!!busy} onChange={event => assign(document.id, event.target.value)} className={selectClass}><option value="">Unassigned</option>{receipts.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}</select></div><Button variant="outline" onClick={() => { setComposer({ documentId: document.id, text: clarificationDraft(document, candidates) }); setCopied(false); }}>Prepare clarification <Mail size={15} aria-hidden="true" /></Button></div>
            </article>;
          })}
        </section>}
        {composer && <section className={styles.composer} aria-label="Clarification draft"><div className={styles.railHeading}><h3>Ask for the missing detail</h3><Button variant="ghost" size="icon" aria-label="Close clarification draft" onClick={() => setComposer(null)}><X size={16} /></Button></div><p>Draft only · nothing is sent. {documents.find(d => d.id === composer.documentId)?.evidence?.request.email && <>To: {documents.find(d => d.id === composer.documentId)?.evidence?.request.email}</>}</p><Label htmlFor="clarification">Message</Label><textarea id="clarification" value={composer.text} onChange={event => { setComposer({ ...composer, text: event.target.value }); setCopied(false); }} /><Button variant="outline" onClick={() => void run(async () => { await navigator.clipboard.writeText(composer.text); setCopied(true); })}><Copy size={14} aria-hidden="true" />{copied ? 'Copied' : 'Copy draft'}</Button></section>}
        {!!unmatched.length && <details className={styles.unmatched}><summary><Paperclip size={15} aria-hidden="true" />{unmatched.length} {unmatched.length === 1 ? 'file without' : 'files without'} a supported connection</summary><p>No evidence is discarded. Leave unrelated files here, or connect them after checking the original.</p>{unmatched.map(document => <div key={document.id} className={styles.unmatchedRow}><Evidence document={document} />{document.error ? <p className={styles.error}>{document.error}</p> : <><Label htmlFor={`unmatched-${document.id}`}>Attach to receipt</Label><select id={`unmatched-${document.id}`} value={assignments[document.id] || ''} disabled={!!busy} onChange={event => assign(document.id, event.target.value)} className={selectClass}><option value="">Unassigned</option>{receipts.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}</select><Button variant="ghost" disabled={!!busy || !document.evidence} onClick={() => { setAnchors(previous => [...previous, document.id]); assign(document.id, ''); setDrafts(previous => ({ ...previous, [document.id]: defaults(document, []) })); }}>Use as receipt instead</Button></>}</div>)}</details>}
        {!!results.length && <section aria-label="Saved claims" className={styles.saved}>{results.map(result => <div key={result.submission_id}><CheckCircle2 size={20} aria-hidden="true" /><div><h3>Claim sent to the review queue</h3><p>Receipt and {result.supporting_count} supporting documents saved.</p><a href={`/business-demo?claim=${encodeURIComponent(result.submission_id)}`}>Open saved claim <ArrowRight size={14} aria-hidden="true" /></a></div></div>)}</section>}
      </div>
    </div>}
  </div>;
}
