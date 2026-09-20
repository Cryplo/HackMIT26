-- state_snapshot_json is audit evidence that no read path consumes. Aggregating it
-- pushed core_snapshot past the statement timeout at ~500 decisions.
create or replace function public.core_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'submissions',coalesce((select jsonb_agg(s order by submitted_at,id) from submissions s),'[]'),
 'receipts',coalesce((select jsonb_agg(r) from receipts r),'[]'),
 'policies',coalesce((select jsonb_agg(p) from policy_rules p),'[]'),
 'decisions',coalesce((select jsonb_agg(to_jsonb(d)-'state_snapshot_json' order by created_at,id) from decisions d),'[]'),
 'corrections',coalesce((select jsonb_agg(c order by corrected_at,id) from corrections c),'[]'),
 'runs',coalesce((select jsonb_agg(r) from reconciliation_runs r),'[]'));
$$;
