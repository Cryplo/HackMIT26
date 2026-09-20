import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuditSession, isAuditEligible } from "../audit-session";
import { createDashboardClient } from "../client";
import { fixtureReviews } from "../fixtures";
import type { ReconcileRequest, ReconcileResponse, ReviewRow } from "../types";

function unchecked(id: string): ReviewRow {
  return { ...structuredClone(fixtureReviews.submissions[0]), id, assessment_status: null, latest_run_id: null, decisions: [] };
}

function harness(rows: ReviewRow[], reconcile?: (ids: string[]) => Promise<void | ReconcileResponse>) {
  const data = { ...structuredClone(fixtureReviews), demo_mode: false, submissions: rows };
  const requests: string[][] = [];
  let reads = 0;
  let failRefresh = false;
  const session = createAuditSession({
    client: { ...createDashboardClient("preview"), mode: "api", async reconcile({ submission_ids }: ReconcileRequest) {
      requests.push(submission_ids);
      const response = await reconcile?.(submission_ids);
      if (response) return response;
      const results = submission_ids.map(id => {
        const row = data.submissions.find(row => row.id === id)!;
        row.assessment_status = "matched";
        row.latest_run_id = `run-${id}`;
        return { submission_id: id, run_id: row.latest_run_id, assessment_status: row.assessment_status, decision_status: row.decision_status, review_revision: ++row.review_revision };
      });
      return { results };
    } },
    async refresh() { reads++; if (failRefresh) throw new Error("offline"); },
    getSnapshot: () => ({ data, loading: false, error: "", updatedAt: 0 }),
  });
  return { session, data, requests, reads: () => reads, failRefresh: () => { failRefresh = true; } };
}

test("audit snapshots unchecked claims, preserves human decisions, stops after a write and resumes without retries", async () => {
  const base = unchecked("eligible");
  assert.equal(isAuditEligible(base), true);
  assert.equal(isAuditEligible({ ...base, receipt: null }), true);
  const blocked: ReviewRow[] = [
    { ...base, id: "approved", decision_status: "approved" },
    { ...base, id: "rejected", decision_status: "rejected" },
    { ...base, id: "human-source", decision_source: "human" },
    { ...base, id: "human-check", decisions: [{ ...fixtureReviews.submissions[0].decisions[0], check_method: "human" }] },
    { ...base, id: "assessed", assessment_status: "matched" },
    { ...base, id: "run", latest_run_id: "existing-run" },
    { ...base, id: "running", processing_status: "running" },
    { ...base, id: "failed", processing_status: "failed" },
    { ...base, id: "extracting", receipt: { ...base.receipt!, extraction_status: "pending" } },
    { ...base, id: "extraction-failed", receipt: { ...base.receipt!, extraction_status: "failed" } },
  ];
  for (const row of blocked) assert.equal(isAuditEligible(row), false, row.id);
  const blockedBefore = structuredClone(blocked);
  const releases: (() => void)[] = [];
  const h = harness([unchecked("d"), unchecked("c"), unchecked("b"), unchecked("a"), ...blocked], () => new Promise(resolve => { releases.push(resolve); }));
  const states: string[] = [];
  const unsubscribe = h.session.subscribe(() => { states.push(h.session.getSnapshot().status); });
  assert.equal(h.session.getServerSnapshot(), h.session.getServerSnapshot(), "stable hydration snapshot");
  const running = h.session.start();
  await Promise.resolve();
  assert.deepEqual(h.requests, [["a"], ["b"], ["c"]], "stable order, bounded three workers, one claim per request");
  assert.equal(h.session.getSnapshot().total, 4);
  assert.deepEqual(h.session.getSnapshot().checkingIds, ["a", "b", "c"]);
  assert.equal(h.session.getSnapshot().done, 0, "in-flight requests are not successes");
  await h.session.start();
  h.session.stop();
  assert.equal(h.session.getSnapshot().status, "stopping");
  await h.session.start();
  assert.equal(h.requests.length, 3, "duplicate starts cannot submit another write");
  unsubscribe();
  releases.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.getSnapshot().done, 1, "each response publishes before the other requests finish");
  assert.deepEqual(h.session.getSnapshot().checkingIds, ["b", "c"]);
  assert.equal(h.session.getSnapshot().status, "stopping", "stop waits for every submitted write");
  releases.splice(0).forEach(resolve => resolve());
  await running;
  assert.equal(h.session.getSnapshot().status, "idle");
  assert.equal(h.session.getSnapshot().done, 3, "navigation/unsubscription does not abandon submitted results");
  assert.deepEqual(h.session.getSnapshot().completedIds, ["a", "b", "c"]);
  assert.deepEqual(h.session.getSnapshot().checkingIds, []);
  assert.equal(h.reads(), 2, "refreshes before selection and after stopping");
  assert.ok(states.includes("stopping"));
  const resumed = h.session.start();
  await Promise.resolve();
  releases.splice(0).forEach(resolve => resolve());
  await resumed;
  assert.equal(h.session.getSnapshot().status, "complete");
  assert.equal(h.session.getSnapshot().done, 1);
  assert.deepEqual(h.requests, [["a"], ["b"], ["c"], ["d"]]);
  assert.deepEqual(blocked, blockedBefore, "human decisions and ineligible claims are untouched");

  const failure = harness([unchecked("a"), unchecked("b"), unchecked("c"), unchecked("d")], async ids => {
    if (ids[0] === "a") throw new Error("uncertain write");
  });
  await failure.session.start();
  assert.equal(failure.session.getSnapshot().status, "failed");
  assert.equal(failure.session.getSnapshot().done, 2, "only successful responses count, even when another worker fails");
  assert.match(failure.session.getSnapshot().error, /uncertain write/);
  assert.deepEqual(failure.requests, [["a"], ["b"], ["c"]]);
  await failure.session.start();
  assert.deepEqual(failure.requests, [["a"], ["b"], ["c"], ["d"]], "resume excludes uncertain attempts even if the server still reports unchecked");
  assert.equal(failure.session.getSnapshot().status, "failed", "a resumed run keeps unresolved failed attempts visible");
  assert.match(failure.session.getSnapshot().error, /1 failed attempt remains for individual review/);
  await failure.session.start();
  assert.deepEqual(failure.requests, [["a"], ["b"], ["c"], ["d"]], "no fresh claims means no retry of an uncertain write");
  assert.equal(failure.session.getSnapshot().status, "failed");
  assert.match(failure.session.getSnapshot().error, /uncertain write/);
  failure.data.submissions[0].assessment_status = "matched";
  await failure.session.start();
  assert.equal(failure.session.getSnapshot().status, "complete", "an authoritative assessment clears the unresolved warning");
  assert.equal(failure.session.getSnapshot().error, "");

  const changing = harness([unchecked("a"), unchecked("b"), unchecked("c"), unchecked("d")], async () => {
    changing.data.submissions[3].decision_status = "approved";
    changing.data.submissions.push(unchecked("new"));
  });
  await changing.session.start();
  assert.deepEqual(changing.requests, [["a"], ["b"], ["c"]], "new claims wait for the next run and newly approved claims are skipped");
  assert.equal(changing.session.getSnapshot().done, changing.session.getSnapshot().total);

  const offline = harness([unchecked("a")]);
  offline.failRefresh();
  await offline.session.start();
  assert.equal(offline.session.getSnapshot().status, "failed");
  assert.match(offline.session.getSnapshot().error, /offline/);
  assert.deepEqual(offline.requests, [], "failed initial refresh cannot check stale cached rows");

  const missing = harness([unchecked("a")], async () => ({ results: [] }));
  await missing.session.start();
  assert.equal(missing.session.getSnapshot().done, 0);
  assert.equal(missing.session.getSnapshot().status, "failed");
  assert.match(missing.session.getSnapshot().error, /No result/);

  const refreshFailure = harness([unchecked("a")], async () => { refreshFailure.failRefresh(); });
  await refreshFailure.session.start();
  assert.equal(refreshFailure.session.getSnapshot().done, 1, "saved success survives a failed final refresh");
  assert.equal(refreshFailure.session.getSnapshot().status, "failed");
  assert.match(refreshFailure.session.getSnapshot().error, /Refresh failed/);

  const demo = harness([unchecked("a")]);
  demo.data.demo_mode = true;
  const began = Date.now();
  await demo.session.start();
  assert.ok(Date.now() - began >= 400, "demo mode provides a short presentation cadence");
  assert.equal(demo.session.getSnapshot().done, 1);
});
