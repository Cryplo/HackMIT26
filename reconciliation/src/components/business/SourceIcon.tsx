export type SourceKind = 'forms' | 'email' | 'dropbox' | 'upload';
export const sourceNames = { forms: 'Google Forms', email: 'Gmail', dropbox: 'Dropbox', upload: 'File upload' };
export function SourceIcon({ source, size = 28 }: { source: SourceKind; size?: number }) {
  if (source === 'forms' || source === 'email') return <img src={`/source-icons/${source === 'forms' ? 'google-forms' : 'gmail'}.png`} width={size} height={size} alt="" aria-hidden="true" style={{ objectFit: 'contain', flexShrink: 0 }} />;
  if (source === 'dropbox') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }} fill="#0061ff"><path d="m6 1 6 4-6 4-6-4Zm12 0 6 4-6 4-6-4ZM6 9l6 4-6 4-6-4Zm12 0 6 4-6 4-6-4ZM6 18l6-4 6 4-6 4Z" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></svg>;
}
