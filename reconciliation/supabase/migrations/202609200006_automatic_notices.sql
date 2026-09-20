-- Additive: no historical notices, human corrections, or provider calls are created.
-- Apply after 004 (and 005 when demo reset is enabled), in one transaction.
do $$ begin if core_platform_version() <> 4 then raise exception 'Expected platform version 4'; end if; end $$;
create unique index claim_messages_automatic_decision on claim_messages(claim_id,(doc->>'automatic_decision_key')) where doc->>'decision_source'='automatic';

create function core_automatic_notice_current(m jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare s submissions; r reconciliation_runs; receipt receipts; marker jsonb; f text; n integer; cap integer;
begin
 select * into s from submissions where id=(m->>'claim_id')::uuid;
 select * into r from reconciliation_runs where id=s.latest_run_id;
 select * into receipt from receipts where submission_id=s.id;
 if s.id is null or r.id is null or r.status<>'completed' or r.operation not in ('assessment','investigation') or s.decision_status<>'pending' or receipt.extraction_status is distinct from 'succeeded' or s.email is distinct from m->>'recipient'
 or r.evidence_revision<>s.evidence_revision or r.knowledge_revision<>(select knowledge_revision from platform_state)
 or exists(select 1 from corrections where submission_id=s.id)
 or exists(select 1 from reconciliation_runs where submission_id=s.id and operation in ('assessment','investigation') and review_revision>r.review_revision) then return false;end if;
 -- ponytail: conservatively bind the existing full evidence snapshot; scope it per claim if unrelated evidence churn delays notices.
 if r.evidence_snapshot is distinct from core_evidence() then return false;end if;
 select evidence_json->'auto_approval' into marker from decisions where run_id=r.id and field_checked='overall_status' and check_method<>'human' and verdict='pass' limit 1;
 if marker is null or marker->>'policy' is distinct from 'policy-caps-v1' or marker->>'run_id' is distinct from r.id::text or (marker->>'evidence_revision')::bigint is distinct from s.evidence_revision or (marker->>'knowledge_revision')::bigint is distinct from r.knowledge_revision
 or m->>'automatic_decision_key' is distinct from (marker->>'policy')||'/'||(marker->>'evidence_identity')||'/'||(marker->>'knowledge_revision') then return false;end if;
 foreach f in array array['currency','amount','policy','receipt_date','policy_cap','merchant','name','duplicate'] loop
  if not exists(select 1 from decisions where run_id=r.id and field_checked=f and check_method<>'human' and verdict='pass') then return false;end if;
 end loop;
 if exists(select 1 from decisions where run_id=r.id and check_method<>'human' and field_checked<>'overall_status' and verdict<>'pass') then return false;end if;
 if receipt.parsed_fields_json->>'currency' is distinct from 'USD' or receipt.parsed_fields_json->>'amount_minor' is distinct from s.amount_requested_minor::text or receipt.parsed_fields_json->>'receipt_date' is null then return false;end if;
 select count(*),min(max_amount_minor) into n,cap from policy_rules where category=s.category and currency=s.currency and region_or_route='*' and (receipt.parsed_fields_json->>'receipt_date')::date between date_range_start and date_range_end;
 if n<>1 or s.amount_requested_minor>cap then return false;end if;
 if exists(select 1 from submissions x join receipts y on y.submission_id=x.id where x.id<>s.id and core_same_purchase(receipt,y) and ((x.submitted_at,x.id)<(s.submitted_at,s.id) or x.decision_status='approved'))then return false;end if;
 return true;
end $$;

alter function core_messages(jsonb) rename to core_messages_v4;
create function core_messages(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action'; m jsonb; prior jsonb; s submissions; body text; candidate record;
begin
 perform core_lock();
 if action='publish_automatic' then
  m:=p_input->'message';perform core_message_current(m);
  if m->>'decision_source' is distinct from 'automatic' or m->>'intended_verdict' is distinct from 'approved' or m->>'kind' is distinct from 'approval' or m->>'status' is distinct from 'draft' or m->>'correction_id' is not null or m->>'request_id' is not null or m->>'mode' is distinct from p_input->>'mode' or p_input->>'mode' not in ('preview','live') or not core_automatic_notice_current(m) then raise exception 'STALE_MESSAGE';end if;
  select doc into prior from claim_messages where claim_id=(m->>'claim_id')::uuid and doc->>'automatic_decision_key'=m->>'automatic_decision_key';
  if found then return jsonb_build_object('message',prior);end if;
  if exists(select 1 from claim_messages where claim_id=(m->>'claim_id')::uuid and doc->>'status'='sending' and (doc->>'lease_expires_at')::timestamptz>now())then raise exception 'COMMUNICATION_IN_FLIGHT';end if;
  select * into s from submissions where id=(m->>'claim_id')::uuid;
  m:=m||jsonb_build_object('from',p_input->>'from','reply_to',p_input->>'reply_to','outcome_header',s.attendee_name||' — claim '||s.id::text||' ('||s.category||'): Approved for reimbursement. '||s.currency||' '||to_char(s.amount_requested_minor::numeric/100,'FM999999999990.00')||' approved.','status',case when p_input->>'mode'='live' then 'queued' else 'previewed' end,'confirmed_at',now(),'updated_at',now(),'message_revision',(m->>'message_revision')::int+1,'next_attempt_at',case when p_input->>'mode'='live' then now() else null end);
  body:=(m->>'outcome_header')||E'\n\n'||(m->>'body');
  m:=m||jsonb_build_object('rendered_text',body,'rendered_html','<div style="white-space:pre-wrap">'||replace(replace(replace(replace(replace(body,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')||'</div>');
  insert into claim_messages(id,claim_id,doc)values((m->>'id')::uuid,s.id,m);
  insert into message_delivery_events(message_id,type)values((m->>'id')::uuid,m->>'status');
  return jsonb_build_object('message',m);
 end if;
 if action='lease' then
  for candidate in select id,doc from claim_messages where doc->>'decision_source'='automatic' and doc->>'status' in ('queued','failed','delivery_unknown','sending') loop
   if not core_automatic_notice_current(candidate.doc) then
    update claim_messages set doc=doc||jsonb_build_object('status','cancelled','next_attempt_at',null,'lease_token',null,'lease_expires_at',null,'error','The policy approval is no longer current.','updated_at',now(),'message_revision',(doc->>'message_revision')::int+1)where id=candidate.id;
    insert into message_delivery_events(message_id,type,error)values(candidate.id,'cancelled','The policy approval is no longer current.');
   end if;
  end loop;
 elsif action in ('retry','confirm') then
  select doc into m from claim_messages where id=(p_input->>'message_id')::uuid;
  if m->>'decision_source'='automatic' and (action='confirm' or not core_automatic_notice_current(m))then raise exception 'STALE_MESSAGE';end if;
 end if;
 return core_messages_v4(p_input);
end $$;
revoke all on function core_automatic_notice_current(jsonb),core_messages_v4(jsonb),core_messages(jsonb) from public,anon,authenticated,service_role;
grant execute on function core_messages(jsonb) to service_role;
