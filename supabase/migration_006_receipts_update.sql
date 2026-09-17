-- migration 006 — receipts: staff update
--
-- Why: a photo can be filed under a mistyped invoice block (transposed SI#
-- digits, wrong date, wrong supplier). The ledger popover now offers
-- "Use this photo for this invoice", which re-keys the receipt row in place
-- instead of making the user delete the photo and upload it again.
-- Postgres RLS needs an explicit UPDATE policy for that; 005 only granted
-- select / insert / delete.

alter table public.receipts enable row level security;

drop policy if exists "receipts: staff update" on public.receipts;
create policy "receipts: staff update"
  on public.receipts for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
