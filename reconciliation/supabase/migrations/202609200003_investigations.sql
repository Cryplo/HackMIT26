-- Forward-only P0 evidence/investigation/procedure migration; preserves existing data.
-- Apply once, after inspecting that 202609200002 is fully present. No seeds or resets.
alter table policy_rules add column claimant_identity_evidence text not null default 'receipt_only' check(claimant_identity_evidence in ('receipt_only','receipt_or_linked_itinerary'));
alter table reconciliation_runs drop constraint reconciliation_runs_operation_check;
alter table reconciliation_runs add constraint reconciliation_runs_operation_check check(operation in ('assessment','extraction','supporting_document','investigation'));
alter table reconciliation_runs drop constraint reconciliation_runs_status_check;
alter table reconciliation_runs add constraint reconciliation_runs_status_check check(status in ('running','completed','failed','superseded'));
alter table reconciliation_runs add column investigation jsonb;
create table supporting_documents(
 id uuid primary key,claim_id uuid not null references submissions(id),kind text not null check(kind in ('booking_confirmation','itemized_document','itinerary','payment_confirmation','other')),
 storage_path text not null unique,file_type text not null check(file_type in ('application/pdf','image/png','image/jpeg')),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),created_at timestamptz not null,
 extraction_status text not null check(extraction_status in ('pending','succeeded','failed')),extraction_error text,extraction_provenance text,extracted_text text check(length(extracted_text)<=50000),facts jsonb,
 unique(claim_id,sha256),check(storage_path='synthetic/'||claim_id::text||'/supporting/'||id::text),check(facts is null or jsonb_typeof(facts)='object')
);
create table investigation_steps(id uuid primary key,run_id uuid not null references reconciliation_runs(id),sequence integer not null check(sequence between 1 and 6),doc jsonb not null,unique(run_id,sequence));
create table resolution_procedures(id uuid primary key,doc jsonb not null);
create table procedure_history(id bigint generated always as identity primary key,procedure_id uuid not null references resolution_procedures(id),doc jsonb not null,created_at timestamptz not null default now());
create table procedure_tests(id uuid primary key,procedure_id uuid not null references resolution_procedures(id),doc jsonb not null);
alter table supporting_documents enable row level security;
alter table investigation_steps enable row level security;
alter table resolution_procedures enable row level security;
alter table procedure_history enable row level security;
alter table procedure_tests enable row level security;
revoke all on supporting_documents,investigation_steps,resolution_procedures,procedure_history,procedure_tests from public,anon,authenticated;
grant all on supporting_documents,investigation_steps,resolution_procedures,procedure_history,procedure_tests to service_role;
grant usage on sequence procedure_history_id_seq to service_role;

create function core_invalidate_procedures(p_claim uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform core_lock();
 if exists(select 1 from resolution_procedures where doc->>'source_claim_id'=p_claim::text and doc->>'state'='active')then update platform_state set knowledge_revision=knowledge_revision+1;end if;
 with changed as(update resolution_procedures set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source evidence or approval changed.') where doc->>'source_claim_id'=p_claim::text and doc->>'state'<>'disabled' returning id,doc)insert into procedure_history(procedure_id,doc)select id,doc from changed;
end $$;
create function core_procedure_source_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='corrections' then perform core_invalidate_procedures(new.submission_id);
 elsif tg_table_name='receipts' then if to_jsonb(new) is distinct from to_jsonb(old) then perform core_invalidate_procedures(new.submission_id);end if;
 else
  perform core_lock();perform core_invalidate_procedures(new.claim_id);
  if exists(select 1 from merchant_rules where doc->>'source_submission_id'=new.claim_id::text and doc->>'state'='active')then update platform_state set knowledge_revision=knowledge_revision+1;end if;
  with changed as(update merchant_rules set doc=doc||jsonb_build_object('state','disabled','version',(doc->>'version')::int+1,'latest_test',null,'test_binding',null,'latest_test_error','Source supporting evidence changed.')where doc->>'source_submission_id'=new.claim_id::text and doc->>'state'<>'disabled' returning id,doc)insert into rule_history(rule_id,doc)select id,doc from changed;
  if tg_op='UPDATE' and (new.id,new.claim_id,new.sha256,new.storage_path,new.file_type,new.kind,new.created_at) is distinct from (old.id,old.claim_id,old.sha256,old.storage_path,old.file_type,old.kind,old.created_at)then raise exception 'DOCUMENT_CONFLICT';end if;
  update submissions set evidence_revision=evidence_revision+1,review_revision=review_revision+1,updated_at=now() where id=new.claim_id;
 end if;return new;
end $$;
create trigger procedure_receipt_source after update on receipts for each row execute function core_procedure_source_changed();
create trigger procedure_approval_source after insert on corrections for each row execute function core_procedure_source_changed();
create trigger supporting_revision before insert or update on supporting_documents for each row execute function core_procedure_source_changed();

-- Extend the existing authoritative evidence binding rather than invent a second lease.
alter function core_evidence() rename to core_evidence_v2;
create function core_evidence() returns jsonb language sql stable security definer set search_path=public as $$
 select core_evidence_v2()||jsonb_build_object('supporting_documents',coalesce((select jsonb_agg(d order by id)from supporting_documents d),'[]'),'active_procedures',coalesce((select jsonb_agg(doc order by id)from resolution_procedures where doc->>'state'='active'),'[]'));
$$;
create function core_investigation_doc(p_run uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select investigation||jsonb_build_object('steps',coalesce((select jsonb_agg(doc order by sequence)from investigation_steps where run_id=p_run),'[]')) from reconciliation_runs where id=p_run and investigation is not null;
$$;
alter function core_snapshot() rename to core_snapshot_v2;
create function core_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select core_snapshot_v2()||jsonb_build_object('supporting_documents',coalesce((select jsonb_agg(d order by id)from supporting_documents d),'[]'),'procedures',coalesce((select jsonb_agg(doc order by id)from resolution_procedures),'[]'),'investigations',coalesce((select jsonb_agg(core_investigation_doc(id) order by started_at,id)from reconciliation_runs where investigation is not null),'[]'));
$$;
create function core_source_fingerprint(p_claim uuid) returns text language sql stable security definer set search_path=public as $$
 select md5(jsonb_build_object('receipt',(select to_jsonb(r)from receipts r where submission_id=p_claim),'documents',coalesce((select jsonb_agg(d order by id)from supporting_documents d where claim_id=p_claim),'[]'))::text);
$$;
create function core_assessment(p_claim uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s submissions;r reconciliation_runs;checks jsonb;assessment text;
begin
 select * into s from submissions where id=p_claim;
 select * into r from reconciliation_runs rr where rr.submission_id=s.id and rr.status='completed' and rr.evidence_revision=s.evidence_revision and exists(select 1 from decisions where run_id=rr.id and check_method<>'human')order by (rr.id=s.latest_run_id)desc,coalesce(rr.completed_at,rr.started_at)desc,rr.id desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'field_checked',field_checked,'check_method',check_method,'verdict',verdict,'answer_json',answer_json,'probability',probability,'confidence_score',confidence_score,'rationale_text',rationale_text,'evidence_json',evidence_json-'provider_response')order by created_at,id),'[]')into checks from decisions where run_id=r.id and check_method<>'human' and field_checked<>'overall_status';
 if jsonb_array_length(checks)>0 then
 if exists(select 1 from jsonb_array_elements(checks)c where c->>'verdict'='fail')then assessment:='flagged';
 elsif exists(select 1 from jsonb_array_elements(checks)c where c->>'verdict'='unknown')or exists(select 1 from unnest(array['currency','amount','policy','receipt_date','policy_cap','merchant','name','duplicate'])f where not exists(select 1 from jsonb_array_elements(checks)c where c->>'field_checked'=f and c->>'verdict'='pass'))then assessment:='needs_review';else assessment:='matched';end if;end if;
 return jsonb_build_object('assessment_status',assessment,'checks',checks,'review_revision',s.review_revision,'evidence_revision',s.evidence_revision,'knowledge_revision',(select knowledge_revision from platform_state));
end $$;
create function core_supporting(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare s submissions;r reconciliation_runs;d supporting_documents;n supporting_documents;lease uuid;action text:=p_input->>'action';
begin
 perform core_lock();n:=jsonb_populate_record(null::supporting_documents,p_input->'document');
 if action='start' then
  select * into s from submissions where id=(p_input->>'claim_id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
  if s.review_revision is distinct from (p_input->>'expected_review_revision')::bigint then raise exception 'STALE_REVIEW';end if;
  if s.decision_status<>'pending' then raise exception 'EVIDENCE_LOCKED';end if;
  if (select count(*)from supporting_documents where claim_id=s.id)>=8 then raise exception 'DOCUMENT_LIMIT';end if;
  if exists(select 1 from supporting_documents where claim_id=s.id and sha256=n.sha256)then raise exception 'DOCUMENT_EXISTS';end if;
  if n.claim_id is distinct from s.id or n.extraction_status is distinct from 'pending' or n.facts is not null or n.extracted_text is not null then raise exception 'INVALID_INPUT';end if;
  lease:=core_begin_run(s.id);insert into supporting_documents select n.*;
  select * into s from submissions where id=s.id;
  update reconciliation_runs set operation='supporting_document',review_revision=s.review_revision,evidence_revision=s.evidence_revision,knowledge_revision=(select knowledge_revision from platform_state),evidence_snapshot=core_evidence()where id=lease;
 else
  lease:=(p_input->>'lease')::uuid;select * into r from reconciliation_runs where id=lease;select * into s from submissions where id=r.submission_id;select * into d from supporting_documents where id=n.id;
  if action<>'finish' or r.id is null or r.status<>'running' or r.operation<>'supporting_document' or d.claim_id is distinct from s.id or r.review_revision<>s.review_revision or r.evidence_revision<>s.evidence_revision or r.knowledge_revision<>(select knowledge_revision from platform_state)or r.evidence_snapshot is distinct from core_evidence()then raise exception 'STALE_RUN';end if;
  if (d.id,d.claim_id,d.sha256,d.storage_path,d.file_type,d.kind,d.created_at)is distinct from(n.id,n.claim_id,n.sha256,n.storage_path,n.file_type,n.kind,n.created_at)then raise exception 'DOCUMENT_CONFLICT';end if;
  if n.extraction_status not in('succeeded','failed')then raise exception 'INVALID_INPUT';end if;
  update supporting_documents set extraction_status=n.extraction_status,extraction_error=n.extraction_error,extraction_provenance=n.extraction_provenance,extracted_text=n.extracted_text,facts=n.facts where id=d.id;
  update reconciliation_runs set status=case when n.extraction_status='failed' then 'failed' else 'completed' end,error=n.extraction_error,completed_at=now()where id=lease;
 end if;
 return jsonb_build_object('document',(select to_jsonb(x)from supporting_documents x where id=n.id),'lease',lease);
end $$;

create or replace function public.core_begin_run(p_submission uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s submissions;r uuid;
begin
 perform core_lock();select * into s from submissions where id=p_submission for update;if not found then raise exception 'NOT_FOUND';end if;
 perform core_fail_run(id,'Run lease expired.') from reconciliation_runs where submission_id=s.id and status='running' and started_at<now()-interval '5 minutes';
 if exists(select 1 from reconciliation_runs where submission_id=s.id and status='running')then raise exception 'RUN_ACTIVE';end if;
 insert into reconciliation_runs(submission_id,review_revision,evidence_revision,knowledge_revision,evidence_snapshot) values(s.id,s.review_revision,s.evidence_revision,(select knowledge_revision from platform_state),core_evidence()) returning id into r;return r;
end $$;

create or replace function public.core_finish_run(p_run uuid,p_decisions jsonb,p_status text) returns void language plpgsql security definer set search_path=public as $$
declare r reconciliation_runs;s submissions;
begin
 perform core_lock();select * into r from reconciliation_runs where id=p_run;select * into s from submissions where id=r.submission_id for update;
 if r.id is null or r.status<>'running' or r.operation not in ('assessment','investigation') or r.review_revision<>s.review_revision or r.evidence_revision<>s.evidence_revision or r.knowledge_revision<>(select knowledge_revision from platform_state) or r.evidence_snapshot is distinct from core_evidence() then raise exception 'STALE_RUN';end if;
 if p_status not in ('approved','flagged','needs_review') or jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions)=0 then raise exception 'INVALID_DECISIONS';end if;
 if not exists(select 1 from jsonb_array_elements(p_decisions)d where d->>'field_checked'='overall_status' and d->'answer_json'->>'value'=p_status) or exists(select 1 from jsonb_array_elements(p_decisions)d where (d->>'run_id')::uuid is distinct from p_run or (d->>'submission_id')::uuid is distinct from s.id or d->>'check_method'='human')then raise exception 'INVALID_DECISIONS';end if;
 insert into decisions select * from jsonb_populate_recordset(null::decisions,p_decisions);
 update reconciliation_runs set status='completed',completed_at=now() where id=p_run;
 update submissions set latest_run_id=p_run,status=case when decision_status='pending' then p_status else decision_status end,review_revision=review_revision+1,updated_at=now() where id=s.id;
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
 if has_active then update platform_state set knowledge_revision=knowledge_revision+1;end if;
 insert into corrections(review_revision,submission_id,decision_id,human_verdict,human_note,correction_type,correction_payload_json)values(s.review_revision+1,s.id,(p_input->>'decision_id')::uuid,p_input->>'human_verdict',p_input->>'human_note','decision_override','{}')returning id into c;
 rid:=s.latest_run_id;if rid is null then insert into reconciliation_runs(submission_id,status,completed_at,evidence_revision)values(s.id,'completed',now(),s.evidence_revision)returning id into rid;end if;
 insert into decisions(run_id,submission_id,field_checked,check_method,question_type,answer_json,verdict,rationale_text,evidence_json,state_snapshot_json)values(rid,s.id,'overall_status','human','rule',jsonb_build_object('value',p_input->>'human_verdict'),case when p_input->>'human_verdict'='approved' then 'pass' else 'fail' end,p_input->>'human_note',jsonb_build_object('correction_id',c,'correction_type','decision_override','one_time_override',true),jsonb_build_object('submission',to_jsonb(s)));
 update submissions set status=p_input->>'human_verdict',decision_status=p_input->>'human_verdict',latest_run_id=rid,review_revision=review_revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('correction_id',c,'status',p_input->>'human_verdict');
end $$;

create or replace function public.core_fail_run(p_run uuid,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare r reconciliation_runs;
begin
 perform core_lock();select * into r from reconciliation_runs where id=p_run;
 update reconciliation_runs set status='failed',completed_at=now(),error=left(p_error,500) where id=p_run and status='running';
 if found and r.operation<>'investigation' then update submissions set status=case when decision_status='pending' then 'needs_review' else decision_status end,updated_at=now() where id=r.submission_id;end if;
update reconciliation_runs set investigation=investigation||jsonb_build_object('status','failed','error',left(p_error,500),'completed_at',now(),'outcome',null,'after_assessment',null) where id=p_run and investigation is not null and investigation->>'status'='running';
 update investigation_steps set doc=doc||jsonb_build_object('status','failed','error',left(p_error,500),'completed_at',now())where run_id=p_run and doc->>'status'='running';
end $$;

create function core_investigation(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action';s submissions;r reconciliation_runs;rid uuid;doc jsonb;step jsonb;prior jsonb;before jsonb;result jsonb;status text;
begin
 perform core_lock();
 if action='start' then
  select * into s from submissions where id=(p_input->>'claim_id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
  if s.review_revision is distinct from (p_input->>'expected_review_revision')::bigint then raise exception 'STALE_REVIEW';end if;
  if s.decision_status<>'pending' then raise exception 'EVIDENCE_LOCKED';end if;
  before:=core_assessment(s.id);if before->>'assessment_status' is null then raise exception 'ASSESSMENT_REQUIRED';end if;
  if exists(select 1 from jsonb_array_elements(before->'checks')c where c->>'verdict'='fail' and c->>'field_checked' in('currency','amount','policy','receipt_date','policy_cap','duplicate'))then raise exception 'INVESTIGATION_NOT_NEEDED';end if;
  if p_input->>'mode' not in('live','simulated')or p_input->>'trigger' not in('manual','recoverable_uncertainty')then raise exception 'INVALID_INPUT';end if;
  rid:=core_begin_run(s.id);
  doc:=jsonb_build_object('run_id',rid,'claim_id',s.id,'trigger',p_input->>'trigger','status','running','outcome',null,'headline','Investigating stored evidence','summary','Investigation started.','unresolved_question',null,'findings','[]'::jsonb,'before_assessment',before,'after_assessment',null,'proposed_learning',null,'steps','[]'::jsonb,'started_at',now(),'completed_at',null,'mode',p_input->>'mode','model',null,'error',null);
  update reconciliation_runs set operation='investigation',investigation=doc where id=rid;
 else
  rid:=(p_input->>'run_id')::uuid;select * into r from reconciliation_runs where id=rid;if r.investigation is null then raise exception 'NOT_FOUND';end if;doc:=r.investigation;
  if action='fail' then
   if r.status='running' then
    perform core_fail_run(rid,coalesce(p_input->>'error','INVESTIGATION_FAILED'));
    if p_input->>'superseded'='true' then update reconciliation_runs set status='superseded',investigation=investigation||'{"status":"superseded"}'::jsonb where id=rid;end if;
   end if;
  else
   if r.status<>'running' or doc->>'status'<>'running' then raise exception 'STALE_RUN';end if;
   if action='step' then
    step:=p_input->'step';select x.doc into prior from investigation_steps x where id=(step->>'id')::uuid;
    if step->>'run_id' is distinct from rid::text or step->>'tool' not in('read_receipt','read_supporting_documents','read_policy','read_active_aliases','find_related_claims')then raise exception 'INVALID_INPUT';end if;
    if prior is null then
     if step->>'status'<>'running' or (step->>'sequence')::int<>(select count(*)+1 from investigation_steps where run_id=rid)or(step->>'sequence')::int>6 then raise exception 'BUDGET_EXHAUSTED';end if;
     insert into investigation_steps values((step->>'id')::uuid,rid,(step->>'sequence')::int,step);
    else
     if prior->>'run_id' is distinct from rid::text or prior->>'status'<>'running' or prior->>'sequence' is distinct from step->>'sequence' or prior->>'tool' is distinct from step->>'tool' then raise exception 'STALE_RUN';end if;
     update investigation_steps set doc=step where id=(step->>'id')::uuid;
    end if;
   elsif action='finish' then
    result:=p_input->'result';select d->'answer_json'->>'value' into status from jsonb_array_elements(p_input->'decisions')d where d->>'field_checked'='overall_status';
    perform core_finish_run(rid,p_input->'decisions',status);
    doc:=doc||jsonb_build_object('status','completed','outcome',case when status='approved' then 'resolved' when status='flagged' then 'discrepancy_found' else 'needs_human' end,'headline',result->>'headline','summary',result->>'summary','unresolved_question',result->'unresolved_question','findings',result->'findings','proposed_learning',result->'proposed_learning','model',result->'model','completed_at',now(),'error',null,'after_assessment',core_assessment(r.submission_id));
    update reconciliation_runs set investigation=doc where id=rid;
   else raise exception 'INVALID_INPUT';end if;
  end if;
 end if;
 return core_investigation_doc(rid);
end $$;
create function core_normalize(p_text text) returns text language sql immutable as $$select lower(regexp_replace(trim(p_text),'\s+',' ','g'))$$;
create function core_booking_candidate(p_claim uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s submissions;r receipts;d supporting_documents;reference text;refs text[];canon text;links jsonb;
begin
 select * into s from submissions where id=p_claim;select * into r from receipts where submission_id=p_claim;
 if s.category<>'hotel' or s.currency<>'USD' or r.extraction_status is distinct from 'succeeded' or nullif(trim(r.parsed_fields_json->>'vendor'),'')is null or length(r.raw_extracted_text)>12000 or(select coalesce(sum(length(extracted_text)),0)from supporting_documents where claim_id=p_claim)>24000 then return null;end if;
 select array_agg(distinct core_normalize(m[2])) into refs from regexp_matches(r.raw_extracted_text,'(^|\n)\s*(?:booking|reservation|trip)\s+(?:reference|ref(?:erence)?\.?|confirmation(?:\s+(?:number|code))?)\s*[:#]\s*([^\r\n]+)','gi')m;
 if coalesce(array_length(refs,1),0)<>1 or nullif(refs[1],'')is null then return null;end if;reference:=refs[1];
 if exists(select 1 from supporting_documents where claim_id=p_claim and kind='booking_confirmation' and (extraction_status<>'succeeded' or facts is null))then return null;end if;
 for d in select * from supporting_documents where claim_id=p_claim and extraction_status='succeeded' and facts is not null loop
  if (nullif(trim(d.facts->>'booking_reference'),'')is not null and core_normalize(d.facts->>'booking_reference')<>reference)or(d.facts->>'amount_minor' is not null and d.facts->>'amount_minor' is distinct from r.parsed_fields_json->>'amount_minor')or(d.facts->>'currency' is not null and d.facts->>'currency' is distinct from r.parsed_fields_json->>'currency')or(d.facts->>'purchase_date' is not null and d.facts->>'purchase_date' is distinct from r.parsed_fields_json->>'receipt_date')then return null;end if;
 end loop;
 links:=jsonb_build_array(jsonb_build_object('kind','receipt','id',r.id));
 for d in select * from supporting_documents where claim_id=p_claim and kind='booking_confirmation' and extraction_status='succeeded' and facts is not null order by id loop
  if nullif(trim(d.facts->>'booking_reference'),'')is null or core_normalize(d.facts->>'booking_reference')<>reference or position(reference in core_normalize(d.extracted_text))=0 or nullif(trim(d.facts->>'vendor'),'')is null or position(core_normalize(d.facts->>'vendor')in core_normalize(d.extracted_text))=0 then return null;end if;
  if (d.facts->>'amount_minor' is not null and d.facts->>'amount_minor' is distinct from r.parsed_fields_json->>'amount_minor')or(d.facts->>'currency' is not null and d.facts->>'currency' is distinct from r.parsed_fields_json->>'currency')or(d.facts->>'purchase_date' is not null and d.facts->>'purchase_date' is distinct from r.parsed_fields_json->>'receipt_date')then return null;end if;
  if jsonb_array_length(d.facts->'names')>0 and jsonb_array_length(r.parsed_fields_json->'names')>0 and not exists(select 1 from jsonb_array_elements_text(d.facts->'names')n cross join jsonb_array_elements_text(r.parsed_fields_json->'names')q where core_normalize(n)=core_normalize(q))then return null;end if;
  if canon is not null and core_normalize(canon)<>core_normalize(d.facts->>'vendor')then return null;end if;canon:=trim(d.facts->>'vendor');
  links:=links||jsonb_build_array(jsonb_build_object('kind','supporting_document','id',d.id));
 end loop;
 if canon is null then return null;end if;
 return jsonb_build_object('kind','booking_reference_identity','trigger_scope',jsonb_build_object('category','hotel','currency','USD','observed_vendor',trim(r.parsed_fields_json->>'vendor'),'canonical_vendor',canon),'required_evidence',jsonb_build_array('receipt','booking_confirmation'),'matching_fields',jsonb_build_array('booking_reference'),'source_evidence_refs',links);
end $$;

create function public.core_procedure(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action';rule jsonb;rid uuid;s submissions;c corrections;r receipts;k bigint;b jsonb;t jsonb;attempt uuid;fresh boolean;report jsonb;source_run reconciliation_runs;candidate jsonb;
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
   fresh:=rule->>'state'='draft' and rule->>'version'=t->>'procedure_version' and rule->>'latest_attempt_id'=attempt::text and (b->>'knowledge_revision')::bigint=k and (b->>'source_review_revision')::bigint=s.review_revision and b->>'source_correction_id'=c.id::text and (rule->>'source_evidence_revision')::bigint=s.evidence_revision and rule->>'source_fingerprint'=core_source_fingerprint(s.id);
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
    else raise exception 'INVALID_INPUT';end if;
   end if;
  end if;
  update resolution_procedures set doc=rule where id=rid;
 end if;
 update platform_state set knowledge_revision=k;insert into procedure_history(procedure_id,doc)values(rid,rule);
 return jsonb_build_object('procedure',rule,'knowledge_revision',k);
end $$;
-- Close every new entry point, including renamed historical implementations.
revoke all on function core_invalidate_procedures(uuid),core_procedure_source_changed(),core_evidence_v2(),core_evidence(),core_investigation_doc(uuid),core_snapshot_v2(),core_snapshot(),core_source_fingerprint(uuid),core_assessment(uuid),core_supporting(jsonb),core_investigation(jsonb),core_normalize(text),core_booking_candidate(uuid),core_procedure(jsonb)from public,anon,authenticated;
grant execute on function core_evidence(),core_snapshot(),core_supporting(jsonb),core_investigation(jsonb),core_procedure(jsonb)to service_role;
-- The marker advances only after every table, lease and lifecycle RPC is installed.
create or replace function core_platform_version()returns integer language sql stable security definer set search_path=public as $$select 3$$;
revoke all on function core_platform_version()from public,anon,authenticated;
grant execute on function core_platform_version()to service_role;
