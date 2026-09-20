import type { CheckDescriptor } from './review-contracts';
import type { CustomCheck } from './review-contracts';

/** Check catalog for the workspace page: built-in code checks, built-in Jev questions, then custom checks.
 * Client-safe: no node dependencies so the preview transport can share it. */
export function checkCatalog(state: { custom_checks?: CustomCheck[] }): CheckDescriptor[] {
  const local: CheckDescriptor[] = [
    { key: 'extraction', label: 'Receipt extraction', layer: 'local', builtin: true, category: null, description: 'A readable PDF or image receipt must be stored and parsed successfully.' },
    { key: 'currency', label: 'Currency', layer: 'local', builtin: true, category: null, description: 'Receipt currency must be USD.' },
    { key: 'amount', label: 'Amount', layer: 'local', builtin: true, category: null, description: 'Requested and receipt amounts must match exactly in integer cents.' },
    { key: 'receipt_date', label: 'Receipt date', layer: 'local', builtin: true, category: null, description: 'Receipt date must fall inside a configured policy window.' },
    { key: 'policy', label: 'Policy coverage', layer: 'local', builtin: true, category: null, description: 'Exactly one policy must cover the category, currency, and receipt date.' },
    { key: 'policy_cap', label: 'Policy limit', layer: 'local', builtin: true, category: null, description: 'Requested amount must not exceed the reimbursement cap.' },
    { key: 'exact_duplicate', label: 'Duplicate bytes', layer: 'local', builtin: true, category: null, description: 'An identical receipt file or corroborated receipt identity on an earlier claim fails the claim.' },
  ];
  const semantic: CheckDescriptor[] = [
    { key: 'merchant', label: 'Merchant match', layer: 'jev', builtin: true, category: null, description: 'Does the receipt merchant clearly supply the submitted expense category?' },
    { key: 'name', label: 'Traveler name', layer: 'jev', builtin: true, category: null, description: 'Does a named traveler or guest on the receipt identify the attendee?' },
    { key: 'duplicate', label: 'Duplicate evidence', layer: 'jev', builtin: true, category: null, description: 'Do retrieved prior submissions show this same purchase was already claimed?' },
  ];
  const custom: CheckDescriptor[] = (state.custom_checks ?? []).map(check => ({
    key: check.field, label: check.label, layer: 'jev' as const, builtin: false,
    description: check.instructions, category: check.category,
    id: check.id, state: check.state, version: check.version,
    instructions: check.instructions, criteria: check.criteria,
  }));
  return [...local, ...semantic, ...custom];
}
