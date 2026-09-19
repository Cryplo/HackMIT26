// Run once with server environment set: node src/lib/core/provision-search.mjs
import { readFile } from 'node:fs/promises';
const { ELASTICSEARCH_URL: url, ELASTICSEARCH_API_KEY: key, ELASTICSEARCH_INDEX: configured } = process.env;
const index = configured || 'reimbursement-demo';
if (!url || !key || !/^[a-z0-9-]+$/.test(index)) throw new Error('Set Elasticsearch URL, API key, and a valid index name.');
const response = await fetch(`${url.replace(/\/$/, '')}/${index}`, { method: 'PUT', headers: { Authorization: `ApiKey ${key}`, 'Content-Type': 'application/json' }, body: await readFile(new URL('./elasticsearch-index.json', import.meta.url), 'utf8'), signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Index creation returned HTTP ${response.status}. Existing indexes must already have the supplied mapping.`);
console.log('Synthetic reimbursement search index created.');
