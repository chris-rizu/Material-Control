-- ============================================================================
-- MIGRATION 007 — Plan payments (proof of payment from the plans page)
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- The public plans page (lookup site /plans.html) lets a client pick a plan,
-- pay through the InstaPay QR, and upload the payment screenshot. The owner
-- then checks it on /verify.html and marks it verified or rejected.
--
--   * a PRIVATE storage bucket `payment-proofs` — anyone may UPLOAD a proof
--     (the client has no account), nobody but the owner can READ or delete
--   * a `plan_payments` table — anyone may INSERT a pending submission,
--     only the owner can see or review them
--   * plan_payment_status(id) — lets the client check their OWN submission
--     by its unguessable id (returns status only, never other people's rows)
--
-- IDEMPOTENT: safe to run again.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage bucket (private — the owner views proofs through signed URLs)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- uploads: one file per submission, at "<submission uuid>/proof.<ext>".
-- No UPDATE policy, so an upload can never overwrite an existing proof.
drop policy if exists "payment proofs: anyone uploads" on storage.objects;
create policy "payment proofs: anyone uploads"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'payment-proofs'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/proof\.(jpg|png|webp|pdf)$'
  );

drop policy if exists "payment proofs: owner reads" on storage.objects;
create policy "payment proofs: owner reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.my_role() = 'owner');

drop policy if exists "payment proofs: owner deletes" on storage.objects;
create policy "payment proofs: owner deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.my_role() = 'owner');

-- ---------------------------------------------------------------------------
-- plan_payments table
-- ---------------------------------------------------------------------------

create table if not exists public.plan_payments (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  plan          text not null check (plan in ('A', 'B', 'C')),
  installment   text not null check (char_length(installment) between 1 and 40),
  amount        numeric(12,2) not null check (amount > 0 and amount <= 100000),
  payer_name    text not null check (char_length(btrim(payer_name)) between 1 and 120),
  payer_contact text not null default '' check (char_length(payer_contact) <= 120),
  reference_no  text not null default '' check (char_length(reference_no) <= 60),
  proof_path    text not null,
  status        text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  review_note   text not null default '' check (char_length(review_note) <= 300),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id) on delete set null
);

create index if not exists plan_payments_created on public.plan_payments (created_at desc);

alter table public.plan_payments enable row level security;

grant insert on public.plan_payments to anon, authenticated;
grant select, update on public.plan_payments to authenticated;

-- a submission always starts pending and unreviewed, and its proof must sit
-- in the folder named after its own id
drop policy if exists "plan payments: anyone submits" on public.plan_payments;
create policy "plan payments: anyone submits"
  on public.plan_payments for insert to anon, authenticated
  with check (
    status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and review_note = ''
    and proof_path ~ ('^' || id::text || '/proof\.(jpg|png|webp|pdf)$')
  );

drop policy if exists "plan payments: owner reads" on public.plan_payments;
create policy "plan payments: owner reads"
  on public.plan_payments for select to authenticated
  using (public.my_role() = 'owner');

drop policy if exists "plan payments: owner reviews" on public.plan_payments;
create policy "plan payments: owner reviews"
  on public.plan_payments for update to authenticated
  using (public.my_role() = 'owner')
  with check (public.my_role() = 'owner');

-- ---------------------------------------------------------------------------
-- status lookup for the client (by the id their browser kept after upload)
-- ---------------------------------------------------------------------------

create or replace function public.plan_payment_status(p_id uuid)
returns table (status text, plan text, installment text, amount numeric,
               created_at timestamptz, review_note text)
language sql
stable
security definer
set search_path = public
as $$
  select status, plan, installment, amount, created_at, review_note
  from public.plan_payments
  where id = p_id;
$$;

revoke all on function public.plan_payment_status(uuid) from public;
grant execute on function public.plan_payment_status(uuid) to anon, authenticated;
