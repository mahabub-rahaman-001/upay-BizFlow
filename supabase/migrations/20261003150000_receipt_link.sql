-- Phase B2 (docs/14 role features): share a receipt.
--
-- get_receipt_link(business_id, transaction_id) returns the public receipt token for one of
-- the business's own transactions, so the owner can share the /r/{token} page with a
-- customer. Member-scoped; returns null when the transaction has no receipt (only QR
-- payments get one). This is shared by both roles - a receipt is a receipt.

create or replace function get_receipt_link(
  p_business_id uuid,
  p_transaction_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_token text;
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  select r.token into v_token
    from receipts r
   where r.business_id = p_business_id and r.transaction_id = p_transaction_id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'token', v_token,
    'has_receipt', v_token is not null);
end $$;

revoke execute on function get_receipt_link(uuid, uuid) from public;
grant execute on function get_receipt_link(uuid, uuid) to authenticated;
