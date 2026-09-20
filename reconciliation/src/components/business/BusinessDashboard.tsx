"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, Download, ChevronRight, LoaderCircle, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { checkClaims, useWorkspace, type CheckProgress } from "@/lib/dashboard/workspace-store";
import type { Assessment, Category, HumanDecision, ReviewRow, SearchFilters, SearchResponse } from "@/lib/review-contracts";
import { getWorkspaceStore } from "@/lib/dashboard/client";
import { checkState, humanActions, nextHumanAction, type ReviewGroup } from "@/lib/dashboard/human-actions";
import { DashboardError } from "@/lib/dashboard/helpers";
import { claimedTotals, totalsLabel } from "@/lib/dashboard/review";
import { AppShell } from "./AppShell";
import { ReviewTable } from "./ReviewTable";
import { ReviewSheet } from "./ReviewSheet";
import { RulesPanel } from "./RulesPanel";
import styles from "./business.module.css";

const tabs = [{ value: "pending", label: "To resolve" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }] as const;
const isUnchecked = (row: ReviewRow) => row.decision_status === "pending" && row.processing_status !== "running"
  && row.latest_investigation?.status !== "running" && row.receipt?.extraction_status === "succeeded" && !!row.receipt.parsed_fields_json
  && (!row.assessment_status || !row.latest_run_id || row.processing_status === "failed");
const categories = ["flight", "hotel", "train", "bus", "other"] as const;

export default function BusinessDashboard({ preview = false }: { preview?: boolean }) {
  const { client, data, error, loading, refresh, updatedAt } = useWorkspace(preview);
  const [view, setView] = useState<"reviews" | "rules">("reviews");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [backIds, setBackIds] = useState<string[]>([]);
  const linkedClaimHandled = useRef(false);
  const [progress, setProgress] = useState<CheckProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopChecking = useRef({ stopped: false });
  const updated = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reviewSession, setReviewSession] = useState<{ group: ReviewGroup; ids: string[]; completed: string[] } | null>(null);
  const [decision, setDecision] = useState<HumanDecision | "all">("pending");
  const [category, setCategory] = useState<Category | "all">("all");
  const [assessment, setAssessment] = useState<Assessment | "all" | "unchecked">("all");
  const [textSearch, setTextSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const questionInput = useRef<HTMLInputElement>(null);
  const askToggle = useRef<HTMLButtonElement>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<{ query: string; response: SearchResponse } | null>(null);
  const mutation = useRef(false);
  const searchSequence = useRef(0);

  useEffect(() => {
    stopChecking.current = { stopped: false };
    setActionError(""); setNotice(""); setSelected([]); setActiveId(null); setReviewSession(null);
    setSearchResult(null); setSearchError("");
    linkedClaimHandled.current = false;
    return () => { stopChecking.current.stopped = true; ++searchSequence.current; };
  }, [client]);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.submissions.map(row => row.id));
    setSelected(values => values.filter(id => ids.has(id)));
    setActiveId(id => id && ids.has(id) ? id : null);
  }, [data]);

  useEffect(() => {
    if (!data || linkedClaimHandled.current) return;
    linkedClaimHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "rules") setView("rules");
    if (params.get("assessment") === "unchecked") setAssessment("unchecked");
    const id = params.get("claim");
    if (!id) return;
    if (data.submissions.some(row => row.id === id)) {
      setActiveId(id);
      const action = humanActions(data).find(action => action.row.id === id);
      if (action) setReviewSession({ group: action.group, ids: [id], completed: [] });
    }
    else setNotice(`Claim ${id} is not loaded in this snapshot. Refresh the queue to look for it.`);
  }, [data]);

  const onChanged = useCallback(async () => { await client.getReviews(); }, [client]);
  const rows = data?.submissions ?? [];
  const active = rows.find((row) => row.id === activeId) ?? null;
  const matchesFilters = (row: ReviewRow) =>
    (decision === "all" || row.decision_status === decision) &&
    (category === "all" || row.category === category) &&
    (assessment === "all" || (assessment === "unchecked" ? isUnchecked(row) : row.assessment_status === assessment));
  const matchesQuery = (row: ReviewRow) =>
    `${row.id} ${row.attendee_name} ${row.email} ${row.receipt?.parsed_fields_json?.vendor ?? ""}`.toLowerCase().includes(textSearch.trim().toLowerCase());
  const visible = rows.filter(row => matchesFilters(row) && matchesQuery(row));
  const matches = searchResult ? rows.filter(row => searchResult.response.matches.some(match => match.id === row.id)) : [];
  const possible = searchResult ? rows.filter(row => !matches.some(match => match.id === row.id) && searchResult.response.possible_matches.some(match => match.id === row.id)) : [];
  const shown = searchResult ? [...matches, ...possible] : visible;
  const reviewActions = data ? humanActions(data) : [];
  const reviewQueue = reviewActions.filter(action => action.group === "inconclusive" && shown.some(row => row.id === action.row.id) && matchesFilters(action.row)).map(action => action.row);
  const queueRemaining = reviewSession ? reviewActions.filter(action => action.group === reviewSession.group && reviewSession.ids.includes(action.row.id)).length : 0;
  const checkedCount = rows.filter(row => ["passed", "needs_review", "flagged"].includes(checkState(row))).length;
  const automaticCount = rows.filter(row => row.decision_status === "approved" && row.decision_source === "automatic").length;
  const runningCount = rows.filter(row => checkState(row) === "running").length;
  const hiddenSelected = selected.filter(id => !shown.some(row => row.id === id)).length;
  const unchecked = shown.filter(isUnchecked);
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
    if (mutation.current) throw new Error("A check is already in progress.");
    mutation.current = true;
    const run = { stopped: false };
    stopChecking.current = run;
    setBusy(true); setStopping(false); setActionError(""); setNotice("");
    setProgress({ done: 0, total: ids.length, checkingIds: [], completedIds: [] });
    try {
      const result = await checkClaims(client, ids, next => {
        setProgress(next);
        setSelected(values => values.filter(id => !next.completedIds.includes(id)));
      }, () => run.stopped);
      setNotice(`${result.done}/${ids.length} claims checked${result.stopped ? "; remaining claims were not started" : ""}.`);
      if (result.emailWarnings?.length) setActionError(`Checks saved; ${result.emailWarnings.length} email notices need attention. Open applicant communication to review delivery.`);
    } catch (failure) {
      setActionError(`${failure instanceof Error ? failure.message : "Check failed."} Some claims may have finished. Inspect the queue before retrying; remaining batches were not started.`);
      throw failure;
    } finally {
      mutation.current = false;
      setBusy(false);
      setProgress(value => value ? { ...value, checkingIds: [] } : null);
    }
  }
  async function runSearch(event?: FormEvent, searchQuestion = question) {
    event?.preventDefault();
    if (!data?.snapshot_token || !searchQuestion.trim() || searching || assessment === "unchecked") return;
    const sequence = ++searchSequence.current;
    const filters: SearchFilters = {
      ...(decision !== "all" ? { decision_status: decision } : {}),
      ...(category !== "all" ? { category } : {}),
      ...(assessment !== "all" ? { assessment_status: assessment } : {}),
    };
    setTextSearch("");
    setSearching(true);
    setSearchError("");
    try {
      const response = await client.search({ query: searchQuestion.trim(), snapshot_token: data.snapshot_token, filters });
      if (sequence === searchSequence.current) setSearchResult({ query: searchQuestion.trim(), response });
    } catch (failure) {
      if (sequence === searchSequence.current) setSearchError(failure instanceof Error ? failure.message : "Search could not be completed.");
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  function openClaim(id: string) {
    setNotice("");
    setBackIds([]);
    setActiveId(id);
    const action = reviewActions.find(action => action.row.id === id);
    const scope = shown.filter(row => matchesFilters(row) && reviewActions.some(item => item.row.id === row.id && item.group === action?.group)).map(row => row.id);
    setReviewSession(action ? { group: action.group, ids: scope.includes(id) ? scope : [id, ...scope], completed: [] } : null);
  }
  async function advanceQueue(saved: ReviewRow) {
    const fresh = getWorkspaceStore(preview ? "preview" : "api").getSnapshot().data;
    if (!fresh) return;
    const groupIds = new Set(humanActions(fresh).filter(action => action.group === reviewSession?.group).map(action => action.row.id));
    const matchesView = (row: ReviewRow) => groupIds.has(row.id) && matchesFilters(row) && (!!searchResult || matchesQuery(row));
    const next = nextHumanAction(fresh, saved.id, reviewSession?.ids ?? [], matchesView);
    setReviewSession(session => session && session.ids.includes(saved.id) ? { ...session, completed: [...new Set([...session.completed, saved.id])] } : session);
    setBackIds([]);
    setActiveId(next?.id ?? null);
    setNotice(next ? "" : "Decision saved. This review session is complete.");
  }
  function clearFilters() {
    setTextSearch(""); setQuestion(""); setCategory("all"); setAssessment("all"); setDecision("all"); clearSemanticSearch();
  }
  async function exportSelected() {
    if (!data?.snapshot_token || !data.capabilities?.export || exportLock.current || selected.length < 1 || selected.length > 1000) return;
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
  const tableProps = { selected, activeId, busy, checkingIds: progress?.checkingIds, knowledgeRevision: data?.knowledge_revision ?? 0, capabilities: data?.capabilities, onSelect: toggleSelected, onSelectVisible: selectVisible, onOpen: openClaim };

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
        <div><h1 tabIndex={-1} data-review-focus-fallback>{view === "reviews" ? "Reimbursements" : "Learned rules"}</h1><p>{view === "reviews" ? "Track every claim and resolve the exceptions." : "Test and manage the merchant names your team has confirmed."}</p></div>
        {view === "reviews" && <div className={styles.headerActions}><Button asChild variant="outline"><Link href="/submit"><Plus aria-hidden="true" /> New claim</Link></Button><Button variant="outline" disabled={!data?.snapshot_token || !data.capabilities?.export || !selected.length || exporting || busy} aria-describedby="export-availability" onClick={() => void exportSelected()}><Download aria-hidden="true" />{exporting ? "Exporting…" : "Export selected"}</Button><span id="export-availability" className="text-xs text-muted-foreground">{!data ? "Connecting…" : !data.capabilities?.export ? "Export unavailable" : selected.length ? `${selected.length} selected` : "Select claims to export"}</span></div>}
      </header>
      {error && <div role="alert" className={`${styles.error} motion-enter`}><AlertCircle aria-hidden="true" /><div><strong>{error}</strong><p>{data ? "Showing the last successful snapshot. Your selection and open claim are preserved." : "Check the connection and retry. Your stored claims have not been changed."}</p><div className={styles.inlineActions}><Button variant="outline" onClick={() => void refresh().catch(() => {})}>Retry connection</Button></div></div></div>}
      {actionError && <div className={`${styles.error} motion-enter`} role="alert"><AlertCircle aria-hidden="true" /><span>{actionError}</span></div>}
      {notice && <div className={`${styles.notice} motion-enter`} role="status"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss update" onClick={() => setNotice("")}><X /></Button></div>}
      <div key={view} className="motion-enter">
      {view === "rules" ? <RulesPanel client={client} rows={rows} knowledgeRevision={data?.knowledge_revision ?? 0} capabilities={data?.capabilities} simulatedEnvironment={data?.demo_mode === true && data.execution.decisions === "simulated" && data.execution.storage === "local disk"} onOpenClaim={openClaim} onChanged={onChanged} onRecheck={recheck} /> : <>
        {data && <div className={styles.machineCounts} aria-label="Claim progress"><span>Checked <strong>{checkedCount} / {rows.length}</strong></span><progress value={checkedCount} max={rows.length || 1} aria-label="Claims checked" />{data.capabilities?.automatic_processing && <span>Approved automatically <strong>{automaticCount}</strong></span>}</div>}
        {runningCount > 0 && <div role="status" className={styles.runningBanner}><LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /><span>{runningCount} {runningCount === 1 ? "claim is" : "claims are"} being checked or investigated. You can keep reviewing.</span></div>}
        <Tabs value={decision} onValueChange={(value) => { setDecision(value as HumanDecision | "all"); clearSemanticSearch(); }} className={styles.tabs}>
          <TabsList className={styles.tabList} aria-label="Claim status">
            {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className={styles.tab}>{tab.label}<span>{!data ? "…" : tab.value === "all" ? rows.length : rows.filter((row) => row.decision_status === tab.value).length}</span></TabsTrigger>)}
          </TabsList>
          <TabsContent value={decision}>
        <section aria-label="Reimbursement queue">
          <div className={styles.toolbar}>
            <div className={styles.searchForm}>
              <label className={styles.searchInput}><span className="sr-only">Search names or merchants</span><Search aria-hidden="true" /><Input type="search" placeholder="Search names or merchants" maxLength={300} value={textSearch} onChange={(event) => { setTextSearch(event.target.value); clearSemanticSearch(); }} /></label>
              <Button ref={askToggle} type="button" variant="outline" aria-expanded={askOpen} aria-controls="claim-question-panel" onClick={() => { setAskOpen(!askOpen); if (askOpen) clearSemanticSearch(); }}><Sparkles aria-hidden="true" />Ask about claims</Button>
            </div>
            <Select value={category} onValueChange={(value) => { setCategory(value as Category | "all"); clearSemanticSearch(); }}><SelectTrigger className={styles.filter} aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select>
            <Select value={assessment} onValueChange={(value) => { setAssessment(value as Assessment | "all" | "unchecked"); clearSemanticSearch(); }}><SelectTrigger className={styles.filter} aria-label="Assessment"><SelectValue placeholder="Assessment" /></SelectTrigger><SelectContent><SelectItem value="all">All check results</SelectItem><SelectItem value="matched">Passed</SelectItem><SelectItem value="flagged">Issue found</SelectItem><SelectItem value="needs_review">Needs evidence</SelectItem><SelectItem value="unchecked">Unchecked / failed</SelectItem></SelectContent></Select>
          </div>
          {askOpen && <form id="claim-question-panel" className={styles.questionPanel} onSubmit={runSearch} aria-label="Ask about claims">
            <div className={styles.questionHeading}><label htmlFor="claim-question">What are you looking for?</label><Button type="button" variant="ghost" size="icon-sm" aria-label="Close claim search" onClick={() => { clearSemanticSearch(); setAskOpen(false); askToggle.current?.focus(); }}><X aria-hidden="true" /></Button></div>
            <p id="claim-question-scope" className={styles.questionHint}>Search within: {tabs.find(tab => tab.value === decision)?.label}, {category === "all" ? "all categories" : category}, {assessment === "all" ? "all check results" : assessment === "matched" ? "passed checks" : assessment === "flagged" ? "issues found" : assessment === "needs_review" ? "needs evidence" : "unchecked / failed"}. Name or merchant text is not applied.</p>
            <div className={styles.questionControls}><Input ref={questionInput} id="claim-question" placeholder="e.g. Claims over $200" maxLength={300} value={question} aria-describedby="claim-question-scope claim-question-help" onChange={event => { setQuestion(event.target.value); ++searchSequence.current; setSearching(false); setSearchError(""); }} /><Button type="submit" disabled={!data?.snapshot_token || !question.trim() || searching || assessment === "unchecked"} aria-busy={searching}>{searching ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Search aria-hidden="true" />}{searching ? "Searching claims…" : "Search claims"}</Button>{searching ? <Button type="button" variant="outline" onClick={clearSemanticSearch}>Cancel search</Button> : question && <Button type="button" variant="ghost" onClick={() => { setQuestion(""); clearSemanticSearch(); questionInput.current?.focus(); }}>Clear question</Button>}</div>
            <div className={styles.questionExamples} aria-label="Example questions">{["Hotel claims", "Claims over $200", "Possible duplicates"].map(example => <Button key={example} type="button" variant="ghost" size="sm" onClick={() => { setQuestion(example); ++searchSequence.current; setSearching(false); setSearchError(""); questionInput.current?.focus(); }}>{example}</Button>)}</div>
            <p id="claim-question-help" className={styles.questionHint}>{assessment === "unchecked" ? <>Question search does not support the Unchecked / failed filter. <Button type="button" variant="link" size="sm" onClick={() => { setAssessment("all"); clearSemanticSearch(); }}>Use all check results</Button></> : !data?.snapshot_token ? "Waiting for claims to load before you can search." : searching ? "Searching your claims. You can cancel while the search runs." : "Describe the claims you need, then choose Search claims. This only finds claims; it does not change them."}</p>
            {searchError && <div role="alert" className={styles.error}><AlertCircle aria-hidden="true" /><span>{searchError} Edit your question or try again.{searchResult && " Previous search results remain below."}</span></div>}
          </form>}
          <div className={styles.queueActions}>{reviewQueue.length > 0 && <Button onClick={() => openClaim(reviewQueue[0].id)}>Review inconclusive ({reviewQueue.length}) <ChevronRight aria-hidden="true" /></Button>}{unchecked.length > 0 && <Button id="check-unchecked" variant={unchecked.length ? "default" : "outline"} disabled={busy || !unchecked.length} onClick={() => void recheck(unchecked.slice(0, 1000).map(row => row.id)).catch(() => {})}>Check unchecked ({unchecked.length})</Button>}{selected.length ? <><span>{selected.length} selected{hiddenSelected > 0 ? ` (${hiddenSelected} hidden)` : ""}</span><Button variant={unchecked.length ? "outline" : "default"} disabled={busy || selected.length > 1000} aria-busy={busy} onClick={() => void recheck(selected).catch(() => {})}><RefreshCw aria-hidden="true" className={busy ? "motion-safe:animate-spin" : undefined} />{busy ? "Rechecking…" : "Recheck selected"}</Button><Button variant="ghost" size="icon" disabled={busy} aria-label="Clear selection" onClick={() => setSelected([])}><X /></Button></> : <span>{data ? `${shown.length} claims / ${totalsLabel(claimedTotals(shown))} claimed` : "Loading claims…"}</span>}</div>
          {progress && busy && <div className={styles.checkProgress}><span role="status">{progress.done}/{progress.total} done{busy ? stopping ? " · Finishing current batch…" : " · Checking…" : ""}</span><progress value={progress.done} max={progress.total || 1} aria-label="Claims checked" />{busy && <Button variant="outline" disabled={stopping} onClick={() => { stopChecking.current.stopped = true; setStopping(true); }}>Stop after current batch</Button>}</div>}
          {selected.length >= 1000 && <p className={styles.limitNotice}>1,000 selected. Check or export this selection before selecting more.</p>}
          {searchResult ? <>
            <div className={styles.searchSummary} role="status"><div><strong>Results for “{searchResult.query}”</strong><span>{searchResult.response.mode === "simulated" ? "Simulated search" : "AI search"} · {searchResult.response.evaluated_count} claims evaluated</span></div><Button variant="ghost" onClick={() => { clearSemanticSearch(); setQuestion(""); }}>Clear search <X aria-hidden="true" /></Button></div>
            {staleSearch && <div role="status" className={`${styles.staleNotice} motion-enter`}><span>Results are stale. Claims or rules have changed since this search.</span><Button variant="outline" disabled={searching} aria-busy={searching} onClick={() => { setQuestion(searchResult.query); void runSearch(undefined, searchResult.query); }}>{searching && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{searching ? "Searching…" : "Search again"}</Button></div>}
            <h2 className={styles.resultHeading}>Matches <span>{matches.length}</span></h2>
            <ReviewTable {...tableProps} rows={matches} label="Search matches" />
            {!matches.length && <div className={styles.empty}>No confirmed matches for this search.</div>}
            <h2 className={styles.resultHeading}>Possible matches <span>{possible.length}</span></h2>
            <p className={styles.possibleNote}>These claims need a closer look before treating them as a match.</p>
            <ReviewTable {...tableProps} rows={possible} label="Possible search matches" />
            {!possible.length && <div className={styles.empty}>No possible matches.</div>}
          </> : <>
            <ReviewTable {...tableProps} rows={visible} />
            {!visible.length && <div className={styles.empty} role="status">{loading && !data && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}<strong>{loading ? "Loading claims…" : !data ? "Waiting for reviews" : rows.length ? "No claims in this view" : "No claims yet"}</strong><p>{loading ? "Connecting to the review workspace." : !data ? "Your claims will appear when the review API is available." : textSearch || category !== "all" || assessment !== "all" || decision !== "all" ? "Try another search or clear your filters." : "Choose another decision tab to see more claims."}</p>{data && (textSearch || category !== "all" || assessment !== "all" || decision !== "all") && <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}{data && !rows.length && <Button asChild><Link href="/submit">New claim</Link></Button>}</div>}
          </>}
          <footer className={styles.queueFooter}><span>Approval authorizes reimbursement. No payments are sent.</span><span>{updated ? `Updated ${updated}` : "Select up to 1,000 claims to recheck"} <Button variant="ghost" disabled={busy || loading} aria-busy={loading} onClick={() => void refresh().catch(() => {})}><RefreshCw aria-hidden="true" className={loading ? "motion-safe:animate-spin" : undefined} />{loading ? "Refreshing…" : "Refresh"}</Button></span></footer>
        </section>
          </TabsContent>
        </Tabs>
      </>}
      </div>
      <ReviewSheet simulatedEnvironment={data?.demo_mode === true} row={active} rows={rows} open={!!active} onOpenChange={(open) => { if (!open) { setActiveId(null); setBackIds([]); setReviewSession(null); } }} client={client} knowledgeRevision={data?.knowledge_revision ?? 0} capabilities={data?.capabilities} backId={backIds.at(-1) ?? null} onBack={() => { setActiveId(backIds.at(-1) ?? null); setBackIds(ids => ids.slice(0, -1)); }} onOpenClaim={id => { if (activeId) setBackIds(ids => [...ids, activeId]); setActiveId(id); }} onChanged={onChanged} onDecisionSaved={advanceQueue} queueRemaining={queueRemaining} queueProgress={reviewSession ? { completed: reviewSession.completed.length, total: reviewSession.ids.length } : undefined} onOpenRules={() => { setActiveId(null); setView("rules"); }} />
    </AppShell>
  );
}
