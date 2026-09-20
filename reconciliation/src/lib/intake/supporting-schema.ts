import { z } from 'zod';
import { Fields } from './schema';
export const DocumentKindSchema=z.enum(['booking_confirmation','itemized_document','itinerary','payment_confirmation','other']);
export const SupportingFactsSchema=z.object({vendor:Fields.shape.vendor,booking_reference:z.string().max(500).nullable(),receipt_number:Fields.shape.receipt_number,names:Fields.shape.names,purchase_date:Fields.shape.receipt_date,currency:Fields.shape.currency,amount_minor:Fields.shape.amount_minor}).strict();
export const SupportingExtractionSchema=z.object({raw_extracted_text:z.string().max(50000),facts:SupportingFactsSchema}).strict();
