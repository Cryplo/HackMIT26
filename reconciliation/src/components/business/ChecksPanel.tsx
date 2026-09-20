"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FlaskConical, LoaderCircle, Pencil, Plus, RotateCw, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { statusLabel } from "@/lib/dashboard/helpers";
import type { ChecksPanelProps } from "@/lib/dashboard/ui-contracts";
import type { Category, CheckDescriptor, ChecksResponse, CustomCheckCriteria, CustomCheckUpsert } from "@/lib/review-contracts";

const message = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";
const categories: Category[] = ["flight", "hotel", "train", "bus", "other"];
const criterionLabels: { key: keyof CustomCheckCriteria; label: string }[] = [
  { key: "pass", label: "Pass when" },
  { key: "fail", label: "Fail when" },
  { key: "unknown", label: "Unknown when" },
];
interface CheckForm { id: string | null; version: number; label: string; instructions: string; category: Category | "all"; criteria: CustomCheckCriteria }
const emptyForm: CheckForm = { id: null, version: 0, label: "", instructions: "", category: "all", criteria: { pass: "", fail: "", unknown: "" } };

function CheckRow({ check }: { check: CheckDescriptor }) {
  return <li className="flex flex-wrap items-start justify-between gap-3 border-t py-3">
    <div className="min-w-0"><p className="font-medium">{check.label}</p><p className="mt-1 text-sm text-muted-foreground">{check.description}</p></div>
    <Badge variant="secondary" className="h-6 rounded">Built in{check.category ? ` · ${statusLabel(check.category)}` : ""}</Badge>
  </li>;
}

export function ChecksPanel({ client, knowledgeRevision, capabilities, simulatedEnvironment, onChanged }: ChecksPanelProps) {
  const [data, setData] = useState<ChecksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<CheckForm | null>(null);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const enabled = capabilities?.custom_checks === true;
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
      const result = await client.getChecks(signal);
      if (id === request.current && !signal.aborted) setData(result);
    } catch (failure) {
      if (!signal.aborted && id === request.current) throw failure;
    } finally {
      if (controller.current === current) controller.current = null;
      if (id === request.current && !signal.aborted) setLoading(false);
    }
  }, [client, enabled]);

  useEffect(() => { void load().catch(failure => setError(message(failure))); }, [load]);
  useEffect(() => () => { ++request.current; controller.current?.abort(); }, [client]);

  function edit(check: CheckDescriptor) {
    if (!check.id || check.version === undefined) return;
    setForm({ id: check.id, version: check.version, label: check.label, instructions: check.instructions ?? "", category: check.category ?? "all",
      criteria: { pass: check.criteria?.pass ?? "", fail: check.criteria?.fail ?? "", unknown: check.criteria?.unknown ?? "" } });
    setError(null); setNotice(null);
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!form || mutationLock.current) return;
    const upsert: CustomCheckUpsert = {
      label: form.label.trim(), instructions: form.instructions.trim(), category: form.category === "all" ? null : form.category,
      criteria: Object.fromEntries(criterionLabels.map(({ key }) => [key, form.criteria[key].trim()]).filter(([, value]) => value)) as Partial<CustomCheckCriteria>,
    };
    mutationLock.current = true;
    ++request.current;
    controller.current?.abort(); controller.current = null;
    setBusy(form.id ?? "new"); setError(null); setNotice(null);
    try {
      if (form.id) await client.updateCheck(form.id, { ...upsert, expected_check_version: form.version });
      else await client.createCheck(upsert);
      setNotice(form.id ? "Check updated. Recheck claims to apply the change; existing assessments are marked for recheck." : "Check added. It applies to the next reconciliation run.");
      setForm(null);
      const refreshes = await Promise.allSettled([load(), onChanged()]);
      const failedRefresh = refreshes.find(result => result.status === "rejected");
      if (failedRefresh?.status === "rejected") setError(`The change was saved, but refresh failed. ${message(failedRefresh.reason)}`);
    } catch (failure) {
      setError(message(failure));
      try { await load(); } catch { /* Preserve the server's mutation error and last known checks. */ }
    } finally { mutationLock.current = false; setBusy(null); }
  }

  async function toggle(check: CheckDescriptor) {
    if (!check.id || check.version === undefined || mutationLock.current) return;
    const enabling = check.state !== "active";
    mutationLock.current = true;
    ++request.current;
    controller.current?.abort(); controller.current = null;
    setBusy(check.id); setError(null); setNotice(null);
    try {
      const input = { expected_check_version: check.version };
      await (enabling ? client.enableCheck(check.id, input) : client.disableCheck(check.id, input));
      setNotice(enabling ? "Check enabled. It applies to the next reconciliation run." : "Check disabled. Its history is retained; recheck claims to clear it from assessments.");
      const refreshes = await Promise.allSettled([load(), onChanged()]);
      const failedRefresh = refreshes.find(result => result.status === "rejected");
      if (failedRefresh?.status === "rejected") setError(`The change was saved, but refresh failed. ${message(failedRefresh.reason)}`);
    } catch (failure) {
      setError(message(failure));
      try { await load(); } catch { /* Preserve the server's mutation error and last known checks. */ }
    } finally { mutationLock.current = false; setBusy(null); }
  }

  if (!enabled) return <section aria-label="Checks"><p className="py-6 text-sm text-muted-foreground">Custom checks are unavailable on this backend. Claim review remains available.</p></section>;

  const local = data?.checks.filter(check => check.layer === "local") ?? [];
  const semantic = data?.checks.filter(check => check.layer === "jev" && check.builtin) ?? [];
  const custom = data?.checks.filter(check => !check.builtin) ?? [];

  return <section className="space-y-6" aria-label="Checks">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Checks</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Every claim is checked locally first, then sent to Jev for semantic checks. Custom Jev checks return pass, fail, or needs review; a custom check can flag a claim but can never override a failed financial or duplicate check.</p></div><Button variant="outline" size="lg" disabled={loading || !!busy} aria-busy={loading} onClick={() => { setError(null); void load().catch(failure => setError(message(failure))); }}><RotateCw aria-hidden="true" className={loading ? "motion-safe:animate-spin" : undefined} />{loading ? "Refreshing…" : "Refresh checks"}</Button></div>
    {client.mode === "preview" && <div className="flex items-start gap-2 text-sm text-muted-foreground"><FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>Preview workspace. Custom checks stay “needs review” in simulated evaluation.</p></div>}
    {error && <p role="alert" className="motion-enter rounded border border-destructive/20 bg-[var(--status-bad-bg)] p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="motion-enter text-sm text-[var(--status-good)]">{notice}</p>}
    {!data && loading && <p role="status" className="py-8 text-sm text-muted-foreground">Loading checks…</p>}

    {data && <>
      <div><h3 className="text-sm font-semibold">Local checks</h3><p className="mt-1 text-xs text-muted-foreground">Deterministic rules evaluated in code on every claim. These are fixed and cannot be edited.</p><ul>{local.map(check => <CheckRow key={check.key} check={check} />)}</ul></div>
      <div><h3 className="text-sm font-semibold">Sent to Jev</h3><p className="mt-1 text-xs text-muted-foreground">Semantic questions answered by Jev with calibrated pass, fail, or needs-review verdicts.</p><ul>{semantic.map(check => <CheckRow key={check.key} check={check} />)}</ul></div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Custom checks</h3><p className="mt-1 text-xs text-muted-foreground">Your questions, sent to Jev alongside the built-in checks. An unclear answer routes the claim to human review.</p></div>{!form && <Button variant="outline" size="lg" disabled={!!busy || custom.length >= 12} onClick={() => { setForm({ ...emptyForm, criteria: { ...emptyForm.criteria } }); setError(null); setNotice(null); }}><Plus aria-hidden="true" /> New check</Button>}</div>
        {custom.length >= 12 && <p className="mt-2 text-xs text-muted-foreground">At most 12 custom checks are supported. Disable or edit an existing check to add another.</p>}

        {form && <form className="mt-4 max-w-2xl space-y-4 rounded border p-4" onSubmit={submitForm} aria-label={form.id ? "Edit check" : "New check"}>
          <div className="flex items-center justify-between gap-3"><h4 className="font-medium">{form.id ? "Edit check" : "New custom check"}</h4><Button type="button" variant="ghost" size="icon-sm" aria-label="Close check form" onClick={() => setForm(null)}><X aria-hidden="true" /></Button></div>
          <div className="space-y-2"><Label htmlFor="check-label">Name</Label><Input id="check-label" required maxLength={80} value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="e.g. Itemized receipt present" /></div>
          <div className="space-y-2"><Label htmlFor="check-instructions">Question for Jev</Label><Textarea id="check-instructions" required minLength={10} maxLength={2000} rows={3} value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} placeholder="e.g. Does the receipt include an itemized breakdown of charges?" /><p className="text-xs text-muted-foreground">Jev answers pass, fail, or needs review. Anything unclear goes to a human reviewer.</p></div>
          <div className="space-y-2"><Label htmlFor="check-category">Applies to</Label><Select value={form.category} onValueChange={value => setForm({ ...form, category: value as Category | "all" })}><SelectTrigger id="check-category" className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map(value => <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>)}</SelectContent></Select></div>
          <fieldset className="space-y-3"><legend className="text-sm font-medium">Answer criteria <span className="font-normal text-muted-foreground">(optional — defaults are used for anything left blank)</span></legend>
            {criterionLabels.map(({ key, label }) => <div key={key} className="space-y-2"><Label htmlFor={`check-${key}`}>{label}</Label><Textarea id={`check-${key}`} maxLength={500} rows={2} value={form.criteria[key]} onChange={event => setForm({ ...form, criteria: { ...form.criteria, [key]: event.target.value } })} placeholder={key === "pass" ? "The receipt evidence clearly satisfies this check." : key === "fail" ? "The receipt evidence clearly violates this check." : "The evidence is missing, incomplete, or conflicting."} /></div>)}
          </fieldset>
          <div className="flex gap-2"><Button type="submit" disabled={!!busy} aria-busy={busy === (form.id ?? "new")}>{busy === (form.id ?? "new") && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy === (form.id ?? "new") ? "Saving…" : form.id ? "Save check" : "Add check"}</Button><Button type="button" variant="outline" disabled={!!busy} onClick={() => setForm(null)}>Cancel</Button></div>
        </form>}

        {data && !custom.length && !form && <div className="mt-3 border-y py-8"><h4 className="font-medium">No custom checks yet</h4><p className="mt-2 max-w-xl text-sm text-muted-foreground">Add a question such as “Does the receipt show an itemized breakdown?” and Sift will send it to Jev on every applicable claim.</p></div>}
        {custom.map(check => <article key={check.key} aria-label={`${check.label} check`} className="mt-4 border-t py-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{check.label}</p><p className="mt-1 text-sm text-muted-foreground">{check.instructions}</p><p className="mt-2 text-xs text-muted-foreground">Scope: {check.category ? statusLabel(check.category) : "All categories"} · Version {check.version} · Field <code>{check.key}</code></p></div><Badge variant="secondary" className={`h-6 rounded capitalize ${check.state === "active" ? "bg-[var(--status-good-bg)] text-[var(--status-good)]" : ""}`}>{check.state === "active" && <ShieldCheck aria-hidden="true" />}{check.state}</Badge></div>
          {check.criteria && <dl className="mt-3 space-y-1 text-xs text-muted-foreground"><div><dt className="inline font-medium">Pass when: </dt><dd className="inline">{check.criteria.pass}</dd></div><div><dt className="inline font-medium">Fail when: </dt><dd className="inline">{check.criteria.fail}</dd></div><div><dt className="inline font-medium">Unknown when: </dt><dd className="inline">{check.criteria.unknown}</dd></div></dl>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="lg" disabled={!!busy || !!form} onClick={() => edit(check)}><Pencil aria-hidden="true" /> Edit</Button>
            <Button variant="outline" size="lg" disabled={!!busy} aria-busy={busy === check.id} onClick={() => void toggle(check)}>{busy === check.id && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{busy === check.id ? (check.state === "active" ? "Disabling…" : "Enabling…") : check.state === "active" ? "Disable" : "Enable"}</Button>
          </div>
        </article>)}
      </div>
      <p className="text-xs text-muted-foreground">Rule set {revision}. Changing checks marks in-progress assessments for recheck; approvals already on record are preserved.</p>
    </>}
  </section>;
}
