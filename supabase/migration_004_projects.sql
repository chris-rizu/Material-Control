-- ============================================================================
-- MIGRATION 004 — Projects catalog
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Adds the `projects` table that backs the Particulars tab's Projects card and
-- the predictive Project box on the Purchases entry row. `purchases.project_name`
-- stays free text (existing rows untouched) — this table is only the catalog.
--
-- IDEMPOTENT: safe to run again (IF NOT EXISTS, policies dropped first,
-- seed uses ON CONFLICT DO NOTHING).
-- ============================================================================

create table if not exists public.projects (
  id         bigint generated always as identity primary key,
  name       text not null,
  -- same normalization as suppliers.name_norm (IMMUTABLE expressions only)
  name_norm  text generated always as (upper(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  created_at timestamptz not null default now()
);

create unique index if not exists projects_name_uq on public.projects (name);
create unique index if not exists projects_norm_uq on public.projects (name_norm);

alter table public.projects enable row level security;

drop policy if exists "projects: authenticated read" on public.projects;
create policy "projects: authenticated read"
  on public.projects for select to authenticated using (true);
drop policy if exists "projects: staff insert" on public.projects;
create policy "projects: staff insert"
  on public.projects for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "projects: staff update" on public.projects;
create policy "projects: staff update"
  on public.projects for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "projects: staff delete" on public.projects;
create policy "projects: staff delete"
  on public.projects for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));

-- Seed with the projects already in the ledger (" mcdo" and "MCDO" collapse
-- onto one row via the name_norm unique index; first casing wins).
insert into public.projects (name)
  select distinct regexp_replace(trim(project_name), '\s+', ' ', 'g')
  from public.purchases
  where btrim(coalesce(project_name, '')) <> ''
on conflict do nothing;
