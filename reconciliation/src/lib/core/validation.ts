import type { AliasPayload, CorrectionInput, ParsedReceipt } from '../contracts';
export class CoreError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export const categories = ['flight', 'hotel', 'train', 'bus', 'other'];
export const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isUUID = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function parsedReceipt(v: unknown): v is ParsedReceipt {
  if (!isObject(v)) return false;
  return v.schema_version === 1 && (v.vendor === null || typeof v.vendor === 'string') && (v.receipt_date === null || validDate(v.receipt_date)) && (v.amount_minor === null || (Number.isSafeInteger(v.amount_minor) && Number(v.amount_minor) >= 0)) && (v.currency === null || typeof v.currency === 'string') && Array.isArray(v.names) && v.names.every(n => typeof n === 'string') && (v.receipt_number === null || typeof v.receipt_number === 'string');
}
export function reconcileInput(v: unknown): string[] {
  if (!isObject(v) || !Array.isArray(v.submission_ids) || v.submission_ids.length < 1 || v.submission_ids.length > 50 || !v.submission_ids.every(isUUID)) throw new CoreError('INVALID_INPUT', 'submission_ids must contain 1–50 UUIDs.');
  return [...new Set(v.submission_ids as string[])];
}
export function aliasPayload(v: unknown): AliasPayload {
  if (!isObject(v) || typeof v.observed_vendor !== 'string' || !v.observed_vendor.trim() || v.observed_vendor.length > 200 || typeof v.canonical_vendor !== 'string' || !v.canonical_vendor.trim() || v.canonical_vendor.length > 200 || !isObject(v.scope) || !categories.includes(String(v.scope.category)) || v.scope.currency !== 'USD') throw new CoreError('INVALID_ALIAS', 'Alias needs observed_vendor, canonical_vendor and scope {category,currency:"USD"}.');
  return v as unknown as AliasPayload;
}
export function correctionInput(v: unknown): CorrectionInput {
  if (!isObject(v) || !isUUID(v.submission_id) || (v.decision_id !== undefined && !isUUID(v.decision_id)) || !['approved', 'rejected'].includes(String(v.human_verdict)) || typeof v.human_note !== 'string' || !v.human_note.trim() || v.human_note.length > 2000 || !['decision_override', 'vendor_alias'].includes(String(v.correction_type)) || !isObject(v.correction_payload_json)) throw new CoreError('INVALID_INPUT', 'Invalid correction; a human note and valid identifiers are required.');
  if (v.correction_type === 'vendor_alias') aliasPayload(v.correction_payload_json);
  else if (Object.keys(v.correction_payload_json).length) throw new CoreError('INVALID_INPUT', 'One-time overrides require an empty payload.');
  return v as unknown as CorrectionInput;
}
