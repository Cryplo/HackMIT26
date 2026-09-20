import assert from "node:assert/strict";
import { test } from "node:test";
import { auditBucket, auditFlowStage, checkState, claimReason, humanActions, investigationBlock, nextHumanAction } from "../human-actions";
import { fixtureCheck, fixtureId, fixtureReviews, previewResponse } from "../fixtures";
import { fixtureInvestigations } from "../investigation-fixtures";

test("review desk separates machine work, human approval, financial flags, and safe investigation starts", () => {
  const passed = structuredClone(fixtureReviews.submissions[0]);
  const flagged = structuredClone(fixtureReviews.submissions[1]);
  const unclear = structuredClone(fixtureReviews.submissions[2]);
  const failed = structuredClone(fixtureReviews.submissions[5]);
  const unchecked = { ...passed, id: fixtureId(90), assessment_status: null, latest_run_id: null };
  const running = { ...passed, id: fixtureId(91), processing_status: "running" as const };
  const approved = { ...passed, id: fixtureId(92), decision_status: "approved" as const, receipt: { ...passed.receipt!, sha256: "9".repeat(64) } };
  const data = previewResponse([passed, unchecked, approved, running, unclear, failed, flagged], 0);
  const actions = humanActions(data);
  assert.deepEqual(actions.map(action => action.row.id), [unclear.id, flagged.id, passed.id, failed.id]);
  assert.deepEqual(actions.map(action => action.group), ["inconclusive", "confirmed_fail", "passed", "check_failed"]);
  assert.deepEqual(new Set(actions.map(action => action.row.id)), new Set(data.submissions.filter(row => auditBucket(row) === "review").map(row => row.id)), "the full review queue matches the dashboard Needs review bucket");
  const afterUnclear = { ...data, submissions: data.submissions.map(row => row.id === unclear.id ? { ...row, decision_status: "approved" as const } : row) };
  assert.equal(nextHumanAction(afterUnclear, unclear.id, actions.map(action => action.row.id))?.id, flagged.id, "review continues into confirmed issues after uncertainty is resolved");
  assert.equal(actions.find(action => action.row.id === passed.id)?.ready, true);
  assert.match(actions.find(action => action.row.id === passed.id)!.reason, /Your approval authorizes reimbursement/);
  assert.match(actions.find(action => action.row.id === flagged.id)!.rejectionReason!, /receipt shows/);
  assert.equal(humanActions({ ...data, knowledge_revision: 1 }).find(action => action.row.id === flagged.id)?.group, "inconclusive", "stale failures never enter bulk rejection");
  const modelOnly = structuredClone(flagged);
  modelOnly.decisions[0].check_method = "jev";
  assert.equal(humanActions(previewResponse([modelOnly], 0))[0].group, "inconclusive", "model suspicion alone is not a confirmed failure");
  assert.equal(checkState(failed), "failed");
  assert.equal(checkState(flagged), "flagged");
  assert.equal(checkState(unchecked), "unchecked");
  assert.equal(checkState(running), "running");
  assert.equal(checkState(approved), "passed", "human approval remains independent of machine checks");
  assert.match(claimReason(unclear), /confirm which merchant issued it/);
  const missingName = structuredClone(unclear);
  missingName.receipt!.parsed_fields_json!.names = [];
  missingName.decisions = [fixtureCheck(997, "name", "unknown", "Name is missing"), {
    ...fixtureCheck(998, "policy", "pass", "Receipt identity required"),
    evidence_json: { policies: [{ claimant_identity_evidence: "receipt_only" }] },
  }];
  assert.match(claimReason(missingName), /requires their name on the receipt/);
  assert.doesNotMatch(claimReason(missingName), /Core|reassess/);
  assert.equal(humanActions({ ...data, knowledge_revision: 1 }).find(action => action.row.id === passed.id)?.ready, false);
  const order = [flagged.id, unclear.id, failed.id, passed.id];
  assert.equal(nextHumanAction(data, flagged.id, order)?.id, unclear.id);
  assert.equal(nextHumanAction(data, passed.id, order)?.id, flagged.id, "wrap to earlier unresolved claims");
  assert.equal(nextHumanAction(data, flagged.id, [flagged.id]), null, "finish the current visible queue");
  assert.equal(nextHumanAction(data, flagged.id, [flagged.id, unchecked.id, running.id, approved.id]), null);
  const refreshed = { ...data, submissions: data.submissions.map(row => row.id === unclear.id ? { ...row, decision_status: "approved" as const } : row) };
  assert.equal(nextHumanAction(refreshed, flagged.id, order)?.id, failed.id, "fresh decisions override old visible order");
  assert.equal(nextHumanAction(data, flagged.id, order, row => row.id === passed.id)?.id, passed.id, "reapply current filters to fresh rows");
  assert.equal(nextHumanAction(data, approved.id, [passed.id])?.id, passed.id, "return from a comparison outside the queue");

  const capabilities = { ...data.capabilities!, investigations: true };
  assert.equal(investigationBlock(unclear, capabilities), null);
  assert.notEqual(investigationBlock(passed, capabilities), null, "queue suggestions require recoverable uncertainty");
  assert.equal(investigationBlock(passed, capabilities, false), null, "manual investigation can derive learning from a passed source claim");
  for (const row of [unchecked, approved, running, failed, { ...unclear, review_revision: -1 }, { ...unclear, duplicate_submission_ids: [passed.id] }, { ...unclear, decisions: [...unclear.decisions, fixtureCheck(999, "amount", "fail", "Amount differs")] }]) {
    assert.notEqual(investigationBlock(row, capabilities, false), null);
  }
  assert.notEqual(investigationBlock(unclear, { ...capabilities, investigations: false }), null);
});

test("dashboard buckets count saved decisions separately from check findings", () => {
  const row = structuredClone(fixtureReviews.submissions[0]);
  assert.equal(auditBucket({ ...row, assessment_status: null, latest_run_id: null }), "unchecked");
  assert.equal(auditBucket({ ...row, processing_status: "running" }), "unchecked");
  assert.equal(auditBucket({ ...row, assessment_status: "flagged" }), "review");
  assert.equal(auditBucket({ ...row, processing_status: "failed" }), "review");
  assert.equal(auditBucket({ ...row, decision_status: "approved", assessment_status: "flagged" }), "approved");
  assert.equal(auditBucket({ ...row, decision_status: "rejected" }), "rejected");
});

test("audit flow agrees with dashboard totals and keeps each active claim in one stage", () => {
  const [passed, flagged, unclear] = fixtureReviews.submissions;
  const rows = [
    { ...passed, id: fixtureId(100), decision_status: "approved" as const },
    ...Array.from({ length: 7 }, (_, i) => ({ ...unclear, id: fixtureId(101 + i) })),
    ...Array.from({ length: 6 }, (_, i) => ({ ...flagged, id: fixtureId(108 + i) })),
  ];
  const count = (values: string[]) => values.reduce<Record<string, number>>((counts, key) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(count(rows.map(auditBucket)), { approved: 1, review: 13 });
  assert.deepEqual(count(rows.map(row => auditFlowStage(row))), { passed: 1, uncertain: 13 });
  assert.equal(rows.filter(row => auditBucket(row) !== "unchecked").length, 14, "overall checked total is independent of session completion count");
  assert.equal(auditFlowStage(passed), "uncertain", "passing checks still require a saved approval");
  assert.equal(auditFlowStage({ ...passed, processing_status: "failed" }), "uncertain", "failed checks are not rejections");
  assert.equal(auditFlowStage({ ...passed, decision_status: "rejected" }), "failed");

  const unchecked = { ...passed, assessment_status: null, latest_run_id: null };
  const run = { ...fixtureInvestigations(fixtureReviews.submissions)[0], status: "running" as const };
  const investigating = { ...unclear, latest_investigation: run };
  const activeRows = [unchecked, { ...unchecked, processing_status: "running" as const }, investigating];
  assert.deepEqual(activeRows.map(auditBucket), ["unchecked", "unchecked", "unchecked"]);
  assert.deepEqual(activeRows.map(row => auditFlowStage(row)), ["waiting", "checking", "investigations"]);
  assert.equal(auditFlowStage(unchecked, true), "checking", "local checking status splits the unchecked bucket");
  assert.equal(auditFlowStage(investigating, true), "investigations", "an investigation and local checking status never duplicate a claim");
  for (const decision_status of ["approved", "rejected"] as const) {
    const decided = { ...investigating, decision_status, processing_status: "running" as const };
    assert.equal(auditBucket(decided), decision_status);
    assert.equal(auditFlowStage(decided, true), decision_status === "approved" ? "passed" : "failed", "saved decisions override all running activity");
  }
  assert.equal(auditFlowStage({ ...investigating, latest_investigation: { ...run, status: "failed" } }), "uncertain", "failed investigations return to the review queue");
});
