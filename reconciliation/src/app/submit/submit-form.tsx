"use client";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Result = {
  submission_id: string;
  receipt_id: string;
  extraction_status: string;
};
export default function SubmitForm({
  mode,
}: {
  mode: "demo" | "live" | "unconfigured";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    const form = new FormData(event.currentTarget);
    const amount = String(form.get("amount_usd"));
    form.delete("amount_usd");
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError("Enter a USD amount with no more than two decimal places.");
      setBusy(false);
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 2147483647) {
      setError("Enter an amount between $0.00 and $21,474,836.47.");
      setBusy(false);
      return;
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024 ||
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setError("Attach one PDF, PNG, or JPG receipt up to 8 MB.");
      setBusy(false);
      return;
    }
    form.set("amount_requested_minor", String(cents));
    form.set("currency", "USD");
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Submission failed.");
      setResult(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Submission failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border border-border bg-background p-5 sm:p-6" aria-labelledby="claim-form-heading">
      <h2 id="claim-form-heading" className="text-base font-semibold">Your travel claim</h2>
      <p className="mt-1 mb-6 text-xs leading-5 text-muted-foreground">
        {mode === "demo" ? "Simulated extraction."
          : mode === "live" ? "Live OpenAI extraction."
          : "Intake needs server configuration before submitting."}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="attendee-name">Attendee name</Label>
            <Input id="attendee-name" className="h-11 sm:h-9" name="attendee_name" required maxLength={200} placeholder="Alex Demo" autoComplete="off" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="email">Email address</Label>
            <Input id="email" className="h-11 sm:h-9" name="email" type="email" required maxLength={254} placeholder="alex@example.invalid" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Requested amount · USD</Label>
            <Input id="amount" className="h-11 tabular-nums sm:h-9" name="amount_usd" inputMode="decimal" required placeholder="123.45" pattern="[0-9]+(\.[0-9]{1,2})?" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Travel category</Label>
            <select id="category" name="category" defaultValue="train" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9">
              <option value="flight">Flight</option><option value="hotel">Hotel</option><option value="train">Train</option><option value="bus">Bus</option><option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="origin">Traveling from</Label>
            <Input id="origin" className="h-11 sm:h-9" name="origin_location" required maxLength={200} placeholder="New York, NY" />
          </div>
          <div className="space-y-3 rounded-md border border-dashed border-input bg-muted/40 p-4 sm:col-span-2">
            <Label htmlFor="receipt">Attach your receipt</Label>
            <input id="receipt" name="file" type="file" required accept="application/pdf,image/png,image/jpeg" aria-describedby="receipt-help" className="min-h-11 w-full min-w-0 rounded-sm text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm focus-visible:outline-2 focus-visible:outline-ring" />
            <p id="receipt-help" className="text-xs text-muted-foreground">PDF, PNG, or JPG · Up to 8 MB. Keep the full receipt visible.</p>
          </div>
        </fieldset>
        <div className="mt-6 flex justify-end border-t border-border pt-5">
          <Button className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy || mode === "unconfigured"} type="submit">
            {busy && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
            {busy ? "Saving & reading receipt…" : "Submit for review"}
            {!busy && <ArrowUpRight className="size-4" aria-hidden="true" />}
          </Button>
        </div>
      </form>
      {error && <div role="alert" className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {result && (
        <div role="status" className="mt-4 space-y-2 rounded-md border border-border bg-muted/50 p-4 text-sm leading-6">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />Claim saved. Review is pending.</p>
          <p>{result.extraction_status === "failed"
            ? "We couldn’t extract the receipt. Open this saved claim to retry extraction when available; the original is retained."
            : mode === "demo"
              ? "Receipt details extracted in simulation. An organizer can now run reconciliation."
              : "Receipt details extracted. An organizer can now run reconciliation."}</p>
          <p className="break-all text-xs text-muted-foreground">Claim {result.submission_id}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/api/receipts/${result.receipt_id}`} target="_blank" rel="noreferrer">View saved receipt ↗</a>
            <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/business-demo?claim=${encodeURIComponent(result.submission_id)}`}>Open saved claim ↗</a>
          </div>
        </div>
      )}
    </section>
  );
}
