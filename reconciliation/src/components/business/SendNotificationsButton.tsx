"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DashboardClient } from "@/lib/dashboard/ui-contracts";

type Pending = Awaited<ReturnType<NonNullable<DashboardClient["getNotifications"]>>>;

export function SendNotificationsButton({ client, refreshKey, disabled = false }: { client: DashboardClient; refreshKey: number; disabled?: boolean }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmation, setConfirmation] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyButton = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!client.getNotifications) return null;
    const result = await client.getNotifications(signal);
    if (!signal?.aborted) setPending(result);
    return result;
  }, [client]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Pending notifications could not load.");
    });
    return () => controller.abort();
  }, [load, refreshKey]);

  async function showHistory() {
    setHistoryOpen(true); setHistoryLoading(true); setHistoryError("");
    try { await load(); }
    catch (failure) { setHistoryError(failure instanceof Error ? failure.message : "Email history could not load."); }
    finally { setHistoryLoading(false); }
  }

  async function review() {
    if (lock.current || disabled) return;
    lock.current = true; setLoading(true); setError(""); setNotice("");
    try {
      const current = await load();
      if (current?.messages.length && current.mode !== "disabled") setConfirmation(current);
      else setNotice(current?.mode === "disabled" ? "Notification delivery is unavailable." : "No notifications are waiting to be sent.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Pending notifications could not load."); }
    finally { lock.current = false; setLoading(false); }
  }
  async function send() {
    if (!confirmation || !client.sendNotifications || lock.current) return;
    lock.current = true; setSending(true); setError(""); setNotice("");
    try {
      const result = await client.sendNotifications({ snapshot_token: confirmation.snapshot_token, message_ids: confirmation.messages.map(message => message.id), confirmed: true });
      const previewed = result.messages.filter(message => message.status === "previewed").length;
      const accepted = result.messages.filter(message => message.status === "accepted").length;
      const queued = result.messages.filter(message => message.status === "queued" || message.status === "sending").length;
      const attention = result.messages.length - previewed - accepted - queued;
      if (result.delivery_error) setError(result.delivery_error);
      setNotice(result.processed === 0 ? "No notifications were processed. Review applicant communication before trying again." : result.mode === "preview" ? `${previewed} notification previews generated. No email was sent.` : `${accepted} accepted by the email provider${queued ? `; ${queued} queued` : ""}${attention ? `; ${attention} need attention in applicant communication` : ""}. Provider acceptance does not confirm inbox delivery.`);
      setConfirmation(null);
    } catch (failure) {
      setConfirmation(null);
      setError(`${failure instanceof Error ? failure.message : "Notification sending could not be confirmed."} Review the refreshed pending count and applicant communication before sending again.`);
    } finally {
      await load().catch(() => setError(previous => previous || "Could not refresh pending notifications. Refresh the workspace before sending again."));
      lock.current = false; setSending(false);
    }
  }

  if (!client.getNotifications || !client.sendNotifications) return null;
  const preview = pending?.mode === "preview";
  const history = [...(pending?.history ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return <div className="min-w-0 max-w-full">
    <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" disabled={disabled || loading || sending || pending?.mode === "disabled" || (pending !== null && !pending.messages.length && !error)} aria-busy={loading || sending} title={pending?.mode === "disabled" ? "Notification delivery is unavailable" : pending && !pending.messages.length ? "No saved notifications are waiting" : undefined} onClick={() => void review()}>
      {loading || sending ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Mail aria-hidden="true" />}
      {sending ? preview ? "Generating previews…" : "Sending notifications…" : loading ? "Checking notifications…" : `${preview ? "Preview notifications" : "Send all notifications"} (${pending?.messages.length ?? "…"})`}
    </Button>
    <Button ref={historyButton} variant="outline" onClick={() => void showHistory()}><History aria-hidden="true" />Email history</Button>
    </div>
    {error && <p role="alert" className="mt-2 max-w-sm text-xs leading-5 text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{notice}</p>}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); historyButton.current?.focus(); }}>
        <DialogHeader className="pr-8"><DialogTitle>Email history</DialogTitle><DialogDescription>Read saved notification contents and delivery results. {preview ? "Previewed messages were not actually sent." : "Provider acceptance does not confirm inbox delivery."}</DialogDescription></DialogHeader>
        <div className="flex items-center justify-between gap-3"><p role="status" className="text-xs text-muted-foreground">{historyLoading ? "Loading email history…" : `${history.length} saved ${history.length === 1 ? "message" : "messages"}`}</p><Button variant="ghost" size="sm" disabled={historyLoading} onClick={() => void showHistory()}>{historyLoading && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}Refresh</Button></div>
        {historyError && <p role="alert" className="text-sm text-destructive">{historyError} Previously loaded messages may be out of date.</p>}
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          {!history.length && !historyLoading && !historyError && <p className="rounded-lg border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">No email history yet. Confirm a notification batch to save previews or send messages.</p>}
          <div className="space-y-3">{history.map(message => {
            const status = message.status === "previewed" ? "Previewed · Not actually sent" : message.status === "accepted" ? "Accepted by provider" : message.status === "queued" ? "Queued" : message.status === "sending" ? "Sending" : message.status === "failed" ? "Failed" : "Delivery outcome unknown";
            const needsAttention = message.status === "failed" || message.status === "delivery_unknown";
            return <details key={message.id} className="min-w-0 rounded-lg border">
              <summary className="cursor-pointer rounded-lg px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <span className="break-words font-medium">{message.subject}</span>
                <span className="mt-1 block break-all text-xs text-muted-foreground">To: {message.recipient}</span>
                <span className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-md px-2 py-1 text-xs ${needsAttention ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{status}</span>{message.mode === "preview" && message.status !== "previewed" && <span className="text-xs text-muted-foreground">Preview mode · Not actually sent</span>}<time dateTime={message.updated_at} className="text-xs text-muted-foreground">{new Date(message.updated_at).toLocaleString()}</time></span>
              </summary>
              <div className="border-t px-4 py-4"><p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{message.rendered_text ?? message.body}</p></div>
            </details>;
          })}</div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !sending) setConfirmation(null); }}>
      <DialogContent showCloseButton={!sending} onEscapeKeyDown={event => { if (sending) event.preventDefault(); }} onPointerDownOutside={event => { if (sending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{confirmation?.mode === "preview" ? "Generate notification previews?" : "Send all pending notifications?"}</DialogTitle><DialogDescription>{confirmation?.messages.length} saved approval or rejection {confirmation?.messages.length === 1 ? "notice" : "notices"}. {confirmation?.mode === "preview" ? "Preview mode will save simulated delivery results. No email will be sent." : "Confirm to send these notices to their applicants. Decisions stay unchanged and no payments are made."}</DialogDescription></DialogHeader>
        {confirmation?.messages.some(message => message.status === "failed" || message.status === "delivery_unknown") && <p className="text-sm text-muted-foreground">Includes {confirmation.messages.filter(message => message.status === "failed" || message.status === "delivery_unknown").length} eligible delivery retries using their existing saved messages.</p>}
        <details className="text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">Review recipients</summary><ul className="max-h-48 space-y-2 overflow-y-auto">{confirmation?.messages.map(message => <li key={message.id} className="break-words border-t pt-2"><p className="font-medium">{message.recipient}</p><p className="text-xs text-muted-foreground">{message.subject}</p></li>)}</ul></details>
        <DialogFooter><Button variant="outline" disabled={sending} onClick={() => setConfirmation(null)}>Cancel</Button><Button disabled={sending} aria-busy={sending} onClick={() => void send()}>{sending && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{sending ? confirmation?.mode === "preview" ? "Generating previews…" : "Sending…" : confirmation?.mode === "preview" ? "Generate previews" : "Send notifications"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
