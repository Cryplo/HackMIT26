# Recording outline (not yet recorded)

A recording is only worth making once gate 1b (human-reviewed labels) and gate 5 (approved
budget, isolated project) are satisfied. Until then this is a plan, not evidence.

Preconditions stated on camera at the start: commit hash, mode (`live` or `simulated`), the
Supabase project used and that it is isolated and empty, the approved call ceiling, and who
reviewed the pack and when.

1. **Setup (30s).** Show `cli.ts review-status` reporting a real reviewer, and the empty
   workspace before any upload.
2. **Straightforward claim (1 min).** Upload one `straightforward_valid` case end to end; show
   the receipt, the checks, and the matched result with its amount.
3. **Policy violation and incomplete claim (1 min).** Upload the cap violation and the incomplete
   case; show that neither is matched and why the incomplete one cannot be approved.
4. **Duplicate across two documents (1.5 min).** Approve the original, then submit the duplicate's
   payment confirmation and show the approval being refused for an already-claimed purchase.
5. **Unfamiliar merchant, before the feature (1 min).** Show the hotel case sitting in
   `needs_review` with `merchant: unknown` and the booking confirmation available as evidence.
6. **Investigation (2 min).** Show the actual planning steps, the tool calls made, the call
   ledger counting them, and the reassessment. If it fails, keep the failure on camera.
7. **Refresh (30s).** Reload; show the persisted steps unchanged and no repeated paid work.
8. **Reviewed procedure and reuse (2 min).** Show the human approving the source, the versioned
   `booking-reference-v1` test result, explicit activation, then the second hotel case reusing it
   — and one case where the reference is missing or conflicting, where reuse does not happen.
9. **Ledger close-out (30s).** Show total attempts versus ceiling, wall clock, failures and
   whether cost capture was complete.

Rules for the recording: no cut between an action and its result; every failure that occurs
stays in; no narration asserting accuracy; state at the end that the pack is synthetic
development material and not an accuracy measurement.
