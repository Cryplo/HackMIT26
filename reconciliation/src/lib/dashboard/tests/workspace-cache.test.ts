import assert from "node:assert/strict";
import { test } from "node:test";
import { checkClaims, getWorkspaceStore } from "../client";
import { fixtureId, fixtureReviews } from "../fixtures";
import type { ReconcileRequest, ReviewsResponse } from "../types";

test("shared workspace dedupes, isolates cancellation/modes, preserves mutations, and batches without retries", async () => {
  const originalFetch = globalThis.fetch;
  const initial = structuredClone(fixtureReviews);
  let reads = 0;
  let resolveRead: ((response: Response) => void) | undefined;
  let deferRead = true;
  let failRead = false;
  let server: ReviewsResponse = initial;
  let legacy = false;
  let deferMutation = false;
  let resolveMutation: ((response: Response) => void) | undefined;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST" && deferMutation) return new Promise<Response>(resolve => { resolveMutation = resolve; });
    if (init?.method === "POST") return Response.json(legacy ? { results: [] } : {
      results: [], rows: server.submissions, snapshot_token: server.snapshot_token, knowledge_revision: server.knowledge_revision,
    });
    reads++;
    if (failRead) throw new Error("offline");
    if (deferRead) return new Promise<Response>(resolve => { resolveRead = resolve; });
    return Response.json(server);
  };
  try {
    const store = getWorkspaceStore("api");
    assert.equal(getWorkspaceStore("api"), store);
    const abort = new AbortController();
    const leaving = store.client.getReviews(abort.signal);
    const staying = store.client.getReviews();
    assert.equal(reads, 1);
    abort.abort();
    await assert.rejects(leaving, { name: "AbortError" });
    resolveRead!(Response.json(initial));
    const first = await staying;
    first.submissions[0].attendee_name = "external edit";
    assert.equal((await store.client.getReviews()).submissions[0].attendee_name, "Maya Chen");
    assert.equal(reads, 1);
    const preview = getWorkspaceStore("preview");
    await preview.client.getReviews();
    assert.notEqual(preview.client, store.client);
    assert.equal(reads, 1);

    const staleRead = store.refresh();
    assert.equal(store.getSnapshot().loading, true, "refresh is visible while saved rows stay on screen");
    assert.equal(store.getSnapshot().data!.submissions.length, initial.submissions.length);
    assert.equal(reads, 2, "explicit refresh bypasses the fresh cache");
    server = structuredClone(initial);
    server.snapshot_token = "after-check";
    server.knowledge_revision = 1;
    server.submissions[2] = { ...server.submissions[2], assessment_status: "matched", review_revision: 2, assessment_knowledge_revision: 1 };
    server.submissions.push({ ...server.submissions[0], id: fixtureId(99) });
    await store.client.reconcile({ submission_ids: [fixtureId(3)] });
    assert.equal(reads, 2, "full mutation response avoids an extra read");
    assert.equal(store.getSnapshot().data!.submissions.length, 7, "full returned workspace replaces the cached list");
    assert.equal(store.getSnapshot().loading, false);
    assert.equal(store.getSnapshot().data!.summary.matched_count, 3);
    assert.equal(store.getSnapshot().data!.submissions[2].decision_status, "pending");
    resolveRead!(Response.json(initial));
    await staleRead;
    assert.equal(store.getSnapshot().data!.snapshot_token, "after-check", "an older read cannot overwrite mutation outcomes");
    assert.equal(preview.getSnapshot().data!.submissions[2].assessment_status, "needs_review");

    deferRead = false;
    failRead = true;
    await assert.rejects(store.refresh(), /offline/);
    assert.equal(store.getSnapshot().error, "offline");
    assert.equal(store.getSnapshot().data!.snapshot_token, "after-check");
    failRead = false;
    legacy = true;
    await store.client.reconcile({ submission_ids: [fixtureId(3)] });
    assert.equal(reads, 4, "legacy mutation results fall back to one review refresh");
    assert.equal(store.getSnapshot().error, "");

    deferMutation = true;
    const investigation = store.client.investigate(fixtureId(3), 2);
    server = structuredClone(server);
    server.snapshot_token = "running-investigation";
    server.submissions[2] = { ...server.submissions[2], processing_status: "running", review_revision: 3 };
    await store.refresh();
    assert.equal(store.getSnapshot().data!.submissions[2].processing_status, "running", "shared polling publishes while a write is pending");
    server.snapshot_token = "completed-investigation";
    server.submissions[2] = { ...server.submissions[2], processing_status: "idle", review_revision: 4 };
    deferRead = true;
    resolveMutation!(Response.json({ row: server.submissions[2] }));
    await investigation;
    assert.equal(store.getSnapshot().data!.submissions[2].review_revision, 4, "authoritative row returns before deferred background revalidation");
    resolveRead!(Response.json(server));
    await store.client.getReviews();
    deferRead = false;
    const uncertain = store.client.investigate(fixtureId(3), 4);
    await store.refresh();
    const readsBeforeFailure = reads;
    resolveMutation!(Response.json({ error: { message: "uncertain operation" } }, { status: 500 }));
    await assert.rejects(uncertain, /uncertain operation/);
    assert.equal(reads, readsBeforeFailure + 1, "a failed write invalidates even when a poll returned a token during the operation");

    const batches: string[][] = [];
    const client = { ...store.client, reconcile: async ({ submission_ids }: ReconcileRequest) => {
      batches.push(submission_ids);
      return { results: submission_ids.map(submission_id => ({ submission_id, run_id: null, assessment_status: "matched" as const, decision_status: "pending" as const, review_revision: 2 })) };
    } };
    const ids = Array.from({ length: 51 }, (_, index) => fixtureId(index + 1));
    const completed = await checkClaims(client, ids, () => {});
    assert.deepEqual(completed, { done: 51, stopped: false });
    assert.deepEqual(batches.map(batch => batch.length), [...Array(10).fill(5), 1]);
    batches.length = 0;
    let stop = false;
    const stopped = await checkClaims(client, ids, progress => { if (progress.done === 5) stop = true; }, () => stop);
    assert.deepEqual(stopped, { done: 5, stopped: true });
    assert.equal(batches.length, 1);
    let attempts = 0;
    await assert.rejects(checkClaims({ ...client, reconcile: async () => { attempts++; throw new Error("uncertain write"); } }, ids, () => {}), /uncertain write/);
    assert.equal(attempts, 1, "uncertain writes are never retried");
  } finally { globalThis.fetch = originalFetch; }
});

test("decisions publish counts to every subscriber before refresh and stay current across navigation", async () => {
  const originalFetch = globalThis.fetch;
  const initial = structuredClone(fixtureReviews);
  const server = structuredClone(initial);
  let releaseRead: ((response: Response) => void) | undefined;
  let deferRead = false;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      const row = server.submissions.find(value => value.id === input.submission_id)!;
      row.decision_status = input.human_verdict;
      row.decision_source = "human";
      row.review_revision++;
      server.snapshot_token = "saved-decision";
      server.summary.pending_review_count--;
      server.summary.approved_amount_minor += row.amount_requested_minor;
      return Response.json({ row, correction_id: fixtureId(90) });
    }
    if (deferRead) return new Promise<Response>(resolve => { releaseRead = resolve; });
    return Response.json(server);
  };
  const store = getWorkspaceStore("api");
  const seenOverview: number[] = [], seenReviews: number[] = [];
  const overview = store.subscribe(() => seenOverview.push(store.getSnapshot().data?.summary.pending_review_count ?? -1));
  const reviews = store.subscribe(() => seenReviews.push(store.getSnapshot().data?.summary.pending_review_count ?? -1));
  try {
    await store.refresh();
    deferRead = true;
    const stale = store.refresh();
    const staleResponse = releaseRead!;
    await store.client.decide({ submission_id: initial.submissions[0].id, expected_review_revision: 1, human_verdict: "approved", human_note: "Reviewed evidence", correction_type: "decision_override", correction_payload_json: {} });
    const pending = initial.summary.pending_review_count - 1;
    assert.equal(seenOverview.at(-1), pending);
    assert.equal(seenReviews.at(-1), pending);
    assert.equal(store.getSnapshot().data!.summary.approved_amount_minor, initial.summary.approved_amount_minor + initial.submissions[0].amount_requested_minor);
    staleResponse(Response.json(initial));
    await stale;
    assert.equal(store.getSnapshot().data!.summary.pending_review_count, pending);
    const background = releaseRead!;
    const simultaneous = [store.refresh(), store.refresh()];
    background(Response.json(server));
    await Promise.all(simultaneous);
    overview(); reviews();
    const navigated = getWorkspaceStore("api");
    assert.equal((await navigated.client.getReviews()).submissions[0].decision_status, "approved");
    assert.equal(navigated.getSnapshot().data!.summary.pending_review_count, pending);
  } finally { overview(); reviews(); globalThis.fetch = originalFetch; }
});

test("delayed batch snapshots preserve unrelated progress and current membership for every consumer", async () => {
  const originalFetch = globalThis.fetch;
  const initial = structuredClone(fixtureReviews);
  let server = structuredClone(initial);
  let releaseMutation!: (response: Response) => void;
  let releaseRead!: (response: Response) => void;
  let deferRead = false;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") return new Promise<Response>(resolve => { releaseMutation = resolve; });
    if (deferRead) return new Promise<Response>(resolve => { releaseRead = resolve; });
    return Response.json(server);
  };
  const store = getWorkspaceStore("api");
  const seen: Array<ReviewsResponse | null> = [null, null];
  const unsubscribes = seen.map((_, index) => store.subscribe(() => { seen[index] = store.getSnapshot().data; }));
  try {
    await store.refresh();
    const mutation = store.client.reconcile({ submission_ids: [initial.submissions[0].id] });
    const completed = { ...initial.submissions[0], review_revision: 2, assessment_status: "matched" as const };
    const unrelated = server.submissions[1];
    unrelated.processing_status = "running"; // beginRun does not increment review_revision.
    server.submissions.pop();
    server.submissions.push({ ...initial.submissions[0], id: fixtureId(99) });
    server.snapshot_token = "new-membership-and-running";
    await store.refresh();
    deferRead = true;
    releaseMutation(Response.json({ rows: [completed, ...initial.submissions.slice(1)], results: [], snapshot_token: "stale-batch", knowledge_revision: 0 }));
    await mutation;
    for (const snapshot of seen) {
      assert.equal(snapshot!.submissions[0].review_revision, 2, "owned outcome publishes immediately");
      assert.equal(snapshot!.submissions[1].processing_status, "running", "equal-revision unrelated progress survives");
      assert.ok(snapshot!.submissions.some(row => row.id === fixtureId(99)), "new claims survive");
      assert.ok(!snapshot!.submissions.some(row => row.id === initial.submissions.at(-1)!.id), "deleted claims stay deleted");
      assert.equal(snapshot!.snapshot_token, "", "mixed rows cannot advertise an authoritative snapshot token");
    }
    assert.equal(store.getSnapshot().loading, false, "background recovery leaves controls stable");
    server.submissions[0] = completed;
    releaseRead(Response.json(server));
    await store.client.getReviews();
    assert.equal(store.getSnapshot().data!.snapshot_token, server.snapshot_token);
  } finally { unsubscribes.forEach(unsubscribe => unsubscribe()); globalThis.fetch = originalFetch; }
});

test("cross-tab notifications refresh silently, invalidate older reads, and close with the last subscriber", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const OriginalChannel = globalThis.BroadcastChannel;
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let channel!: TestChannel;
  class TestChannel {
    onmessage: ((event: { data: string }) => void) | null = null;
    sent: string[] = [];
    closed = false;
    constructor() { channel = this; }
    postMessage(data: string) { this.sent.push(data); }
    close() { this.closed = true; }
  }
  Object.assign(globalThis, { document, window: new EventTarget(), BroadcastChannel: TestChannel });
  let server = structuredClone(fixtureReviews);
  const deferred: Array<(response: Response) => void> = [];
  let deferRead = false;
  let releaseMutation!: (response: Response) => void;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") return new Promise<Response>(resolve => { releaseMutation = resolve; });
    return deferRead ? new Promise<Response>(resolve => deferred.push(resolve)) : Response.json(server);
  };
  const store = getWorkspaceStore("api");
  let unsubscribe = () => {};
  try {
    await store.refresh();
    unsubscribe = store.subscribe(() => {});
    deferRead = true;
    channel.onmessage!({ data: "changed" });
    assert.equal(store.getSnapshot().loading, false);
    channel.onmessage!({ data: "changed" });
    server = structuredClone(server);
    server.submissions[0].processing_status = "running";
    server.snapshot_token = "other-tab-running";
    deferred[1](Response.json(server));
    await store.client.getReviews();
    deferred[0](Response.json(fixtureReviews));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.getSnapshot().data!.snapshot_token, "other-tab-running");
    assert.equal(channel.sent.length, 0, "receiving tab does not echo notifications");
    deferRead = false;
    const pending = store.client.investigate(server.submissions[0].id, server.submissions[0].review_revision);
    for (let index = 0; index < 3; index++) {
      channel.onmessage!({ data: "changed" });
      await store.client.getReviews();
    }
    assert.equal(channel.sent.length, 2, "a pending tab announces its start and each distinct snapshot once, preventing mutual refresh loops");
    releaseMutation(Response.json({ row: server.submissions[0] }));
    await pending;
    await store.client.getReviews();
    unsubscribe();
    assert.equal(channel.closed, true);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { document: originalDocument, window: originalWindow, BroadcastChannel: OriginalChannel });
  }
});
