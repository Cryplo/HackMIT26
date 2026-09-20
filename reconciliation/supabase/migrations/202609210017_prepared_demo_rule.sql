-- An inactive, authored example only: no reviewer feedback, test result or active knowledge.
-- Installing this migration does not seed or reset the current workspace.
begin;
create function public.core_seed_prepared_demo_rule() returns jsonb
language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='25s' as $$
declare
  rule_id constant uuid := '74000000-0000-4000-8000-000000000001';
  source_id constant uuid := '41000000-0000-4000-8000-000000000003';
  candidate jsonb; existing jsonb;
begin
  perform core_lock();
  if not exists(select 1 from submissions s
    join receipts r on r.submission_id=s.id
    join supporting_documents d on d.claim_id=s.id
    where s.id=source_id and s.attendee_name='Sam Mercer'
      and s.email='sam.mercer@example.invalid' and s.category='hotel' and s.currency='USD'
      and s.amount_requested_minor=18000
      and r.id='62000000-0000-4000-8000-000000000003'
      and r.storage_path='synthetic/'||source_id::text||'/'||r.id::text
      and r.file_type='application/pdf' and r.sha256 ~ '^[a-f0-9]{64}$'
      and r.extraction_status='succeeded' and r.extraction_error is null
      and r.extraction_provenance like 'synthetic showcase: cached transcription of generated original%'
      and r.parsed_fields_json @> '{"schema_version":1,"vendor":"Harbor Reservations","amount_minor":18000,"currency":"USD","receipt_date":"2026-09-07","names":["Sam Mercer"],"receipt_number":"SHOW-HOTEL-301"}'::jsonb
      and r.raw_extracted_text like '%HARBOR-SAM-301%'
      and d.id='64000000-0000-4000-8000-000000000005'
      and d.kind='booking_confirmation'
      and d.storage_path='synthetic/'||source_id::text||'/supporting/'||d.id::text
      and d.file_type='application/pdf' and d.sha256 ~ '^[a-f0-9]{64}$'
      and d.extraction_status='succeeded' and d.extraction_error is null
      and d.extraction_provenance like 'synthetic showcase: cached transcription of generated original%'
      and d.facts @> '{"vendor":"Harbor Hotel","booking_reference":"HARBOR-SAM-301","amount_minor":18000,"currency":"USD","purchase_date":"2026-09-07","names":["Sam Mercer"],"receipt_number":"SHOW-HOTEL-301"}'::jsonb
      and d.extracted_text like '%HARBOR-SAM-301%' and d.extracted_text like '%Harbor Hotel%')
    or (select count(*) from receipts where submission_id=source_id) <> 1
    or (select count(*) from supporting_documents where claim_id=source_id) <> 1
    then raise exception 'INVALID_PREPARED_RULE_SOURCE'; end if;

  candidate := jsonb_build_object('id',rule_id,'version',1,'state','disabled','prepared_demo',true,
    'source_submission_id',source_id,'source_correction_id',null,
    'payload','{"observed_vendor":"Harbor Reservations","canonical_vendor":"Harbor Hotel","scope":{"category":"hotel","currency":"USD"}}'::jsonb,
    'created_at',now(),'latest_test',null,'latest_test_error',null);
  select doc into existing from merchant_rules where id=rule_id;
  if found then
    if existing - 'created_at' is distinct from candidate - 'created_at'
      or jsonb_typeof(existing->'created_at') is distinct from 'string'
      then raise exception 'PREPARED_RULE_ID_COLLISION'; end if;
    return jsonb_build_object('inserted',false,'rule',existing);
  end if;
  insert into merchant_rules(id,doc) values(rule_id,candidate);
  insert into rule_history(rule_id,doc) values(rule_id,candidate);
  return jsonb_build_object('inserted',true,'rule',candidate);
end $$;
revoke all on function public.core_seed_prepared_demo_rule() from public,anon,authenticated;
grant execute on function public.core_seed_prepared_demo_rule() to service_role;

alter function public.core_reset_demo(jsonb,jsonb) rename to core_reset_demo_before_prepared_rule;
revoke all on function public.core_reset_demo_before_prepared_rule(jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.core_reset_demo(p_expected jsonb,p_seed jsonb) returns jsonb
language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='25s' as $$
declare result jsonb;
begin
  -- The existing transaction still validates, archives, and replaces the entire demo atomically.
  result := core_reset_demo_before_prepared_rule(p_expected,p_seed);
  perform core_seed_prepared_demo_rule();
  return result;
end $$;
revoke all on function public.core_reset_demo(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.core_reset_demo(jsonb,jsonb) to service_role;
commit;
