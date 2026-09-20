import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { SiftLogo } from "@/components/SiftLogo";
import { Button } from "@/components/ui/button";
import SubmitForm from "./submit-form";

export const dynamic = "force-dynamic";
export default function SubmitPage() {
  const mode = process.env.RECONCILIATION_EXTRACTION_MODE || process.env.RECONCILIATION_INTAKE_MODE;
  return (
    <main className="min-h-dvh bg-muted/40 text-foreground">
      <nav aria-label="Main navigation" className="flex h-16 items-center justify-between border-b border-border bg-background px-4 sm:px-8">
        <Link href="/business-demo" className="flex items-center gap-2 text-sm font-semibold"><SiftLogo /></Link>
        <Button asChild variant="ghost" className="h-11 sm:h-9"><Link href="/business-demo"><ArrowLeft aria-hidden="true" />Review workspace</Link></Button>
      </nav>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-6">
          <p className="mb-2 text-xs text-muted-foreground">Travel reimbursements</p>
          <h1 className="text-[28px] leading-9 font-semibold tracking-tight">Submit a travel claim</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Share your expense and original receipt. An organizer will review the details before approving reimbursement.</p>
        </div>
        <SubmitForm mode={mode === "demo" ? "demo" : mode === "live" ? "live" : "unconfigured"} />
        <aside className="mt-6 rounded-lg border border-border bg-background px-5 py-4 text-sm leading-6">
          <p className="font-medium">Trying the demo?</p>
          <p className="mt-1 text-muted-foreground">Use fictional names, emails, and receipts only. This demo does not issue payments.</p>
          <a className="mt-2 inline-flex min-h-11 items-center gap-1 underline underline-offset-4 sm:min-h-0" href="/api/demo/receipt/train">Download a sample receipt <ArrowUpRight className="size-4" aria-hidden="true" /></a>
          <p className="mt-1 text-xs text-muted-foreground">Sample: Alex Demo · Train · $123.45 · New York</p>
        </aside>
      </div>
    </main>
  );
}
