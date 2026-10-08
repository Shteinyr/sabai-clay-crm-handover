create index if not exists memberships_purchase_payment_id_idx
  on public.memberships (purchase_payment_id)
  where purchase_payment_id is not null;

revoke execute on function public.capture_app_state_history() from public, anon, authenticated;
revoke execute on function public.capture_entity_audit() from public, anon, authenticated;
