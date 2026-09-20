'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, money, statusLabel } from '@/lib/dashboard/helpers';
import type { ClaimSearchRow, ClaimSearchResult } from '@/lib/core/claim-search';
import styles from './search.module.css';
type Snapshot={rows:ClaimSearchRow[];snapshot_token:string;search_mode:string};
export default function ClaimSearch(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null); const [query,setQuery]=useState(''); const [category,setCategory]=useState('');
  const [result,setResult]=useState<ClaimSearchResult|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();api<Snapshot>('/api/claim-search',undefined,abort.signal).then(setSnapshot).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort()},[]);
  async function run(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setResult(null);try{
    const fresh=await api<Snapshot>('/api/claim-search');setSnapshot(fresh);
    setResult(await api<ClaimSearchResult>('/api/claim-search',{query,snapshot_token:fresh.snapshot_token,...(category?{category}:{})}));
  }catch(e){setError(e instanceof Error?e.message:'Search failed.')}finally{setBusy(false)}}
  function table(rows:ClaimSearchRow[],label:string){return <section className={styles.results}><h2>{label} <span>{rows.length}</span></h2>{!rows.length?<p>No claims in this group.</p>:<div className={styles.scroll}><table><thead><tr><th>Attendee / vendor</th><th>Category</th><th>Claimed / receipt</th><th>Assessment</th><th>Human decision</th><th>Evidence</th></tr></thead><tbody>{rows.map(row=><tr key={row.submission_id}><td><strong>{row.attendee_name}</strong><small>{row.vendor||'Vendor unknown'}</small></td><td>{row.category}</td><td>{money(row.amount_requested_minor)}<small>{money(row.receipt_amount_minor)}</small></td><td>{row.assessment_status?statusLabel(row.assessment_status):'Not assessed'}</td><td>{row.decision_status}</td><td>{row.receipt_id?<a href={`/api/receipts/${encodeURIComponent(row.receipt_id)}`} target='_blank' rel='noreferrer'>View receipt ↗</a>:'No receipt'}<small>{row.failed_checks.length?`Failed: ${row.failed_checks.join(', ')}`:row.unknown_checks.length?`Unknown: ${row.unknown_checks.join(', ')}`:'—'}</small></td></tr>)}</tbody></table></div>}</section>}
  return <main className={styles.page}><nav><Link href='/business-demo'><ArrowLeft size={15}/> Workspace</Link><Link href='/submit'>Submit a receipt ↗</Link></nav><header><p className={styles.eyebrow}>SIFT / CLAIM SEARCH</p><h1>Find the claims that need a closer look.</h1><p>Search your stored claims in plain language. Jev checks each claim against your question; uncertain matches stay visible.</p></header>
  <form onSubmit={run} className={styles.form}><label htmlFor='query'>What are you looking for?</label><div className={styles.controls}><Input id='query' value={query} maxLength={500} required disabled={busy} onChange={e=>{setQuery(e.target.value);setResult(null)}} placeholder='Hotel claims with mismatched names'/><select aria-label='Category' value={category} disabled={busy} onChange={e=>{setCategory(e.target.value);setResult(null)}}><option value=''>All categories</option>{['flight','hotel','train','bus','other'].map(c=><option key={c}>{c}</option>)}</select><Button disabled={busy||!query.trim()||!snapshot}><Search size={16}/>{busy?'Searching…':'Search claims'}</Button></div><p className={styles.hint}>Try “claims above $200”, “receipts with unknown vendors”, or “hotel claims”. Search does not approve claims or calculate totals.</p></form>
  <div aria-live='polite'>{error&&<p role='alert' className={styles.error}>{error}</p>}{busy&&<p>Evaluating the current claims. This may take up to 45 seconds.</p>}{result&&<p className={styles.meta}>Live Jev · {result.evaluated_count} claims evaluated · {(result.latency_ms/1000).toFixed(1)}s · {result.model}. Results reflect the search-time snapshot.</p>}</div>
  {result?<>{table(result.matches,'Matches')}{table(result.possible_matches,'Possible matches — review evidence')}</>:!busy&&snapshot?table(snapshot.rows.filter(r=>!category||r.category===category),'Stored claims'):null}
  <footer>Up to 100 claims per search. Category filters run before Jev. Search results never change approvals. Synthetic data only.</footer></main>
}
