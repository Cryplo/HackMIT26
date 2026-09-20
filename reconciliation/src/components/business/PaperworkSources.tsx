import Link from "next/link";
import { ArrowRight, FileCheck2, ClipboardList, Mail, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./paperwork-sources.module.css";

export function PaperworkSources() {
  return <section className={styles.panel} aria-labelledby="data-sources-heading">
    <div className={styles.heading}>
      <div>
        <h2 id="data-sources-heading">Data sources</h2>
        <p>Different places. One review queue.</p>
      </div>
      <Button asChild size="sm"><Link href="/import">Explore sample inputs<ArrowRight aria-hidden="true" /></Link></Button>
    </div>
    <div className={styles.flow}>
      <div className={styles.sources}>
        <Link href="/submit"><ClipboardList aria-hidden="true" /><span>Google Forms<small>Reimbursement responses</small><em>Demo form</em></span><ArrowRight aria-hidden="true" /></Link>
        <Link href="/import"><Mail aria-hidden="true" /><span>Email<small>Requests and attachments</small><em>Demo source</em></span><ArrowRight aria-hidden="true" /></Link>
        <Link href="/import"><FolderOpen aria-hidden="true" /><span>Dropbox folder<small>Receipts and bookings</small><em>Demo source</em></span><ArrowRight aria-hidden="true" /></Link>
      </div>
      <div className={styles.outcomes} aria-label="Source intake workflow">
        <ArrowRight className={styles.connector} aria-hidden="true" />
        <span><FileCheck2 aria-hidden="true" /><strong>Organize &amp; confirm</strong><small>Then enter the audit below</small></span>
      </div>
    </div>
    <p className={styles.caption}>Demo inputs · no accounts connected. Try Sift’s form or sample files in place of live form, email, and folder connections.</p>
  </section>;
}
