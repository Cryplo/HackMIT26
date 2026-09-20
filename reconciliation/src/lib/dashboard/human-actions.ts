import { approvalBlock, investigationFailure, machineChecks } from "./review";
import { money } from "./helpers";
import { decisionReason } from "./decision-reason";
import type { ReviewRow, ReviewsResponse, WorkspaceCapabilities } from "./types";

export type CheckState = "unchecked" | "passed" | "needs_review" | "flagged" | "failed" | "running";
export type ReviewGroup = "inconclusive" | "confirmed_fail" | "passed" | "check_failed";
/** Exclusive dashboard buckets: a failed check is not a saved rejection. */
export function auditBucket(row: ReviewRow): "unchecked" | "approved" | "review" | "rejected" {
  if (row.decision_status !== "pending") return row.decision_status;
  const state = checkState(row);
  return state === "unchecked" || state === "running" ? "unchecked" : "review";
}
/** Split only Unchecked into work stages; saved decisions always take precedence. */
export function auditFlowStage(row: ReviewRow, checking = false): "waiting" | "checking" | "investigations" | "passed" | "uncertain" | "failed" {
  const bucket = auditBucket(row);
  if (bucket === "approved") return "passed";
  if (bucket === "rejected") return "failed";
  if (bucket === "review") return "uncertain";
  if (row.latest_investigation?.status === "running") return "investigations";
  return checking || checkState(row) === "running" ? "checking" : "waiting";
}
export function checkState(row: ReviewRow): CheckState {
  if (row.processing_status === "running" || row.latest_investigation?.status === "running") return "running";
  if (row.processing_status === "failed" || row.receipt?.extraction_status === "failed") return "failed";
  if (!row.assessment_status || !row.latest_run_id) return "unchecked";
  return row.assessment_status === "matched" ? "passed" : row.assessment_status;
}

export function investigationBlock(row: ReviewRow, capabilities?: WorkspaceCapabilities, requireUncertainty = true): string | null {
  if (!capabilities?.investigations) return "Investigations are unavailable in this workspace.";
  if (row.decision_status !== "pending") return "Investigations require a pending claim.";
  if (row.processing_status !== "idle" || row.latest_investigation?.status === "running") return "Finish or retry the current check before investigating.";
  if (row.receipt?.extraction_status !== "succeeded") return "Reparse the original receipt before investigating.";
  if (!row.assessment_status || !row.latest_run_id) return "Check this claim before investigating.";
  if (!Number.isSafeInteger(row.review_revision) || row.review_revision < 0) return "Refresh this claim before investigating.";
  const knownFailure = investigationFailure(row);
  if (knownFailure) return knownFailure;
  if (row.duplicate_submission_ids.length || machineChecks(row).some(check => check.verdict === "fail" && ["exact_duplicate", "extraction"].includes(check.field_checked))) return "Resolve the duplicate or receipt issue before investigating.";
  if (requireUncertainty && !machineChecks(row).some(check => ["merchant", "name"].includes(check.field_checked) && check.verdict === "unknown")) return "The saved checks have no unresolved merchant or traveler question to investigate.";
  return null;
}

export function claimReason(row: ReviewRow): string {
  if (row.processing_status === "failed") return row.processing_error || "The check could not finish. Retry the saved receipt checks.";
  if (row.receipt?.extraction_status === "failed") return row.receipt.extraction_error || "The receipt could not be read. Reparse the original receipt.";
  const checks = machineChecks(row);
  const concern = checks.find(check => check.verdict === "fail") ?? checks.find(check => check.verdict === "unknown");
  const parsed = row.receipt?.parsed_fields_json;
  if (concern?.verdict === "fail" && concern.field_checked === "amount" && parsed?.amount_minor != null)
    return `The claim requests ${money(row.amount_requested_minor, row.currency)}, but the receipt shows ${money(parsed.amount_minor, parsed.currency)}.`;
  if (concern?.verdict === "fail" && concern.field_checked === "policy_cap" && typeof concern.evidence_json.maximum_minor === "number")
    return `The ${money(row.amount_requested_minor, row.currency)} claim exceeds the ${money(concern.evidence_json.maximum_minor, row.currency)} policy limit.`;
  if (concern?.verdict === "fail" && concern.field_checked === "duplicate")
    return row.duplicate_submission_ids.length
      ? "The saved evidence identifies this purchase in an earlier claim. Compare both claims before making a decision."
      : "Possible duplicate flagged. Compare the original receipts before deciding.";
  if (concern?.verdict === "unknown" && concern.field_checked === "merchant") return parsed?.vendor?.trim()
    ? `The receipt lists “${parsed.vendor.trim()}”; confirm which merchant issued it.`
    : "The merchant is unconfirmed. Review the original receipt and supporting evidence.";
  if (concern?.verdict === "unknown" && concern.field_checked === "name") {
    if (parsed?.names.length) return `The receipt names ${parsed.names.join(", ")}; confirm it belongs to ${row.attendee_name}.`;
    const policies = checks.find(check => check.field_checked === "policy")?.evidence_json.policies;
    if (Array.isArray(policies) && policies.some(policy => policy?.claimant_identity_evidence === "receipt_only"))
      return `The receipt does not name ${row.attendee_name}. This policy requires their name on the receipt; a booking confirmation alone is not enough.`;
    return `No traveler name was extracted. Add evidence linking this receipt to ${row.attendee_name}.`;
  }
  if (concern) return concern.rationale_text || `${concern.field_checked.replaceAll("_", " ")} needs your review.`;
  const run = row.latest_investigation;
  if (run?.status === "completed" && run.after_assessment?.review_revision === row.review_revision && run.summary.trim()) return run.summary;
  if (row.investigation?.status === "completed" && row.investigation.summary.trim()) return row.investigation.summary;
  if (checkState(row) === "passed") return "Checks passed. Your approval authorizes reimbursement.";
  if (checkState(row) === "running") return "Work is in progress. The saved result will appear when it finishes.";
  return "Check the saved receipt before reviewing this claim for approval.";
}

export function humanActions(data: ReviewsResponse) {
  return data.submissions.flatMap(row => {
    const state = checkState(row);
    if (row.decision_status !== "pending" || state === "unchecked" || state === "running") return [];
    const blocked = approvalBlock(row, data.knowledge_revision, data.submissions, data.capabilities?.knowledge_revisions === true);
    const ready = decisionReason(row, "approved", data.knowledge_revision, data.submissions, data.capabilities?.knowledge_revisions === true) !== null;
    const rejectionReason = decisionReason(row, "rejected", data.knowledge_revision, data.submissions, data.capabilities?.knowledge_revisions === true);
    const group: ReviewGroup = state === "failed" ? "check_failed" : rejectionReason ? "confirmed_fail" : ready ? "passed" : "inconclusive";
    const priority = { inconclusive: 0, confirmed_fail: 1, passed: 2, check_failed: 3 }[group];
    return [{ row, state, ready, group, rejectionReason, priority, reason: state === "passed" && blocked ? blocked : claimReason(row) }];
  }).sort((a, b) => a.priority - b.priority || a.row.submitted_at.localeCompare(b.row.submitted_at) || a.row.id.localeCompare(b.row.id));
}

export function nextHumanAction(data: ReviewsResponse, savedId: string, visibleOrder: string[], matches: (row: ReviewRow) => boolean = () => true): ReviewRow | null {
  const pending = new Map(humanActions(data).map(action => [action.row.id, action.row]));
  const current = visibleOrder.indexOf(savedId);
  for (const id of [...visibleOrder.slice(current + 1), ...visibleOrder.slice(0, current + 1)]) {
    const row = pending.get(id);
    if (id !== savedId && row && matches(row)) return row;
  }
  return null;
}
