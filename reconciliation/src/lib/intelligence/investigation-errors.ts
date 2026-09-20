import { CoreError } from '../core/validation';

const reasons = {
  SCHEMA: 'The investigator returned findings in an unsupported format.',
  UNOBSERVED_CITATION: 'The investigator cited evidence it had not read. Its findings were not saved.',
  EMPTY_FINDINGS: 'The investigator returned neither findings nor an unresolved question.',
  MISSING_QUESTION: 'The investigator requested evidence without saying what was missing.',
  PROCEDURE_EVIDENCE: 'The proposed check did not include the required receipt and booking evidence.',
  PROCEDURE_SCOPE: 'The proposed check did not match the supported hotel evidence scope.',
  RESPONSE_SHAPE: 'The model response did not follow the supported response format.',
  INCOMPLETE_RESPONSE: 'The model stopped before completing its response.',
  REFUSED_CONTENT: 'The model declined the request or returned unsupported content.',
  TOOL_CALL: 'The investigator requested an unsupported tool or reused a tool call.',
  TOOL_ARGUMENTS: 'The investigator supplied arguments to a read tool that takes none.',
  MIXED_OUTPUT: 'The investigator combined tool requests and final findings in one response.',
  MISSING_FINAL: 'The investigator did not return one final set of findings.',
  MALFORMED_JSON: 'The model returned a response that could not be read as structured data.',
  EVIDENCE_ID: 'A stored evidence record had an invalid identifier.',
  EVIDENCE_OWNERSHIP: 'An evidence read returned a record belonging to another claim.',
  EVIDENCE_SHAPE: 'A stored evidence record had an unsupported format.',
} as const;
type Reason = keyof typeof reasons;
const codes = {
  INVALID_PROVIDER_OUTPUT: 'The investigator returned a response that could not be validated. The specific reason was not recorded for this run.',
  PROVIDER_TIMEOUT: 'The investigation timed out or was interrupted before it finished.',
  PROVIDER_UNAVAILABLE: 'The model service could not complete the request.',
  BUDGET_EXHAUSTED: 'The investigation reached its limit of planning requests or evidence reads.',
  EVIDENCE_LIMIT: 'The available evidence exceeded the investigation size limit.',
  STALE_RUN: 'The evidence changed while the investigation was running.',
  INVESTIGATION_UNAVAILABLE: 'The investigation service did not return a usable result.',
  JEV_INVALID: 'The follow-up claim check returned an invalid model response.',
  JEV_UNAVAILABLE: 'The follow-up claim check could not reach its model service.',
  INVESTIGATION_FAILED: 'The investigation could not finish. Review the saved evidence and check history.',
} as const;
const stages = ['EVIDENCE', 'PLANNING', 'VALIDATION', 'REASSESSMENT', 'PUBLICATION'] as const;
export type InvestigationStage = typeof stages[number];

export function invalidInvestigation(reason: Reason, message: string) {
  return Object.assign(new CoreError('INVALID_PROVIDER_OUTPUT', message, 503), { investigationReason: reason });
}

/** Persist only allowlisted tags; exception messages can contain provider or document data. */
export function investigationFailure(error: unknown, signal: AbortSignal, stage: InvestigationStage): string {
  const code = signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
    ? 'PROVIDER_TIMEOUT' : error instanceof CoreError && Object.hasOwn(codes, error.code) ? error.code : 'INVESTIGATION_FAILED';
  const reason = code === 'INVALID_PROVIDER_OUTPUT' && error instanceof CoreError && 'investigationReason' in error
    && typeof error.investigationReason === 'string' && Object.hasOwn(reasons, error.investigationReason) ? `:${error.investigationReason}` : '';
  return `${code}:${stage}${reason}`;
}

export function investigationFailureDetails(error: string | null) {
  const parts = (error ?? '').split(':');
  const [code, stage, reason] = parts;
  const valid = Object.hasOwn(codes, code) && parts.length <= 3
    && (parts.length < 2 || stages.includes(stage as InvestigationStage))
    && (parts.length < 3 || (code === 'INVALID_PROVIDER_OUTPUT' && Object.hasOwn(reasons, reason)));
  return {
    message: valid ? reason ? reasons[reason as Reason] : codes[code as keyof typeof codes] : codes.INVESTIGATION_FAILED,
    detail: valid ? error : null,
  };
}
