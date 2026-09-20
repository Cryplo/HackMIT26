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
