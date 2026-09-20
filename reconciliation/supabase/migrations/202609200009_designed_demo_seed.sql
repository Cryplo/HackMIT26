-- Designed receipt seed uses fresh immutable original IDs. Applying this migration resets nothing.
do $$ begin if core_platform_version() <> 4 then raise exception 'Expected platform version 4'; end if; end $$;
create or replace function public.core_reset_demo(p_expected jsonb,p_seed jsonb) returns jsonb
language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='25s' as $$
declare archive_id uuid; previous_knowledge bigint; next_revision bigint;
begin
  perform core_lock();
  lock table platform_state,submissions,receipts,policy_rules,reconciliation_runs,decisions,corrections,model_calls,merchant_rules,rule_history,rule_tests,extraction_history,supporting_documents,investigation_steps,resolution_procedures,procedure_history,procedure_tests,claim_messages,message_delivery_events in access exclusive mode;
  if p_expected is distinct from core_snapshot() then raise exception 'STALE_SNAPSHOT'; end if;
  if exists(select 1 from reconciliation_runs where status='running')
    or exists(select 1 from receipts where extraction_status='pending')
    or exists(select 1 from supporting_documents where extraction_status='pending')
    or exists(select 1 from claim_messages where doc->>'status' in ('queued','sending','delivery_unknown')
      or doc->>'next_attempt_at' is not null) then raise exception 'RESET_BUSY'; end if;
  if exists(select 1 from submissions where email !~ '^[^@[:space:]]+@example[.]invalid$')
    or exists(select 1 from receipts where storage_path is distinct from 'synthetic/'||submission_id::text||'/'||id::text)
    or exists(select 1 from supporting_documents where storage_path is distinct from 'synthetic/'||claim_id::text||'/supporting/'||id::text)
    or exists(select 1 from claim_messages where coalesce(doc->>'recipient','') !~ '^[^@[:space:]]+@example[.]invalid$')
    then raise exception 'SYNTHETIC_ONLY'; end if;

  if jsonb_typeof(p_seed) is distinct from 'object'
    or not (p_seed ?& array['submissions','receipts','policies','supporting_documents'])
    or (p_seed - array['submissions','receipts','policies','supporting_documents']) <> '{}'::jsonb
    then raise exception 'INVALID_RESET_SEED'; end if;
  if jsonb_typeof(p_seed->'submissions') is distinct from 'array' or jsonb_array_length(p_seed->'submissions')<>14
    or jsonb_typeof(p_seed->'receipts') is distinct from 'array' or jsonb_array_length(p_seed->'receipts')<>14
    or jsonb_typeof(p_seed->'policies') is distinct from 'array' or jsonb_array_length(p_seed->'policies')<>5
    or jsonb_typeof(p_seed->'supporting_documents') is distinct from 'array' or jsonb_array_length(p_seed->'supporting_documents')<>8
    then raise exception 'INVALID_RESET_SEED'; end if;
  if (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(p_seed->'submissions') x)
      is distinct from (select array_agg('41000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,14) n)
    or (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(p_seed->'receipts') x)
      is distinct from (select array_agg('62000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,14) n)
    or (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(p_seed->'policies') x)
      is distinct from (select array_agg('43000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,5) n)
    or (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(p_seed->'supporting_documents') x)
      is distinct from (select array_agg('64000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from unnest(array[5,7,9,10,13,15,17,19]) n)
    then raise exception 'INVALID_RESET_SEED'; end if;
  if exists(select 1 from jsonb_array_elements(p_seed->'submissions') s where
      coalesce(s->>'email','') !~ '^[^@[:space:]]+@example[.]invalid$'
      or s->>'status' is distinct from 'pending' or s->>'decision_status' is distinct from 'pending'
      or s->>'latest_run_id' is not null or s->>'review_revision' is distinct from '0' or s->>'evidence_revision' is distinct from '0')
    or exists(select 1 from jsonb_array_elements(p_seed->'receipts') r where
      r->>'submission_id' is distinct from replace(r->>'id','62000000-','41000000-')
      or r->>'storage_path' is distinct from 'synthetic/'||(r->>'submission_id')||'/'||(r->>'id')
      or r->>'file_type' is distinct from 'application/pdf' or r->>'extraction_status' is distinct from 'succeeded'
      or coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$' or r->>'extraction_error' is not null
      or coalesce(r->>'extraction_provenance','') not like 'synthetic showcase: cached transcription of generated original%')
    or exists(select 1 from jsonb_array_elements(p_seed->'supporting_documents') d where
      d->>'claim_id' is distinct from '41000000-0000-4000-8000-'||lpad((((right(d->>'id',12))::int+1)/2)::text,12,'0')
      or d->>'storage_path' is distinct from 'synthetic/'||(d->>'claim_id')||'/supporting/'||(d->>'id')
      or d->>'file_type' is distinct from 'application/pdf' or d->>'extraction_status' is distinct from 'succeeded'
      or coalesce(d->>'sha256','') !~ '^[a-f0-9]{64}$' or d->>'extraction_error' is not null
      or coalesce(d->>'extraction_provenance','') not like 'synthetic showcase: cached transcription of generated original%')
    then raise exception 'INVALID_RESET_SEED'; end if;

  select knowledge_revision into previous_knowledge from platform_state where id;
  select greatest(coalesce(max(review_revision),0),coalesce(max(evidence_revision),0))+1 into next_revision from submissions;
  -- Raw rows retain evidence snapshots, private provider responses, and all histories.
  insert into demo_reset_archives(snapshot) values(jsonb_build_object(
    'platform_state',coalesce((select jsonb_agg(to_jsonb(t) order by id) from platform_state t),'[]'::jsonb),
    'submissions',coalesce((select jsonb_agg(to_jsonb(t) order by id) from submissions t),'[]'::jsonb),
    'receipts',coalesce((select jsonb_agg(to_jsonb(t) order by id) from receipts t),'[]'::jsonb),
    'policy_rules',coalesce((select jsonb_agg(to_jsonb(t) order by id) from policy_rules t),'[]'::jsonb),
    'reconciliation_runs',coalesce((select jsonb_agg(to_jsonb(t) order by id) from reconciliation_runs t),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(to_jsonb(t) order by id) from decisions t),'[]'::jsonb),
    'corrections',coalesce((select jsonb_agg(to_jsonb(t) order by id) from corrections t),'[]'::jsonb),
    'model_calls',coalesce((select jsonb_agg(to_jsonb(t) order by id) from model_calls t),'[]'::jsonb),
    'merchant_rules',coalesce((select jsonb_agg(to_jsonb(t) order by id) from merchant_rules t),'[]'::jsonb),
    'rule_history',coalesce((select jsonb_agg(to_jsonb(t) order by id) from rule_history t),'[]'::jsonb),
    'rule_tests',coalesce((select jsonb_agg(to_jsonb(t) order by id) from rule_tests t),'[]'::jsonb),
    'extraction_history',coalesce((select jsonb_agg(to_jsonb(t) order by id) from extraction_history t),'[]'::jsonb),
    'supporting_documents',coalesce((select jsonb_agg(to_jsonb(t) order by id) from supporting_documents t),'[]'::jsonb),
    'investigation_steps',coalesce((select jsonb_agg(to_jsonb(t) order by id) from investigation_steps t),'[]'::jsonb),
    'resolution_procedures',coalesce((select jsonb_agg(to_jsonb(t) order by id) from resolution_procedures t),'[]'::jsonb),
    'procedure_history',coalesce((select jsonb_agg(to_jsonb(t) order by id) from procedure_history t),'[]'::jsonb),
    'procedure_tests',coalesce((select jsonb_agg(to_jsonb(t) order by id) from procedure_tests t),'[]'::jsonb),
    'claim_messages',coalesce((select jsonb_agg(to_jsonb(t) order by id) from claim_messages t),'[]'::jsonb),
    'message_delivery_events',coalesce((select jsonb_agg(to_jsonb(t) order by id) from message_delivery_events t),'[]'::jsonb)
  )) returning id into archive_id;
  truncate table submissions,receipts,policy_rules,reconciliation_runs,decisions,corrections,model_calls,merchant_rules,rule_history,rule_tests,extraction_history,supporting_documents,investigation_steps,resolution_procedures,procedure_history,procedure_tests,claim_messages,message_delivery_events;
  insert into policy_rules select * from jsonb_populate_recordset(null::policy_rules,p_seed->'policies');
  insert into submissions select * from jsonb_populate_recordset(null::submissions,p_seed->'submissions');
  insert into receipts select * from jsonb_populate_recordset(null::receipts,p_seed->'receipts');
  insert into supporting_documents select * from jsonb_populate_recordset(null::supporting_documents,p_seed->'supporting_documents');
  -- Invalidate stale individual mutations as well as stale workspace snapshots.
  update submissions s set review_revision=next_revision,evidence_revision=next_revision,updated_at=(seed->>'updated_at')::timestamptz
    from jsonb_array_elements(p_seed->'submissions') seed where s.id=(seed->>'id')::uuid;
  -- Never reuse a previous workspace token after reset.
  update platform_state set knowledge_revision=previous_knowledge+1 where id;
  return jsonb_build_object('reset',true,'archive_id',archive_id);
end $$;
revoke all on function public.core_reset_demo(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.core_reset_demo(jsonb,jsonb) to service_role;
