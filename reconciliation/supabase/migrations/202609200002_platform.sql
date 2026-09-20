-- Additive migration. Never deletes or reseeds submissions, receipts, or audit history.
create table public.platform_state(id boolean primary key default true check(id),knowledge_revision bigint not null default 0);
insert into platform_state values(true,0);
alter table submissions add column review_revision bigint not null default 0, add column evidence_revision bigint not null default 0, add column decision_status text not null default 'pending' check(decision_status in ('pending','approved','rejected'));
alter table corrections add column review_revision bigint;
with ranked as (select id,row_number() over(partition by submission_id order by corrected_at,id) as revision from corrections) update corrections c set review_revision=ranked.revision from ranked where c.id=ranked.id;
update submissions s set review_revision=(select count(*) from decisions d where d.submission_id=s.id)+(select count(*) from corrections c where c.submission_id=s.id),decision_status=coalesce((select human_verdict from corrections c where c.submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1),'pending');
alter table receipts add column sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),add column extraction_provenance text;
-- Historical configuration never proves live extraction. Keep old evidence explicitly unknown.
update receipts set extraction_provenance=case when raw_extracted_text like 'SYNTHETIC%' or raw_extracted_text like 'SIMULATED%' then 'historical fixture' else 'historical / unknown' end;
alter table reconciliation_runs add column review_revision bigint,add column evidence_revision bigint not null default 0,add column knowledge_revision bigint not null default -1,add column evidence_snapshot jsonb,add column operation text not null default 'assessment' check(operation in ('assessment','extraction'));
create table public.merchant_rules(id uuid primary key,doc jsonb not null);
create table public.rule_history(id bigint generated always as identity primary key,rule_id uuid not null references merchant_rules(id),doc jsonb not null,created_at timestamptz not null default now());
create table public.rule_tests(id uuid primary key,rule_id uuid not null references merchant_rules(id),doc jsonb not null);
create table public.extraction_history(id bigint generated always as identity primary key,receipt_id uuid not null references receipts(id),doc jsonb not null,created_at timestamptz not null default now());
alter table platform_state enable row level security;
alter table merchant_rules enable row level security;
alter table rule_history enable row level security;
alter table rule_tests enable row level security;
alter table extraction_history enable row level security;
revoke all on platform_state,merchant_rules,rule_history,rule_tests,extraction_history from anon,authenticated;
grant all on platform_state,merchant_rules,rule_history,rule_tests,extraction_history to service_role;
grant usage on sequence rule_history_id_seq,extraction_history_id_seq to service_role;

-- ponytail: serialize the bounded synthetic ledger; per-receipt locks if throughput warrants it.
create function public.core_lock() returns void language sql security definer set search_path=public as $$ select id from platform_state where id for update $$;
create function public.core_evidence() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('active_aliases',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source_correction_id',doc->'source_correction_id','payload',doc->'payload') order by id) from merchant_rules where doc->>'state'='active'),'[]'),'check_configuration','mandatory-v1','receipts',coalesce((select jsonb_agg(r order by id) from receipts r),'[]'),'policies',coalesce((select jsonb_agg(p order by id) from policy_rules p),'[]'),'claims',coalesce((select jsonb_agg(jsonb_build_object('id',id,'attendee_name',attendee_name,'amount_requested_minor',amount_requested_minor,'currency',currency,'category',category,'submitted_at',submitted_at) order by id) from submissions),'[]'));
$$;
create function public.core_receipt_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform core_lock();
 if tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then raise exception 'RECEIPT_CONFLICT';end if;
  insert into extraction_history(receipt_id,doc) values(old.id,to_jsonb(old));
  if exists(select 1 from merchant_rules where doc->>'source_submission_id'=new.submission_id::text and doc->>'state'='active') then update platform_state set knowledge_revision=knowledge_revision+1;end if;
  with changed as (update merchant_rules set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source evidence changed.') where doc->>'source_submission_id'=new.submission_id::text and doc->>'state'<>'disabled' returning id,doc) insert into rule_history(rule_id,doc)select id,doc from changed;
  update submissions set evidence_revision=evidence_revision+1,review_revision=review_revision+1,updated_at=now() where id=new.submission_id;
 end if;
 return new;
end $$;
create trigger receipt_revision before insert or update on receipts for each row execute function core_receipt_changed();
create function public.core_policy_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform core_lock();update platform_state set knowledge_revision=knowledge_revision+1;
 return null;
end $$;
create trigger policy_revision after insert or update or delete on policy_rules for each statement execute function core_policy_changed();
create function public.core_same_purchase(a receipts,b receipts) returns boolean language sql immutable as $$
 select coalesce(a.sha256=b.sha256,false) or
 (a.extraction_status='succeeded' and b.extraction_status='succeeded'
 and nullif(lower(regexp_replace(trim(a.parsed_fields_json->>'receipt_number'),'\s+',' ','g')),'')=nullif(lower(regexp_replace(trim(b.parsed_fields_json->>'receipt_number'),'\s+',' ','g')),'')
 and nullif(lower(regexp_replace(trim(a.parsed_fields_json->>'vendor'),'\s+',' ','g')),'')=nullif(lower(regexp_replace(trim(b.parsed_fields_json->>'vendor'),'\s+',' ','g')),'')
 and a.parsed_fields_json->>'amount_minor'=b.parsed_fields_json->>'amount_minor'
 and a.parsed_fields_json->>'receipt_date'=b.parsed_fields_json->>'receipt_date'
 and a.parsed_fields_json->>'currency'=b.parsed_fields_json->>'currency');
$$;
create or replace function public.core_begin_run(p_submission uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s submissions;r uuid;
begin
 perform core_lock();select * into s from submissions where id=p_submission for update;if not found then raise exception 'NOT_FOUND';end if;
 update reconciliation_runs set status='failed',error='Run lease expired.',completed_at=now() where submission_id=s.id and status='running' and started_at<now()-interval '5 minutes';
 if exists(select 1 from reconciliation_runs where submission_id=s.id and status='running')then raise exception 'RUN_ACTIVE';end if;
 insert into reconciliation_runs(submission_id,review_revision,evidence_revision,knowledge_revision,evidence_snapshot) values(s.id,s.review_revision,s.evidence_revision,(select knowledge_revision from platform_state),core_evidence()) returning id into r;return r;
end $$;
create or replace function public.core_finish_run(p_run uuid,p_decisions jsonb,p_status text) returns void language plpgsql security definer set search_path=public as $$
declare r reconciliation_runs;s submissions;
begin
 perform core_lock();select * into r from reconciliation_runs where id=p_run;select * into s from submissions where id=r.submission_id for update;
 if r.id is null or r.status<>'running' or r.operation<>'assessment' or r.review_revision<>s.review_revision or r.evidence_revision<>s.evidence_revision or r.knowledge_revision<>(select knowledge_revision from platform_state) or r.evidence_snapshot is distinct from core_evidence() then raise exception 'STALE_RUN';end if;
 if p_status not in ('approved','flagged','needs_review') or jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions)=0 then raise exception 'INVALID_DECISIONS';end if;
 if not exists(select 1 from jsonb_array_elements(p_decisions)d where d->>'field_checked'='overall_status' and d->'answer_json'->>'value'=p_status) or exists(select 1 from jsonb_array_elements(p_decisions)d where (d->>'run_id')::uuid is distinct from p_run or (d->>'submission_id')::uuid is distinct from s.id or d->>'check_method'='human')then raise exception 'INVALID_DECISIONS';end if;
 insert into decisions select * from jsonb_populate_recordset(null::decisions,p_decisions);
 update reconciliation_runs set status='completed',completed_at=now() where id=p_run;
 update submissions set latest_run_id=p_run,status=case when decision_status='pending' then p_status else decision_status end,review_revision=review_revision+1,updated_at=now() where id=s.id;
end $$;
create or replace function public.core_fail_run(p_run uuid,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare r reconciliation_runs;
begin
 perform core_lock();select * into r from reconciliation_runs where id=p_run;
 update reconciliation_runs set status='failed',completed_at=now(),error=left(p_error,500) where id=p_run and status='running';
 if found then update submissions set status=case when decision_status='pending' then 'needs_review' else decision_status end,updated_at=now() where id=r.submission_id;end if;
end $$;
create or replace function public.core_correct(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare s submissions;r receipts;run reconciliation_runs;c uuid;rid uuid;f text;p jsonb;cap integer;n integer;v_revision bigint;has_active boolean;
begin
 perform core_lock();
 if p_input->>'correction_type'='vendor_alias' then raise exception 'LEGACY_ALIAS_DISABLED';end if;
 if p_input->>'correction_type' is distinct from 'decision_override' or p_input->>'human_verdict' is null or p_input->>'human_verdict' not in ('approved','rejected') or coalesce(length(trim(p_input->>'human_note')),0) not between 1 and 2000 or p_input->'correction_payload_json' is distinct from '{}'::jsonb or coalesce(p_input->>'expected_review_revision','')!~'^\d+$' then raise exception 'INVALID_INPUT';end if;
 select * into s from submissions where id=(p_input->>'submission_id')::uuid for update;if not found then raise exception 'NOT_FOUND';end if;
 if s.review_revision<>(p_input->>'expected_review_revision')::bigint then raise exception 'STALE_REVIEW';end if;
 if exists(select 1 from reconciliation_runs where submission_id=s.id and status='running') then raise exception 'RUN_ACTIVE';end if;
 if p_input->>'decision_id' is not null and not exists(select 1 from decisions where id=(p_input->>'decision_id')::uuid and submission_id=s.id and run_id=s.latest_run_id)then raise exception 'STALE_DECISION';end if;
 if p_input->>'human_verdict'='approved' then
  select * into r from receipts where submission_id=s.id;select * into run from reconciliation_runs where id=s.latest_run_id;
  if r.id is null or r.extraction_status<>'succeeded' or run.id is null or run.status<>'completed' or run.operation<>'assessment' or run.evidence_revision<>s.evidence_revision then raise exception 'APPROVAL_BLOCKED';end if;
  select knowledge_revision into v_revision from platform_state;if run.knowledge_revision<>v_revision then raise exception 'STALE_REVIEW';end if;
  foreach f in array array['currency','amount','policy','receipt_date','policy_cap','duplicate'] loop
   if not exists(select 1 from decisions where run_id=run.id and field_checked=f and check_method<>'human' and verdict='pass') or exists(select 1 from decisions where run_id=run.id and field_checked=f and check_method<>'human' and verdict<>'pass')then raise exception 'APPROVAL_BLOCKED';end if;
  end loop;
  p:=r.parsed_fields_json;
  if p->>'currency' is distinct from 'USD' or p->>'amount_minor' is distinct from s.amount_requested_minor::text or p->>'receipt_date' is null then raise exception 'APPROVAL_BLOCKED';end if;
  select count(*),min(max_amount_minor) into n,cap from policy_rules where category=s.category and currency=s.currency and region_or_route='*' and (p->>'receipt_date')::date between date_range_start and date_range_end;
  if n<>1 or s.amount_requested_minor>cap then raise exception 'APPROVAL_BLOCKED';end if;
  if exists(select 1 from submissions x join receipts y on y.submission_id=x.id where x.id<>s.id and core_same_purchase(r,y) and ((x.submitted_at,x.id)<(s.submitted_at,s.id) or x.decision_status='approved'))then raise exception 'APPROVAL_BLOCKED';end if;
 end if;
 select exists(select 1 from merchant_rules where doc->>'source_submission_id'=s.id::text and doc->>'state'='active') into has_active;
 update merchant_rules set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source approval changed.') where doc->>'source_submission_id'=s.id::text and doc->>'state'<>'disabled';
 insert into rule_history(rule_id,doc) select id,doc from merchant_rules where doc->>'source_submission_id'=s.id::text;
 if has_active then update platform_state set knowledge_revision=knowledge_revision+1;end if;
 insert into corrections(review_revision,submission_id,decision_id,human_verdict,human_note,correction_type,correction_payload_json)values(s.review_revision+1,s.id,(p_input->>'decision_id')::uuid,p_input->>'human_verdict',p_input->>'human_note','decision_override','{}')returning id into c;
 rid:=s.latest_run_id;if rid is null then insert into reconciliation_runs(submission_id,status,completed_at,evidence_revision)values(s.id,'completed',now(),s.evidence_revision)returning id into rid;end if;
 insert into decisions(run_id,submission_id,field_checked,check_method,question_type,answer_json,verdict,rationale_text,evidence_json,state_snapshot_json)values(rid,s.id,'overall_status','human','rule',jsonb_build_object('value',p_input->>'human_verdict'),case when p_input->>'human_verdict'='approved' then 'pass' else 'fail' end,p_input->>'human_note',jsonb_build_object('correction_id',c,'correction_type','decision_override','one_time_override',true),jsonb_build_object('submission',to_jsonb(s)));
 update submissions set status=p_input->>'human_verdict',decision_status=p_input->>'human_verdict',latest_run_id=rid,review_revision=review_revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('correction_id',c,'status',p_input->>'human_verdict');
end $$;
create function public.core_begin_extraction(p_submission uuid,p_revision bigint) returns uuid language plpgsql security definer set search_path=public as $$
declare s submissions;r uuid;
begin
 perform core_lock();select * into s from submissions where id=p_submission for update;if not found then raise exception 'NOT_FOUND';end if;
 if s.review_revision is distinct from p_revision then raise exception 'STALE_REVIEW';end if;
 if s.decision_status<>'pending' then raise exception 'RETRY_BLOCKED';end if;
 if not exists(select 1 from receipts where submission_id=s.id)then raise exception 'NOT_FOUND';end if;
 if s.submitted_at>now()-interval '5 minutes' and exists(select 1 from receipts where submission_id=s.id and extraction_status='pending')then raise exception 'RUN_ACTIVE';end if;
 r:=core_begin_run(s.id);update reconciliation_runs set operation='extraction' where id=r;return r;
end $$;
create function public.core_finish_extraction(p_run uuid,p_receipt jsonb) returns void language plpgsql security definer set search_path=public as $$
declare run reconciliation_runs;s submissions;r receipts;
begin
 perform core_lock();select * into run from reconciliation_runs where id=p_run;select * into s from submissions where id=run.submission_id;
 if run.id is null or run.status<>'running' or run.operation<>'extraction' or run.review_revision<>s.review_revision then raise exception 'STALE_REVIEW';end if;
 select * into r from receipts where submission_id=s.id;
 if r.id is distinct from (p_receipt->>'id')::uuid or r.storage_path is distinct from p_receipt->>'storage_path' or (r.sha256 is not null and r.sha256 is distinct from p_receipt->>'sha256')then raise exception 'RECEIPT_CONFLICT';end if;
 update receipts set sha256=p_receipt->>'sha256',parsed_fields_json=nullif(p_receipt->'parsed_fields_json','null'::jsonb),raw_extracted_text=p_receipt->>'raw_extracted_text',extraction_status=p_receipt->>'extraction_status',extraction_error=p_receipt->>'extraction_error',extracted_at=(p_receipt->>'extracted_at')::timestamptz,extraction_provenance=p_receipt->>'extraction_provenance' where id=r.id;
 update reconciliation_runs set status=case when p_receipt->>'extraction_status'='failed' then 'failed' else 'completed' end,error=p_receipt->>'extraction_error',completed_at=now() where id=p_run;
 update submissions set status='needs_review',updated_at=now() where id=s.id;
end $$;
create function public.core_receipt_hash(p_receipt uuid,p_hash text) returns void language plpgsql security definer set search_path=public as $$
declare r receipts;
begin
 perform core_lock();select * into r from receipts where id=p_receipt;if not found then raise exception 'NOT_FOUND';end if;
 if coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
 if r.sha256 is not null and r.sha256<>p_hash then raise exception 'RECEIPT_CONFLICT';end if;
 if r.sha256 is null then update receipts set sha256=p_hash where id=r.id;end if;
end $$;
create function public.core_rule(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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
 update platform_state set knowledge_revision=k;insert into rule_history(rule_id,doc)values(rid,rule);
 return jsonb_build_object('rule',rule,'knowledge_revision',k);
end $$;
create or replace function public.core_snapshot() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if (select count(*) from submissions)>1000 then raise exception 'REVIEW_LIMIT';end if;
 return jsonb_build_object('knowledge_revision',(select knowledge_revision from platform_state),
 'submissions',coalesce((select jsonb_agg(s order by submitted_at,id) from submissions s),'[]'),
 'receipts',coalesce((select jsonb_agg(r order by id) from receipts r),'[]'),
 'policies',coalesce((select jsonb_agg(p order by id) from policy_rules p),'[]'),
 'decisions',coalesce((select jsonb_agg(d order by created_at,id) from decisions d),'[]'),
 'corrections',coalesce((select jsonb_agg(c order by review_revision,corrected_at,id) from corrections c),'[]'),
 'runs',coalesce((select jsonb_agg(r order by started_at,id) from reconciliation_runs r),'[]'),
 'rules',coalesce((select jsonb_agg(doc order by id) from merchant_rules),'[]'));
end $$;
-- New functions default to PUBLIC execute in PostgreSQL; close every new entry point.
revoke all on function core_lock(),core_evidence(),core_receipt_changed(),core_policy_changed(),core_same_purchase(receipts,receipts),core_begin_extraction(uuid,bigint),core_finish_extraction(uuid,jsonb),core_receipt_hash(uuid,text),core_rule(jsonb) from public,anon,authenticated;
grant execute on function core_lock(),core_evidence(),core_same_purchase(receipts,receipts),core_begin_extraction(uuid,bigint),core_finish_extraction(uuid,jsonb),core_receipt_hash(uuid,text),core_rule(jsonb) to service_role;

-- Initial upload extraction cannot overwrite a newer retry or a completed extraction.
create function public.core_finish_initial_extraction(p_receipt jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r receipts;
begin
 perform core_lock();select * into r from receipts where id=(p_receipt->>'id')::uuid;
 if r.id is null or r.extraction_status<>'pending' or exists(select 1 from reconciliation_runs where submission_id=r.submission_id and status='running')then raise exception 'STALE_REVIEW';end if;
 if r.storage_path is distinct from p_receipt->>'storage_path' or (r.sha256 is not null and r.sha256 is distinct from p_receipt->>'sha256')then raise exception 'RECEIPT_CONFLICT';end if;
 update receipts set sha256=p_receipt->>'sha256',parsed_fields_json=nullif(p_receipt->'parsed_fields_json','null'::jsonb),raw_extracted_text=p_receipt->>'raw_extracted_text',extraction_status=p_receipt->>'extraction_status',extraction_error=p_receipt->>'extraction_error',extracted_at=(p_receipt->>'extracted_at')::timestamptz,extraction_provenance=p_receipt->>'extraction_provenance' where id=r.id;
end $$;
revoke all on function core_finish_initial_extraction(jsonb) from public,anon,authenticated;
grant execute on function core_finish_initial_extraction(jsonb) to service_role;
