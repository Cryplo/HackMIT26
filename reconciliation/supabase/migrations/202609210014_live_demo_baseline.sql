-- Preserve the existing archive, stale-snapshot, namespace, processing and original-evidence guards.
-- The public wrapper adds explicitly authored history, never provider usage or email/learning jobs.
begin;
alter function public.core_reset_demo(jsonb,jsonb) rename to core_reset_demo_unchecked;
revoke all on function public.core_reset_demo_unchecked(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.core_reset_demo(p_expected jsonb,p_seed jsonb) returns jsonb
language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='25s' as $$
declare result jsonb; raw_seed jsonb; custom_archive jsonb; revision bigint; knowledge bigint; prepared boolean;
  unchecked integer[] := array[1,2,5,6,7,9,10,12,13,14,15,16,17,18,19,20,21,22,30,44];
begin
  perform core_lock();
  lock table custom_checks,custom_check_history in access exclusive mode;
  custom_archive := jsonb_build_object(
    'custom_checks',coalesce((select jsonb_agg(to_jsonb(t) order by id) from custom_checks t),'[]'::jsonb),
    'custom_check_history',coalesce((select jsonb_agg(to_jsonb(t) order by id) from custom_check_history t),'[]'::jsonb));
  prepared := p_seed ? 'runs';
  raw_seed := p_seed;
  if prepared then
    if jsonb_typeof(p_seed) is distinct from 'object'
      or not(p_seed ?& array['submissions','receipts','policies','supporting_documents','runs','decisions','corrections'])
      or p_seed - array['submissions','receipts','policies','supporting_documents','runs','decisions','corrections'] <> '{}'::jsonb
      or jsonb_array_length(p_seed->'submissions') <> 80
      or jsonb_typeof(p_seed->'runs') is distinct from 'array' or jsonb_array_length(p_seed->'runs') <> 60
      or jsonb_typeof(p_seed->'decisions') is distinct from 'array' or jsonb_array_length(p_seed->'decisions') <> 544
      or jsonb_typeof(p_seed->'corrections') is distinct from 'array' or jsonb_array_length(p_seed->'corrections') <> 4
      then raise exception 'INVALID_RESET_SEED'; end if;
    raw_seed := (p_seed - array['runs','decisions','corrections']) || jsonb_build_object('submissions',
      (select jsonb_agg(s || '{"status":"pending","decision_status":"pending","latest_run_id":null,"review_revision":0,"evidence_revision":0}'::jsonb)
        from jsonb_array_elements(p_seed->'submissions') s));
  end if;
  -- This function still owns validation of exact claim/receipt/document IDs and all archive guards.
  -- Any error below rolls this archive and replacement back with the rest of the transaction.
  result := core_reset_demo_unchecked(p_expected,raw_seed);
  select evidence_revision into revision from submissions limit 1;
  select knowledge_revision into knowledge from platform_state where id;
  if prepared then
    if (select array_agg(r->>'id' order by r->>'id') from jsonb_array_elements(p_seed->'runs') r)
      is distinct from (select array_agg('71000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,80) n where not(n=any(unchecked)))
      or (select array_agg(c->>'id' order by c->>'id') from jsonb_array_elements(p_seed->'corrections') c)
      is distinct from array['73000000-0000-4000-8000-000000000035','73000000-0000-4000-8000-000000000037','73000000-0000-4000-8000-000000000059','73000000-0000-4000-8000-000000000068']
      then raise exception 'INVALID_RESET_SEED'; end if;
    if exists(select 1 from jsonb_array_elements(p_seed->'runs') r where
      r->>'submission_id' is distinct from replace(r->>'id','71000000-','41000000-')
      or r->>'status' is distinct from 'completed' or r->>'operation' is distinct from 'assessment'
      or r->>'completed_at' is null or r->>'error' is not null
      or (r->>'review_revision')::bigint is distinct from revision or (r->>'evidence_revision')::bigint is distinct from revision
      or (r->>'knowledge_revision')::bigint is distinct from knowledge
      or r#>>'{evidence_snapshot,demo_baseline}' is distinct from 'true'
      or r#>>'{evidence_snapshot,provenance}' not like 'Prepared demo history:%')
      or exists(select 1 from jsonb_array_elements(p_seed->'decisions') d where
        d->>'id' !~ '^72000000-0000-4000-8000-[0-9]{12}$'
        or d->>'submission_id' is distinct from '41000000-0000-4000-8000-'||lpad((((right(d->>'id',12))::int-1)/10+1)::text,12,'0')
        or d->>'run_id' is distinct from replace(d->>'submission_id','41000000-','71000000-')
        or d#>>'{evidence_json,demo_baseline}' is distinct from 'true' or d#>>'{evidence_json,simulated}' is distinct from 'true'
        or d#>>'{evidence_json,provenance}' not like 'Prepared demo history:%'
        or d->>'probability' is not null or d->>'confidence_score' is not null
        or (d->>'check_method'='jev' and d->>'model_used' is distinct from 'simulated-fixture-v1'))
      then raise exception 'INVALID_RESET_SEED'; end if;
    if exists(select 1 from jsonb_array_elements(p_seed->'runs') r where
      (select array_agg(d->>'field_checked' order by d->>'field_checked') from jsonb_array_elements(p_seed->'decisions') d
        where d->>'run_id'=r->>'id' and d->>'check_method'<>'human')
        is distinct from array['amount','currency','duplicate','merchant','name','overall_status','policy','policy_cap','receipt_date'])
      or exists(select 1 from jsonb_array_elements(p_seed->'corrections') c where
        c->>'submission_id' is distinct from replace(c->>'id','73000000-','41000000-')
        or c->>'human_verdict' is distinct from 'rejected' or c->>'correction_type' is distinct from 'decision_override'
        or coalesce(c->>'human_note','') not like 'Prepared demo decision:%'
        or c#>>'{correction_payload_json,demo_baseline}' is distinct from 'true'
        or c->'correction_payload_json' ? 'feedback_learning'
        or (c->>'review_revision')::bigint is distinct from revision+2
        or not exists(select 1 from jsonb_array_elements(p_seed->'decisions') d where d->>'id'=c->>'decision_id'
          and d->>'submission_id'=c->>'submission_id' and d->>'verdict'='fail' and d->>'field_checked' in ('amount','policy_cap'))
        or not exists(select 1 from jsonb_array_elements(p_seed->'decisions') d where d#>>'{evidence_json,correction_id}'=c->>'id'
          and d->>'submission_id'=c->>'submission_id' and d->>'check_method'='human' and d#>>'{answer_json,value}'='rejected'))
      then raise exception 'INVALID_RESET_SEED'; end if;
    if exists(select 1 from jsonb_array_elements(p_seed->'submissions') s where
      (s->>'evidence_revision')::bigint is distinct from revision
      or case when right(s->>'id',12)::int=any(unchecked) then
        s->>'latest_run_id' is not null or s->>'status' is distinct from 'pending' or s->>'decision_status' is distinct from 'pending'
        or (s->>'review_revision')::bigint is distinct from revision
      else s->>'latest_run_id' is distinct from replace(s->>'id','41000000-','71000000-')
        or case when right(s->>'id',12)::int=any(array[35,37,59,68]) then
          s->>'status' is distinct from 'rejected' or s->>'decision_status' is distinct from 'rejected'
          or (s->>'review_revision')::bigint is distinct from revision+2
        else s->>'decision_status' is distinct from 'pending' or (s->>'review_revision')::bigint is distinct from revision+1
          or s->>'status' is distinct from (case when right(s->>'id',12)::int=any(array[36,47,69,80]) then 'needs_review' else 'approved' end)
        end
      end)
      or (select count(*) from jsonb_array_elements(p_seed->'decisions') d where d->>'check_method'='human') <> 4
      or (select count(*) from jsonb_array_elements(p_seed->'decisions') d where d#>>'{evidence_json,auto_approval,policy}'='policy-caps-v1') <> 52
      or exists(select 1 from jsonb_array_elements(p_seed->'decisions') d where d->'evidence_json' ? 'auto_approval' and
        (d#>>'{evidence_json,auto_approval,run_id}' is distinct from d->>'run_id'
          or (d#>>'{evidence_json,auto_approval,evidence_revision}')::bigint is distinct from revision
          or (d#>>'{evidence_json,auto_approval,knowledge_revision}')::bigint is distinct from knowledge))
      then raise exception 'INVALID_RESET_SEED'; end if;

    insert into reconciliation_runs select * from jsonb_populate_recordset(null::reconciliation_runs,p_seed->'runs');
    insert into decisions select * from jsonb_populate_recordset(null::decisions,p_seed->'decisions');
    insert into corrections select * from jsonb_populate_recordset(null::corrections,p_seed->'corrections');
    update submissions s set status=seed->>'status',decision_status=seed->>'decision_status',
      latest_run_id=(seed->>'latest_run_id')::uuid,review_revision=(seed->>'review_revision')::bigint,
      updated_at=(seed->>'updated_at')::timestamptz
      from jsonb_array_elements(p_seed->'submissions') seed where s.id=(seed->>'id')::uuid;
  end if;
  update demo_reset_archives set snapshot=snapshot||custom_archive where id=(result->>'archive_id')::uuid;
  truncate table custom_checks,custom_check_history;
  return result;
end $$;
revoke all on function public.core_reset_demo(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.core_reset_demo(jsonb,jsonb) to service_role;
commit;
