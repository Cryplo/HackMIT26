import { humanActions } from "./human-actions";
import type { ReviewsResponse } from "./types";
import type { DashboardClient } from "./ui-contracts";

export function confirmedFailures(data: ReviewsResponse) {
  return humanActions(data).filter(action => action.group === "confirmed_fail" && action.rejectionReason).map(action => ({
    id: action.row.id, name: action.row.attendee_name, revision: action.row.review_revision,
    note: action.rejectionReason!, knowledgeRevision: data.knowledge_revision,
    knowledgeEnabled: data.capabilities?.knowledge_revisions === true,
  }));
}

/** Each explicit batch uses only the displayed claims and stops at the first uncertain write. */
export async function rejectConfirmedFailures(
  frozen: ReturnType<typeof confirmedFailures>,
  readFresh: () => Promise<ReviewsResponse>,
  decide: DashboardClient["decide"],
  onProgress: (completed: number) => void,
) {
  let completed = 0;
  let simulated = 0, queued = 0, accepted = 0;
  const emailErrors: string[] = [];
  for (const item of frozen) {
    let writing = false;
    try {
      const fresh = await readFresh();
      const current = confirmedFailures(fresh).find(row => row.id === item.id);
      if (!fresh.snapshot_token || !fresh.coverage?.complete || fresh.coverage.returned !== fresh.submissions.length
        || fresh.coverage.total !== fresh.submissions.length || !current || current.revision !== item.revision
        || current.knowledgeRevision !== item.knowledgeRevision || current.knowledgeEnabled !== item.knowledgeEnabled || current.note !== item.note)
        throw new Error(`${item.name} or the saved evidence changed. Review the updated list before continuing.`);
      writing = true;
      const result = await decide({ submission_id: item.id, expected_review_revision: item.revision,
        human_verdict: "rejected", human_note: item.note, correction_type: "decision_override", correction_payload_json: {}, request_id: crypto.randomUUID() });
      if (result.row.id !== item.id || result.row.decision_status !== "rejected" || result.row.review_revision <= item.revision)
        throw new Error("The server did not confirm the rejection.");
      completed++;
      onProgress(completed);
      if (result.message?.status === "previewed") simulated++;
      if (result.message?.status === "accepted") accepted++;
      if (["queued", "sending"].includes(result.message?.status ?? "")) queued++;
      if (result.email_error || ["failed", "delivery_unknown", "cancelled"].includes(result.message?.status ?? "")) emailErrors.push(`${item.name}: ${result.email_error || "email delivery needs attention"}`);
    } catch (failure) {
      return { completed, error: `${completed} of ${frozen.length} rejections confirmed. ${failure instanceof Error ? failure.message : "Unable to complete this batch."}${writing ? ` The decision for ${item.name} may have saved; refresh and inspect it before trying again.` : ""} Stopped; remaining claims were not submitted.` };
    }
  }
  const summary = [simulated && `${simulated} emails simulated`, accepted && `${accepted} emails accepted for delivery`, queued && `${queued} emails queued`].filter(Boolean).join(" · ");
  return { completed, error: emailErrors.length ? `Decisions saved. ${emailErrors.join("; ")}. Check applicant communication before retrying email.` : null,
    ...(summary ? { notification_summary: summary } : {}) };
}
