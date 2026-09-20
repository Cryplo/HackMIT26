/** Types this evaluation scope consumes from the product.
 *
 * `Assessment`, `Category` and the rest come from the published contracts. `DocumentKind`
 * is part of the investigation contract design but is not exported by
 * `src/lib/review-contracts.ts` at this commit, so it is mirrored here and must be
 * replaced by the shared export once B publishes it. Nothing in this directory may add
 * production types of its own.
 */
export type { Assessment, Category, Check, ClaimFacts, ParsedReceipt, PolicyRule, ReceiptEvidence, RelatedClaim } from '../../src/lib/review-contracts';

/** Mirror of the proposed shared union; keep identical to 00-contracts.md section 2. */
export type DocumentKind = 'booking_confirmation' | 'itemized_document' | 'itinerary' | 'payment_confirmation' | 'other';
