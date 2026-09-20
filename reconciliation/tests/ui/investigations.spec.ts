import { expect, test, type Page } from "@playwright/test";
import { createDashboardClient } from "../../src/lib/dashboard/client";
import { fixtureCheck, fixtureId, fixtureRules } from "../../src/lib/dashboard/fixtures";
import type { InvestigationRun, ProcedureTestReport, ResolutionProcedure } from "../../src/lib/dashboard/types";

test.use({ viewport: { width: 1440, height: 1000 } });
const sam = fixtureId(3);
const sheet = (page: Page) => page.getByRole("dialog", { name: "Sam Example", exact: true });
const details = (page: Page) => page.getByRole("region", { name: "Investigation details", exact: true });
const deferred = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

async function fixtureState(resolved = false) {
  const client = createDashboardClient("preview");
  if (resolved) await client.investigate(sam, 1);
  const reviews = await client.getReviews();
  const documents = (await Promise.all(reviews.submissions.map(row => client.getSupportingDocuments(row.id)))).flatMap(result => result.documents);
  return { reviews, documents, runs: (await client.getInvestigations()).runs, procedures: [] as ResolutionProcedure[], requests: [] as { method: string; path: string; query: string }[] };
}
type FixtureState = Awaited<ReturnType<typeof fixtureState>>;

/** Every API request stays inside explicit synthetic mocks, including unexpected writes. */
async function mockApi(page: Page, state: FixtureState) {
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    state.requests.push({ method: request.method(), path: url.pathname, query: url.search });
    if (request.method() !== "GET") return route.fulfill({ status: 503, json: { error: { code: "TEST_UNEXPECTED_WRITE", message: "This synthetic test did not authorize that endpoint." } } });
    if (url.pathname === "/api/workspace/reviews") return route.fulfill({ json: state.reviews });
    if (url.pathname === "/api/rules") return route.fulfill({ json: { rules: fixtureRules, knowledge_revision: state.reviews.knowledge_revision } });
    if (url.pathname === "/api/procedures") return route.fulfill({ json: { procedures: state.procedures, knowledge_revision: state.reviews.knowledge_revision } });
    if (url.pathname === "/api/investigations") {
      const claim = url.searchParams.get("claim_id"), runs = state.runs.filter(run => !claim || run.claim_id === claim);
      return route.fulfill({ json: { runs, coverage: { complete: true, returned: runs.length, total: runs.length } } });
    }
    if (url.pathname.startsWith("/api/investigations/")) {
      const run = state.runs.find(item => item.run_id === url.pathname.split("/").at(-1));
      return route.fulfill({ status: run ? 200 : 404, json: run ? { run } : { error: { code: "NOT_FOUND", message: "Saved run missing." } } });
    }
    const supporting = url.pathname.match(/^\/api\/submissions\/([^/]+)\/supporting-documents(\/[^/]+)?$/);
    if (supporting && !supporting[2]) return route.fulfill({ json: { documents: state.documents.filter(document => document.claim_id === supporting[1]) } });
    if (supporting?.[2] || url.pathname.startsWith("/api/receipts/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="20" y="40">SYNTHETIC TEST ORIGINAL</text></svg>' });
    return route.fulfill({ status: 404, json: { error: { code: "TEST_UNMOCKED", message: "No synthetic read fixture." } } });
  });
}

test("missing new capabilities never call document, investigation, or procedure endpoints", async ({ page }) => {
  const state = await fixtureState();
  delete state.reviews.capabilities!.supporting_documents;
  delete state.reviews.capabilities!.investigations;
  delete state.reviews.capabilities!.resolution_procedures;
  await mockApi(page, state);
  await page.goto(`/business-demo?claim=${sam}`);
  await expect(sheet(page).getByText("Supporting documents are unavailable on this backend.", { exact: true })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Investigate", exact: true })).toBeDisabled();
  await expect(sheet(page).getByText(/Procedure learning is unavailable on this backend/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close review" }).click();
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Investigations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Investigations unavailable", exact: true })).toBeVisible();
  expect(state.requests.filter(request => /supporting-documents|investigations|procedures/.test(request.path))).toEqual([]);
});

test("known mandatory failures disable investigation with the current reason", async ({ page }) => {
  const state = await fixtureState();
  await mockApi(page, state);
  await page.goto(`/business-demo?claim=${fixtureId(2)}`);
  const review = page.getByRole("dialog", { name: "Jordan Lee", exact: true });
  await expect(review.getByRole("button", { name: "Investigate", exact: true })).toBeDisabled();
  await expect(review.getByText("Amount failed. Resolve the known discrepancy and recheck before investigating.", { exact: true })).toBeVisible();
  await expect(review.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  expect(state.requests.filter(request => request.method === "POST")).toEqual([]);
});

test("failed saved investigations keep evidence actionable and diagnostics collapsed", async ({ page }) => {
  const state = await fixtureState(), source = state.reviews.submissions.find(row => row.id === sam)!;
  const failed: InvestigationRun = { ...source.latest_investigation!, run_id: fixtureId(9510), status: "failed", outcome: null,
    headline: "Synthetic saved failed investigation", summary: "Provider did not complete the investigation.",
    started_at: "2026-09-20T15:00:00.000Z", completed_at: "2026-09-20T15:00:01.000Z", after_assessment: null,
    proposed_learning: null, unresolved_question: null, findings: [], error: "INVALID_PROVIDER_OUTPUT:VALIDATION:UNOBSERVED_CITATION" };
  source.latest_investigation = failed; source.processing_status = "failed"; source.processing_error = failed.error;
  state.runs = [failed, ...state.runs.filter(run => run.claim_id !== sam)];
  await mockApi(page, state);
  await page.goto(`/investigations?run=${failed.run_id}`);
  await expect(details(page).getByRole("heading", { name: "Needs review", exact: true })).toBeVisible();
  await expect(details(page).getByText("Automatic investigation could not finish. Review the saved evidence.", { exact: true })).toBeVisible();
  const technical = details(page).locator("details").filter({ has: page.locator("summary", { hasText: "Technical details" }) });
  await expect(technical).not.toHaveAttribute("open");
  await technical.locator("summary").click();
  await expect(technical).toContainText("Investigation failed.");
  await expect(technical).toContainText("The investigator cited evidence it had not read.");
  await expect(technical).toContainText(failed.error!);
  const history = details(page).locator("details").filter({ has: page.locator("summary", { hasText: "How this was checked" }) });
  await expect(history).not.toHaveAttribute("open");
  await expect(details(page).getByRole("button", { name: "Open claim", exact: true })).toBeVisible();
  await expect(details(page).getByRole("heading", { name: "Checks passed", exact: true })).toHaveCount(0);

  await page.goto("/overview");
  const card = page.getByRole("article").filter({ has: page.getByText("Sam Example", { exact: true }) });
  await expect(card).toHaveAttribute("data-status", "failed");
  await expect(card.getByText("Needs review", { exact: true })).toBeVisible();
  await expect(card.getByText("Automatic investigation could not finish. Review the saved evidence.", { exact: true })).toBeVisible();
  await expect(card.locator("details").filter({ hasText: "Tool history" })).not.toHaveAttribute("open");
  await card.locator("summary", { hasText: "Technical details" }).click();
  await expect(card.getByText(failed.error!, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Open claim", exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Investigate", exact: true })).toHaveCount(0);
  expect(source.decision_status).toBe("pending");
  expect(failed.status).toBe("failed");
  expect(state.requests.filter(request => request.method !== "GET")).toEqual([]);
});

test("one awaited investigation POST discovers saved ordered steps, stops at terminal, and survives reopen", async ({ page }) => {
  const state = await fixtureState(), completedState = await fixtureState(true), pending = deferred();
  const source = state.reviews.submissions.find(row => row.id === sam)!;
  const result = completedState.runs.find(run => run.claim_id === sam)!;
  const runId = fixtureId(9501), start = "2026-09-20T15:00:00.000Z";
  const first = { ...result.steps[0], id: fixtureId(9502), run_id: runId, started_at: start, completed_at: start };
  const second = { ...result.steps[1], id: fixtureId(9503), run_id: runId, status: "running" as const, started_at: start, completed_at: null };
  const running: InvestigationRun = { ...result, run_id: runId, status: "running", outcome: null, headline: "Synthetic persisted investigation", summary: "Saved synthetic API fixture; no provider calls.", after_assessment: null, proposed_learning: null, started_at: start, completed_at: null, findings: [], steps: [second, first, first] };
  const terminal: InvestigationRun = { ...result, run_id: runId, started_at: start, completed_at: "2026-09-20T15:00:02.000Z", steps: [first, { ...second, status: "completed", completed_at: "2026-09-20T15:00:02.000Z" }] };
  let posts = 0;
  await mockApi(page, state);
  await page.route(`**/api/submissions/${sam}/investigate`, async route => {
    posts++; expect(route.request().postDataJSON()).toEqual({ expected_review_revision: 1 });
    state.runs = [running, ...state.runs.filter(run => run.claim_id !== sam)];
    source.latest_investigation = running; source.processing_status = "running";
    await pending.promise;
    await route.fulfill({ json: { run: terminal, row: source } });
  });
  await page.goto(`/business-demo?claim=${sam}`);
  await sheet(page).getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(details(page).getByRole("status")).toContainText("Current action: read supporting documents");
  await expect(details(page).locator("ol > li")).toHaveCount(2);
  await expect(details(page).locator("ol > li strong")).toHaveText(["1. read receipt", "2. read supporting documents"]);
  await expect(sheet(page).getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  const reads = () => state.requests.filter(request => request.path === "/api/investigations" && request.query === `?claim_id=${sam}`).length;
  const firstReads = reads();
  await expect.poll(reads).toBeGreaterThan(firstReads);
  await expect(details(page).locator("ol > li")).toHaveCount(2);
  Object.assign(source, completedState.reviews.submissions.find(row => row.id === sam), { latest_investigation: terminal, latest_run_id: runId, processing_status: "idle" });
  terminal.after_assessment!.review_revision = source.review_revision;
  state.runs = [terminal, ...state.runs.filter(run => run.claim_id !== sam)];
  pending.release();
  await expect(details(page).getByText("Ready for approval", { exact: true })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Investigate", exact: true })).toBeEnabled();
  const settledReads = reads();
  await page.waitForTimeout(1250); // Absence check: terminal polling must stop beyond its one-second interval.
  expect(reads()).toBe(settledReads);
  await sheet(page).getByRole("button", { name: "Close review" }).click();
  await page.getByRole("button", { name: "Open Sam Example's claim", exact: true }).click();
  await expect(details(page).getByText("Ready for approval", { exact: true })).toBeVisible();
  expect(posts).toBe(1); expect(source.decision_status).toBe("pending");
  expect(state.requests.filter(request => request.method === "POST")).toEqual([]);
  await page.goto(`/investigations?run=${runId}`);
  await expect(details(page).getByText("Ready for approval", { exact: true })).toBeVisible();
  await page.screenshot({ path: "tests/ui/evidence/investigations-desktop.png", fullPage: true });
});

test("a delayed selected-run response cannot replace a newer selection", async ({ page }) => {
  const state = await fixtureState(), pending = deferred();
  const older = state.runs.find(run => run.claim_id === fixtureId(2))!, newer = state.runs.find(run => run.claim_id === fixtureId(1))!;
  let requested = false, returned = false;
  await mockApi(page, state);
  await page.route(`**/api/investigations/${older.run_id}`, async route => {
    requested = true; await pending.promise;
    await route.fulfill({ json: { run: older } }); returned = true;
  });
  await page.goto(`/investigations?run=${state.runs.find(run => run.claim_id === sam)!.run_id}`);
  await expect(details(page)).toBeVisible();
  await page.getByRole("button", { name: "Open investigation for Jordan Lee", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "Open investigation for Maya Chen", exact: true }).click();
  await expect(details(page).getByRole("heading", { level: 2 })).toHaveText(newer.headline);
  pending.release(); await expect.poll(() => returned).toBe(true);
  await expect(page).toHaveURL(new RegExp(`run=${newer.run_id}`));
  await expect(details(page).getByRole("heading", { level: 2 })).toHaveText(newer.headline);
  expect(state.requests.filter(request => request.method === "POST")).toEqual([]);
});

test("multipart stale and uncertain uploads refresh saved evidence, preserve notes and never repeat themselves", async ({ page }) => {
  const state = await fixtureState(), source = state.reviews.submissions.find(row => row.id === sam)!;
  const uploaded = { ...state.documents.find(document => document.claim_id === sam)!, id: fixtureId(9601), kind: "payment_confirmation" as const,
    file_type: "application/pdf", extraction_status: "failed" as const, extraction_error: "Synthetic extraction failure; the saved original remains available.", facts: null, extracted_text: null };
  const bodies: string[] = [];
  await mockApi(page, state);
  await page.route(`**/api/submissions/${sam}/supporting-documents`, async (route, request) => {
    if (request.method() === "GET") return route.fallback();
    bodies.push(request.postData()!);
    expect(request.headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    source.review_revision++;
    if (bodies.length === 1) return route.fulfill({ status: 409, json: { error: { code: "STALE_REVIEW", message: "Synthetic revision changed." } } });
    state.documents.push(uploaded); source.assessment_status = null; source.assessment_knowledge_revision = null; source.latest_run_id = null;
    return route.abort("failed"); // The write persisted; the response was lost.
  });
  await page.goto(`/business-demo?claim=${sam}`);
  await sheet(page).getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByLabel("Decision reason", { exact: true }).fill("Keep this reviewer note through upload recovery.");
  await page.getByRole("dialog", { name: "Reject reimbursement", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  await sheet(page).getByLabel("Document kind", { exact: true }).selectOption("payment_confirmation");
  await sheet(page).getByLabel("Supporting file", { exact: true }).setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-synthetic evidence") });
  await sheet(page).getByRole("button", { name: "Add supporting document", exact: true }).click();
  await expect(sheet(page).getByRole("alert").filter({ hasText: "Synthetic revision changed." })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Add supporting document", exact: true })).toBeEnabled();
  expect(bodies).toHaveLength(1);
  await sheet(page).getByRole("button", { name: "Add supporting document", exact: true }).click();
  const retained = sheet(page).getByRole("link", { name: `Open original payment confirmation ${uploaded.id}`, exact: true });
  await expect(retained).toHaveAttribute("href", `/api/submissions/${sam}/supporting-documents/${uploaded.id}`);
  await expect(sheet(page).getByText(uploaded.extraction_error, { exact: true })).toBeVisible();
  // The popup's initial request belongs to its new page, so intercept it on the context.
  await page.context().route(`**/api/submissions/${sam}/supporting-documents/${uploaded.id}`, route => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="20" y="40">SYNTHETIC TEST ORIGINAL</text></svg>',
  }));
  const retainedPopup = page.waitForEvent("popup");
  await retained.click();
  const original = await retainedPopup;
  await expect(original.getByText("SYNTHETIC TEST ORIGINAL", { exact: true })).toBeVisible();
  await original.close(); await page.bringToFront();
  await expect(sheet(page).getByRole("button", { name: "Reject", exact: true })).toBeEnabled();
  await sheet(page).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue("Keep this reviewer note through upload recovery.");
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toContain('name="expected_review_revision"\r\n\r\n1');
  expect(bodies[1]).toContain('name="expected_review_revision"\r\n\r\n2');
  expect(bodies[1]).toContain('name="kind"\r\n\r\npayment_confirmation');
  expect(bodies[1]).toContain('name="file"; filename="synthetic.pdf"');
  expect(state.requests.filter(request => request.path === `/api/submissions/${sam}/supporting-documents`).length).toBeGreaterThanOrEqual(3);
  expect(state.requests.filter(request => request.method === "POST")).toEqual([]);
});

test("explicit preview opens stable hotel and booking Blob originals before a deliberate pending investigation result", async ({ page }) => {
  const apiRequests: string[] = [];
  await page.context().route("**/api/**", route => {
    apiRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 503, json: { error: { code: "PREVIEW_API_FORBIDDEN", message: "Explicit preview must stay local." } } });
  });
  await page.goto(`/business-demo?preview=1&claim=${sam}`);
  await expect(details(page).getByText("Needs your input", { exact: true })).toBeVisible();
  const savedRun = sheet(page).getByRole("link", { name: "Open this investigation", exact: true });
  const beforeRun = await savedRun.getAttribute("href");
  const primary = sheet(page).getByRole("link", { name: "Open original", exact: true });
  const primaryUrl = await primary.getAttribute("href");
  expect(primaryUrl).toMatch(/^blob:/);
  const receiptPopup = page.waitForEvent("popup");
  await primary.click();
  const receipt = await receiptPopup;
  await expect(receipt.getByText("Booking reference: SYN-BOOK-003", { exact: true })).toBeVisible();
  await expect(receipt.getByText("Hotel receipt", { exact: true })).toBeVisible();
  await receipt.close(); await page.bringToFront();
  await expect(primary).toHaveAttribute("href", primaryUrl!);
  const supporting = sheet(page).getByRole("link", { name: `Open original booking confirmation ${fixtureId(9003)}`, exact: true });
  await expect(supporting).toHaveAttribute("href", /^blob:/);
  const bookingPopup = page.waitForEvent("popup");
  await supporting.click();
  const booking = await bookingPopup;
  await expect(booking.locator("body")).toContainText("SIMULATED BOOKING CONFIRMATION");
  await expect(booking.locator("body")).toContainText("Booking reference: SYN-BOOK-003");
  await booking.close(); await page.bringToFront();
  await expect(savedRun).toHaveAttribute("href", beforeRun!);
  await expect(details(page).getByText("Needs your input", { exact: true })).toBeVisible();
  await expect(details(page).getByText("Human decision: pending", { exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
  await sheet(page).getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(details(page).getByText("Ready for approval", { exact: true })).toBeVisible();
  await expect(details(page).getByText("Human decision: pending", { exact: true })).toBeVisible();
  await expect(savedRun).not.toHaveAttribute("href", beforeRun!);
  await expect(sheet(page).getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  expect(apiRequests).toEqual([]);
});

test("human source approval, proposal, returned test versions and distinct activation retain stale and failed gates", async ({ page }) => {
  const state = await fixtureState(true), source = state.reviews.submissions.find(row => row.id === sam)!;
  const run = source.latest_investigation!, correctionId = fixtureId(9701), procedureId = fixtureId(9702);
  const tests: number[] = [], activations: number[] = [], decisions: unknown[] = [], proposals: unknown[] = [];
  await mockApi(page, state);
  await page.route("**/api/workspace/decisions", route => {
    decisions.push(route.request().postDataJSON());
    source.decision_status = "approved"; source.status = "approved"; source.review_revision++;
    source.decisions.push({ ...fixtureCheck(9701, "human_decision", "pass", "Synthetic reviewer verified original and booking.", "approved"), check_method: "human", evidence_json: { simulated: true, correction_id: correctionId } });
    return route.fulfill({ json: { correction_id: correctionId, row: source } });
  });
  await page.route("**/api/procedures", route => {
    if (route.request().method() === "GET") return route.fallback();
    proposals.push(route.request().postDataJSON());
    const procedure: ResolutionProcedure = { ...run.proposed_learning!, id: procedureId, version: 1, state: "draft", source_claim_id: sam, source_run_id: run.run_id,
      source_correction_id: correctionId, created_at: "2026-09-20T15:00:00.000Z", latest_test: null, latest_test_error: null };
    state.procedures = [procedure];
    return route.fulfill({ json: { procedure, knowledge_revision: state.reviews.knowledge_revision } });
  });
  await page.route(`**/api/procedures/${procedureId}/test`, route => {
    const procedure = state.procedures[0]; tests.push(route.request().postDataJSON().expected_procedure_version);
    const passed = tests.length !== 2;
    const report: ProcedureTestReport = { procedure_id: procedureId, procedure_version: procedure.version, knowledge_revision: state.reviews.knowledge_revision,
      suite_version: "booking-reference-v1", mode: "simulated", tested_at: "2026-09-20T15:01:00.000Z", passed,
      applied_case_ids: passed ? ["synthetic-valid-later-purchase"] : [], regressed_case_ids: passed ? [] : ["synthetic-protected-case"],
      before: { total: 12, correct: 12, false_matches: 0, needs_review: 4 }, after: { total: 12, correct: passed ? 12 : 11, false_matches: passed ? 0 : 1, needs_review: 4 },
      reasons: [passed ? "Synthetic passing fixture; no provider evaluation." : "Synthetic protected case regressed. Activation must remain blocked."] };
    procedure.latest_test = report;
    return route.fulfill({ json: report });
  });
  await page.route(`**/api/procedures/${procedureId}/activate`, route => {
    const procedure = state.procedures[0]; activations.push(route.request().postDataJSON().expected_procedure_version);
    state.reviews.knowledge_revision++;
    if (activations.length === 1) return route.fulfill({ status: 409, json: { error: { code: "STALE_RULE_TEST", message: "Synthetic knowledge changed; test again." } } });
    procedure.state = "active"; procedure.version++;
    return route.fulfill({ json: { procedure, knowledge_revision: state.reviews.knowledge_revision } });
  });
  await page.goto(`/business-demo?claim=${sam}`);
  const proposal = sheet(page).getByRole("button", { name: "Propose booking-reference procedure", exact: true });
  await expect(proposal).toBeDisabled();
  await sheet(page).getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Decision reason", { exact: true }).fill("Synthetic human source approval after evidence review.");
  await page.getByRole("button", { name: "Confirm approval", exact: true }).click();
  await expect(proposal).toBeEnabled();
  await proposal.click();
  const article = sheet(page).getByRole("article", { name: "Harbor Reservations procedure", exact: true });
  const testButton = article.getByRole("button", { name: "Test procedure", exact: true }), activate = article.getByRole("button", { name: "Activate procedure", exact: true });
  await expect(activate).toBeDisabled();
  await testButton.click(); await expect(activate).toBeEnabled(); expect(activations).toEqual([]);
  await testButton.click(); await expect(article.getByRole("heading", { name: "Latest recorded test: Failed", exact: true })).toBeVisible(); await expect(activate).toBeDisabled();
  await testButton.click(); await expect(activate).toBeEnabled();
  const approvedSource = structuredClone(source);
  await activate.click(); await expect(sheet(page).getByRole("alert").filter({ hasText: "Synthetic knowledge changed; test again." })).toBeVisible();
  await expect(activate).toBeDisabled(); expect(activations).toEqual([1]);
  await testButton.click(); await expect(activate).toBeEnabled();
  expect(source).toEqual(approvedSource);
  await activate.click(); await expect(article.getByText("active · Version 2", { exact: true })).toBeVisible();
  expect(tests).toEqual([1, 1, 1, 1]); expect(activations).toEqual([1, 1]);
  expect(decisions).toHaveLength(1); expect(proposals).toEqual([{ run_id: run.run_id, expected_review_revision: source.review_revision }]);
  expect(source).toEqual(approvedSource);
  expect(state.requests.filter(request => request.path === "/api/workspace/reconcile")).toEqual([]);
});

for (const entry of ["claim", "investigations"] as const) test(`${entry} procedure activation uses the current workspace mode after a fresh test`, async ({ page }) => {
  const state = await fixtureState(true), source = state.reviews.submissions.find(row => row.id === sam)!;
  const run = source.latest_investigation!, correctionId = fixtureId(9801), procedureId = fixtureId(9802);
  state.reviews.demo_mode = false;
  source.decision_status = "approved"; source.status = "approved"; source.review_revision++;
  source.decisions.push({ ...fixtureCheck(9801, "human_decision", "pass", "Synthetic source approval.", "approved"), check_method: "human", evidence_json: { correction_id: correctionId } });
  const report: ProcedureTestReport = { procedure_id: procedureId, procedure_version: 1, knowledge_revision: state.reviews.knowledge_revision,
    suite_version: "booking-reference-v1", mode: "simulated", tested_at: "2026-09-20T15:01:00.000Z", passed: true,
    applied_case_ids: ["synthetic-supported-purchase"], regressed_case_ids: [], reasons: ["Synthetic route mock; no model calls."],
    before: { total: 12, correct: 12, false_matches: 0, needs_review: 4 }, after: { total: 12, correct: 12, false_matches: 0, needs_review: 4 } };
  const procedure: ResolutionProcedure = { ...run.proposed_learning!, id: procedureId, version: 1, state: "draft", source_claim_id: sam,
    source_run_id: run.run_id, source_correction_id: correctionId, created_at: report.tested_at, latest_test: report, latest_test_error: null };
  state.procedures = [procedure];
  let activations = 0;
  await mockApi(page, state);
  await page.route(`**/api/procedures/${procedureId}/test`, route => {
    expect(route.request().postDataJSON()).toEqual({ expected_procedure_version: 1 });
    report.mode = "live";
    return route.fulfill({ json: report });
  });
  await page.route(`**/api/procedures/${procedureId}/activate`, route => {
    expect(route.request().postDataJSON()).toEqual({ expected_procedure_version: 1 });
    activations++; procedure.state = "active"; procedure.version++; state.reviews.knowledge_revision++;
    return route.fulfill({ json: { procedure, knowledge_revision: state.reviews.knowledge_revision } });
  });
  await page.goto(entry === "claim" ? `/business-demo?claim=${sam}` : `/investigations?run=${run.run_id}`);
  const article = page.getByRole("article", { name: "Harbor Reservations procedure", exact: true });
  const activate = article.getByRole("button", { name: "Activate procedure", exact: true });
  await expect(activate).toBeDisabled();
  await expect(article.getByText("The report mode does not match the current workspace. Run a new test.", { exact: true })).toBeVisible();
  await article.getByRole("button", { name: "Test procedure", exact: true }).click();
  await expect(activate).toBeEnabled(); expect(activations).toBe(0);
  await expect(article.getByText(/Live test · booking-reference-v1/)).toBeVisible();
  await expect(details(page).getByText("Simulated fixture", { exact: true })).toBeVisible();
  await activate.click();
  await expect(article.getByText("active · Version 2", { exact: true })).toBeVisible();
  expect(activations).toBe(1); expect(source.decision_status).toBe("approved"); expect(run.mode).toBe("simulated");
});

test("mobile keyboard flow preserves distinct saved outcomes, reduced motion, focus and page width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixtureState(); await mockApi(page, state);
  await page.goto("/business-demo");
  await page.getByRole("button", { name: "Open navigation", exact: true }).focus(); await page.keyboard.press("Enter");
  const navigation = page.getByRole("dialog", { name: "Workspace navigation", exact: true });
  await navigation.getByRole("link", { name: "Investigations", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/investigations/); await expect(navigation).toHaveCount(0);
  for (const [name, label] of [["Maya Chen", "Ready for approval"], ["Jordan Lee", "Discrepancy found"], ["Sam Example", "Needs your input"], ["Taylor Example", "superseded"], ["Riley Park", "failed"]]) {
    await page.getByRole("button", { name: `Open investigation for ${name}`, exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(details(page).getByText(label, { exact: true }).first()).toBeVisible();
    await expect(details(page).getByText("Simulated fixture", { exact: true })).toBeVisible();
    if (name !== "Maya Chen") await expect(details(page).getByText("Ready for approval", { exact: true })).toHaveCount(0);
    if (name === "Taylor Example" || name === "Riley Park") await expect(details(page).getByText(/After: No published assessment/)).toBeVisible();
  }
  const openClaim = details(page).getByRole("button", { name: "Open claim review", exact: true });
  await openClaim.focus(); await page.keyboard.press("Enter");
  const review = page.getByRole("dialog", { name: "Riley Park", exact: true });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Close review", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(review).toHaveCount(0); await expect(openClaim).toBeFocused();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await details(page).locator("ol > li").evaluateAll(items => items.every(item => getComputedStyle(item).animationName === "none"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "tests/ui/evidence/investigations-mobile.png", fullPage: true });
  expect(state.requests.filter(request => request.method === "POST")).toEqual([]);
});
