-- Store a verified prepared template once. Routine reset copies it inside PostgreSQL;
-- it never regenerates assessments, downloads originals, or uploads the full seed again.
begin;
create table public.demo_reset_baselines (
  id text primary key check(id='live-80-v1'),
  seed jsonb not null,
  bucket text not null,
  created_at timestamptz not null default now()
);
alter table public.demo_reset_baselines enable row level security;
revoke all on public.demo_reset_baselines from public,anon,authenticated,service_role;
grant select on public.demo_reset_baselines to service_role;

create function public.core_save_demo_baseline(p_seed jsonb,p_bucket text) returns jsonb
language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='25s' as $$
declare previous demo_reset_baselines; unchecked integer[]:=array[1,2,5,6,7,9,10,12,13,14]; allowed_run_ids text[];
begin
  perform core_lock();
  if not exists(select 1 from storage.buckets where id=p_bucket and public=false)
    then raise exception 'BASELINE_BUCKET_MISMATCH'; end if;
  select * into previous from demo_reset_baselines where id='live-80-v1';
  if found then
    if previous.seed is distinct from p_seed or previous.bucket is distinct from p_bucket
      then raise exception 'BASELINE_EXISTS'; end if;
    return jsonb_build_object('saved',false,'id','live-80-v1');
  end if;
  if jsonb_typeof(p_seed) is distinct from 'object'
    or not(p_seed ?& array['submissions','receipts','policies','supporting_documents','runs','decisions','corrections'])
    or p_seed-array['submissions','receipts','policies','supporting_documents','runs','decisions','corrections'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(p_seed) x where jsonb_typeof(x.value) is distinct from 'array')
    then raise exception 'INVALID_RESET_SEED'; end if;
  if jsonb_array_length(p_seed->'submissions')<>80 or jsonb_array_length(p_seed->'receipts')<>80
    or jsonb_array_length(p_seed->'policies')<>5 or jsonb_array_length(p_seed->'supporting_documents')<>20
    or jsonb_array_length(p_seed->'runs')<>70 or jsonb_array_length(p_seed->'decisions')<>637
    or jsonb_array_length(p_seed->'corrections')<>7
    then raise exception 'INVALID_RESET_SEED'; end if;
  -- Extract once: a correlated scan otherwise expands the full run payload for every decision.
  select array_agg(r->>'id' order by r->>'id') into allowed_run_ids from jsonb_array_elements(p_seed->'runs') r;
  if (select array_agg(s->>'id' order by s->>'id') from jsonb_array_elements(p_seed->'submissions') s)
      is distinct from (select array_agg('41000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,80) n)
    or (select array_agg(r->>'id' order by r->>'id') from jsonb_array_elements(p_seed->'receipts') r)
      is distinct from (select array_agg('62000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,80) n)
    or (select array_agg(p->>'id' order by p->>'id') from jsonb_array_elements(p_seed->'policies') p)
      is distinct from (select array_agg('43000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,5) n)
    or (select array_agg(d->>'id' order by d->>'id') from jsonb_array_elements(p_seed->'supporting_documents') d)
      is distinct from (select array_agg('64000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from unnest(array[5,7,9,10,13,15,17,19,47,49,69,71,72,91,113,115,135,137,138,157]) n)
    or allowed_run_ids
      is distinct from (select array_agg('71000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,80) n where not(n=any(unchecked)))
    or (select array_agg(c->>'id' order by c->>'id') from jsonb_array_elements(p_seed->'corrections') c)
      is distinct from (select array_agg('73000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from unnest(array[15,30,35,37,44,59,68]) n)
    then raise exception 'INVALID_RESET_SEED'; end if;
  if exists(select 1 from jsonb_array_elements(p_seed->'submissions') s where
      coalesce(s->>'email','') !~ '^[^@[:space:]]+@example[.]invalid$' or s->>'currency' is distinct from 'USD'
      or s->>'evidence_revision' is distinct from '1'
      or case when right(s->>'id',12)::int=any(unchecked) then
        s->>'review_revision' is distinct from '1' or s->>'latest_run_id' is not null
        or s->>'status' is distinct from 'pending' or s->>'decision_status' is distinct from 'pending'
      else s->>'latest_run_id' is distinct from replace(s->>'id','41000000-','71000000-')
        or case when right(s->>'id',12)::int=any(array[15,30,35,37,44,59,68]) then
          s->>'review_revision' is distinct from '3' or s->>'status' is distinct from 'rejected' or s->>'decision_status' is distinct from 'rejected'
        else s->>'review_revision' is distinct from '2' or s->>'decision_status' is distinct from 'pending'
          or s->>'status' is distinct from (case when right(s->>'id',12)::int=any(array[36,47,69,80]) then 'needs_review' else 'approved' end)
        end
      end)
    or exists(select 1 from jsonb_array_elements(p_seed->'receipts') r where
      r->>'submission_id' is distinct from replace(r->>'id','62000000-','41000000-')
      or r->>'storage_path' is distinct from 'synthetic/'||(r->>'submission_id')||'/'||(r->>'id')
      or r->>'file_type' is distinct from 'application/pdf' or r->>'extraction_status' is distinct from 'succeeded'
      or r->>'extraction_error' is not null or coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(r->>'extraction_provenance','') not like 'synthetic showcase: cached transcription of generated original%')
    or exists(select 1 from jsonb_array_elements(p_seed->'supporting_documents') d where
      d->>'claim_id' is distinct from '41000000-0000-4000-8000-'||lpad((((right(d->>'id',12))::int+1)/2)::text,12,'0')
      or d->>'storage_path' is distinct from 'synthetic/'||(d->>'claim_id')||'/supporting/'||(d->>'id')
      or d->>'file_type' is distinct from 'application/pdf' or d->>'extraction_status' is distinct from 'succeeded'
      or d->>'extraction_error' is not null or coalesce(d->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(d->>'extraction_provenance','') not like 'synthetic showcase: cached transcription of generated original%')
    then raise exception 'INVALID_RESET_SEED'; end if;
  if exists(select 1 from jsonb_array_elements(p_seed->'runs') r where
      r->>'submission_id' is distinct from replace(r->>'id','71000000-','41000000-')
      or r->>'status' is distinct from 'completed' or r->>'operation' is distinct from 'assessment'
      or r->>'completed_at' is null or r->>'error' is not null
      or r->>'review_revision' is distinct from '1' or r->>'evidence_revision' is distinct from '1' or r->>'knowledge_revision' is distinct from '1'
      or r#>>'{evidence_snapshot,demo_baseline}' is distinct from 'true'
      or coalesce(r#>>'{evidence_snapshot,provenance}','') not like 'Prepared demo history:%')
    or exists(select 1 from jsonb_array_elements(p_seed->'decisions') d where
      coalesce(d->>'id','') !~ '^72000000-0000-4000-8000-[0-9]{12}$'
      or d->>'run_id' is distinct from replace(d->>'submission_id','41000000-','71000000-')
      or d->>'run_id' is null or not ((d->>'run_id')=any(allowed_run_ids))
      or d#>>'{evidence_json,demo_baseline}' is distinct from 'true' or d#>>'{evidence_json,simulated}' is distinct from 'true'
      or coalesce(d#>>'{evidence_json,provenance}','') not like 'Prepared demo history:%'
      or d->>'probability' is not null or d->>'confidence_score' is not null
      or (d->>'check_method'='jev' and d->>'model_used' is distinct from 'simulated-fixture-v1')
      or d#>>'{state_snapshot_json,submission,evidence_revision}' is distinct from '1'
      or coalesce(d#>>'{state_snapshot_json,submission,review_revision}','') not in ('1','2','3')
      or (d->'evidence_json' ? 'auto_approval' and
        (d#>>'{evidence_json,auto_approval,evidence_revision}' is distinct from '1'
          or d#>>'{evidence_json,auto_approval,knowledge_revision}' is distinct from '1')))
    or (select count(distinct d->>'id') from jsonb_array_elements(p_seed->'decisions') d)<>637
    or (select count(*) from jsonb_array_elements(p_seed->'decisions') d where d#>>'{evidence_json,auto_approval,policy}'='policy-caps-v1')<>59
    or exists(select 1 from jsonb_array_elements(p_seed->'corrections') c where
      c->>'submission_id' is distinct from replace(c->>'id','73000000-','41000000-')
      or c->>'human_verdict' is distinct from 'rejected' or c->>'correction_type' is distinct from 'decision_override'
      or c->>'review_revision' is distinct from '3' or coalesce(c->>'human_note','') not like 'Prepared demo decision:%'
      or c#>>'{correction_payload_json,demo_baseline}' is distinct from 'true'
      or c->'correction_payload_json' ? 'feedback_learning')
    then raise exception 'INVALID_RESET_SEED'; end if;
  insert into demo_reset_baselines(id,seed,bucket) values('live-80-v1',p_seed,p_bucket);
  return jsonb_build_object('saved',true,'id','live-80-v1');
end $$;
revoke all on function public.core_save_demo_baseline(jsonb,text) from public,anon,authenticated;
grant execute on function public.core_save_demo_baseline(jsonb,text) to service_role;

create function public.core_reset_saved_demo(p_expected jsonb,p_bucket text) returns jsonb
language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='25s' as $$
declare baseline demo_reset_baselines; rebased jsonb; delta bigint; knowledge bigint;
begin
  perform core_lock();
  select * into baseline from demo_reset_baselines where id='live-80-v1';
  if not found then raise exception 'BASELINE_MISSING'; end if;
  if baseline.bucket is distinct from p_bucket
    or not exists(select 1 from storage.buckets where id=p_bucket and public=false)
    then raise exception 'BASELINE_BUCKET_MISMATCH'; end if;
  if p_expected is distinct from core_snapshot() then raise exception 'STALE_SNAPSHOT'; end if;
  select greatest(coalesce(max(review_revision),0),coalesce(max(evidence_revision),0)) into delta from submissions;
  select knowledge_revision+1 into knowledge from platform_state where id=true;
  rebased := baseline.seed || jsonb_build_object(
    'submissions',(select jsonb_agg(s||jsonb_build_object('review_revision',(s->>'review_revision')::bigint+delta,'evidence_revision',(s->>'evidence_revision')::bigint+delta)) from jsonb_array_elements(baseline.seed->'submissions') s),
    'runs',(select jsonb_agg(r||jsonb_build_object('review_revision',(r->>'review_revision')::bigint+delta,'evidence_revision',(r->>'evidence_revision')::bigint+delta,'knowledge_revision',knowledge)) from jsonb_array_elements(baseline.seed->'runs') r),
    'corrections',(select jsonb_agg(c||jsonb_build_object('review_revision',(c->>'review_revision')::bigint+delta)) from jsonb_array_elements(baseline.seed->'corrections') c),
    'decisions',(select jsonb_agg(
      jsonb_set(d,'{state_snapshot_json,submission}',d#>'{state_snapshot_json,submission}'||jsonb_build_object(
        'review_revision',(d#>>'{state_snapshot_json,submission,review_revision}')::bigint+delta,
        'evidence_revision',(d#>>'{state_snapshot_json,submission,evidence_revision}')::bigint+delta))
      ||jsonb_build_object('evidence_json',case when d->'evidence_json' ? 'auto_approval' then
        jsonb_set(d->'evidence_json','{auto_approval}',d#>'{evidence_json,auto_approval}'||jsonb_build_object('evidence_revision',delta+1,'knowledge_revision',knowledge))
        else d->'evidence_json' end)) from jsonb_array_elements(baseline.seed->'decisions') d));
  -- Retain all existing namespace, busy-work, stale-snapshot and atomic archival checks.
  -- This also restores the inactive prepared rule. The saved template is never changed.
  return core_reset_demo(p_expected,rebased);
end $$;
revoke all on function public.core_reset_saved_demo(jsonb,text) from public,anon,authenticated;
grant execute on function public.core_reset_saved_demo(jsonb,text) to service_role;
commit;
