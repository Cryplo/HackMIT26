"use client";

import { useRef, type RefObject } from "react";
import { ArrowUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { money, statusLabel } from "@/lib/dashboard/helpers";
import { claimReason } from "@/lib/dashboard/human-actions";
import type { ReviewRow } from "@/lib/dashboard/types";
import styles from "./audit-flow.module.css";

export function AuditClaimsDialog({ title, items, open, onOpenChange, onReview, returnFocusRef }: {
  title: string; items: { row: ReviewRow; label: string }[]; open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange(open: boolean): void; onReview(id: string): void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.expandedDialog} onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { event.preventDefault(); (returnFocusRef?.current ?? returnFocus.current)?.focus(); }}>
      <div className={styles.expandedHeading}><DialogTitle>{title}</DialogTitle><DialogDescription>{items.length} {items.length === 1 ? "claim" : "claims"} · Live details from this audit. Open a claim to see its full evidence and review.</DialogDescription></div>
      <div className={styles.expandedBody}>
        {items.length ? <ul className={styles.expandedClaims}>{items.map(({ row, label }) => <li key={row.id}>
          <div className={styles.expandedClaimHeading}><div><h3>{row.attendee_name}</h3><p>{row.email}</p></div><strong>{money(row.amount_requested_minor, row.currency)}</strong></div>
          <dl className={styles.expandedFacts}>
            <div><dt>Status</dt><dd>{label}</dd></div>
            <div><dt>Category</dt><dd>{statusLabel(row.category)}</dd></div>
            <div><dt>Merchant</dt><dd>{row.receipt?.parsed_fields_json?.vendor || "Not available"}</dd></div>
            <div><dt>Receipt date</dt><dd>{row.receipt?.parsed_fields_json?.receipt_date || "Not available"}</dd></div>
          </dl>
          <p className={styles.expandedReason}>{claimReason(row)}</p>
          <Button variant="outline" onClick={() => { onOpenChange(false); onReview(row.id); }}>View claim<ArrowUpRight aria-hidden="true" /></Button>
        </li>)}</ul> : <p className={styles.emptyQueue}>No claims in {title.toLowerCase()}.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
