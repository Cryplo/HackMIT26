# Module 02: partial implementation on main

No shared contracts, provider configuration, database, UI, package files, search, alias-v1 implementation or benchmark artifacts were changed. No live calls or shared-data writes were made.

## Delivered

- `investigation.ts`: internal Azure Responses planner using existing ResponsesConfig/responsesHeaders and an injected transport/read dispatcher. Three planning requests, six tool executions and a 65-second planner deadline combined with outer cancellation. Third-round tool requests reject; no fourth synthesis call or implicit retry.
- Only the five frozen read tools with empty arguments are accepted. Entire call batches and unique call IDs are validated before dispatch. Matching tool outputs continue the Responses conversation. Tools receive the effective signal; their actual I/O must honor it. Late output is rejected.
- Structured findings cite observed typed record IDs only, validate claim ownership, receive server IDs, and cannot publish assessment/approval fields. Missing evidence requires a useful question. Procedure proposals stay suggestions, never activated rules. B must additionally validate grounding/revisions against stored evidence.
- Original receipt text is bounded to 12,000 characters and supporting text to 24,000 across the accumulated context, including repeated reads. At most eight supporting documents per read. Overall serialized history has an additional 128,000-character bound. Evidence is never silently truncated.
- Each actual HTTP attempt logs once, including failures; absent tokens/cost are null. Pre-aborted operations log no fictional call. Public steps contain observed read summaries, not reasoning transcripts. B owns persisted start/end/failure steps.
- `core/jev.ts`: optional fourth cancellation signal on Jev.evaluate/LiveJev/SimulatedJev; existing callers remain valid. Cancellation reaches the actual fetch. Instructions reinforce corroborating merchant evidence, explicit policy/linkage for supporting traveler identity, and the insufficiency of same merchant/date/amount for duplicate proof. Existing strict validation, transports and thresholds are unchanged.

## Blocking Module 01 handoff

The checked-out shared contracts still lack SupportingDocument, InvestigationFinding, ProcedureCandidate, ResolutionProcedure, ProcedureFacts, ProcedureEvaluationCase, AssessProcedureExample, ProcedureEvaluationInput and ProcedureTestReport. InvestigationTools lacks read_supporting_documents and InvestigationResult lacks the additive fields. `responsesConfig` still accepts only extraction/justification. `createAssessProcedureExample` is absent.

Module 02 explicitly requires: “If a required field/config seam is absent, report the exact dependency; continue mocked planner tests rather than modifying B’s files.” No parallel public types or substitute assessor were created.

Required from B:

1. Publish frozen additive types and `responsesConfig('investigation')`, Azure-only validation and disabled-by-default mode/runtime guards.
2. Bind persisted, claim-scoped read tools to effective cancellation; own the 90-second outer lease/revision deadline and one final core assessment. The internal engine's dispatcher takes `(toolName, signal)`; adapt it without weakening the three-argument public port.
3. Forward the fourth Jev signal from CoreService.assess; the existing caller still omits it.
4. Agree/publish richer SemanticState fields for stored receipt text, supporting facts, applicable identity policy and procedure evidence. C has not invented these fields independently.
5. Supply the real procedure scorer and observation handoff. The frozen scorer returns only Assessment, but C's gate needs actual check observations proving procedure application and protected-check preservation. ProcedureEvaluationInput currently describes no observation access. Agree that handoff through B; scorer input IDs cannot be treated as application proof.

Still to implement after that handoff: public investigate wiring, explicit fact-based offline simulation, the fixed 12-case booking-reference-v1 suite, its observation-backed gate, and integrated first/later-claim verification. `IntelligencePort.investigate` deliberately remains unavailable; the tested internal engine is not advertised as an enabled product feature.

## Offline evidence

Mocked supported trace: receipt + supporting document + policy callbacks, followed by findings citing SYN-A1 receipt/booking evidence. Two mocked model requests, three read calls, no extraction/writes/assessment. Missing-booking trace: receipt read, then an explicit request for the booking confirmation; two mocked requests, one read, no claimed resolution. Six-read/three-request trace succeeds; seventh read and third-round tool requests fail BUDGET_EXHAUSTED.

Verified on Node 24:

```sh
node --conditions=react-server --import tsx --test src/lib/intelligence/investigation.test.ts src/lib/core/tests/jev.test.ts
# 30/30 passed
npm run test:intelligence
# 25/25 passed, including unchanged alias-v1 tests
npm run typecheck
# passed
```

These are mocked/offline checks, not live model accuracy, deployed integration, successful procedure activation or a human-approved demonstration. Historical benchmark findings remain unchanged.
