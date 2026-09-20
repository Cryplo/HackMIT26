# Workspace P0 delivery

Assignment: `docs/next-work/03-workspace.md`. Prepared on `main`, against committed platform declarations `ec85c53` and intelligence implementation `7229707`. No P1 custom questions or new reconciliation types.

## What works

- Queue keeps human decisions separate from machine assessments, shows exact integer-cent deltas, and gives each row a concrete next action. Missing/failed extraction and different currencies never produce a numeric delta.
- Explicit AI search uses only supported filters and the captured snapshot. Filter changes invalidate pending responses; changed snapshots label results stale. Search result IDs resolve to current rows. Possible matches require explicit selection.
- Complete coverage gates exact-ID merchant, stale-rule, and confirmed-later-duplicate insights. Each drill-down owns its count and claimed cents; null revisions and missing checks cannot qualify.
- Review preserves originals, shows receipt-specific extraction provenance or unknown, exposes deterministic financial facts before narrative, navigates confirmed prior claims with a way back, and guards approval with complete financial/duplicate evidence. Stale writes preserve the entered note and require another deliberate action.
- Retry uses the same claim, receipt, and review revision; successful extraction requires a separate explicit recheck. Saved upload failures link directly to the saved claim.
- Capability-gated learning supports approved source → draft → explicit test → authoritative rule refresh → activation → explicit recheck → disable. Tests return `RuleTestReport`; failed attempts clear eligibility. Source correction identity comes from human-check `evidence_json.correction_id`, not the check's ID. Simulated reports cannot activate in a live workspace.
- Export captures 1–1000 selected IDs and their snapshot together, downloads only a server CSV, and revokes its object URL. A stale snapshot creates no file and requires another explicit export. Recheck retains its separate 50-claim limit and reports partial failures without retrying successful claims.
- Missing capabilities remain visibly unavailable and trigger no absent-endpoint polling. Loading/empty/error states, keyboard focus, mobile footer access, and reduced motion remain covered.

## Files in this delivery

Relative to `reconciliation/`:

- `src/app/submit/submit-form.tsx`
- `src/components/business/AppShell.tsx`
- `src/components/business/BusinessDashboard.tsx`
- `src/components/business/ReviewSheet.tsx`
- `src/components/business/ReviewTable.tsx`
- `src/components/business/RulesPanel.tsx`
- `src/components/business/business.module.css`
- `src/lib/dashboard/client.ts`
- `src/lib/dashboard/fixtures.ts`
- `src/lib/dashboard/preview.ts`
- `src/lib/dashboard/review.ts`
- `src/lib/dashboard/ui-contracts.ts`
- `src/lib/dashboard/tests/preview.test.ts`
- `src/lib/dashboard/tests/review.test.ts`
- `tests/ui/workspace.spec.ts`
- `tests/ui/WORKSPACE_HANDOFF.md`
- `tests/ui/evidence/desktop-queue.png`
- `tests/ui/evidence/mobile-review.png`

## Verification actually run

Node **24.11.1**, existing dependencies, no package/config changes:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed in shared workspace and in an isolated source copy containing committed main plus only owned changes. |
| `node --conditions=react-server --import tsx --test src/lib/dashboard/tests/*.test.ts` | **9 passed, 0 failed** in both source copies. Equivalent test selection to the assignment's `NODE_OPTIONS=--conditions=react-server npx tsx --test …`; direct Node invocation avoids the sandbox-blocked tsx IPC listener. |
| `env -u DASHBOARD_BASE_URL npm run test:browser -- src/lib/dashboard/tests/dashboard.spec.ts tests/ui` | **23 passed, 0 failed**, 38.9 seconds, isolated paid-provider-disabled demo server and Chrome. |
| `npm run build` | **Passed** in the owned-files-only source copy, using cloned installed dependencies and no environment file. Production compilation, TypeScript, and static-page generation completed. |
| `git diff --check` for owned paths | Passed. |

The first browser run found excess desktop spacing; the expanded run found preview-only rules navigation and two test locator issues. Those were fixed before the final 23/23 run. Initial build attempts encountered sandbox port restrictions, then an unrelated in-progress backend test type error. The owned-files-only production build passed after isolating source and dependencies; the latest shared-workspace typecheck also passed. Full integrated release checks remain the integration owner's responsibility after all deliveries land.

## Live versus simulated

- Existing browser tests load reviews from the isolated local API. No shared Supabase instance was used.
- New retry, rule, export, search-race, and upload failure scenarios use explicit Playwright route mocks. Their passing results verify UI contracts and state behavior, not real persistence or provider accuracy.
- Preview learning and its 8/10 → 10/10 display are scripted fixtures. Preview CSV export stays unavailable; there is no client CSV substitute.
- Screenshots are unchanged captures of the six fictional preview claims: `evidence/desktop-queue.png` and `evidence/mobile-review.png`.
- No paid model calls, database reset, shared database mutation, or live-provider accuracy measurement was performed.

## Integration dependencies

1. Coordinate Agent B's platform implementation and additive migration delivery: authoritative approval/duplicate guards, persisted knowledge and source revisions, rule lifecycle/test invalidation, original-preserving retry, confirmed links/provenance, complete coverage, and exact-snapshot CSV. These implementations were being edited concurrently and are excluded from this UI commit.
2. Integrate Agent C's real activation suite with B's assessment seam. Public rule reports do not expose every server-side source/suite/provider binding; the backend must enforce freshness atomically. The frontend cannot certify that binding from report totals alone.
3. Integration owner applies/reviews migrations without resetting the shared project, then verifies actual persistence and the budgeted live rule/retry/export rehearsal. No live-model budget was supplied for this assignment.
4. Continue honoring optional capability flags: absent is false. Historical receipt provenance must be populated per receipt; global provider settings are insufficient. No package, lockfile, CI, or browser-configuration change is requested by this delivery.

The commit is intentionally local. Push waits for the user's delivery slot.
