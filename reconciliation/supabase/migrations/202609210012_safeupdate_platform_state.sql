-- pg_safeupdate fix: core_receipt_changed and core_rule still updated platform_state
-- without a WHERE clause; PostgREST sessions (authenticator) preload safeupdate and reject
-- them with 21000 "UPDATE requires a WHERE clause". Targets the singleton row explicitly,
-- matching 202609200007_policy_revision_safeupdate.sql. Applied to live project
-- pqjqsqkzmddgrhjverof on 2026-09-20 via direct postgres connection (pooler us-east-2).
do $$ begin if core_platform_version() <> 4 then raise exception 'Expected platform version 4'; end if; end $$;

CREATE OR REPLACE FUNCTION public.core_receipt_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform core_lock();
 if tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then raise exception 'RECEIPT_CONFLICT';end if;
  insert into extraction_history(receipt_id,doc) values(old.id,to_jsonb(old));
  if exists(select 1 from merchant_rules where doc->>'source_submission_id'=new.submission_id::text and doc->>'state'='active') then update platform_state set knowledge_revision=knowledge_revision+1 where id = true;end if;
  with changed as (update merchant_rules set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source evidence changed.') where doc->>'source_submission_id'=new.submission_id::text and doc->>'state'<>'disabled' returning id,doc) insert into rule_history(rule_id,doc)select id,doc from changed;
  update submissions set evidence_revision=evidence_revision+1,review_revision=review_revision+1,updated_at=now() where id=new.submission_id;
 end if;
 return new;
end $function$


CREATE OR REPLACE FUNCTION public.core_rule(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare action text:=p_input->>'action';rule jsonb;rid uuid;s submissions;c corrections;r receipts;k bigint;b jsonb;t jsonb;attempt uuid;fresh boolean;report jsonb;
begin
 perform core_lock();select knowledge_revision into k from platform_state;
 if action='propose' then
  select * into s from submissions where id=(p_input->>'submission_id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
  if s.review_revision is distinct from (p_input->>'expected_review_revision')::bigint then raise exception 'STALE_REVIEW';end if;
  select * into c from corrections where submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1;select * into r from receipts where submission_id=s.id;
  if c.human_verdict is distinct from 'approved' or r.extraction_status is distinct from 'succeeded' or coalesce(length(trim(r.parsed_fields_json->>'vendor')),0)=0 then raise exception 'RULE_SOURCE_REQUIRED';end if;
  if coalesce(length(trim(p_input->>'canonical_vendor')),0)not between 1 and 120 then raise exception 'INVALID_INPUT';end if;
  rid:=gen_random_uuid();rule:=jsonb_build_object('id',rid,'version',1,'state','draft','source_submission_id',s.id,'source_correction_id',c.id,'payload',jsonb_build_object('observed_vendor',trim(r.parsed_fields_json->>'vendor'),'canonical_vendor',trim(p_input->>'canonical_vendor'),'scope',jsonb_build_object('category',s.category,'currency',s.currency)),'created_at',now(),'latest_test',null,'latest_test_error',null);
  insert into merchant_rules values(rid,rule);
 else
  rid:=(p_input->>'id')::uuid;select doc into rule from merchant_rules where id=rid;if not found then raise exception 'NOT_FOUND';end if;
  select * into s from submissions where id=(rule->>'source_submission_id')::uuid;select * into c from corrections where submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1;
  if action='tested' then
   attempt:=(p_input->>'attempt_id')::uuid;select doc into t from rule_tests where id=attempt and rule_id=rid;if not found then raise exception 'STALE_RULE_TEST';end if;b:=t->'binding';report:=nullif(p_input->'report','null'::jsonb);
   fresh:=rule->>'state'='draft' and rule->>'version'=t->>'rule_version' and rule->>'latest_attempt_id'=attempt::text and (b->>'knowledge_revision')::bigint=k and (b->>'source_review_revision')::bigint=s.review_revision and b->>'source_correction_id'=c.id::text;
   t:=t||jsonb_build_object('observations',p_input->'observations','report',coalesce(report,t->'report'),'status',case when p_input->>'error' is null and fresh then 'completed' else 'failed' end,'error',case when not fresh then 'STALE_RULE_TEST' else p_input->>'error' end);
   update rule_tests set doc=t where id=attempt;
   if fresh then rule:=rule||jsonb_build_object('latest_test',case when p_input->>'error' is null then report else null end,'test_binding',case when p_input->>'error' is null then b else null end,'latest_test_error',p_input->>'error');end if;
  else
   if (rule->>'version')::int is distinct from (p_input->>'expected_rule_version')::int then raise exception 'STALE_RULE';end if;
   if action='disable' then
    if rule->>'state'='disabled' then raise exception 'STALE_RULE';end if;
    if rule->>'state'='active' then k:=k+1;end if;
    rule:=rule||jsonb_build_object('state','disabled','version',(rule->>'version')::int+1,'latest_test',null,'test_binding',null);
   else
    if c.id::text is distinct from rule->>'source_correction_id' or c.human_verdict is distinct from 'approved' or rule->>'state'<>'draft' then raise exception 'STALE_RULE';end if;
    if action='test' then
     if p_input->>'mode' is null or p_input->>'mode' not in ('live','simulated') or coalesce(length(p_input->>'provider_identity'),0)=0 or coalesce(p_input->>'suite_hash','')!~'^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
     b:=jsonb_build_object('source_correction_id',c.id,'source_review_revision',s.review_revision,'knowledge_revision',k,'suite_hash',p_input->>'suite_hash','provider_identity',p_input->>'provider_identity','mode',p_input->>'mode');attempt:=gen_random_uuid();
     t:=jsonb_build_object('id',attempt,'rule_id',rid,'rule_version',rule->'version','binding',b,'status','running','report',null,'error',null,'observations','[]'::jsonb);
     insert into rule_tests values(attempt,rid,t);rule:=rule||jsonb_build_object('latest_attempt_id',attempt,'latest_test',null,'test_binding',null,'latest_test_error',null);
    elsif action='activate' then
     b:=rule->'test_binding';report:=rule->'latest_test';
     if report->>'passed' is distinct from 'true' or report->>'rule_id' is distinct from rid::text or report->>'rule_version' is distinct from rule->>'version' or report->>'suite_version' is distinct from 'alias-v1' or (report->>'knowledge_revision')::bigint is distinct from k or (b->>'knowledge_revision')::bigint is distinct from k or (b->>'source_review_revision')::bigint is distinct from s.review_revision or b->>'mode' is distinct from p_input->>'mode' or report->>'mode' is distinct from p_input->>'mode' or b->>'provider_identity' is distinct from p_input->>'provider_identity' or b->>'suite_hash' is distinct from p_input->>'suite_hash' then raise exception 'STALE_RULE_TEST';end if;
     if exists(select 1 from merchant_rules where doc->>'state'='active' and lower(regexp_replace(trim(doc->'payload'->>'observed_vendor'),'\s+',' ','g'))=lower(regexp_replace(trim(rule->'payload'->>'observed_vendor'),'\s+',' ','g')) and doc->'payload'->'scope'=rule->'payload'->'scope' and lower(regexp_replace(trim(doc->'payload'->>'canonical_vendor'),'\s+',' ','g'))<>lower(regexp_replace(trim(rule->'payload'->>'canonical_vendor'),'\s+',' ','g')))then raise exception 'RULE_CONFLICT';end if;
     rule:=rule||jsonb_build_object('state','active','version',(rule->>'version')::int+1);k:=k+1;
    else raise exception 'INVALID_INPUT';end if;
   end if;
  end if;
  update merchant_rules set doc=rule where id=rid;
 end if;
 update platform_state set knowledge_revision=k where id = true;insert into rule_history(rule_id,doc)values(rid,rule);
 return jsonb_build_object('rule',rule,'knowledge_revision',k);
end $function$

