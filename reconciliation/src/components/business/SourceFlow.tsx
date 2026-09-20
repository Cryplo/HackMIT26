"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { readSourceActivity, type SourceActivity } from '@/lib/inbox/activity';
import { SourceIcon, sourceNames } from './SourceIcon';
import styles from './audit-flow.module.css';

export function useSourceActivity() {
  const [items, setItems] = useState<SourceActivity[]>([]);
  useEffect(() => {
    const update = () => setItems(readSourceActivity());
    update();
    window.addEventListener('storage', update);
    window.addEventListener('sift-source-activity', update);
    const timer = window.setInterval(update, 5000);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('sift-source-activity', update); window.clearInterval(timer); };
  }, []);
  return items;
}
export function SourceFlow({ items, reading: activeInput }: { items: SourceActivity[]; reading?: { name: string; source: string } | null }) {
  const reading = items.filter(item => item.status === 'reading' && Date.now() - item.at < 90000);
  const failed = items.filter(item => item.status === 'failed' || (item.status === 'reading' && Date.now() - item.at >= 90000));
  const parsed = items.filter(item => item.status === 'parsed');
  const confirmed = items.filter(item => item.status === 'confirmed');
  return <section className={styles.sourceIntake} data-flow-node="sources" aria-label="Sources into the audit">
    <div className={styles.sourceFlowHeader}><strong>Incoming sources</strong><Link href="/import">Manage sources<ArrowUpRight aria-hidden="true" /></Link></div>
    <div className={styles.sourceFeeds}>{(['forms','email','dropbox','upload'] as const).map(source => {
      const rows = items.filter(item => item.source === source);
      const current = activeInput?.source === source ? activeInput : rows.find(item => reading.includes(item));
      const latest = rows.at(-1);
      return <Link href="/import" key={source} data-reading={!!current}><SourceIcon source={source} size={25} /><span><strong>{sourceNames[source]}</strong><small>{current ? 'Reading input…' : latest && failed.includes(latest) ? 'Could not read input' : latest ? `${rows.length} received` : 'Browse inputs'}</small><em>{current?.name || latest?.name || (source === 'forms' ? 'Response rows' : source === 'email' ? 'Messages & attachments' : source === 'dropbox' ? 'Folder files' : 'Drag & drop')}</em></span>{current && <LoaderCircle className={styles.spinner} aria-hidden="true" />}</Link>;
    })}</div>
    <div className={styles.sourceFlowStatus}>{reading.length ? <><LoaderCircle className={styles.spinner} />Reading {reading.length} input{reading.length === 1 ? '' : 's'}</> : <span>{items.length ? `${parsed.length} parsed · ${confirmed.length} source files linked to saved cases${failed.length ? ` · ${failed.length} need attention` : ''}` : 'Open sources to read the sample inputs'}</span>}<small>Sample workspace · activity from this browser</small></div>
  </section>;
}
