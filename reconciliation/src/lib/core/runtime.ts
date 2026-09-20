import type { Submission, Receipt } from '../contracts';
import 'server-only';
import { CoreService } from './service';
import { SupabaseStore } from './store';
import { FileStore, demoDirectory } from './file-store';
import { LiveJev, SimulatedJev } from './jev';
import { OpenAiJustifier, SimulatedJustifier } from './justification';
import { DatabaseRetrieval } from './retrieval';
import { CoreError } from './validation';
const globalCore = globalThis as typeof globalThis & { reimbursementCore?: CoreService };
export function getCore(): CoreService {
  if (globalCore.reimbursementCore) return globalCore.reimbursementCore;
  const e = process.env;
  const url = e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL; const key = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!!url !== !!key) throw new CoreError('CONFIG_ERROR', 'Supabase URL and service role key must be configured together.', 503);
  const simulated = e.RECONCILIATION_MODE === 'simulated';
  if (e.RECONCILIATION_MODE && !['simulated','live'].includes(e.RECONCILIATION_MODE)) throw new CoreError('CONFIG_ERROR', 'RECONCILIATION_MODE must be live or simulated.', 503);
  if (e.RECONCILIATION_INTAKE_MODE === 'demo' && url) throw new CoreError('CONFIG_ERROR', 'Use intake live mode with Supabase, or remove Supabase credentials for local demo mode.', 503);
  const store = url && key ? new SupabaseStore(url, key) : new FileStore(demoDirectory());
  const directKey = e.TYPESAFE_API_KEY || e.JEV_API_KEY;
  const jevKey = directKey || e.AI_GATEWAY_API_KEY;
  const channel = directKey ? 'typesafe' : 'gateway';
  const liveJev = !simulated && !!jevKey;
  if (e.RECONCILIATION_MODE === 'live' && (!url || !liveJev)) throw new CoreError('CONFIG_ERROR', 'Live mode requires Supabase and Jev credentials.', 503);
  const demoMode = !url || !liveJev;
  if (e.RECONCILIATION_JUSTIFICATION_MODE && !['simulated','live'].includes(e.RECONCILIATION_JUSTIFICATION_MODE)) throw new CoreError('CONFIG_ERROR', 'RECONCILIATION_JUSTIFICATION_MODE must be live or simulated.', 503);
  if (e.RECONCILIATION_JUSTIFICATION_MODE === 'live' && (simulated || !e.OPENAI_API_KEY)) throw new CoreError('CONFIG_ERROR', 'Live justifications require OPENAI_API_KEY outside simulated mode.', 503);
  // Opt-in only: an OPENAI_API_KEY in the environment must never start spending on narratives by itself.
  const liveJustification = e.RECONCILIATION_JUSTIFICATION_MODE === 'live';
  globalCore.reimbursementCore = new CoreService(store, new DatabaseRetrieval(), liveJev ? new LiveJev(jevKey!, e.JEV_MODEL || (channel === 'gateway' ? 'typesafe-ai/jev' : 'jev-latest'), channel) : new SimulatedJev(), demoMode, { decisions: liveJev ? 'live Jev' : 'simulated', retrieval: url ? 'Supabase candidate scan' : 'local candidate scan', storage: url ? 'Supabase' : 'local disk', justification: liveJustification ? 'live OpenAI' : 'deterministic summary' }, liveJustification ? new OpenAiJustifier(e.OPENAI_API_KEY!, e.JUSTIFICATION_MODEL || 'gpt-4.1-mini') : new SimulatedJustifier());
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
