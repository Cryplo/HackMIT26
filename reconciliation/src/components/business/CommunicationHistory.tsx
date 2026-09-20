"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DashboardClient } from "@/lib/dashboard/ui-contracts";
import type { ClaimMessage } from "@/lib/review-contracts";

export function communicationStatus(message: ClaimMessage): string {
  if (message.status === "previewed") return "Preview saved — no email sent";
  if (message.status === "accepted") return "Decision saved — email accepted by provider";
  if (message.status === "queued") return "Decision saved — email queued";
  if (message.status === "sending") return "Decision saved — sending email";
  if (message.status === "failed") return "Decision saved — email failed";
  if (message.status === "delivery_unknown") return "Decision saved — delivery outcome unknown";
  if (message.status === "cancelled") return "Cancelled — no further delivery attempts";
  return "Draft — no decision or email sent";
}

export function CommunicationHistory({ claimId, client, revision }: { claimId: string; client: DashboardClient; revision: number }) {
  const [messages, setMessages] = useState<ClaimMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const lock = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!client.getMessages) return;
    try {
      const result = await client.getMessages(claimId, signal);
      if (signal?.aborted) return;
      setMessages([...result.messages].sort((a, b) => b.created_at.localeCompare(a.created_at))); setError(null); setLoaded(true);
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Message history could not load.");
    }
  }, [claimId, client]);
  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal);
    return () => abort.abort();
  }, [refresh, revision]);
  useEffect(() => {
    if (!messages.some(item => item.status === "queued" || item.status === "sending")) return;
    const timer = window.setTimeout(() => void refresh(), 5000);
    return () => window.clearTimeout(timer);
  }, [messages, refresh]);

  async function retry(message: ClaimMessage) {
    if (!client.retryMessage || lock.current) return;
    lock.current = true; setRetrying(message.id); setError(null);
    try { await client.retryMessage(message.id, { expected_message_revision: message.message_revision }); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Email retry failed. The recorded decision is unchanged."); }
    finally { lock.current = false; setRetrying(null); }
  }

  return <section aria-labelledby="communication-history-title" className="space-y-3 border-t pt-4">
    <div className="flex items-center justify-between gap-2"><h3 id="communication-history-title" className="font-semibold">Applicant communication</h3><Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh message history"><RotateCw className="size-4" />Refresh</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loaded && !error && <p role="status" className="text-sm text-muted-foreground">Loading saved messages…</p>}
    {loaded && !messages.length && <p className="text-sm text-muted-foreground">No applicant messages have been saved for this claim.</p>}
    <ol className="space-y-3">{messages.map(item => <li key={item.id} className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.mode === "preview" ? "Preview" : item.mode === "live" ? "Live email" : "Draft"}</Badge><span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span></div>
      <p className="mt-2 text-sm font-medium">{communicationStatus(item)}</p>
      {item.status === "accepted" && <p className="mt-1 text-xs text-muted-foreground">Provider acceptance does not confirm inbox delivery.</p>}
      {item.status === "delivery_unknown" && <p className="mt-1 text-xs text-muted-foreground">Check provider records before a new send. Any permitted retry reuses this message and delivery key.</p>}
      <p className="mt-2 break-all text-xs text-muted-foreground">To: {item.recipient}</p>
      {item.correction_id && <p className="mt-1 break-all text-xs text-muted-foreground">Decision: {item.correction_id}</p>}
      <details className="mt-2 text-sm"><summary className="cursor-pointer py-1">{item.subject || "View saved message"}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{item.rendered_text ?? item.body}</p></details>
      {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
      {item.status === "failed" && client.retryMessage && <Button className="mt-3" variant="outline" size="sm" disabled={!!retrying} onClick={() => void retry(item)}>{retrying === item.id ? "Queueing retry…" : "Retry email"}</Button>}
    </li>)}</ol>
  </section>;
}
