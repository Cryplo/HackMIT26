import { Check, Circle, CircleCheck, CircleX, Clock3, LoaderCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Assessment, HumanDecision, ReviewRow } from "@/lib/review-contracts";

const tone = {
  good: "bg-[var(--status-good-bg)] text-[var(--status-good)]",
  review: "bg-[var(--status-review-bg)] text-[var(--status-review)]",
  bad: "bg-[var(--status-bad-bg)] text-[var(--status-bad)]",
  neutral: "bg-muted text-muted-foreground",
};

export function AssessmentBadge({ status, processingStatus }: {
  status: Assessment | null;
  processingStatus?: ReviewRow["processing_status"];
}) {
  const [label, Icon, color] = processingStatus === "running"
    ? ["Checking", LoaderCircle, tone.neutral]
    : processingStatus === "failed"
      ? ["Check failed", TriangleAlert, tone.bad]
      : status === "matched"
        ? ["Passed", Check, tone.good]
        : status === "flagged"
          ? ["Flagged", TriangleAlert, tone.bad]
          : status === "needs_review"
            ? ["Needs review", Circle, tone.review]
            : ["Not checked", Circle, tone.neutral];
  return <Badge variant="secondary" className={`h-6 rounded px-1.5 ${color}`} aria-busy={processingStatus === "running"}><Icon aria-hidden="true" className={processingStatus === "running" ? "motion-safe:animate-spin" : undefined} />{label}</Badge>;
}

export function DecisionBadge({ status, source }: { status: HumanDecision; source?: ReviewRow['decision_source'] }) {
  const [label, Icon, color] = status === "approved"
    ? [source === "automatic" ? "Auto-approved" : "Approved", CircleCheck, tone.good]
    : status === "rejected"
      ? ["Rejected", CircleX, tone.bad]
      : ["Awaiting decision", Clock3, tone.neutral];
  return <Badge variant="secondary" className={`h-6 rounded px-1.5 ${color}`}><Icon aria-hidden="true" />{label}</Badge>;
}

/** One user-facing state; detailed check results live in the claim review. */
export function ClaimStatusBadge({ row }: { row: ReviewRow }) {
  if (row.decision_status !== "pending") return <DecisionBadge status={row.decision_status} source={row.decision_source} />;
  const running = row.processing_status === "running" || row.latest_investigation?.status === "running";
  const [label, Icon, color] = running
    ? [row.latest_investigation?.status === "running" ? "Investigating" : "Checking", LoaderCircle, tone.neutral]
    : row.processing_status === "failed" || row.receipt?.extraction_status === "failed"
      ? ["Check interrupted", TriangleAlert, tone.review]
      : !row.assessment_status || !row.latest_run_id
        ? ["Waiting for checks", Clock3, tone.neutral]
        : row.assessment_status === "flagged"
          ? ["Issue found", TriangleAlert, tone.bad]
          : row.assessment_status === "needs_review"
            ? ["Needs evidence", Circle, tone.review]
            : ["Ready for approval", Check, tone.good];
  return <Badge variant="secondary" className={`h-6 rounded px-1.5 ${color}`} aria-busy={running}><Icon aria-hidden="true" className={running ? "motion-safe:animate-spin" : undefined} />{label}</Badge>;
}
