"use client";
import { useState, type FormEvent } from "react";
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
    form.set(
      "amount_requested_minor",
      String(Number(whole) * 100 + Number(fraction.padEnd(2, "0"))),
    );
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
    <div className="intake-card">
      <h2>Your travel claim</h2>
      <p className="intro">
        {mode === "demo"
          ? "Local demo · simulated extraction, no AI provider calls."
          : mode === "live"
            ? "Synthetic receipts · live OpenAI extraction."
            : "Intake needs server configuration before submitting."}
      </p>
      <form onSubmit={submit}>
        <div className="intake-fields">
          <label className="intake-wide">
            Attendee name
            <input
              name="attendee_name"
              required
              maxLength={200}
              placeholder="Alex Demo"
              autoComplete="off"
            />
          </label>
          <label className="intake-wide">
            Email address
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              placeholder="alex@example.com"
              autoComplete="off"
            />
          </label>
          <label>
            Requested amount · USD
            <input
              name="amount_usd"
              inputMode="decimal"
              required
              placeholder="125.00"
              pattern="[0-9]+(\.[0-9]{1,2})?"
            />
          </label>
          <label>
            Travel category
            <select name="category" defaultValue="train">
              <option value="flight">Flight</option>
              <option value="hotel">Hotel</option>
              <option value="train">Train</option>
              <option value="bus">Bus</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="intake-wide">
            Traveling from
            <input
              name="origin_location"
              required
              maxLength={200}
              placeholder="New York, NY"
            />
          </label>
          <label className="intake-wide intake-upload">
            Attach one synthetic receipt
            <input
              name="file"
              type="file"
              required
              accept="application/pdf,image/png,image/jpeg"
            />
            <small>
              PDF, PNG, or JPG · Up to 8 MB
              <br />
              Clear, complete receipts help reviewers compare the details.
            </small>
          </label>
        </div>
        <button
          className="intake-button"
          disabled={busy || mode === "unconfigured"}
          type="submit"
        >
          <span>
            {busy ? "Saving & reading receipt…" : "Submit for review"}
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      {error && (
        <div role="alert" className="intake-status error">
          {error}
        </div>
      )}
      {result && (
        <div role="status" className="intake-status">
          <strong>Claim saved. Review is pending.</strong>
          <br />
          {result.extraction_status === "failed"
            ? "We couldn’t extract the receipt. The original is saved for manual review."
            : mode === "demo"
              ? "Extraction was simulated. Bundled sample receipts have fixture fields; other files remain unknown."
              : "Receipt details extracted. An organizer can now run reconciliation."}
          <br />
          <small>Claim {result.submission_id}</small>
          <a
            href={`/api/receipts/${result.receipt_id}`}
            target="_blank"
            rel="noreferrer"
          >
            View saved receipt ↗
          </a>
          <a href="/business-demo">Open organizer dashboard ↗</a>
        </div>
      )}
    </div>
  );
}
