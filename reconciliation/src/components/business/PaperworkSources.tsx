import Link from "next/link";
import { ArrowRight, FileCheck2, Images, Mail, ScanLine, Tickets } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./paperwork-sources.module.css";

export function PaperworkSources() {
  return <section className={styles.panel} aria-labelledby="paperwork-sources-heading">
    <div className={styles.heading}>
      <div>
        <h2 id="paperwork-sources-heading">Paperwork sources</h2>
        <p>Bring files together. Confirm the case. Review the exceptions.</p>
      </div>
      <Button asChild size="sm"><Link href="/import">Import paperwork<ArrowRight aria-hidden="true" /></Link></Button>
    </div>
    <div className={styles.flow}>
      <div className={styles.sources}>
        <Link href="/import"><Images aria-hidden="true" /><span>Receipts &amp; photos<small>Scans, PDFs, snapshots</small></span></Link>
        <Link href="/import"><Tickets aria-hidden="true" /><span>Booking documents<small>Tickets and confirmations</small></span></Link>
        <Link href="/import"><Mail aria-hidden="true" /><span>Email PDFs<small>Requests and conversations</small></span></Link>
      </div>
      <div className={styles.outcomes} aria-label="Paperwork workflow">
        <ArrowRight className={styles.connector} aria-hidden="true" />
        <span><FileCheck2 aria-hidden="true" /><strong>Confirm cases</strong><small>With linked evidence</small></span>
        <ArrowRight aria-hidden="true" />
        <span><ScanLine aria-hidden="true" /><strong>Review exceptions</strong><small>In your audit below</small></span>
      </div>
    </div>
    <p className={styles.caption}>Upload files from your device, or <Link href="/submit">submit a completed claim</Link>.</p>
  </section>;
}
