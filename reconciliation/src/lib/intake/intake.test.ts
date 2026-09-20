import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Fields, Submission, detectType, MAX_BODY_BYTES } from "./schema";
import { parseUpload } from "./http";
import { extractReceipt } from "./extract";
import { LocalStore } from "./store";
import { submitReceipt } from "./service";
const fields = {
  schema_version: 1,
  vendor: null,
  receipt_date: null,
  amount_minor: null,
  currency: null,
  names: [],
  receipt_number: null,
};
const input = Submission.parse({
  attendee_name: "Alex Demo",
  email: "alex@example.com",
  amount_requested_minor: "12345",
  currency: "USD",
  category: "train",
  origin_location: "New York",
});
const pdf = new TextEncoder().encode("%PDF-1.4\nsynthetic");
function request(extra = false, origin = "http://localhost") {
  const form = new FormData();
  for (const [k, v] of Object.entries(input)) form.set(k, String(v));
  form.append("file", new File([pdf], "demo.pdf", { type: "application/pdf" }));
  if (extra)
    form.append(
      "file",
      new File([pdf], "two.pdf", { type: "application/pdf" }),
    );
  return new Request("http://localhost/api/submissions", {
    method: "POST",
    headers: { origin },
    body: form,
  });
}
test("unknown values remain null; reject invalid dates, fractional minor units and extra fields", () => {
  assert.deepEqual(Fields.parse(fields), fields);
  for (const invalid of [
    { receipt_date: "2026-02-30" },
    { amount_minor: 1.2 },
    { extra: 1 },
  ])
    assert.equal(Fields.safeParse({ ...fields, ...invalid }).success, false);
});
test("multipart validation, exact one receipt and same origin", async () => {
  delete process.env.RECONCILIATION_APP_ORIGIN;
  const data = await parseUpload(request());
  assert.equal(data.input.amount_requested_minor, 12345);
  assert.equal(data.fileType, "application/pdf");
  await assert.rejects(parseUpload(request(true)));
  await assert.rejects(parseUpload(request(false, "https://evil.example")));
});
test("bounded request body and sniffed upload types", async () => {
  assert.throws(() => detectType(pdf, "image/png"));
  assert.throws(() => detectType(new Uint8Array([1, 2, 3]), "application/pdf"));
  assert.equal(
    detectType(new Uint8Array([255, 216, 255, 0]), "image/jpeg"),
    "image/jpeg",
  );
  assert.equal(
    detectType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"),
    "image/png",
  );
  await assert.rejects(
    parseUpload(
      new Request("http://localhost/api/submissions", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "multipart/form-data; boundary=x",
        },
        body: new Uint8Array(MAX_BODY_BYTES + 1),
      }),
    ),
  );
});
test("failure persists claim, receipt and bytes across store instances", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "intake-"));
  try {
    const store = new LocalStore(dir);
    const result = await submitReceipt(
      input,
      pdf,
      "application/pdf",
      store,
      async () => ({
        fields: null,
        raw: null,
        error: "Provider unavailable",
        usage: null,
      }),
    );
    assert.equal(result.extraction_status, "failed");
    const saved = await new LocalStore(dir).read(result.receipt_id);
    assert.equal(saved?.receipt.extraction_error, "Provider unavailable");
    assert.deepEqual(saved?.bytes, pdf);
    const claim = JSON.parse(
      await readFile(
        path.join(dir, `${result.submission_id}.submission.json`),
        "utf8",
      ),
    );
    assert.equal(claim.status, "pending");
    assert.equal(claim.latest_run_id, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("live storage retries database timeouts and treats its own landed write as done", async () => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  process.env.RECONCILIATION_SYNTHETIC_ONLY = "true";
  process.env.RECONCILIATION_INTAKE_MODE = "live";
  process.env.SUPABASE_URL = "https://synthetic.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
  const seen: string[] = [];
  const timeout = () =>
    Response.json(
      { message: "The connection to the database timed out" },
      { status: 544 },
    );
  try {
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      const call = `${String(init?.method || "GET")} ${new URL(target).pathname}`;
      seen.push(call);
      const attempts = seen.filter((entry) => entry === call).length;
      if (target.includes("/rpc/core_platform_version")) return Response.json(3);
      if (target.includes("/storage/v1/bucket/"))
        return Response.json({ id: "receipts", public: false });
      if (target.includes("/storage/v1/object/"))
        return attempts === 1 ? timeout() : Response.json({ Key: "ok" });
      if (target.includes("/rest/v1/submissions"))
        return attempts === 1 ? timeout() : Response.json([]);
      // The retried receipt insert reports the first attempt's row as a conflict.
      if (target.includes("/rest/v1/receipts"))
        return attempts === 1
          ? timeout()
          : Response.json(
              { code: "23505", message: "duplicate key" },
              { status: 409 },
            );
      return Response.json([]);
    };
    const { getStore } = await import("./store");
    const result = await submitReceipt(
      input,
      pdf,
      "application/pdf",
      getStore(),
      async () => ({ fields: null, raw: null, error: "skip", usage: null }),
    );
    assert.equal(result.extraction_status, "failed");
    assert.equal(
      seen.filter((call) => call.includes("/rest/v1/receipts")).length >= 2,
      true,
    );
    assert.equal(
      seen.some((call) => call.startsWith("DELETE")),
      false,
    );
  } finally {
    globalThis.fetch = original;
    process.env = env;
  }
});
test("successful extraction logs exact usage once and PDF is passed inline", async () => {
  process.env.OPENAI_API_KEY = "fake-test-only";
  let calls = 0;
  const transport = (async (_url: unknown, options: RequestInit) => {
    calls++;
    const body = JSON.parse(String(options.body));
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content[1].type, "input_file");
    assert.equal(body.store, false);
    return Response.json({
      status: "completed",
      model: "actual-model",
      usage: { input_tokens: 101, output_tokens: 23 },
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                raw_extracted_text: "Synthetic",
                parsed_fields_json: fields,
              }),
            },
          ],
        },
      ],
    });
  }) as typeof fetch;
  const dir = await mkdtemp(path.join(os.tmpdir(), "intake-"));
  try {
    const result = await submitReceipt(
      input,
      pdf,
      "application/pdf",
      new LocalStore(dir),
      (id) => extractReceipt(pdf, "application/pdf", id, "live", transport),
    );
    assert.equal(result.extraction_status, "succeeded");
    assert.equal(calls, 1);
    const logs = (await readdir(dir)).filter((f) => f.endsWith("usage.json"));
    assert.equal(logs.length, 1);
    const usage = JSON.parse(await readFile(path.join(dir, logs[0]), "utf8"));
    assert.equal(usage.input_tokens, 101);
    assert.equal(usage.output_tokens, 23);
    assert.equal(usage.model, "actual-model");
    assert.equal(usage.estimated_cost_usd, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.OPENAI_API_KEY;
  }
});
test("invalid model fields fail and preserve usage; image request format is correct", async () => {
  process.env.OPENAI_API_KEY = "fake-test-only";
  try {
    const result = await extractReceipt(pdf, "image/png", "id", "live", (async (
      _url: unknown,
      options: RequestInit,
    ) => {
      assert.equal(
        JSON.parse(String(options.body)).input[0].content[1].type,
        "input_image",
      );
      return Response.json({
        status: "completed",
        usage: { input_tokens: 6, output_tokens: 2 },
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  raw_extracted_text: "text",
                  parsed_fields_json: { ...fields, amount_minor: 1.1 },
                }),
              },
            ],
          },
        ],
      });
    }) as typeof fetch);
    assert.equal(result.fields, null);
    assert.ok(result.error);
    assert.equal(result.usage?.input_tokens, 6);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});
test("simulated extraction has no invented usage or receipt values", async () => {
  const result = await extractReceipt(pdf, "application/pdf", "id", "demo");
  assert.equal(result.usage, null);
  assert.match(result.raw!, /SIMULATED/);
  assert.deepEqual(result.fields, fields);
});
test("refusal, incomplete, HTTP failure, and network failure retain call records", async () => {
  process.env.OPENAI_API_KEY = "fake-test-only";
  try {
    for (const transport of [
      async () =>
        Response.json({
          status: "completed",
          usage: { input_tokens: 7, output_tokens: 1 },
          output: [{ content: [{ type: "refusal" }] }],
        }),
      async () =>
        Response.json({
          status: "incomplete",
          usage: { input_tokens: 7, output_tokens: 1 },
        }),
      async () => new Response("unavailable", { status: 503 }),
      async () => {
        throw new Error("network");
      },
    ]) {
      const result = await extractReceipt(
        pdf,
        "application/pdf",
        "id",
        "live",
        transport as typeof fetch,
      );
      assert.ok(result.error);
      assert.equal(result.fields, null);
      assert.ok(result.usage);
      assert.equal(result.usage.estimated_cost_usd, null);
    }
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});
test("missing credentials fail explicitly without pretending a provider call occurred", async () => {
  delete process.env.OPENAI_API_KEY;
  const result = await extractReceipt(pdf, "application/pdf", "id", "live");
  assert.ok(result.error);
  assert.equal(result.usage, null);
});
test("usage persistence failure marks extraction failed instead of approving partial evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "intake-"));
  try {
    const store = new LocalStore(dir);
    store.usage = async () => {
      throw new Error("database unavailable");
    };
    const result = await submitReceipt(
      input,
      pdf,
      "application/pdf",
      store,
      async (id) => ({
        fields: Fields.parse(fields),
        raw: "text",
        error: null,
        usage: {
          id: "test",
          receipt_id: id,
          run_id: null,
          provider: "openai",
          model: "test",
          input_tokens: 1,
          output_tokens: 1,
          latency_ms: 1,
          estimated_cost_usd: null,
          created_at: new Date().toISOString(),
        },
      }),
    );
    assert.equal(result.extraction_status, "failed");
    assert.equal(
      (await store.read(result.receipt_id))?.receipt.parsed_fields_json,
      null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
