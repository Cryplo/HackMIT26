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
  if (!data || (!preview && !data.capabilities?.demo_reset)) return null;
  const active = audit.status === "running" || audit.status === "stopping" || data.submissions.some(row =>
    row.processing_status === "running" || row.receipt?.extraction_status === "pending" || row.latest_investigation?.status === "running");
  const confirmationChanged = !!confirmation && confirmation.token !== data.snapshot_token;

  async function reset(token: string, live: boolean) {
    if (lock.current || active) return;
    if (live && token !== data?.snapshot_token) {
      setError("The workspace changed while confirmation was open. Cancel and open Reset demo again to review the current state.");
      return;
    }
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try {
      if (preview) { window.location.reload(); return; }
      const response = await fetch("/api/workspace/demo-reset", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_token: token, ...(live ? { confirmation: "reset-live-demo" } : {}) }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok && result?.error?.code === "STALE_SNAPSHOT") throw new Error("The workspace changed. Review the refreshed claims, then open Reset demo again to confirm the current state. No reset was performed.");
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
    <Button variant="outline" disabled={busy || active || (!preview && !data.snapshot_token)} title={active ? "Finish active work before resetting." : preview ? "Restore the original synthetic preview claims" : data.demo_mode ? "Archive this demo and restore fresh unchecked demo claims" : "Restore 70 prepared claims and 10 unchecked claims"}
      onClick={() => { setError(""); if (preview || data.demo_mode) void reset(data.snapshot_token, false); else setConfirmation({ token: data.snapshot_token, count: data.submissions.length }); }}>
      {busy ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <RotateCcw aria-hidden="true" />}{busy ? "Restoring saved demo…" : "Reset demo"}
    </Button>
    {error && !confirmation && <p role="alert" className="max-w-sm text-sm text-destructive">{error}</p>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) { setConfirmation(null); setError(""); } }}>
      <DialogContent showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Reset the live demo?</DialogTitle><DialogDescription>
          Archive the current {confirmation?.count ?? 0} claims and their results in Supabase. Restore the saved demo: 70 claims with prepared history, 10 unchecked claims, and one inactive example rule. Original documents are retained.
        </DialogDescription></DialogHeader>
        {confirmationChanged && !busy && <p role="alert" className="text-sm text-destructive">The workspace changed while this confirmation was open. Cancel and open Reset demo again to review the current state.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
          <Button variant="destructive" disabled={busy || active || confirmationChanged} aria-busy={busy} onClick={() => { if (confirmation) void reset(confirmation.token, true); }}>
            {busy && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy ? "Restoring saved demo…" : "Archive and reset live demo"}
          </Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
