import SubmitForm from "./submit-form";
export const dynamic = "force-dynamic";
export default function SubmitPage() {
  const mode = process.env.RECONCILIATION_INTAKE_MODE;
  return (
    <main className="intake-shell">
      <nav className="intake-nav">
        <a className="intake-brand" href="/submit">
          <span>↗</span>Reconciliation
        </a>
        <span className="intake-tag">Synthetic demo only</span>
      </nav>
      <div className="intake-grid">
        <section className="intake-intro">
          <div className="intake-eyebrow">
            Hackathon travel / Attendee intake
          </div>
          <h1>
            You made
            <br />
            the trip.
            <br />
            <em>
              We’ll take it
              <br />
              from here.
            </em>
          </h1>
          <p>
            Submit your travel expense and one receipt. Keep the evidence
            together, ready for reimbursement review.
          </p>
          <ol className="intake-steps">
            <li>
              <b>01</b>
              <div>
                <strong>Share the trip</strong>
                <small>Name, travel category, and requested amount.</small>
              </div>
            </li>
            <li>
              <b>02</b>
              <div>
                <strong>Attach the evidence</strong>
                <small>One receipt. Original file kept for review.</small>
              </div>
            </li>
            <li>
              <b>03</b>
              <div>
                <strong>Ready for review</strong>
                <small>Submission is saved before extraction begins.</small>
              </div>
            </li>
          </ol>
          <p className="intake-note">
            Use fictional names, emails, and receipts only. This unauthenticated
            demo does not issue payments.
          </p>
        </section>
        <section>
          <SubmitForm
            mode={
              mode === "demo"
                ? "demo"
                : mode === "live"
                  ? "live"
                  : "unconfigured"
            }
          />
        </section>
      </div>
      <footer className="intake-footer">
        Travel reimbursement · USD · One receipt per claim
      </footer>
    </main>
  );
}
