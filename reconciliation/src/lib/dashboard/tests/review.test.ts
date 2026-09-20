import assert from "node:assert/strict";
import { test } from "node:test";
import { activationBlock, amountDelta, approvalBlock, claimedTotals, financialIssue, nextAction, normalizeVendor, reviewInsights, rulesChanged } from "../review";
import { fixtureCheck, fixtureId, fixtureReviews, fixtureRules, previewResponse } from "../fixtures";
import { createDashboardClient } from "../client";
import { DashboardError } from "../helpers";

test("insights use exact complete sets, integer cents, scope, required checks and known revisions", () => {
  const a = structuredClone(fixtureReviews.submissions[2]);
  const b = structuredClone(a); b.id = fixtureId(44);
  a.amount_requested_minor = 12300; b.amount_requested_minor = 14800;
  a.receipt!.parsed_fields_json!.vendor = " SYN HBR042 ";
  b.receipt!.parsed_fields_json!.vendor = "syn hbr042";
  const data = previewResponse([a, b], 0);
  const group = reviewInsights(data).items[0];
  assert.deepEqual(group.ids, [a.id, b.id]); assert.equal(group.count, 2);
  assert.deepEqual(group.claimed_minor, { USD: 27100 });
  assert.equal(normalizeVendor("Ａ"), "ａ", "no extra Unicode normalization");
  for (const field of ["amount", "currency", "policy", "receipt_date", "policy_cap", "duplicate", "name"]) {
    const missing = structuredClone(data); missing.submissions[1].decisions = b.decisions.filter(c => c.field_checked !== field);
    assert.deepEqual(reviewInsights(missing).items, [], `missing ${field} cannot pass`);
  }
  const variants = [
    { assessment_status: "flagged" as const }, { category: "flight" as const },
    { assessment_knowledge_revision: null }, { assessment_knowledge_revision: 1 },
    { decision_status: "approved" as const }, { processing_status: "running" as const },
    { latest_run_id: null },
  ];
  for (const variant of variants) assert.deepEqual(reviewInsights(previewResponse([a, { ...b, ...variant }], 0)).items, []);
  const foreign = structuredClone(b); foreign.receipt!.parsed_fields_json!.currency = "CAD";
  assert.deepEqual(reviewInsights(previewResponse([a, foreign], 0)).items, []);
  const custom = structuredClone(b); custom.decisions.push(fixtureCheck(91, "custom_meal", "unknown", "Optional"));
  assert.equal(reviewInsights(previewResponse([a, custom], 0)).items[0].count, 2);
  for (const coverage of [undefined, { complete: false, returned: 2, total: 2 }, { complete: true, returned: 1, total: 2 }, { complete: true, returned: 2, total: 3 }]) assert.equal(reviewInsights({ ...data, coverage }).available, false);
  assert.equal(reviewInsights(previewResponse([a, a], 0)).available, false);
  assert.deepEqual(reviewInsights({ ...data, capabilities: undefined }).items, []);
  assert.equal(reviewInsights(previewResponse([a, { ...b, amount_requested_minor: Number.MAX_SAFE_INTEGER }], 0)).available, false);
  const stale = previewResponse([a, b, { ...a, id: fixtureId(45), decision_status: "approved" }, { ...a, id: fixtureId(46), assessment_knowledge_revision: null }], 1);
  assert.deepEqual(reviewInsights(stale).items.find(i => i.key === "rules")?.ids, [a.id, b.id]);
  const later = structuredClone(b); later.duplicate_submission_ids = [a.id, a.id, fixtureId(8)];
  const duplicates = reviewInsights(previewResponse([a, later], 0)).items.find(i => i.key === "duplicates")!;
  assert.deepEqual(duplicates.ids, [b.id]); assert.deepEqual(duplicates.claimed_minor, { USD: 14800 });
  assert.deepEqual(claimedTotals([a, a, b]), { USD: 27100 });
});

test("delta and approval use complete evidence, never legacy status or a human check as proof", () => {
  const row = structuredClone(fixtureReviews.submissions[0]);
  assert.deepEqual(amountDelta(row), { minor: 0, label: "Matches" });
  row.amount_requested_minor += 1200; assert.deepEqual(amountDelta(row), { minor: 1200, label: "+$12.00" });
  row.amount_requested_minor -= 2400; assert.equal(amountDelta(row).minor, -1200);
  row.receipt!.parsed_fields_json!.currency = "EUR"; assert.equal(amountDelta(row).label, "Currencies differ");
  row.receipt!.parsed_fields_json!.currency = "USD";
  row.receipt!.parsed_fields_json!.amount_minor = 1.5; assert.equal(amountDelta(row).label, "Unavailable");
  row.receipt!.extraction_status = "failed"; assert.equal(amountDelta(row).minor, null);
  const safe = structuredClone(fixtureReviews.submissions[0]);
  assert.equal(approvalBlock(safe, 0, [], true), null);
  for (const variant of [{ latest_run_id: null }, { assessment_status: null }, { processing_status: "running" as const }, { processing_status: "failed" as const }, { review_revision: -1 }]) assert.notEqual(approvalBlock({ ...safe, ...variant }, 0, [], true), null);
  const missing = structuredClone(safe); missing.decisions = missing.decisions.filter(c => c.field_checked !== "policy_cap");
  missing.decisions.push({ ...fixtureCheck(92, "policy_cap", "pass", "Human override"), check_method: "human" });
  assert.match(approvalBlock(missing, 0, [], true)!, /Policy limit/);
  safe.decisions.push(fixtureCheck(93, "amount", "fail", "Contradicting evidence"));
  assert.match(approvalBlock(safe, 0, [], true)!, /Amount/);
  assert.match(approvalBlock(fixtureReviews.submissions[4], 0, [], true)!, /Duplicate/);
  assert.equal(rulesChanged({ ...safe, assessment_knowledge_revision: null }, 1, true), false);
  assert.equal(rulesChanged(safe, 1, false), false);
  assert.equal(rulesChanged(safe, 1, true), true);
  assert.match(approvalBlock({ ...safe, decisions: fixtureReviews.submissions[0].decisions, assessment_knowledge_revision: null }, 1, [], true)!, /unknown/);
  assert.equal(nextAction({ ...safe, processing_status: "running" }, 0), "Checking…");
});

test("financial issue uses the first deterministic concern and only recorded cap/date/policy facts", () => {
  const row = structuredClone(fixtureReviews.submissions[0]);
  assert.equal(financialIssue(row), null);
  const cap = { ...fixtureCheck(96, "policy_cap", "fail", "Requested amount must not exceed the reimbursement cap."), evidence_json: { requested_minor: 26000, maximum_minor: 25000 } };
  row.decisions = [fixtureCheck(94, "amount", "fail", "Amount differs"), { ...cap, check_method: "human" }, cap];
  assert.deepEqual(financialIssue(row), { title: "Policy limit failed", rationale: cap.rationale_text, facts: ["Requested: $260.00", "Policy cap: $250.00"], nextStep: "Resolve the claimed amount against the policy cap, then recheck before approval." });
  row.decisions = [{ ...cap, evidence_json: { maximum_minor: null, requested_minor: 1.5 } }];
  assert.deepEqual(financialIssue(row)?.facts, []);
  const date = { ...fixtureCheck(97, "receipt_date", "fail", "Receipt date must fall within a configured policy date range.", "2026-09-01"), evidence_json: { policies: [{ date_range_start: "2026-09-18", date_range_end: "2026-09-20" }, {}] } };
  row.decisions = [date, cap];
  assert.deepEqual(financialIssue(row)?.facts, ["Receipt date: 2026-09-01", "Policy dates: 2026-09-18 through 2026-09-20"]);
  row.decisions.unshift({ ...fixtureCheck(98, "policy", "unknown", "Exactly one policy must cover this category, currency, and receipt date."), evidence_json: { policies: [] } });
  assert.deepEqual(financialIssue(row)?.facts, ["Applicable policies recorded: 0"]);
  row.decisions.unshift(fixtureCheck(99, "currency", "fail", "Receipt currency is missing or is not USD.", "EUR"));
  assert.deepEqual(financialIssue(row)?.facts, ["Receipt currency: EUR"]);
});

test("rule activation requires fresh successful nonregressing report, valid source and matching mode", () => {
  const rule = structuredClone(fixtureRules[0]);
  const rows = structuredClone(fixtureReviews.submissions);
  const source = rows.find(row => row.id === rule.source_submission_id)!;
  const approval = source.decisions.findLast(check => check.check_method === "human")!;
  approval.id = fixtureId(999);
  approval.evidence_json.correction_id = rule.source_correction_id;
  assert.match(activationBlock(rule, rows, 0, "api", false)!, /Test/);
  rule.latest_test = { rule_id: rule.id, rule_version: rule.version, knowledge_revision: 0, suite_version: "alias-v1", mode: "live", tested_at: "2026-09-20", passed: true, improved_case_ids: ["valid"], regressed_case_ids: [], reasons: [], before: { total: 10, correct: 8, false_matches: 0, needs_review: 4 }, after: { total: 10, correct: 10, false_matches: 0, needs_review: 2 } };
  assert.equal(activationBlock(rule, rows, 0, "api", false), null);
  approval.evidence_json.correction_id = approval.id;
  assert.match(activationBlock(rule, rows, 0, "api", false)!, /Source approval changed/);
  approval.evidence_json.correction_id = rule.source_correction_id;
  source.receipt!.parsed_fields_json!.vendor = "Different merchant";
  assert.match(activationBlock(rule, rows, 0, "api", false)!, /Source receipt/);
  source.receipt!.parsed_fields_json!.vendor = rule.payload.observed_vendor;
  source.decision_status = "rejected";
  assert.match(activationBlock(rule, rows, 0, "api", false)!, /remain approved/);
  source.decision_status = "approved";
  rule.latest_test.after.total = 9;
  assert.match(activationBlock(rule, rows, 0, "api", false)!, /complete safety/);
  rule.latest_test.after.total = 10;
  assert.match(activationBlock(rule, rows, 1, "api", false)!, /changed/);
  rule.latest_test.mode = "simulated";
  assert.match(activationBlock(rule, rows, 0, "api", false)!, /live/);
  assert.equal(activationBlock(rule, rows, 0, "api", true), null);
  assert.equal(activationBlock(rule, rows, 0, "preview", true), null);
  rule.latest_test_error = "Provider unavailable";
  assert.equal(activationBlock(rule, rows, 0, "preview", true), "Provider unavailable");
  assert.equal(activationBlock(structuredClone({ ...rule, latest_test: null }), rows, 0, "preview", true), "Provider unavailable");
  rule.latest_test_error = null; rule.latest_test.regressed_case_ids = ["unsafe"];
  assert.match(activationBlock(rule, rows, 0, "preview", true)!, /safety/);
});

test("API export captures exact selection/token, parses JSON conflicts and refuses non-CSV success", async () => {
  const original = globalThis.fetch;
  const client = createDashboardClient("api");
  const input = { snapshot_token: "frozen", submission_ids: [fixtureId(1), fixtureId(2)] };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/workspace/export");
      assert.deepEqual(JSON.parse(String(options?.body)), input);
      return new Response("claim_id\r\nsynthetic\r\n", { headers: { "content-type": "text/csv; charset=utf-8" } });
    };
    assert.equal(await (await client.exportReviews(input)).text(), "claim_id\r\nsynthetic\r\n");
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "STALE_SNAPSHOT", message: "Refresh" } }), { status: 409 });
    await assert.rejects(client.exportReviews(input), e => e instanceof DashboardError && e.code === "STALE_SNAPSHOT");
    globalThis.fetch = async () => new Response("{}", { headers: { "content-type": "application/json" } });
    await assert.rejects(client.exportReviews(input), e => e instanceof DashboardError && e.code === "INVALID_RESPONSE");
  } finally { globalThis.fetch = original; }
});
