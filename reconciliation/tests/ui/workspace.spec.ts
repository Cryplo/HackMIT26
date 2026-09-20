import { expect, test, type Page } from "@playwright/test";
import { fixtureId, fixtureReviews, fixtureRules } from "../../src/lib/dashboard/fixtures";
import type { ReviewsResponse, RuleTestReport } from "../../src/lib/review-contracts";

test.use({ viewport: { width: 1440, height: 900 } });
async function originals(page: Page) {
  await page.route("**/api/receipts/*", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><text x="10" y="30">Synthetic original</text></svg>' }));
}
const queue = (page: Page) => page.getByRole("region", { name: "Reimbursement claims", exact: true });

test("missing capabilities make learning, retry, export and insights unavailable without endpoint calls", async ({ page }) => {
  const data = structuredClone(fixtureReviews); delete data.capabilities; delete data.coverage;
  let rulesCalls = 0;
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await page.route("**/api/rules", route => { rulesCalls++; return route.fulfill({ status: 503 }); });
  await originals(page);
  await page.goto("/business-demo");
  await expect(page.getByText("Insights unavailable — complete snapshot coverage is required.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export selected" })).toBeDisabled();
  await page.getByRole("button", { name: "Open Riley Park's claim" }).click();
  const sheet = page.getByRole("dialog", { name: "Riley Park", exact: true });
  await expect(sheet.getByText(/Same-claim extraction retry is unavailable/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Retry extraction" })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: /replacement/ })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: "Open original" })).toHaveAttribute("href", `/api/receipts/${fixtureId(206)}`);
  await sheet.getByRole("button", { name: "Close review" }).click();
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("button", { name: "Learned rules" }).click();
  await expect(page.getByText(/Merchant rule learning is unavailable on this backend/)).toBeVisible();
  expect(rulesCalls).toBe(0);
});

test("same-ID retry retains original, exposes actual provenance and requires an explicit recheck", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  const row = data.submissions[5]; row.receipt!.extraction_provenance = null;
  let retryBody: unknown; let rechecks = 0; let submissions = 0;
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await originals(page);
  await page.route(`**/api/submissions/${row.id}/retry-extraction`, route => {
    retryBody = route.request().postDataJSON();
    row.review_revision++;
    row.receipt!.extraction_status = "succeeded"; row.receipt!.extraction_error = null;
    row.receipt!.extraction_provenance = "Synthetic test fixture — no provider call";
    row.receipt!.parsed_fields_json = { schema_version: 1, vendor: "Synthetic Air", amount_minor: 23000, currency: "USD", names: [row.attendee_name], receipt_date: "2026-09-18", receipt_number: "SYN-006" };
    row.assessment_status = null; row.latest_run_id = null; row.decisions = []; row.assessment_knowledge_revision = null;
    return route.fulfill({ json: { row } });
  });
  await page.route("**/api/workspace/reconcile", route => { rechecks++; return route.fulfill({ json: { results: [] } }); });
  await page.route("**/api/submissions", route => { submissions++; return route.fulfill({ status: 503 }); });
  await page.goto(`/business-demo?claim=${row.id}`);
  const sheet = page.getByRole("dialog", { name: "Riley Park", exact: true });
  await expect(sheet.getByText(/Unknown — no receipt-specific provenance recorded/)).toBeVisible();
  const href = await sheet.getByRole("link", { name: "Open original" }).getAttribute("href");
  await sheet.getByRole("button", { name: "Retry extraction" }).click();
  await expect(sheet.getByRole("status")).toContainText("Recheck this claim to assess the new evidence");
  expect(retryBody).toEqual({ expected_review_revision: 1 });
  await expect(sheet.getByRole("link", { name: "Open original" })).toHaveAttribute("href", href!);
  await expect(sheet.getByText(`Claim ${row.id}`, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  expect(rechecks).toBe(0); expect(submissions).toBe(0);
  await sheet.getByRole("button", { name: "Recheck", exact: true }).click();
  expect(rechecks).toBe(1);
});

test("partial selected recheck keeps only failed claims selected and never retries during read refresh", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  const maya = data.submissions[0]; const jordan = data.submissions[1];
  const requests: unknown[] = []; let reads = 0;
  await page.route("**/api/workspace/reviews", route => { reads++; return route.fulfill({ json: data }); });
  await page.route("**/api/workspace/reconcile", route => {
    requests.push(route.request().postDataJSON());
    maya.review_revision++;
    return route.fulfill({ json: { results: [
      { submission_id: maya.id, run_id: maya.latest_run_id, assessment_status: maya.assessment_status, decision_status: maya.decision_status, review_revision: maya.review_revision },
      { submission_id: jordan.id, error: "Synthetic recheck failure" },
    ] } });
  });
  await page.goto("/business-demo");
  const mayaSelected = queue(page).getByRole("checkbox", { name: "Select Maya Chen", exact: true });
  const jordanSelected = queue(page).getByRole("checkbox", { name: "Select Jordan Lee", exact: true });
  await mayaSelected.check(); await jordanSelected.check();
  await page.getByRole("button", { name: "Recheck selected", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("1 completed; 1 failed or returned no result");
  await expect(mayaSelected).not.toBeChecked();
  await expect(jordanSelected).toBeChecked();
  await expect(page.getByRole("button", { name: "Recheck selected", exact: true })).toBeEnabled();
  expect(requests).toEqual([{ submission_ids: [maya.id, jordan.id] }]);
  const readsAfterRecheck = reads;
  await expect.poll(() => reads).toBeGreaterThan(readsAfterRecheck);
  await expect(mayaSelected).not.toBeChecked();
  await expect(jordanSelected).toBeChecked();
  expect(requests).toHaveLength(1);
});

test("submit saves exact cents and retains the original and saved claim after extraction failure", async ({ page }) => {
  let submissions = 0; let retries = 0; let amountMinor: string | undefined;
  await page.route("**/api/submissions", route => {
    submissions++;
    expect(route.request().method()).toBe("POST");
    amountMinor = route.request().postData()?.match(/name="amount_requested_minor"\r\n\r\n([^\r\n]*)\r\n/)?.[1];
    return route.fulfill({ status: 201, json: { submission_id: fixtureId(6), receipt_id: fixtureId(206), extraction_status: "failed" } });
  });
  await page.route("**/api/submissions/*/retry-extraction", route => { retries++; return route.fulfill({ status: 503 }); });
  await page.goto("/submit");
  await expect(page.getByText("Synthetic demo · simulated extraction.", { exact: true })).toBeVisible();
  await page.getByLabel("Attendee name", { exact: true }).fill("Riley Park");
  await page.getByLabel("Email address", { exact: true }).fill("riley@example.invalid");
  await page.getByLabel("Requested amount · USD", { exact: true }).fill("123.45");
  await page.getByLabel("Travel category", { exact: true }).selectOption("train");
  await page.getByLabel("Traveling from", { exact: true }).fill("New York, NY");
  await page.getByLabel("Attach one synthetic receipt", { exact: true }).setInputFiles({ name: "synthetic-receipt.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFukAAAAASUVORK5CYII=", "base64") });
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  const saved = page.getByRole("status");
  await expect(saved).toContainText("Claim saved. Review is pending.");
  await expect(saved).toContainText("We couldn’t extract the receipt.");
  await expect(saved).toContainText("the original is retained");
  await expect(saved.getByText(`Claim ${fixtureId(6)}`, { exact: true })).toBeVisible();
  await expect(saved.getByRole("link", { name: "View saved receipt ↗", exact: true })).toHaveAttribute("href", `/api/receipts/${fixtureId(206)}`);
  await expect(saved.getByRole("link", { name: "Open saved claim ↗", exact: true })).toHaveAttribute("href", `/business-demo?claim=${fixtureId(6)}`);
  expect(amountMinor).toBe("12345");
  expect(submissions).toBe(1); expect(retries).toBe(0);
});

test("confirmed duplicate opens the actual earlier claim and retained original with a way back", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  const later = data.submissions[4]; later.decision_status = "pending";
  later.duplicate_submission_ids.push(fixtureId(999));
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await originals(page);
  await page.goto("/business-demo");
  await page.getByRole("button", { name: "Compare claims: Alex Demo" }).click();
  let sheet = page.getByRole("dialog", { name: "Alex Demo", exact: true });
  await expect(sheet.getByText(/is not loaded in this snapshot/)).toBeVisible();
  await sheet.getByRole("button", { name: /Compare Maya Chen/ }).click();
  sheet = page.getByRole("dialog", { name: "Maya Chen", exact: true });
  await expect(sheet.getByText(`Claim ${data.submissions[0].id}`, { exact: true })).toBeVisible();
  await expect(sheet.getByText("Pending", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open original" })).toHaveAttribute("href", `/api/receipts/${fixtureId(201)}`);
  await sheet.getByRole("button", { name: "Back to Alex Demo" }).click();
  await expect(page.getByRole("dialog", { name: "Alex Demo", exact: true })).toBeVisible();
});

test("insight count and cents drill into exact IDs, recompute on refresh and clear before AI search", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  data.submissions[2].amount_requested_minor = 12300;
  data.submissions[2].receipt!.parsed_fields_json!.vendor = " SYN HBR042 ";
  data.submissions[3].decision_status = "pending";
  data.submissions[3].receipt!.parsed_fields_json!.vendor = "syn hbr042";
  let searches = 0; let request: unknown;
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await page.route("**/api/search", route => {
    searches++; request = route.request().postDataJSON();
    return route.fulfill({ json: { snapshot_token: data.snapshot_token, evaluated_count: 6, matches: [data.submissions[2]], possible_matches: [data.submissions[3]], mode: "simulated", model: null, latency_ms: 0 } });
  });
  await page.goto("/business-demo");
  await page.getByRole("button", { name: /otherwise checked.*\$271.00/ }).click();
  await expect(queue(page).locator("tbody tr")).toHaveCount(2);
  await expect(queue(page).getByRole("button", { name: "Open Sam Example's claim" })).toBeVisible();
  await expect(queue(page).getByRole("button", { name: "Open Taylor Example's claim" })).toBeVisible();
  data.submissions[3].amount_requested_minor = 15000; data.snapshot_token = "new-insight-snapshot";
  await expect(page.getByRole("button", { name: /otherwise checked.*\$273.00/ })).toBeVisible();
  await page.getByLabel("Search claims").fill("hotel receipts");
  expect(searches).toBe(0);
  await page.getByRole("button", { name: "AI search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Matches 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear insight" })).toHaveCount(0);
  expect(request).toEqual({ query: "hotel receipts", snapshot_token: "new-insight-snapshot", filters: {} });
});

test("semantic search is explicit, ignores delayed responses after filters change and opens current rows", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  let searches = 0; let reads = 0; let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/workspace/reviews", route => { reads++; return route.fulfill({ json: data }); });
  await originals(page);
  await page.route("**/api/search", async route => {
    searches++;
    if (searches === 1) await delayed;
    const staleRow = { ...data.submissions[2], attendee_name: "Stale search object" };
    await route.fulfill({ json: { snapshot_token: data.snapshot_token, evaluated_count: 4, matches: [staleRow], possible_matches: [data.submissions[0]], mode: "simulated", model: null, latency_ms: 0 } });
  });
  await page.goto("/business-demo");
  await page.getByLabel("Search claims").fill("hotel");
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  expect(searches).toBe(0);
  await page.getByRole("button", { name: "AI search", exact: true }).click();
  await expect.poll(() => searches).toBe(1);
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Hotel", exact: true }).click();
  release();
  await expect(page.getByRole("button", { name: "AI search", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: /^Matches/ })).toHaveCount(0);
  await page.getByRole("button", { name: "AI search", exact: true }).click();
  await expect(page.getByRole("region", { name: "Possible search matches" }).getByRole("checkbox", { name: "Select Maya Chen" })).not.toBeChecked();
  await page.getByRole("button", { name: "Open Sam Example's claim" }).click();
  await expect(page.getByRole("dialog", { name: "Sam Example", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  data.snapshot_token = "changed-search-snapshot";
  await expect(page.getByText("Results are stale. Claims or rules have changed since this search.")).toBeVisible();
  expect(searches).toBe(2);
  await page.getByRole("combobox", { name: "Assessment" }).click();
  await page.getByRole("option", { name: "Needs review", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Matches/ })).toHaveCount(0);
});

test("export downloads only explicit selection and captured token, revokes URL, and creates no file on conflict", async ({ page }) => {
  const data = structuredClone(fixtureReviews); data.capabilities!.export = true;
  const requests: unknown[] = []; let conflict = false; let downloads = 0;
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL;
    Object.assign(window, { revokedURLs: 0 });
    URL.revokeObjectURL = url => { (window as unknown as { revokedURLs: number }).revokedURLs++; original(url); };
  });
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await page.route("**/api/search", route => route.fulfill({ json: { snapshot_token: data.snapshot_token, evaluated_count: 6, matches: [data.submissions[0]], possible_matches: [data.submissions[2]], mode: "simulated", model: null, latency_ms: 0 } }));
  await page.route("**/api/workspace/export", route => {
    requests.push(route.request().postDataJSON());
    if (conflict) { data.snapshot_token = "fresh-export-snapshot"; return route.fulfill({ status: 409, json: { error: { code: "STALE_SNAPSHOT", message: "Refresh" } } }); }
    return route.fulfill({ contentType: "text/csv; charset=utf-8", headers: { "Content-Disposition": 'attachment; filename="sift-reviews.csv"' }, body: `claim_id\r\n${data.submissions[0].id}\r\n` });
  });
  page.on("download", () => { downloads++; });
  await page.goto("/business-demo");
  await page.getByLabel("Search claims").fill("claims");
  await page.getByRole("button", { name: "AI search", exact: true }).click();
  await page.getByRole("region", { name: "Search matches", exact: true }).getByRole("checkbox", { name: "Select all search matches" }).check();
  const originalToken = data.snapshot_token;
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected" }).click();
  expect((await downloaded).suggestedFilename()).toBe("sift-reviews.csv");
  expect(requests[0]).toEqual({ snapshot_token: originalToken, submission_ids: [fixtureId(1)] });
  await expect.poll(() => page.evaluate(() => (window as unknown as { revokedURLs: number }).revokedURLs)).toBe(1);
  conflict = true;
  await page.getByRole("button", { name: "Export selected" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("No file was created");
  await expect(page.getByText(/Results are stale/)).toBeVisible();
  expect(downloads).toBe(1); expect(requests).toHaveLength(2);
  await page.getByRole("checkbox", { name: "Select Sam Example", exact: true }).check();
  conflict = false;
  const nextDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected" }).click();
  await nextDownload;
  expect(requests[2]).toEqual({ snapshot_token: "fresh-export-snapshot", submission_ids: [fixtureId(1), fixtureId(3)] });
});

test("approved source proposes a trimmed merchant draft without another decision or recheck", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  const source = data.submissions[3];
  const rule = structuredClone(fixtureRules[0]);
  const proposals: unknown[] = []; let decisions = 0; let rechecks = 0;
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await originals(page);
  await page.route("**/api/rules", route => {
    if (route.request().method() === "POST") {
      proposals.push(route.request().postDataJSON());
      return route.fulfill({ json: { rule, knowledge_revision: data.knowledge_revision } });
    }
    return route.fulfill({ json: { rules: proposals.length ? [rule] : [], knowledge_revision: data.knowledge_revision } });
  });
  await page.route("**/api/workspace/decisions", route => { decisions++; return route.fulfill({ status: 503 }); });
  await page.route("**/api/workspace/reconcile", route => { rechecks++; return route.fulfill({ status: 503 }); });
  await page.goto(`/business-demo?claim=${source.id}`);
  const sheet = page.getByRole("dialog", { name: "Taylor Example", exact: true });
  const canonical = sheet.getByLabel("Canonical merchant name");
  await expect(canonical).toHaveAttribute("maxlength", "120");
  await canonical.fill("  Harbor Hotel  ");
  await sheet.getByRole("button", { name: "Create draft rule", exact: true }).click();
  const draft = page.getByRole("article", { name: "SYN HBR042 rule", exact: true });
  await expect(draft.getByText("draft", { exact: true })).toBeVisible();
  await expect(draft.getByText("Harbor Hotel", { exact: true })).toBeVisible();
  await expect(draft.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
  expect(proposals).toEqual([{ submission_id: source.id, expected_review_revision: source.review_revision, canonical_vendor: "Harbor Hotel" }]);
  expect(decisions).toBe(0); expect(rechecks).toBe(0);
});

test("real rule seam refetches after report and failed attempt; previous passing reports never restore activation", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  const rule = structuredClone(fixtureRules[0]); let failTest = false; let tests = 0; let gets = 0;
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await page.route("**/api/rules", route => { gets++; return route.fulfill({ json: { rules: [rule], knowledge_revision: 0 } }); });
  await page.route(`**/api/rules/${rule.id}/test`, route => {
    tests++; expect(route.request().postDataJSON()).toEqual({ expected_rule_version: rule.version }); rule.version++;
    if (failTest) { rule.latest_test = null; rule.latest_test_error = "Provider unavailable"; return route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE", message: "Provider unavailable" } } }); }
    const report: RuleTestReport = { rule_id: rule.id, rule_version: rule.version, knowledge_revision: 0, suite_version: "alias-v1", mode: "live", tested_at: "2026-09-20", passed: true, improved_case_ids: ["valid-1"], regressed_case_ids: [], reasons: ["Synthetic route mock, not provider verification"], before: { total: 10, correct: 8, false_matches: 0, needs_review: 4 }, after: { total: 10, correct: 10, false_matches: 0, needs_review: 2 } };
    rule.latest_test = report; return route.fulfill({ json: report });
  });
  await page.goto("/business-demo");
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("button", { name: "Learned rules" }).click();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeEnabled();
  expect(gets).toBeGreaterThan(1);
  failTest = true;
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(page.getByText(/Latest test failed: Provider unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("button", { name: "Learned rules" }).click();
  await expect(page.getByText(/Latest test failed: Provider unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
  expect(tests).toBe(2);
});

test("loading and empty states do not claim zero totals or invent a missing deep-linked claim", async ({ page }) => {
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  const data: ReviewsResponse = { ...structuredClone(fixtureReviews), submissions: [], coverage: { complete: true, returned: 0, total: 0 } };
  await page.route("**/api/workspace/reviews", async route => { await ready; await route.fulfill({ json: data }); });
  try {
    await page.goto(`/business-demo?claim=${fixtureId(999)}`);
    await expect(page.getByRole("tab", { name: /^Needs review\s*…$/ })).toBeVisible();
    await expect(page.getByText("0 claims", { exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByText("No claims yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "New claim", exact: true }).last()).toBeVisible();
  await expect(page.getByText(/is not loaded in this snapshot/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
