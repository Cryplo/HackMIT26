import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { liveBaseline } from '../demo/live-baseline';
import { workspaceSnapshot } from './projection';
import type { CoreService } from './service';
import { SupabaseStore } from './store';
import { CoreError, isUUID } from './validation';

/** Explicit synthetic-only reset; originals are retained and writes are never retried. */
export async function resetLiveDemo(core: CoreService, expectedToken: string): Promise<{ reset: true; archive_id: string }> {
  const env = process.env, url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.RECONCILIATION_ALLOW_DEMO_RESET !== 'true' || env.RECONCILIATION_SYNTHETIC_ONLY !== 'true') {
    throw new CoreError('RESET_DISABLED', 'Live reset requires explicit reset and synthetic-only gates.', 403);
  }
  const identity = core.store as unknown as { url?: string; key?: string };
  if (!url || !key || env.RECONCILIATION_MODE !== 'live' || env.RECONCILIATION_INTAKE_MODE === 'demo'
    || core.demoMode || !(core.store instanceof SupabaseStore) || identity.url !== url || identity.key !== key) {
    throw new CoreError('CONFIG_ERROR', 'Live reset requires the configured live Supabase workspace and original storage.', 503);
  }
  if (typeof expectedToken !== 'string' || !/^[a-f0-9]{64}$/.test(expectedToken)) {
    throw new CoreError('INVALID_INPUT', 'A current workspace snapshot token is required.');
  }
  const expected = await core.store.snapshot();
  if (workspaceSnapshot(expected).token !== expectedToken) throw new CoreError('STALE_SNAPSHOT', 'Claims changed. Refresh before resetting.', 409);
  if (expected.submissions.some(s => !/^[^@\s]+@example\.invalid$/.test(s.email))
    || expected.receipts.some(r => r.storage_path !== `synthetic/${r.submission_id}/${r.id}`)
    || expected.supporting_documents?.some(d => d.storage_path !== `synthetic/${d.claim_id}/supporting/${d.id}`)) {
    throw new CoreError('SYNTHETIC_ONLY', 'Reset refuses records outside the synthetic demo namespace.', 403);
  }
  if (expected.runs.some(r => r.status === 'running') || expected.receipts.some(r => r.extraction_status === 'pending')
    || expected.supporting_documents?.some(d => d.extraction_status === 'pending')) {
    throw new CoreError('RESET_BUSY', 'Wait for active processing before resetting.', 409);
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) },
  });
  const bucketName = env.SUPABASE_RECEIPTS_BUCKET || 'receipts';
  const bucketInfo = await client.storage.getBucket(bucketName);
  if (bucketInfo.error || !bucketInfo.data || bucketInfo.data.public) {
    throw new CoreError('PRIVATE_BUCKET_REQUIRED', 'A readable private evidence bucket is required.', 503);
  }
  const fixture = await liveBaseline(expected), bucket = client.storage.from(bucketName);
  const originals = [...fixture.originals.map(({ receipt, bytes }) => ({ original: receipt, bytes })),
    ...fixture.supporting.map(({ document, bytes }) => ({ original: document, bytes }))];
  for (const { original, bytes } of originals) {
    let downloaded = await bucket.download(original.storage_path);
    if (downloaded.error) {
      const failure = downloaded.error;
      const missing = ('code' in failure && failure.code === 'NoSuchKey')
        || (failure.statusCode === '404' && failure.message === 'Object not found');
      if (!missing) throw new CoreError('STORAGE_UNAVAILABLE', 'Could not verify existing private originals.', 503);
      // No upsert: an existing original, including a concurrent upload, is immutable.
      const uploaded = await bucket.upload(original.storage_path, bytes, { contentType: original.file_type, upsert: false });
      downloaded = await bucket.download(original.storage_path);
      if (downloaded.error || !downloaded.data) throw new CoreError('STORAGE_UNAVAILABLE', uploaded.error
        ? 'Original upload was not confirmed; refresh before trying reset again.' : 'Could not verify the uploaded original.', 503);
    }
    if (!downloaded.data || createHash('sha256').update(new Uint8Array(await downloaded.data.arrayBuffer())).digest('hex') !== original.sha256) {
      throw new CoreError('ORIGINAL_CONFLICT', 'An existing original differs from the showcase seed; it was retained unchanged.', 409);
    }
  }
  const seed = { submissions: fixture.state.submissions, receipts: fixture.state.receipts,
    policies: fixture.state.policies, supporting_documents: fixture.state.supporting_documents,
    runs: fixture.state.runs, decisions: fixture.state.decisions, corrections: fixture.state.corrections };
  // The RPC rechecks the complete expected snapshot under locks after harmless storage writes.
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/core_reset_demo`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      // Archiving the prior ledger plus restoring 544 prepared checks can outlast 30 seconds.
      body: JSON.stringify({ p_expected: expected, p_seed: seed }), cache: 'no-store', signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new CoreError('RESET_UNCONFIRMED', 'Reset outcome is unconfirmed. Refresh the workspace before any further reset; the request was not retried.', 503);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const messages: Record<string, string> = {
      STALE_SNAPSHOT: 'Claims changed. Refresh before resetting.', RESET_BUSY: 'Wait for processing and pending email delivery before resetting.',
      SYNTHETIC_ONLY: 'Reset refuses records outside the synthetic demo namespace.', INVALID_RESET_SEED: 'The reset seed did not pass validation.',
    };
    if (typeof result?.message === 'string' && Object.hasOwn(messages, result.message)) throw new CoreError(result.message, messages[result.message], 409);
    throw new CoreError('RESET_UNAVAILABLE', 'Reset was not confirmed. Verify the reset migration and refresh the workspace before trying again.', 503);
  }
  if (result?.reset !== true || !isUUID(result?.archive_id)) throw new CoreError('RESET_UNCONFIRMED', 'Reset response was incomplete. Refresh before any further reset.', 503);
  return { reset: true, archive_id: result.archive_id };
}
