import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreviewClient } from "../preview";
import { fixtureId } from "../fixtures";
import type { DecisionRequest } from "../types";

test("preview decisions create private-note-free notices and replay exactly once", async () => {
  const client = createPreviewClient();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Preview must not make network requests"); };
  try {
    const initial = await client.getReviews();
    assert.equal(initial.capabilities?.automatic_decision_emails, true);
    assert.equal(initial.capabilities?.email_mode, "preview");
    assert.deepEqual(await client.getMessages!(fixtureId(4)), { messages: [] });
    const input: DecisionRequest = {
      submission_id: fixtureId(1), expected_review_revision: 1, human_verdict: "approved",
      human_note: "PRIVATE: independently verified with finance", correction_type: "decision_override",
      correction_payload_json: {}, request_id: crypto.randomUUID(),
    };
    await assert.rejects(client.decide({ ...input, applicant_reason: "x".repeat(1501) }), { code: "INVALID_BODY" });
    assert.deepEqual(await client.getReviews(), initial);
    const approved = await client.decide(input);
    assert.equal(approved.row.decision_source, "human");
    assert.equal(approved.message?.status, "draft");
    assert.equal(approved.message?.source_review_revision, 1);
    assert.equal(approved.message?.assessment_run_id, initial.submissions[0].latest_run_id);
    assert.equal(approved.message?.attempt_count, 0);
    assert.equal(approved.email_error, null);
    assert.ok(!JSON.stringify(approved.message).includes("PRIVATE"));
    approved.message!.body = "external mutation";
    const replay = await client.decide({ ...input });
    assert.equal(replay.correction_id, approved.correction_id);
    assert.notEqual(replay.message?.body, "external mutation");
    assert.equal((await client.getMessages!(input.submission_id)).messages.length, 1);
    assert.equal((await client.getReviews()).submissions[0].review_revision, 2);
    await assert.rejects(client.decide({ ...input, human_note: "Changed private note" }), { code: "MESSAGE_CONFLICT" });
    const pending = await client.getNotifications!();
    assert.equal(pending.mode, "preview");
    assert.deepEqual(pending.messages.map(message => message.id), [approved.message!.id]);
    assert.deepEqual(pending.history, [], "unconfirmed drafts stay out of email history");
    await assert.rejects(client.sendNotifications!({ snapshot_token: "stale", message_ids: [approved.message!.id], confirmed: true }), { code: "STALE_SNAPSHOT" });
    assert.equal((await client.getMessages!(input.submission_id)).messages[0].status, "draft");
    const generated = await client.sendNotifications!({ snapshot_token: pending.snapshot_token, message_ids: [approved.message!.id], confirmed: true });
    assert.equal(generated.processed, 1);
    assert.equal(generated.delivery_error, null);
    assert.equal(generated.messages[0].status, "previewed");
    const afterSend = await client.getNotifications!();
    assert.equal(afterSend.messages.length, 0);
    assert.equal(afterSend.history.length, 1);
    assert.equal(afterSend.history[0].status, "previewed");
    assert.equal(afterSend.history[0].recipient, generated.messages[0].recipient);
    assert.equal(afterSend.history[0].subject, generated.messages[0].subject);
    assert.equal(afterSend.history[0].rendered_text, generated.messages[0].rendered_text);
    assert.ok(afterSend.history[0].rendered_text?.includes(replay.message!.body));
    assert.ok(!JSON.stringify(afterSend.history).includes("PRIVATE"));
    afterSend.history[0].body = "external history mutation";
    await assert.rejects(client.sendNotifications!({ snapshot_token: pending.snapshot_token, message_ids: [approved.message!.id], confirmed: true }), { code: "STALE_SNAPSHOT" });

    const rejected = await client.decide({ ...input, submission_id: fixtureId(3), human_verdict: "rejected", request_id: crypto.randomUUID(), applicant_reason: "The supporting booking could not establish this expense." });
    assert.equal(rejected.message?.kind, "rejection");
    assert.match(rejected.message!.body, /supporting booking could not establish/);
    assert.ok(!JSON.stringify(rejected.message).includes("PRIVATE"));
    const uncertain = await client.decide({ ...input, submission_id: fixtureId(6), human_verdict: "rejected", request_id: crypto.randomUUID() });
    assert.equal(uncertain.row.decision_status, "rejected");
    assert.equal(uncertain.message, undefined);
    assert.match(uncertain.email_error!, /applicant-facing reason/);
    assert.deepEqual(await client.getMessages!(fixtureId(6)), { messages: [] });
    const failed = await client.decide({ ...input, submission_id: fixtureId(2), human_verdict: "rejected", request_id: crypto.randomUUID() });
    assert.match(failed.message!.body, /receipt shows/);
    const laterHistory = (await client.getNotifications!()).history;
    assert.deepEqual(laterHistory.map(message => message.id), [approved.message!.id]);
    assert.equal(laterHistory[0].body, replay.message!.body, "saved preview contents survive subsequent decisions and external mutation");
  } finally { globalThis.fetch = originalFetch; }
});

test("shared preview decisions publish row totals and notices across refresh and navigation", async () => {
  const { getWorkspaceStore } = await import("../client");
  const store = getWorkspaceStore("preview");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Preview must not make network requests"); };
  try {
    const initial = await store.client.getReviews();
    const claim = initial.submissions[0];
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().data!.summary.pending_review_count));
    try {
      const saved = await store.client.decide({ submission_id: claim.id, expected_review_revision: claim.review_revision, human_verdict: "approved", human_note: "Reviewed synthetic evidence", correction_type: "decision_override", correction_payload_json: {}, request_id: crypto.randomUUID() });
      assert.equal(saved.message?.status, "draft");
      assert.equal(seen.at(-1), initial.summary.pending_review_count - 1);
      assert.equal(store.getSnapshot().data!.summary.approved_amount_minor, initial.summary.approved_amount_minor + claim.amount_requested_minor);
      await Promise.all([store.refresh(), store.refresh()]);
      await store.client.reconcile({ submission_ids: [claim.id] });
      assert.equal(store.getSnapshot().data!.submissions[0].decision_status, "approved");
      assert(store.getSnapshot().data!.submissions[0].review_revision > saved.row.review_revision);
      const navigated = getWorkspaceStore("preview");
      assert.equal(navigated, store);
      assert.equal((await navigated.client.getReviews()).summary.pending_review_count, initial.summary.pending_review_count - 1);
      assert.equal((await navigated.client.getMessages!(claim.id)).messages[0].status, "draft");
      const pending = await navigated.client.getNotifications!();
      await navigated.client.sendNotifications!({ snapshot_token: pending.snapshot_token, message_ids: pending.messages.map(message => message.id), confirmed: true });
      await store.refresh();
      const history = (await getWorkspaceStore("preview").client.getNotifications!()).history;
      assert.equal(history[0].status, "previewed");
      assert.equal(history[0].rendered_text, saved.message!.rendered_text, "email contents persist across workspace refresh and navigation");
    } finally { unsubscribe(); }
  } finally { globalThis.fetch = originalFetch; }
});
