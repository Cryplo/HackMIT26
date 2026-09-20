"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approvalBlock, normalizeVendor } from "@/lib/dashboard/review";
import type { DashboardClient } from "@/lib/dashboard/ui-contracts";
import type { InvestigationRun, ResolutionProcedure, ReviewRow, SupportingDocument } from "@/lib/dashboard/types";
import { InvestigationEvidenceLinks } from "./InvestigationRunView";
import styles from "./investigations.module.css";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "The saved check request failed.";

export function LearningStatus({ row, onRetry }: { row: ReviewRow; onRetry?: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  async function retry() {
    if (retrying || !onRetry) return;
    setRetrying(true); setRetryError("");
    try { await onRetry(); }
    catch (failure) { setRetryError(message(failure)); }
    finally { setRetrying(false); }
  }
  const learning = row.learning;
  if (!learning) return null;
  const pending = ["queued", "checking", "testing"].includes(learning.status);
  const label = { queued: "Checking what can be learned", checking: "Checking what can be learned", testing: "Testing saved check", active: "Saved for similar claims", not_applicable: "No reusable check saved", needs_confirmation: "Learning needs confirmation", failed: "Learning could not finish" }[learning.status];
  return <details className="min-w-0 text-xs" data-learning-status={learning.status}>
    <summary className={`cursor-pointer py-2 ${learning.status === "active" ? "text-[var(--status-good)]" : learning.status === "failed" ? "text-destructive" : learning.status === "needs_confirmation" ? "text-[var(--status-review)]" : "text-muted-foreground"}`}><span role="status" className="inline-flex items-center gap-2">{pending && <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin" />}{label}</span></summary>
    <p className="mt-1 leading-5 text-muted-foreground">{learning.summary}</p>
    {pending && <p className="mt-1 text-muted-foreground">Your decision is saved. You can continue reviewing.</p>}
    {learning.status === "failed" && onRetry && <Button type="button" variant="outline" size="sm" className="mt-2" disabled={retrying} aria-busy={retrying} onClick={() => void retry()}>{retrying && <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin" />}{retrying ? "Retrying learning…" : "Retry learning"}</Button>}
    {retryError && <p role="alert" className="mt-2 text-destructive">{retryError}</p>}
  </details>;
}

export function ProcedurePanel({ run, row, rows, documents, client, knowledgeRevision, simulatedEnvironment, enabled, onChanged, onOpenClaim, busy = false, onBusyChange }: {
  run: InvestigationRun | null; row: ReviewRow; rows: ReviewRow[]; documents: SupportingDocument[];
  client: DashboardClient; knowledgeRevision: number; simulatedEnvironment: boolean; enabled: boolean; onChanged: () => Promise<void>;
  onOpenClaim: (id: string) => void; busy?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<DashboardClient["getProcedures"]>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const mutation = useRef(false);
  const mounted = useRef(false);
  const operationSequence = useRef(0);
  const revision = Math.max(knowledgeRevision, data?.knowledge_revision ?? 0);
  const savedChecks = data?.procedures.filter(procedure => procedure.source_claim_id === row.id);
  const candidate = run?.proposed_learning;
  const canPropose = !!run && !!candidate && run.status === "completed" && run.outcome === "resolved" && !!run.after_assessment
    && row.latest_investigation?.run_id === run.run_id && row.review_revision >= run.after_assessment.review_revision
    && row.decision_status === "approved" && row.decision_source !== "automatic" && row.assessment_status === "matched" && !approvalBlock(row, revision, rows, false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++operationSequence.current; ++request.current; controller.current?.abort(); onBusyChange?.(false); };
  }, [row.id, onBusyChange]);

  const load = useCallback(async (background = false) => {
    if (!enabled || (background && controller.current && !controller.current.signal.aborted)) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const sequence = ++request.current;
    if (!background) setLoading(true);
    try {
      const result = await client.getProcedures(current.signal);
      if (current.signal.aborted || sequence !== request.current || !mounted.current) return;
      setData(result);
    } catch (failure) {
      if (!current.signal.aborted && sequence === request.current && mounted.current) throw failure;
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted && sequence === request.current && mounted.current) setLoading(false);
    }
  }, [client, enabled]);

  useEffect(() => {
    if (mutation.current) return;
    void load(true).catch(failure => setError(previous => previous ?? message(failure)));
  }, [load, knowledgeRevision, rows]);

  async function mutate(kind: "propose" | "test" | "activate" | "disable", procedure?: ResolutionProcedure) {
    if (!enabled || busy || mutation.current || (kind === "propose" && !canPropose)) return;
    mutation.current = true;
    const operation = ++operationSequence.current;
    const isCurrent = () => mounted.current && operation === operationSequence.current;
    controller.current?.abort(); controller.current = null;
    ++request.current;
    setAction(procedure ? `${kind}:${procedure.id}` : kind);
    setError(null); setNotice(null); onBusyChange?.(true);
    if (procedure && kind === "test") {
      setDenied(ids => [...new Set([...ids, procedure.id])]);
      setData(previous => previous && ({ ...previous, procedures: previous.procedures.map(item => item.id === procedure.id ? { ...item, latest_test: null } : item) }));
    }
    try {
      if (kind === "propose" && run) {
        await client.proposeProcedure(run.run_id, row.review_revision);
        if (!isCurrent()) return;
        setNotice("Draft saved. Test it before turning it on.");
      } else if (procedure) {
        if (kind === "test") {
          const report = await client.testProcedure(procedure.id, procedure.version);
          if (!isCurrent()) return;
          await load();
          if (!isCurrent()) return;
          if (report.passed) setDenied(ids => ids.filter(id => id !== procedure.id));
          setNotice(report.passed ? "Test passed. Review the results, then turn on this check when you are ready." : "Test did not pass. This check cannot be turned on.");
        } else if (kind === "activate") {
          await client.activateProcedure(procedure.id, procedure.version);
          if (!isCurrent()) return;
          setNotice("Saved check turned on. It will be used when similar claims are checked again.");
        } else {
          await client.disableProcedure(procedure.id, procedure.version);
          if (!isCurrent()) return;
          setNotice("Saved check turned off. Its history is kept; recheck any affected claims.");
        }
      }
      const refreshes = await Promise.allSettled([load(), onChanged()]);
      if (!isCurrent()) return;
      const failed = refreshes.find(result => result.status === "rejected");
      if (failed?.status === "rejected") {
        if (procedure) setDenied(ids => [...new Set([...ids, procedure.id])]);
        setError(`The operation finished, but current state could not be refreshed. ${message(failed.reason)}`);
      }
    } catch (failure) {
      if (!isCurrent()) return;
      if (procedure) setDenied(ids => [...new Set([...ids, procedure.id])]);
      await Promise.allSettled([load(), onChanged()]);
      if (isCurrent()) setError(message(failure));
    } finally { if (isCurrent()) { mutation.current = false; setLoading(false); setAction(null); onBusyChange?.(false); } }
  }

  if (!enabled) return null;
  if (data && !loading && !action && !error && !notice && !candidate && !savedChecks?.length) return null;

  return <>
    {(loading || action) && <p role="status" className={styles.activity}><LoaderCircle aria-hidden="true" className={styles.spinner} />{action === "propose" ? "Saving check draft…" : action?.startsWith("test:") ? "Testing saved check…" : action?.startsWith("activate:") ? "Turning on saved check…" : action?.startsWith("disable:") ? "Turning off saved check…" : "Loading saved checks…"}</p>}
    <details className={styles.disclosure}>
    <summary>Learning from this claim</summary>
    <section aria-label="Learned checks" className={styles.panel}>
    <p className={styles.muted}>Reuse this evidence check on similar claims. Test it before turning it on.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    {row.decision_source === "automatic" && <p className={styles.muted}>This claim was approved automatically. A saved check needs a human review before it can be learned.</p>}
    {candidate && run && <div className={styles.candidate}><h4>Suggested check</h4><p>Recognize <strong>{candidate.trigger_scope.observed_vendor}</strong> as {candidate.trigger_scope.canonical_vendor} when the booking evidence matches.</p><details className={styles.disclosure}><summary>When this check applies</summary><p>{candidate.trigger_scope.category} claims in {candidate.trigger_scope.currency}</p><p>Required evidence: {candidate.required_evidence.join(" + ").replaceAll("_", " ")}</p><p>Matching fields: {candidate.matching_fields.join(", ").replaceAll("_", " ")}</p><InvestigationEvidenceLinks refs={candidate.source_evidence_refs} claimId={row.id} rows={rows} documents={documents} client={client} onOpenClaim={onOpenClaim} /></details>
      <p className={styles.muted}>{canPropose ? "Save a draft, test it, then turn it on. Nothing is learned until you turn it on." : row.decision_source === "automatic" ? "Human feedback is required to save this draft." : "Review and approve this claim after its evidence question is resolved to save a draft."}</p>
      <Button variant="outline" disabled={!canPropose || loading || busy || !!action || !!error || !!data?.procedures.some(procedure => procedure.source_run_id === run.run_id && procedure.state !== "disabled")} aria-busy={action === "propose"} onClick={() => void mutate("propose")}>{action === "propose" && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{action === "propose" ? "Saving draft…" : "Save check draft"}</Button>
    </div>}
    {!candidate && row.decision_source !== "automatic" && <p className={styles.muted}>No reusable check is suggested for this claim yet.</p>}
    {savedChecks?.length === 0 && <p className={styles.muted}>No checks saved from this claim.</p>}
    {savedChecks?.map(procedure => {
      const source = rows.find(item => item.id === procedure.source_claim_id);
      const sourceRun = run?.run_id === procedure.source_run_id ? run : source?.latest_investigation;
      const report = procedure.latest_test;
      const approvedSource = source?.decision_status === "approved" && source.decision_source !== "automatic" && source.decisions.findLast(check => check.check_method === "human")?.evidence_json.correction_id === procedure.source_correction_id;
      // Source evidence is historical; only the new test must use current knowledge.
      const sourceCurrent = approvedSource && (procedure.source_kind === "review_feedback"
        ? source.latest_run_id === procedure.source_run_id
        : !!sourceRun && sourceRun.status === "completed" && sourceRun.outcome === "resolved" && !!sourceRun.after_assessment
          && sourceRun.run_id === procedure.source_run_id && source.latest_investigation?.run_id === procedure.source_run_id
          && source.review_revision >= sourceRun.after_assessment.review_revision) && source.receipt?.extraction_status === "succeeded"
        && source.category === procedure.trigger_scope.category && source.currency === procedure.trigger_scope.currency
        && normalizeVendor(source.receipt?.parsed_fields_json?.vendor || "") === normalizeVendor(procedure.trigger_scope.observed_vendor);
      const proofCurrent = !!report && report.procedure_id === procedure.id && report.procedure_version === procedure.version && report.knowledge_revision === revision && report.suite_version === "booking-reference-v1";
      const passing = proofCurrent && report.passed && report.before.total === 12 && report.after.total === 12 && report.after.false_matches === 0 && report.regressed_case_ids.length === 0 && report.applied_case_ids.length > 0 && report.after.correct >= report.before.correct;
      const modeMatches = !!report && report.mode === (client.mode === "preview" || simulatedEnvironment ? "simulated" : "live");
      const blocked = denied.includes(procedure.id) ? "Run a new test before turning on this check." : procedure.latest_test_error ? procedure.latest_test_error : !sourceCurrent ? "The source claim needs a current human approval and supporting evidence." : !proofCurrent ? "Test this check against the latest saved rules." : !passing ? "The safety test did not pass." : !modeMatches ? "Run a new test in this workspace." : null;
      const controlsBusy = loading || busy || !!action;
      return <article className={styles.procedure} key={procedure.id} aria-label={`${procedure.trigger_scope.observed_vendor} saved check`}>
        <div className={styles.row}><h4>{procedure.trigger_scope.observed_vendor} → {procedure.trigger_scope.canonical_vendor}</h4><span className={styles.status}>{procedure.state === "active" ? "On" : procedure.state === "disabled" ? "Off" : "Draft"}</span></div>
        <details className={styles.disclosure}><summary>Check details</summary>
        <p>Applies to {procedure.trigger_scope.category} claims in {procedure.trigger_scope.currency}. Requires {procedure.required_evidence.join(" + ").replaceAll("_", " ")}; matches {procedure.matching_fields.join(", ").replaceAll("_", " ")}.</p>
        <p className={styles.muted}>Version {procedure.version}</p>
        <p>Source claim: {source ? <button type="button" className={styles.textButton} onClick={() => onOpenClaim(source.id)}>{source.attendee_name}</button> : `${procedure.source_claim_id} — not loaded`}</p>
        <InvestigationEvidenceLinks refs={procedure.source_evidence_refs} claimId={procedure.source_claim_id} rows={rows} documents={documents} client={client} onOpenClaim={onOpenClaim} />
        </details>
        {procedure.latest_test_error && <p className={styles.error}>Latest test failed: {procedure.latest_test_error}</p>}
        {report ? <div className={styles.report}><div className={styles.row}><h5>Latest test: {report.passed ? "Passed" : "Failed"}</h5><span className={styles.status}>{report.mode === "simulated" ? "Simulated test" : "Live test"}</span></div><details className={styles.disclosure}><summary>Test results</summary><p className={styles.meta}>{report.suite_version} · Version {report.procedure_version} · Knowledge {report.knowledge_revision} · {proofCurrent ? "Current" : "Earlier result"}</p><p>Tested <time dateTime={report.tested_at}>{report.tested_at}</time></p>
          <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Saved check safety test results</caption><thead><tr><th>Cases</th><th>Before</th><th>After</th></tr></thead><tbody>{([ ["Total", "total"], ["Correct", "correct"], ["False matches", "false_matches"], ["Needs review", "needs_review"] ] as const).map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{report.before[key]}</td><td>{report.after[key]}</td></tr>)}</tbody></table></div>
          <p>Applied cases: {report.applied_case_ids.join(", ") || "None"}</p><p>Regressed cases: {report.regressed_case_ids.join(", ") || "None"}</p>{report.reasons.length ? <ul>{report.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p>No additional test reasons recorded.</p>}<p className={styles.muted}>The fixed 12-case suite is a safety test, not independent model accuracy. A 12/12 result before and after is an acceptable tie when no protected check regresses.</p>
        </details></div> : <p className={styles.muted}>Not tested yet.</p>}
        {procedure.state === "draft" && <p className={styles.muted}>{blocked || "Test passed. You can turn on this check."}</p>}
        <div className={styles.actions}>{procedure.state === "draft" && <><Button variant={blocked ? "default" : "outline"} disabled={controlsBusy || !approvedSource} aria-busy={action === `test:${procedure.id}`} onClick={() => void mutate("test", procedure)}>{action === `test:${procedure.id}` && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{action === `test:${procedure.id}` ? "Testing…" : "Test check"}</Button><Button variant={blocked ? "outline" : "default"} disabled={controlsBusy || !!blocked || !!error} aria-busy={action === `activate:${procedure.id}`} onClick={() => void mutate("activate", procedure)}>{action === `activate:${procedure.id}` && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{action === `activate:${procedure.id}` ? "Turning on…" : "Turn on check"}</Button></>}{procedure.state !== "disabled" && <Button variant="outline" disabled={controlsBusy} aria-busy={action === `disable:${procedure.id}`} onClick={() => void mutate("disable", procedure)}>{action === `disable:${procedure.id}` && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{action === `disable:${procedure.id}` ? "Turning off…" : "Turn off check"}</Button>}</div>
      </article>;
    })}
    <Button variant="outline" disabled={loading || busy || !!action} aria-busy={loading} onClick={() => { setError(null); void load().catch(failure => setError(message(failure))); }}>{loading && <LoaderCircle aria-hidden="true" className={styles.spinner} />}{loading ? "Refreshing…" : "Refresh saved checks"}</Button>
  </section></details></>;
}
