-- Decision saving prepares an immutable notice; only an explicitly confirmed batch releases it.
begin;
create function core_notice_pending(m jsonb) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((m->>'status'='draft' or (m->>'status' in ('failed','delivery_unknown') and (m->>'attempt_count')::int<3
     and (m->>'first_attempt_at' is null or (m->>'first_attempt_at')::timestamptz>now()-interval '23 hours'))) and m->>'outcome_header' is not null
   and exists(select 1 from submissions s where s.id=(m->>'claim_id')::uuid and s.email=m->>'recipient')
   and case when m->>'decision_source'='automatic' then core_automatic_notice_current(m)
     and not exists(select 1 from decisions d where d.run_id=(m->>'assessment_run_id')::uuid and d.evidence_json->>'demo_baseline'='true')
     else m->>'correction_id' is not null and (m->>'correction_id')::uuid=(select c.id from corrections c where c.submission_id=(m->>'claim_id')::uuid order by c.review_revision desc,c.corrected_at desc,c.id desc limit 1)
       and not exists(select 1 from corrections c where c.id=(m->>'correction_id')::uuid and c.correction_payload_json->>'demo_baseline'='true') end,false);
$$;

-- Never interrupt an attempted delivery: its provider outcome may already exist.
update claim_messages set doc=doc||jsonb_build_object('status','draft','next_attempt_at',null,
  'notification_confirmed_at',null,'updated_at',now(),'message_revision',(doc->>'message_revision')::int+1)
where doc->>'status'='queued' and coalesce((doc->>'attempt_count')::int,0)=0 and doc->>'first_attempt_at' is null;

alter function core_messages(jsonb) rename to core_messages_before_hold;
create function core_messages(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action'; result jsonb; prior jsonb; m jsonb; item jsonb; mid uuid;
  batch jsonb:='[]'::jsonb; hold_new boolean:=false; cid uuid;
begin
 perform core_lock();
 if action='outbox' then
  if (select count(*) from claim_messages)>1000 then raise exception 'REVIEW_LIMIT';end if;
  return jsonb_build_object('message',null,'messages',coalesce((select jsonb_agg(doc order by id) from claim_messages),'[]'::jsonb));
 end if;
 if action='release_batch' then
  if p_input->>'confirmed' is distinct from 'true' or p_input->>'mode' not in ('preview','live')
    or jsonb_typeof(p_input->'messages') is distinct from 'array' or jsonb_array_length(p_input->'messages') not between 1 and 1000
    or (select count(distinct x->>'id') from jsonb_array_elements(p_input->'messages') x)<>jsonb_array_length(p_input->'messages')
    then raise exception 'INVALID_INPUT';end if;
  if p_input->'expected' is distinct from core_snapshot() then raise exception 'STALE_MESSAGE';end if;
  for item in select * from jsonb_array_elements(p_input->'messages') loop
   select doc into m from claim_messages where id=(item->>'id')::uuid for update;
   if not found or not core_notice_pending(m) or m->>'message_revision' is distinct from item->>'revision'
     or m->>'mode' is distinct from p_input->>'mode' or m->>'from' is distinct from p_input->>'from'
     or m->>'reply_to' is distinct from p_input->>'reply_to' then raise exception 'STALE_MESSAGE';end if;
   batch:=batch||jsonb_build_array(m);
  end loop;
  result:='[]'::jsonb;
  for m in select * from jsonb_array_elements(batch) loop
   m:=m||jsonb_build_object('status',case when p_input->>'mode'='live' then 'queued' else 'previewed' end,
     'notification_confirmed_at',now(),'next_attempt_at',case when p_input->>'mode'='live' then now() else null end,
     'updated_at',now(),'message_revision',(m->>'message_revision')::int+1);
   update claim_messages set doc=m where id=(m->>'id')::uuid;
   insert into message_delivery_events(message_id,type)values((m->>'id')::uuid,m->>'status');
   result:=result||jsonb_build_array(m);
  end loop;
  return jsonb_build_object('message',null,'messages',result);
 end if;
 -- Explicit batch dispatch leases only the selected message. The normal worker still handles retries.
 if action='lease' and p_input->>'message_id' is not null then
  mid:=(p_input->>'message_id')::uuid;select doc into m from claim_messages where id=mid for update;
  if not found or m->>'notification_confirmed_at' is null or m->>'mode'<>'live' or m->>'status' not in ('queued','failed','delivery_unknown')
    or m->>'next_attempt_at' is null or (m->>'next_attempt_at')::timestamptz>now() then return jsonb_build_object('message',null);end if;
  select id into cid from corrections where submission_id=(m->>'claim_id')::uuid order by review_revision desc,corrected_at desc,id desc limit 1;
  if (m->>'decision_source'='automatic' and not core_automatic_notice_current(m))
    or (coalesce(m->>'decision_source','human')<>'automatic' and cid is distinct from (m->>'correction_id')::uuid) then
   update claim_messages set doc=doc||jsonb_build_object('status','cancelled','next_attempt_at',null,'updated_at',now(),'message_revision',(doc->>'message_revision')::int+1) where id=mid;
   insert into message_delivery_events(message_id,type)values(mid,'cancelled');return jsonb_build_object('message',null);
  end if;
  if (m->>'attempt_count')::int>=3 or (m->>'first_attempt_at' is not null and (m->>'first_attempt_at')::timestamptz<now()-interval '23 hours') then
   update claim_messages set doc=doc||jsonb_build_object('next_attempt_at',null,'error','Automatic retry stopped. Reconcile the provider outcome.','updated_at',now(),'message_revision',(doc->>'message_revision')::int+1) where id=mid;
   return jsonb_build_object('message',null);
  end if;
  m:=m||jsonb_build_object('status','sending','attempt_count',(m->>'attempt_count')::int+1,'first_attempt_at',coalesce((m->>'first_attempt_at')::timestamptz,now()),
    'lease_token',gen_random_uuid(),'lease_expires_at',now()+interval '30 seconds','next_attempt_at',null,'updated_at',now(),'message_revision',(m->>'message_revision')::int+1);
  update claim_messages set doc=m where id=mid;insert into message_delivery_events(message_id,type)values(mid,'attempt_started');
  return jsonb_build_object('message',m);
 end if;
 if action='lease' then
  -- Legacy queued/retrying notices have never received the new explicit batch authorization.
  -- Leave active leases alone; hold expired uncertain attempts for an explicit retry decision.
  update claim_messages set doc=doc||jsonb_build_object('status',case when doc->>'status'='sending' then 'delivery_unknown'
      when doc->>'status'='queued' then case when (doc->>'attempt_count')::int=0 then 'draft' else 'failed' end else doc->>'status' end,
    'next_attempt_at',null,'lease_token',null,'lease_expires_at',null,'updated_at',now(),'message_revision',(doc->>'message_revision')::int+1)
    where doc->>'notification_confirmed_at' is null and doc->>'status' in ('queued','failed','delivery_unknown','sending')
      and (doc->>'status'<>'sending' or (doc->>'lease_expires_at')::timestamptz<=now())
      and (doc->>'next_attempt_at' is not null or doc->>'status'='sending');
 end if;
 if action='publish_automatic' then
  select doc into prior from claim_messages where claim_id=(p_input#>>'{message,claim_id}')::uuid and doc->>'automatic_decision_key'=p_input#>>'{message,automatic_decision_key}';
  hold_new:=prior is null;
 elsif action in ('confirm','edit') then
  select doc into prior from claim_messages where id=(p_input->>'message_id')::uuid;
  if action='edit' and (prior->>'correction_id' is not null or prior->>'automatic_decision_key' is not null) then raise exception 'MESSAGE_ALREADY_CONFIRMED';end if;
  if action='confirm' and prior->>'correction_id' is not null and prior->>'request_id' is distinct from p_input->>'request_id' then raise exception 'MESSAGE_ALREADY_CONFIRMED';end if;
  hold_new:=action='confirm' and prior->>'correction_id' is null;
 end if;
 result:=core_messages_before_hold(p_input);
 if hold_new then
  m:=result->'message';mid:=(m->>'id')::uuid;
  m:=m||jsonb_build_object('status','draft','notification_confirmed_at',null,'next_attempt_at',null);
  update claim_messages set doc=m where id=mid;
  update message_delivery_events set type='held' where id=(select id from message_delivery_events where message_id=mid and type in ('queued','previewed') order by created_at desc,id desc limit 1);
  result:=jsonb_set(result,'{message}',m);
 end if;
 return result;
end $$;
revoke all on function core_notice_pending(jsonb),core_messages_before_hold(jsonb),core_messages(jsonb) from public,anon,authenticated,service_role;
grant execute on function core_messages(jsonb) to service_role;
commit;
