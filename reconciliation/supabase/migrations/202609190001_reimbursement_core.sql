-- Synthetic reimbursement demo only. No client grants; server service role owns all access.
create extension if not exists pgcrypto;
create table public.submissions (
 id uuid primary key default gen_random_uuid(), attendee_name text not null, email text not null,
 amount_requested_minor integer not null check(amount_requested_minor >= 0), currency text not null default 'USD' check(currency='USD'),
 category text not null check(category in ('flight','hotel','train','bus','other')), origin_location text not null,
 submitted_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','approved','flagged','needs_review','rejected')), latest_run_id uuid
);
create table public.receipts (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null unique references public.submissions(id),
 storage_path text not null, file_type text not null, raw_extracted_text text, parsed_fields_json jsonb,
 extraction_status text not null default 'pending' check(extraction_status in ('pending','succeeded','failed')), extraction_error text, extracted_at timestamptz
);
create table public.policy_rules (
 id uuid primary key default gen_random_uuid(), category text not null check(category in ('flight','hotel','train','bus','other')),
 region_or_route text not null default '*' check(region_or_route='*'), currency text not null default 'USD' check(currency='USD'),
 max_amount_minor integer not null check(max_amount_minor >= 0), date_range_start date not null, date_range_end date not null,
 created_at timestamptz not null default now(), check(date_range_start <= date_range_end)
);
create table public.reconciliation_runs (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.submissions(id),
 status text not null default 'running' check(status in ('running','completed','failed')), started_at timestamptz not null default now(), completed_at timestamptz, error text,
 unique(id, submission_id)
);
create unique index one_active_run_per_submission on public.reconciliation_runs(submission_id) where status='running';
alter table public.submissions add constraint latest_run_same_submission foreign key(latest_run_id,id) references public.reconciliation_runs(id,submission_id);
create table public.decisions (
 id uuid primary key default gen_random_uuid(), run_id uuid not null, submission_id uuid not null references public.submissions(id),
 field_checked text not null, check_method text not null check(check_method in ('deterministic','jev','human')),
 question_type text not null check(question_type in ('boolean','choice','score','rule')), answer_json jsonb not null check(jsonb_typeof(answer_json)='object' and answer_json ? 'value'),
 probability double precision check(probability between 0 and 1), confidence_score double precision check(confidence_score between 0 and 1),
 verdict text not null check(verdict in ('pass','fail','unknown')), rationale_text text not null, evidence_json jsonb not null default '{}', state_snapshot_json jsonb not null default '{}', model_used text, created_at timestamptz not null default now(),
 foreign key(run_id,submission_id) references public.reconciliation_runs(id,submission_id)
);
create index decisions_run on public.decisions(run_id,created_at);
create table public.corrections (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.submissions(id), decision_id uuid references public.decisions(id),
 human_verdict text not null check(human_verdict in ('approved','rejected')), human_note text not null check(length(trim(human_note)) between 1 and 2000),
 correction_type text not null check(correction_type in ('decision_override','vendor_alias')), correction_payload_json jsonb not null default '{}' check(jsonb_typeof(correction_payload_json)='object'), corrected_at timestamptz not null default now()
);
create table public.model_calls (
 id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id), receipt_id uuid references public.receipts(id),
 provider text not null, model text not null, input_tokens integer check(input_tokens>=0), output_tokens integer check(output_tokens>=0), latency_ms integer not null check(latency_ms>=0), estimated_cost_usd numeric check(estimated_cost_usd>=0), created_at timestamptz not null default now()
);
-- Enable RLS with no anon/authenticated policies. Never place the service key in browser code.
alter table public.submissions enable row level security;
alter table public.receipts enable row level security;
alter table public.policy_rules enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.decisions enable row level security;
alter table public.corrections enable row level security;
alter table public.model_calls enable row level security;
revoke all on public.submissions,public.receipts,public.policy_rules,public.reconciliation_runs,public.decisions,public.corrections,public.model_calls from anon,authenticated;
grant all on public.submissions,public.receipts,public.policy_rules,public.reconciliation_runs,public.decisions,public.corrections,public.model_calls to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('receipts','receipts',false,10485760,array['application/pdf','image/png','image/jpeg']) on conflict(id) do update set public=false;

create function public.core_begin_run(p_submission uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare v_run uuid;
begin
 perform 1 from submissions where id=p_submission for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 -- Recover crashed requests after a bounded lease; late completions fail the running check.
 update reconciliation_runs set status='failed',error='Run lease expired.',completed_at=now() where submission_id=p_submission and status='running' and started_at < now()-interval '5 minutes';
 if exists(select 1 from reconciliation_runs where submission_id=p_submission and status='running') then raise exception 'RUN_ACTIVE'; end if;
 insert into reconciliation_runs(submission_id) values(p_submission) returning id into v_run;
 return v_run;
end $$;
create function public.core_finish_run(p_run uuid,p_decisions jsonb,p_status text) returns void language plpgsql security definer set search_path=public as $$
declare v_submission uuid;
begin
 select submission_id into v_submission from reconciliation_runs where id=p_run;
 perform 1 from submissions where id=v_submission for update;
 if not exists(select 1 from reconciliation_runs where id=p_run and status='running') then raise exception 'STALE_RUN'; end if;
 if p_status not in ('approved','flagged','needs_review') or jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions)=0 then raise exception 'INVALID_DECISIONS'; end if;
 if not exists(select 1 from jsonb_array_elements(p_decisions) d where d->>'field_checked'='overall_status' and d->'answer_json'->>'value'=p_status) then raise exception 'INVALID_DECISIONS'; end if;
 if exists(select 1 from jsonb_array_elements(p_decisions) d where (d->>'run_id')::uuid is distinct from p_run or (d->>'submission_id')::uuid is distinct from v_submission or d->>'check_method'='human') then raise exception 'INVALID_DECISIONS'; end if;
 insert into decisions select * from jsonb_populate_recordset(null::decisions,p_decisions);
 update reconciliation_runs set status='completed',completed_at=now() where id=p_run;
 update submissions set latest_run_id=p_run,status=p_status,updated_at=now() where id=v_submission;
end $$;
create function public.core_fail_run(p_run uuid,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare v_submission uuid;
begin
 select submission_id into v_submission from reconciliation_runs where id=p_run;
 perform 1 from submissions where id=v_submission for update;
 update reconciliation_runs set status='failed',completed_at=now(),error=left(p_error,500) where id=p_run and status='running';
 if found then update submissions set status='needs_review',updated_at=now() where id=v_submission; end if;
end $$;
create function public.core_correct(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare s submissions; c uuid; r uuid; p jsonb; observed text; v_decision uuid;
begin
 select * into s from submissions where id=(p_input->>'submission_id')::uuid for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_input->>'human_verdict' not in ('approved','rejected') or p_input->>'correction_type' not in ('decision_override','vendor_alias') or coalesce(length(trim(p_input->>'human_note')),0) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
 v_decision := (p_input->>'decision_id')::uuid;
 if v_decision is not null and not exists(select 1 from decisions where id=v_decision and submission_id=s.id and run_id=s.latest_run_id) then raise exception 'STALE_DECISION'; end if;
 p := p_input->'correction_payload_json';
 if p_input->>'correction_type'='vendor_alias' then
   select parsed_fields_json->>'vendor' into observed from receipts where submission_id=s.id;
   if p->'scope'->>'category' is distinct from s.category or p->'scope'->>'currency' is distinct from s.currency or observed is null or lower(regexp_replace(trim(p->>'observed_vendor'),'\s+',' ','g')) is distinct from lower(regexp_replace(trim(observed),'\s+',' ','g')) or coalesce(length(trim(p->>'canonical_vendor')),0) not between 1 and 200 or coalesce(length(trim(p->>'observed_vendor')),0) not between 1 and 200 then raise exception 'INVALID_SCOPE'; end if;
 elsif p is distinct from '{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 update reconciliation_runs set status='failed',completed_at=now(),error='Superseded by human correction.' where submission_id=s.id and status='running';
 insert into corrections(submission_id,decision_id,human_verdict,human_note,correction_type,correction_payload_json) values(s.id,v_decision,p_input->>'human_verdict',p_input->>'human_note',p_input->>'correction_type',p) returning id into c;
 r:=s.latest_run_id;
 if r is null then insert into reconciliation_runs(submission_id,status,completed_at) values(s.id,'completed',now()) returning id into r; end if;
 insert into decisions(run_id,submission_id,field_checked,check_method,question_type,answer_json,verdict,rationale_text,evidence_json,state_snapshot_json)
 values(r,s.id,'overall_status','human','rule',jsonb_build_object('value',p_input->>'human_verdict'),case when p_input->>'human_verdict'='approved' then 'pass' else 'fail' end,p_input->>'human_note',jsonb_build_object('correction_id',c,'correction_type',p_input->>'correction_type','one_time_override',true),jsonb_build_object('submission',to_jsonb(s)));
 update submissions set status=p_input->>'human_verdict',latest_run_id=r,updated_at=now() where id=s.id;
 return jsonb_build_object('correction_id',c,'status',p_input->>'human_verdict');
end $$;
create function public.core_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'submissions',coalesce((select jsonb_agg(s order by submitted_at,id) from submissions s),'[]'),
 'receipts',coalesce((select jsonb_agg(r) from receipts r),'[]'),
 'policies',coalesce((select jsonb_agg(p) from policy_rules p),'[]'),
 'decisions',coalesce((select jsonb_agg(d order by created_at,id) from decisions d),'[]'),
 'corrections',coalesce((select jsonb_agg(c order by corrected_at,id) from corrections c),'[]'),
 'runs',coalesce((select jsonb_agg(r) from reconciliation_runs r),'[]'));
$$;
revoke all on function public.core_begin_run(uuid),public.core_finish_run(uuid,jsonb,text),public.core_fail_run(uuid,text),public.core_correct(jsonb),public.core_snapshot() from public,anon,authenticated;
grant execute on function public.core_begin_run(uuid),public.core_finish_run(uuid,jsonb,text),public.core_fail_run(uuid,text),public.core_correct(jsonb),public.core_snapshot() to service_role;
