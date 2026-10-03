-- Phase A2 (docs/14 role features): agent per-wallet breakdown.
--
-- An agent serves customers on wallets other than upay (bKash, Nagad, ...), recorded by
-- hand through post_manual_wallet, which stamps the wallet name on the transaction. This
-- rolls those up per wallet so the agent sees how much moved through each, and over how
-- many entries. Agent-only, owner/manager-only, from the ledger.

create or replace function wallet_breakdown(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_type business_type;
  v_result jsonb;
begin
  if not has_role(p_business_id, array['agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: wallet breakdown is owner and manager only'
      using errcode = '42501';
  end if;

  select type into v_type from businesses where id = p_business_id;
  if v_type <> 'AGENT' then
    raise exception 'ROLE_NOT_PERMITTED: wrong business type' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'wallet', wallet,
           'total_minor', total_minor,
           'count', cnt) order by total_minor desc), '[]'::jsonb)
    into v_result
    from (
      select coalesce(nullif(btrim(t.wallet), ''), 'other') as wallet,
             sum(t.amount_minor)::bigint as total_minor,
             count(*)::int as cnt
        from transactions t
       where t.business_id = p_business_id
         and t.kind = 'MANUAL_WALLET'
         and not exists (select 1 from transactions r where r.reverses_txn_id = t.id)
       group by 1
    ) w;

  return jsonb_build_object('business_id', p_business_id, 'wallets', v_result);
end $$;

revoke execute on function wallet_breakdown(uuid) from public;
grant execute on function wallet_breakdown(uuid) to authenticated;
