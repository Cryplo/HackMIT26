"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, FileText, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InboxDocument, InboxSuggestion, ImportResult } from "@/lib/inbox/schema";

type Draft = { attendee_name: string; email: string; amount: string; category: string; origin_location: string };
type UploadItem = { id: string; name: string; status: "queued" | "reading" | "done" | "error"; message?: string };
const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function uniqueValue<T>(values: (T | null | undefined)[]): T | undefined {
  const unique = [...new Set(values.filter((value): value is T => value != null && value !== ""))];
  return unique.length === 1 ? unique[0] : undefined;
}

function defaults(receipt: InboxDocument, supporting: InboxDocument[]): Draft {
  const requests = [...supporting, receipt].flatMap(d => d.evidence ? [d.evidence.request] : []);
  const amount = uniqueValue(requests.map(r => r.amount_requested_minor));
  const names = requests.map(r => r.attendee_name).filter(Boolean);
  return {
    attendee_name: uniqueValue(names.length ? names : receipt.evidence?.facts.names || []) || "",
    email: uniqueValue(requests.map(r => r.email)) || "",
    amount: amount == null ? "" : (amount / 100).toFixed(2),
    category: uniqueValue(requests.map(r => r.category)) || "",
    origin_location: uniqueValue(requests.map(r => r.origin_location)) || "",
  };
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "This request failed. Please try again.");
  return data;
}

function Evidence({ document }: { document: InboxDocument }) {
  const facts = document.evidence?.facts;
  return <div className="min-w-0 space-y-2 text-sm">
    <a href={`/api/inbox/${document.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 max-w-full items-center gap-1 underline underline-offset-4"><span className="break-all">{document.filename}</span><ArrowUpRight className="size-3 shrink-0" aria-hidden="true" /></a>
    {facts && <p className="break-words text-xs leading-5 text-muted-foreground">{[facts.vendor, ...facts.names, facts.purchase_date, facts.amount_minor == null ? null : `${facts.currency || "Unknown currency"} ${(facts.amount_minor / 100).toFixed(2)}`, facts.booking_reference ? `Reference ${facts.booking_reference}` : null].filter(Boolean).join(" · ") || "No receipt facts found."}</p>}
    {document.evidence?.raw_extracted_text && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1">Extracted text</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3">{document.evidence.raw_extracted_text}</p></details>}
  </div>;
}

export default function ImportWorkspace({ mode }: { mode: "demo" | "live" | "unconfigured" }) {
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
  const lock = useRef(false);
  const available = documents.filter(d => !consumed.includes(d.id));
  const receipts = available.filter(d => anchors.includes(d.id));
  const supporting = available.filter(d => !anchors.includes(d.id));
  const linked = (id: string) => supporting.filter(d => assignments[d.id] === id);

  function assign(documentId: string, receiptId: string) {
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
      if (!(suggestion.document_id in next)) next[suggestion.document_id] = suggestion.suggested_receipt_id && receiptIds.includes(suggestion.suggested_receipt_id) ? suggestion.suggested_receipt_id : "";
    }
    setAssignments(next);
    setConfirmations({});
    setDrafts(previous => {
      const updated = { ...previous };
      for (const receipt of all.filter(d => receiptIds.includes(d.id))) {
        updated[receipt.id] ??= defaults(receipt, all.filter(d => next[d.id] === receipt.id));
      }
      return updated;
    });
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    if (uploads.length + files.length > 12) throw new Error("This inbox supports up to 12 files per session. Refresh to start another batch after saving your claims.");
    const items = files.map(file => ({ id: crypto.randomUUID(), name: file.name, status: "queued" as const }));
    setUploads(previous => [...previous, ...items]);
    const added: InboxDocument[] = [];
    let cursor = 0;
    setBusy("Reading paperwork…");
    async function worker() {
      while (cursor < files.length) {
        const index = cursor++;
        const file = files[index], item = items[index];
        const update = (patch: Partial<UploadItem>) => setUploads(previous => previous.map(u => u.id === item.id ? { ...u, ...patch } : u));
        update({ status: "reading" });
        try {
          if (!file.size || file.size > 8 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Use a PDF, PNG, or JPG up to 8 MB.");
          const body = new FormData();
          body.set("file", file);
          const document = await json<InboxDocument>("/api/inbox", { method: "POST", body });
          if ([...documents, ...added].some(d => d.sha256 === document.sha256)) {
            update({ status: "done", message: "Duplicate file skipped" });
            continue;
          }
          added.push(document);
          setDocuments(previous => [...previous, document]);
          update({ status: document.error ? "error" : "done", message: document.error || undefined });
        } catch (e) { update({ status: "error", message: e instanceof Error ? e.message : "Upload failed." }); }
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

  async function samples() {
    setBusy("Loading sample paperwork…");
    const { samples } = await json<{ samples: { name: string; url: string }[] }>("/api/inbox/samples");
    const files = await Promise.all(samples.map(async sample => {
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error("Could not load sample paperwork.");
      return new File([await response.blob()], sample.name, { type: "application/pdf" });
    }));
    await upload(files);
  }

  async function confirm(event: FormEvent<HTMLFormElement>, receipt: InboxDocument) {
    event.preventDefault();
    await run(async () => {
      if (!confirmations[receipt.id]) throw new Error("Please check the current documents and request before confirming.");
      const draft = drafts[receipt.id];
      if (!/^\d+(\.\d{1,2})?$/.test(draft.amount)) throw new Error("Enter a USD amount with no more than two decimal places.");
      const [whole, fraction = ""] = draft.amount.split(".");
      const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (!Number.isSafeInteger(cents) || cents > 2147483647) throw new Error("Requested amount must be between $0.00 and $21,474,836.47.");
      const selected = linked(receipt.id);
      if (selected.length > 8) throw new Error("Attach no more than eight supporting documents to a claim.");
      setBusy("Saving claim…");
      const result = await json<ImportResult>("/api/inbox/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_id: receipt.id, supporting_ids: selected.map(d => d.id), confirmed: true,
          submission: { attendee_name: draft.attendee_name, email: draft.email, amount_requested_minor: String(cents), currency: "USD", category: draft.category, origin_location: draft.origin_location } }),
      });
      setResults(previous => [...previous, result]);
      setConsumed(previous => [...previous, receipt.id, ...selected.map(d => d.id)]);
      setAnchors(previous => previous.filter(id => id !== receipt.id));
    });
  }

  return <div className="space-y-6">
    <section aria-labelledby="upload-heading" className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 id="upload-heading" className="text-base font-semibold">1. Add your paperwork</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{mode === "demo" ? "Simulated extraction · exact sample files use authored facts. Other uploads stay unknown." : mode === "live" ? "Live AI extraction · documents are read once, then matched by their facts." : "Configure extraction on the server before importing."}</p></div>
        <Button variant="outline" disabled={!!busy || mode === "unconfigured" || uploads.length > 0} onClick={() => void run(samples)}>Try sample paperwork</Button>
      </div>
      <div className="mt-5 rounded-lg border border-dashed border-input bg-muted/30 p-4">
        <Label htmlFor="paperwork" className="mb-3 flex items-center gap-2"><Upload className="size-4" aria-hidden="true" />Upload receipts, bookings, or email PDFs</Label>
        <input id="paperwork" type="file" multiple accept="application/pdf,image/png,image/jpeg" disabled={!!busy || mode === "unconfigured" || uploads.length >= 12} aria-describedby="paperwork-help" className="w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 focus-visible:outline-2 focus-visible:outline-ring" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void run(() => upload(files)); }} />
        <p id="paperwork-help" className="mt-3 text-xs leading-5 text-muted-foreground">PDF, PNG, JPG · 8 MB per file · up to 12 files. Synthetic documents only. Keep this page open until you save your claims.</p>
      </div>
      {!!uploads.length && <ul className="mt-4 divide-y divide-border">{uploads.map(item => <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-xs"><span className="min-w-0 break-all">{item.name}</span><span className={`max-w-[55%] shrink-0 text-right ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{item.message || ({ queued: "Queued", reading: "Reading…", done: "Read", error: "Failed" }[item.status])}</span></li>)}</ul>}
      <p role="status" aria-live="polite" className="mt-3 flex min-h-5 items-center gap-2 text-xs text-muted-foreground">{busy && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}{busy || (documents.length ? `${available.length} documents awaiting confirmation` : "No documents imported yet")}</p>
    </section>

    {error && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

    {!!supporting.length && <section aria-labelledby="link-heading" className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <h2 id="link-heading" className="text-base font-semibold">2. Check the connections</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Each supporting document belongs to one claim. Uncertain matches stay unassigned; a shared amount alone is not enough.</p>
      <div className="mt-4 divide-y divide-border">{supporting.map(document => {
        const suggestion = suggestions.find(s => s.document_id === document.id);
        const candidate = suggestion?.candidates.find(c => c.receipt_id === assignments[document.id]);
        const warnings = [...new Set((candidate ? candidate.warnings : suggestion?.candidates.flatMap(c => c.warnings) || []))];
        return <article key={document.id} className="grid min-w-0 gap-4 py-4 md:grid-cols-[1fr_18rem]">
          <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{document.evidence?.document_kind.replaceAll("_", " ") || "Unread document"}</p><Evidence document={document} />
            {document.error && <p className="mt-2 text-xs text-destructive">{document.error}</p>}
            {candidate && <p className="mt-2 text-xs leading-5 text-muted-foreground">{candidate.reasons.join(" · ")}</p>}
            {!assignments[document.id] && !!suggestion?.candidates.length && <p className="mt-2 text-xs text-amber-800">Possible match — choose a receipt after checking the evidence.</p>}
            {!assignments[document.id] && !!suggestion?.candidates.length && <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">{suggestion.candidates.filter(c => receipts.some(r => r.id === c.receipt_id)).map(c => <li key={c.receipt_id}><span className="font-medium">{receipts.find(r => r.id === c.receipt_id)?.filename}</span>: {c.reasons.join(" · ")}</li>)}</ul>}
            {warnings.map(warning => <p key={warning} className="mt-1 text-xs leading-5 text-amber-800">{warning}</p>)}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`assign-${document.id}`}>Attach to receipt</Label>
            <select id={`assign-${document.id}`} className={selectClass} value={assignments[document.id] || ""} disabled={!!busy || !document.evidence || !!document.error} onChange={event => assign(document.id, event.target.value)}><option value="">Unassigned</option>{receipts.map(receipt => <option key={receipt.id} value={receipt.id}>{receipt.filename}</option>)}</select>
            <Button variant="ghost" className="h-10 px-1 text-xs" disabled={!!busy || !document.evidence || !!document.error} onClick={() => { setAnchors(previous => [...previous, document.id]); assign(document.id, ""); setDrafts(previous => ({ ...previous, [document.id]: defaults(document, []) })); }}>Use as receipt instead</Button>
          </div>
        </article>;
      })}</div>
    </section>}

    {!!receipts.length && <section aria-labelledby="draft-heading" className="space-y-4">
      <div><h2 id="draft-heading" className="text-base font-semibold">3. Confirm your draft claims</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Receipt totals are evidence. Requested amounts come from an explicit request or your confirmation.</p></div>
      {receipts.map(receipt => {
        const draft = drafts[receipt.id];
        if (!draft) return null;
        const selected = linked(receipt.id);
        const amountConflict = new Set([...selected, receipt].map(d => d.evidence?.request.amount_requested_minor).filter(amount => amount != null)).size > 1;
        const update = (field: keyof Draft, value: string) => {
          setDrafts(previous => ({ ...previous, [receipt.id]: { ...previous[receipt.id], [field]: value } }));
          setConfirmations(previous => ({ ...previous, [receipt.id]: false }));
        };
        return <article key={receipt.id} className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-4 text-sm font-semibold"><FileText className="size-4" aria-hidden="true" />Draft claim · {receipt.evidence?.facts.names[0] || "Confirm traveler"}</div>
          <div className="grid min-w-0 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="min-w-0 space-y-5 border-b border-border p-5 lg:border-r lg:border-b-0">
              <div><h3 className="mb-1 text-xs font-semibold">Receipt evidence</h3><Evidence document={receipt} /></div>
              <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={!!busy} onClick={() => {
                setAnchors(previous => previous.filter(id => id !== receipt.id));
                setAssignments(previous => Object.fromEntries(Object.entries(previous).map(([id, target]) => [id, target === receipt.id || id === receipt.id ? "" : target])));
                setDrafts(previous => { const next = { ...previous }; delete next[receipt.id]; return next; });
                setConfirmations(previous => ({ ...previous, [receipt.id]: false }));
              }}>Use as supporting document</Button>
              <div><h3 className="mb-2 text-xs font-semibold">Supporting documents ({selected.length}/8)</h3>{selected.length ? <div className="space-y-4">{selected.map(document => <Evidence key={document.id} document={document} />)}</div> : <p className="text-xs leading-5 text-muted-foreground">No linked documents. Attach any relevant requests or bookings above.</p>}</div>
              <p className="text-xs leading-5 text-muted-foreground">{mode === "demo" ? "Simulated · authored sample extraction" : "Live AI extraction"}{receipt.latency_ms != null ? ` · ${(receipt.latency_ms / 1000).toFixed(1)}s extraction` : ""}</p>
            </div>
            <form className="min-w-0 p-5" onSubmit={event => void confirm(event, receipt)}>
              <fieldset disabled={!!busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
                <legend className="mb-4 text-sm font-semibold">Reimbursement request</legend>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor={`name-${receipt.id}`}>Attendee name</Label><Input id={`name-${receipt.id}`} value={draft.attendee_name} onChange={event => update("attendee_name", event.target.value)} required maxLength={200} className="h-11" autoComplete="off" /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor={`email-${receipt.id}`}>Email</Label><Input id={`email-${receipt.id}`} type="email" value={draft.email} onChange={event => update("email", event.target.value)} required maxLength={254} className="h-11" autoComplete="off" /></div>
                <div className="space-y-2"><Label htmlFor={`amount-${receipt.id}`}>Requested amount · USD</Label><Input id={`amount-${receipt.id}`} value={draft.amount} onChange={event => update("amount", event.target.value)} required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="Confirm requested amount" className="h-11" /></div>
                <div className="space-y-2"><Label htmlFor={`category-${receipt.id}`}>Category</Label><select id={`category-${receipt.id}`} required value={draft.category} onChange={event => update("category", event.target.value)} className={selectClass}><option value="">Choose category</option>{["flight", "hotel", "train", "bus", "other"].map(category => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></div>
                {amountConflict && <p className="text-xs leading-5 text-amber-800 sm:col-span-2">Linked requests disagree on the amount. Check the sources and enter the correct requested amount.</p>}
                <div className="space-y-2 sm:col-span-2"><Label htmlFor={`origin-${receipt.id}`}>Traveling from</Label><Input id={`origin-${receipt.id}`} value={draft.origin_location} onChange={event => update("origin_location", event.target.value)} required maxLength={200} className="h-11" /></div>
                <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal sm:col-span-2" onClick={() => { setDrafts(previous => ({ ...previous, [receipt.id]: defaults(receipt, selected) })); setConfirmations(previous => ({ ...previous, [receipt.id]: false })); }}>Refresh fields from linked request</Button>
                <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Changing document connections keeps your edits. Refresh replaces these fields using the currently linked evidence.</p>
                <label className="flex items-start gap-2 text-xs leading-5 sm:col-span-2"><input type="checkbox" required checked={!!confirmations[receipt.id]} onChange={event => setConfirmations(previous => ({ ...previous, [receipt.id]: event.target.checked }))} className="mt-1 size-4 shrink-0 accent-primary" />I checked the documents, traveler, and requested amount.</label>
                <Button type="submit" className="h-11 sm:col-span-2" disabled={!!busy || selected.length > 8 || !confirmations[receipt.id]}>Confirm & send for review <ArrowUpRight className="size-4" aria-hidden="true" /></Button>
              </fieldset>
            </form>
          </div>
        </article>;
      })}
    </section>}

    {!!results.length && <section aria-label="Saved claims" className="space-y-3">{results.map(result => <div key={result.submission_id} role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-5 text-sm"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" aria-hidden="true" />Claim saved with {result.supporting_count} supporting documents.</p><a href={`/business-demo?claim=${encodeURIComponent(result.submission_id)}`} className="mt-2 inline-flex min-h-11 items-center gap-1 underline underline-offset-4">Open saved claim <ArrowUpRight className="size-4" aria-hidden="true" /></a></div>)}</section>}
  </div>;
}
