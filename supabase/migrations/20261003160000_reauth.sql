-- Phase D (docs/09 section 9): re-authentication for sensitive actions.
--
-- docs/07 section 2 calls for a short-lived reauth proof before refund, reopen and
-- correction. Rather than change the signatures of the money RPCs (which would ripple
-- through callers and the role-guard injection), reauth is a server-side 5-minute window
-- per user: the client confirms with the device (biometric/PIN) and calls request_reauth,
-- which opens the window; the sensitive RPCs then require the window to be open via an
-- injected _assert_reauth, and nothing about their arguments changes.
--
-- The window is the record docs/09 R1 asks for: who re-authenticated and when.

create table reauth_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table reauth_sessions enable row level security;
create policy reauth_self on reauth_sessions for select using (user_id = auth.uid());

-- Opens a 5-minute reauth window for the caller. The client calls this straight after the
-- device confirms the user (expo-local-authentication), so the window means "this person
-- just proved themselves on this device".
create or replace function request_reauth()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_until timestamptz := now() + interval '5 minutes';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED: no session' using errcode = '42501';
  end if;

  insert into reauth_sessions (user_id, valid_until, created_at)
  values (v_uid, v_until, now())
  on conflict (user_id) do update set valid_until = excluded.valid_until, created_at = now();

  return jsonb_build_object('valid_until', v_until);
end $$;

-- Raised inside a sensitive RPC when the caller has no open reauth window.
create or replace function _assert_reauth()
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from reauth_sessions
     where user_id = auth.uid() and valid_until > now()
  ) then
    raise exception 'REAUTH_REQUIRED: confirm it is you before this action'
      using errcode = '42501';
  end if;
end $$;

revoke execute on function _assert_reauth() from public, anon;
revoke execute on function request_reauth() from public, anon;
grant execute on function request_reauth() to authenticated;

-- Inject the reauth gate into the sensitive RPCs, right after their opening begin, by
-- rewriting each from its current definition (the same technique the role-guard migration
-- uses). Their signatures and bodies are otherwise untouched.
do $$
declare r record; v_def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array['reverse_transaction','post_refund','reopen_closing'])
  loop
    v_def := pg_get_functiondef(r.oid);
    -- Add the check once, after the first begin, unless it is already there.
    if position('_assert_reauth()' in v_def) = 0 then
      v_def := regexp_replace(v_def, '\mbegin\M',
        'begin' || chr(10) || '  perform public._assert_reauth();', 'i');
      execute v_def;
    end if;
  end loop;
end $$;
