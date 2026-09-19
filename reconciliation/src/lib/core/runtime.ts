import type { Submission, Receipt } from '../contracts';
import 'server-only';
import { CoreService } from './service';
import { SupabaseStore } from './store';
import { FileStore, demoDirectory } from './file-store';
import { LiveJev, SimulatedJev } from './jev';
import { ElasticsearchRetrieval, SimulatedRetrieval } from './retrieval';
import { CoreError } from './validation';
const globalCore = globalThis as typeof globalThis & { reimbursementCore?: CoreService };
export function getCore(): CoreService {
  if (globalCore.reimbursementCore) return globalCore.reimbursementCore;
  const e = process.env;
  const url = e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL; const key = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!!url !== !!key) throw new CoreError('CONFIG_ERROR', 'Supabase URL and service role key must be configured together.', 503);
  if (!!e.ELASTICSEARCH_URL !== !!e.ELASTICSEARCH_API_KEY) throw new CoreError('CONFIG_ERROR', 'Elasticsearch URL and API key must be configured together.', 503);
  const simulated = e.RECONCILIATION_MODE === 'simulated';
  if (e.RECONCILIATION_MODE && !['simulated','live'].includes(e.RECONCILIATION_MODE)) throw new CoreError('CONFIG_ERROR', 'RECONCILIATION_MODE must be live or simulated.', 503);
  if (e.RECONCILIATION_INTAKE_MODE === 'demo' && url) throw new CoreError('CONFIG_ERROR', 'Use intake live mode with Supabase, or remove Supabase credentials for local demo mode.', 503);
  const store = url && key ? new SupabaseStore(url, key) : new FileStore(demoDirectory());
  const directKey = e.TYPESAFE_API_KEY || e.JEV_API_KEY;
  const jevKey = directKey || e.AI_GATEWAY_API_KEY;
  const channel = directKey ? 'typesafe' : 'gateway';
  const liveJev = !simulated && !!jevKey;
  const liveSearch = !simulated && !!e.ELASTICSEARCH_URL;
  if (e.RECONCILIATION_MODE === 'live' && (!url || !liveJev || !liveSearch)) throw new CoreError('CONFIG_ERROR', 'Live mode requires Supabase, Jev, and Elasticsearch credentials.', 503);
  const demoMode = !url || !liveJev || !liveSearch;
  globalCore.reimbursementCore = new CoreService(store, liveSearch ? new ElasticsearchRetrieval(e.ELASTICSEARCH_URL!, e.ELASTICSEARCH_API_KEY!, e.ELASTICSEARCH_INDEX) : new SimulatedRetrieval(), liveJev ? new LiveJev(jevKey!, e.JEV_MODEL || (channel === 'gateway' ? 'typesafe-ai/jev' : 'jev-latest'), channel) : new SimulatedJev(), demoMode, { decisions: liveJev ? 'live Jev' : 'simulated', retrieval: liveSearch ? 'Elasticsearch' : 'local simulated', storage: url ? 'Supabase' : 'local disk' });
  return globalCore.reimbursementCore;
}

/** Optional explicit metadata import. FileStore also rehydrates durable LocalStore
 * metadata on every operation, so uploads are visible without a cross-module write.
 * Receipt bytes remain private to intake.
 */
export async function importDemoIntakeRecord(submission: Submission, receipt: Receipt): Promise<void> {
  if (process.env.RECONCILIATION_SYNTHETIC_ONLY !== 'true') throw new CoreError('SYNTHETIC_ONLY', 'Demo intake import requires the synthetic-only gate.', 403);
  const store = getCore().store;
  // Capability check survives dev hot reload where an older class instance is retained.
  if (!('importIntakeRecord' in store) || typeof store.importIntakeRecord !== 'function') throw new CoreError('CONFIG_ERROR', 'Demo intake import requires the local core adapter.', 409);
  await store.importIntakeRecord(submission, receipt);
}
