import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFacts } from "../check-facts";
import { fixtureCheck, fixtureReviews } from "../fixtures";

test("visible receipt facts follow saved checks and freshness, never apparent equality", () => {
  const clean = structuredClone(fixtureReviews.submissions[0]);
  const facts = (row = clean, revision = 0, running = false) => checkFacts(row, revision, true, running);
  assert.equal(facts().length, 8);
  assert.ok(facts().every(fact => fact.verdict === "pass"));
  const mismatch = facts(fixtureReviews.submissions[1]).find(fact => fact.field === "amount")!;
  assert.equal(mismatch.verdict, "fail");
  assert.equal(mismatch.reason, "Claim exceeds receipt by $12.00.");
  const previousFailure = facts(fixtureReviews.submissions[1], 1).find(fact => fact.field === "amount")!;
  assert.equal(previousFailure.verdict, "unknown");
  assert.match(previousFailure.reason, /previous result: fail/);
  const merchant = facts(fixtureReviews.submissions[2]).find(fact => fact.field === "merchant")!;
  assert.equal(merchant.verdict, "unknown");
  assert.equal(merchant.observed, "Harbor Reservations");
  assert.equal(merchant.reason, "The merchant identity is not confirmed.");
  const missing = { ...clean, decisions: clean.decisions.filter(check => check.field_checked !== "amount") };
  assert.equal(facts(missing).find(fact => fact.field === "amount")!.verdict, "unknown");
  const matchingButUnknown = { ...missing, decisions: [...missing.decisions, fixtureCheck(99, "amount", "unknown", "unverified")] };
  assert.equal(facts(matchingButUnknown).find(fact => fact.field === "amount")!.verdict, "unknown");
  for (const stale of [facts(clean, 1), facts(clean, 0, true), facts({ ...clean, assessment_knowledge_revision: null })]) {
    assert.ok(stale.every(fact => fact.verdict === "unknown"));
    assert.ok(stale.every(fact => /previous result: pass/.test(fact.reason)));
  }
  assert.ok(facts({ ...clean, latest_run_id: null }).every(fact => fact.verdict === "unknown"));
  assert.ok(facts(fixtureReviews.submissions[5]).every(fact => fact.verdict === "unknown"));
  const duplicate = { ...clean, decisions: [...clean.decisions, fixtureCheck(98, "exact_duplicate", "fail", "same file")] };
  assert.equal(facts(duplicate).find(fact => fact.field === "duplicate")!.verdict, "fail");
  assert.equal(facts(duplicate).find(fact => fact.field === "duplicate")!.reason, "Possible duplicate flagged; compare original receipts.");
  clean.decisions.find(check => check.field_checked === "policy_cap")!.evidence_json = { maximum_minor: 20000 };
  clean.decisions.find(check => check.field_checked === "receipt_date")!.evidence_json = { policies: [{ date_range_start: "2026-09-17", date_range_end: "2026-09-20" }] };
  assert.match(facts().find(fact => fact.field === "policy_cap")!.observed, /Limit \$200.00/);
  assert.match(facts().find(fact => fact.field === "receipt_date")!.observed, /Allowed Sep 17, 2026 – Sep 20, 2026/);
});

test("custom Jev checks render with their recorded label and verdict", () => {
  const row = structuredClone(fixtureReviews.submissions[0]);
  const custom = fixtureCheck(0, "custom_itemized", "unknown", "Jev custom check \"Itemized receipt\": unknown.", true);
  custom.evidence_json = { check_label: "Itemized receipt" };
  row.decisions.push(custom);
  const fact = checkFacts(row, 0, true).find(entry => entry.field === "custom_itemized")!;
  assert.equal(fact.label, "Custom: Itemized receipt");
  assert.equal(fact.observed, "Sent to Jev");
  assert.equal(fact.verdict, "unknown");
  assert.match(fact.reason, /Itemized receipt/);
  const passed = structuredClone(row);
  passed.decisions.find(check => check.field_checked === "custom_itemized")!.verdict = "pass";
  assert.equal(checkFacts(passed, 0, true).find(entry => entry.field === "custom_itemized")!.verdict, "pass");
  // A stale or running assessment never shows a custom check as current.
  assert.equal(checkFacts(row, 1, true).find(entry => entry.field === "custom_itemized")!.verdict, "unknown");
});
