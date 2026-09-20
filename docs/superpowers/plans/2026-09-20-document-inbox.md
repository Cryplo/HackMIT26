# Document inbox implementation plan

**Goal:** Turn a small batch of synthetic loose receipts, booking PDFs, and email PDFs into confirmed claims in the existing Sift workflow.

**Approved design:** The user approved the bounded one-hour hackathon scope in conversation. A separate worktree isolates implementation. Keep the current light-green design, native form controls, existing components, and one clear primary action per stage.

**Architecture:** Each upload is extracted once and saved privately in a server-local inbox. Deterministic matching suggests supporting documents for receipt anchors; ambiguous cases require selection. Confirmation supplies missing request fields, preserves original bytes and extracted facts, then uses existing claim storage, supporting-document attachment, and reconciliation. Requests and receipt totals remain separate. Local inbox storage is explicitly a single-server demo limit; no new dependencies, OAuth, background queue, or database migration.

**Tech stack:** Existing Next.js, React, TypeScript, Zod, Node filesystem, extraction provider, local/Supabase claim stores, Playwright.

## Tasks

- [x] Add inbox schemas and matching: explicit reference/name agreement, conservative merchant/date/amount fallback, ambiguous candidates visible, conflicts retained. Tests cover clear matches, equal candidates, contradictory identity, and request/receipt amount disagreement.
- [x] Extend the existing extractor with a document classification/facts/request schema. Demo extraction recognizes exact authored sample bytes only; arbitrary demo documents remain unknown. Live provider failure stays a failure.
- [x] Add bounded upload, original preview, suggestion, and confirmation APIs. Persist authoritative extraction server-side; validate identifiers and input; private originals; prevent double confirmation and make partial save failures visible.
- [x] Add `/import` with multi-file selection, bounded concurrent extraction, editable per-receipt drafts, document assignment, source preview, missing-field prompts, and links to saved claims. Add workspace navigation.
- [x] Add a synthetic sample pack and an end-to-end browser test exercising actual upload, deterministic suggestions, corrected ambiguity, saved originals/supporting evidence, amount discrepancy, and unchanged repeat-confirm behavior. Run focused tests, typecheck, and build.
- [x] Update project context and runbook with exact demo limits and measured verification. Leave changes isolated on `feat/document-inbox`.

## Visual demo second pass

- [x] Add dashboard source cards and primary paperwork navigation in the feature worktree.
- [x] Replace uniform PDFs with a designed mixed PDF/PNG pack: complete case, discrepancy, ambiguous email, duplicate, and unrelated agenda.
- [x] Present compact cases with original links, matching reasons, amount comparisons, and an unsent clarification draft. Suppress duplicate reads by content hash.
- [x] Add a fresh isolated demo launcher with explicit optional live reading and simulated review.
- [x] Verify 19 backend checks, desktop/mobile browser flow, two live browser scenarios, TypeScript, and production build. Record real timings and the corrected test-only locator failure in the runbook.
- [x] Keep main untouched; publish only the feature branch for review.

## Data sources visual refinement

User-directed design: label navigation and entry panel Data sources; show Google Forms, Email, and Dropbox folder as demo input routes. Reuse the existing form and sample-file intake without OAuth or sync. Add a static Sources → Waiting connection to the measured audit graph; preserve actual queue counts and observed activity.

- [x] Rename the source panel and add explicit demo input cards with working local destinations.
- [x] Add the sources graph node and route it into Waiting at desktop/tablet/mobile widths.
- [x] Update existing geometry/browser checks, inspect screenshots, and run typecheck/build. Keep work on the feature branch.

## Dedicated sources and observable parsing

User-directed refinement: remove the top overview panel and per-card demo badges, use recognizable service icons, make `/import` a connection mockup + dropzone + sample browser, and show actual source activity in the graph. Keep one clear sample-workspace disclosure and expose extraction provenance.

- [x] Move connection cards to the sources page, preserve working file upload, and browse form/email/folder originals beside returned fields.
- [x] Add a real CSV response fixture and bounded UTF-8 CSV/TXT/EML intake using the existing Responses extractor.
- [x] Record bounded browser-local upload, parsing, failure, and confirmation activity; show it across tabs and animate confirmed handoff.
- [x] Preserve edited drafts/manual links while allowing later receipts to connect to earlier requests.
- [x] Check 20 backend tests, connector geometry, three browser tests, a paid two-source live check, and production build. Correct the observed CSV amount-copy error and document its limits.


## Start audit consumes messy originals

User-directed correction: Start audit must consume the mixed-format inputs itself, without a separate manual parsing prerequisite.

- [x] Add a persisted, opt-in sample batch using existing upload/extract/match/confirm helpers; no new queue or dependency.
- [x] Replace the bus email PDF sample with a real EML export, alongside PDF, PNG, and CSV originals.
- [x] Queue only complete unambiguous requests, preserve amount discrepancies, and hold missing/ambiguous inputs.
- [x] Feed source progress into Start audit, support stop/reload/resume, and expose the same saved inputs on Data sources.
- [x] Distinguish unresolved source inputs in audit completion; keep human decisions and existing financial checks.
- [x] Verify twelve focused tests, a 37.2-second paid live-extraction browser run, mobile layout, typecheck, and production build. Review stays simulated.
