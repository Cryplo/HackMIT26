# Ramp-style review workspace implementation plan

**Goal:** Build the approved Fieldnotes reimbursement UI in a visible local checkout, with original-receipt review, decisions, learning and semantic search.

**Architecture:** Reuse the existing Next app. Consume the frozen v2 API with two implementations of a small UI client: actual same-origin HTTP and explicit in-memory preview. Backend work remains owned by the separate platform/intelligence agents; unsupported v1 responses show a clear version message and preview link.

**Stack:** Existing Next/React/TypeScript/Tailwind, shadcn Radix/Nova, Lucide, existing Node tests and Playwright. Follow [the visual contract](2026-09-19-dylanli/ramp-ui.md) and [complete frontend brief](2026-09-19-dylanli/agent-1-frontend.md).

## Execution and ownership

The user selected orchestrated execution. Agents share this checkout with disjoint file ownership and must preserve each other's work. The integration owner controls packages, shared contracts, docs and final verification. No agent implements API endpoints or alters financial rules.

1. Setup executor: clone current main to `HackMIT26`, create `feat/ramp-ui`, install locked dependencies with Node 24.11.1, add the agreed contract and shadcn primitives. Keep existing framework versions.
2. Queue builder: `BusinessDashboard.tsx`, `ReviewTable.tsx`, `AppShell.tsx`, existing business CSS, root layout/globals/root page, business-demo page and demo page. Own controller, filters, selection, polling, theme and responsive shell.
3. Evidence builder: `ReviewSheet.tsx`, `RulesPanel.tsx`, `ReviewStatus.tsx`, optional adjacent panel CSS. Own receipt comparison, required-reason decisions, extraction retry, merchant proposal/test/activate/disable, and clear errors.
4. Client builder: `src/lib/dashboard/**` except parent-owned `ui-contracts.ts`; submit form/page; `public/ui/**`. Own real client, labeled mutable preview, source fixtures, synthetic receipts and intake styling.
5. Integration owner: `tests/e2e.spec.ts`, `tests/ui/**`, `playwright.config.ts`, docs, and final cross-component fixes after ownership handoff.

## Frozen internal seams

`reconciliation/src/lib/dashboard/ui-contracts.ts` defines `DashboardClient`, `ReviewSheetProps` and `RulesPanelProps`. Import these types; do not invent variants.

- Client exports `createDashboardClient(mode: 'api' | 'preview'): DashboardClient` from `client.ts`; each preview instance owns its own data and resets on reload. HTTP failures never select preview automatically.
- Helpers retain `money` and `statusLabel`, add `formatDate`; unknown money displays an em dash. `types.ts` re-exports frozen v2 types rather than mirroring them.
- Panels export named `ReviewSheet` and `RulesPanel` with the shared prop types. Each handles its own mutation/loading/error state; after a successful write call `onChanged`. Preserve notes after errors, including stale versions.
- `ReviewStatus.tsx` exports `AssessmentBadge({status, processingStatus?})` and `DecisionBadge({status})` using frozen assessment/human-decision types. Queue and panels use the same badges.
- Dashboard receives `preview?: boolean` from its async server page; it creates the client once for that mode. Root enters `/business-demo`; user explicitly enters `/business-demo?preview=1` for synthetic preview. API v1 is a visible compatibility error, not silently reinterpreted.
- Dashboard `onChanged` refreshes reviews; RulesPanel also refreshes its own rules after rule mutations. Polling preserves open row ID, notes, selection and last good data; older responses cannot overwrite newer mutations.

## Build and integration checks

- [x] Verify official reference screenshots and generate shared primitives once.
- [x] Render populated queue with preview client; review decision tabs and filters, and verify selection and recheck.
- [x] Verify review sheet original document, exact amount difference, both statuses, required decision reason and blocked unsafe approval. API errors keep the existing row and notes.
- [x] Verify draft/test/activate/disable and stale rule report states; preview test reports say simulated. Never present preview counts as measured live AI accuracy.
- [x] Verify semantic search invokes explicit action, separates possible matches, retains original IDs and marks results stale after state changes.
- [x] Preserve real intake upload validation and literal multipart `file`; style it with the same system.
- [x] Run Node tests, TypeScript and production build. Update existing browser tests for deliberate hierarchy changes while retaining actual upload/error coverage.
- [x] In a browser inspect desktop 1440x900 and mobile 390x844. Check the first row starts within 300px, All shows six preview rows, receipt and evidence are side by side on desktop, keyboard focus/escape work, and no accidental horizontal page overflow.
- [x] Prepare local preview and document exact limits: frontend complete versus v2 backend integration pending. Do not claim live provider verification.

## Verification result

On the local `feat/ramp-ui` branch: the initial implementation passed 34 Node tests. After the neutral theme and motion update, all 10 Chrome browser tests, TypeScript, production build, and `git diff --check` pass. Screenshots disable animations for stable captures; the dedicated motion test verifies actual animations, reduced motion, pending feedback, and focus restoration. Inspected actual desktop and mobile captures. The frozen contract matches the packet byte for byte; existing API, core and intake implementations are unchanged.

The user's subsequent theme choice supersedes the original Ramp palette: neutral light shadcn defaults now live in `reconciliation/src/app/theme.css`, alongside typography, radii, and motion timing. The compact layout remains. Motion uses the existing Radix components, CSS, and `tw-animate-css`; no new dependency was added.

Run instructions are in the root `BUILD_INSTRUCTIONS.md`. Local preview: `http://127.0.0.1:3000/business-demo?preview=1`. The live v2 backend and provider verification remain B/C integration work.
