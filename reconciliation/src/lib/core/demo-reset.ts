import 'server-only';
import type { CoreService } from './service';
import { FileStore } from './file-store';
import { CoreError } from './validation';

export function assertSimulationReset() {
  const e = process.env;
  if (e.RECONCILIATION_MODE !== 'simulated' || e.RECONCILIATION_INTAKE_MODE !== 'demo' || e.RECONCILIATION_SYNTHETIC_ONLY !== 'true' || e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || e.SUPABASE_SERVICE_ROLE_KEY) throw new CoreError('DEMO_RESET_DISABLED', 'Reset requires an isolated synthetic simulation.', 403);
}

export async function resetSimulation(core: CoreService, snapshotToken: string) {
  assertSimulationReset();
  if (!core.demoMode || !(core.store instanceof FileStore)) throw new CoreError('DEMO_RESET_DISABLED', 'Only the local simulation file store can be reset.', 403);
  if (!/^[a-f0-9]{64}$/.test(snapshotToken)) throw new CoreError('INVALID_INPUT', 'A current snapshot token is required.');
  await core.store.resetShowcase(snapshotToken);
  return { reset: true as const };
}
