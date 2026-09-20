"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Files, LayoutDashboard, Menu, ReceiptText, ScanLine, SearchCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import styles from "./business.module.css";
import investigationStyles from "./investigations.module.css";

export function AppShell({ view, onViewChange, preview, children }: {
  view: "overview" | "reviews" | "rules" | "investigations";
  onViewChange(view: "reviews" | "rules"): void;
  preview: boolean;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  function navigate(next: "reviews" | "rules") {
    onViewChange(next);
    setMenuOpen(false);
  }
  const navigation = (
    <>
      <Link href={preview ? "/overview?preview=1" : "/overview"} className={styles.brand}>
        <ScanLine aria-hidden="true" /> Sift
      </Link>
      <div className={styles.workspaceLabel}>HackMIT · Travel</div>
      <nav aria-label="Workspace" className={styles.navigation}>
        <Link href={preview ? "/overview?preview=1" : "/overview"} className={investigationStyles.navLink} aria-current={view === "overview" ? "page" : undefined} onClick={() => setMenuOpen(false)}>
          <LayoutDashboard aria-hidden="true" /> Audit overview
        </Link>
        <button type="button" aria-current={view === "reviews" ? "page" : undefined} onClick={() => navigate("reviews")}>
          <ReceiptText aria-hidden="true" /> Reimbursements
        </button>
        <button type="button" aria-current={view === "rules" ? "page" : undefined} onClick={() => navigate("rules")}>
          <SlidersHorizontal aria-hidden="true" /> Learned rules
        </button>
        <Link href={preview ? "/investigations?preview=1" : "/investigations"} className={investigationStyles.navLink} aria-current={view === "investigations" ? "page" : undefined} onClick={() => setMenuOpen(false)}>
          <SearchCheck aria-hidden="true" /> Investigations
        </Link>
      </nav>
      <div className={styles.sidebarBottom}>
        <Link href="/import"><Files aria-hidden="true" /> Import paperwork <ArrowUpRight aria-hidden="true" /></Link>
        <Link href="/submit"><ReceiptText aria-hidden="true" /> Submit a claim <ArrowUpRight aria-hidden="true" /></Link>
        <div className={styles.workspaceIdentity}><span aria-hidden="true">H</span><div>HackMIT 2026<small>Organizer workspace</small></div></div>
      </div>
    </>
  );
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#workspace">Skip to workspace</a>
      <aside className={styles.sidebar}>{navigation}</aside>
      <div className={styles.workspace}>
        <div className={styles.mobileBar}>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open navigation"><Menu /></Button></SheetTrigger>
            <SheetContent side="left" className={styles.mobileNavigation}>
              <SheetHeader className="sr-only"><SheetTitle>Workspace navigation</SheetTitle><SheetDescription>Switch between the audit overview, reimbursements, learned rules, and investigations.</SheetDescription></SheetHeader>
              {navigation}
            </SheetContent>
          </Sheet>
          <span>Sift</span>
        </div>
        <main id="workspace" className={styles.main} tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
