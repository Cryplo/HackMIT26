# Learning from review decisions

A reviewer’s decision and internal reason save first. Learning evaluates the reason in the background, so ordinary review can move to the next claim without a draft/test/activation sequence. An automatic claim approval is not human feedback. Disabling automatic claim approvals with `RECONCILIATION_AUTOMATION_MODE=disabled` does not disable this separate learning path.

## What may be reused

The automatic learning scope is a hotel merchant identity check: a billing descriptor can identify the hotel when that claim's own extracted receipt and booking confirmation corroborate the same booking reference, guest, purchase date, amount, and currency. The current human approval and completed assessment must remain valid. A resolved investigation is not required for review-feedback learning. The reason must support this evidence relationship. A one-time exception, conflicting evidence, missing evidence, or a proposed change to reimbursement policy must not create an automatic rule.

This is saved evidence-check logic, not model retraining. Amount, currency, date, claimant identity, policy limits, and duplicate checks remain mandatory. A learned check never carries one claimant's documents over to another claim.

## Lifecycle

1. Save the decision, internal reason, and queued learning status together.
2. Classify the feedback against the supported evidence pattern, treating the note as data rather than instructions.
3. Derive a candidate from stored evidence and run the existing independent twelve-case safety suite.
4. Activate only a current passing candidate with unchanged source evidence and human approval.
5. Recheck claims without a human decision, prioritizing matching merchants. A changed saved-rule set also requires fresh checks for other undecided claims. Preserve human decisions.

The UI shows **Checking what can be learned**, **Testing saved check**, and **Saved for similar claims**, or an honest **No reusable check saved**, **Learning needs confirmation**, or **Learning could not finish** outcome. Active jobs refresh in the background. Details are collapsed in the review, dashboard, and Learned rules; open the source claim to inspect its saved check or use **Turn off check**.

Failed learning never reverses a saved decision. Expand the failure and choose **Retry learning** to retry the latest failed feedback at the current review revision; it does not resubmit the decision or applicant notice. Source decision/evidence changes invalidate reuse. Interrupted jobs expire into a visible failure instead of running forever. Review changed source evidence before retrying; policy changes remain outside automatic activation.

The advanced manual investigation workflow remains separate: an eligible resolved investigation candidate with human approval can still use **Save check draft**, **Test check**, and **Turn on check**. Its stricter investigation requirements do not gate automatic review feedback.

## Privacy and diagnostics

The **Internal review reason** is never copied into applicant email. Approval notices are generic. Discretionary rejections offer a collapsed **Applicant message (optional)** with neutral default wording; editing it does not change the internal reason. Leaving it blank uses the standard rejection notice. Retrying an uncertain decision preserves the original separate payloads.

Investigation failures retain an allowlisted stage and reason, with a short plain-language explanation. Provider payloads, credentials, and arbitrary exception text do not become UI error messages. Historical failures that saved only `INVALID_PROVIDER_OUTPUT` cannot be diagnosed retroactively.

## Validation

Safety reports describe observed results of the fixed twelve-case suite; they do not establish general model accuracy. Simulation is labeled and does not substitute fabricated live results. A passing tie is allowed. Report any before/after difference only as results on those fixed cases, not as general model accuracy.

## Rehearse and deploy

Use the separate private-store command in [Showcase → Learning walkthrough](SHOWCASE.md#learning-walkthrough), with automation disabled so Sam Mercer remains available for human approval. Choose **Edit reason**, enter “Harbor Reservations is Harbor Hotel: the booking confirmation matches this receipt’s booking reference, amount and guest.”, and approve. The default seed auto-approves Sam and Taylor, so it does not provide that fresh human decision. Do not use `--audit-ready` for this example: it reenables automatic approvals.

The private file-store demo runs simulated classification and safety tests; `?preview=1` only saves the review note and reports that automatic learning is not run. The simulated baseline already handles Sam and Taylor, so a passing tie does not demonstrate reduced errors. In live mode, whether a check is saved depends on the actual classification and test results.

Supabase deployments require `supabase/migrations/202609200010_feedback_learning.sql`. It was applied to this live demo on September 20, 2026, and the app successfully read the retained 14-claim workspace afterward. Other deployments must apply it separately. Applying a migration is not a live learning rehearsal; live model outcomes have not been verified by the simulated browser check.
