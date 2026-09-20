import type { SourceKind } from '@/components/business/SourceIcon';
export type SourceActivity = { id: string; name: string; source: SourceKind; status: 'reading' | 'parsed' | 'failed' | 'confirmed'; at: number };
const key = 'sift-source-activity-v1';
export function readSourceActivity(): SourceActivity[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(rows) ? rows.filter((r): r is SourceActivity => !!r && typeof r.id === 'string' && typeof r.name === 'string' && ['forms','email','dropbox','upload'].includes(r.source) && ['reading','parsed','failed','confirmed'].includes(r.status) && typeof r.at === 'number' && Date.now() - r.at < 3600000).slice(-24) : [];
  } catch { return []; }
}
// Browser-local activity for this synthetic demo; source labels are not verified connector provenance.
export function recordSourceActivity(item: SourceActivity) {
  try {
    localStorage.setItem(key, JSON.stringify([...readSourceActivity().filter(r => r.id !== item.id), item].slice(-24)));
    window.dispatchEvent(new Event('sift-source-activity'));
  } catch { /* Uploads still work when browser storage is unavailable. */ }
}
