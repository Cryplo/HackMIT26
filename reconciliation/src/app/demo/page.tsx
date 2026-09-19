export default function DemoGuide() {
  return <main className="intake-shell">
    <nav className="intake-nav"><a className="intake-brand" href="/business-demo">↗ Fieldnotes</a><a href="/submit">Submit a claim ↗</a></nav>
    <section className="intake-card" style={{ marginTop: 32, maxWidth: 860 }}>
      <div className="intake-eyebrow">A three-minute walkthrough</div>
      <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', margin: '16px 0' }}>A correction that carries forward.</h1>
      <p>Use the seeded organizer ledger to see a clean claim, a duplicate, and a merchant alias that needs a human. Local demo mode uses simulated judgments, not live AI. All people and receipts are fictional.</p>
      <ol className="intake-steps">
        <li><b>01</b><div><strong>Run the first review</strong><p>Open the <a href="/business-demo">organizer dashboard</a>, select all five claims individually, then click Reconcile selected. Alex’s first flight passes; the second is a duplicate. Sam, Taylor, and Jordan need review.</p></div></li>
        <li><b>02</b><div><strong>Inspect the evidence</strong><p>Open Evidence on Alex’s duplicate and inspect the duplicate check. Open its original receipt. The two claims reference the same purchase.</p></div></li>
        <li><b>03</b><div><strong>Teach one narrow fact</strong><p>Open Sam Example’s Evidence, then Correct &amp; teach. Choose Reusable vendor alias. Leave the observed merchant as <code>SYN HBR 042</code>; enter <code>Synthetic Harbor Hotel</code> as the canonical merchant. Choose Approved and add a note explaining this fictional hotel billing descriptor. Save correction.</p></div></li>
        <li><b>04</b><div><strong>Test a new case and a counterexample</strong><p>Select only Taylor Example and Jordan Example; reconcile again. Taylor’s hotel claim now passes using the scoped correction. Jordan’s flight stays under review: a hotel alias does not establish a flight merchant. Approved amount is $615.00, and review rate drops from 80% to 40%.</p></div></li>
        <li><b>05</b><div><strong>Try the entire upload flow</strong><p><a href="/api/demo/receipt/train">Download the sample train PDF</a>. On <a href="/submit">the submission form</a>, enter Alex Demo, any fictional email, $123.45, Train, and New York. Upload the PDF, open the dashboard, and reconcile the new row. Upload the identical receipt again to see a duplicate.</p></div></li>
      </ol>
      <p>Demo extraction recognizes only exact bundled PDFs. Arbitrary images or PDFs remain unknown until live OpenAI extraction is configured. Refreshing or restarting preserves uploaded files, decisions, and corrections.</p>
      <h2 style={{ marginTop: 28 }}>Demo policy</h2>
      <p>USD only. Receipts dated September 1–30, 2026. Per-claim caps: flight $500, hotel $250, train $200, bus $100, other $50. Requested and receipt amounts must match exactly. This prototype approves claims for review purposes and never sends payments.</p>
      <h2 style={{ marginTop: 28 }}>Start fresh</h2>
      <p>Stop the local app, run <code>npm run demo:reset -- --confirm</code>, then <code>npm run demo</code>. Reset archives the previous local dataset. These numbers describe the five seeded claims before additional uploads.</p>
    </section>
  </main>;
}
