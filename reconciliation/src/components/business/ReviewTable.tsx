"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReviewRow, WorkspaceCapabilities } from "@/lib/review-contracts";
import { money, statusLabel } from "@/lib/dashboard/helpers";
import { amountDelta, nextAction } from "@/lib/dashboard/review";
import { ClaimStatusBadge } from "./ReviewStatus";
import styles from "./business.module.css";

export function ReviewTable({ rows, selected, activeId, busy, checkingIds = [], knowledgeRevision, capabilities, onSelect, onSelectVisible, onOpen, label = "Reimbursement claims" }: {
  rows: ReviewRow[];
  selected: string[];
  activeId: string | null;
  busy: boolean;
  checkingIds?: string[];
  knowledgeRevision: number;
  capabilities?: WorkspaceCapabilities;
  onSelect(id: string): void;
  onSelectVisible(ids: string[], checked: boolean): void;
  onOpen(id: string): void;
  label?: string;
}) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(rows.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageRows = rows.slice(currentPage * 50, currentPage * 50 + 50);
  const selectedIds = new Set(selected);
  const checking = new Set(checkingIds);
  const allSelected = rows.length > 0 && rows.every(row => selectedIds.has(row.id));
  const someSelected = rows.some(row => selectedIds.has(row.id));
  return (
    <>
    <div className={styles.tableRegion} role="region" aria-label={label} tabIndex={0}>
      <Table className={styles.table}>
        <caption className="sr-only">{label}. Open a claim to compare the original receipt and review its evidence.</caption>
        <TableHeader>
          <TableRow>
            <TableHead className={styles.checkboxCell}>
              <Checkbox aria-label={`Select all ${rows.length} ${label.toLowerCase()}`} checked={allSelected ? true : someSelected ? "indeterminate" : false} disabled={busy || !rows.length || (!someSelected && selected.length >= 1000)} onCheckedChange={(checked) => onSelectVisible(rows.map((row) => row.id), checked === true)} />
            </TableHead>
            <TableHead>Claimant</TableHead>
            <TableHead>Merchant</TableHead>
            <TableHead className={styles.numeric}>Claimed</TableHead>
            <TableHead className={styles.numeric}>Receipt</TableHead>
            <TableHead className={styles.numeric}>Delta</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row) => (
            <TableRow key={row.id} data-state={selectedIds.has(row.id) ? "selected" : undefined} className={activeId === row.id ? styles.activeRow : undefined}>
              <TableCell className={styles.checkboxCell}>
                <Checkbox aria-label={`Select ${row.attendee_name}`} checked={selectedIds.has(row.id)} disabled={busy || (!selectedIds.has(row.id) && selected.length >= 1000)} onCheckedChange={() => onSelect(row.id)} />
              </TableCell>
              <TableCell>
                <div className={styles.claimant}>
                  <span className={styles.avatar} aria-hidden="true">{row.attendee_name.split(" ").filter(Boolean).slice(0, 2).map((name) => name[0]).join("")}</span>
                  <button type="button" data-open-claim aria-label={`Open ${row.attendee_name}'s claim`} aria-haspopup="dialog" aria-expanded={activeId === row.id} onClick={() => onOpen(row.id)} className={styles.claimButton}>{row.attendee_name}</button>
                </div>
              </TableCell>
              <TableCell><span className={styles.merchant}>{row.receipt?.parsed_fields_json?.vendor ?? "—"}</span><span className={styles.cellMeta}>{statusLabel(row.category)}</span></TableCell>
              <TableCell className={styles.numeric}>{money(row.amount_requested_minor, row.currency)}</TableCell>
              <TableCell className={styles.numeric}>{money(row.receipt?.parsed_fields_json?.amount_minor, row.receipt?.parsed_fields_json?.currency ?? null)}{row.receipt?.extraction_status === "failed" && <span className={styles.extractionFailed}>Extraction failed</span>}</TableCell>
              <TableCell className={styles.numeric}>{amountDelta(row).label}</TableCell>
              <TableCell><ClaimStatusBadge row={checking.has(row.id) ? { ...row, processing_status: "running" } : row} /></TableCell>
              <TableCell className={styles.actionCell}><Button variant="outline" title={nextAction(row, knowledgeRevision, capabilities)} aria-label={`${row.decision_status === "pending" ? "Review claim" : "View decision"}: ${row.attendee_name}`} aria-haspopup="dialog" aria-expanded={activeId === row.id} onClick={() => onOpen(row.id)}>{row.decision_status === "pending" ? "Review claim" : "View decision"}</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    {rows.length > 50 && <nav className={styles.pagination} aria-label={`${label} pages`}><span>{currentPage * 50 + 1}–{Math.min((currentPage + 1) * 50, rows.length)} of {rows.length} · Select all includes every filtered claim</span><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="outline" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</Button></nav>}
    </>
  );
}
