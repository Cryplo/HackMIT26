"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReviewRow, WorkspaceCapabilities } from "@/lib/review-contracts";
import { money, statusLabel } from "@/lib/dashboard/helpers";
import { amountDelta, nextAction } from "@/lib/dashboard/review";
import { AssessmentBadge, DecisionBadge } from "./ReviewStatus";
import styles from "./business.module.css";

export function ReviewTable({ rows, selected, activeId, busy, knowledgeRevision, capabilities, onSelect, onSelectVisible, onOpen, label = "Reimbursement claims" }: {
  rows: ReviewRow[];
  selected: string[];
  activeId: string | null;
  busy: boolean;
  knowledgeRevision: number;
  capabilities?: WorkspaceCapabilities;
  onSelect(id: string): void;
  onSelectVisible(ids: string[], checked: boolean): void;
  onOpen(id: string): void;
  label?: string;
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const someSelected = rows.some((row) => selected.includes(row.id));
  return (
    <div className={styles.tableRegion} role="region" aria-label={label} tabIndex={0}>
      <Table className={styles.table}>
        <caption className="sr-only">{label}. Open a claim to compare the original receipt and review its evidence.</caption>
        <TableHeader>
          <TableRow>
            <TableHead className={styles.checkboxCell}>
              <Checkbox aria-label={`Select all ${label.toLowerCase()}`} checked={allSelected ? true : someSelected ? "indeterminate" : false} disabled={busy || !rows.length || (!someSelected && selected.length >= 1000)} onCheckedChange={(checked) => onSelectVisible(rows.map((row) => row.id), checked === true)} />
            </TableHead>
            <TableHead>Claimant</TableHead>
            <TableHead>Merchant</TableHead>
            <TableHead className={styles.numeric}>Claimed</TableHead>
            <TableHead className={styles.numeric}>Receipt</TableHead>
            <TableHead className={styles.numeric}>Delta</TableHead>
            <TableHead>Assessment</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>Next</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-state={selected.includes(row.id) ? "selected" : undefined} className={activeId === row.id ? styles.activeRow : undefined} onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a, input, [role='checkbox']")) return;
              event.currentTarget.querySelector<HTMLButtonElement>("[data-open-claim]")?.focus();
              onOpen(row.id);
            }}>
              <TableCell className={styles.checkboxCell}>
                <Checkbox aria-label={`Select ${row.attendee_name}`} checked={selected.includes(row.id)} disabled={busy || (!selected.includes(row.id) && selected.length >= 1000)} onCheckedChange={() => onSelect(row.id)} />
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
              <TableCell><AssessmentBadge status={row.assessment_status} processingStatus={row.processing_status} /></TableCell>
              <TableCell><DecisionBadge status={row.decision_status} /></TableCell>
              <TableCell className={styles.actionCell}><Button variant="ghost" aria-label={`${nextAction(row, knowledgeRevision, capabilities)}: ${row.attendee_name}`} aria-haspopup="dialog" onClick={() => onOpen(row.id)}>{nextAction(row, knowledgeRevision, capabilities)}</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
