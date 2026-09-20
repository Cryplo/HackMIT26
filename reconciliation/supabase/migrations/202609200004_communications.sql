-- Forward-only Release 1 decision messages. Apply once after 003, in one transaction.
-- This migration does not queue historical decisions and makes no provider calls.
do $$ begin if core_platform_version() <> 3 then raise exception 'Expected platform version 3'; end if; end $$;
create table claim_messages (
 id uuid primary key,
 claim_id uuid not null references submissions(id),
 correction_id uuid unique references corrections(id),
 request_id uuid unique,
 doc jsonb not null,
 check (doc->>'id'=id::text and doc->>'claim_id'=claim_id::text),
 check (doc->>'kind' in ('approval','rejection')),
 check (doc->>'status' in ('draft','previewed','queued','sending','accepted','failed','delivery_unknown','cancelled')),
 check (length(trim(doc->>'subject')) between 1 and 200 and length(trim(doc->>'body')) between 1 and 8000),
 check (doc->>'subject' !~ E'[\r\n]')
);
create unique index claim_messages_send_key on claim_messages ((doc->>'idempotency_key'));
create index claim_messages_claim on claim_messages(claim_id);
create table message_delivery_events (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references claim_messages(id),
 type text not null,
 created_at timestamptz not null default now(),
 provider_event_id text unique,
 error text
);
alter table claim_messages enable row level security;
alter table message_delivery_events enable row level security;
revoke all on claim_messages,message_delivery_events from public,anon,authenticated;

-- All correction paths share the same lock and respect active provider attempts.
-- Original approval, duplicate, operation and evidence guards remain intact.
alter function core_correct(jsonb) rename to core_correct_v3;
create function core_correct_message(p_input jsonb,p_keep uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; sid uuid := (p_input->>'submission_id')::uuid;
begin
 perform core_lock();
 if exists(select 1 from claim_messages where claim_id=sid and doc->>'status'='sending' and (doc->>'lease_expires_at')::timestamptz>now()) then raise exception 'COMMUNICATION_IN_FLIGHT';end if;
 result:=core_correct_v3(p_input);
 with cancelled as (
  update claim_messages set doc=doc||jsonb_build_object('status','cancelled','next_attempt_at',null,'lease_token',null,'lease_expires_at',null,'error','A later reviewer decision superseded this notice.','message_revision',(doc->>'message_revision')::int+1,'updated_at',now())
  where claim_id=sid and id is distinct from p_keep and doc->>'status' in ('draft','queued','failed','delivery_unknown','sending') returning id
 ) insert into message_delivery_events(message_id,type,error) select id,'cancelled','A later reviewer decision superseded this notice.' from cancelled;
 return result;
end $$;
create function core_correct(p_input jsonb) returns jsonb language sql security definer set search_path=public as $$select core_correct_message(p_input,null)$$;
revoke all on function core_correct_message(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function core_correct_v3(jsonb) from public,anon,authenticated,service_role;
revoke all on function core_correct(jsonb) from public,anon,authenticated;
grant execute on function core_correct(jsonb) to service_role;

create function core_message_current(m jsonb) returns void language plpgsql security definer set search_path=public as $$
declare s submissions; knowledge bigint;
begin
 select * into s from submissions where id=(m->>'claim_id')::uuid;
 if not found then raise exception 'NOT_FOUND';end if;
 select knowledge_revision into knowledge from platform_state;
 if s.review_revision is distinct from (m->>'source_review_revision')::bigint or s.evidence_revision is distinct from (m->>'source_evidence_revision')::bigint or knowledge is distinct from (m->>'source_knowledge_revision')::bigint or s.latest_run_id is distinct from (m->>'assessment_run_id')::uuid or s.email is distinct from m->>'recipient' then raise exception 'STALE_MESSAGE';end if;
end $$;

create function core_messages(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action'; m jsonb; candidate record; s submissions; result jsonb; mid uuid; cid uuid; next_time timestamptz; text_body text; html_body text;
begin
 perform core_lock();
 if action='list' then
  if not exists(select 1 from submissions where id=(p_input->>'claim_id')::uuid)then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('message',null,'messages',coalesce((select jsonb_agg(doc order by doc->>'created_at',id) from claim_messages where claim_id=(p_input->>'claim_id')::uuid),'[]'::jsonb));
 end if;
 if action='draft' then
  m:=p_input->'message';perform core_message_current(m);
  if m->>'status' is distinct from 'draft' or m->>'correction_id' is not null or m->>'request_id' is not null or m->>'intended_verdict' not in ('approved','rejected') or m->>'kind' is distinct from case when m->>'intended_verdict'='approved' then 'approval' else 'rejection' end then raise exception 'INVALID_INPUT';end if;
  if exists(select 1 from claim_messages where id=(m->>'id')::uuid)then raise exception 'MESSAGE_CONFLICT';end if;
  insert into claim_messages(id,claim_id,doc)values((m->>'id')::uuid,(m->>'claim_id')::uuid,m);
  return jsonb_build_object('message',m);
 end if;
 if action='confirm' then
  select doc into m from claim_messages where request_id=(p_input->>'request_id')::uuid;
  if found then
   if m->>'confirmation_payload_hash' is distinct from p_input->>'payload_hash' or m->>'id' is distinct from p_input->>'message_id' or m->>'claim_id' is distinct from p_input->'correction'->>'submission_id' then raise exception 'MESSAGE_CONFLICT';end if;
   return jsonb_build_object('message',m,'correction_id',m->>'correction_id','status',m->>'intended_verdict');
  end if;
 end if;
 if action='lease' then
  -- Crashed sends are unknown outcomes; keep the same payload and idempotency key.
  with expired as (
   update claim_messages set doc=doc||jsonb_build_object('status','delivery_unknown','error','The previous send lease expired without a confirmed outcome.','lease_token',null,'lease_expires_at',null,'next_attempt_at',now(),'updated_at',now(),'message_revision',(doc->>'message_revision')::int+1)
   where doc->>'status'='sending' and (doc->>'lease_expires_at')::timestamptz<=now() returning id
  ) insert into message_delivery_events(message_id,type,error)select id,'delivery_unknown','The previous send lease expired without a confirmed outcome.' from expired;
  for candidate in select id,doc from claim_messages where doc->>'mode'='live' and doc->>'status' in ('queued','failed','delivery_unknown') and (doc->>'next_attempt_at')::timestamptz<=now() order by doc->>'created_at',id loop
   mid:=candidate.id;m:=candidate.doc;
   select id into cid from corrections where submission_id=(m->>'claim_id')::uuid order by review_revision desc,corrected_at desc,id desc limit 1;
   if cid is distinct from (m->>'correction_id')::uuid then
    update claim_messages set doc=doc||jsonb_build_object('status','cancelled','next_attempt_at',null,'updated_at',now(),'message_revision',(doc->>'message_revision')::int+1)where id=mid;
    insert into message_delivery_events(message_id,type)values(mid,'cancelled');continue;
   end if;
   if (m->>'attempt_count')::int>=3 or (m->>'first_attempt_at')::timestamptz<=now()-interval '23 hours' then
    update claim_messages set doc=doc||jsonb_build_object('next_attempt_at',null,'error','Automatic retry stopped. Reconcile any uncertain provider outcome before retrying.','updated_at',now(),'message_revision',(doc->>'message_revision')::int+1)where id=mid;continue;
   end if;
   m:=m||jsonb_build_object('status','sending','attempt_count',(m->>'attempt_count')::int+1,'first_attempt_at',coalesce((m->>'first_attempt_at')::timestamptz,now()),'lease_token',gen_random_uuid(),'lease_expires_at',now()+interval '30 seconds','next_attempt_at',null,'updated_at',now(),'message_revision',(m->>'message_revision')::int+1);
   update claim_messages set doc=m where id=mid;
   insert into message_delivery_events(message_id,type)values(mid,'attempt_started');
   return jsonb_build_object('message',m);
  end loop;
  return jsonb_build_object('message',null);
 end if;
 mid:=(p_input->>'message_id')::uuid;select doc into m from claim_messages where id=mid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if action='get' then return jsonb_build_object('message',m);end if;
 if action='edit' then
  if m->>'status'<>'draft' then raise exception 'MESSAGE_ALREADY_CONFIRMED';end if;
  if (m->>'draft_revision')::int is distinct from (p_input->>'expected_draft_revision')::int then raise exception 'STALE_MESSAGE';end if;
  perform core_message_current(m);
  m:=m||jsonb_build_object('subject',trim(p_input->>'subject'),'body',trim(p_input->>'body'),'draft_revision',(m->>'draft_revision')::int+1);
 elsif action='confirm' then
  if m->>'status'<>'draft' then raise exception 'MESSAGE_ALREADY_CONFIRMED';end if;
  if (m->>'draft_revision')::int is distinct from (p_input->>'expected_draft_revision')::int then raise exception 'STALE_MESSAGE';end if;
  perform core_message_current(m);
  if p_input->'correction'->>'submission_id' is distinct from m->>'claim_id' or p_input->'correction'->>'human_verdict' is distinct from m->>'intended_verdict' or p_input->'correction'->>'expected_review_revision' is distinct from m->>'source_review_revision' or p_input->>'mode' not in ('preview','live') then raise exception 'STALE_MESSAGE';end if;
  select * into s from submissions where id=(m->>'claim_id')::uuid;
  if m->>'mode' is distinct from p_input->>'mode' then raise exception 'STALE_MESSAGE';end if;
  result:=core_correct_message(p_input->'correction',mid);
  m:=m||jsonb_build_object('correction_id',result->>'correction_id','request_id',p_input->>'request_id','confirmation_payload_hash',p_input->>'payload_hash','mode',p_input->>'mode','from',p_input->>'from','reply_to',p_input->>'reply_to','outcome_header',s.attendee_name||' — claim '||s.id::text||' ('||s.category||'): '||case when m->>'intended_verdict'='approved' then 'Approved for reimbursement' else 'Rejected' end||'. '||s.currency||' '||to_char(s.amount_requested_minor::numeric/100,'FM999999999990.00')||case when m->>'intended_verdict'='approved' then ' approved.' else ' requested.' end,'status',case when p_input->>'mode'='live' then 'queued' else 'previewed' end,'confirmed_at',now(),'error',null,'next_attempt_at',case when p_input->>'mode'='live' then now() else null end);
  text_body:=(m->>'outcome_header')||E'\n\n'||(m->>'body');
  html_body:='<div style="white-space:pre-wrap">'||replace(replace(replace(replace(replace(text_body,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')||'</div>';
  m:=m||jsonb_build_object('rendered_text',text_body,'rendered_html',html_body);
  insert into message_delivery_events(message_id,type)values(mid,m->>'status');
 elsif action='retry' then
  if (m->>'message_revision')::int is distinct from (p_input->>'expected_message_revision')::int then raise exception 'STALE_MESSAGE';end if;
  if m->>'status' not in ('failed','delivery_unknown') or m->>'mode'<>'live' then raise exception 'RETRY_BLOCKED';end if;
  select id into cid from corrections where submission_id=(m->>'claim_id')::uuid order by review_revision desc,corrected_at desc,id desc limit 1;
  if cid is distinct from (m->>'correction_id')::uuid then raise exception 'STALE_MESSAGE';end if;
  if (m->>'attempt_count')::int>=3 or (m->>'first_attempt_at')::timestamptz<=now()-interval '23 hours' then raise exception 'DELIVERY_RECONCILIATION_REQUIRED';end if;
  m:=m||jsonb_build_object('status','queued','next_attempt_at',now(),'error',null);
  insert into message_delivery_events(message_id,type)values(mid,'retry_queued');
 elsif action='settle' then
  if m->>'status'<>'sending' or m->>'lease_token' is distinct from p_input->>'lease_token' then raise exception 'STALE_MESSAGE';end if;
  if p_input->>'outcome' not in ('accepted','failed','delivery_unknown') or (p_input->>'outcome'='accepted' and coalesce(p_input->>'provider_message_id','')='') then raise exception 'INVALID_INPUT';end if;
  next_time:=null;
  if p_input->>'outcome'<>'accepted' and p_input->>'retry_after_seconds' is not null and (m->>'attempt_count')::int<3 and (m->>'first_attempt_at')::timestamptz>now()-interval '23 hours' then next_time:=now()+make_interval(secs=>greatest(1,least(3600,(p_input->>'retry_after_seconds')::double precision)));end if;
  m:=m||jsonb_build_object('status',p_input->>'outcome','provider_message_id',p_input->>'provider_message_id','error',left(p_input->>'error',500),'lease_token',null,'lease_expires_at',null,'next_attempt_at',next_time);
  insert into message_delivery_events(message_id,type,error)values(mid,m->>'status',m->>'error');
 else raise exception 'INVALID_INPUT';end if;
 m:=m||jsonb_build_object('updated_at',now(),'message_revision',(m->>'message_revision')::int+1);
 update claim_messages set doc=m,correction_id=(m->>'correction_id')::uuid,request_id=(m->>'request_id')::uuid where id=mid;
 return jsonb_build_object('message',m)||coalesce(result,'{}'::jsonb);
end $$;
revoke all on function core_message_current(jsonb),core_messages(jsonb) from public,anon,authenticated,service_role;
grant execute on function core_messages(jsonb) to service_role;
create or replace function core_platform_version() returns integer language sql stable security definer set search_path=public as $$select 4$$;
revoke all on function core_platform_version() from public,anon,authenticated;
grant execute on function core_platform_version() to service_role;
