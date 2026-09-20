-- Human feedback queues atomically; only the existing booking-reference rule can be proposed.
-- No records are reset, no provider calls run, and platform version remains 4.
do $$ begin if core_platform_version() <> 4 then raise exception 'Expected platform version 4'; end if; end $$;

create function public.core_feedback_current(p_correction uuid,p_job jsonb) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from corrections c join submissions s on s.id=c.submission_id where c.id=p_correction
   and c.id=(select id from corrections where submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1)
   and s.review_revision=(p_job->>'source_review_revision')::bigint
   and s.evidence_revision=(p_job->>'source_evidence_revision')::bigint
   and core_source_fingerprint(s.id)=p_job->>'source_fingerprint');
$$;
create function public.core_feedback_candidate(p_correction uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c corrections;s submissions;r receipts;checks jsonb;candidate jsonb;cap integer;n integer;
begin
 select * into c from corrections where id=p_correction;select * into s from submissions where id=c.submission_id;
 select * into r from receipts where submission_id=s.id;
 if c.human_verdict is distinct from 'approved' or s.decision_status is distinct from 'approved'
   or c.id is distinct from (select id from corrections where submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1)
   or r.extraction_status is distinct from 'succeeded'
   or not exists(select 1 from jsonb_array_elements_text(r.parsed_fields_json->'names')name where core_normalize(name)=core_normalize(s.attendee_name))
   or r.parsed_fields_json->>'currency' is distinct from 'USD' or r.parsed_fields_json->>'amount_minor' is distinct from s.amount_requested_minor::text
   or not exists(select 1 from reconciliation_runs where id=s.latest_run_id and status='completed' and evidence_revision=s.evidence_revision)
   then return null;end if;
 select count(*),min(max_amount_minor) into n,cap from policy_rules where category=s.category and currency=s.currency and region_or_route='*' and (r.parsed_fields_json->>'receipt_date')::date between date_range_start and date_range_end;
 if n<>1 or s.amount_requested_minor>cap then return null;end if;
 if exists(select 1 from submissions x join receipts y on y.submission_id=x.id where x.id<>s.id and core_same_purchase(r,y) and ((x.submitted_at,x.id)<(s.submitted_at,s.id) or x.decision_status='approved'))then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]')into checks from decisions d where run_id=s.latest_run_id and check_method<>'human' and field_checked<>'overall_status';
 if exists(select 1 from jsonb_array_elements(checks)d where d->>'verdict'='fail')
   or exists(select 1 from unnest(array['currency','amount','policy','receipt_date','policy_cap','duplicate','name'])f where not exists(select 1 from jsonb_array_elements(checks)d where d->>'field_checked'=f and d->>'verdict'='pass'))then return null;end if;
 candidate:=core_booking_candidate(s.id);
 if core_normalize(candidate->'trigger_scope'->>'observed_vendor')=core_normalize(candidate->'trigger_scope'->>'canonical_vendor')then return null;end if;
 return candidate;
end $$;

create function public.core_feedback_learning(p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action';c corrections;j jsonb;candidate jsonb;p jsonb;rid uuid;sid uuid;revision bigint;k bigint;
begin
 perform core_lock();
 if action='expire' then
  for c in select * from corrections where correction_payload_json->'feedback_learning'->>'status' in ('queued','checking','testing','active') loop
   j:=c.correction_payload_json->'feedback_learning';
   if (j->>'status' in ('queued','checking','testing') and ((j->>'lease_expires_at')::timestamptz<=now() or not core_feedback_current(c.id,j)))
     or (j->>'status'='active' and (not core_feedback_current(c.id,j||jsonb_build_object('source_review_revision',(select review_revision from submissions where id=c.submission_id))) or not exists(select 1 from resolution_procedures p where p.id=(j->>'procedure_id')::uuid and p.doc->>'state'='active'
       and p.doc->>'source_fingerprint'=core_source_fingerprint((p.doc->>'source_claim_id')::uuid)
       and p.doc->>'source_correction_id'=(select x.id::text from corrections x where x.submission_id=(p.doc->>'source_claim_id')::uuid order by review_revision desc,corrected_at desc,id desc limit 1))))then
    j:=j||jsonb_build_object('status','failed','summary','Learning was interrupted or its source changed. Review the saved evidence before retrying.','updated_at',now());
    update corrections set correction_payload_json=jsonb_set(correction_payload_json,'{feedback_learning}',j)where id=c.id;
   end if;
  end loop;
  return jsonb_build_object('job',null);
 end if;
 select * into c from corrections where id=(p_input->>'correction_id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
 select review_revision into revision from submissions where id=c.submission_id;
 j:=c.correction_payload_json->'feedback_learning';
 if action='enqueue' then
  if j is not null then return jsonb_build_object('job',j);end if;
  if c.id is distinct from (select id from corrections where submission_id=c.submission_id order by review_revision desc,corrected_at desc,id desc limit 1)then raise exception 'STALE_FEEDBACK';end if;
  j:=jsonb_build_object('status','queued','summary','Review reason saved. Checking for a reusable evidence rule.','updated_at',now(),'source_review_revision',revision,
    'source_evidence_revision',(select evidence_revision from submissions where id=c.submission_id),'source_fingerprint',core_source_fingerprint(c.submission_id),'lease_expires_at',now()+interval '15 minutes');
 elsif action='retry' then
  if j->>'status' is distinct from 'failed' or revision is distinct from (p_input->>'expected_review_revision')::bigint or not core_feedback_current(c.id,j||jsonb_build_object('source_review_revision',revision))then raise exception 'STALE_FEEDBACK';end if;
  j:=(j-array['lease','procedure_id','mode'])||jsonb_build_object('status','queued','summary','Review reason queued for another learning attempt.','source_review_revision',revision,'updated_at',now(),'lease_expires_at',now()+interval '15 minutes');
 elsif action='start' then
  if j is null then raise exception 'NOT_FOUND';end if;
  if j->>'status'<>'queued' then return jsonb_build_object('job',j,'acquired',false);end if;
  if not core_feedback_current(c.id,j) or (j->>'lease_expires_at')::timestamptz<=now()then
   j:=j||jsonb_build_object('status','failed','summary','Learning was interrupted or its source changed. Review the saved evidence before retrying.','updated_at',now());
  else
   j:=j||jsonb_build_object('status','checking','summary','Checking whether the review reason supports a narrow evidence rule.','lease',gen_random_uuid(),'lease_expires_at',now()+interval '15 minutes','updated_at',now());
  end if;
 elsif action in ('propose','finish') then
  if j is null or j->>'lease' is distinct from p_input->>'lease' or j->>'status' not in ('checking','testing')
    or (j->>'lease_expires_at')::timestamptz<=now() or not core_feedback_current(c.id,j)then raise exception 'STALE_FEEDBACK';end if;
  if action='propose' then
   if j->>'status'<>'checking' or j->>'procedure_id' is not null then raise exception 'STALE_FEEDBACK';end if;
   if p_input->>'mode' is null or p_input->>'mode' not in ('live','simulated')then raise exception 'INVALID_INPUT';end if;
   candidate:=core_feedback_candidate(c.id);if candidate is null then raise exception 'PROCEDURE_SOURCE_REQUIRED';end if;
   select doc into p from resolution_procedures where doc->>'state'='active' and doc->'latest_test'->>'passed'='true' and doc->'latest_test'->>'mode'=p_input->>'mode'
     and doc->'trigger_scope'=candidate->'trigger_scope' and doc->>'source_fingerprint'=core_source_fingerprint((doc->>'source_claim_id')::uuid)
     and exists(select 1 from corrections x where x.id=(doc->>'source_correction_id')::uuid and x.human_verdict='approved' and x.id=(select y.id from corrections y where y.submission_id=x.submission_id order by review_revision desc,corrected_at desc,id desc limit 1)) limit 1;
   if p is not null then
    j:=j||jsonb_build_object('status','active','summary','An existing tested booking-reference check already covers this evidence. No duplicate rule was created.','procedure_id',p->>'id','mode',p_input->>'mode');
   else
    rid:=gen_random_uuid();p:=candidate||jsonb_build_object('id',rid,'version',1,'state','draft','source_kind','review_feedback','source_claim_id',c.submission_id,
      'source_run_id',(select latest_run_id from submissions where id=c.submission_id),'source_correction_id',c.id,'source_evidence_revision',j->'source_evidence_revision',
      'source_fingerprint',j->>'source_fingerprint','feedback_lease',p_input->>'lease','created_at',now(),'latest_test',null,'latest_test_error',null);
    insert into resolution_procedures values(rid,p);insert into procedure_history(procedure_id,doc)values(rid,p);
    j:=j||jsonb_build_object('status','testing','summary',case when p_input->>'mode'='simulated' then 'Simulated' else 'Live' end||' safety test running on twelve cases.','procedure_id',rid,'mode',p_input->>'mode');
   end if;
  else
   if p_input->>'status' is null or p_input->>'status' not in ('active','not_applicable','needs_confirmation','failed')or coalesce(length(trim(p_input->>'summary')),0)not between 1 and 500 then raise exception 'INVALID_INPUT';end if;
   if p_input->>'status'='active' and not exists(select 1 from resolution_procedures where id=(j->>'procedure_id')::uuid and doc->>'state'='active' and doc->>'source_correction_id'=c.id::text)then raise exception 'STALE_FEEDBACK';end if;
   j:=j||jsonb_build_object('status',p_input->>'status','summary',p_input->>'summary');
  end if;
  j:=j||jsonb_build_object('updated_at',now());
 else raise exception 'INVALID_INPUT';end if;
 update corrections set correction_payload_json=jsonb_set(correction_payload_json,'{feedback_learning}',j)where id=c.id;
 return jsonb_build_object('job',j,'acquired',action='start' and j->>'status'='checking');
end $$;

-- Both ordinary review and decision-and-send already use this shared correction function.
alter function public.core_correct_message(jsonb,uuid) rename to core_correct_message_pre_feedback;
create function public.core_correct_message(p_input jsonb,p_keep uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=core_correct_message_pre_feedback(p_input,p_keep);
 perform core_feedback_learning(jsonb_build_object('action','enqueue','correction_id',result->>'correction_id'));
 return result;
end $$;
-- Rebind the SQL wrapper, whose parsed body can retain the renamed function OID.
create or replace function public.core_correct(p_input jsonb) returns jsonb language sql security definer set search_path=public as $$select core_correct_message(p_input,null)$$;

-- Preserve the existing lifecycle and bind singleton writes for Supabase safeupdate.
create or replace function core_invalidate_procedures(p_claim uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform core_lock();
 if exists(select 1 from resolution_procedures where doc->>'source_claim_id'=p_claim::text and doc->>'state'='active')then update platform_state set knowledge_revision=knowledge_revision+1 where id=true;end if;
 with changed as(update resolution_procedures set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source evidence or approval changed.') where doc->>'source_claim_id'=p_claim::text and doc->>'state'<>'disabled' returning id,doc)insert into procedure_history(procedure_id,doc)select id,doc from changed;
end $$;

-- Preserve the existing lifecycle and bind singleton writes for Supabase safeupdate.
create or replace function core_procedure_source_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='corrections' then perform core_invalidate_procedures(new.submission_id);
 elsif tg_table_name='receipts' then if to_jsonb(new) is distinct from to_jsonb(old) then perform core_invalidate_procedures(new.submission_id);end if;
 else
  perform core_lock();perform core_invalidate_procedures(new.claim_id);
  if exists(select 1 from merchant_rules where doc->>'source_submission_id'=new.claim_id::text and doc->>'state'='active')then update platform_state set knowledge_revision=knowledge_revision+1 where id=true;end if;
  with changed as(update merchant_rules set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source supporting evidence changed.')where doc->>'source_submission_id'=new.claim_id::text and doc->>'state'<>'disabled' returning id,doc)insert into rule_history(rule_id,doc)select id,doc from changed;
  if tg_op='UPDATE' and (new.id,new.claim_id,new.sha256,new.storage_path,new.file_type,new.kind,new.created_at) is distinct from (old.id,old.claim_id,old.sha256,old.storage_path,old.file_type,old.kind,old.created_at)then raise exception 'DOCUMENT_CONFLICT';end if;
  update submissions set evidence_revision=evidence_revision+1,review_revision=review_revision+1,updated_at=now() where id=new.claim_id;
 end if;return new;
end $$;

-- Preserve the existing lifecycle and bind singleton writes for Supabase safeupdate.
create or replace function public.core_procedure(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action';rule jsonb;rid uuid;s submissions;c corrections;r receipts;k bigint;b jsonb;t jsonb;attempt uuid;fresh boolean;report jsonb;source_run reconciliation_runs;candidate jsonb;j jsonb;
begin
 perform core_lock();select knowledge_revision into k from platform_state;
 if action='propose' then
  select * into source_run from reconciliation_runs where id=(p_input->>'run_id')::uuid;
  if source_run.investigation is null then raise exception 'NOT_FOUND';end if;
  select * into s from submissions where id=source_run.submission_id;
  if s.review_revision is distinct from (p_input->>'expected_review_revision')::bigint then raise exception 'STALE_REVIEW';end if;
  select * into c from corrections where submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1;
  candidate:=core_booking_candidate(s.id);
  if c.human_verdict is distinct from 'approved' or coalesce(length(trim(c.human_note)),0)=0 or source_run.status<>'completed' or source_run.evidence_revision<>s.evidence_revision or candidate is null or candidate is distinct from source_run.investigation->'proposed_learning' or exists(select 1 from jsonb_array_elements(candidate->'source_evidence_refs')ref where not exists(select 1 from investigation_steps st cross join jsonb_array_elements(st.doc->'evidence_refs')observed where st.run_id=source_run.id and st.doc->>'status'='completed' and observed=ref))then raise exception 'PROCEDURE_SOURCE_REQUIRED';end if;
  rid:=gen_random_uuid();rule:=candidate||jsonb_build_object('id',rid,'version',1,'state','draft','source_claim_id',s.id,'source_run_id',source_run.id,'source_correction_id',c.id,'source_evidence_revision',s.evidence_revision,'source_fingerprint',core_source_fingerprint(s.id),'created_at',now(),'latest_test',null,'latest_test_error',null);
  insert into resolution_procedures values(rid,rule);
 else
  rid:=(p_input->>'id')::uuid;select doc into rule from resolution_procedures where id=rid;if not found then raise exception 'NOT_FOUND';end if;
  select * into s from submissions where id=(rule->>'source_claim_id')::uuid;select * into c from corrections where submission_id=s.id order by review_revision desc,corrected_at desc,id desc limit 1;
  if action='tested' then
   attempt:=(p_input->>'attempt_id')::uuid;select doc into t from procedure_tests where id=attempt and procedure_id=rid;if not found then raise exception 'STALE_RULE_TEST';end if;b:=t->'binding';b:=b||jsonb_build_object('observed_models',coalesce((select jsonb_agg(model order by model)from(select distinct (call->>'provider')||':'||(call->>'model')as model from jsonb_array_elements(p_input->'observations')obs cross join jsonb_array_elements(obs->'model_calls')call)x),'[]'));t:=t||jsonb_build_object('binding',b);report:=nullif(p_input->'report','null'::jsonb);
   j:=c.correction_payload_json->'feedback_learning';
   fresh:=rule->>'state'='draft' and rule->>'version'=t->>'procedure_version' and rule->>'latest_attempt_id'=attempt::text and (b->>'knowledge_revision')::bigint=k and (b->>'source_review_revision')::bigint=s.review_revision and b->>'source_correction_id'=c.id::text and (rule->>'source_evidence_revision')::bigint=s.evidence_revision and rule->>'source_fingerprint'=core_source_fingerprint(s.id) and (coalesce(rule->>'source_kind','investigation')<>'review_feedback' or (j->>'status'='testing' and j->>'lease'=rule->>'feedback_lease' and (j->>'lease_expires_at')::timestamptz>now() and core_feedback_current(c.id,j)));
   t:=t||jsonb_build_object('observations',p_input->'observations','report',coalesce(report,t->'report'),'status',case when p_input->>'error' is null and fresh then 'completed' else 'failed' end,'error',case when not fresh then 'STALE_RULE_TEST' else p_input->>'error' end);
   update procedure_tests set doc=t where id=attempt;
   if fresh then rule:=rule||jsonb_build_object('latest_test',case when p_input->>'error' is null then report else null end,'test_binding',case when p_input->>'error' is null then b else null end,'latest_test_error',p_input->>'error');end if;
  else
   if (rule->>'version')::int is distinct from (p_input->>'expected_procedure_version')::int then raise exception 'STALE_RULE';end if;
   if action='disable' then
    if rule->>'state'='disabled' then raise exception 'STALE_RULE';end if;
    if rule->>'state'='active' then k:=k+1;end if;
    rule:=rule||jsonb_build_object('state','disabled','version',(rule->>'version')::int+1,'latest_test',null,'test_binding',null);
   else
    if c.id::text is distinct from rule->>'source_correction_id' or c.human_verdict is distinct from 'approved' or rule->>'state'<>'draft' or (rule->>'source_evidence_revision')::bigint is distinct from s.evidence_revision or rule->>'source_fingerprint' is distinct from core_source_fingerprint(s.id) then raise exception 'STALE_RULE';end if;
    if rule->>'source_kind'='review_feedback' then
     j:=c.correction_payload_json->'feedback_learning';
     if j is null or j->>'status' is distinct from 'testing' or j->>'lease' is distinct from rule->>'feedback_lease' or (j->>'lease_expires_at')::timestamptz<=now() or not core_feedback_current(c.id,j)then raise exception 'STALE_FEEDBACK';end if;
    end if;
    if action='test' then
     if p_input->>'mode' is null or p_input->>'mode' not in ('live','simulated') or coalesce(length(p_input->>'provider_identity'),0)=0 or coalesce(p_input->>'suite_hash','')!~'^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
     b:=jsonb_build_object('source_correction_id',c.id,'source_review_revision',s.review_revision,'source_evidence_revision',s.evidence_revision,'source_fingerprint',core_source_fingerprint(s.id),'knowledge_revision',k,'suite_hash',p_input->>'suite_hash','provider_identity',p_input->>'provider_identity','mode',p_input->>'mode');attempt:=gen_random_uuid();
     t:=jsonb_build_object('id',attempt,'procedure_id',rid,'procedure_version',rule->'version','binding',b,'status','running','report',null,'error',null,'observations','[]'::jsonb);
     insert into procedure_tests values(attempt,rid,t);rule:=rule||jsonb_build_object('latest_attempt_id',attempt,'latest_test',null,'test_binding',null,'latest_test_error',null);
    elsif action='activate' then
     b:=rule->'test_binding';report:=rule->'latest_test';
     if report->>'passed' is distinct from 'true' or report->>'procedure_id' is distinct from rid::text or report->>'procedure_version' is distinct from rule->>'version' or report->>'suite_version' is distinct from 'booking-reference-v1' or (report->>'knowledge_revision')::bigint is distinct from k or (b->>'knowledge_revision')::bigint is distinct from k or (b->>'source_review_revision')::bigint is distinct from s.review_revision or b->>'mode' is distinct from p_input->>'mode' or report->>'mode' is distinct from p_input->>'mode' or b->>'provider_identity' is distinct from p_input->>'provider_identity' or b->>'suite_hash' is distinct from p_input->>'suite_hash' then raise exception 'STALE_RULE_TEST';end if;
     if exists(select 1 from resolution_procedures where doc->>'state'='active' and core_normalize(doc->'trigger_scope'->>'observed_vendor')=core_normalize(rule->'trigger_scope'->>'observed_vendor') and core_normalize(doc->'trigger_scope'->>'canonical_vendor')<>core_normalize(rule->'trigger_scope'->>'canonical_vendor'))then raise exception 'RULE_CONFLICT';end if;
     rule:=rule||jsonb_build_object('state','active','version',(rule->>'version')::int+1);k:=k+1;
     if rule->>'source_kind'='review_feedback' then
      j:=j||jsonb_build_object('status','active','summary',case when b->>'mode'='simulated' then 'Simulated' else 'Live' end||' twelve-case safety test passed. The booking-reference check is active; later claims still need their own evidence.','updated_at',now());
      update corrections set correction_payload_json=jsonb_set(correction_payload_json,'{feedback_learning}',j)where id=c.id;
     end if;
    else raise exception 'INVALID_INPUT';end if;
   end if;
  end if;
  update resolution_procedures set doc=rule where id=rid;
 end if;
 update platform_state set knowledge_revision=k where id=true;insert into procedure_history(procedure_id,doc)values(rid,rule);
 return jsonb_build_object('procedure',rule,'knowledge_revision',k);
end $$;

create or replace function public.core_correct_v3(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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
  if r.id is null or r.extraction_status<>'succeeded' or run.id is null or run.status<>'completed' or run.operation not in ('assessment','investigation') or run.evidence_revision<>s.evidence_revision then raise exception 'APPROVAL_BLOCKED';end if;
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
 if has_active then update platform_state set knowledge_revision=knowledge_revision+1 where id=true;end if;
 insert into corrections(review_revision,submission_id,decision_id,human_verdict,human_note,correction_type,correction_payload_json)values(s.review_revision+1,s.id,(p_input->>'decision_id')::uuid,p_input->>'human_verdict',p_input->>'human_note','decision_override','{}')returning id into c;
 rid:=s.latest_run_id;if rid is null then insert into reconciliation_runs(submission_id,status,completed_at,evidence_revision)values(s.id,'completed',now(),s.evidence_revision)returning id into rid;end if;
 insert into decisions(run_id,submission_id,field_checked,check_method,question_type,answer_json,verdict,rationale_text,evidence_json,state_snapshot_json)values(rid,s.id,'overall_status','human','rule',jsonb_build_object('value',p_input->>'human_verdict'),case when p_input->>'human_verdict'='approved' then 'pass' else 'fail' end,p_input->>'human_note',jsonb_build_object('correction_id',c,'correction_type','decision_override','one_time_override',true),jsonb_build_object('submission',to_jsonb(s)));
 update submissions set status=p_input->>'human_verdict',decision_status=p_input->>'human_verdict',latest_run_id=rid,review_revision=review_revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('correction_id',c,'status',p_input->>'human_verdict');
end $$;

revoke all on function core_feedback_current(uuid,jsonb),core_feedback_candidate(uuid),core_feedback_learning(jsonb),core_correct_message_pre_feedback(jsonb,uuid),core_correct_message(jsonb,uuid),core_correct_v3(jsonb),core_invalidate_procedures(uuid),core_procedure_source_changed() from public,anon,authenticated,service_role;
revoke all on function core_procedure(jsonb),core_correct(jsonb) from public,anon,authenticated;
grant execute on function core_feedback_learning(jsonb),core_procedure(jsonb),core_correct(jsonb) to service_role;
