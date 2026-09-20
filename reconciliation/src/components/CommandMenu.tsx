"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Files, LayoutDashboard, ListChecks, ReceiptText, Search, SearchCheck, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import styles from "./command-menu.module.css";

const destinations = [
  { label: "Audit overview", description: "Follow checks and review exceptions", href: "/overview", keywords: "dashboard home waiting approved rejected", icon: LayoutDashboard, preview: true },
  { label: "Data sources", description: "Browse and import source documents", href: "/import", keywords: "inbox upload files email spreadsheet", icon: Files },
  { label: "Reimbursements", description: "Search and review claims", href: "/business-demo?view=reviews", keywords: "expenses receipts semantic search", icon: ReceiptText, preview: true },
  { label: "Checks", description: "Manage custom Jev checks", href: "/business-demo?view=checks", keywords: "conditions validation policy", icon: ListChecks, preview: true },
  { label: "Learned rules", description: "Review reusable evidence checks", href: "/business-demo?view=rules", keywords: "procedures learning aliases", icon: SlidersHorizontal, preview: true },
  { label: "Investigations", description: "View investigation history and findings", href: "/investigations", keywords: "agents evidence audit history", icon: SearchCheck, preview: true },
  { label: "Submit a claim", description: "Upload a new expense and receipt", href: "/submit", keywords: "new reimbursement travel form", icon: ArrowUpRight },
];
const OpenMenu = createContext<() => void>(() => {});

export function CommandMenuTrigger() {
  const open = useContext(OpenMenu);
  return <button type="button" className={styles.trigger} onClick={open} aria-label="Jump to section" aria-haspopup="dialog"><Search aria-hidden="true" /><span>Jump to…</span><kbd>⌘ / Ctrl K</kbd></button>;
}

export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = destinations.filter(item => terms.every(term => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(term)))
    .sort((a, b) => {
      const rank = (item: typeof destinations[number]) => item.label.toLowerCase() === query.trim().toLowerCase() ? 2 : terms.every(term => item.label.toLowerCase().includes(term)) ? 1 : 0;
      return rank(b) - rank(a);
    });
  function show() {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(""); setActive(0); setOpen(true);
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k" && !event.isComposing) {
        event.preventDefault();
        if (event.repeat) return;
        if (open) setOpen(false); else show();
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, listId, open]);
  function jump(item: typeof destinations[number]) {
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    const href = item.href + (preview && item.preview ? `${item.href.includes("?") ? "&" : "?"}preview=1` : "");
    setOpen(false);
    router.push(href);
  }
  return <OpenMenu.Provider value={show}>{children}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={styles.dialog} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}>
        <DialogTitle className="sr-only">Jump to section</DialogTitle>
        <DialogDescription className="sr-only">Search Sift sections. Use arrow keys to choose a destination and Enter to open it.</DialogDescription>
        <div className={styles.search}><Search aria-hidden="true" /><input ref={input} role="combobox" aria-label="Search sections" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={matches.length ? `${listId}-${active}` : undefined} placeholder="Where would you like to go?" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (matches.length) setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length); }
          if (event.key === "Enter") { event.preventDefault(); if (matches[active]) jump(matches[active]); }
        }} /></div>
        <div className={styles.results} role="listbox" aria-label="Sections" id={listId}>
          {matches.map((item, index) => <button key={item.href} type="button" role="option" aria-selected={active === index} id={`${listId}-${index}`} tabIndex={-1} className={styles.option} onMouseMove={() => setActive(index)} onClick={() => jump(item)}><item.icon aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowUpRight aria-hidden="true" /></button>)}
        </div>
        {!matches.length && <p className={styles.empty} role="status">No matching sections. Try “claims”, “checks”, or “sources”.</p>}
        <footer className={styles.footer}><span>↑ ↓ to navigate</span><span>Enter to open</span><span>Esc to close</span></footer>
      </DialogContent>
    </Dialog>
  </OpenMenu.Provider>;
}
