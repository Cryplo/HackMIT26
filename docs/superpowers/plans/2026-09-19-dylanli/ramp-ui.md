# Sift visual contract — Ramp-style reimbursement review

Read this before implementing Agent A. This file governs visual choices; `api.md` and `contracts.ts` govern behavior. Keep Sift naming. The target is Ramp's actual finance workspace, with its compact hierarchy and review flow.

**Current theme override:** The user selected neutral light shadcn defaults. Use `reconciliation/src/app/theme.css` as the source of truth; it supersedes the initial lime palette and theme snippet below. Keep the compact layout and review interactions.

## Reference screens: look before coding

These are public product screenshots linked from [Ramp's reimbursement review documentation](https://support.ramp.com/reviewing-reimbursements/), visually inspected for this brief on September 19, 2026:

- [Queue header, navigation, tabs and primary action](https://assets.ramp.com/help-center/reviewing-reimbursements/attachments/30956492620435.png)
- [Table density, filter chips, receipts and right-aligned amounts](https://assets.ramp.com/help-center/reviewing-reimbursements/attachments/42397068734227.png)
- [Selection and explicit approval confirmation](https://assets.ramp.com/help-center/reviewing-reimbursements/attachments/8121793690771.png)

Observed patterns: white workspace; quiet neutral navigation; large usable table area; short page heading; light horizontal rules; compact controls; lime used sparingly for a primary action. The reference screenshots show different product versions, so do not combine every detail literally. Use the underlined tabs from the second reference. Our review sheet and dimensions below are project design decisions, not verified Ramp internals or official Ramp tokens.

Open the first two images in your browser before writing the queue. If unavailable, follow the measurable specification below and state that visual comparison was unavailable. Do not substitute a marketing homepage, dashboard template, or an invented Ramp design-system package.

## What Ramp's own engineering/design posts change

[Bootstrapping a UI component library](https://ponyfoo.com/articles/bootstrapping-a-ui-component-library) is the Ramp engineer's republication of its 2021 Ryu article. Its useful principles here are semantic tokens, constrained component choices, consistent adoption and precise documentation. Its historical React/TypeScript/styled-components/downshift stack is context, not a reason to replace this app's working stack.

Ramp's July 2026 [Internal design tools at Ramp](https://ramp.design/blog/internal-design-tools) describes Ryu, internal Dojo skills and a Sakura workbench with design context included. It emphasizes giving agents shared decisions and reviewing their output across product reasoning, UX, design system, accessibility and copy. We can apply that method with this committed guide, shadcn primitives and actual browser inspection. The post does not provide a public installation recipe for those internal tools.

In practice: use the same Button/Input/Table/Sheet everywhere; keep semantic success/error colors separate from the lime brand action; inspect a populated queue before expanding the interface; critique the decision workflow and failure states as well as its appearance. Our small shared component directory is enough for the weekend; no separate design-system repository or recreation of Ramp's internal tooling.

## One component system

Use existing Next, Tailwind 4, **shadcn/ui with Radix primitives and Nova styling**, Lucide icons, and ordinary CSS transitions. Nova is the compact starting point; the local theme below supplies the identity. [Official shadcn style descriptions](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create).

The integration owner initializes shadcn **once**, inside `reconciliation/`, before the agents branch:

```sh
npx shadcn@latest init -d --base radix --no-monorepo
npx shadcn@latest add button input label textarea table badge checkbox select sheet dialog tabs tooltip skeleton separator --yes
npx shadcn@latest info --json
```

The current CLI documents `-d` as the Next/Nova default and supports an explicit Radix base. Review the generated diff before committing; do not run `--force` or scaffold a new app. Retain the generated valid style identifier instead of guessing it. If already initialized, inspect `components.json` and reuse it rather than reinitializing. [Official CLI](https://ui.shadcn.com/docs/cli).

Verify these configuration values: CSS variables enabled; neutral base color; Lucide icons; RSC/TSX enabled; `tailwind.css` points to `src/app/globals.css`; Tailwind 4 uses no separate config file; aliases resolve `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`. All teammates consume the committed components and lockfile. Nobody independently reruns initialization.

For the frontend coding agent, the one useful additional skill is the **official shadcn skill**:

```sh
npx skills add shadcn/ui
```

This optional installation happens in that agent's environment; committing a prompt does not install a skill on another computer. The skill helps with component APIs and composition. This visual contract supplies the design direction. [Official skill documentation](https://ui.shadcn.com/docs/skills). Existing frontend-design skills may help implementation, but must follow this explicit reference rather than invent a different aesthetic.

Use shadcn Table directly with existing array filtering; this demo has at most 200 rows. Use a simple `aside`/`nav` with two real destinations. No dashboard block, paid kit, chart library, TanStack Table, second component library, or animation package is needed for this brief.

## Layout and density

At 1440 × 900, build this structure:

```text
┌─ 208px navigation ─┬─ flexible workspace ──────────────────────────────┐
│ Sift               │ Expenses                       Synthetic demo    │
│                    │ Reimbursements                    [+ New claim]  │
│ Reimbursements     │ Needs review 6   Approved 2   Rejected 1   All 9   │
│ Learned rules      ├───────────────────────────────────────────────────┤
│                    │ Search claims…   [AI search] [Category] [Status]  │
│                    ├──┬────────┬──────────┬─────────┬────────┬─────────┤
│                    │□ │Person  │Merchant  │Claimed  │Receipt │Statuses │
│                    │□ │…       │…         │  $84.20 │ $84.20 │…        │
│                    │□ │…       │…         │ $112.00 │$100.00 │Flagged  │
│                    │  │        │          │         │        │         │
└────────────────────┴──┴────────┴──────────┴─────────┴────────┴─────────┘
```

Counts above are illustrative; derive actual counts from data. The two statuses remain separate table columns, as required by A's brief. The workspace fills available width; do not center it in a narrow marketing container.

| Element | Project specification |
| --- | --- |
| Sidebar | 208px, subtle neutral fill, 1px right border; 16px inner padding |
| Content gutters | 28px desktop; 16px mobile |
| Heading | 28px / 36px, weight 600, slight negative tracking |
| Default text | 14px / 20px, normal sans serif; weights 400/500/600 |
| Metadata / table heading | 12px / 16px, sentence case, subdued but readable |
| Controls | 36px high desktop; 44px touch targets on mobile |
| Table | 40px header; 56px rows; 12px cell padding; horizontal separators |
| Money | Right aligned, tabular numerals, two decimals; unknown is an em dash |
| Icons | Lucide, 16px controls / 18px navigation; consistent stroke weight |
| Corners | 6px controls; 8px dialogs; no rounded outer container around the queue |
| Spacing | 4px fine alignment; otherwise 8/12/16/24/32px |

First data row starts within the top 300px at desktop size. At least six rows fit without scrolling if six exist. Title and controls remain visually secondary to the work itself. Keep all preview cases reachable via All; do not violate the pending default just to show more rows.

Tabs filter **human decisions**: Needs review = pending, then Approved, Rejected, All. A separate assessment filter exposes Matched, Flagged and Needs review. This distinction prevents a machine match being mistaken for an approval. Selected tabs use a thin dark underline; keep counts small and neutral. The toolbar can use compact outline filter controls. Search filters text immediately; the explicit AI search button/Enter invokes semantic search as specified in the API.

Use a real accessible merchant/person link or button inside each row for keyboard opening, even if the whole row also responds to a mouse. Checkbox clicks select without opening the sheet. Row hover gets a faint neutral fill. Selection replaces toolbar actions with a selection count and Recheck selected; there is no bulk approval endpoint.

## Theme: paste into the existing token layer

These are Sift approximations chosen for this design, not Ramp's proprietary values. A merges them into `globals.css` after initialization, preserving the generated Tailwind imports and semantic `@theme inline` mappings. Do not keep two conflicting token systems. Existing `--muted` and `--accent` have different meanings in the legacy CSS: update/remove their old consumers while restyling the pages.

```css
:root {
  color-scheme: light;
  --background: #ffffff;
  --foreground: #20211c;
  --card: #ffffff;
  --card-foreground: #20211c;
  --popover: #ffffff;
  --popover-foreground: #20211c;
  --primary: #e4f222;
  --primary-foreground: #20211c;
  --secondary: #f4f5f0;
  --secondary-foreground: #20211c;
  --muted: #f6f6f3;
  --muted-foreground: #63655b;
  --accent: #eeefe9;
  --accent-foreground: #20211c;
  --destructive: #b42318;
  --border: #e3e4de;
  --input: #c4c7bc;
  --ring: #555d3c;
  --radius: 0.375rem;
  --sidebar: #f7f7f4;
  --sidebar-foreground: #20211c;
  --sidebar-primary: #20211c;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #e9ebe2;
  --sidebar-accent-foreground: #20211c;
  --sidebar-border: #e3e4de;
  --sidebar-ring: #555d3c;
  --status-good: #286044;
  --status-good-bg: #eef7f0;
  --status-review: #825700;
  --status-review-bg: #fff7e5;
  --status-bad: #b42318;
  --status-bad-bg: #fff0ee;
}

/* Merge into the generated @theme inline block, not a second theme. */
@theme inline {
  --font-sans: Arial, "Helvetica Neue", system-ui, sans-serif;
}

body { font-family: Arial, "Helvetica Neue", system-ui, sans-serif; }
```

Use `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border` and component variants rather than scattered hex values. Map custom status tokens with CSS variables/classes where used. Dark text on lime; never white text on lime. Keep one bright primary action in each active surface. Secondary actions stay white/outlined. Status labels are small tinted rectangles with an icon and words; color alone never communicates state. Pending decision is neutral; machine needs-review is amber.

Remove old serif headings, oversized numbers, hard offset shadows, cream paper panels and decorative section labels. Keep Sift text branding modest. Use native system fonts consistently across pages; no font download is required. Verify text, controls and focus indicators remain distinguishable in actual rendered states.

## Receipt review and learning

The review sheet is the other main screen. At desktop >=1200px, use a right Sheet `min(960px, viewport - 32px)` wide, overriding shadcn's narrow default. Persistent header: claimant, amount, assessment, decision and Close. Below, use two columns: a 42% neutral document well containing the original, and 58% evidence/details. Separate them with one border. This lets the user compare evidence without scrolling past the entire document.

Keep the original PDF/image on the left with Open original; use the existing receipt route and native image/PDF support. On the right, show claimed versus receipt values in aligned rows, then the specific discrepancy and check details. Favor “Claim exceeds receipt by $12.00” over “AI detected an anomaly.” An amount difference should be understandable before opening an explanation. Tool evidence is a secondary disclosure, not the dominant page content.

Use a fixed footer within the sheet with Reject (outline) and Approve (primary), required-reason confirmation, loading/error feedback and the server's blocked reason. Approval means approved for reimbursement, not paid. Keep sheet position, scroll and entered notes stable during polling or a failed mutation. Close restores focus to the originating row control.

Below 1200px, use a full-width sheet with Document/Details tabs; keep header and action footer visible and let only the body scroll. At 390 × 844, there must be no page-wide overflow or inaccessible actions. A compact queue list is acceptable; a deliberately scrollable table must still have an obvious open-details control. Hide the desktop sidebar behind an accessible menu button.

Learned rules uses the same shell, typography and table treatment. The rule detail shows its exact scope, source claim, Draft/Test/Activate state, and actual before/after results. Use a small comparison table with text explanations; no decorative graph or invented percentage. Ineligible and failed activation states must be as clear as success.

## Motion and implementation sequence

Use CSS transitions: 120–160ms hover/focus, 180–220ms sheet entry, gentle 100–150ms dialog fade. Respect `prefers-reduced-motion`; no page entrance choreography, bouncing counters, animated gradients or pulsing AI decorations. Loading shows what is running without moving the table. Preserve existing rows during refetch; reserve skeletons for the initial empty load.

1. Build the shell and populated queue using the explicit preview client. Open it at 1440 × 900 and compare with the two references.
2. Fix typography, table density and hierarchy before adding the review sheet. A lime button alone does not meet this brief.
3. Build receipt/evidence comparison and the real decision states. Inspect at desktop and 390 × 844.
4. Add rule and semantic search states using the same primitives; integrate real APIs through the existing client.

## Visual acceptance — include screenshots in A's handoff

- Queue in All at 1440 × 900: first row within 300px, six fixture rows visible, aligned amounts, compact toolbar, no hero/KPI wall, no empty destinations.
- Review sheet: receipt and extracted comparison visible together on desktop; clear discrepancy and persistent actions; both assessment and human decision visible.
- Failed extraction, rejected duplicate, stale decision and failed rule test remain understandable with no fake success.
- Mobile 390 × 844: usable menu, row opening, document switching, readable controls and reachable actions.
- Keyboard: tab order, visible focus, checkbox selection, sheet/dialog focus trap, Escape to close and focus restoration. Honor reduced motion.
- Capture actual browser output and compare hierarchy/density with the public screenshots. Fix visible deviations before calling it complete. Do not claim a screenshot was reviewed unless it was opened.

This file is enough to work without any optional skill installation. The committed components, theme and screenshot checks make the design reproducible across agents and computers.
