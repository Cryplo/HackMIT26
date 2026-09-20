import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getStore, LocalStore } from "./store";
import type { Claim, Receipt } from "./schema";
import { demoSnapshot } from "../core/fixtures";
import { FileStore } from "../core/file-store";

const bytes = new TextEncoder().encode("%PDF-1.4\nsynthetic storage safety receipt");
function fixture() {
  const source = demoSnapshot();
  const claim: Claim = { ...source.submissions[0], id: crypto.randomUUID(), status: "pending", latest_run_id: null };
  const receipt: Receipt = { ...source.receipts[0], id: crypto.randomUUID(), submission_id: claim.id, file_type: "application/pdf", extraction_status: "pending", raw_extracted_text: null, parsed_fields_json: null, extraction_error: null, extracted_at: null };
  receipt.storage_path = `synthetic/${claim.id}/${receipt.id}`;
  return { claim, receipt, fields: source.receipts[0].parsed_fields_json! };
}
function liveEnvironment(t: TestContext) {
  const values = { RECONCILIATION_SYNTHETIC_ONLY: "true", RECONCILIATION_INTAKE_MODE: "live", SUPABASE_URL: "https://storage.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key", SUPABASE_RECEIPTS_BUCKET: "receipts" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("uncertain submission or receipt inserts retain originals and never issue compensating deletes", async t => {
  liveEnvironment(t);
  for (const failedTable of ["submissions", "receipts"]) {
    const { claim, receipt } = fixture();
    const requests: string[] = [];
    let originalRetained = false;
    const mock = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init), pathname = new URL(request.url).pathname;
      requests.push(`${request.method} ${pathname}`);
      if (pathname === "/rest/v1/rpc/core_platform_version") return Response.json(4);
      if (request.method === "DELETE") { originalRetained = false; return Response.json({}); }
      if (pathname === "/storage/v1/bucket/receipts") return Response.json({ id: "receipts", public: false });
      if (pathname === `/storage/v1/object/receipts/${receipt.storage_path}`) {
        assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
        originalRetained = true;
        return Response.json({ Key: `receipts/${receipt.storage_path}` });
      }
      if (pathname === `/rest/v1/${failedTable}`) return Response.json({ message: "Commit status unknown." }, { status: 503 });
      assert.equal(pathname, "/rest/v1/submissions");
      return new Response(null, { status: 201 });
    });
    try {
      await assert.rejects(getStore().create(claim, receipt, bytes), { code: "storage_unavailable", status: 503 });
      assert.equal(originalRetained, true);
      assert.deepEqual(requests, ["POST /rest/v1/rpc/core_platform_version", "GET /storage/v1/bucket/receipts", `POST /storage/v1/object/receipts/${receipt.storage_path}`, "POST /rest/v1/submissions", ...(failedTable === "receipts" ? ["POST /rest/v1/receipts"] : [])]);
    } finally { mock.mock.restore(); }
  }
});

test("live initial completion uses the atomic RPC and exposes persistence failure", async t => {
  liveEnvironment(t);
  const { receipt, fields } = fixture();
  const completed: Receipt = { ...receipt, extraction_status: "succeeded", parsed_fields_json: fields, extracted_at: "2026-09-20T01:00:00.000Z" };
  const requests: string[] = [];
  let fail = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    if (new URL(request.url).pathname === "/rest/v1/rpc/core_platform_version") return Response.json(4);
    assert.deepEqual(await request.json(), { p_receipt: completed });
    return fail ? Response.json({ message: "Completion unavailable." }, { status: 503 }) : new Response(null, { status: 204 });
  });
  const store = getStore();
  await store.finish(completed);
  fail = true;
  await assert.rejects(store.finish(completed), { code: "storage_unavailable", status: 503 });
  assert.deepEqual(requests, Array(2).fill(["POST /rest/v1/rpc/core_platform_version", "POST /rest/v1/rpc/core_finish_initial_extraction"]).flat());
});

test("live intake refuses an old schema before uploading or writing metadata", async t => {
  liveEnvironment(t);
  const { claim, receipt } = fixture();
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init), pathname = new URL(request.url).pathname;
    paths.push(pathname);
    assert.equal(pathname, "/rest/v1/rpc/core_platform_version");
    return Response.json({ code: "PGRST202", message: "Function not found" }, { status: 404 });
  });
  const store = getStore();
  await assert.rejects(store.create(claim, receipt, bytes), { code: "schema_mismatch", status: 503 });
  await assert.rejects(store.finish(receipt), { code: "schema_mismatch", status: 503 });
  assert.equal(paths.length, 2);
});

test("live original reads distinguish missing objects from bucket, auth, and transient failures", async t => {
  liveEnvironment(t);
  const { receipt } = fixture();
  let failure = { status: 404, body: { code: "NoSuchKey", message: "Missing object" } as Record<string, string> };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init), pathname = new URL(request.url).pathname;
    if (pathname === "/rest/v1/receipts") return Response.json(receipt);
    assert.equal(pathname, `/storage/v1/object/receipts/${receipt.storage_path}`);
    return Response.json(failure.body, { status: failure.status });
  });
  const store = getStore();
  assert.equal(await store.read(receipt.id), null);
  failure = { status: 400, body: { statusCode: "404", error: "not_found", message: "Object not found" } };
  assert.equal(await store.read(receipt.id), null);
  for (const [status, code] of [[404, "NoSuchBucket"], [403, "AccessDenied"], [500, "InternalError"]] as const) {
    failure = { status, body: { code, message: code } };
    await assert.rejects(store.read(receipt.id), { code: "storage_unavailable", status: 503 });
  }
});

test("late initial extraction cannot overwrite an active or completed core retry", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "intake-storage-safety-"));
  try {
    const { claim, receipt, fields } = fixture();
    const local = new LocalStore(dir), core = new FileStore(dir);
    await local.create(claim, receipt, bytes);
    const initial = await core.snapshot();
    const lease = await core.beginExtraction(claim.id, initial.submissions.find(s => s.id === claim.id)!.review_revision!);
    const late: Receipt = { ...receipt, extraction_status: "succeeded", parsed_fields_json: { ...fields, vendor: "Late initial extraction" }, extracted_at: "2099-01-01T00:00:00.000Z" };
    const running = await core.snapshot();
    await assert.rejects(local.finish(late), { code: "STALE_REVIEW", status: 409 });
    assert.deepEqual(await core.snapshot(), running);
    const retry: Receipt = { ...receipt, extraction_status: "succeeded", parsed_fields_json: { ...fields, vendor: "Completed retry" }, extracted_at: "2026-09-20T01:00:00.000Z" };
    await core.finishExtraction(lease, retry);
    const completed = await core.snapshot(), original = await local.read(receipt.id);
    await assert.rejects(local.finish(late), { code: "STALE_REVIEW", status: 409 });
    assert.deepEqual(await core.snapshot(), completed);
    assert.deepEqual(await local.read(receipt.id), original);
    assert.deepEqual(original!.bytes, bytes);
    assert.equal(completed.receipts.find(r => r.id === receipt.id)!.parsed_fields_json!.vendor, "Completed retry");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
