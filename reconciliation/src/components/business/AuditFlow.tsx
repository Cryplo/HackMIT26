"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, CircleAlert, CircleCheck, CircleX, FileStack, LoaderCircle, Pause, Play, ScanLine, SearchCheck, Maximize2 } from "lucide-react";
import { SourceFlow, useSourceActivity } from './SourceFlow';
import { AuditClaimsDialog } from "./AuditClaimsDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isAuditEligible, useAudit } from "@/lib/dashboard/audit-session";
import { auditFlowStage, checkState, humanActions } from "@/lib/dashboard/human-actions";
import { investigationFailureDetails } from "@/lib/intelligence/investigation-errors";
import { money, statusLabel } from "@/lib/dashboard/helpers";
import type { ReviewRow } from "@/lib/dashboard/types";
import { useWorkspace } from "@/lib/dashboard/workspace-store";
import { FlowConnectors, useFlowActivity } from "./FlowConnectors";
import { ResetDemoButton } from "./ResetDemoButton";
import styles from "./audit-flow.module.css";

type FlowClaim = { row: ReviewRow; label: string };

function ClaimStage({ title, icon, items, tone, empty, onReview, elapsed }: {
  title: string; icon: ReactNode; items: FlowClaim[]; tone: string; empty: string; onReview(id: string): void; elapsed?(id: string): string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  return <section className={styles.stage} data-tone={tone} data-flow-node={tone} aria-label={title}>
    <header className={styles.stageHeader}><h3><button ref={trigger} type="button" className={styles.expandTrigger} onClick={() => setExpanded(true)} aria-label={`Expand ${title}`} aria-haspopup="dialog">{icon}{title}{tone === "checking" && items.length > 0 && <span className={styles.activePulse} aria-hidden="true" />}<Maximize2 aria-hidden="true" /></button></h3><span className={styles.count}>{items.length}</span></header>
    <AuditClaimsDialog returnFocusRef={trigger} title={title} items={items} open={expanded} onOpenChange={setExpanded} onReview={onReview} />
    <div className={styles.stageQueue} tabIndex={0} role="region" aria-label={`${title} claims`}>
      {items.length ? <ul>{items.map(({ row, label }) => <li key={row.id}>
        <div className={styles.claimLine}><strong>{row.attendee_name}</strong><span>{money(row.amount_requested_minor, row.currency)}</span></div>
        <div className={styles.claimMeta}><span>{label}{elapsed && <small className={styles.elapsed} title="Elapsed since this check was observed on this page">{elapsed(row.id)}</small>}</span><button type="button" onClick={() => onReview(row.id)} aria-label={`Review ${row.attendee_name}'s claim`}>View<ArrowUpRight aria-hidden="true" /></button></div>
      </li>)}</ul> : <p className={styles.emptyQueue}>{empty}</p>}
    </div>
  </section>;
}

export function AuditFlow({ preview, onReview }: { preview: boolean; onReview(id: string): void }) {
  const { data } = useWorkspace(preview);
  const audit = useAudit(preview);
  const graph = useRef<HTMLDivElement>(null);
  const sourceActivity = useSourceActivity();
  const [resetBusy, setResetBusy] = useState(false);
  const agentsTrigger = useRef<HTMLButtonElement>(null);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const rows = data?.submissions ?? [];
  const actions = data ? humanActions(data) : [];
  const actionById = new Map(actions.map(action => [action.row.id, action]));
  const checkingIds = new Set(audit.checkingIds);
  const stages = rows.map(row => ({ row, node: auditFlowStage(row, checkingIds.has(row.id)) }));
  const waiting: FlowClaim[] = [], checking: FlowClaim[] = [], passed: FlowClaim[] = [], uncertain: FlowClaim[] = [], failed: FlowClaim[] = [];
  for (const { row, node } of stages) {
    const state = checkState(row);
    if (node === "investigations") continue;
    if (node === "checking") {
      checking.push({ row, label: row.receipt?.extraction_status === "pending" ? "Reading receipt" : "Checking claim" });
    } else if (node === "passed") {
      passed.push({ row, label: row.decisions.some(check => check.evidence_json.demo_baseline === true) ? "Prepared demo approval" : row.decision_source === "automatic" ? "Approved automatically" : "Approved by reviewer" });
    } else if (node === "failed") {
      failed.push({ row, label: row.decisions.some(check => check.evidence_json.demo_baseline === true) ? "Prepared demo rejection" : "Rejected by reviewer" });
    } else if (node === "waiting") {
      waiting.push({ row, label: row.receipt?.extraction_status === "pending" ? "Waiting for receipt parsing" : "Ready for checks" });
    } else {
      const group = actionById.get(row.id)?.group;
      uncertain.push({ row, label: state === "failed" ? "Check failed · retry needed"
        : group === "passed" ? "Passed checks · needs approval"
        : group === "confirmed_fail" ? "Confirmed mismatch · needs decision"
        : "Needs your judgment" });
    }
  }
  const eligible = rows.filter(isAuditEligible).length;
  const active = audit.status === "running" || audit.status === "stopping";
  const sources = audit.sources?.enabled ? audit.sources : null;
  const incoming = !!sources && sources.phase !== 'ready' && sources.phase !== 'failed';
  const runs = rows.flatMap(row => row.latest_investigation ? [{ row, run: row.latest_investigation }] : [])
    .sort((a, b) => b.run.started_at.localeCompare(a.run.started_at));
  const runningRuns = runs.filter(({ run }) => run.status === "running");
  const failedRuns = runs.filter(({ run }) => run.status === "failed");
  const historyRuns = runs.filter(({ run }) => run.status === "completed" || run.status === "superseded");
  const agentsRunning = stages.filter(({ node }) => node === "investigations").length;
  const agentsCompleted = runs.filter(({ run }) => run.status === "completed").length;
  const agentsFailed = failedRuns.length;
  const unchecked = waiting.length + checking.length + agentsRunning;
  const checked = rows.length - unchecked;
  const activity = useFlowActivity(stages.map(({ row, node }) => ({ id: row.id, node, run: node === "investigations" ? row.latest_investigation! : undefined })));
  if (!data) return null;
  const nextAction = actions[0];
  const href = `/investigations${preview ? "?preview=1" : ""}`;
  const progress = audit.status === "stopping" ? "Stopping after active checks finish."
    : active && incoming ? sources.phase === 'linking' ? 'Linking source evidence into claims…' : `Reading sources · ${sources.cursor} of ${sources.total} files processed${sources.current ? ` · ${sources.current.name}` : ''}`
    : active ? audit.total ? `This session: ${audit.done} of ${audit.total} claims checked` : "Preparing your audit…"
    : audit.status === "failed" ? "Audit paused. Review the error before continuing."
    : audit.status === "complete" ? `Session complete · ${audit.done} of ${audit.total} claims checked this session`
    : audit.startedAt ? `Session paused · ${audit.done} of ${audit.total} checked this session`
    : incoming ? `${sources.total} sample files → extract facts → link evidence → audit complete claims`
    : eligible ? `${eligible} ${eligible === 1 ? "claim is" : "claims are"} ready to check` : waiting.length ? "Waiting for receipt parsing before checks can start" : "Showing saved claim results";

  const renderRun = ({ row, run }: typeof runs[number]) => {
    const steps = [...run.steps].sort((a, b) => a.sequence - b.sequence);
    const failure = investigationFailureDetails(run.error);
    const activeStep = run.status === "running" ? steps.find(step => step.status === "running") : undefined;
    return <article className={styles.agent} data-status={run.status} key={run.run_id}>
      <div className={styles.agentHeading}><strong>{row.attendee_name}</strong><span>{run.mode === "simulated" ? "Simulated" : "Live"}</span></div>
      <p className={styles.agentStatus}>{run.status === "running" ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : run.status === "completed" ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{run.status === "running" ? activeStep ? `Running · ${statusLabel(activeStep.tool)}` : "Running · investigating evidence" : run.status === "failed" ? "Needs review" : statusLabel(run.status)}{run.status === "running" && <span className={styles.elapsed}>{activity.elapsed(row.id)}</span>}</p>
      <p className={styles.agentSummary}>{run.status === "failed" ? "Automatic investigation could not finish. Review the saved evidence."
        : run.status === "superseded" ? "Evidence changed. Open the claim for its latest result."
        : run.headline || run.summary || (run.status === "running" ? "Reading the available evidence." : "No summary was recorded.")}</p>
      {run.status === "failed" && <details className={styles.toolHistory}><summary>Technical details</summary><p>Investigation failed. {failure.message}</p>{failure.detail && <p><code>{failure.detail}</code></p>}</details>}
      <details className={styles.toolHistory} open={run.status === "running"}><summary>Tool history · {steps.length}</summary>{steps.length ? <ol>{steps.map(step => <li key={step.id}><strong>{statusLabel(step.tool)}</strong><span>{step.status === "running" && run.status !== "running" ? "Incomplete" : statusLabel(step.status)}</span><p>{step.summary || "No summary recorded."}</p></li>)}</ol> : <p>No tool steps recorded yet.</p>}</details>
      {run.status === "failed" && <button type="button" className={styles.runLink} onClick={() => onReview(row.id)}>Open claim<ArrowUpRight aria-hidden="true" /></button>}
      <Link className={styles.runLink} href={`/investigations?${preview ? "preview=1&" : ""}run=${encodeURIComponent(run.run_id)}`}>View findings and evidence<ArrowUpRight aria-hidden="true" /></Link>
    </article>;
  };

  return <section className={styles.audit} aria-labelledby="audit-title">
    <Dialog open={agentsExpanded} onOpenChange={setAgentsExpanded}><DialogContent className={styles.expandedDialog} onCloseAutoFocus={event => { event.preventDefault(); agentsTrigger.current?.focus(); }}><div className={styles.expandedHeading}><DialogTitle>Investigation agents</DialogTitle><DialogDescription>{agentsRunning} running · {agentsCompleted} completed · {agentsFailed} failed. Recorded activity and findings.</DialogDescription></div><div className={styles.expandedBody}>{runs.length ? runs.map(renderRun) : <p className={styles.emptyQueue}>No investigation activity yet.</p>}</div></DialogContent></Dialog>
    <div className={styles.canvas}>
      <header className={styles.toolbar}>
        <div><h2 id="audit-title">Follow the audit</h2><p>{checked} of {rows.length} claims checked overall · {unchecked} unchecked</p><p role="status" aria-atomic="true">{active && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{progress}</p></div>
        <div className={styles.controls}>{active ? <Button variant="outline" disabled={resetBusy || audit.status === "stopping"} onClick={audit.stop}><Pause aria-hidden="true" />{audit.status === "stopping" ? "Stopping…" : "Stop after active checks"}</Button> : <Button disabled={resetBusy || (!eligible && !incoming)} onClick={() => void audit.start()}><Play aria-hidden="true" />{audit.startedAt && (eligible || incoming) ? "Continue audit" : "Start audit"}</Button>}{!sources && <ResetDemoButton preview={preview} onBusy={setResetBusy} />}</div>
      </header>
      <div className={styles.progressTrack}>{audit.total > 0 && <progress value={audit.done} max={audit.total} aria-label="Claims checked in this session" />}</div>
      {audit.error && <p className={styles.error} role="alert">{audit.error}</p>}
      {audit.notice && <p role="status" className="text-sm text-[var(--status-review)]">{audit.notice}</p>}
      {sources && <p className={styles.sourceAuditNote} role="status"><strong>{sources.extractionMode === 'live' ? 'Live AI reading' : 'Simulated sample reading'}</strong> · PDF scans · receipt images · email exports · form CSVs. {sources.phase === 'ready' ? `${sources.documents.length} unique inputs · ${sources.duplicates} repeated copy skipped · ${sources.imports.length} claims created · ${sources.held.length} inputs need a connection or details.` : 'Start audit reads the fictional source files and queues complete, unambiguous requests.'} <Link className="underline" href="/import?audit=1">Inspect inputs and connections</Link>{sources.error && <span role="alert"> {sources.error}</span>}</p>}
      <div className={styles.flow} ref={graph}>
        <FlowConnectors graph={graph} events={activity.events} sourceArrivalAt={Math.max(0, ...sourceActivity.filter(item => item.status === 'confirmed').map(item => item.at))} />
        <SourceFlow items={sourceActivity} reading={active && incoming ? sources.current : null} />
        <ClaimStage title="Waiting" icon={<FileStack aria-hidden="true" />} items={waiting} tone="waiting" empty="No claims waiting" onReview={onReview} />

        <ClaimStage title="Checking" icon={checking.length ? <LoaderCircle aria-hidden="true" className={styles.spinner} /> : <ScanLine aria-hidden="true" />} items={checking} tone="checking" empty={active ? "Preparing the next claim" : "Ready when you are"} onReview={onReview} elapsed={activity.elapsed} />
        <div className={styles.outcomes}>
          <ClaimStage title="Approved" icon={<CircleCheck aria-hidden="true" />} items={passed} tone="passed" empty="No saved approvals" onReview={onReview} />
          <ClaimStage title="Needs review" icon={<CircleAlert aria-hidden="true" />} items={uncertain} tone="uncertain" empty="No claims need review" onReview={onReview} />
          <ClaimStage title="Rejected" icon={<CircleX aria-hidden="true" />} items={failed} tone="failed" empty="No saved rejections" onReview={onReview} />
        </div>
      <section className={styles.investigations} data-flow-node="investigations" aria-label="Investigation agents">
        <div className={styles.laneHeader}><h3><button type="button" className={styles.expandTrigger} ref={agentsTrigger} aria-label="Expand Investigation agents" aria-haspopup="dialog" onClick={() => setAgentsExpanded(true)}><SearchCheck aria-hidden="true" />Investigation agents<Maximize2 aria-hidden="true" /></button> {agentsRunning > 0 && <span className={styles.activePulse} aria-hidden="true" />} <span>{agentsRunning} running · {agentsCompleted} completed · {agentsFailed} failed</span></h3><Link href={href}>History<ArrowUpRight aria-hidden="true" /></Link></div>
        <div className={styles.agentLane} tabIndex={0} role="region" aria-label="Latest investigation activity">
          {runs.length ? <>
            {runningRuns.map(renderRun)}
            {failedRuns.map(renderRun)}
            {historyRuns.length > 0 && <details className={styles.agentHistory}>
              <summary>Completed / history · {historyRuns.length}</summary>
              {historyRuns.map(renderRun)}
            </details>}
          </> : <p className={styles.agentEmpty}>{data.capabilities?.investigations ? "When a claim needs more evidence, its investigation appears here." : "Investigations are not enabled for this workspace."}</p>}
        </div>
      </section>
      </div>
      <div className={styles.flowNote}><p>Unchecked: {waiting.length} waiting + {checking.length} checking + {agentsRunning} investigating = {unchecked}. Completed investigations are in history. Failed investigations stay visible for attention; their claims appear in the outcome queues. Passed checks and mismatches need review until a decision is saved.</p>{nextAction && <Button onClick={() => onReview(nextAction.row.id)} variant="default">Review claims ({actions.length})<ArrowRight aria-hidden="true" /></Button>}</div>
    </div>
  </section>;
}
