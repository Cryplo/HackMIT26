import { money } from "./helpers";
import { approvalBlock, machineChecks, passes } from "./review";
import type { ReviewRow } from "./types";

/** Suggestions describe saved facts; only the reviewer's click records a decision. */
export function decisionReason(row: ReviewRow, verdict: "approved" | "rejected", revision: number, rows: ReviewRow[], knowledgeEnabled: boolean): string | null {
  if (row.decision_status !== "pending" || row.processing_status !== "idle" || row.latest_investigation?.status === "running"
    || row.receipt?.extraction_status !== "succeeded" || !row.latest_run_id || !row.assessment_status
    || !Number.isSafeInteger(row.review_revision) || row.review_revision < 0
    || (knowledgeEnabled && row.assessment_knowledge_revision !== revision)) return null;
  const checks = machineChecks(row);
  if (verdict === "approved") return row.assessment_status === "matched" && checks.every(check => check.verdict === "pass")
    && passes(row, "merchant") && passes(row, "name") && !approvalBlock(row, revision, rows, knowledgeEnabled)
    ? "Approved based on the displayed checks." : null;

  if (row.assessment_status !== "flagged") return null;
  const parsed = row.receipt.parsed_fields_json;
  if (!parsed) return null;
  for (const check of checks.filter(check => check.verdict === "fail")) {
    if (["duplicate", "exact_duplicate"].includes(check.field_checked) && row.duplicate_submission_ids.length)
      return "Rejected: the saved receipt matches an earlier claim.";
    if (check.check_method !== "deterministic") continue;
    const evidence = check.evidence_json;
    if (check.field_checked === "amount" && Number.isSafeInteger(row.amount_requested_minor) && Number.isSafeInteger(parsed.amount_minor)
      && parsed.currency === row.currency && parsed.amount_minor !== row.amount_requested_minor
      && (evidence.requested_minor === undefined || evidence.requested_minor === row.amount_requested_minor)
      && (evidence.receipt_minor === undefined || evidence.receipt_minor === parsed.amount_minor))
      return `Rejected: the claim requests ${money(row.amount_requested_minor, row.currency)}, but the receipt shows ${money(parsed.amount_minor, parsed.currency)}.`;
    if (check.field_checked === "policy_cap" && evidence.requested_minor === row.amount_requested_minor
      && typeof evidence.maximum_minor === "number" && Number.isSafeInteger(evidence.maximum_minor) && evidence.maximum_minor >= 0
      && Number.isSafeInteger(row.amount_requested_minor) && row.amount_requested_minor > evidence.maximum_minor)
      return `Rejected: the ${money(row.amount_requested_minor, row.currency)} claim exceeds the ${money(evidence.maximum_minor, row.currency)} policy limit.`;
    if (check.field_checked === "currency" && parsed.currency && parsed.currency !== row.currency && check.answer_json.value === parsed.currency)
      return `Rejected: receipt currency (${parsed.currency}) differs from claim currency (${row.currency}).`;
    if (check.field_checked === "receipt_date" && parsed.receipt_date && check.answer_json.value === parsed.receipt_date
      && Array.isArray(evidence.policies) && evidence.policies.length && evidence.policies.every(policy => policy
        && typeof policy.date_range_start === "string" && typeof policy.date_range_end === "string"
        && (parsed.receipt_date! < policy.date_range_start || parsed.receipt_date! > policy.date_range_end)))
      return `Rejected: the receipt date (${parsed.receipt_date}) falls outside the allowed policy dates.`;
  }
  return null;
}
