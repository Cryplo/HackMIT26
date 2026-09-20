import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedFailures, rejectConfirmedFailures } from "../bulk-decisions";
import { fixtureId, fixtureReviews, previewResponse } from "../fixtures";

test("bulk rejection freezes only confirmed failures, revalidates each claim, and stops after partial failures", async () => {
  const failed = structuredClone(fixtureReviews.submissions[1]);
  const second = { ...structuredClone(failed), id: fixtureId(93), attendee_name: "Second failure" };
  const unknown = structuredClone(fixtureReviews.submissions[2]);
  const passed = structuredClone(fixtureReviews.submissions[0]);
  const terminal = { ...structuredClone(failed), id: fixtureId(94), decision_status: "rejected" as const };
  const checkFailed = structuredClone(fixtureReviews.submissions[5]);
  const unchecked = { ...structuredClone(failed), id: fixtureId(97), assessment_status: null, latest_run_id: null };
  const running = { ...structuredClone(failed), id: fixtureId(98), processing_status: "running" as const };
  const data = previewResponse([failed, second, unknown, passed, terminal, checkFailed, unchecked, running], 0);
  const frozen = confirmedFailures(data);
  assert.deepEqual(frozen.map(row => row.id), [failed.id, second.id]);
  let calls = 0;
  let reads = 0;
  const progress: number[] = [];
  const result = await rejectConfirmedFailures(frozen, async () => { reads++; return data; }, async input => {
    calls++;
    assert.equal(reads, calls, "refresh before every write");
    assert.equal(input.human_note, frozen[calls - 1].note);
    if (calls === 2) throw new Error("Connection lost");
    return { correction_id: fixtureId(95), row: { ...failed, decision_status: "rejected", review_revision: failed.review_revision + 1 } };
  }, completed => progress.push(completed));
  assert.equal(calls, 2, "uncertain write is never retried");
  assert.equal(result.completed, 1);
  assert.match(result.error!, /1 of 2.*may have saved.*remaining claims were not submitted/);
  assert.deepEqual(progress, [1]);

  for (const fresh of [
    { ...data, knowledge_revision: data.knowledge_revision + 1 },
    { ...data, snapshot_token: "" },
    { ...data, coverage: { complete: false, returned: data.submissions.length, total: data.submissions.length + 1 } },
    { ...data, submissions: data.submissions.map(row => row.id === failed.id ? { ...row, review_revision: row.review_revision + 1 } : row) },
    { ...data, submissions: data.submissions.map(row => row.id === failed.id ? { ...unknown, id: row.id } : row) },
    { ...data, submissions: data.submissions.map(row => row.id === failed.id ? { ...row, decision_status: "approved" as const } : row) },
  ]) {
    const stopped = await rejectConfirmedFailures(frozen, async () => fresh, async () => { assert.fail("stale or unconfirmed claim must not be rejected"); }, () => {});
    assert.equal(stopped.completed, 0);
    assert.match(stopped.error!, /changed/);
  }
  let successful = 0;
  const complete = await rejectConfirmedFailures(frozen, async () => data, async input => {
    successful++;
    const row = data.submissions.find(row => row.id === input.submission_id)!;
    return { correction_id: fixtureId(99), row: { ...row, review_revision: row.review_revision + 1, decision_status: "rejected" } };
  }, () => {});
  assert.equal(successful, 2);
  assert.deepEqual(complete, { completed: 2, error: null });
  let attempts = 0;
  const three = [...frozen, { ...frozen[1], id: fixtureId(96) }];
  const stopped = await rejectConfirmedFailures(three, async () => data, async () => {
    attempts++;
    throw new Error("Unknown result");
  }, () => {});
  assert.equal(attempts, 1, "later claims are left untouched");
  assert.equal(stopped.completed, 0);
});
