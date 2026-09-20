"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Clock3, CircleAlert, CircleCheck, CircleX, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAudit } from "@/lib/dashboard/audit-session";
import { Button } from "@/components/ui/button";
import { auditBucket, checkState, claimReason, humanActions, nextHumanAction } from "@/lib/dashboard/human-actions";
import { confirmedFailures, rejectConfirmedFailures } from "@/lib/dashboard/bulk-decisions";
import { money } from "@/lib/dashboard/helpers";
import { claimedTotals, totalsLabel } from "@/lib/dashboard/review";
import { getWorkspaceStore } from "@/lib/dashboard/client";
import type { ReviewRow } from "@/lib/dashboard/types";
import { useWorkspace } from "@/lib/dashboard/workspace-store";
import { SendNotificationsButton } from "./SendNotificationsButton";
import { AppShell } from "./AppShell";
import { LearningStatus } from "./ProcedurePanel";
import { ReviewSheet } from "./ReviewSheet";
import { AuditClaimsDialog } from "./AuditClaimsDialog";
import { AuditFlow } from "./AuditFlow";
import styles from "./human-dashboard.module.css";

export default function HumanDashboard({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const audit = useAudit(preview);
  const previousAudit = useRef(audit.status);
  const [completion, setCompletion] = useState<{ title: string; detail: string } | null>(null);
  const { client, data, loading, error, refresh, updatedAt } = useWorkspace(preview);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [backIds, setBackIds] = useState<string[]>([]);
  const bucketTrigger = useRef<HTMLButtonElement>(null);
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<{ ids: string[] } | null>(null);
  const [batch, setBatch] = useState<{ completed: number; total: number } | null>(null);
  const [batchError, setBatchError] = useState("");
  const batchLock = useRef(false);
  const rows = data?.submissions ?? [];
  const preparedCount = rows.filter(row => row.decisions.some(check => check.evidence_json.demo_baseline === true)).length;
  const learningRows = rows.filter(row => row.learning);
  const learningPending = learningRows.filter(row => ["queued", "checking", "testing"].includes(row.learning!.status)).length;
  const actions = data ? humanActions(data) : [];
  const pendingCount = rows.filter(row => row.decision_status === "pending").length;
  const uncertain = actions.filter(action => action.group === "inconclusive");
  const failures = actions.filter(action => action.group === "confirmed_fail");
  const passed = actions.filter(action => action.group === "passed");
  const failedChecks = actions.filter(action => action.group === "check_failed");
  const visible = uncertain.map(action => action.row);
  const remaining = session ? actions.filter(action => session.ids.includes(action.row.id)).length : 0;
  const active = rows.find(row => row.id === activeId) ?? null;
  const pendingChecks = rows.filter(row => row.decision_status === "pending" && checkState(row) === "unchecked");
  const buckets = [
    { key: "unchecked", label: "Unchecked", detail: "Waiting or checking", Icon: Clock3 },
    { key: "approved", label: "Approved", detail: "Decision saved", Icon: CircleCheck },
    { key: "review", label: "Needs review", detail: "Uncertain or issues to resolve", Icon: CircleAlert },
    { key: "rejected", label: "Rejected", detail: "Decision saved", Icon: CircleX },
  ].map(bucket => ({ ...bucket, rows: rows.filter(row => auditBucket(row) === bucket.key) }));
  const distributionBuckets = [...buckets.slice(1), buckets[0]];
  const approved = buckets[1].rows;
  const decided = approved.length + buckets[3].rows.length;
  const completedIds = session ? session.ids.filter(id => rows.some(row => row.id === id && row.decision_status !== "pending")) : [];
  useEffect(() => {
    const wasRunning = previousAudit.current === "running" || previousAudit.current === "stopping";
    const began = audit.status === "running" && previousAudit.current !== "running";
    previousAudit.current = audit.status;
    if (began) { setCompletion(null); setSession(null); }
    if (wasRunning && audit.status === "complete" && audit.total > 0 && audit.done === audit.total) {
      const pending = rows.filter(row => row.decision_status === "pending").length;
      setCompletion({ title: pending ? "Checks complete" : "Audit complete", detail: `${audit.done} checked this session.` });
    }
  }, [audit.status, audit.done, audit.total, rows]);
  const automatic = approved.filter(row => row.decision_source === "automatic");
  const businessHref = `/business-demo${preview ? "?preview=1" : ""}`;
  const openView = (view: "reviews" | "rules") => router.push(`${businessHref}${view === "rules" ? `${preview ? "&" : "?"}view=rules` : ""}`);
  const openClaim = (id: string) => { if (batchLock.current) return; setNotice(""); if (activeId && activeId !== id) setBackIds(ids => [...ids, activeId]); setActiveId(id); };
  function startReview(id: string) {
    if (batchLock.current) return;
    setSession(actions.some(action => action.row.id === id) ? { ids: actions.map(action => action.row.id) } : null);
    setBackIds([]);
    openClaim(id);
  }

  async function advanceQueue(saved: ReviewRow) {
    const fresh = getWorkspaceStore(preview ? "preview" : "api").getSnapshot().data;
    if (!fresh || !session) return;
    const completed = session.ids.filter(id => fresh.submissions.some(row => row.id === id && row.decision_status !== "pending"));
    const next = nextHumanAction(fresh, saved.id, session.ids);
    setBackIds([]);
    setActiveId(next?.id ?? null);
    setNotice("");
    if (!next) {
      const pending = fresh.submissions.filter(row => row.decision_status === "pending").length;
      setCompletion({ title: pending ? "Review queue complete" : "Audit complete", detail: `${completed.length} of ${session.ids.length} decisions saved this session.` });
      setSession(null);
    }
  }

  async function rejectAll() {
    if (!data || batchLock.current) return;
    const frozen = confirmedFailures(data);
    if (!frozen.length) return;
    batchLock.current = true;
    setBatch({ completed: 0, total: frozen.length }); setBatchError(""); setNotice("");
    try {
      const result = await rejectConfirmedFailures(frozen, async () => {
        await refresh();
        const fresh = getWorkspaceStore(preview ? "preview" : "api").getSnapshot().data;
        if (!fresh) throw new Error("Unable to refresh the saved claims.");
        return fresh;
      }, input => client.decide(input), completed => setBatch({ completed, total: frozen.length }));
      if (result.error) setBatchError(result.error);
      else {
        setNotice(`${result.completed} confirmed failures rejected. Decisions are saved; notifications await your confirmation.`);
        const fresh = getWorkspaceStore(preview ? "preview" : "api").getSnapshot().data;
        if (fresh?.submissions.length && fresh.submissions.every(row => row.decision_status !== "pending")) setCompletion({ title: "Audit complete", detail: `${fresh.submissions.length} claims finished.` });
      }
    } finally { batchLock.current = false; setBatch(null); }
  }

  return <AppShell view="overview" onViewChange={openView} preview={preview}>
    <header className={styles.header}>
      <div><h1>Audit overview</h1><p>Watch claims move through checks, then resolve the exceptions.</p>
        {session && <div className={styles.sessionProgress}><span>Review queue · {completedIds.length} / {session.ids.length} decided</span><progress value={completedIds.length} max={session.ids.length || 1} aria-label="Review session progress" /></div>}
      </div>
      <div className={styles.refresh}><SendNotificationsButton client={client} refreshKey={updatedAt} disabled={!!batch} /><Button data-review-focus-fallback variant="ghost" disabled={loading} aria-busy={loading} onClick={() => void refresh().catch(() => {})}><RefreshCw aria-hidden="true" className={loading ? "motion-safe:animate-spin" : undefined} />{loading ? "Refreshing…" : "Refresh"}</Button>{updatedAt > 0 && <span>Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}</div>
    </header>
    {preview && <p className={styles.notice}>Synthetic preview. Claims, agent activity, and decisions here are simulated.</p>}
    {!preview && data?.demo_mode && <p className={styles.demoNote}>Demo workspace · Fictional claims and simulated checks</p>}
    {error && <p role="alert" className={styles.error}>{error} Use Refresh to try again.</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {batchError && <p role="alert" className={styles.error}>{batchError}</p>}
    {!data && !error && <div role="status" className={styles.empty}><LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /><p>Loading saved claims…</p></div>}
    {data && <>
      {preparedCount > 0 && <p className={styles.notice}>{preparedCount} claims have prepared demo history. New checks use this workspace’s configured providers.</p>}
      {(!data.coverage?.complete || data.coverage.returned !== rows.length || data.coverage.total !== rows.length) && <p className={styles.notice}>Showing {rows.length} loaded claims{data.coverage ? ` of ${data.coverage.total}` : ""}. Counts below describe this snapshot; coverage is incomplete.</p>}
      <AuditClaimsDialog returnFocusRef={bucketTrigger} title={buckets.find(b => b.key === expandedBucket)?.label ?? "Claims"} items={(buckets.find(b => b.key === expandedBucket)?.rows ?? []).map(row => ({ row, label: row.decision_status === "pending" ? claimReason(row) : row.decision_status === "approved" ? "Approved" : "Rejected" }))} open={expandedBucket !== null} onOpenChange={open => { if (!open) setExpandedBucket(null); }} onReview={startReview} />
      <section className={styles.statusSummary} aria-label="Claim status summary">
        <dl className={styles.statusCards}>{buckets.map(({ key, label, detail, Icon, rows: group }) => <div key={key} data-tone={key} className={styles.statusCard}>
          <dt><button type="button" className="cursor-pointer rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Expand ${label} summary`} aria-haspopup="dialog" onClick={event => { bucketTrigger.current = event.currentTarget; setExpandedBucket(key); }}>{label}</button><Icon aria-hidden="true" /></dt>
          <dd className={styles.statusCount}>{group.length}<span>{totalsLabel(claimedTotals(group))}</span></dd>
          <dd className={styles.statusHint}>{detail}</dd>
        </div>)}</dl>
        <div className={styles.distribution}>
          <div className={styles.distributionHeading}><span><strong>{rows.length} claims</strong> · {totalsLabel(claimedTotals(rows))} requested</span><span>{decided} / {rows.length} decisions saved</span></div>
          <div className={styles.distributionBar} role="img" aria-label={distributionBuckets.map(bucket => `${bucket.rows.length} ${bucket.label.toLowerCase()}`).join(", ")}>{distributionBuckets.map(bucket => <span key={bucket.key} data-tone={bucket.key} style={{ width: `${rows.length ? bucket.rows.length / rows.length * 100 : 0}%` }} />)}</div>
          <div className={styles.distributionLegend}>{distributionBuckets.map(bucket => <span key={bucket.key}><i data-tone={bucket.key} />{bucket.label} · {bucket.rows.length}</span>)}</div>
        </div>
      </section>
      {learningRows.length > 0 && <details className={styles.queueDetails}>
        <summary>Learning from reviews <span>{learningPending ? `${learningPending} in progress` : `${learningRows.filter(row => row.learning?.status === "active").length} saved checks`}</span></summary>
        <ul className="space-y-2 px-4 pb-4">{learningRows.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 border-t pt-2"><button className="min-h-11 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary" onClick={() => openClaim(row.id)}>{row.attendee_name}</button><LearningStatus row={row} /></li>)}</ul>
      </details>}
      <AuditFlow preview={preview} onReview={startReview} />
      <details className={styles.queueDetails}>
        <summary>Review queues and bulk actions <span>{actions.length} awaiting your decision</span></summary>
      <div className={styles.layout}>
        <section className={styles.queue} aria-labelledby="action-queue-heading">
          <div className={styles.sectionHeading}><h2 id="action-queue-heading" className={styles.amber}><CircleAlert aria-hidden="true" />Uncertain · needs your judgment <span>{visible.length}</span></h2><Link className={styles.textLink} href={businessHref}>All claims <ArrowUpRight aria-hidden="true" /></Link></div>
          {visible.length ? <ul className={styles.claims}>{visible.map(row => {
            const action = actions.find(item => item.row.id === row.id);
            const reason = action?.reason ?? claimReason(row);
            return <li key={row.id}>
              <div className={styles.claimTop}><div><h3 className={styles.claimName}>{row.attendee_name}</h3><p>{row.receipt?.parsed_fields_json?.vendor || "Merchant not available"}</p></div><strong className={styles.amount}>{money(row.amount_requested_minor, row.currency)}</strong></div>
              <div className={styles.reason}><p>{reason}</p></div>
              <div className={styles.claimActions}><Button variant="outline" size="sm" disabled={!!batch} onClick={() => startReview(row.id)}>Review claim<ArrowRight aria-hidden="true" /></Button></div>
            </li>;
          })}</ul> : <div className={styles.empty}><ShieldCheck aria-hidden="true" /><h3>{rows.length ? "No uncertain claims" : "No claims yet"}</h3><p>{rows.length ? pendingChecks.length ? "Unchecked claims are waiting in the check queue." : "Claims with unresolved questions will appear here." : "Submitted receipts will appear here for checks and review."}</p>{!rows.length && <Button asChild variant="outline"><Link href="/submit">Submit a claim</Link></Button>}</div>}
          <div className={styles.queueFooter}><span>{data.capabilities?.automatic_processing ? "Clean claims are approved within your existing expense-policy limits." : "Your decision is required before reimbursement is approved."}</span></div>
        </section>
        {failures.length > 0 && <section className={`${styles.group} ${styles.failureGroup}`} aria-labelledby="failures-heading">
          <div className={styles.sectionHeading}><div><h2 id="failures-heading" className={styles.red}><CircleX aria-hidden="true" />Confirmed failures <span>{failures.length}</span></h2><p>Saved evidence supports rejection. Each displayed reason will be recorded.</p></div></div>
          <ul className={styles.compactClaims}>{failures.map(({ row, rejectionReason }) => <li key={row.id}>
            <div><h3>{row.attendee_name}<span>{money(row.amount_requested_minor, row.currency)}</span></h3><p>{rejectionReason?.replace(/^Rejected: /, "")}</p></div>
            <Button variant="outline" size="sm" disabled={!!batch} onClick={() => startReview(row.id)}>Review<ArrowRight aria-hidden="true" /></Button>
          </li>)}</ul>
          <Button variant="destructive" disabled={!!batch} aria-busy={!!batch} onClick={() => void rejectAll()}>{batch ? <><LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />Rejecting… {batch.completed} / {batch.total}</> : `Reject all confirmed failures (${failures.length})`}</Button>
        </section>}
        {batch && <div role="status" className={styles.runningBanner}><LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /><span>Rejecting confirmed failures · {batch.completed} of {batch.total} saved</span><progress value={batch.completed} max={batch.total} aria-label="Bulk rejection progress" /></div>}
        {passed.length > 0 && <section className={`${styles.group} ${styles.passedGroup}`} aria-labelledby="passed-heading">
          <div className={styles.sectionHeading}><div><h2 id="passed-heading" className={styles.green}><CircleCheck aria-hidden="true" />Passed · awaiting approval <span>{passed.length}</span></h2><p>Checks passed. These claims are ready for approval.</p></div></div>
          <ul className={styles.compactClaims}>{passed.map(({ row }) => <li key={row.id}><div><h3>{row.attendee_name}<span>{money(row.amount_requested_minor, row.currency)}</span></h3></div><Button variant="outline" size="sm" disabled={!!batch} onClick={() => startReview(row.id)}>Review<ArrowRight aria-hidden="true" /></Button></li>)}</ul>
        </section>}
        {automatic.length > 0 && <div className={styles.autoSummary}><CircleCheck aria-hidden="true" /><span><strong>{automatic.length} approved automatically</strong> · {totalsLabel(claimedTotals(automatic))} · no manual review needed</span></div>}
        {failedChecks.length > 0 && <section className={styles.group} aria-labelledby="failed-checks-heading">
          <div className={styles.sectionHeading}><div><h2 id="failed-checks-heading"><RefreshCw aria-hidden="true" />Checks need retry <span>{failedChecks.length}</span></h2><p>These checks could not finish. Review the receipt and retry.</p></div></div>
          <ul className={styles.compactClaims}>{failedChecks.map(({ row, reason }) => <li key={row.id}><div><h3>{row.attendee_name}<span>{money(row.amount_requested_minor, row.currency)}</span></h3><p>{reason}</p></div><Button variant="outline" size="sm" disabled={!!batch} onClick={() => startReview(row.id)}>Review / retry<ArrowRight aria-hidden="true" /></Button></li>)}</ul>
        </section>}
      </div>
      </details>
    </>}
    <Dialog open={!!completion && !activeId} onOpenChange={open => { if (!open) setCompletion(null); }}>
      <DialogContent className={styles.completion}>
        <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${5 + i * 5}%`, animationDelay: `${i % 5 * 60}ms`, background: ["#2e7657", "#e7b94d", "#83bc97"][i % 3] }} />)}</div>
        <div className={styles.completionIcon}><CircleCheck aria-hidden="true" /></div>
        <DialogTitle>{completion?.title}</DialogTitle>
        <DialogDescription>{completion?.detail} {pendingCount ? `${actions.length} awaiting a decision; ${pendingCount - actions.length} still unchecked or running.` : "Every claim has a saved decision."}</DialogDescription>
        {audit.sources?.enabled && audit.sources.held.length > 0 && <p className="text-sm text-muted-foreground">{audit.sources.held.length} source inputs still need a connection or missing details. <Link className="underline" href="/import?audit=1">Inspect unresolved inputs</Link></p>}
        <Button onClick={() => { setCompletion(null); if (actions.length) startReview(actions[0].row.id); else if (!pendingCount) router.push(businessHref); }}>{actions.length ? "Review remaining claims" : pendingCount ? "Back to audit" : "View all claims"}<ArrowRight aria-hidden="true" /></Button>
      </DialogContent>
    </Dialog>
    <ReviewSheet row={active} rows={rows} open={!!activeId} onOpenChange={open => { if (!open) { setActiveId(null); setBackIds([]); } }} client={client} knowledgeRevision={data?.knowledge_revision ?? 0} simulatedEnvironment={data?.demo_mode === true} capabilities={data?.capabilities} onOpenClaim={openClaim} onChanged={refresh} onDecisionSaved={advanceQueue} queueRemaining={remaining} queueProgress={session ? { completed: completedIds.length, total: session.ids.length } : undefined} onOpenRules={() => { setActiveId(null); openView("rules"); }} backId={backIds.at(-1) ?? null} onBack={() => { const previous = backIds.at(-1); if (previous) { setBackIds(ids => ids.slice(0, -1)); setActiveId(previous); } }} />
  </AppShell>;
}
