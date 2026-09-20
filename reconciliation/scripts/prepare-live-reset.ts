import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { liveBaseline, liveResetSeed } from '../src/lib/demo/live-baseline';

class PreparationError extends Error {}

async function main() {
  const started = Date.now(), env = process.env;
  if (env.RECONCILIATION_MODE !== 'live' || env.RECONCILIATION_SYNTHETIC_ONLY !== 'true' || env.RECONCILIATION_ALLOW_DEMO_RESET !== 'true') {
    throw new PreparationError('Require RECONCILIATION_MODE=live, RECONCILIATION_SYNTHETIC_ONLY=true, and RECONCILIATION_ALLOW_DEMO_RESET=true.');
  }
  const url = env.SUPABASE_URL?.replace(/\/$/, ''), key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new PreparationError('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before preparing the reset backup.');
  const bucketName = env.SUPABASE_RECEIPTS_BUCKET || 'receipts';
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  async function existing() {
    let response: Response;
    try {
      response = await fetch(`${url}/rest/v1/demo_reset_baselines?select=id,bucket,created_at&id=eq.live-80-v1`, {
        headers, cache: 'no-store', signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new PreparationError('Could not read the prepared reset backup. Check connectivity and migration 018; no save was attempted.'); }
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || rows.length > 1) throw new PreparationError('Could not read the prepared reset backup. Apply migration 018 and verify service-role access.');
    if (!rows.length) return false;
    const row = rows[0];
    if (row?.id !== 'live-80-v1' || typeof row.bucket !== 'string' || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
      throw new PreparationError('The prepared reset backup metadata is invalid; inspect it before proceeding.');
    }
    if (row.bucket !== bucketName) throw new PreparationError('The immutable reset backup belongs to a different bucket. Match SUPABASE_RECEIPTS_BUCKET to the existing backup; it will not be overwritten.');
    return true;
  }
  if (await existing()) {
    console.log(`Prepared reset backup already exists; 0 originals downloaded (${elapsed()}).`);
    return;
  }
  const fixture = await liveBaseline({ submissions: [], knowledge_revision: 0 });
  const originals = [...fixture.originals.map(item => item.receipt), ...fixture.supporting.map(item => item.document)];
  if (fixture.originals.length !== 80 || fixture.supporting.length !== 20 || originals.length !== 100) {
    throw new PreparationError('Expected 80 receipts and 20 supporting originals; inspect the baseline before saving.');
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }),
  } });
  const info = await client.storage.getBucket(bucketName);
  if (info.error || !info.data || info.data.public !== false) throw new PreparationError('A readable private receipts bucket is required; no originals were changed.');
  const bucket = client.storage.from(bucketName);
  let cursor = 0, stopped = false;
  const workers = await Promise.allSettled(Array.from({ length: 8 }, async () => {
    while (!stopped && cursor < originals.length) {
      const index = cursor++, original = originals[index];
      try {
        const download = await bucket.download(original.storage_path);
        if (download.error || !download.data) throw new PreparationError(`Original ${index + 1}/100 is missing or unreadable. Restore the required synthetic original through the seed workflow, then rerun preparation; this command never uploads originals.`);
        const hash = createHash('sha256').update(new Uint8Array(await download.data.arrayBuffer())).digest('hex');
        if (hash !== original.sha256) throw new PreparationError(`Original ${index + 1}/100 differs from the authored baseline. Inspect the stored original; it was not overwritten.`);
      } catch (error) { stopped = true; throw error; }
    }
  }));
  const failure = workers.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  console.log(`100 originals verified (${elapsed()}); saving the prepared baseline…`);
  const seed = liveResetSeed(fixture.state);
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/core_save_demo_baseline`, {
      method: 'POST', headers, body: JSON.stringify({ p_seed: seed, p_bucket: bucketName }), cache: 'no-store', signal: AbortSignal.timeout(90_000),
    });
  } catch { throw new PreparationError('Backup save outcome is unconfirmed. Rerun preparation to inspect the immutable backup before any further save; this request was not retried.'); }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (result?.message === 'BASELINE_EXISTS') throw new PreparationError('An immutable backup already exists. Rerun preparation to inspect its metadata; no replacement was attempted.');
    console.error('Baseline save failed', { status: response.status, code: result?.code, message: result?.message });
    throw new PreparationError('Backup save was not confirmed. Verify migration 018 and inspect the prepared backup before trying again.');
  }
  if (result?.id !== 'live-80-v1' || typeof result.saved !== 'boolean') throw new PreparationError('Backup save returned an unexpected response. Inspect the prepared backup before trying again.');
  if (!result.saved && !await existing()) throw new PreparationError('Save reported an existing backup but its metadata could not be found. Inspect the database before trying again.');
  console.log(`Prepared reset backup ${result.saved ? 'saved' : 'already exists'}: 80 claims, 100 originals verified (${elapsed()}). Current claims were not reset; no AI calls were made.`);
}

main().catch(error => {
  console.error(error instanceof PreparationError ? error.message : 'Reset preparation failed. Check configuration and storage connectivity; no reset or original overwrite was attempted.');
  process.exitCode = 1;
});
