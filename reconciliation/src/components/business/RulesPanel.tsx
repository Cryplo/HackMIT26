"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FlaskConical, LoaderCircle, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, statusLabel } from "@/lib/dashboard/helpers";
import { activationBlock, normalizeVendor as normalize } from "@/lib/dashboard/review";
import type { RulesPanelProps } from "@/lib/dashboard/ui-contracts";
import type { MerchantRule, RulesResponse } from "@/lib/review-contracts";
import { LearningStatus } from "./ProcedurePanel";
import styles from "./panels.module.css";

const message = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";
type Action = "test" | "activate" | "disable";

export function RulesPanel({ client, rows, knowledgeRevision, capabilities, simulatedEnvironment, onOpenClaim, onChanged, onRecheck }: RulesPanelProps) {
  const [data, setData] = useState<RulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: Action | "recheck" } | null>(null);
  const [activationDenied, setActivationDenied] = useState<string[]>([]);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const enabled = capabilities?.rule_learning === true;
  const revision = Math.max(knowledgeRevision, data?.knowledge_revision ?? 0);

  const load = useCallback(async (background = false) => {
    if (!enabled || (background && controller.current && !controller.current.signal.aborted)) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const signal = current.signal;
    const id = ++request.current;
    if (!background) setLoading(true);
    try {
      const result = await client.getRules(signal);
      if (id === request.current && !signal.aborted) setData(result);
    } catch (failure) {
      if (!signal.aborted && id === request.current) throw failure;
    } finally {
      if (controller.current === current) controller.current = null;
      if (id === request.current && !signal.aborted) setLoading(false);
    }
  }, [client, enabled]);

  useEffect(() => {
    if (!mutationLock.current) void load(true).catch(failure => setError(message(failure)));
  }, [load, knowledgeRevision, rows]);

  useEffect(() => () => { ++request.current; controller.current?.abort(); }, [client]);

  async function mutate(rule: MerchantRule, action: Action) {
    if (!enabled || mutationLock.current) return;
    mutationLock.current = true;
    ++request.current;
    controller.current?.abort(); controller.current = null;
    setLoading(false); setBusy({ id: rule.id, action }); setError(null); setNotice(null);
    try {
      const input = { expected_rule_version: rule.version };
      if (action === "test") {
        // A test returns a report, not a rule. Only the subsequent GET can supply authoritative state/version.
        setActivationDenied(previous => [...new Set([...previous, rule.id])]);
        setData(previous => previous && ({ ...previous, rules: previous.rules.map(item => item.id === rule.id ? { ...item, latest_test: null } : item) }));
        const report = await client.testRule(rule.id, input);
        await load();
        setActivationDenied(previous => previous.filter(id => id !== rule.id));
        setNotice(report.passed ? "Rule test passed. Review the current report before activation." : "Rule test finished without a passing report. Review the reasons below.");
      } else {
        await (action === "activate" ? client.activateRule(rule.id, input) : client.disableRule(rule.id, input));
        setNotice(action === "activate" ? "Rule activated. Recheck related claims to apply it; human decisions are preserved." : "Rule disabled. Its history is retained. Existing assessments need an explicit recheck.");
      }
      const refreshes = await Promise.allSettled([load(), onChanged()]);
      const failedRefresh = refreshes.find((result) => result.status === "rejected");
      if (failedRefresh?.status === "rejected") setError(`The change was saved, but refresh failed. ${message(failedRefresh.reason)}`);
    } catch (failure) {
      setError(message(failure));
      // A test can advance the version before a provider failure; always fetch the current version.
      if (action === "test" || action === "activate") setActivationDenied((previous) => [...new Set([...previous, rule.id])]);
      try { await load(); } catch { /* Preserve the server's mutation error and last known rules. */ }
      try { await onChanged(); } catch { /* The visible error remains actionable. */ }
    } finally { mutationLock.current = false; setBusy(null); }
  }

  async function recheck(rule: MerchantRule, ids: string[]) {
    if (!ids.length || mutationLock.current) return;
    mutationLock.current = true;
    setBusy({ id: rule.id, action: "recheck" }); setError(null); setNotice(null);
    try { await onRecheck(ids); setNotice(`Rechecked ${ids.length} related claim${ids.length === 1 ? "" : "s"}. Human decisions are unchanged.`); }
    catch (failure) { setError(message(failure)); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  const learningRows = rows.filter(row => row.learning);
  const learning = <section aria-label="Learning from reviews" className="mb-6"><h2 className="text-base font-semibold">Learning from reviews</h2><p className="mt-1 text-sm text-muted-foreground">Review reasons are checked against saved evidence. Only supported checks that pass testing are saved for similar claims. Open the source claim to inspect or turn off a saved check.</p>{learningRows.length ? <ul className="mt-3 divide-y">{learningRows.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-2"><Button variant="link" onClick={() => onOpenClaim(row.id)}>{row.attendee_name}</Button><LearningStatus row={row} /></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No learning from reviews yet. Review a claim and explain the evidence behind your decision.</p>}</section>;

  if (!enabled) return <>{learning}<section aria-label="Learned merchant rules"><p className="py-6 text-sm text-muted-foreground">Merchant rule learning is unavailable on this backend. Claim review remains available.</p></section></>;

  return <>{learning}<details><summary className="cursor-pointer py-3 text-sm text-muted-foreground">Merchant name rules</summary><section className={`${styles.rules} space-y-5`} aria-label="Learned merchant rules">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Merchant rules</h2><p className="mt-1 text-sm text-muted-foreground">Confirm a merchant name to create a draft. Test it before activation.</p></div><Button variant="outline" size="lg" disabled={loading || !!busy} aria-busy={loading} onClick={() => { setError(null); void load().catch((failure) => setError(message(failure))); }}><RotateCw aria-hidden="true" className={loading ? "motion-safe:animate-spin" : undefined} />{loading ? "Refreshing…" : "Refresh rules"}</Button></div>
    {client.mode === "preview" && <div className="flex items-start gap-2 text-sm text-muted-foreground"><FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>Preview — synthetic data. Tests below are simulated examples, not measured live AI accuracy.</p></div>}
    {error && <p role="alert" className="motion-enter rounded border border-destructive/20 bg-[var(--status-bad-bg)] p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="motion-enter text-sm text-[var(--status-good)]">{notice}</p>}
    {!data && loading && <p role="status" className="py-8 text-sm text-muted-foreground">Loading merchant rules…</p>}
    {data?.rules.length === 0 && <div className="border-y py-10"><h3 className="font-medium">No merchant name rules yet</h3><p className="mt-2 max-w-xl text-sm text-muted-foreground">Open an approved claim with an unresolved merchant check and choose “Remember this merchant name” to create a scoped draft.</p></div>}

    {data?.rules.map((rule) => {
      const report = rule.latest_test;
      const source = rows.find((row) => row.id === rule.source_submission_id);
      const approvedSource = source?.decision_status === "approved";
      const denied = activationDenied.includes(rule.id);
      const block = activationBlock(rule, rows, revision, client.mode, simulatedEnvironment);
      const canActivate = rule.state === "draft" && !block && !denied && !error;
      const related = rows.filter((row) => (row.assessment_status === null || row.assessment_knowledge_revision !== revision) && row.processing_status !== "running" && row.receipt?.extraction_status === "succeeded" && row.category === rule.payload.scope.category && row.currency === rule.payload.scope.currency && normalize(row.receipt?.parsed_fields_json?.vendor || "") === normalize(rule.payload.observed_vendor));
      const ids = related.slice(0, 50).map((row) => row.id);
      const testing = busy?.id === rule.id && busy.action === "test";
      const activationReason = denied ? "Refresh and test this draft again before activation." : block || "Passing test is current. Ready for activation.";
      return <article key={rule.id} aria-label={`${rule.payload.observed_vendor} rule`} className="border-t py-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold">{rule.payload.observed_vendor}</h3><ArrowRight className="size-4 text-muted-foreground" aria-label="maps to" /><span className="break-words font-medium">{rule.payload.canonical_vendor}</span></div><p className="mt-2 text-xs text-muted-foreground">Scope: {statusLabel(rule.payload.scope.category)} · {rule.payload.scope.currency} · Exact merchant name</p></div><Badge variant="secondary" className={`h-6 rounded capitalize ${rule.state === "active" ? "bg-[var(--status-good-bg)] text-[var(--status-good)]" : ""}`}>{rule.state === "active" && <ShieldCheck aria-hidden="true" />}{rule.state}</Badge></div>
        <p className="mt-3 text-xs text-muted-foreground">Source claim: {source ? <button type="button" className="min-h-11 text-foreground underline" onClick={() => onOpenClaim(source.id)}>{source.attendee_name}</button> : <span>{rule.source_submission_id} (not loaded)</span>} · {source ? statusLabel(source.decision_status) : "Not in current ledger"} · Created {formatDate(rule.created_at)} · Version {rule.version}</p>

        {rule.latest_test_error && <p role="alert" className="mt-3 text-sm text-destructive">Latest test failed: {rule.latest_test_error}. Activation requires another complete test.</p>}
        {report ? <div className="mt-5 max-w-2xl"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium">Last test</h4><Badge variant="outline" className="rounded">{report.mode === "simulated" ? "Simulated test" : "Live test"}</Badge><span className={`flex items-center gap-1 text-xs ${report.passed ? "text-[var(--status-good)]" : "text-destructive"}`}>{report.passed ? <Check className="size-3.5" aria-hidden="true" /> : <TriangleAlert className="size-3.5" aria-hidden="true" />}{report.passed ? "Passed" : "Failed"}</span></div><p className="mt-2 text-xs text-muted-foreground">{formatDate(report.tested_at)} · Tested version {report.rule_version} · Rule set {report.knowledge_revision} · {report.suite_version}</p>
          <Table className="mt-3 text-sm"><TableHeader><TableRow><TableHead>Evaluation cases</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead></TableRow></TableHeader><TableBody>{([ ["Total cases", "total"], ["Correct outcomes", "correct"], ["False matches", "false_matches"], ["Needs review", "needs_review"] ] as const).map(([label, key]) => <TableRow key={key}><TableCell>{label}</TableCell><TableCell className="text-right tabular-nums">{report.before[key]}</TableCell><TableCell className="text-right tabular-nums">{report.after[key]}</TableCell></TableRow>)}</TableBody></Table>
          {report.reasons.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">{report.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
          <details className="mt-2 text-xs"><summary className="cursor-pointer py-2 text-muted-foreground">Case changes and provenance</summary><div className="space-y-2 break-all leading-5 text-muted-foreground"><p>Improved cases: {report.improved_case_ids.length ? report.improved_case_ids.join(", ") : "None"}</p><p>Regressed cases: {report.regressed_case_ids.length ? report.regressed_case_ids.join(", ") : "None"}</p><p>Source claim: {rule.source_submission_id}</p><p>Approval record: {rule.source_correction_id}</p><p>Rule: {rule.id}</p></div></details>
          <p className="mt-2 text-xs text-muted-foreground">These synthetic cases check this scoped rule, not broad model accuracy.{report.mode === "simulated" ? " Results are simulated." : " Cases were evaluated with the live provider."}</p>
        </div> : <p className="mt-4 text-sm text-muted-foreground">No completed test report.</p>}

        {rule.state === "draft" && <p className={`mt-4 text-xs ${report && !report.passed ? "text-destructive" : "text-muted-foreground"}`}>{activationReason}</p>}
        {testing && <p role="status" className="mt-3 text-sm text-muted-foreground">Testing this rule. Wait for the provider results; no claims will be approved.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {rule.state === "draft" && <><Button variant="outline" size="lg" disabled={!!busy || loading || !approvedSource} aria-busy={testing} onClick={() => void mutate(rule, "test")}>{testing ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <FlaskConical aria-hidden="true" />}{testing ? "Testing…" : "Test rule"}</Button><Button size="lg" disabled={!!busy || loading || !canActivate} aria-busy={busy?.id === rule.id && busy.action === "activate"} onClick={() => void mutate(rule, "activate")}>{busy?.id === rule.id && busy.action === "activate" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy?.id === rule.id && busy.action === "activate" ? "Activating…" : "Activate"}</Button></>}
          {rule.state !== "disabled" && <Button variant="outline" size="lg" disabled={!!busy || loading} aria-busy={busy?.id === rule.id && busy.action === "disable"} onClick={() => void mutate(rule, "disable")}>{busy?.id === rule.id && busy.action === "disable" && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy?.id === rule.id && busy.action === "disable" ? "Disabling…" : "Disable rule"}</Button>}
          {rule.state === "active" && <Button variant="outline" size="lg" disabled={!!busy || !ids.length} aria-busy={busy?.id === rule.id && busy.action === "recheck"} onClick={() => void recheck(rule, ids)}><RotateCw aria-hidden="true" className={busy?.id === rule.id && busy.action === "recheck" ? "motion-safe:animate-spin" : undefined} />{busy?.id === rule.id && busy.action === "recheck" ? "Rechecking…" : related.length > 50 ? "Recheck first 50 related claims" : `Recheck related claims (${ids.length})`}</Button>}
        </div>
        {rule.state === "disabled" && <p className="mt-3 text-xs text-muted-foreground">Disabled rules are retained for history and do not affect new assessments.</p>}
        {rule.state === "active" && related.length > 50 && <p className="mt-3 text-xs text-muted-foreground">{related.length} related claims need rechecking. Each batch processes up to 50 explicit claim IDs.</p>}
      </article>;
    })}
  </section></details></>;
}
