"use client";

import { useRef, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAudit } from "@/lib/dashboard/audit-session";
import { useWorkspace } from "@/lib/dashboard/workspace-store";

export function ResetDemoButton({ preview, onBusy }: { preview: boolean; onBusy(busy: boolean): void }) {
  const { data, refresh } = useWorkspace(preview);
  const audit = useAudit(preview);
  const [confirmation, setConfirmation] = useState<{ token: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  if (preview || !data?.capabilities?.demo_reset) return null;
  const active = audit.status === "running" || audit.status === "stopping" || data.submissions.some(row =>
    row.processing_status === "running" || row.receipt?.extraction_status === "pending" || row.latest_investigation?.status === "running");

  async function reset(token: string, live: boolean) {
    if (lock.current || active) return;
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const response = await fetch("/api/workspace/demo-reset", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_token: token, ...(live ? { confirmation: "reset-live-demo" } : {}) }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.reset !== true) throw new Error(result?.error?.message || "Reset could not be confirmed. Refresh the workspace before trying again.");
      // Clear review sheets, cached revisions, audit attempts, and in-flight animation history together.
      window.location.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Reset failed. Your saved data has not been confirmed reset.");
      await refresh().catch(() => {});
      setConfirmation(null);
      lock.current = false; setBusy(false); onBusy(false);
    }
  }

  return <>
    <Button variant="outline" disabled={busy || active || !data.snapshot_token} title={active ? "Finish active work before resetting." : "Archive this demo and restore 14 unchecked claims"}
      onClick={() => { setError(""); if (data.demo_mode) void reset(data.snapshot_token, false); else setConfirmation({ token: data.snapshot_token, count: data.submissions.length }); }}>
      {busy ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <RotateCcw aria-hidden="true" />}{busy ? "Resetting…" : "Reset demo"}
    </Button>
    {error && !confirmation && <p role="alert" className="max-w-sm text-sm text-destructive">{error}</p>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) { setConfirmation(null); setError(""); } }}>
      <DialogContent showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Reset the live demo?</DialogTitle><DialogDescription>
          Archive the current {confirmation?.count ?? 0} claims and their results in Supabase, clear the active demo data, and restore 14 unchecked claims. Decisions, investigations, and learned rules will start fresh. Original documents stay archived.
        </DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
          <Button variant="destructive" disabled={busy || active} onClick={() => { if (confirmation) void reset(confirmation.token, true); }}>
            {busy && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy ? "Archiving and resetting…" : "Archive and reset live demo"}
          </Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
