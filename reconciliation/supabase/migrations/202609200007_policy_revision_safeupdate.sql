-- Policy reseeding during demo reset must respect Supabase's safeupdate guard.
-- Preserve the shared lock and knowledge invalidation; target the singleton row explicitly.
do $$ begin if core_platform_version() <> 4 then raise exception 'Expected platform version 4'; end if; end $$;
create or replace function public.core_policy_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform core_lock();update platform_state set knowledge_revision=knowledge_revision+1 where id = true;
 return null;
end $$;
