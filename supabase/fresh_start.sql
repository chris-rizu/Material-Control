-- fresh_start.sql — wipe ALL ledger/catalog data so the client starts encoding
-- their own data from zero.
--
-- HOW TO RUN — two steps:
--   1. Supabase dashboard → SQL Editor → paste this whole file → Run.
--   2. Supabase dashboard → Storage → open the `receipts` bucket →
--      select all files → Delete (the SQL below is not allowed to touch
--      Storage directly — Supabase blocks it to prevent accidents).
--   Run ONCE, before the client starts encoding (not undoable).
--
-- WIPED (rows + ID counters back to 1):
--   purchases, receipts, material_aliases, materials, categories,
--   suppliers, projects, import_batches, activity_log
--   (+ the photo FILES in the receipts bucket, step 2 above)
--
-- KEPT (untouched):
--   profiles + auth users  — everyone keeps signing in as before
--   plan_payments          — the developer's billing records
--   all tables/policies/triggers — schema unchanged, nothing to re-run
--
-- The catalogs refill themselves: first entries re-create suppliers,
-- categories and materials automatically (predictive encoding).
-- Historical source of the old data stays on file: PURCHASES (1).xlsx.

begin;

truncate table
  public.purchases,
  public.receipts,
  public.material_aliases,
  public.materials,
  public.categories,
  public.suppliers,
  public.projects,
  public.import_batches,
  public.activity_log
restart identity;

commit;

-- expected: every wiped table 0,
--           profiles and plan_payments UNCHANGED (same numbers as before)
select 'purchases' as t, count(*) from public.purchases
union all select 'receipts', count(*) from public.receipts
union all select 'material_aliases', count(*) from public.material_aliases
union all select 'materials', count(*) from public.materials
union all select 'categories', count(*) from public.categories
union all select 'suppliers', count(*) from public.suppliers
union all select 'projects', count(*) from public.projects
union all select 'import_batches', count(*) from public.import_batches
union all select 'activity_log', count(*) from public.activity_log
union all select 'profiles (kept)', count(*) from public.profiles
union all select 'plan_payments (kept)', count(*) from public.plan_payments;
