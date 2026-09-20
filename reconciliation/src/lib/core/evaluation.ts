import type { AssessExample, Assessment, Check } from '../review-contracts';
import type { ModelCall } from '../contracts';
import type { CoreService } from './service';
import { CoreError } from './validation';
export interface EvaluationObservation {
  submission_id: string; alias_ids: string[]; assessment: Assessment | null;
  checks: Check[]; model_calls: ModelCall[]; latency_ms: number;
  error_code: string | null;
}
export function createAssessExample(core: CoreService, observe?: (result: EvaluationObservation) => void): AssessExample {
  void core; void observe;
  return async () => { throw new CoreError('EVALUATION_UNAVAILABLE', 'Assessment seam is not enabled yet.', 503); };
}
