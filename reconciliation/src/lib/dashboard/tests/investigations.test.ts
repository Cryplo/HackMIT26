import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardClient } from "../client";
import { fixtureId, fixtureReviews } from "../fixtures";
import { DashboardError } from "../helpers";
import { investigationFailure } from "../review";

const code = (expected: string) => (error: unknown) => error instanceof DashboardError && error.code === expected;
const approve = (id: string, revision: number, human_verdict: "approved" | "rejected" = "approved") => ({
  submission_id: id, expected_review_revision: revision, human_verdict, human_note: "Reviewed the explicit simulated receipt and booking confirmation.",
  correction_type: "decision_override" as const, correction_payload_json: {},
});

test("new API reads are abortable, URLs encoded, writes use frozen revision fields, and upload stays multipart", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return Response.json(String(url) === "/api/workspace/reviews" ? fixtureReviews : { ok: true }); };
    const client = createDashboardClient("api");
    const signal = new AbortController().signal;
    await client.getSupportingDocuments("claim/a", signal);
    await client.getInvestigations("claim/a", signal);
    await client.getInvestigations(undefined, signal);
    await client.getInvestigation("run/a", signal);
    await client.getProcedures(signal);
    assert.deepEqual(calls.map(call => call.url), ["/api/submissions/claim%2Fa/supporting-documents", "/api/investigations?claim_id=claim%2Fa", "/api/investigations", "/api/investigations/run%2Fa", "/api/procedures"]);
    for (const { init } of calls) { assert.equal(init.signal, signal); assert.equal(init.method, "GET"); assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin"); }
    calls.length = 0;
    const file = new File(["%PDF-synthetic"], "booking.pdf", { type: "application/pdf" });
    await client.uploadSupportingDocument("claim/a", file, "booking_confirmation", 17);
    const upload = calls.find(call => call.init.method === "POST")!;
    assert.equal(upload.url, "/api/submissions/claim%2Fa/supporting-documents");
    assert.equal(upload.init.method, "POST");
    assert.equal(upload.init.headers, undefined);
    assert.ok(upload.init.body instanceof FormData);
    assert.equal(upload.init.body.get("file"), file);
    assert.equal(upload.init.body.get("kind"), "booking_confirmation");
    assert.equal(upload.init.body.get("expected_review_revision"), "17");
    assert.equal(client.supportingDocumentUrl("claim/a", "doc/b"), "/api/submissions/claim%2Fa/supporting-documents/doc%2Fb");
    calls.length = 0;
    await client.investigate("claim/a", 17);
    await client.proposeProcedure("run/a", 18);
    await client.testProcedure("procedure/a", 2);
    await client.activateProcedure("procedure/a", 3);
    await client.disableProcedure("procedure/a", 4);
    assert.deepEqual(calls.filter(call => call.init.method === "POST").map(call => [call.url, JSON.parse(String(call.init.body))]), [
      ["/api/submissions/claim%2Fa/investigate", { expected_review_revision: 17 }],
      ["/api/procedures", { run_id: "run/a", expected_review_revision: 18 }],
      ["/api/procedures/procedure%2Fa/test", { expected_procedure_version: 2 }],
      ["/api/procedures/procedure%2Fa/activate", { expected_procedure_version: 3 }],
      ["/api/procedures/procedure%2Fa/disable", { expected_procedure_version: 4 }],
    ]);
  } finally { globalThis.fetch = original; }
});

test("API failures remain errors without retries or preview fallback; failed runs remain failed envelopes", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    const client = createDashboardClient("api");
    globalThis.fetch = async (_url, init) => { if (init?.method === "POST") calls++; return Response.json({ error: { code: "STALE_REVIEW", message: "Review changed." } }, { status: 409 }); };
    await assert.rejects(client.uploadSupportingDocument("claim", new File(["%PDF-test"], "test.pdf"), "other", 1), error => error instanceof DashboardError && error.code === "STALE_REVIEW" && error.status === 409 && error.message === "Review changed.");
    assert.equal(calls, 1);
    globalThis.fetch = async (_url, init) => { if (init?.method === "POST") calls++; throw new TypeError("Network interrupted"); };
    await assert.rejects(client.investigate("claim", 1), /Network interrupted/);
    assert.equal(calls, 2);
    const failed = { run: { status: "failed", outcome: null, after_assessment: null, error: "Provider unavailable" }, row: { decision_status: "pending" } };
    globalThis.fetch = async () => Response.json(failed);
    assert.deepEqual(await client.investigate("claim", 1), failed);
    globalThis.fetch = async () => new Response("not JSON");
    await assert.rejects(client.getProcedures(), code("INVALID_RESPONSE"));
  } finally { globalThis.fetch = original; }
});

test("saved fixture outcomes remain stable, abortable and explicitly simulated", async () => {
  const client = createDashboardClient("preview");
  const saved = await client.getInvestigations();
  assert.equal(saved.coverage.total, 5);
  assert.deepEqual(new Set(saved.runs.map(run => run.outcome)), new Set(["resolved", "discrepancy_found", "needs_human", null]));
  for (const run of saved.runs) {
    assert.equal(run.mode, "simulated");
    assert.match(run.headline, /Simulated/);
    if (run.status !== "completed") { assert.equal(run.outcome, null); assert.equal(run.after_assessment, null); }
    assert.deepEqual((await client.getInvestigation(run.run_id)).run, run);
  }
  assert.deepEqual(await client.getInvestigations(), saved);
  assert.equal((await client.getInvestigations(fixtureId(3))).runs.length, 1);
  await assert.rejects(client.getInvestigations(undefined, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(client.supportingDocumentUrl(fixtureId(3), "missing"), null);
});

test("simulated procedure needs investigation, human approval, fresh test, activation, and its own later evidence", async () => {
  const client = createDashboardClient("preview"), sourceId = fixtureId(3);
  const original = (await client.getReviews()).submissions[2];
  const originalUrl = client.receiptUrl(original)!;
  assert.match(originalUrl, /^blob:/);
  assert.equal(client.receiptUrl(original), originalUrl);
  const originalResponse = await fetch(originalUrl);
  assert.equal(originalResponse.headers.get("content-type"), "image/svg+xml");
  const originalSvg = await originalResponse.text();
  assert.match(originalSvg, /Booking reference: SYN-BOOK-003/);
  assert.match(originalSvg, /Hotel receipt/);
  const result = await client.investigate(sourceId, original.review_revision);
  assert.equal(result.run.outcome, "resolved");
  assert.equal(result.row.assessment_status, "matched");
  assert.equal(result.row.decision_status, "pending");
  assert.ok(result.run.proposed_learning);
  assert.deepEqual(result.run.steps.map(step => step.sequence), [1, 2]);
  await assert.rejects(client.proposeProcedure(result.run.run_id, result.row.review_revision), code("RULE_INELIGIBLE"));
  const approved = await client.decide(approve(sourceId, result.row.review_revision));
  await assert.rejects(client.proposeProcedure(result.run.run_id, result.row.review_revision), code("STALE_REVIEW"));
  const draft = (await client.proposeProcedure(result.run.run_id, approved.row.review_revision)).procedure;
  await assert.rejects(client.activateProcedure(draft.id, draft.version), code("TEST_REQUIRED"));
  const report = await client.testProcedure(draft.id, draft.version);
  assert.equal(report.mode, "simulated"); assert.equal(report.suite_version, "booking-reference-v1");
  assert.equal(report.procedure_version, draft.version, "testing preserves the draft version");
  await assert.rejects(client.activateProcedure(draft.id, draft.version + 1), code("STALE_RULE"));
  const alias = (await client.getRules()).rules[0];
  const aliasReport = await client.testRule(alias.id, { expected_rule_version: alias.version });
  const activeAlias = await client.activateRule(alias.id, { expected_rule_version: aliasReport.rule_version });
  await client.disableRule(alias.id, { expected_rule_version: activeAlias.rule.version });
  await assert.rejects(client.activateProcedure(draft.id, report.procedure_version), code("STALE_RULE_TEST"));
  const fresh = await client.testProcedure(draft.id, report.procedure_version);
  const active = await client.activateProcedure(draft.id, fresh.procedure_version);
  const before = (await client.getReviews()).submissions[3];
  await client.reconcile({ submission_ids: [fixtureId(4), fixtureId(2), fixtureId(5)] });
  const rows = (await client.getReviews()).submissions;
  assert.equal(rows[3].assessment_status, "matched");
  assert.equal(rows[3].decision_status, before.decision_status);
  assert.deepEqual(rows[3].decisions.find(check => check.field_checked === "merchant")?.evidence_json.procedure_ids, [draft.id]);
  assert.equal(rows[1].assessment_status, "flagged"); assert.equal(rows[4].assessment_status, "flagged");
  assert.equal((await client.getInvestigations(fixtureId(4))).runs.length, 1, "procedure reuse creates no fictional tool run");
  await client.decide(approve(sourceId, approved.row.review_revision, "rejected"));
  const disabled = (await client.getProcedures()).procedures[0];
  assert.equal(disabled.state, "disabled"); assert.equal(disabled.latest_test, null);
  await assert.rejects(client.activateProcedure(disabled.id, active.procedure.version), code("STALE_RULE"));
});

test("preview uploads retain original bytes and invalidate evidence without manufacturing facts", async () => {
  const client = createDashboardClient("preview"), sourceId = fixtureId(3);
  const run = await client.investigate(sourceId, 1);
  const file = new File(["%PDF-unparsed supporting evidence"], "booking.pdf", { type: "application/pdf" });
  const upload = await client.uploadSupportingDocument(sourceId, file, "booking_confirmation", run.row.review_revision);
  assert.equal(upload.document.extraction_status, "failed"); assert.equal(upload.document.facts, null);
  assert.equal(upload.row.assessment_status, null);
  assert.ok(client.supportingDocumentUrl(sourceId, upload.document.id)?.startsWith("blob:"));
  assert.equal((await client.getSupportingDocuments(sourceId)).documents.length, 2);
  await assert.rejects(client.uploadSupportingDocument(sourceId, file, "other", run.row.review_revision), code("STALE_REVIEW"));
  await assert.rejects(client.uploadSupportingDocument(sourceId, file, "other", upload.row.review_revision), code("DOCUMENT_EXISTS"));
  await assert.rejects(client.proposeProcedure(run.run.run_id, upload.row.review_revision), code("STALE_RUN"));
  await client.reconcile({ submission_ids: [sourceId] });
  const current = (await client.getReviews()).submissions[2];
  const unresolved = await client.investigate(sourceId, current.review_revision);
  assert.equal(unresolved.run.outcome, "needs_human"); assert.equal(unresolved.run.proposed_learning, null);
  assert.equal(unresolved.row.decision_status, "pending");
  await assert.rejects(client.uploadSupportingDocument(fixtureId(4), file, "other", 1), code("EVIDENCE_BLOCKED"));
});

test("known mandatory failures prevent investigation while unresolved evidence remains eligible", async () => {
  const client = createDashboardClient("preview");
  const rows = (await client.getReviews()).submissions;
  for (const id of [fixtureId(2), fixtureId(5)]) {
    const row = rows.find(row => row.id === id)!;
    assert.match(investigationFailure(row)!, /failed.*recheck/);
    await assert.rejects(client.investigate(id, row.review_revision), code(row.decision_status === "pending" ? "INVESTIGATION_NOT_NEEDED" : "INVESTIGATION_BLOCKED"));
  }
  assert.equal(investigationFailure(rows.find(row => row.id === fixtureId(3))!), null);
});
