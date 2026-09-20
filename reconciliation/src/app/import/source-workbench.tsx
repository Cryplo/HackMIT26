"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, LoaderCircle, Plug, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SourceIcon, sourceNames, type SourceKind } from '@/components/business/SourceIcon';
import type { InboxDocument } from '@/lib/inbox/schema';
import styles from './source-workbench.module.css';
import { SourcePreview } from './source-preview';
import { spreadsheetRows, spreadsheetResponse } from '@/lib/inbox/source-preview';

export type SourceSample = { name: string; sha256: string; source: SourceKind; file_type: string; url: string; preview: string };
async function textHash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function SourceWorkbench({ documents, busy, onRead, children }: { children?: ReactNode; documents: InboxDocument[]; busy: boolean; onRead(samples: SourceSample[]): void }) {
  const [catalog, setCatalog] = useState<SourceSample[]>([]);
  const [error, setError] = useState('');
  const [source, setSource] = useState<SourceKind>('forms');
  const [selected, setSelected] = useState('');
  const [connection, setConnection] = useState<SourceKind | null>(null);
  const [responseIndex, setResponseIndex] = useState(0);
  const [rowIdentity, setRowIdentity] = useState<{ text: string; sha256: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/inbox/samples', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load inputs. Reload to try again.');
      setCatalog((await response.json()).samples);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  const unread = catalog.filter(sample => !(sample.file_type === 'text/csv' && spreadsheetRows(sample.preview).length > 2) && !documents.some(document => document.sha256 === sample.sha256));
  const items: SourceSample[] = source === 'upload' ? documents.map(document => ({ name: document.filename, sha256: document.sha256, source: 'upload', file_type: document.file_type, url: `/api/inbox/${document.id}`, preview: document.evidence?.raw_extracted_text || document.error || '' })) : catalog.filter(s => s.source === source);
  const sample = items.find(s => s.name === selected) || items[0];
  const responseRows = sample?.file_type === 'text/csv' ? spreadsheetRows(sample.preview).slice(1) : [];
  const batch = responseRows.length > 1;
  const rowIndex = Math.min(responseIndex, Math.max(0, responseRows.length - 1));
  const rowName = rowIndex === 0 ? 'Ava-response.csv' : `event-form-response-row-${rowIndex + 1}.csv`;
  const rowText = batch ? spreadsheetResponse(sample.preview, rowIndex) : '';
  const rowUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(rowText)}`;
  useEffect(() => {
    let cancelled = false;
    if (rowText) void textHash(rowText).then(sha256 => { if (!cancelled) setRowIdentity({ text: rowText, sha256 }); });
    return () => { cancelled = true; };
  }, [rowText]);
  const document = documents.find(d => d.sha256 === sample?.sha256 || (batch && rowIdentity?.text === rowText && d.sha256 === rowIdentity.sha256));
  const facts = document?.evidence?.facts, request = document?.evidence?.request;
  async function readSelected() {
    if (!sample) return;
    if (!batch) { onRead([sample]); return; }
    const sha256 = await textHash(rowText);
    onRead([{ ...sample, name: rowName, url: rowUrl, preview: rowText, sha256 }]);
  }
  return <section className={styles.workbench} aria-label="Connected sources and input explorer">
    <div className={styles.connections}>{(['forms','email','dropbox'] as const).map(kind => <article key={kind}>
      <SourceIcon source={kind} size={34} /><h2>{sourceNames[kind]}</h2>
      <p>{kind === 'forms' ? 'Form responses and expense requests' : kind === 'email' ? 'Conversations and attachments' : 'Receipts, scans, and booking files'}</p>
      <div><Button variant="outline" size="sm" onClick={() => setConnection(kind)}><Plug size={14} />Connect</Button><button className={styles.browse} onClick={() => { setSource(kind); setSelected(''); }}>View inputs<ArrowRight size={13} /></button></div>
    </article>)}</div>
    {children}
    <div className={styles.explorerHeading}><div><h2>See what comes in. See what Sift finds.</h2><p>Connected sources feed this workspace. Read all uses Ava’s one-row export; choose other spreadsheet responses individually.</p></div><Button disabled={busy || !unread.length} onClick={() => onRead(unread)}><Sparkles size={15} />{documents.length ? unread.length ? "Read remaining inputs" : "All inputs read" : "Read all inputs"}</Button></div>
    {error && <p role="alert">{error}</p>}
    <div className={styles.explorer}>
      <div className={styles.inputList}><div className={styles.tabs} role="group" aria-label="Source">{(['forms','email','dropbox','upload'] as const).map(kind => <button key={kind} aria-pressed={source === kind} aria-label={sourceNames[kind]} onClick={() => { setSource(kind); setSelected(''); }}><SourceIcon source={kind} size={21} /></button>)}</div><strong>{sourceNames[source]}</strong><small>{source === 'forms' ? 'Event reimbursement responses' : source === 'email' ? 'expenses@example.invalid' : source === 'upload' ? 'Files read in this session' : '/HackMIT / Travel receipts'}</small>
        {items.map(item => <button className={styles.file} key={item.name} aria-pressed={sample?.name === item.name} onClick={() => setSelected(item.name)}>{item.name}<small>{item.file_type === 'text/csv' ? 'Form response · CSV' : item.file_type.startsWith('image') ? 'Image' : item.file_type === 'application/pdf' ? 'PDF' : 'Text export'}</small></button>)}
      </div>
      <div className={styles.original}><header><strong>{source === 'upload' && !sample?.file_type.startsWith('image/') && sample?.file_type !== 'application/pdf' ? 'Source transcript' : 'Original input'}</strong>{sample && <a href={sample.url} target="_blank" rel="noreferrer">Open file<ArrowUpRight size={13} /></a>}</header>{sample && <><p className={styles.filename}>{sample.name}</p>{batch && <div className="p-3 text-sm"><label htmlFor="sample-response">Response to parse</label> <select className="block w-full min-w-0" id="sample-response" disabled={busy} value={rowIndex} onChange={event => setResponseIndex(Number(event.target.value))}>{responseRows.map((row, index) => <option value={index} key={index}>Row {index + 2}: {row[0]} · {row[8]} {row[9]}</option>)}</select><p>Each row is a separate request. Select one row to parse; the full spreadsheet stays available above.</p><a href={rowUrl} download={rowName}>Download selected row</a></div>}<SourcePreview sample={sample} /></>}</div>
      <section className={styles.parsed} aria-label="Parsed source fields"><header><strong>Extracted fields</strong><Sparkles size={15} /></header>{document?.error ? <p role="alert">{document.error}</p> : document?.evidence ? <><p className={styles.provenance}>{document.provenance}{document.latency_ms != null && ` · ${(document.latency_ms / 1000).toFixed(1)}s`}</p><dl>{Object.entries({ 'Document type': document.evidence.document_kind.replaceAll('_',' '), Traveler: request?.attendee_name || facts?.names.join(', ') || 'Not found', Merchant: facts?.vendor || 'Not found', 'Receipt total': facts?.amount_minor == null ? 'Not found' : `${facts.currency || '?'} ${(facts.amount_minor / 100).toFixed(2)}`, 'Requested amount': request?.amount_requested_minor == null ? 'Not stated' : `USD ${(request.amount_requested_minor / 100).toFixed(2)}`, Reference: facts?.booking_reference || facts?.receipt_number || 'Not found', Email: request?.email || 'Not found' }).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><a className={styles.resultLink} href="#source-results">See linked cases<ArrowRight size={14} /></a></> : <div className={styles.empty}><Sparkles size={27} /><h3>From source to structure</h3><p>Read this input to see its facts. Unknown fields stay empty; receipt totals and requests stay separate.</p><Button disabled={busy || !sample} onClick={() => void readSelected()}>{busy ? <LoaderCircle className="motion-safe:animate-spin" size={14} /> : <Sparkles size={14} />}{batch ? 'Parse selected row' : 'Parse this input'}</Button></div>}</section>
    </div>
    <Dialog open={!!connection} onOpenChange={open => { if (!open) setConnection(null); }}><DialogContent><DialogTitle>Connect {sourceNames[connection || source]}</DialogTitle><DialogDescription>{sourceNames[connection || source]} is connected to this workspace. Open the incoming {connection === 'forms' ? 'responses' : connection === 'email' ? 'messages' : 'folder'} to see how imported data is read and linked.</DialogDescription><Button onClick={() => { if (connection) setSource(connection); setSelected(''); setConnection(null); }}>Open source<ArrowRight size={14} /></Button></DialogContent></Dialog>
  </section>;
}
