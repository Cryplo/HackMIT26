import { z } from 'zod';
import type { CoreService } from './service';
import type { CheckResponse, ChecksResponse } from '../review-contracts';
import { CoreError } from './validation';
import { checkMutation, customCheckUpdate, customCheckUpsert, defaultCriteria } from './custom-checks';
import { checkCatalog } from '../check-catalog';
function parsed<T>(schema: z.ZodType<T>, raw: unknown) { const p = schema.safeParse(raw); if (!p.success) throw new CoreError('INVALID_INPUT', 'Invalid check request.'); return p.data; }
function validId(id: string) { if (!z.uuid().safeParse(id).success) throw new CoreError('INVALID_INPUT', 'Check ID must be a UUID.'); }
/** The checks page lists built-in code/Jev checks plus every configured custom check. */
export async function checks(core: CoreService): Promise<ChecksResponse> {
  const state = await core.store.snapshot();
  return { checks: checkCatalog(state), knowledge_revision: state.knowledge_revision ?? 0 };
}
export async function createCheck(core: CoreService, raw: unknown): Promise<CheckResponse> {
  const input = parsed(customCheckUpsert, raw);
  return core.store.customCheck({ action: 'create', label: input.label, instructions: input.instructions, criteria: { ...defaultCriteria, ...input.criteria }, category: input.category ?? null });
}
export async function updateCheck(core: CoreService, id: string, raw: unknown): Promise<CheckResponse> {
  validId(id);
  const { expected_check_version, ...input } = parsed(customCheckUpdate, raw);
  return core.store.customCheck({ action: 'update', id, expected_check_version, label: input.label, instructions: input.instructions, criteria: { ...defaultCriteria, ...input.criteria }, category: input.category ?? null });
}
export async function changeCheck(core: CoreService, id: string, action: 'enable' | 'disable', raw: unknown): Promise<CheckResponse> {
  validId(id);
  const { expected_check_version } = parsed(checkMutation, raw);
  return core.store.customCheck({ action, id, expected_check_version });
}
