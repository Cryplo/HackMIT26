import { z } from 'zod';
import { Submission } from '../intake/schema';
import { SupportingFactsSchema } from '../intake/supporting-schema';

export const InboxExtraction = z.object({
  document_kind: z.enum(['receipt', 'booking_confirmation', 'itinerary', 'email', 'other']),
  facts: SupportingFactsSchema,
  request: z.object({
    attendee_name: z.string().max(200).nullable(),
    email: z.email().max(254).nullable(),
    amount_requested_minor: z.number().int().min(0).max(2147483647).nullable(),
    category: Submission.shape.category.nullable(),
    origin_location: z.string().max(200).nullable(),
  }).strict(),
  raw_extracted_text: z.string().max(50000),
}).strict();
export type InboxEvidence = z.infer<typeof InboxExtraction>;
export type InboxDocument = {
  id: string; filename: string; file_type: string; sha256: string;
  evidence: InboxEvidence | null; error: string | null;
  provenance: string; latency_ms: number | null;
};
export type MatchCandidate = { receipt_id: string; reasons: string[]; warnings: string[]; score: number };
export type InboxSuggestion = { document_id: string; suggested_receipt_id: string | null; candidates: MatchCandidate[] };
export const ConfirmImport = z.object({
  receipt_id: z.uuid(), supporting_ids: z.array(z.uuid()).max(8),
  submission: Submission,
  confirmed: z.literal(true),
}).strict().refine(v => new Set([v.receipt_id, ...v.supporting_ids]).size === v.supporting_ids.length + 1, 'Select each document only once.');
export type ImportResult = { submission_id: string; receipt_id: string; supporting_count: number };
