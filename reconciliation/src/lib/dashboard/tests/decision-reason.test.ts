import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionReason } from "../decision-reason";
import { fixtureCheck, fixtureReviews } from "../fixtures";

test("one-click reasons require current saved proof and never cover uncertainty or reversals", () => {
  const clean = structuredClone(fixtureReviews.submissions[0]);
  const reason = (row = clean, verdict: "approved" | "rejected" = "approved") => decisionReason(row, verdict, 0, [], true);
  assert.equal(reason(), "Approved based on the displayed checks.");
  assert.equal(reason(clean, "rejected"), null);
  assert.equal(reason(fixtureReviews.submissions[2]), null, "merchant override requires a note");
  const mismatch = structuredClone(fixtureReviews.submissions[1]);
  assert.equal(reason(mismatch, "rejected"), "Rejected: the claim requests $112.00, but the receipt shows $100.00.");
  assert.equal(reason(mismatch), null);
  assert.equal(reason({ ...mismatch, assessment_status: "needs_review" }, "rejected"), null);
  assert.equal(reason({ ...mismatch, assessment_status: "matched" }, "rejected"), null);
  for (const row of [clean, mismatch]) for (const change of [
    { decision_status: "approved" as const }, { decision_status: "rejected" as const },
    { processing_status: "running" as const }, { assessment_knowledge_revision: 1 },
    { assessment_knowledge_revision: null }, { latest_run_id: null }, { review_revision: -1 },
  ]) assert.equal(reason({ ...row, ...change }, row === clean ? "approved" : "rejected"), null);
  mismatch.decisions[0].check_method = "jev";
  assert.equal(reason(mismatch, "rejected"), null, "provider failure alone is not a rejection reason");
  mismatch.decisions[0].check_method = "deterministic";
  mismatch.decisions[0].evidence_json = { requested_minor: 999 };
  assert.equal(reason(mismatch, "rejected"), null, "contradicting amount evidence is not a default");
  const cap = { ...clean, assessment_status: "flagged" as const, decisions: [{ ...fixtureCheck(90, "policy_cap", "fail", "cap"), evidence_json: { requested_minor: clean.amount_requested_minor, maximum_minor: 8000 } }] };
  assert.equal(reason(cap, "rejected"), "Rejected: the $84.20 claim exceeds the $80.00 policy limit.");
  const duplicate = { ...clean, assessment_status: "flagged" as const, decisions: [fixtureCheck(91, "duplicate", "fail", "possible duplicate")], duplicate_submission_ids: [mismatch.id] };
  assert.equal(reason(duplicate, "rejected"), "Rejected: the saved receipt matches an earlier claim.");
  assert.equal(reason({ ...duplicate, duplicate_submission_ids: [] }, "rejected"), null);
  const currency = structuredClone(clean);
  currency.assessment_status = "flagged";
  currency.receipt!.parsed_fields_json!.currency = "EUR";
  currency.decisions = [fixtureCheck(92, "currency", "fail", "currency", "EUR")];
  assert.match(reason(currency, "rejected")!, /receipt currency \(EUR\)/);
  const date = structuredClone(clean);
  date.assessment_status = "flagged";
  date.decisions = [{ ...fixtureCheck(93, "receipt_date", "fail", "date", "2026-09-18"), evidence_json: { policies: [{ date_range_start: "2026-09-19", date_range_end: "2026-09-20" }] } }];
  assert.match(reason(date, "rejected")!, /outside the allowed policy dates/);
  date.decisions[0].evidence_json = { policies: [] };
  assert.equal(reason(date, "rejected"), null);
});
