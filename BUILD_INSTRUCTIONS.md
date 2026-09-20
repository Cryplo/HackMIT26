# Build instructions — Sift reimbursement review workspace

The `reconciliation/` app contains the new review UI and a working synthetic preview. The normal workspace targets the frozen v2 API; the checked-in backend still needs the separate platform and intelligence upgrades below.

## Run locally

```sh
cd reconciliation
nvm use
npm ci
npm run demo
```

Open `http://localhost:3000/business-demo?preview=1`. This mode needs no API keys. Preview decisions, rules, and search reset on reload; search and learning results are simulated. The upload form uses the actual local demo API, so uploaded claims are separate from the six preview examples.

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:browser` to verify the app. Browser tests use installed Chrome and an isolated local demo store on port 3100. Each teammate should install dependencies locally; do not commit `.env.local`, generated receipts, or local demo state.

The shared TypeScript contract, package scripts, and shadcn setup are present on this UI branch. Commit and share that common baseline before B/C branch independently, as described in the [packet README](docs/superpowers/plans/2026-09-19-dylanli/README.md). B owns the v2 persistence/API upgrade; C owns the intelligence implementation.

## Agent briefs

- [Agent B — platform and financial correctness](docs/superpowers/plans/2026-09-19-dylanli/agent-2-platform.md)
- [Agent C — intelligence and learning evaluation](docs/superpowers/plans/2026-09-19-dylanli/agent-3-intelligence.md)
- [Agent A — frontend](docs/superpowers/plans/2026-09-19-dylanli/agent-1-frontend.md)
- [Devin — reproducible 50-case benchmark](docs/superpowers/plans/2026-09-19-sift-benchmark.md)

The Devin benchmark handoff and [Sift testing guide](docs/SIFT_TESTING.md) are prepared instructions only: no task has been dispatched and no benchmark runner has been implemented by this handoff. Devin exclusively owns `reconciliation/evals/**`, including generator, CLI seed, benchmark/report and browser tests. C retains `src/lib/intelligence/learning.ts`, its ten-case `build_rule_suite`/`evaluate_rule` activation safety checks and intelligence tests. B retains backend scripts, stores, schema and metrics persistence. Benchmark checks use real existing APIs; report missing upstream behavior instead of changing production code solely to fake passing tests.

Frontend implementation follows the [Ramp-style visual specification](docs/superpowers/plans/2026-09-19-dylanli/ramp-ui.md) and [parallel build plan](docs/superpowers/plans/2026-09-19-ramp-ui-build.md). Its API client targets the frozen v2 contract; the explicit `?preview=1` workspace can be used while the platform upgrade is in progress.

## Shared instructions and contracts

- [Packet README and common baseline setup](docs/superpowers/plans/2026-09-19-dylanli/README.md)
- [Shared context and ownership](docs/superpowers/plans/2026-09-19-dylanli/context.md)
- [API behavior and integration rules](docs/superpowers/plans/2026-09-19-dylanli/api.md)
- [Frozen TypeScript contracts](docs/superpowers/plans/2026-09-19-dylanli/contracts.ts)
- [Sift testing guide](docs/SIFT_TESTING.md)

## Theme

Edit [`reconciliation/src/app/theme.css`](reconciliation/src/app/theme.css) to customize the UI. It uses the [official shadcn neutral light defaults](https://ui.shadcn.com/docs/theming#default-theme-css), including the 0.625rem base radius, with a system sans-serif font. The existing Radix/Nova components and compact layout remain in place. `globals.css` imports the theme and maps its tokens to Tailwind/shadcn.

Palette, font family, radii, popover shadow, and motion tokens (`--motion-fast`, `--motion-normal`, `--motion-panel`, `--motion-ease`) live in that one file. Change `--primary`, `--primary-foreground`, and `--ring` together when rebranding.

Keep `--status-*` colors independent of the brand so approval, review, and error meanings stay consistent. `--document-paper` deliberately remains white for original receipts; changing the UI theme must not recolor the bundled synthetic SVG receipts.
