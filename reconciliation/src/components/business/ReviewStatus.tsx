import { Check, Circle, CircleCheck, CircleX, Clock3, TriangleAlert } from "lucide-react";
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
  const [label, Icon, color] = status === "matched"
    ? ["Matched", Check, tone.good]
    : status === "flagged"
      ? ["Flagged", TriangleAlert, tone.bad]
      : status === "needs_review"
        ? ["Needs review", Circle, tone.review]
        : processingStatus === "running"
          ? ["Checking", Clock3, tone.neutral]
          : processingStatus === "failed"
            ? ["Check failed", TriangleAlert, tone.bad]
            : ["Not checked", Circle, tone.neutral];
  return <Badge variant="secondary" className={`h-6 rounded px-1.5 ${color}`}><Icon aria-hidden="true" />{label}</Badge>;
}

export function DecisionBadge({ status }: { status: HumanDecision }) {
  const [label, Icon, color] = status === "approved"
    ? ["Approved", CircleCheck, tone.good]
    : status === "rejected"
      ? ["Rejected", CircleX, tone.bad]
      : ["Pending", Clock3, tone.neutral];
  return <Badge variant="secondary" className={`h-6 rounded px-1.5 ${color}`}><Icon aria-hidden="true" />{label}</Badge>;
}
