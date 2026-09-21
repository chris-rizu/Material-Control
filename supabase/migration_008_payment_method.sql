-- ============================================================================
-- MIGRATION 008 — How a payment was made (pricing page payment methods)
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- The pricing page (material-control-plans.vercel.app) now lets the client
-- pay by InstaPay QR, GCash, bank transfer, or cash in person. This adds
-- plan_payments.method so the owner's verify page knows where to check each
-- payment (GoTyme app, GCash, or the cash receipt book).
--
-- Until this runs, the page still works: it writes the method into
-- reference_no as a "[gcash] " / "[cash] " prefix. This migration moves those
-- prefixes into the new column and strips them from the reference.
--
-- Every payment made before methods existed was by InstaPay QR, so existing
-- rows default to 'qr'.
--
-- IDEMPOTENT: safe to run again.
-- ============================================================================

alter table public.plan_payments
  add column if not exists method text not null default 'qr';

alter table public.plan_payments drop constraint if exists plan_payments_method_check;
alter table public.plan_payments
  add constraint plan_payments_method_check check (method in ('qr', 'gcash', 'bank', 'cash'));

-- rows sent while the column didn't exist yet carry the method as a prefix
update public.plan_payments
   set method       = substring(reference_no from '^\[(qr|gcash|bank|cash)\]'),
       reference_no = btrim(regexp_replace(reference_no, '^\[(qr|gcash|bank|cash)\]\s*', ''))
 where reference_no ~ '^\[(qr|gcash|bank|cash)\]';

-- let the API see the new column right away
notify pgrst, 'reload schema';
