// @ts-nocheck — optional Playwright harness; no application dependency on the test runner.
/** Run with Playwright against an isolated Vite harness or the integrated app.
 * DASHBOARD_BASE_URL defaults to http://127.0.0.1:3000.
 */
import { expect, test } from "@playwright/test";
import { fixtureReviews } from "../fixtures";
const base = process.env.DASHBOARD_BASE_URL || "http://127.0.0.1:3000";

test("explicit fixture mode, grouped ledger, evidence, and mobile layout", async ({
  page,
}) => {
  await page.route("**/api/reviews", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "API offline" } },
    }),
  );
  await page.goto(`${base}/business-demo`);
  await expect(page.locator("main").getByRole("alert")).toContainText("API offline");
  await page.getByRole("button", { name: "Open fixture preview" }).click();
  await expect(
    page.getByText("SIMULATED FIXTURE PREVIEW · READ ONLY"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Reconcile selected/ }),
  ).toBeDisabled();
  await expect(
    page.getByText("01 / Submitted values", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Sam Rivera" })
    .getByRole("button", { name: "Evidence" })
    .click();
  await expect(
    page.getByText("Probability of true", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Correct & teach" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "/tmp/module3-dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/module3-dashboard-mobile.png",
    fullPage: true,
  });
});

test("saves scoped alias through API, reconciles selected related claim, and polls during work", async ({
  page,
}) => {
  let reads = 0;
  const posts = [];
  await page.route("**/api/reviews", (route) => {
    reads++;
    return route.fulfill({ json: fixtureReviews });
  });
  await page.route("**/api/corrections", (route) => {
    posts.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      json: { correction_id: "saved", status: "approved" },
    });
  });
  await page.route("**/api/reconcile", async (route) => {
    posts.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await route.fulfill({
      json: {
        results: [
          {
            submission_id: fixtureReviews.submissions[3].id,
            run_id: "run",
            status: "approved",
          },
        ],
      },
    });
  });
  await page.goto(`${base}/business-demo`);
  await expect(
    page.getByText("SIMULATED API DEMO · SYNTHETIC DATA ONLY"),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Sam Rivera" })
    .getByRole("button", { name: "Evidence" })
    .click();
  await page.getByRole("button", { name: "Correct & teach" }).click();
  await page.getByLabel("Correction type").selectOption("vendor_alias");
  await page.getByLabel("Canonical merchant").fill("Northeast Rail");
  await page
    .getByLabel("Review note")
    .fill("Receipt identifier confirms the merchant relationship.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved");
  expect(posts[0].body).toMatchObject({
    submission_id: fixtureReviews.submissions[2].id,
    human_verdict: "approved",
    correction_type: "vendor_alias",
    correction_payload_json: {
      observed_vendor: "NE RAIL WEB",
      canonical_vendor: "Northeast Rail",
      scope: { category: "train", currency: "USD" },
    },
  });
  await page.getByLabel("Select Taylor Chen").check();
  const readsBefore = reads;
  await page.getByRole("button", { name: /Reconcile selected/ }).click();
  await expect
    .poll(() => reads, { timeout: 3300 })
    .toBeGreaterThan(readsBefore);
  await expect(page.getByRole("status")).toContainText(
    "1 reconciliation result(s) returned",
  );
  expect(posts[1].body).toEqual({
    submission_ids: [fixtureReviews.submissions[3].id],
  });
});

test("unknown amounts stay unknown and API errors do not become approvals", async ({
  page,
}) => {
  const data = structuredClone(fixtureReviews);
  data.demo_mode = false;
  data.submissions[0].receipt.parsed_fields_json.amount_minor = null;
  await page.route("**/api/reviews", (route) => route.fulfill({ json: data }));
  await page.route("**/api/reconcile", (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: "FAILED", message: "Provider unavailable" } },
    }),
  );
  await page.goto(`${base}/business-demo`);
  await expect(
    page.getByRole("row").filter({ hasText: "Alex Morgan" }),
  ).toContainText("Unknown");
  await page.getByLabel("Select Taylor Chen").check();
  await page.getByRole("button", { name: /Reconcile selected/ }).click();
  await expect(page.getByRole("status")).toContainText("Provider unavailable");
  await expect(
    page.getByRole("row").filter({ hasText: "Taylor Chen" }),
  ).toContainText("pending");
});

test("one-time override uses an empty payload and preserves the review note after failure", async ({
  page,
}) => {
  let payload;
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: fixtureReviews }),
  );
  await page.route("**/api/corrections", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({
      status: 409,
      json: {
        error: {
          code: "ACTIVE_RUN",
          message: "Reconciliation is still active.",
        },
      },
    });
  });
  await page.goto(`${base}/business-demo`);
  await page
    .getByRole("row")
    .filter({ hasText: "Sam Rivera" })
    .getByRole("button", { name: "Evidence" })
    .click();
  await page.getByRole("button", { name: "Correct & teach" }).click();
  await page.getByLabel("Human verdict").selectOption("rejected");
  await page
    .getByLabel("Review note")
    .fill("Insufficient supporting documentation.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Reconciliation is still active.",
  );
  await expect(page.getByLabel("Review note")).toHaveValue(
    "Insufficient supporting documentation.",
  );
  expect(payload).toMatchObject({
    human_verdict: "rejected",
    correction_type: "decision_override",
    correction_payload_json: {},
  });
});
