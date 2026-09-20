"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CorrectionInput,
  DecisionSummary,
  ReviewRow,
  ReviewsResponse,
  Status,
} from "../../lib/dashboard/types";
import {
  api,
  money,
  percent,
  statusLabel,
  validateReviews,
} from "../../lib/dashboard/helpers";
import { fixtureReviews } from "../../lib/dashboard/fixtures";
import styles from "./business.module.css";

interface JustificationView {
  summary: string;
  reasons: string[];
  next_step: string;
  model: string;
  simulated: boolean;
  error: string | null;
}

/** Narrative stored with the run; it restates the outcome and never sets it. */
function justificationOf(
  decisions: DecisionSummary[],
): JustificationView | null {
  const evidence = decisions.find(
    (decision) => decision.field_checked === "overall_status",
  )?.evidence_json;
  const value =
    typeof evidence === "object" && evidence !== null
      ? (evidence as { justification?: unknown }).justification
      : null;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<JustificationView>;
  if (
    typeof candidate.summary !== "string" ||
    typeof candidate.next_step !== "string" ||
    !Array.isArray(candidate.reasons)
  )
    return null;
  return {
    summary: candidate.summary,
    reasons: candidate.reasons.filter(
      (reason): reason is string => typeof reason === "string",
    ),
    next_step: candidate.next_step,
    model: typeof candidate.model === "string" ? candidate.model : "unknown",
    simulated: candidate.simulated !== false,
    error: typeof candidate.error === "string" ? candidate.error : null,
  };
}

function JustificationPanel({ decisions }: { decisions: DecisionSummary[] }) {
  const justification = justificationOf(decisions);
  if (!justification) return null;
  return (
    <section className={styles.justification}>
      <h3>Why this outcome</h3>
      <p>{justification.summary}</p>
      <ul>
        {justification.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p>{justification.next_step}</p>
      <p className={styles.footnote}>
        {justification.simulated
          ? "Deterministic summary"
          : `Written by ${justification.model}`}
        {justification.error
          ? ` · model unavailable (${justification.error}), outcome unchanged`
          : ""}
      </p>
    </section>
  );
}

export default function BusinessDashboard() {
  const [mode, setMode] = useState<"api" | "fixtures">("api");
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const mutation = useRef(false);
  const requestSequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    try {
      const result = validateReviews(
        await api<ReviewsResponse>("/api/reviews", undefined, signal),
      );
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setData(result);
      setError("");
      setUpdated(new Date().toLocaleTimeString());
      setSelected((ids) =>
        ids.filter((id) => result.submissions.some((row) => row.id === id)),
      );
    } catch (e) {
      if (!signal?.aborted && sequence === requestSequence.current)
        setError(e instanceof Error ? e.message : "Unable to load reviews.");
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current)
        setLoading(false);
    }
  }, []);
  useEffect(() => {
    ++requestSequence.current;
    setData(null);
    setSelected([]);
    setActive(null);
    setNotice("");
    setError("");
    setUpdated("");
    if (mode === "fixtures") {
      setData(fixtureReviews);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => {
      void refresh(controller.signal);
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
      ++requestSequence.current;
    };
  }, [mode, refresh]);

  async function reconcile() {
    if (!selected.length || mutation.current || mode !== "api") return;
    mutation.current = true;
    ++requestSequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{
        results: {
          submission_id: string;
          run_id: string | null;
          status: Status;
          error?: string;
        }[];
      }>("/api/reconcile", { submission_ids: selected });
      const errors = result.results.filter((row) => row.error);
      setNotice(
        `${result.results.length} reconciliation result(s) returned.${errors.length ? ` ${errors.length} need attention: ${errors.map((row) => row.error).join("; ")}` : " Review the latest decisions below."}`,
      );
      setSelected([]);
    } catch (e) {
      setNotice(
        `Reconciliation request failed: ${e instanceof Error ? e.message : "Unknown error"}. Refresh reviews before retrying; some work may have completed.`,
      );
    } finally {
      mutation.current = false;
      setBusy(false);
      await refresh();
    }
  }
  async function correct(input: CorrectionInput) {
    if (mode !== "api" || mutation.current)
      throw new Error("Another request is in progress.");
    mutation.current = true;
    ++requestSequence.current;
    setBusy(true);
    try {
      const result = await api<{ correction_id: string; status: Status }>(
        "/api/corrections",
        input,
      );
      setNotice(
        `Correction saved. Claim is ${statusLabel(result.status)}. ${input.correction_type === "vendor_alias" ? "Select the related claim and reconcile it to test the scoped learning." : "This decision override applies only to this claim."}`,
      );
      setReviewing(false);
    } finally {
      mutation.current = false;
      setBusy(false);
      await refresh();
    }
  }
  const rows = data?.submissions ?? [];
  const visible = rows.filter(
    (row) =>
      (filter === "all" || row.status === filter) &&
      `${row.attendee_name} ${row.email} ${row.receipt?.parsed_fields_json?.vendor ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const current = rows.find((row) => row.id === active);
  const reviewed = rows.filter((row) => row.status !== "pending").length;
  const reviewCount = rows.filter((row) =>
    ["flagged", "needs_review"].includes(row.status),
  ).length;
  const fixture = mode === "fixtures";
  function toggle(id: string) {
    setSelected((ids) =>
      ids.includes(id)
        ? ids.filter((value) => value !== id)
        : ids.length < 50
          ? [...ids, id]
          : ids,
    );
  }

  return (
    <main className={styles.desk}>
      <div className={styles.topbar}>
        <a href="/business-demo" className={styles.brand}>
          FIELDNOTES <span>/ reimbursement desk</span>
        </a>
        <a href="/submit">New claim ↗</a>
        <a href="/demo">Demo guide ↗</a>
      </div>
      <div
        className={`${styles.banner} ${fixture || data?.demo_mode ? styles.simulated : ""}`}
      >
        <strong>
          {fixture
            ? "SIMULATED FIXTURE PREVIEW · READ ONLY"
            : data?.demo_mode
              ? data?.execution?.decisions === "live Jev" ? "LIVE JEV · LOCAL DEMO · SYNTHETIC DATA ONLY" : "SIMULATED API DEMO · SYNTHETIC DATA ONLY"
              : "SYNTHETIC DATA ONLY · USD"}
        </strong>
        <span>
          {fixture
            ? "Illustrative records. No API actions or live provider results."
            : data?.execution ? `${data.execution.decisions} decisions · ${data.execution.retrieval} retrieval · ${data.execution.storage}. Approved does not mean paid.` : "Hackathon reimbursement review. Approved does not mean paid."}
        </span>
        <button
          disabled={busy}
          onClick={() => setMode(fixture ? "api" : "fixtures")}
        >
          {fixture ? "Connect to API" : "Open fixture preview"}
        </button>
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FINANCE / TRAVEL REIMBURSEMENTS</p>
          <h1>
            Every claim.
            <br />
            <em>A clear decision.</em>
          </h1>
          <p className={styles.intro}>
            Compare the evidence, resolve the exceptions,
            <br />
            and teach the next review what you learned.
          </p>
        </div>
        <div className={styles.headerAside}>
          <span className={styles.largeNumber}>
            {String(rows.length).padStart(2, "0")}
          </span>
          <span>CLAIMS IN THE LEDGER</span>
          <p aria-live="polite">
            {loading
              ? "Connecting to reviews…"
              : fixture
                ? "Five illustrative scenarios"
                : updated
                  ? `Last synced ${updated} · polls every 3s`
                  : "API not connected"}
          </p>
        </div>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          <strong>Reviews could not be refreshed.</strong> {error}{" "}
          {data
            ? "Showing the last successful snapshot."
            : "Start the API or open the labeled fixture preview."}
          <button disabled={busy} onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className={styles.notice}>
          {notice}
        </div>
      )}
      <section className={styles.metrics} aria-label="Reimbursement summary">
        <div>
          <span>APPROVED AMOUNT</span>
          <strong>
            {data ? money(data.summary.approved_amount_minor) : "—"}
          </strong>
          <small>Approved claims · not paid</small>
        </div>
        <div>
          <span>REVIEW RATE</span>
          <strong>{data ? percent(data.summary.flag_rate) : "—"}</strong>
          <small>
            {reviewCount} flagged or needing review / {reviewed} reviewed
          </small>
        </div>
        <div>
          <span>AWAITING RECONCILIATION</span>
          <strong>
            {data ? String(rows.length - reviewed).padStart(2, "0") : "—"}
          </strong>
          <small>Pending claims excluded from review rate</small>
        </div>
      </section>
      <section className={styles.ledger} aria-labelledby="ledger-title">
        <div className={styles.sectionTitle}>
          <div>
            <p className={styles.eyebrow}>01 / THE LEDGER</p>
            <h2 id="ledger-title">Submitted. Extracted. Reviewed.</h2>
          </div>
          <button
            className={styles.primary}
            onClick={reconcile}
            disabled={fixture || busy || !!error || !selected.length}
          >
            {busy
              ? "Working…"
              : `Reconcile selected${selected.length ? ` (${selected.length})` : ""}`}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className={styles.toolbar}>
          <label>
            Find a claim
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Attendee, email, or merchant"
            />
          </label>
          <label>
            Status
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {(
                [
                  "pending",
                  "approved",
                  "flagged",
                  "needs_review",
                  "rejected",
                ] as Status[]
              ).map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <span>{visible.length} shown · select up to 50</span>
        </div>
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label="Scrollable reimbursement ledger"
        >
          <table className={styles.table}>
            <caption className={styles.srOnly}>
              Claims grouped by submitted values, extracted receipt values, and
              review status. Open evidence to inspect decisions.
            </caption>
            <thead>
              <tr className={styles.groups}>
                <th rowSpan={2} scope="col">
                  Select
                </th>
                <th colSpan={3} scope="colgroup">
                  01 / Submitted values
                </th>
                <th colSpan={3} scope="colgroup">
                  02 / Receipt values
                </th>
                <th colSpan={2} scope="colgroup">
                  03 / Review status
                </th>
              </tr>
              <tr>
                <th scope="col">Attendee</th>
                <th scope="col">Category / origin</th>
                <th scope="col">Requested</th>
                <th scope="col">Merchant</th>
                <th scope="col">Receipt total</th>
                <th scope="col">Receipt date</th>
                <th scope="col">Decision</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className={active === row.id ? styles.activeRow : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.attendee_name}`}
                      checked={selected.includes(row.id)}
                      disabled={
                        fixture ||
                        busy ||
                        (!selected.includes(row.id) && selected.length >= 50)
                      }
                      onChange={() => toggle(row.id)}
                    />
                  </td>
                  <th scope="row">
                    <strong>{row.attendee_name}</strong>
                    <small>{row.email}</small>
                  </th>
                  <td>
                    <span className={styles.capitalize}>{row.category}</span>
                    <small>{row.origin_location}</small>
                  </td>
                  <td className={styles.numeric}>
                    {money(row.amount_requested_minor)}
                  </td>
                  <td>
                    {row.receipt?.parsed_fields_json?.vendor ?? "Unknown"}
                    <small>
                      {row.receipt
                        ? `Extraction ${row.receipt.extraction_status}`
                        : "No receipt"}
                    </small>
                  </td>
                  <td className={styles.numeric}>
                    {money(
                      row.receipt?.parsed_fields_json?.amount_minor,
                      row.receipt?.parsed_fields_json?.currency ?? null,
                    )}
                  </td>
                  <td>
                    {row.receipt?.parsed_fields_json?.receipt_date ?? "Unknown"}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[row.status]}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      className={styles.textButton}
                      aria-expanded={active === row.id}
                      onClick={() => {
                        setActive(active === row.id ? null : row.id);
                        setReviewing(false);
                      }}
                    >
                      Evidence ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className={styles.empty}>
            {loading
              ? "Loading the reimbursement ledger…"
              : data
                ? "No claims match this view."
                : "The ledger will appear when the reviews API is available."}
          </div>
        )}
        <p className={styles.footnote}>
          {fixture
            ? "Preview mutations are disabled. Connect to the API to reconcile or save corrections."
            : "Reconciliation evaluates selected claims only. Evidence and status refresh automatically."}
        </p>
      </section>
      {current && (
        <section
          className={styles.evidence}
          aria-label={`Evidence for ${current.attendee_name}`}
        >
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>02 / EVIDENCE FILE</p>
              <h2>{current.attendee_name}</h2>
              <p>
                {current.category} · {money(current.amount_requested_minor)}{" "}
                requested
              </p>
            </div>
            <button
              onClick={() => {
                setActive(null);
                setReviewing(false);
              }}
            >
              Close evidence
            </button>
          </div>
          <div className={styles.evidenceActions}>
            {current.receipt && !fixture && (
              <a
                href={`/api/receipts/${encodeURIComponent(current.receipt.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open original receipt ↗
              </a>
            )}
            <button
              className={styles.primary}
              disabled={fixture || busy || !!error}
              onClick={() => setReviewing((value) => !value)}
            >
              {reviewing ? "Cancel correction" : "Correct & teach"}
            </button>
          </div>
          <p className={styles.footnote}>
            Latest completed run and applicable human override. Probability
            measures the proposition being true; confidence measures certainty.
            They are not interchangeable.
          </p>
          {!current.decisions.length && (
            <p className={styles.empty}>
              No completed decisions yet. Select this claim and reconcile it to
              create an evidence trail.
            </p>
          )}
          <JustificationPanel decisions={current.decisions} />
          <div className={styles.decisions}>
            {current.decisions.map((decision) => (
              <article key={decision.id}>
                <div className={styles.decisionHeader}>
                  <h3>{statusLabel(decision.field_checked)}</h3>
                  <span>
                    {decision.check_method === "jev"
                      ? "Jev"
                      : decision.check_method}{" "}
                    / {decision.verdict}
                  </span>
                </div>
                <p>{decision.rationale_text}</p>
                <dl>
                  <div>
                    <dt>Recorded answer</dt>
                    <dd>{JSON.stringify(decision.answer_json.value)}</dd>
                  </div>
                  <div>
                    <dt>Probability of true</dt>
                    <dd>{percent(decision.probability)}</dd>
                  </div>
                  <div>
                    <dt>Confidence score</dt>
                    <dd>{percent(decision.confidence_score)}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Inspect evidence record</summary>
                  <pre>{JSON.stringify(decision.evidence_json, null, 2)}</pre>
                </details>
              </article>
            ))}
          </div>
          {reviewing && (
            <CorrectionForm
              key={current.id}
              row={current}
              busy={busy}
              onSubmit={correct}
            />
          )}
        </section>
      )}
      <section className={styles.bottomGrid}>
        <div>
          <p className={styles.eyebrow}>03 / REVIEW SIGNALS</p>
          <h2>What needs a second look</h2>
          {data?.summary.top_flag_reasons.length ? (
            <ul className={styles.reasons}>
              {data.summary.top_flag_reasons.map(({ reason, count }) => (
                <li key={reason}>
                  <span>{reason}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.footnote}>No review reasons available.</p>
          )}
        </div>
        <aside className={styles.learning}>
          <p className={styles.eyebrow}>HUMAN JUDGMENT, REMEMBERED</p>
          <h2>
            One correction.
            <br />A better next review.
          </h2>
          <p>
            A decision override resolves one claim. A vendor alias teaches a
            merchant relationship, scoped to this category and USD.
          </p>
          <p>
            Save an alias on the ambiguous claim, then reconcile the related
            claim. A claim in a different category stays outside the alias’s scope.
          </p>
          <span>REVIEW → CORRECT → RECONCILE</span>
        </aside>
      </section>
      <footer className={styles.footer}>
        <span>FIELDNOTES / HACKATHON TRAVEL</span>
        <span>Synthetic attendees. USD only. No payments.</span>
      </footer>
    </main>
  );
}

function CorrectionForm({
  row,
  busy,
  onSubmit,
}: {
  row: ReviewRow;
  busy: boolean;
  onSubmit: (input: CorrectionInput) => Promise<void>;
}) {
  const [type, setType] = useState<"decision_override" | "vendor_alias">(
    "decision_override",
  );
  const [verdict, setVerdict] = useState<"approved" | "rejected">("approved");
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [observed, setObserved] = useState(
    row.receipt?.parsed_fields_json?.vendor ?? "",
  );
  const [canonical, setCanonical] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className={styles.correction}
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (
          !note.trim() ||
          (type === "vendor_alias" && (!observed.trim() || !canonical.trim()))
        ) {
          setError("Add a review note and both merchant names for an alias.");
          return;
        }
        try {
          await onSubmit({
            submission_id: row.id,
            ...(decision ? { decision_id: decision } : {}),
            human_verdict: verdict,
            human_note: note.trim(),
            correction_type: type,
            correction_payload_json:
              type === "vendor_alias"
                ? {
                    observed_vendor: observed.trim(),
                    canonical_vendor: canonical.trim(),
                    scope: { category: row.category, currency: "USD" },
                  }
                : {},
          });
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Correction could not be saved.",
          );
        }
      }}
    >
      <h3>Correct this claim. Teach only what you intend.</h3>
      <div className={styles.formGrid}>
        <label>
          Correction type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            disabled={busy}
          >
            <option value="decision_override">
              One-time decision override
            </option>
            <option value="vendor_alias">Reusable vendor alias</option>
          </select>
        </label>
        <label>
          Human verdict
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as typeof verdict)}
            disabled={busy}
          >
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Decision being corrected
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            disabled={busy}
          >
            <option value="">Overall claim (no specific decision)</option>
            {row.decisions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.field_checked} · {item.check_method}
              </option>
            ))}
          </select>
        </label>
      </div>
      {type === "vendor_alias" && (
        <>
          <div className={styles.formGrid}>
            <label>
              Observed merchant
              <input
                required
                maxLength={200}
                value={observed}
                onChange={(e) => setObserved(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Canonical merchant
              <input
                required
                maxLength={200}
                value={canonical}
                onChange={(e) => setCanonical(e.target.value)}
                placeholder="Recognized merchant name"
                disabled={busy}
              />
            </label>
          </div>
          <p>
            Reusable scope: <strong>{row.category} / USD</strong>. Other
            categories remain outside this correction.
          </p>
        </>
      )}
      <label>
        Review note
        <textarea
          required
          maxLength={2000}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What evidence supports your correction?"
          disabled={busy}
        />
      </label>
      <p className={styles.footnote}>
        {type === "decision_override"
          ? "This saves a human result for this claim only. It does not create a reusable rule."
          : "This saves the human result and an alias for later reconciliations. Existing related claims must be reconciled again."}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button className={styles.primary} disabled={busy} type="submit">
        {busy ? "Saving…" : "Save correction"}
      </button>
    </form>
  );
}
