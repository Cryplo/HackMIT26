# Module 3 — organizer reimbursement dashboard

Branch: `codex/reconciliation-dashboard`

Implementation commit: `cbecb844fc269d0a827da2618131edeb63a663ca`.
This handoff is committed immediately after the implementation; include both commits when integrating. Base contract: `1ed6e3e`.

## Delivered

- `/business-demo`: responsive organizer ledger with submitted / receipt / review column groups, search, status filter, explicit selection capped at 50, and reconciliation action.
- Evidence file displays latest decisions, method, verdict, recorded answer, rationale, expandable evidence JSON, and separately labeled probability-of-true and confidence. Missing values remain unknown/not provided.
- Original receipt links use only `/api/receipts/[id]`.
- Correction form supports one-time decision overrides and reusable vendor aliases with fixed current category / USD scope. Optional decision ID, approved/rejected human verdict, and required review note use the exact contract payload.
- GET reviews every three seconds, including during slow reconciliation requests, with request sequencing to avoid older snapshots overwriting newer ones. Mutations are serialized in the UI. API failures are visible and never simulated as approval. Failed correction submissions preserve form input.
- Server-provided approved amount, review rate, and top flag reasons; pending count and reviewed denominator. Approved is explicitly not paid.
- Prominent synthetic-data warning. `demo_mode: true` responses are labeled simulated API demo.
- Explicit read-only fixture preview, never automatic fallback. Five contract scenarios: clean, duplicate, ambiguous merchant, pending related claim, and hotel counterexample outside train/USD alias scope. No invented provider probabilities/costs. Preview correction/reconcile buttons are disabled and receipt links omitted.

## Owned files

- `reconciliation/src/app/business-demo/page.tsx`
- `reconciliation/src/components/business/BusinessDashboard.tsx`
- `reconciliation/src/components/business/business.module.css`
- `reconciliation/src/lib/dashboard/types.ts`
- `reconciliation/src/lib/dashboard/helpers.ts`
- `reconciliation/src/lib/dashboard/fixtures.ts`
- `reconciliation/src/lib/dashboard/tests/dashboard.spec.ts`

No existing prototype, package manifest, lockfile, root layout/style, or other module files changed. CSS is scoped through a CSS module. No remote fonts or new runtime dependencies.

## Integration

Merge Module 1 scaffold, then Module 2 core, then these Module 3 commits. Next App Router discovers the page at `/business-demo`. The page uses React and CSS modules only; the scaffold must support TypeScript and those built-in Next capabilities.

Required endpoints, unchanged from the frozen contract:

- `GET /api/reviews` → `{submissions, summary, demo_mode}`
- `POST /api/reconcile` → sends `{submission_ids}`; consumes `{results}`
- `POST /api/corrections` → sends the contracted correction payload; consumes `{correction_id,status}`
- `GET /api/receipts/[id]` → private receipt access managed by Module 1

The read-side types intentionally live in the owned dashboard directory so this module builds without waiting for Module 2. They mirror the shared contract; Module 2's `contracts.ts` was not created or modified. No dashboard environment variables or client secrets are required. Backend environment configuration remains the responsibility of Modules 1 and 2.

## Verification

Passed strict TypeScript checking and production bundling in an isolated temporary Vite harness using React/ReactDOM 19.1.0, TypeScript 5.8.3, Vite 6.3.5, @types/react 19.1.2, and @types/react-dom 19.1.2. Vite reports the expected ignored Next `use client` directive; this is not a Next build failure.

Four Playwright 1.51.1 tests passed in installed Chrome:

1. API outage, explicit read-only fixture selection, grouped ledger, evidence, disabled fixture mutations, desktop screenshot, and 390px viewport without document overflow.
2. Exact scoped vendor-alias payload, correction success, selected-only reconciliation payload, and polling while a 3.5-second reconciliation request is in flight.
3. Null receipt amount remains unknown; reconciliation server failure never changes pending claim to approved.
4. One-time rejected override sends an empty correction payload; server conflict preserves the review note.

Desktop and mobile screenshots were inspected. The ledger scrolls horizontally on small screens, with a keyboard-focusable scroll region. All other sections adapt to the viewport. Reduced motion is respected.

Test runner is optional, not a runtime dependency. Add `@playwright/test` only to a temporary harness or the scaffold's dev tooling if desired. The test file disables standalone TypeScript checking to avoid forcing the optional runner into the application dependency set. Run against the integrated app with:

```sh
DASHBOARD_BASE_URL=http://127.0.0.1:3000 npx playwright test src/lib/dashboard/tests/dashboard.spec.ts
```

Run that command from `reconciliation/` after making the runner/browser available. Tests intercept the four backend scenarios, so they validate dashboard behavior rather than backend correctness. Local preview harness: `/tmp/module3-dashboard-preview`; screenshots: `/tmp/module3-dashboard-desktop.png` and `/tmp/module3-dashboard-mobile.png` (temporary, not required for integration).

## Remaining integration limitations

- Full Next.js build and real API/provider/database round trip were not run because the isolated worktree intentionally has no Module 1 scaffold or Module 2 implementation. No credentials were inspected.
- Fixtures are a static illustration, not persisted backend seed data. The shared contract defines scenarios but no fixed attendee IDs/names; these fixture IDs/names are synthetic. Use Module 2's seeded API demo to demonstrate actual correction persistence and subsequent alias retrieval.
- Receipt delivery authorization, reconciliation concurrency, atomic correction persistence, policy enforcement, and learning behavior belong to backend modules. UI labels do not replace those safeguards.
- No automatic approval, payment action, direct database writes, or silent provider fallback. No push or merge performed.
