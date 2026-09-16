-- ============================================================================
-- MIGRATION 005 — Receipt photos
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Adds receipt photo support:
--   * a PRIVATE storage bucket `receipts` (photos are financial documents —
--     they are only reachable through short-lived signed URLs)
--   * a `receipts` table: one row per sales invoice photo, keyed to the same
--     invoice block the ledger uses (purchase_date + si_no + supplier_id, so
--     blank-SI "same receipt as above" blocks file one photo too)
--   * policies: all staff can view; owner/encoder can add/delete
--
-- IDEMPOTENT: safe to run again (IF NOT EXISTS, policies dropped first,
-- bucket insert is ON CONFLICT DO NOTHING).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage bucket (private — access only via signed URLs)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "receipts bucket: staff read" on storage.objects;
create policy "receipts bucket: staff read"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.my_role() is not null);

drop policy if exists "receipts bucket: staff upload" on storage.objects;
create policy "receipts bucket: staff upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.my_role() in ('owner', 'encoder'));

drop policy if exists "receipts bucket: staff delete" on storage.objects;
create policy "receipts bucket: staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.my_role() in ('owner', 'encoder'));

-- ---------------------------------------------------------------------------
-- receipts table — one photo per invoice block
-- ---------------------------------------------------------------------------

create table if not exists public.receipts (
  id            bigint generated always as identity primary key,
  purchase_date date not null,
  si_no         text not null default '',          -- same format as purchases.si_no ("SI# 123" or '')
  supplier_id   bigint references public.suppliers(id) on delete set null,
  storage_path  text not null,                     -- path inside the receipts bucket
  file_name     text not null default '',          -- original upload name (IMG_1234.jpg)
  mime_type     text not null default 'image/jpeg',
  file_size     bigint not null default 0,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- One photo per invoice block. coalesce() so blocks whose supplier was later
-- deleted (supplier_id -> NULL) still collide correctly.
create unique index if not exists receipts_block_uq
  on public.receipts (purchase_date, si_no, coalesce(supplier_id, 0));
create index if not exists receipts_block_lookup
  on public.receipts (purchase_date, si_no);

alter table public.receipts enable row level security;

drop policy if exists "receipts: authenticated read" on public.receipts;
create policy "receipts: authenticated read"
  on public.receipts for select to authenticated using (true);
drop policy if exists "receipts: staff insert" on public.receipts;
create policy "receipts: staff insert"
  on public.receipts for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "receipts: staff delete" on public.receipts;
create policy "receipts: staff delete"
  on public.receipts for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));
