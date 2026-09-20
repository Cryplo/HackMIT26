# Synthetic reimbursement rehearsal

`seed-rehearsal.ts` manages **20 synthetic claims total**: the five original
`seed.sql` claims plus 15 new claims. This is separate from the six browser
preview fixtures and the 50-case held-out benchmark. It does not import BenchRec.

Applied on 2026-09-20: 15 claims, 15 receipt rows, and 15 private PDFs added.
One existing synthetic upload was preserved, giving **21 database claims**.
Existing state remained unchanged: 5 policies, 5 runs, 45 decisions, 0 corrections,
and 19 model-call records before and after the apply. The follow-up audit found
zero inserts, uploads, or MIME changes needed and verified all 20 cohort PDFs.

New claims start `pending` with no run. Parsed evidence is explicitly labeled
`SIMULATED/FIXTURE`; it is authored seed data, not live OCR output. The seed does
not invoke Azure, Jev, reconciliation, or human approval and does not insert
decisions, corrections, or model usage. The UI's global live-extraction label
describes configuration, not provenance of these fixtures.

## Commands

Run from `reconciliation/` using Node 22.18+ and the existing dependencies:

```sh
# Entirely offline: fixture integrity, duplicate bytes, preservation guards,
# and the real reconciliation service with in-memory simulated providers.
node --conditions=react-server --import tsx scripts/seed-rehearsal.ts --check

# Read-only Supabase audit; reads .env.local without displaying secrets.
node --env-file=.env.local --conditions=react-server --import tsx scripts/seed-rehearsal.ts

# Apply missing fixture rows and PDFs; safe to repeat after reviewing the audit.
node --env-file=.env.local --conditions=react-server --import tsx scripts/seed-rehearsal.ts --apply
```

The system `node` on this machine was v19.8.1. The exact working rerun command is:

```sh
/Users/jaydenl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=.env.local --conditions=react-server --import tsx scripts/seed-rehearsal.ts --apply
```

The script requires `RECONCILIATION_SYNTHETIC_ONLY=true`, a valid Supabase service
key, the existing core schema/RPC, and a private receipts bucket. It stops on
missing schema, changed fixture evidence, incompatible policies, or unrelated
claims without explicit synthetic markers. It never migrates or resets the DB.
Existing IDs are not overwritten; existing object bytes must match. Only legacy
managed receipt MIME metadata may be promoted from `text/plain` to
`application/pdf` after verification. Unrelated synthetic claims are preserved.

## Cohort

Cases 1–5 use claim IDs `10000000-0000-4000-8000-000000000001` through
`10000000-0000-4000-8000-000000000005`. Cases 6–20 use
`11000000-0000-4000-8000-000000000006` through
`11000000-0000-4000-8000-000000000020` (decimal suffixes).
Receipt IDs use prefixes `20000000` and `21000000` respectively, with the same
suffix. Objects use the app's required `synthetic/<claim-id>/<receipt-id>` path.

| Cases | Count | Evidence |
| --- | ---: | --- |
| 1, 6–12 | 8 | Straightforward flight, hotel, train, and bus claims |
| 3, 4, 13 | 3 | Unfamiliar `SYN HBR 042` hotel descriptor; case 3 is the manual correction source |
| 5 | 1 | Same descriptor claimed as flight; hotel alias must not cross category scope |
| 14–16 | 3 | Amount mismatch, flight cap violation, non-USD receipt |
| 2, 17, 18 | 3 | Exact PDF copies of cases 1, 6, 8 respectively |
| 19, 20 | 2 | Missing receipt amount; missing traveler name |

There are 17 distinct PDF hashes. The current DB has no receipt hash column:
the script verifies actual bytes with SHA-256, while the current reconciliation
service evaluates duplicate candidates using parsed receipt evidence.

## Manual rehearsal

1. Open `/business-demo`, reload claims, and open a new receipt (for example,
   Casey Example, case 6). The 15 added claims should initially be pending.
2. When ready for live provider usage, reconcile selected rehearsal claims.
   The current live mode can call Jev. The seed itself does not perform this step.
3. Inspect cases 14–16 for financial failures, 17–18 for duplicates, and 19–20
   for missing evidence. Do not treat simulated expectations as live results.
4. For correction learning, a reviewer can record a `vendor_alias` correction
   through the existing backend `POST /api/corrections` endpoint. This is
   currently API-only: `/business-demo` decisions support `decision_override`,
   and its rule UI is not connected to alias writes. Use case 3 with observed
   `SYN HBR 042`, canonical `Synthetic Harbor Hotel`, scope
   `{ "category": "hotel", "currency": "USD" }`. Include a real reviewer note
   identifying this synthetic mapping. Then reconcile cases 4, 13, and 5:
   hotel cases can use that evidence; the flight case cannot. No correction
   or human approval is pre-seeded.

The offline check asserts initial simulated machine outcomes of 8 approved,
6 flagged, and 6 needing review, with zero provider usage. These are fixture
checks, not a live evaluation score or human approval. Existing runs and
corrections can affect later results. Use the separate held-out benchmark for
measurement; do not count rehearsal fixtures as unseen evaluation examples.
