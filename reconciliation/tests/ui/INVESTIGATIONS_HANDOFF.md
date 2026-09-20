# Investigation workspace acceptance

Updated September 20, 2026 against the integrated B DTOs and routes on `main`. The owned API seam matches supporting-document, investigation, and procedure response envelopes. Missing capability flags remain false; no provider availability is fabricated.

Integration fixes: known mandatory amount/currency/policy/date/cap/duplicate failures now disable Investigate with a specific reason, and the explicit preview applies the same guard. Procedure tests in preview and browser mocks now preserve the draft version, matching the backend; activation still increments it. Procedure activation now compares test mode with current workspace `demo_mode`, not the historical source investigation mode, so an explicit fresh test after a mode change can restore eligibility.

Verification: **15/15 dashboard Node tests passed**, and **11/11 focused investigation Chrome tests passed in 17.9 seconds**. Browser verification used `/private/tmp/sift-ui-integration-a492p6p0`, a source copy excluding `.env*`, build outputs, and repository metadata, with cloned installed dependencies. A clean process environment, disabled investigations, existing Playwright configuration, and temporary demo store isolated it from providers and shared data. The first sandboxed launch could not bind loopback (`EPERM`); the same isolated command passed with execution permission. Main-checkout build directories and existing servers were untouched.

Exact commands:

```sh
# Main checkout; Node 24.11.1 first on PATH.
PATH=/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH node --conditions=react-server --import tsx --test src/lib/dashboard/tests/*.test.ts

# /private/tmp/sift-ui-integration-a492p6p0; DASHBOARD_BASE_URL and credentials absent.
env -i HOME="$HOME" PATH=/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${TMPDIR:-/tmp}" RECONCILIATION_INVESTIGATION_MODE=disabled npm run test:browser -- tests/ui/investigations.spec.ts
PATH=/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH npm run typecheck
```

The eleven browser cases verify absent capabilities; mandatory-failure eligibility and reason text; HTTP-success responses containing failed saved runs and errors surviving reload; one awaited investigation POST with ordered/deduplicated saved progress and terminal polling stop; selection races; multipart stale/uncertain upload recovery with retained originals and notes; explicit-preview Blob originals; human source approval → proposal → versioned test → distinct activation with stale/failed proof blocked; current-workspace mode changes in both claim-sheet and investigations-page procedure controls; and mobile keyboard, focus, reduced-motion and page-width behavior. Browser data is synthetic and all API requests are intercepted; preview asserts zero API calls. These checks do not prove actual backend persistence or model execution.

The passing browser status is recorded in `/private/tmp/sift-ui-integration-a492p6p0/test-results/.last-run.json` (the configured default reporter writes to the terminal, with no HTML report). New screenshots were visually reviewed and remain in the isolated copy: [desktop](/private/tmp/sift-ui-integration-a492p6p0/tests/ui/evidence/investigations-desktop.png) and [mobile](/private/tmp/sift-ui-integration-a492p6p0/tests/ui/evidence/investigations-mobile.png). Existing repository screenshots are from the earlier UI delivery. This focused integration pass did not rerun `workspace.spec.ts`, the broad browser suite, or the combined build; integration owns those checks. `npm run typecheck` passed in the isolated copy with the real delivered B contracts and final UI changes; no provisional contract override is used.

## Review path


1. Open `/business-demo?preview=1`, then Sam Example. Inspect the explicitly synthetic hotel original and its saved booking confirmation. The uploaded-file preview retains arbitrary files but does not extract them.
2. Click **Investigate**. Review its saved steps, findings, separate machine assessment and pending human decision. The preview completes directly without staged timers.
3. Click **Approve**, enter the evidence-review reason, and explicitly **Confirm approval**.
4. Choose **Propose booking-reference procedure**, inspect the exact hotel/USD descriptor scope and required matching booking reference, then **Test procedure**. The preview report is simulated; it is not a live safety-suite evaluation.
5. Use the distinct **Activate procedure** action. Activation never approves or rechecks another claim. An explicit recheck of Taylor's synthetic hotel claim demonstrates procedure evidence while retaining Taylor's pre-existing human decision. The preview's fixed six claims do not constitute a new pending-claim production demonstration.
6. Inspect Jordan's overclaim and Alex's duplicate; neither becomes ready through merchant learning. Use `/investigations?preview=1` for representative saved resolved, discrepancy, needs-input, failed, and superseded fixtures.

## Integration limits

- B's shared declarations and route groups are now present. The new client imports shared DTOs through the existing re-export. Default investigation/procedure execution remains controlled by runtime capabilities while C integration is verified; the UI never enables unavailable endpoints by assumption.
- UI route mocks and preview validate rendering, request payloads and explicit human actions. Actual FileStore/SQL persistence, extraction, provider cancellation, and real procedure evaluation require separate integrated verification. No live calls or shared database writes occurred in this pass.
- Preview clients are instance-local. Route changes/remounts reset interactive preview changes; use one claim sheet for the approval/procedure sequence. Static saved examples remain available on the investigations page.
- Synthetic hotel originals and reports are explicitly labeled. Later-claim reuse in preview preserves the existing human decision; it is not evidence of a production pending-claim workflow or model accuracy.
- No package, shared contract, API, provider, environment, or global-style changes were made for this focused UI integration.
