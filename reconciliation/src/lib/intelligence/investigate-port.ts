import 'server-only';
import type { EvidenceRef, InvestigationFinding, InvestigationInput, InvestigationResult, InvestigationStep, InvestigationTools, ProviderOptions } from '../review-contracts';
import { bookingReferences, bookingLink, boundedEvidence, deriveCandidate, itineraryIdentity } from '../core/evidence';
import type { Snapshot } from '../core/store';
import { CoreError, isUUID } from '../core/validation';
import { responsesConfig } from '../providers/responses';
import { runInvestigationPlanner } from './investigation';

export async function investigate(input: InvestigationInput, tools: InvestigationTools, options: ProviderOptions): Promise<InvestigationResult> {
  options.signal.throwIfAborted();
  if (options.mode === 'simulated') return simulate(input, tools, options);
  if (options.mode !== 'live') throw new CoreError('INVESTIGATION_UNAVAILABLE', 'Select an explicit investigation mode.', 503);
  const result = await runInvestigationPlanner(input, async (name, signal) => {
    // Core binds these no-argument reads to options.signal and persists actual I/O.
    signal.throwIfAborted();
    const value = await tools[name]();
    signal.throwIfAborted();
    return value;
  }, options, responsesConfig('investigation'));
  return { ...result, proposed_learning: result.proposed_learning ? {
    ...result.proposed_learning, required_evidence: ['receipt', 'booking_confirmation'], matching_fields: ['booking_reference'],
  } : null };
}

async function simulate(input: InvestigationInput, tools: InvestigationTools, options: ProviderOptions): Promise<InvestigationResult> {
  const steps: InvestigationStep[] = [], observed: EvidenceRef[] = [];
  const read = async <T>(tool: InvestigationStep['tool'], load: () => Promise<T>, refs: (value: T) => EvidenceRef[]) => {
    options.signal.throwIfAborted();
    const value = structuredClone(await load());
    options.signal.throwIfAborted();
    const references = refs(value);
    if (references.some(r => !isUUID(r.id))) throw new CoreError('INVALID_PROVIDER_OUTPUT', 'Read tool returned an invalid evidence identity.', 503);
    observed.push(...references);
    steps.push({ tool, evidence_refs: references.map(r => r.id), summary: `Read ${references.length} stored evidence records (simulated inspection).` });
    return value;
  };
  const receipt = await read('read_receipt', () => tools.read_receipt(), r => r ? [{ kind: 'receipt', id: r.id }] : []);
  if (receipt && receipt.submission_id !== input.submission.id) throw new CoreError('INVALID_PROVIDER_OUTPUT', 'Receipt belongs to a different claim.', 503);
  const documents = await read('read_supporting_documents', () => tools.read_supporting_documents(), ds => ds.map(d => ({ kind: 'supporting_document', id: d.id })));
  if (documents.some(d => d.claim_id !== input.submission.id)) throw new CoreError('INVALID_PROVIDER_OUTPUT', 'Supporting document belongs to a different claim.', 503);
  if (documents.length > 8) throw new CoreError('EVIDENCE_LIMIT', 'More than eight supporting documents.', 503);

  // Read-only projection for the same production evidence helpers used by core assessment.
  const state: Snapshot = {
    submissions: [{ ...input.submission, status: 'pending', latest_run_id: null, updated_at: input.submission.submitted_at }],
    receipts: receipt ? [{ ...receipt, storage_path: '', extracted_at: null }] : [],
    supporting_documents: documents.map(d => ({ ...d, storage_path: '' })),
    policies: [], decisions: [], corrections: [], runs: [],
  };
  boundedEvidence(state, input.submission.id);
  state.policies = await read('read_policy', () => tools.read_policy(), ps => ps.map(p => ({ kind: 'policy', id: p.id })));
  const candidate = deriveCandidate(state, input.submission.id);
  const booking = bookingLink(state, input.submission.id);
  const identity = itineraryIdentity(state, input.submission.id);
  const findings: InvestigationFinding[] = [];
  const receiptReferences = bookingReferences(receipt?.raw_extracted_text ?? null);
  const bookingDocuments = documents.filter(d => d.kind === 'booking_confirmation' && d.extraction_status === 'succeeded');
  const documentReferences = bookingDocuments.map(d => d.facts?.booking_reference?.trim()).filter((reference): reference is string => !!reference);
  const referenceSummary = receiptReferences.length
    ? `Receipt reference: ${receiptReferences.join(', ')}.`
    : 'No labelled booking reference was found in the receipt text.';
  const bookingReferenceSummary = documentReferences.length
    ? `Booking confirmation reference${documentReferences.length === 1 ? '' : 's'}: ${documentReferences.join(', ')}.`
    : 'No successfully extracted booking confirmation reference was found.';
  const receiptVendor = receipt?.parsed_fields_json?.vendor?.trim();
  const documentVendors = [...new Set(bookingDocuments.map(d => d.facts?.vendor?.trim()).filter((vendor): vendor is string => !!vendor))];
  const merchantSummary = receiptVendor && documentVendors.length
    ? `Observed receipt merchant: ${receiptVendor}; booking merchant${documentVendors.length === 1 ? '' : 's'}: ${documentVendors.join(', ')}.`
    : '';
  if (candidate && booking) findings.push({
    id: crypto.randomUUID(), check: 'merchant',
    statement: `The stored receipt and booking confirmation share booking reference ${booking.reference} for observed merchant ${booking.observed_vendor} and canonical merchant ${booking.canonical_vendor}; purchase facts are consistent.`,
    evidence_refs: candidate.source_evidence_refs,
  });
  else if (receipt && !identity) findings.push({
    id: crypto.randomUUID(), check: 'merchant',
    statement: `Stored evidence did not establish a consistent booking relationship. ${referenceSummary} ${bookingReferenceSummary}${merchantSummary ? ` ${merchantSummary}` : ''}`,
    evidence_refs: [{ kind: 'receipt', id: receipt.id }, ...documents.map(d => ({ kind: 'supporting_document' as const, id: d.id }))],
  });
  if (identity) findings.push({
    id: crypto.randomUUID(), check: 'name', statement: 'An applicable policy permits the linked itinerary to identify the claimant, and the stored itinerary satisfies the linkage checks.', evidence_refs: identity,
  });
  const missing = !receipt || receipt.extraction_status !== 'succeeded' || (!bookingDocuments.length && !identity);
  options.signal.throwIfAborted();
  return {
    status: 'completed', mode: 'simulated', model: null, error_code: null,
    summary: candidate
      ? 'Simulated evidence inspection found a corroborated booking relationship. Core must still reassess every mandatory check.'
      : identity
        ? 'Simulated evidence inspection found a policy-authorized linked itinerary for claimant identity. Core must still reassess every mandatory check.'
        : 'Simulated evidence inspection did not establish a booking relationship. Additional or corrected evidence needs review.',
    next_action: missing ? 'request_document' : 'human_review',
    unresolved_question: candidate || identity ? null : missing
      ? 'Can you supply a successfully extracted original receipt and booking confirmation with the same booking reference?'
      : `Review the stored receipt and booking confirmation for one consistent relationship. ${referenceSummary} ${bookingReferenceSummary}${merchantSummary ? ` ${merchantSummary}` : ''}`,
    proposed_learning: candidate, findings, evidence_refs: [...new Set(observed.map(r => r.id))], steps,
  };
}
