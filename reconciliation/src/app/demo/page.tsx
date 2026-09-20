import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "@/components/business/business.module.css";

export const metadata = { title: "Demo guide · Fieldnotes" };

export default function DemoGuide() {
  return (
    <main className={styles.guide}>
      <nav className={styles.guideNav} aria-label="Demo guide"><Link className={styles.brand} href="/business-demo"><ScanLine aria-hidden="true" /> Fieldnotes</Link><Button asChild variant="ghost"><Link href="/business-demo"><ArrowLeft aria-hidden="true" /> Reimbursements</Link></Button></nav>
      <header className={styles.guideHeader}>
        <span className={styles.guideBadge}>Workspace walkthrough</span>
        <h1>From receipt to reviewed claim.</h1>
        <p>Compare the original evidence, make a human decision, and test a merchant rule before applying it to future reviews.</p>
        <div className={styles.guideActions}><Button asChild><Link href="/business-demo?preview=1">Open synthetic preview <ArrowUpRight aria-hidden="true" /></Link></Button><Button asChild variant="outline"><Link href="/submit">Submit a claim</Link></Button></div>
      </header>
      <ol className={styles.guideSteps}>
        <li><div><h2>Start with the review queue</h2><p>The preview has six fictional claims, including a matching receipt, an overclaim, an ambiguous merchant, an approved exception, a rejected duplicate, and failed extraction. Needs review shows pending human decisions; use All to see every case.</p></div></li>
        <li><div><h2>Compare claim and receipt</h2><p>Open a claim to view its original receipt beside the extracted evidence. Assessment describes the machine checks. Decision records a human approval or rejection. A machine match is still awaiting a human decision.</p></div></li>
        <li><div><h2>Record a decision</h2><p>Inspect Sam Example’s merchant evidence and enter a reason before confirming approval or rejection. Failed financial or duplicate checks block approval. Rechecking a claim updates its assessment and preserves the human decision.</p></div></li>
        <li><div><h2>Test a merchant name before remembering it</h2><p>For an eligible approved exception, choose Remember this merchant name and propose its canonical name. In Learned rules, test the draft, inspect the before-and-after outcomes and rejection reasons, then activate a passing current report. Recheck related claims explicitly to use the new rule.</p></div></li>
        <li><div><h2>Search the evidence</h2><p>Typing filters claimant, email, and merchant immediately. Submit AI search to search meaning within your selected filters. Confirmed and possible matches appear separately. When the queue changes, search results are marked stale until you search again.</p></div></li>
        <li><div><h2>Try intake against the API</h2><p>The submission form sends your claim and original PDF, PNG, or JPG to the application API. Failed extraction retains the document for review and retry. Uploads are separate from the in-memory preview; they appear in the API workspace once the v2 backend is available.</p></div></li>
      </ol>
      <div className={styles.guideNote}><p><strong>Preview limits.</strong> Preview changes reset when the page reloads. Receipt examples, rule tests, and semantic search are synthetic and simulated; their results do not measure live AI accuracy. The normal workspace requires the v2 review API and displays an explicit error if the server still uses v1. Live provider behavior depends on the server configuration shown in the workspace.</p><p className="mt-3">Approval authorizes reimbursement. This prototype does not send payments.</p></div>
    </main>
  );
}
