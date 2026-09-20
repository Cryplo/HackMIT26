import type { AliasPayload } from '../../src/lib/contracts';

export type Arm = 'sift' | 'all_ai';
export type Assessment = 'matched' | 'flagged' | 'needs_review';
export interface Call {
  id: string; case_id: string; stage: 'extraction' | Arm;
  provider: string; requested_model: string; returned_model: string | null;
  input_tokens: number | null; output_tokens: number | null;
  cached_input_tokens: number | null; cache_write_tokens: number | null;
  latency_ms: number; http_status: number | null; request_id: string | null;
  error: string | null;
}
export interface Outcome {
  assessment: Assessment | null; error: string | null; latency_ms: number;
  call_ids: string[]; checks: unknown[];
}
export interface Pair {
  case_id: string; cohort: string; expected: Assessment;
  facts_sha256: string; first: Arm;
  extraction: { latency_ms: number; error: string | null; call_ids: string[] };
  sift: Outcome; all_ai: Outcome;
}
export interface Price {
  provider: string; requested_model: string; returned_model: string;
  sku: string; region: string; source_url: string; checked_at: string;
  input_usd_per_million: number; output_usd_per_million: number;
  cached_input_usd_per_million: number;
  cache_write_usd_per_million?: number;
  cache_write_accounting?: 'included_in_input' | 'additional_to_input';
}
export interface Labor {
  manual_seconds_per_claim: number; matched_seconds_per_claim: number;
  exception_seconds_per_claim: number; hourly_usd: number;
  source: string;
}
export interface Run {
  assessment_policy?: 'unknown-first-v1' | 'fail-first-v2';
  baseline_kind: 'direct_pdf' | 'shared_extraction';
  schema_version: 1; mode: 'live'; commit: string; started_at: string;
  dataset_sha256: string; reviewed: boolean; selected_cases: number;
  planned_cases: number; concurrency: 1; order: 'alternating';
  baseline_model: string; prices: Price[]; labor: Labor | null;
  pairs: Pair[]; calls: Call[]; status: 'running' | 'completed' | 'interrupted';
  limitations: string[];
  /** Present when Sift reused a source run's saved extraction and the baseline reread every PDF. */
  recheck?: { source_dir: string; source_commit: string; learned_alias: AliasPayload | null };
}
