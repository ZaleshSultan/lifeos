-- Atomically reconcile a draft bank transaction with a receipt.
--
-- OCR can already have created a receipt_import transaction before the user
-- chooses a bank line.  Cancelling that transaction in the same transaction
-- prevents the bank line from becoming a second counted expense.

create or replace function public.reconcile_bank_receipt(
  p_user_id uuid,
  p_bank_transaction_id uuid,
  p_receipt_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bank public.finance_transactions;
  v_receipt public.finance_receipts;
  v_receipt_transaction public.finance_transactions;
begin
  -- Every caller locks the bank line first, then the receipt.  This gives
  -- concurrent attempts a deterministic lock order.
  select *
    into v_bank
    from public.finance_transactions
   where id = p_bank_transaction_id
     and user_id = p_user_id
     and status = 'draft'
     and receipt_id is null
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'bank_transaction_unavailable';
  end if;

  select *
    into v_receipt
    from public.finance_receipts
   where id = p_receipt_id
     and user_id = p_user_id
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'receipt_unavailable';
  end if;

  if v_receipt.transaction_id is not null then
    select *
      into v_receipt_transaction
      from public.finance_transactions
     where id = v_receipt.transaction_id
       and user_id = p_user_id
     for update;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'receipt_transaction_unavailable';
    end if;

    if v_receipt_transaction.source is distinct from 'receipt_import'
       or v_receipt_transaction.receipt_id is distinct from v_receipt.id then
      raise exception using
        errcode = 'P0001',
        message = 'receipt_already_linked';
    end if;

    -- A receipt_import row is an intermediate OCR representation.  Keep it
    -- for audit, but remove it from confirmed totals before linking the bank
    -- transaction.
    if v_receipt_transaction.status <> 'cancelled' then
      update public.finance_transactions
         set status = 'cancelled',
             cancelled_at = now(),
             updated_at = now()
       where id = v_receipt_transaction.id;
    end if;
  end if;

  if exists (
    select 1
      from public.finance_transactions t
     where t.user_id = p_user_id
       and t.receipt_id = v_receipt.id
       and t.id <> coalesce(v_receipt.transaction_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and t.status <> 'cancelled'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'receipt_already_linked';
  end if;

  update public.finance_transactions
     set status = 'confirmed',
         receipt_id = v_receipt.id,
         confirmed_at = now(),
         cancelled_at = null,
         updated_at = now()
   where id = v_bank.id;

  update public.finance_receipts
     set transaction_id = v_bank.id,
         status = 'linked',
         error_message = null,
         processed_at = coalesce(processed_at, now()),
         updated_at = now()
   where id = v_receipt.id;
end;
$$;

revoke all on function public.reconcile_bank_receipt(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_bank_receipt(uuid, uuid, uuid)
  to service_role;

comment on function public.reconcile_bank_receipt(uuid, uuid, uuid) is
  'Atomically links one user-owned draft bank transaction to a receipt and cancels its OCR receipt_import transaction.';
