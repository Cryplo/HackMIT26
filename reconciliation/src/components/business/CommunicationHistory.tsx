"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DashboardClient } from "@/lib/dashboard/ui-contracts";
import type { ClaimMessage } from "@/lib/review-contracts";
import styles from "./decision-message.module.css";

export function communicationStatus(message: ClaimMessage): string {
  if (message.status === "draft" && (message.correction_id || message.automatic_decision_key)) return "Decision saved — notification awaiting confirmation";
  if (message.status === "previewed") return "Sent in demo · No real email delivered";
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


  return <details className="border-t pt-2">
    <summary className="cursor-pointer rounded py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Mail aria-hidden="true" className="mr-2 inline size-4" />Emails{loaded && <span className="ml-2 font-normal text-muted-foreground">({messages.length})</span>}</summary>
    <div className="space-y-3 pb-3">
    <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Saved messages for this claim</p><Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh message history"><RotateCw className="size-4" />Refresh</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loaded && !error && <p role="status" className="text-sm text-muted-foreground">Loading saved messages…</p>}
    {loaded && !messages.length && <p className="text-sm text-muted-foreground">No applicant messages have been saved for this claim.</p>}
    <ol className="space-y-3">{messages.map(item => <li key={item.id} className={styles.historyItem}>
      <div className={styles.historyMeta}><Badge variant="outline" className={item.mode === "preview" ? styles.previewBadge : undefined}>{item.mode === "preview" ? "Simulation" : item.mode === "live" ? "Live email" : "Draft"}</Badge><span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span></div>
      <p className="mt-2 text-sm font-medium">{communicationStatus(item)}</p>
      {item.status === "accepted" && <p className="mt-1 text-xs text-muted-foreground">Provider acceptance does not confirm inbox delivery.</p>}
      {item.status === "delivery_unknown" && <p className="mt-1 text-xs text-muted-foreground">Check provider records before a new send. Any permitted retry reuses this message and delivery key.</p>}
      <p className="mt-2 break-all text-xs text-muted-foreground">To: {item.recipient}</p>
      <details className={styles.historySubject}><summary>{item.subject || "View saved message"}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{item.rendered_text ?? item.body}</p></details>
      {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
      {item.status === "draft" && (item.correction_id || item.automatic_decision_key) && <p className="mt-2 text-xs text-muted-foreground">Send notifications together from the overview or reimbursements page when you are ready.</p>}
      {(item.status === "failed" || item.status === "delivery_unknown") && <p className="mt-2 text-xs text-muted-foreground">Eligible delivery retries appear in the notifications action on the overview and reimbursements pages. Review this recorded outcome before confirming another batch.</p>}
    </li>)}</ol>
    </div>
  </details>;
}
