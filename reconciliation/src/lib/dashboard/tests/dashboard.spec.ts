import { expect, test } from "@playwright/test";
import { fixtureReviews } from "../fixtures";

test("API failure stays an error until the user explicitly chooses preview", async ({ page }) => {
  await page.route("**/api/workspace/reviews", route => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "API offline" } } }));
  await page.goto("/business-demo");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("API offline");
  await expect(page.getByRole("button", { name: /Maya Chen/ })).toHaveCount(0);
  await page.goto("/business-demo?preview=1");
  await expect(page.getByText("Preview workspace", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Maya Chen/ }).first()).toBeVisible();
});

test("legacy API status is not silently interpreted as a human approval", async ({ page }) => {
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: { submissions: [{ status: "approved" }], demo_mode: true } }));
  await page.goto("/business-demo");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("The review API needs the v2 upgrade");
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
});

test("stale approval refreshes evidence and preserves the reviewer's note", async ({ page }) => {
  const data = structuredClone(fixtureReviews);
  let submitted: unknown;
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: data }));
  await page.route("**/api/workspace/decisions", route => {
    submitted = route.request().postDataJSON();
    data.submissions[2].review_revision++;
    data.snapshot_token = "changed-after-stale-write";
    return route.fulfill({ status: 409, json: { error: { code: "STALE_REVIEW", message: "Another reviewer changed this claim." } } });
  });
  await page.goto("/business-demo");
  await page.getByRole("button", { name: /Sam Example/ }).first().click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const note = "Verified the original hotel receipt.";
  await page.getByLabel("Decision reason").fill(note);
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Another reviewer changed" })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByLabel("Decision reason")).toHaveValue(note);
  expect(submitted).toMatchObject({ submission_id: data.submissions[2].id, expected_review_revision: 1, human_note: note, correction_type: "decision_override", correction_payload_json: {} });
  expect(data.submissions[2].decision_status).toBe("pending");
});

test("failed semantic search remains an error rather than an empty successful result", async ({ page }) => {
  await page.route("**/api/workspace/reviews", route => route.fulfill({ json: fixtureReviews }));
  await page.route("**/api/search", route => route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE", message: "Search provider unavailable." } } }));
  await page.goto("/business-demo");
  await page.getByRole("searchbox", { name: "Semantic search" }).fill("hotel");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Search provider unavailable.");
  await expect(page.getByRole("heading", { name: /^Matches/ })).toHaveCount(0);
});
