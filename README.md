# Sift — reimbursement review that learns from human decisions

Sift is our HackMIT 2026 finance-workflow demo, motivated by Maximor’s use case. It reads receipts, checks claims against policy and duplicate evidence, investigates unclear evidence, and brings exceptions to a human. A supported review reason can become a tested check for later claims. Approval authorizes reimbursement; Sift does not move money.

**Current app:** [`reconciliation/`](reconciliation/README.md). **New chat? Read [Project context](docs/PROJECT_CONTEXT.md) first.** The integrated implementation is on `main`; older “backend pending” plans describe previous stages.

## Start the 14-claim demo

Use Node 22.18+ (Node 24.11.1 was used for verification):

```sh
cd reconciliation
npm ci
NEXT_DIST_DIR=.next-showcase npm run demo -- --showcase --audit-ready --port 3002
```

Open **http://127.0.0.1:3002/overview**, then choose **Start audit**. This creates a fresh private local dataset, uses simulated providers, and sends no real email. Use the exact hostname because mutations check the request origin. **Reset demo** lets you replay the flow.

The demonstration includes ordinary claims, an amount mismatch, a policy-cap violation, duplicate and lookalike purchases, missing identity, and matching/conflicting/missing booking evidence. Receipts are designed fictional PDFs. See the [showcase guide](reconciliation/docs/SHOWCASE.md) for the cases and a separate learning rehearsal.

## Find your starting point

| Need | Read |
| --- | --- |
| Background, current behavior, architecture, known gaps, next work | [Project context](docs/PROJECT_CONTEXT.md) |
| Local setup, live configuration, commands | [App README](reconciliation/README.md) |
| How to work safely in this shared repository | [AGENTS.md](AGENTS.md), [build guide](BUILD_INSTRUCTIONS.md) |
| Demo script, receipts, reset, live deployment notes | [Showcase](reconciliation/docs/SHOWCASE.md) |
| What happens to a reviewer’s reason | [Review learning](reconciliation/docs/REVIEW_LEARNING.md) |
| Public data/API types | [Review contracts](reconciliation/src/lib/review-contracts.ts) |
| Prior implementation assignments | [Historical instruction pack](docs/next-work/README.md) |

## What is real

Both local and live modes persist claims, evidence, decisions, investigations, and learning state. The local showcase simulates model output. Live mode calls configured services and can fail; it does not silently substitute simulated success. Seeded receipt transcriptions are authored fixtures even in live storage. New live uploads exercise extraction. Applicant email remains preview-only in the current demo configuration.

This is a synthetic-data hackathon app without authentication or payments. Learning is narrow, versioned evidence-check logic, not model retraining. A passing fixed safety suite is not a general accuracy or savings benchmark. See [verification and remaining work](docs/PROJECT_CONTEXT.md#verification-and-remaining-work) before making demo claims.
