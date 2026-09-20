import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardClient } from "../client";
import { fixtureId, fixtureReviews } from "../fixtures";
import { DashboardError, money } from "../helpers";
import type { DecisionRequest } from "../types";

const decision = (id: number, revision: number, verdict: "approved" | "rejected" = "approved", note = "Reviewed original synthetic evidence."): DecisionRequest => ({
  submission_id: fixtureId(id), expected_review_revision: revision, human_verdict: verdict,
  human_note: note, correction_type: "decision_override", correction_payload_json: {},
});
const code = (expected: string) => (error: unknown) => error instanceof DashboardError && error.code === expected;

test("preview is isolated; decisions require notes/current revisions and cannot approve unsafe evidence", async () => {
  const client = createDashboardClient("preview");
  const first = await client.getReviews();
  assert.equal(first.contract_version, 2);
  assert.equal(first.submissions.length, 6);
  assert.equal(first.summary.approved_amount_minor, 14800);
  assert.equal(money(null), "—");
  first.submissions[0].attendee_name = "external mutation";
  assert.equal((await client.getReviews()).submissions[0].attendee_name, "Maya Chen");
  await assert.rejects(client.decide(decision(1, 1, "approved", "  ")), code("INVALID_BODY"));
  await assert.rejects(client.decide(decision(2, 1)), code("APPROVAL_BLOCKED"));
  await assert.rejects(client.decide(decision(5, 1)), code("DUPLICATE_BLOCKED"));
  await assert.rejects(client.decide(decision(6, 1)), code("APPROVAL_BLOCKED"));
  const approved = await client.decide(decision(1, 1));
  assert.equal(approved.row.decision_status, "approved");
  assert.equal(approved.row.review_revision, 2);
  await assert.rejects(client.decide(decision(1, 1)), code("STALE_REVIEW"));
  await client.reconcile({ submission_ids: [fixtureId(1), fixtureId(2), fixtureId(5)] });
  const current = await client.getReviews();
  assert.equal(current.submissions[0].decision_status, "approved");
  assert.equal(current.submissions[1].assessment_status, "flagged");
  assert.equal(current.submissions[4].decision_status, "rejected");
  assert.equal((await createDashboardClient("preview").getReviews()).submissions[0].decision_status, "pending");
});

test("preview learning is separate, versioned, test-gated, and stale until an explicit recheck", async () => {
  const client = createDashboardClient("preview");
  const rules = await client.getRules();
  const draft = rules.rules[0];
  await assert.rejects(client.activateRule(draft.id, { expected_rule_version: 1 }), code("TEST_REQUIRED"));
  const tested = await client.testRule(draft.id, { expected_rule_version: 1 });
  assert.equal(tested.rule.latest_test?.mode, "simulated");
  assert.equal(tested.rule.latest_test?.passed, true);
  await assert.rejects(client.activateRule(draft.id, { expected_rule_version: 1 }), code("STALE_RULE"));
  const active = await client.activateRule(draft.id, { expected_rule_version: tested.rule.version });
  assert.equal(active.knowledge_revision, 1);
  let sam = (await client.getReviews()).submissions[2];
  assert.equal(sam.assessment_status, "needs_review");
  assert.equal(sam.assessment_knowledge_revision, 0);
  await assert.rejects(client.decide(decision(3, sam.review_revision)), code("STALE_ASSESSMENT"));
  await client.reconcile({ submission_ids: [sam.id] });
  sam = (await client.getReviews()).submissions[2];
  assert.equal(sam.assessment_status, "matched");
  assert.equal(sam.decision_status, "pending");
  const taylor = (await client.getReviews()).submissions[3];
  await client.decide(decision(4, taylor.review_revision, "rejected"));
  assert.equal((await client.getRules()).rules[0].state, "disabled");
  assert.equal((await client.getReviews()).knowledge_revision, 2);
  await client.reconcile({ submission_ids: [sam.id] });
  assert.equal((await client.getReviews()).submissions[2].assessment_status, "needs_review");
});

test("proposal/test rejection, stale test gate, retry extraction, and read-only search stay honest", async () => {
  const client = createDashboardClient("preview");
  await assert.rejects(client.proposeRule({ submission_id: fixtureId(3), expected_review_revision: 1, canonical_vendor: "Harbor Hotel" }), code("RULE_INELIGIBLE"));
  await client.decide(decision(3, 1));
  const proposal = await client.proposeRule({ submission_id: fixtureId(3), expected_review_revision: 2, canonical_vendor: "Wrong Merchant" });
  const failed = await client.testRule(proposal.rule.id, { expected_rule_version: proposal.rule.version });
  assert.equal(failed.rule.latest_test?.passed, false);
  await assert.rejects(client.activateRule(failed.rule.id, { expected_rule_version: failed.rule.version }), code("TEST_FAILED"));
  const initialRule = (await client.getRules()).rules[0];
  const passed = await client.testRule(initialRule.id, { expected_rule_version: initialRule.version });
  await client.disableRule(failed.rule.id, { expected_rule_version: failed.rule.version });
  await assert.rejects(client.activateRule(passed.rule.id, { expected_rule_version: passed.rule.version }), code("STALE_RULE_TEST"));
  const retried = await client.retryExtraction(fixtureId(6), 1);
  assert.equal(retried.row.receipt?.extraction_status, "succeeded");
  assert.equal(retried.row.assessment_status, null);
  await assert.rejects(client.decide(decision(6, retried.row.review_revision)), code("APPROVAL_BLOCKED"));
  await client.reconcile({ submission_ids: [fixtureId(6)] });
  assert.equal((await client.getReviews()).submissions[5].assessment_status, "matched");
  const before = await client.getReviews();
  const search = await client.search({ query: "hotel receipts", snapshot_token: before.snapshot_token, filters: {} });
  assert.equal(search.mode, "simulated");
  assert.equal(search.model, null);
  assert.equal(search.matches.length, 2);
  const possible = await client.search({ query: "Maya maybe", snapshot_token: before.snapshot_token, filters: {} });
  assert.equal(possible.possible_matches[0].attendee_name, "Maya Chen");
  assert.deepEqual(await client.getReviews(), before);
  await assert.rejects(client.search({ query: "approve everyone", snapshot_token: before.snapshot_token, filters: {} }), code("UNSUPPORTED_QUERY"));
  await client.reconcile({ submission_ids: [fixtureId(1)] });
  await assert.rejects(client.search({ query: "hotel", snapshot_token: before.snapshot_token, filters: {} }), code("STALE_SNAPSHOT"));
});

test("API client preserves server errors, rejects v1, and never silently uses preview", async () => {
  const original = globalThis.fetch;
  try {
    const api = createDashboardClient("api");
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "STALE_REVIEW", message: "Refresh the current claim." } }), { status: 409 });
    await assert.rejects(api.decide(decision(1, 1)), error => error instanceof DashboardError && error.code === "STALE_REVIEW" && error.message === "Refresh the current claim." && error.status === 409);
    globalThis.fetch = async () => new Response(JSON.stringify({ submissions: [] }));
    await assert.rejects(api.getReviews(), code("CONTRACT_VERSION"));
    globalThis.fetch = async () => new Response(JSON.stringify(fixtureReviews));
    assert.equal((await api.getReviews()).submissions.length, 6);
    assert.equal(api.mode, "api");
    assert.equal(api.receiptUrl(fixtureReviews.submissions[0]), `/api/receipts/${fixtureId(201)}`);
  } finally { globalThis.fetch = original; }
});
