import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Category, CustomCheck, CustomCheckCriteria } from '../review-contracts';
import type { Snapshot } from './store';
import { CoreError } from './validation';
import { requiredChecks } from './checks';

/** A reviewer-authored semantic check evaluated by Jev alongside the built-in questions. */
export type StoredCustomCheck = CustomCheck;
export type CheckCommand =
  | { action: 'create'; label: string; instructions: string; criteria: CustomCheckCriteria; category: Category | null }
  | { action: 'update'; id: string; expected_check_version: number; label: string; instructions: string; criteria: CustomCheckCriteria; category: Category | null }
  | { action: 'enable' | 'disable'; id: string; expected_check_version: number };

export const CUSTOM_CHECK_LIMIT = 12;
export const CUSTOM_FIELD = /^custom_[a-z0-9_]{2,40}$/;
const categoryEnum = z.enum(['flight', 'hotel', 'train', 'bus', 'other']);
export const customCheckUpsert = z.object({
  label: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(10).max(2000),
  category: categoryEnum.nullable().optional(),
  criteria: z.object({
    pass: z.string().trim().min(1).max(500),
    fail: z.string().trim().min(1).max(500),
    unknown: z.string().trim().min(1).max(500),
  }).partial().strict().optional(),
}).strict();
export const checkMutation = z.object({ expected_check_version: z.number().int().positive() }).strict();
export const customCheckUpdate = z.object({ ...customCheckUpsert.shape, expected_check_version: z.number().int().positive() }).strict();

export const defaultCriteria: CustomCheckCriteria = {
  pass: 'The receipt evidence clearly satisfies this check.',
  fail: 'The receipt evidence clearly violates this check.',
  unknown: 'The evidence is missing, incomplete, or conflicting.',
};

/** Stable field_checked identifier derived once from the label; never reused after edits. */
export function slugField(label: string, taken: Set<string>): string {
  const base = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)}`;
  if (!/^custom_[a-z0-9]/.test(base)) throw new CoreError('INVALID_INPUT', 'The check name must contain a letter or digit.');
  let field = base; let suffix = 2;
  while (taken.has(field) || !CUSTOM_FIELD.test(field)) field = `${base}_${suffix++}`;
  return field;
}

export function activeCustomChecks(state: Snapshot): StoredCustomCheck[] {
  return (state.custom_checks ?? []).filter(check => check.state === 'active');
}
/** A category-scoped check applies only to matching claims; null applies to every claim. */
export function applicableCustomChecks(state: Snapshot, category: Category): StoredCustomCheck[] {
  return activeCustomChecks(state).filter(check => check.category === null || check.category === category);
}
/** Required passes for 'approved': built-ins plus the custom checks applicable to this claim. */
export function requiredFieldsFor(state: Snapshot, category: Category): string[] {
  return [...requiredChecks, ...applicableCustomChecks(state, category).map(check => check.field)];
}
/** Required fields implied by a recorded decision batch — honest for runs made under older configurations. */
export function requiredFieldsIn(checks: readonly { field_checked: string }[]): string[] {
  return [...requiredChecks, ...new Set(checks.map(check => check.field_checked).filter(field => CUSTOM_FIELD.test(field)))];
}
function contentHash(check: StoredCustomCheck): string {
  return createHash('sha256').update(JSON.stringify([check.field, check.label, check.instructions, check.criteria, check.category])).digest('hex').slice(0, 16);
}
/** Bound into run evidence so an in-flight assessment goes stale when check configuration changes. */
export function checkConfiguration(state: Snapshot) {
  return {
    version: 'mandatory-v1',
    custom: activeCustomChecks(state)
      .map(check => ({ field: check.field, version: check.version, hash: contentHash(check) }))
      .sort((a, b) => a.field.localeCompare(b.field)),
  };
}

export function mutateCustomCheck(state: Snapshot, cmd: CheckCommand): { check: StoredCustomCheck; knowledge_revision: number } {
  state.custom_checks ??= []; state.custom_check_history ??= []; state.knowledge_revision ??= 0;
  const now = new Date().toISOString();
  let check: StoredCustomCheck;
  if (cmd.action === 'create') {
    if (state.custom_checks.length >= CUSTOM_CHECK_LIMIT) throw new CoreError('CHECK_LIMIT', `At most ${CUSTOM_CHECK_LIMIT} custom checks are supported.`, 409);
    const taken = new Set([...requiredChecks, ...state.custom_checks.map(item => item.field)]);
    check = { id: crypto.randomUUID(), version: 1, state: 'active', field: slugField(cmd.label, taken), label: cmd.label, instructions: cmd.instructions, criteria: cmd.criteria, category: cmd.category, created_at: now, updated_at: now };
    state.custom_checks.push(check);
    state.knowledge_revision++;
  } else {
    const found = state.custom_checks.find(item => item.id === cmd.id);
    if (!found) throw new CoreError('NOT_FOUND', 'Check not found.', 404);
    check = found;
    if (check.version !== cmd.expected_check_version) throw new CoreError('STALE_CHECK', 'This check changed. Refresh before continuing.', 409);
    if (cmd.action === 'update') {
      Object.assign(check, { label: cmd.label, instructions: cmd.instructions, criteria: cmd.criteria, category: cmd.category, version: check.version + 1, updated_at: now });
      if (check.state === 'active') state.knowledge_revision++;
    } else if (cmd.action === 'disable') {
      if (check.state === 'disabled') throw new CoreError('STALE_CHECK', 'This check is already disabled.', 409);
      Object.assign(check, { state: 'disabled' as const, version: check.version + 1, updated_at: now });
      state.knowledge_revision++;
    } else {
      if (check.state === 'active') throw new CoreError('STALE_CHECK', 'This check is already enabled.', 409);
      Object.assign(check, { state: 'active' as const, version: check.version + 1, updated_at: now });
      state.knowledge_revision++;
    }
  }
  state.custom_check_history.push(structuredClone(check));
  return { check: structuredClone(check), knowledge_revision: state.knowledge_revision };
}
