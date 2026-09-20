import Link from "next/link";
import { ArrowLeft, Files, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import ImportWorkspace from "./import-workspace";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const mode = process.env.RECONCILIATION_EXTRACTION_MODE || process.env.RECONCILIATION_INTAKE_MODE;
  return (
    <main className="min-h-dvh bg-muted/40 text-foreground">
      <nav aria-label="Main navigation" className="flex h-16 items-center justify-between border-b border-border bg-background px-4 sm:px-8">
        <Link href="/business-demo" className="flex items-center gap-2 text-sm font-semibold"><ScanLine className="size-5" aria-hidden="true" />Sift</Link>
        <Button asChild variant="ghost"><Link href="/business-demo"><ArrowLeft aria-hidden="true" />Review workspace</Link></Button>
      </nav>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-7 max-w-2xl">
          <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Files className="size-4" aria-hidden="true" />Document inbox</p>
          <h1 className="text-3xl font-semibold tracking-tight">Close out the event. Start with the paperwork.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Bring scattered receipts, bookings, and requests together. See what is ready, what does not add up, and who needs a follow-up.</p>
        </div>
        <ImportWorkspace simulatedReview={process.env.RECONCILIATION_MODE === "simulated"} mode={mode === "demo" ? "demo" : mode === "live" ? "live" : "unconfigured"} />
      </div>
    </main>
  );
}
