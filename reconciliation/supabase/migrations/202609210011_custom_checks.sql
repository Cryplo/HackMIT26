-- Reviewer-configured custom Jev checks. Additive; apply once after 010, in one transaction.
-- Mirrors src/lib/core/custom-checks.ts: active checks join the Jev question set and the
-- check_configuration evidence fingerprint, so mid-run configuration changes stale the run.
do $$ begin if core_platform_version() <> 4 then raise exception 'Expected platform version 4'; end if; end $$;
create table public.custom_checks(id uuid primary key,doc jsonb not null);
create table public.custom_check_history(id bigint generated always as identity primary key,check_id uuid not null references custom_checks(id),doc jsonb not null,created_at timestamptz not null default now());
alter table custom_checks enable row level security;
alter table custom_check_history enable row level security;
revoke all on custom_checks,custom_check_history from anon,authenticated;
grant all on custom_checks,custom_check_history to service_role;

-- Bind active check configuration into run evidence; a change invalidates in-flight runs.
alter function core_evidence() rename to core_evidence_v3;
create function core_evidence() returns jsonb language sql stable security definer set search_path=public as $$
 select core_evidence_v3()||jsonb_build_object('check_configuration',jsonb_build_object('version','mandatory-v1','custom',coalesce((select jsonb_agg(jsonb_build_object('field',doc->>'field','version',(doc->>'version')::int,'hash',left(md5(doc::text),16)) order by doc->>'field') from custom_checks where doc->>'state'='active'),'[]'::jsonb)));
$$;

alter function core_snapshot() rename to core_snapshot_v3;
create function core_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select core_snapshot_v3()||jsonb_build_object('custom_checks',coalesce((select jsonb_agg(doc order by id) from custom_checks),'[]'::jsonb),'custom_check_history',coalesce((select jsonb_agg(doc order by id) from custom_check_history),'[]'::jsonb));
$$;

create function public.core_custom_check(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare action text:=p_input->>'action';check_doc jsonb;cid uuid;base text;field text;suffix int;k bigint;
begin
 perform core_lock();
 if action='create' then
  if (select count(*) from custom_checks)>=12 then raise exception 'CHECK_LIMIT';end if;
  base:='custom_'||left(regexp_replace(regexp_replace(lower(p_input->>'label'),'[^a-z0-9]+','_','g'),'^_+|_+$','','g'),32);
  if base !~ '^custom_[a-z0-9]' then raise exception 'INVALID_INPUT';end if;
  field:=base;suffix:=2;
  while exists(select 1 from custom_checks where doc->>'field'=field) or field !~ '^custom_[a-z0-9_]{2,40}$' or field=any(array['currency','amount','policy','receipt_date','policy_cap','merchant','name','duplicate']) loop
   field:=base||'_'||suffix;suffix:=suffix+1;
  end loop;
  cid:=gen_random_uuid();
  check_doc:=jsonb_build_object('id',cid,'version',1,'state','active','field',field,'label',p_input->>'label','instructions',p_input->>'instructions','criteria',p_input->'criteria','category',p_input->'category','created_at',now(),'updated_at',now());
  insert into custom_checks values(cid,check_doc);
  update platform_state set knowledge_revision=knowledge_revision+1 returning knowledge_revision into k;
 else
  if action not in ('update','enable','disable') then raise exception 'INVALID_INPUT';end if;
  cid:=(p_input->>'id')::uuid;select doc into check_doc from custom_checks where id=cid for update;if not found then raise exception 'NOT_FOUND';end if;
  if (check_doc->>'version')::int is distinct from (p_input->>'expected_check_version')::int then raise exception 'STALE_CHECK';end if;
  select knowledge_revision into k from platform_state;
  if action='update' then
   check_doc:=check_doc||jsonb_build_object('label',p_input->>'label','instructions',p_input->>'instructions','criteria',p_input->'criteria','category',p_input->'category','version',(check_doc->>'version')::int+1,'updated_at',now());
   if check_doc->>'state'='active' then k:=k+1;update platform_state set knowledge_revision=k;end if;
  elsif action='disable' then
   if check_doc->>'state'='disabled' then raise exception 'STALE_CHECK';end if;
   check_doc:=check_doc||jsonb_build_object('state','disabled','version',(check_doc->>'version')::int+1,'updated_at',now());
   k:=k+1;update platform_state set knowledge_revision=k;
  else
   if check_doc->>'state'='active' then raise exception 'STALE_CHECK';end if;
   check_doc:=check_doc||jsonb_build_object('state','active','version',(check_doc->>'version')::int+1,'updated_at',now());
   k:=k+1;update platform_state set knowledge_revision=k;
  end if;
  update custom_checks set doc=check_doc where id=cid;
 end if;
 insert into custom_check_history(check_id,doc)values(cid,check_doc);
 return jsonb_build_object('check',check_doc,'knowledge_revision',k);
end $$;
revoke all on function core_evidence_v3(),core_evidence(),core_snapshot_v3(),core_snapshot(),core_custom_check(jsonb) from public,anon,authenticated;
grant execute on function core_evidence(),core_snapshot(),core_custom_check(jsonb) to service_role;
