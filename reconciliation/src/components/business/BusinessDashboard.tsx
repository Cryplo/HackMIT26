"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, Download, ChevronRight, LoaderCircle, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createDashboardClient } from "@/lib/dashboard/client";
import type { Assessment, Category, HumanDecision, ReviewsResponse, SearchFilters, SearchResponse } from "@/lib/review-contracts";
import { DashboardError } from "@/lib/dashboard/helpers";
import { claimedTotals, reviewInsights, totalsLabel } from "@/lib/dashboard/review";
import { AppShell } from "./AppShell";
import { ReviewTable } from "./ReviewTable";
import { ReviewSheet } from "./ReviewSheet";
import { RulesPanel } from "./RulesPanel";
import styles from "./business.module.css";

const tabs = [{ value: "pending", label: "Needs review" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }] as const;
const categories = ["flight", "hotel", "train", "bus", "other"] as const;

export default function BusinessDashboard({ preview = false }: { preview?: boolean }) {
  const client = useMemo(() => createDashboardClient(preview ? "preview" : "api"), [preview]);
  const [view, setView] = useState<"reviews" | "rules">("reviews");
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [insightKey, setInsightKey] = useState<string | null>(null);
  const [backIds, setBackIds] = useState<string[]>([]);
  const linkedClaimHandled = useRef(false);
  const refreshController = useRef<AbortController | null>(null);
  const [updated, setUpdated] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [decision, setDecision] = useState<HumanDecision | "all">("pending");
  const [category, setCategory] = useState<Category | "all">("all");
  const [assessment, setAssessment] = useState<Assessment | "all">("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<{ query: string; response: SearchResponse } | null>(null);
  const requestSequence = useRef(0);
  const refreshPending = useRef(false);
  const mutation = useRef(false);
  const searchSequence = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const sequence = ++requestSequence.current;
    refreshPending.current = true;
    try {
      const result = await client.getReviews(requestSignal);
      if (requestSignal.aborted || sequence !== requestSequence.current) return;
      setData(result);
      setError("");
      setUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      const ids = new Set(result.submissions.map((row) => row.id));
      setSelected((values) => values.filter((id) => ids.has(id)));
      setActiveId((id) => id && ids.has(id) ? id : null);
    } catch (failure) {
      if (!requestSignal.aborted && sequence === requestSequence.current) {
        setError(failure instanceof Error ? failure.message : "Unable to load reviews.");
        throw failure;
      }
    } finally {
      if (sequence === requestSequence.current) {
        refreshPending.current = false;
        if (!requestSignal.aborted) setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError("");
    setActionError("");
    setSelected([]);
    setActiveId(null);
    setSearchResult(null);
    setSearchError("");
    setNotice("");
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {});
    const timer = setInterval(() => {
      if (!refreshPending.current && !mutation.current) void refresh(controller.signal).catch(() => {});
    }, 3000);
    return () => {
      controller.abort();
      refreshController.current?.abort();
      clearInterval(timer);
      ++requestSequence.current;
      ++searchSequence.current;
    };
  }, [refresh]);

  useEffect(() => {
    if (!data || linkedClaimHandled.current) return;
    linkedClaimHandled.current = true;
    const id = new URLSearchParams(window.location.search).get("claim");
    if (!id) return;
    if (data.submissions.some(row => row.id === id)) setActiveId(id);
    else setNotice(`Claim ${id} is not loaded in this snapshot. Refresh the queue to look for it.`);
  }, [data]);

  const onChanged = useCallback(async () => { await refresh(); }, [refresh]);
  const rows = data?.submissions ?? [];
  const active = rows.find((row) => row.id === activeId) ?? null;
  const insights = useMemo(() => data ? reviewInsights(data) : null, [data]);
  const activeInsight = insights?.items.find(item => item.key === insightKey);
  const visible = rows.filter((row) =>
    (!insightKey || activeInsight?.ids.includes(row.id)) &&
    (decision === "all" || row.decision_status === decision) &&
    (category === "all" || row.category === category) &&
    (assessment === "all" || row.assessment_status === assessment) &&
    `${row.id} ${row.attendee_name} ${row.email} ${row.receipt?.parsed_fields_json?.vendor ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const matches = searchResult ? rows.filter(row => searchResult.response.matches.some(match => match.id === row.id)) : [];
  const possible = searchResult ? rows.filter(row => !matches.some(match => match.id === row.id) && searchResult.response.possible_matches.some(match => match.id === row.id)) : [];
  const shown = searchResult ? [...matches, ...possible] : visible;
  const hiddenSelected = selected.filter(id => !shown.some(row => row.id === id)).length;
  const staleSearch = !!searchResult && searchResult.response.snapshot_token !== data?.snapshot_token;

  function clearSemanticSearch() {
    ++searchSequence.current;
    setSearchResult(null);
    setSearchError("");
    setSearching(false);
  }
  function toggleSelected(id: string) {
    setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 1000 ? [...ids, id] : ids);
  }
  function selectVisible(ids: string[], checked: boolean) {
    setSelected((previous) => checked ? [...new Set([...previous, ...ids])].slice(0, 1000) : previous.filter((id) => !ids.includes(id)));
  }
  async function recheck(ids: string[]) {
    if (mutation.current) throw new Error("A recheck is already in progress.");
    if (!ids.length || ids.length > 50) throw new Error("Select between 1 and 50 claims to recheck.");
    mutation.current = true;
    ++requestSequence.current;
    refreshPending.current = false;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await client.reconcile({ submission_ids: ids });
      const completed = result.results.filter(row => !row.error && ids.includes(row.submission_id));
      setSelected(values => values.filter(id => !completed.some(row => row.submission_id === id)));
      const failures = ids.filter(id => !completed.some(row => row.submission_id === id));
      if (failures.length) throw new Error(`${completed.length} completed; ${failures.length} failed or returned no result: ${failures.map(id => `${id}: ${result.results.find(row => row.submission_id === id)?.error || "No result"}`).join("; ")}`);
      setNotice(`${result.results.length} ${result.results.length === 1 ? "claim rechecked" : "claims rechecked"}. Human decisions were preserved.`);
      setSelected((values) => values.filter((id) => !ids.includes(id)));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Recheck failed.";
      setActionError(`${message} Some claims may have finished; inspect the refreshed queue before retrying.`);
      throw failure;
    } finally {
      try { await refresh(); } catch { /* Keep the refresh error visible above the last successful snapshot. */ }
      mutation.current = false;
      setBusy(false);
    }
  }
  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    if (!data || !query.trim() || searching) return;
    const sequence = ++searchSequence.current;
    const filters: SearchFilters = {
      ...(decision !== "all" ? { decision_status: decision } : {}),
      ...(category !== "all" ? { category } : {}),
      ...(assessment !== "all" ? { assessment_status: assessment } : {}),
    };
    if (insightKey) { setInsightKey(null); setNotice("Insight filter cleared. AI search uses the displayed category, assessment, and decision filters."); }
    setSearchResult(null);
    setSearching(true);
    setSearchError("");
    try {
      const response = await client.search({ query: query.trim(), snapshot_token: data.snapshot_token, filters });
      if (sequence === searchSequence.current) setSearchResult({ query: query.trim(), response });
    } catch (failure) {
      if (sequence === searchSequence.current) setSearchError(failure instanceof Error ? failure.message : "Search could not be completed.");
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  function openClaim(id: string) {
    setBackIds([]);
    setActiveId(id);
  }
  function clearFilters() {
    setQuery(""); setCategory("all"); setAssessment("all"); setDecision("all"); setInsightKey(null); clearSemanticSearch();
  }
  async function exportSelected() {
    if (!data?.capabilities?.export || exportLock.current || selected.length < 1 || selected.length > 1000) return;
    const input = { snapshot_token: data.snapshot_token, submission_ids: [...new Set(selected)] };
    exportLock.current = true;
    setExporting(true); setActionError(""); setNotice("");
    try {
      const blob = await client.exportReviews(input);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "sift-reviews.csv";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${input.submission_ids.length} explicitly selected claims from the captured snapshot.`);
    } catch (failure) {
      setActionError(failure instanceof DashboardError && failure.code === "STALE_SNAPSHOT"
        ? "Claims or rules changed. No file was created. Review the refreshed selection, then explicitly export again."
        : failure instanceof Error ? failure.message : "Export failed. No file was created.");
      try { await refresh(); } catch { /* Retain the last successful snapshot with its error. */ }
    } finally { exportLock.current = false; setExporting(false); }
  }
  const tableProps = { selected, activeId, busy, knowledgeRevision: data?.knowledge_revision ?? 0, capabilities: data?.capabilities, onSelect: toggleSelected, onSelectVisible: selectVisible, onOpen: openClaim };

  return (
    <AppShell view={view} onViewChange={setView} preview={preview}>
      <div className={styles.topline}>
        <span className={styles.breadcrumb}>Expenses <ChevronRight aria-hidden="true" /> <span>{view === "reviews" ? "Reimbursements" : "Learned rules"}</span></span>
        <details className={styles.modeDetails}>
          <summary>{preview ? "Preview — synthetic data" : data?.demo_mode ? "Demo environment" : "API workspace"}</summary>
          <div className={styles.modePopover}>
            {preview ? <p>Six fictional claims. Changes stay in this tab and reset on reload. Search and rule tests are simulated.</p> : data ? <dl>{Object.entries(data.execution).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : <p>Connecting to your claims.</p>}

          </div>
        </details>
      </div>
      <header className={styles.header}>
        <div><h1 tabIndex={-1} data-review-focus-fallback>{view === "reviews" ? "Reimbursements" : "Learned rules"}</h1><p>{view === "reviews" ? "Review claims, compare receipts, and make a clear decision." : "Test and manage the merchant names your team has confirmed."}</p></div>
        {view === "reviews" && <div className={styles.headerActions}><Button asChild><Link href="/submit"><Plus aria-hidden="true" /> New claim</Link></Button><Button variant="outline" disabled={!data?.capabilities?.export || !selected.length || exporting || busy} aria-describedby="export-availability" onClick={() => void exportSelected()}><Download aria-hidden="true" />{exporting ? "Exporting…" : "Export selected"}</Button><span id="export-availability" className="text-xs text-muted-foreground">{!data ? "Connecting…" : !data.capabilities?.export ? preview ? "Export unavailable in UI preview" : "Export unavailable on this backend" : "1–1000 selected claims"}</span></div>}
      </header>
      {error && <div role="alert" className={`${styles.error} motion-enter`}><AlertCircle aria-hidden="true" /><div><strong>{error}</strong><p>{data ? "Showing the last successful snapshot. Your selection and open claim are preserved." : "Check the connection and retry. Your stored claims have not been changed."}</p><div className={styles.inlineActions}><Button variant="outline" onClick={() => void refresh().catch(() => {})}>Retry connection</Button></div></div></div>}
      {actionError && <div className={`${styles.error} motion-enter`} role="alert"><AlertCircle aria-hidden="true" /><span>{actionError}</span></div>}
      {notice && <div className={`${styles.notice} motion-enter`} role="status"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss update" onClick={() => setNotice("")}><X /></Button></div>}
      <div key={view} className="motion-enter">
      {view === "rules" ? <RulesPanel client={client} rows={rows} knowledgeRevision={data?.knowledge_revision ?? 0} capabilities={data?.capabilities} simulatedEnvironment={data?.demo_mode === true && data.execution.decisions === "simulated" && data.execution.storage === "local disk"} onOpenClaim={openClaim} onChanged={onChanged} onRecheck={recheck} /> : <>
        <Tabs value={decision} onValueChange={(value) => { setDecision(value as HumanDecision | "all"); clearSemanticSearch(); }} className={styles.tabs}>
          <TabsList className={styles.tabList} aria-label="Human decision">
            {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className={styles.tab}>{tab.label}<span>{!data ? "…" : tab.value === "all" ? rows.length : rows.filter((row) => row.decision_status === tab.value).length}</span></TabsTrigger>)}
          </TabsList>
          <TabsContent value={decision}>
        <section aria-label="Reimbursement queue">
          <div className={styles.insights} aria-label="Queue insights">
            {!data ? <span>Loading insights…</span> : !insights?.available ? <span>Insights unavailable — complete snapshot coverage is required.</span> : !data.capabilities?.knowledge_revisions && !data.capabilities?.duplicate_links ? <span>Insights unavailable — rule revisions and duplicate links are not enabled.</span> : insights.items.length ? insights.items.map(item => <button key={item.key} type="button" onClick={() => { clearFilters(); setInsightKey(item.key); }} aria-pressed={insightKey === item.key}>{item.label} · {item.count} claims / {totalsLabel(item.claimed_minor)} claimed <ChevronRight aria-hidden="true" /></button>) : <span>No qualifying patterns in the available insight types.</span>}
          </div>
          {insightKey && <div className={styles.activeFilter}><span>{activeInsight ? `${activeInsight.label} · ${activeInsight.count} claims / ${totalsLabel(activeInsight.claimed_minor)} claimed` : "This insight no longer has qualifying claims in the current snapshot."}</span><Button variant="ghost" onClick={() => { setInsightKey(null); clearSemanticSearch(); }}>Clear insight <X aria-hidden="true" /></Button></div>}
          <div className={styles.toolbar}>
            <form onSubmit={runSearch} className={styles.searchForm}>
              <label className={styles.searchInput}><span className="sr-only">Search claims</span><Search aria-hidden="true" /><Input type="search" placeholder="Search claims…" maxLength={300} value={query} onChange={(event) => { setQuery(event.target.value); clearSemanticSearch(); }} /></label>
              <Button type="submit" variant="outline" disabled={!data || !query.trim() || searching} aria-label={searching ? "Searching claims" : "AI search"} aria-busy={searching}>{searching ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Sparkles aria-hidden="true" />} {searching ? "Searching…" : "AI search"}</Button>
            </form>
            <Select value={category} onValueChange={(value) => { setCategory(value as Category | "all"); clearSemanticSearch(); }}><SelectTrigger className={styles.filter} aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select>
            <Select value={assessment} onValueChange={(value) => { setAssessment(value as Assessment | "all"); clearSemanticSearch(); }}><SelectTrigger className={styles.filter} aria-label="Assessment"><SelectValue placeholder="Assessment" /></SelectTrigger><SelectContent><SelectItem value="all">All assessments</SelectItem><SelectItem value="matched">Matched</SelectItem><SelectItem value="flagged">Flagged</SelectItem><SelectItem value="needs_review">Needs review</SelectItem></SelectContent></Select>
            <div className={styles.toolbarEnd}>{selected.length ? <><span>{selected.length} selected{hiddenSelected > 0 ? ` (${hiddenSelected} hidden)` : ""}</span><Button variant="outline" disabled={busy || selected.length > 50} aria-busy={busy} onClick={() => void recheck(selected).catch(() => {})}><RefreshCw aria-hidden="true" className={busy ? "motion-safe:animate-spin" : undefined} />{busy ? "Rechecking…" : "Recheck selected"}</Button><Button variant="ghost" size="icon" disabled={busy} aria-label="Clear selection" onClick={() => setSelected([])}><X /></Button></> : <span>{data ? `${shown.length} claims / ${totalsLabel(claimedTotals(shown))} claimed` : "Loading claims…"}</span>}</div>
          </div>
          {selected.length >= 50 && <p className={styles.limitNotice}>Recheck accepts at most 50 claims per action; export accepts up to 1000. Reduce the selection to recheck.</p>}
          {searchError && <div role="alert" className={`${styles.error} motion-enter`}><AlertCircle aria-hidden="true" /><span>{searchError}{searchResult && " Previous search results remain below."}</span></div>}
          {searchResult ? <>
            <div className={styles.searchSummary}><div><strong>Results for “{searchResult.query}”</strong><span>{searchResult.response.mode === "simulated" ? "Simulated search" : "Semantic search"} · {searchResult.response.evaluated_count} claims evaluated</span></div><Button variant="ghost" onClick={() => { clearSemanticSearch(); setQuery(""); }}>Clear search <X aria-hidden="true" /></Button></div>
            {staleSearch && <div role="status" className={`${styles.staleNotice} motion-enter`}><span>Results are stale. Claims or rules have changed since this search.</span><Button variant="outline" disabled={searching} aria-busy={searching} onClick={() => void runSearch()}>{searching && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{searching ? "Searching…" : "Search again"}</Button></div>}
            <h2 className={styles.resultHeading}>Matches <span>{matches.length}</span></h2>
            <ReviewTable {...tableProps} rows={matches} label="Search matches" />
            {!matches.length && <div className={styles.empty}>No confirmed matches for this search.</div>}
            <h2 className={styles.resultHeading}>Possible matches <span>{possible.length}</span></h2>
            <p className={styles.possibleNote}>These claims need a closer look before treating them as a match.</p>
            <ReviewTable {...tableProps} rows={possible} label="Possible search matches" />
            {!possible.length && <div className={styles.empty}>No possible matches.</div>}
          </> : <>
            <ReviewTable {...tableProps} rows={visible} />
            {!visible.length && <div className={styles.empty} role="status"><strong>{loading ? "Loading claims…" : !data ? "Waiting for reviews" : rows.length ? "No claims in this view" : "No claims yet"}</strong><p>{loading ? "Connecting to the review workspace." : !data ? "Your claims will appear when the review API is available." : query || category !== "all" || assessment !== "all" || insightKey || decision !== "all" ? "Try another search or clear your filters." : "Choose another decision tab to see more claims."}</p>{data && (query || category !== "all" || assessment !== "all" || insightKey || decision !== "all") && <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}{data && !rows.length && <Button asChild><Link href="/submit">New claim</Link></Button>}</div>}
          </>}
          <footer className={styles.queueFooter}><span>Approval authorizes reimbursement. No payments are sent.</span><span>{updated ? `Updated ${updated}` : "Select up to 50 claims to recheck"}</span></footer>
        </section>
          </TabsContent>
        </Tabs>
      </>}
      </div>
      <ReviewSheet row={active} rows={rows} open={!!active} onOpenChange={(open) => { if (!open) { setActiveId(null); setBackIds([]); } }} client={client} knowledgeRevision={data?.knowledge_revision ?? 0} capabilities={data?.capabilities} backId={backIds.at(-1) ?? null} onBack={() => { setActiveId(backIds.at(-1) ?? null); setBackIds(ids => ids.slice(0, -1)); }} onOpenClaim={id => { if (activeId) setBackIds(ids => [...ids, activeId]); setActiveId(id); }} onChanged={onChanged} onOpenRules={() => { setActiveId(null); setView("rules"); }} />
    </AppShell>
  );
}
