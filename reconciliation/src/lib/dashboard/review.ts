import type { MerchantRule, ReviewRow, ReviewsResponse, WorkspaceCapabilities } from "./types";
import { money } from "./helpers";

export const normalizeVendor = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const approvalFields = ["currency", "amount", "policy", "receipt_date", "policy_cap", "duplicate"];
const labels: Record<string, string> = { currency: "Currency", amount: "Amount", policy: "Policy coverage", receipt_date: "Receipt date", policy_cap: "Policy limit", duplicate: "Duplicate receipt" };
export const machineChecks = (row: ReviewRow) => row.decisions.filter(c => c.check_method !== "human" && c.field_checked !== "overall_status");
export function passes(row: ReviewRow, field: string) {
  const checks = machineChecks(row).filter(c => c.field_checked === field);
  return checks.length > 0 && checks.every(c => c.verdict === "pass");
}
export function rulesChanged(row: ReviewRow, revision: number, enabled: boolean) {
  return enabled && !!row.assessment_status && !!row.latest_run_id && Number.isSafeInteger(row.assessment_knowledge_revision)
    && row.assessment_knowledge_revision! < revision;
}
export function amountDelta(row: ReviewRow): { minor: number | null; label: string } {
  const receipt = row.receipt;
  const parsed = receipt?.parsed_fields_json;
  if (receipt?.extraction_status !== "succeeded" || !parsed?.currency || !row.currency) return { minor: null, label: "Unavailable" };
  if (parsed.currency !== row.currency) return { minor: null, label: "Currencies differ" };
  if (!Number.isSafeInteger(row.amount_requested_minor) || !Number.isSafeInteger(parsed.amount_minor)) return { minor: null, label: "Unavailable" };
  const minor = row.amount_requested_minor - parsed.amount_minor!;
  if (!Number.isSafeInteger(minor)) return { minor: null, label: "Unavailable" };
  return { minor, label: minor === 0 ? "Matches" : `${minor > 0 ? "+" : "−"}${money(Math.abs(minor), row.currency)}` };
}
export function financialIssue(row: ReviewRow) {
  const nextSteps: Record<string, string> = {
    currency: "Verify the currency against the original receipt and resolve the discrepancy, then recheck before approval.",
    policy: "Verify policy coverage for this category, currency, and receipt date, then recheck before approval.",
    receipt_date: "Verify the receipt date against the original and the configured policy dates, then recheck before approval.",
    policy_cap: "Resolve the claimed amount against the policy cap, then recheck before approval.",
  };
  const check = row.decisions.find(c => c.check_method === "deterministic" && c.verdict !== "pass" && Object.hasOwn(nextSteps, c.field_checked));
  if (!check) return null;
  const evidence = check.evidence_json;
  const facts: string[] = [];
  if (check.field_checked === "policy_cap") {
    for (const [key, label] of [["requested_minor", "Requested"], ["maximum_minor", "Policy cap"]]) {
      const value = evidence[key];
      if (typeof value === "number" && Number.isSafeInteger(value)) facts.push(`${label}: ${money(value, row.currency)}`);
    }
  }
  if (["currency", "receipt_date"].includes(check.field_checked) && typeof check.answer_json.value === "string") facts.push(`Receipt ${check.field_checked === "currency" ? "currency" : "date"}: ${check.answer_json.value}`);
  if (Array.isArray(evidence.policies)) {
    if (check.field_checked === "policy") facts.push(`Applicable policies recorded: ${evidence.policies.length}`);
    if (check.field_checked === "receipt_date") for (const policy of evidence.policies) {
      if (policy && typeof policy.date_range_start === "string" && typeof policy.date_range_end === "string") facts.push(`Policy dates: ${policy.date_range_start} through ${policy.date_range_end}`);
    }
  }
  return { title: `${labels[check.field_checked]} ${check.verdict === "fail" ? "failed" : "needs review"}`, rationale: check.rationale_text, facts, nextStep: nextSteps[check.field_checked] };
}
export function approvalBlock(row: ReviewRow, revision: number, rows: ReviewRow[], knowledgeEnabled: boolean) {
  if (row.processing_status !== "idle") return "Finish or retry the current check before approving.";
  if (row.receipt?.extraction_status !== "succeeded") return "Extract the original receipt and recheck before approving.";
  if (!row.assessment_status || !row.latest_run_id) return "Recheck this claim before approving.";
  if (knowledgeEnabled && (!Number.isSafeInteger(row.assessment_knowledge_revision) || row.assessment_knowledge_revision !== revision)) return "Rules changed or assessment rule version is unknown — recheck before approving.";
  if (!Number.isSafeInteger(row.review_revision) || row.review_revision < 0) return "Refresh the current review revision before approving.";
  const incomplete = approvalFields.find(field => !passes(row, field));
  if (incomplete) return `${labels[incomplete]} must pass before approval.`;
  if (machineChecks(row).some(c => (c.field_checked.includes("duplicate") || c.field_checked === "extraction") && c.verdict !== "pass") || row.duplicate_submission_ids.length) return "Resolve the duplicate or extraction evidence before approving.";
  if (row.receipt.sha256 && rows.some(other => other.id !== row.id && other.decision_status === "approved" && other.receipt?.sha256 === row.receipt?.sha256)) return "Another approved claim uses the same receipt.";
  return null;
}
export function nextAction(row: ReviewRow, revision: number, capabilities?: WorkspaceCapabilities) {
  if (row.processing_status === "running") return "Checking…";
  if (row.receipt?.extraction_status !== "succeeded") return "Review receipt issue";
  if (!row.assessment_status || !row.latest_run_id || rulesChanged(row, revision, capabilities?.knowledge_revisions === true)) return "Recheck needed";
  if (capabilities?.duplicate_links && row.duplicate_submission_ids.length) return "Compare claims";
  if (row.decision_status !== "pending") return "View decision";
  return row.assessment_status === "matched" ? "Review for approval" : "Review issue";
}
export function claimedTotals(rows: ReviewRow[]) {
  const totals = new Map<string, number>();
  for (const row of new Map(rows.map(row => [row.id, row])).values()) {
    const total = (totals.get(row.currency) ?? 0) + row.amount_requested_minor;
    if (!Number.isSafeInteger(row.amount_requested_minor) || !Number.isSafeInteger(total)) return null;
    totals.set(row.currency, total);
  }
  return Object.fromEntries(totals);
}
export const totalsLabel = (totals: Record<string, number> | null) => totals ? Object.entries(totals).map(([currency, cents]) => money(cents, currency)).join(" + ") || "$0.00" : "Amount unavailable";
export interface ReviewInsight { key: string; label: string; ids: string[]; count: number; claimed_minor: Record<string, number> }
export function reviewInsights(data: ReviewsResponse): { available: boolean; items: ReviewInsight[] } {
  const rows = data.submissions;
  const coverage = data.coverage;
  if (!coverage?.complete || coverage.returned !== rows.length || coverage.total !== coverage.returned || new Set(rows.map(r => r.id)).size !== rows.length) return { available: false, items: [] };
  const items: ReviewInsight[] = [];
  let available = true;
  function add(key: string, label: string, members: ReviewRow[]) {
    if (!members.length) return;
    const totals = claimedTotals(members);
    if (!totals) { available = false; return; }
    const ids = [...new Set(members.map(r => r.id))];
    items.push({ key, label, ids, count: ids.length, claimed_minor: totals });
  }
  if (data.capabilities?.knowledge_revisions === true) {
    const groups = new Map<string, ReviewRow[]>();
    for (const row of rows) {
      const parsed = row.receipt?.parsed_fields_json;
      if (row.decision_status !== "pending" || row.processing_status !== "idle" || row.assessment_status !== "needs_review" || !row.latest_run_id || row.receipt?.extraction_status !== "succeeded" || !Number.isSafeInteger(row.assessment_knowledge_revision) || row.assessment_knowledge_revision !== data.knowledge_revision || !parsed?.vendor?.trim() || parsed.currency !== row.currency || row.currency !== "USD") continue;
      const checks = machineChecks(row);
      if (!checks.some(c => c.field_checked === "merchant" && c.verdict === "unknown") || checks.some(c => c.field_checked === "merchant" && c.verdict !== "unknown") || [...approvalFields, "name"].some(field => !passes(row, field)) || checks.some(c => ["extraction", "exact_duplicate"].includes(c.field_checked) && c.verdict !== "pass") || row.duplicate_submission_ids.length) continue;
      const key = JSON.stringify([normalizeVendor(parsed.vendor), row.category, row.currency]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [key, members] of groups) if (members.length >= 2) add(`merchant:${key}`, `${members.length} otherwise checked claims share this unresolved merchant (${members[0].receipt!.parsed_fields_json!.vendor!.trim()} · ${members[0].category})`, members);
    add("rules", "Pending claims use older rules", rows.filter(r => r.decision_status === "pending" && rulesChanged(r, data.knowledge_revision, true)));
  }
  if (data.capabilities?.duplicate_links === true) add("duplicates", "Pending later claims reuse earlier receipt evidence", rows.filter(r => r.decision_status === "pending" && r.duplicate_submission_ids.length > 0));
  return { available, items: available ? items : [] };
}
export function activationBlock(rule: MerchantRule, rows: ReviewRow[], revision: number, mode: "api" | "preview", simulatedEnvironment: boolean) {
  const source = rows.find(row => row.id === rule.source_submission_id);
  if (source?.decision_status !== "approved") return "Source claim must remain approved.";
  if (source.decisions.findLast(c => c.check_method === "human")?.evidence_json.correction_id !== rule.source_correction_id) return "Source approval changed. Propose a new draft.";
  if (source.receipt?.extraction_status !== "succeeded" || normalizeVendor(source.receipt.parsed_fields_json?.vendor || "") !== normalizeVendor(rule.payload.observed_vendor) || source.category !== rule.payload.scope.category || source.currency !== rule.payload.scope.currency) return "Source receipt or rule scope changed. Propose a new draft.";
  if (rule.latest_test_error) return rule.latest_test_error;
  const report = rule.latest_test;
  if (!report) return "Test this draft before activation.";
  if (report.rule_id !== rule.id || report.rule_version !== rule.version || report.knowledge_revision !== revision || report.suite_version !== "alias-v1") return "The rule or active knowledge changed. Test this draft again.";
  if (!report.passed || report.before.total !== 10 || report.after.total !== 10 || report.regressed_case_ids.length || report.after.false_matches !== 0 || !report.improved_case_ids.length || report.after.correct < report.before.correct) return "This test did not pass the complete safety gate. Activation is blocked.";
  if (report.mode === "simulated" && mode === "api" && !simulatedEnvironment) return "A live workspace requires a live test report.";
  if (mode === "preview" && report.mode !== "simulated") return "The test mode does not match this preview.";
  return null;
}
