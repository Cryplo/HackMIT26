import 'server-only';
import type { IntelligencePort } from '../review-contracts';
import { build_rule_suite, evaluate_rule } from './learning';
import { search } from './search';

export const intelligence: IntelligencePort = {
  build_rule_suite,
  evaluate_rule,
  search,
  async investigate(_input, _tools, options) {
    options.signal.throwIfAborted();
    return {
      status: 'unavailable', mode: options.mode, model: null, next_action: 'human_review',
      evidence_refs: [], steps: [], error_code: 'INVESTIGATION_UNAVAILABLE',
      summary: 'Automated investigation is unavailable. Review the recorded evidence manually.',
    };
  },
};
