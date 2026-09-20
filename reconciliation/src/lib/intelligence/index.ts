import 'server-only';
import type { IntelligencePort } from '../review-contracts';
import { build_rule_suite, evaluate_rule } from './learning';
import { search } from './search';
import { investigate } from './investigate-port';
import { build_procedure_suite, evaluate_procedure } from './procedures';

export const intelligence: IntelligencePort = {
  build_rule_suite,
  evaluate_rule,
  search,
  investigate,
  build_procedure_suite,
  evaluate_procedure,
};
