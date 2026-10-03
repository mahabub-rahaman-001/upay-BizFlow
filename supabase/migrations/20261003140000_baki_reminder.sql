-- Phase B1 (docs/14 role features): baki reminder draft.
--
-- baki_reminder_draft(business_id, customer_id) returns a pre-filled, polite reminder in
-- Bangla and English for a customer who owes money, with the amount from the ledger and the
-- shop's upay reference to pay into. It never sends anything: the owner reads the draft and
-- shares it themselves (docs/03 M5). A reminder may only be drafted for a customer who
-- agreed to be contacted (consent_to_contact), per docs/09.
--
-- Merchant-only and owner/manager-only.

create or replace function baki_reminder_draft(
  p_business_id uuid,
  p_customer_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_type business_type;
  v_shop text;
  v_ref text;
  v_cust customers;
  v_balance bigint;
  v_tk text;
begin
  if not has_role(p_business_id, array['merchant_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: reminders are owner and manager only'
      using errcode = '42501';
  end if;

  select type, name, upay_account_ref into v_type, v_shop, v_ref
    from businesses where id = p_business_id;
  if v_type <> 'MERCHANT' then
    raise exception 'ROLE_NOT_PERMITTED: wrong business type' using errcode = '42501';
  end if;

  select * into v_cust from customers
   where id = p_customer_id and business_id = p_business_id;
  if v_cust.id is null then
    raise exception 'CUSTOMER_NOT_FOUND: no such customer in this business'
      using errcode = 'P0002';
  end if;

  if not v_cust.consent_to_contact then
    raise exception 'NO_CONSENT: this customer has not agreed to reminders'
      using errcode = '22023';
  end if;

  select balance_minor into v_balance
    from customer_balances(p_business_id) where customer_id = p_customer_id;
  v_balance := coalesce(v_balance, 0);

  if v_balance <= 0 then
    raise exception 'NO_BAKI_DUE: this customer owes nothing' using errcode = '22023';
  end if;

  v_tk := poisha_to_tk(v_balance);

  return jsonb_build_object(
    'customer_name', v_cust.name,
    'phone', v_cust.phone,
    'balance_minor', v_balance,
    'pay_ref', v_ref,
    -- Numbers come from the ledger; the text only wraps them. Polite, not a demand.
    'message_bn', format(
      '%s, আসসালামু আলাইকুম। %s থেকে আপনার কাছে বাকি আছে %s। সুবিধামতো পরিশোধ করলে ভালো হয়। upay-তে পরিশোধ: %s। ধন্যবাদ।',
      v_cust.name, v_shop, v_tk, coalesce(v_ref, v_shop)),
    'message_en', format(
      'Dear %s, you have an outstanding balance of %s at %s. Please pay when convenient. Pay via upay: %s. Thank you.',
      v_cust.name, v_tk, v_shop, coalesce(v_ref, v_shop))
  );
end $$;

revoke execute on function baki_reminder_draft(uuid, uuid) from public;
grant execute on function baki_reminder_draft(uuid, uuid) to authenticated;
