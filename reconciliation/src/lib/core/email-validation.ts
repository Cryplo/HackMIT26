import { z } from 'zod';
import { CoreError } from './validation';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().uuid();
const subject = z.string().trim().min(1).max(200).refine(value => !/[\r\n\u0000]/.test(value));
const body = z.string().trim().min(1).max(8000).refine(value => !value.includes('\u0000'));

export const emailDraftSchema = z.object({
  kind: z.enum(['approval', 'rejection']),
  expected_review_revision: revision,
  reason_check_ids: z.array(identifier).max(12).refine(ids => new Set(ids).size === ids.length),
  applicant_reason: z.string().trim().max(1500).optional(),
}).strict();

export const emailEditSchema = z.object({ expected_draft_revision: revision, subject, body }).strict();
export const emailConfirmationSchema = z.object({
  expected_review_revision: revision,
  human_verdict: z.enum(['approved', 'rejected']),
  human_note: z.string().trim().min(1).max(2000),
  message_id: identifier,
  expected_draft_revision: revision,
  request_id: identifier,
}).strict();
export const emailRetrySchema = z.object({ expected_message_revision: revision }).strict();

export function emailInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new CoreError('INVALID_INPUT', 'Invalid email request. Check the required fields and refresh stale drafts.');
  return parsed.data;
}

export function emailIdentifier(value: string): string {
  if (!identifier.safeParse(value).success) throw new CoreError('INVALID_INPUT', 'A valid claim or message identifier is required.');
  return value;
}
