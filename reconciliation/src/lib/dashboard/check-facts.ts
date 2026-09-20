import { formatDate, money, statusLabel } from "./helpers";
import { amountDelta, machineChecks } from "./review";
import type { ReviewRow, Verdict } from "./types";

export interface CheckFact {
  field: string;
  label: string;
  verdict: Verdict;
  observed: string;
  reason: string;
}

/** Present recorded verdicts; matching visible values alone never establish a pass. */
export function checkFacts(row: ReviewRow, revision: number, knowledgeEnabled: boolean, running = false): CheckFact[] {
  const checks = machineChecks(row);
  const parsed = row.receipt?.parsed_fields_json;
  const pending = running || row.processing_status === "running" || row.latest_investigation?.status === "running";
  const outdated = knowledgeEnabled && row.assessment_knowledge_revision !== revision;
  const unavailable = row.processing_status === "failed" || row.receipt?.extraction_status !== "succeeded" || !row.assessment_status || !row.latest_run_id;
  const policies = checks.find(check => check.field_checked === "receipt_date")?.evidence_json.policies;
  const dates = Array.isArray(policies) ? policies.flatMap(policy => policy && typeof policy.date_range_start === "string" && typeof policy.date_range_end === "string"
    ? [`${formatDate(policy.date_range_start)} – ${formatDate(policy.date_range_end)}`] : []) : [];
  const maximum = checks.find(check => check.field_checked === "policy_cap")?.evidence_json.maximum_minor;
  const delta = amountDelta(row);
  const amountFailure = delta.minor === null ? "The recorded amount check failed; compare the original receipt."
    : delta.minor > 0 ? `Claim exceeds receipt by ${money(delta.minor, row.currency)}.`
    : delta.minor < 0 ? `Claim is ${money(-delta.minor, row.currency)} below receipt.`
    : "The recorded amount check failed; recheck the matching totals.";
  const definitions = [
    { field: "amount", label: "Amount", observed: `Claim ${money(row.amount_requested_minor, row.currency)} · Receipt ${money(parsed?.amount_minor, parsed?.currency)}`, pass: "Claim and receipt totals match.", fail: amountFailure, unknown: "The receipt total has not been confirmed." },
    { field: "currency", label: "Currency", observed: `Claim ${row.currency} · Receipt ${parsed?.currency || "not recorded"}`, pass: "Receipt currency passed the currency check.", fail: "Receipt currency is not accepted for this claim.", unknown: "The receipt currency has not been confirmed." },
    { field: "merchant", label: "Merchant", observed: parsed?.vendor?.trim() || "No merchant recorded", pass: "Merchant confirmed for this expense category.", fail: "Merchant did not pass the category check.", unknown: "The merchant identity is not confirmed." },
    { field: "name", label: "Traveler", observed: `Claim ${row.attendee_name} · Receipt ${parsed?.names.length ? parsed.names.join(", ") : "no name recorded"}`, pass: "Saved evidence links this receipt to the traveler.", fail: "Receipt could not be matched to the claimed traveler.", unknown: "The receipt has not been linked to this traveler." },
    { field: "receipt_date", label: "Receipt date", observed: `Receipt ${formatDate(parsed?.receipt_date)} · Allowed ${dates.length ? [...new Set(dates)].join("; ") : "dates not recorded"}`, pass: "Receipt date is within the allowed dates.", fail: "Receipt date is outside the allowed dates.", unknown: "The receipt date or allowed dates need confirmation." },
    { field: "policy_cap", label: "Policy limit", observed: `Claim ${money(row.amount_requested_minor, row.currency)} · Limit ${typeof maximum === "number" && Number.isSafeInteger(maximum) ? money(maximum, row.currency) : "not recorded"}`, pass: "Claim is within the policy limit.", fail: "Claim exceeds the policy limit.", unknown: "The applicable policy limit has not been confirmed." },
    { field: "policy", label: "Policy coverage", observed: `${statusLabel(row.category)} · ${row.currency}`, pass: "One policy covers this category, currency, and date.", fail: "The claim did not pass the policy coverage check.", unknown: "A single applicable policy has not been confirmed." },
    { field: "duplicate", label: "Duplicate receipt", observed: row.duplicate_submission_ids.length ? `${row.duplicate_submission_ids.length} linked ${row.duplicate_submission_ids.length === 1 ? "claim" : "claims"}` : "No linked claims", pass: row.duplicate_submission_ids.length ? "The saved check passed; linked claims still need review." : "No duplicate purchase found in the saved checks.", fail: row.duplicate_submission_ids.length ? "Saved evidence identifies a duplicate receipt or purchase." : "Possible duplicate flagged; compare original receipts.", unknown: "The duplicate check is inconclusive." },
  ];
  return definitions.map(definition => {
    const related = checks.filter(check => check.field_checked === definition.field || (definition.field === "duplicate" && check.field_checked === "exact_duplicate"));
    const saved: Verdict = related.some(check => check.verdict === "fail") ? "fail"
      : !related.some(check => check.field_checked === definition.field) || related.some(check => check.verdict === "unknown") ? "unknown" : "pass";
    const verdict = pending || outdated || unavailable ? "unknown" : saved;
    const result = saved === "pass" ? "pass" : saved === "fail" ? "fail" : "inconclusive";
    const reason = pending ? `Check in progress${related.length ? `; previous result: ${result}` : "; no saved result"}.`
      : outdated ? `Recheck needed${related.length ? `; previous result: ${result}` : "; no saved result"}.`
      : unavailable ? "No current verified result. Recheck the receipt."
      : !related.length ? "This required check has no saved result."
      : definition[saved];
    return { field: definition.field, label: definition.label, observed: definition.observed, verdict, reason };
  });
}
