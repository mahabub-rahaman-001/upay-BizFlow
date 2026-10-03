-- 8.5  AI output review and wrong-mark feedback (upay_admin only).
-- Read stored AI outputs with their payloads/facts, and allow admins to mark an output wrong.
-- Closes the feedback loop with the 'wrong_feedback' metric in the admin Health panel.
-- All mutations are append-only safe, audited via admin_audit_events, and idempotent.

-- 1. Update trigger on ai_outputs to allow updating feedback columns while
--    keeping all content columns strictly append-only (immutable).
create or replace function public.block_ai_outputs_mutation() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.';
  end if;

  if TG_OP = 'UPDATE' then
    if old.id = new.id
       and old.business_id = new.business_id
       and old.capability = new.capability
       and old.what_en is not distinct from new.what_en
       and old.what_bn is not distinct from new.what_bn
       and old.why_en is not distinct from new.why_en
       and old.why_bn is not distinct from new.why_bn
       and old.action_en is not distinct from new.action_en
       and old.action_bn is not distinct from new.action_bn
       and old.confidence is not distinct from new.confidence
       and old.payload is not distinct from new.payload
       and old.model_version is not distinct from new.model_version
       and old.feature_version is not distinct from new.feature_version
       and old.prompt_version is not distinct from new.prompt_version
       and old.input_hash is not distinct from new.input_hash
       and old.latency_ms is not distinct from new.latency_ms
       and old.created_at = new.created_at
    then
      return new;
    end if;

    raise exception 'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.';
  end if;

  return null;
end $$;

drop trigger if exists trg_ai_outputs_append_only on public.ai_outputs;
create trigger trg_ai_outputs_append_only
  before update or delete on public.ai_outputs
  for each row execute function public.block_ai_outputs_mutation();


-- 2. Read-only RPC for recent AI outputs with business name and payload/facts
create or replace function public.admin_ai_outputs(p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role  text;
  v_limit int;
begin
  v_role := private.admin_role('upay_admin');
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  return coalesce((
    select jsonb_agg(row_to_json(r))
    from (
      select
        o.id,
        o.business_id,
        b.name as business_name,
        o.capability,
        o.what_en,
        o.what_bn,
        o.why_en,
        o.why_bn,
        o.action_en,
        o.action_bn,
        o.confidence,
        o.payload,
        o.model_version,
        o.feedback,
        o.feedback_at,
        o.created_at
      from public.ai_outputs o
      join public.businesses b on b.id = o.business_id
      order by o.created_at desc
      limit v_limit
    ) r
  ), '[]'::jsonb);
end $$;

revoke all on function public.admin_ai_outputs(int) from public, anon, authenticated;
grant execute on function public.admin_ai_outputs(int) to authenticated;


-- 3. Extend admin_command to support 'mark_ai_wrong' action
create or replace function public.admin_command(p_action text, p_body jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_result jsonb; v_prior public.admin_request_results;
  v_case public.support_cases; v_flag public.feature_flags; v_request public.admin_flag_requests;
  v_id uuid; v_reason text := btrim(p_body->>'reason');
begin
  v_role := private.admin_role();
  if p_request_id is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into v_prior from public.admin_request_results where actor = auth.uid() and request_id = p_request_id;
  if found then
    if v_prior.request_body <> jsonb_build_object('action',p_action,'body',p_body) then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023'; end if;
    return v_prior.result;
  end if;
  if coalesce(length(v_reason),0) < 3 or length(v_reason) > 240 then
    raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

  if p_action in ('grant','resolve') then
    select * into v_case from public.support_cases where id = (p_body->>'case_id')::uuid for update;
    if v_case.id is null or (v_role <> 'upay_admin' and v_case.assigned_to <> auth.uid()) then
      raise exception 'CASE_ACCESS_DENIED' using errcode = '42501'; end if;
    if v_case.status <> 'open' then raise exception 'CASE_CLOSED' using errcode = '22023'; end if;
    if p_action = 'grant' then
      insert into public.admin_access_grants(case_id,business_id,actor,reason)
        values(v_case.id,v_case.business_id,auth.uid(),v_reason) returning id into v_id;
      insert into public.access_log(business_id,case_id,actor,reason,action)
        values(v_case.business_id,v_case.id,auth.uid(),v_reason,'grant.created');
      v_result := jsonb_build_object('id',v_id,'expires_at',now()+interval '60 minutes');
    else
      update public.support_cases set status = 'resolved', resolved_at = now() where id = v_case.id;
      v_result := jsonb_build_object('id',v_case.id,'status','resolved');
    end if;

  elsif p_action = 'propose_flag' then
    perform private.admin_role('upay_admin');
    if p_body->>'key' not in ('ai.forecast','ai.assistant') or jsonb_typeof(p_body->'enabled') <> 'boolean' then
      raise exception 'FLAG_INVALID' using errcode = '22023'; end if;
    insert into public.feature_flags(key,business_id,enabled)
      values(p_body->>'key',nullif(p_body->>'business_id','')::uuid,true)
      on conflict (key,business_id) do nothing;
    select * into v_flag from public.feature_flags where key = p_body->>'key'
      and business_id is not distinct from nullif(p_body->>'business_id','')::uuid for update;
    if v_flag.business_id is null then
      insert into public.admin_flag_requests(flag_id,enabled,reason,proposed_by)
        values(v_flag.id,(p_body->>'enabled')::boolean,v_reason,auth.uid()) returning id into v_id;
      v_result := jsonb_build_object('id',v_id,'pending',true);
    else
      update public.feature_flags set enabled = (p_body->>'enabled')::boolean, updated_at = now() where id = v_flag.id;
      v_result := jsonb_build_object('id',v_flag.id,'pending',false);
    end if;

  elsif p_action = 'approve_flag' then
    perform private.admin_role('upay_admin');
    select * into v_request from public.admin_flag_requests where id = (p_body->>'id')::uuid for update;
    if v_request.id is null or v_request.proposed_by = auth.uid() or v_request.approved_at is not null then
      raise exception 'SECOND_ADMIN_REQUIRED' using errcode = '42501'; end if;
    update public.feature_flags set enabled = v_request.enabled, updated_at = now() where id = v_request.flag_id;
    update public.admin_flag_requests set approved_by = auth.uid(), approved_at = now() where id = v_request.id;
    v_result := jsonb_build_object('id',v_request.id,'pending',false);

  elsif p_action = 'mark_ai_wrong' then
    perform private.admin_role('upay_admin');
    v_id := nullif(p_body->>'output_id','')::uuid;
    if v_id is null then
      raise exception 'OUTPUT_ID_REQUIRED' using errcode = '22023';
    end if;
    update public.ai_outputs
       set feedback = 'wrong',
           feedback_at = now(),
           feedback_user_id = auth.uid()
     where id = v_id;
    if not found then
      raise exception 'AI_OUTPUT_NOT_FOUND' using errcode = '22023';
    end if;
    v_result := jsonb_build_object('id', v_id, 'feedback', 'wrong');

  else raise exception 'ACTION_INVALID' using errcode = '22023'; end if;

  insert into public.admin_audit_events(actor,action,reason,detail) values(auth.uid(),p_action,v_reason,p_body);
  insert into public.admin_request_results values(auth.uid(),p_request_id,jsonb_build_object('action',p_action,'body',p_body),v_result);
  return v_result;
end $$;

revoke all on function public.admin_command(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_command(text, jsonb, uuid) to authenticated;
