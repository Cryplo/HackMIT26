"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Menu, ReceiptText, ScanLine, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import styles from "./business.module.css";

export function AppShell({ view, onViewChange, preview, children }: {
  view: "reviews" | "rules";
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
      <Link href={preview ? "/business-demo?preview=1" : "/business-demo"} className={styles.brand}>
        <ScanLine aria-hidden="true" /> Sift
      </Link>
      <div className={styles.workspaceLabel}>HackMIT · Travel</div>
      <nav aria-label="Workspace" className={styles.navigation}>
        <button type="button" aria-current={view === "reviews" ? "page" : undefined} onClick={() => navigate("reviews")}>
          <ReceiptText aria-hidden="true" /> Reimbursements
        </button>
        <button type="button" aria-current={view === "rules" ? "page" : undefined} onClick={() => navigate("rules")}>
          <SlidersHorizontal aria-hidden="true" /> Learned rules
        </button>
      </nav>
      <div className={styles.sidebarBottom}>
        <Link href="/search"><ReceiptText aria-hidden="true" /> Search stored claims <ArrowUpRight aria-hidden="true" /></Link>
        <Link href="/demo"><BookOpen aria-hidden="true" /> Demo guide <ArrowUpRight aria-hidden="true" /></Link>
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
              <SheetHeader className="sr-only"><SheetTitle>Workspace navigation</SheetTitle><SheetDescription>Switch between reimbursements and learned rules.</SheetDescription></SheetHeader>
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
