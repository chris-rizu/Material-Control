-- ============================================================================
-- MATERIAL CONTROL SYSTEM — Supabase schema
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- IDEMPOTENT: safe to run again after any partial failure (tables/indexes are
-- IF NOT EXISTS, functions/views are CREATE OR REPLACE, policies/triggers are
-- dropped first). Seeds 10 categories + the suppliers already present in your
-- PURCHASES spreadsheet.
--
-- NOTES ON THE TRICKY PARTS (do not "simplify"):
--   * my_role() is defined AFTER the profiles table — Postgres validates
--     LANGUAGE SQL function bodies at creation time.
--   * materials.search_name uses || concatenation inside norm_text() —
--     concat_ws() is only STABLE and generated columns require IMMUTABLE.
--   * `amount` is receipt truth (overridable; trigger-defaulted) while
--     `amount_recomputed` is the generated arithmetic twin used for audits.
-- ============================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Normalize free text: uppercase, collapse whitespace (aliases/search keys).
-- IMMUTABLE on purpose: it is used inside a generated column.
create or replace function public.norm_text(t text)
returns text language sql immutable as $$
  select upper(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one row per auth user; role drives permissions)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  full_name  text not null default '',
  role       text not null default 'encoder' check (role in ('owner', 'encoder', 'viewer')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Role of the current user ('owner' | 'encoder' | 'viewer').
-- SECURITY DEFINER so policies on profiles don't recurse. Defined AFTER the
-- table it reads (LANGUAGE SQL bodies are validated at creation time).
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles: authenticated read" on public.profiles;
create policy "profiles: authenticated read"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles: owner manages roles" on public.profiles;
create policy "profiles: owner manages roles"
  on public.profiles for update to authenticated
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

drop policy if exists "profiles: user edits own name" on public.profiles;
create policy "profiles: user edits own name"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = public.my_role());

-- Auto-create a profile on signup. The FIRST user to sign up becomes 'owner'.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when (select count(*) from public.profiles) = 0 then 'owner' else 'encoder' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Categories (encode per category; each defines its own attribute form)
-- attribute_template = JSON array of field defs:
--   {key, label, widget:"text"|"select", required?, predictive?, options?,
--    default?, placeholder?, show_if?{field, contains_any:[]}}
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id                 bigint generated always as identity primary key,
  name               text not null unique,
  unit               text not null default 'pc',
  sort               int  not null default 0,
  attribute_template jsonb not null default '[]',
  created_at         timestamptz not null default now()
);

alter table public.categories enable row level security;

drop policy if exists "categories: authenticated read" on public.categories;
create policy "categories: authenticated read"
  on public.categories for select to authenticated using (true);
drop policy if exists "categories: staff insert" on public.categories;
create policy "categories: staff insert"
  on public.categories for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "categories: staff update" on public.categories;
create policy "categories: staff update"
  on public.categories for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "categories: staff delete" on public.categories;
create policy "categories: staff delete"
  on public.categories for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));

-- ---------------------------------------------------------------------------
-- Materials (the structured catalog: brand / type / model / size / degrees)
-- degrees = 0 means "no angle" (field hidden for those products); numeric so
-- 22.5-degree elbows fit.
-- ---------------------------------------------------------------------------

create table if not exists public.materials (
  id           bigint generated always as identity primary key,
  category_id  bigint not null references public.categories(id),
  brand        text   not null default '',
  type         text   not null default '',
  model_ver    text   not null default '',
  size_native  text   not null default '',   -- exactly as printed: '6X10', '1/2', '10MM', '400CC'
  size_system  text   not null default 'english' check (size_system in ('english', 'metric', 'n/a')),
  size_metric  text   not null default '',   -- optional converted size for display
  diameter     text   not null default '',
  degrees      numeric(4,1) not null default 0,  -- 22.5 / 45 / 90 where applicable, else 0
  unit         text   not null default 'pc',
  -- || (not concat_ws — it is only STABLE and generated columns need IMMUTABLE)
  search_name  text   generated always as (
                 public.norm_text(
                   coalesce(brand, '') || ' ' || coalesce(type, '') || ' ' ||
                   coalesce(model_ver, '') || ' ' || coalesce(size_native, '')
                 )
               ) stored,
  reference_price numeric(12,2),              -- reserved: post-V1 "over unit price" flags
  usage_count  int not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (category_id, brand, type, model_ver, size_native, degrees),
  check (usage_count >= 0)
);

create index if not exists materials_search_trgm on public.materials using gin (search_name gin_trgm_ops);
create index if not exists materials_type_trgm   on public.materials using gin (type gin_trgm_ops);
create index if not exists materials_category    on public.materials (category_id);

alter table public.materials enable row level security;

drop policy if exists "materials: authenticated read" on public.materials;
create policy "materials: authenticated read"
  on public.materials for select to authenticated using (true);
drop policy if exists "materials: staff insert" on public.materials;
create policy "materials: staff insert"
  on public.materials for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "materials: staff update" on public.materials;
create policy "materials: staff update"
  on public.materials for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "materials: staff delete" on public.materials;
create policy "materials: staff delete"
  on public.materials for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));

-- ---------------------------------------------------------------------------
-- Material aliases — the predictive memory.
-- Every purchase line stores the exact text the user typed; searching later
-- matches against these variants, so "MOLDEX WYE" keeps finding "MOLDEX PVC WYE".
-- ---------------------------------------------------------------------------

create table if not exists public.material_aliases (
  id           bigint generated always as identity primary key,
  alias_text   text not null,                 -- normalized (norm_text) typed text
  material_id  bigint not null references public.materials(id) on delete cascade,
  hit_count    int not null default 1,
  last_used_at timestamptz not null default now(),
  unique (alias_text, material_id)
);

create index if not exists aliases_text_trgm on public.material_aliases using gin (alias_text gin_trgm_ops);
create index if not exists aliases_material  on public.material_aliases (material_id);

alter table public.material_aliases enable row level security;

drop policy if exists "aliases: authenticated read" on public.material_aliases;
create policy "aliases: authenticated read"
  on public.material_aliases for select to authenticated using (true);
drop policy if exists "aliases: staff insert" on public.material_aliases;
create policy "aliases: staff insert"
  on public.material_aliases for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "aliases: staff update" on public.material_aliases;
create policy "aliases: staff update"
  on public.material_aliases for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "aliases: staff delete" on public.material_aliases;
create policy "aliases: staff delete"
  on public.material_aliases for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------

create table if not exists public.suppliers (
  id         bigint generated always as identity primary key,
  name       text not null,
  name_norm  text generated always as (upper(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  created_at timestamptz not null default now()
);

create unique index if not exists suppliers_name_uq on public.suppliers (name);
create unique index if not exists suppliers_norm_uq on public.suppliers (name_norm);

alter table public.suppliers enable row level security;

drop policy if exists "suppliers: authenticated read" on public.suppliers;
create policy "suppliers: authenticated read"
  on public.suppliers for select to authenticated using (true);
drop policy if exists "suppliers: staff insert" on public.suppliers;
create policy "suppliers: staff insert"
  on public.suppliers for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "suppliers: staff update" on public.suppliers;
create policy "suppliers: staff update"
  on public.suppliers for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "suppliers: staff delete" on public.suppliers;
create policy "suppliers: staff delete"
  on public.suppliers for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));

-- ---------------------------------------------------------------------------
-- Purchases — one row per LINE ITEM (an invoice = same date + si_no + supplier)
-- ---------------------------------------------------------------------------

create table if not exists public.purchases (
  id               bigint generated always as identity primary key,
  purchase_date    date not null,
  si_no            text not null default '',
  supplier_id      bigint references public.suppliers(id) on delete set null,
  category_id      bigint references public.categories(id) on delete set null,
  material_id      bigint references public.materials(id) on delete set null,
  particulars_raw  text not null default '',  -- exactly as typed / imported
  project_name     text not null default '',  -- free text ("Mcdo", "Talisay")
  attributes       jsonb not null default '{}',
  unit_price       numeric(12,2) not null default 0 check (unit_price >= 0),
  quantity         numeric(12,3) not null default 1 check (quantity > 0),
  amount           numeric(12,2) not null default 0,  -- receipt truth; trigger-defaulted, overridable
  amount_source    text not null default 'computed'
                     check (amount_source in ('computed', 'manual', 'import_missing_filled')),
  amount_recomputed numeric(14,4) generated always as (unit_price * quantity) stored,
  receipt_quality  text not null default 'ok'
                     check (receipt_quality in ('ok', 'unreadable', 'no-invoice')),
  line_seq         int not null default 0,    -- order within the invoice block
  import_batch_id  uuid,
  notes            text not null default '',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists purchases_date     on public.purchases (purchase_date);
create index if not exists purchases_si       on public.purchases (si_no);
create index if not exists purchases_supplier on public.purchases (supplier_id);
create index if not exists purchases_material on public.purchases (material_id);
create index if not exists purchases_category on public.purchases (category_id);
create index if not exists purchases_block    on public.purchases (purchase_date, supplier_id, si_no, line_seq);

alter table public.purchases enable row level security;

drop policy if exists "purchases: authenticated read" on public.purchases;
create policy "purchases: authenticated read"
  on public.purchases for select to authenticated using (true);
drop policy if exists "purchases: staff insert" on public.purchases;
create policy "purchases: staff insert"
  on public.purchases for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "purchases: staff update" on public.purchases;
create policy "purchases: staff update"
  on public.purchases for update to authenticated
  using (public.my_role() in ('owner', 'encoder'))
  with check (public.my_role() in ('owner', 'encoder'));
drop policy if exists "purchases: staff delete" on public.purchases;
create policy "purchases: staff delete"
  on public.purchases for delete to authenticated
  using (public.my_role() in ('owner', 'encoder'));

-- Default amount to unit_price*quantity when not explicitly provided.
create or replace function public.set_amount()
returns trigger language plpgsql as $$
begin
  if new.amount is null or new.amount = 0 then
    new.amount := round(new.unit_price * new.quantity, 2);
  end if;
  return new;
end $$;

drop trigger if exists purchases_set_amount on public.purchases;
create trigger purchases_set_amount
  before insert or update on public.purchases
  for each row execute function public.set_amount();

-- Predictive memory bump: on every purchase line inserted, strengthen the
-- material's usage stats and store/refresh the typed text as an alias.
create or replace function public.bump_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m_id bigint := new.material_id;
begin
  if m_id is not null then
    update public.materials
       set usage_count = usage_count + 1, last_used_at = now()
     where id = m_id;

    insert into public.material_aliases (alias_text, material_id, hit_count)
    values (public.norm_text(new.particulars_raw), m_id, 1)
    on conflict (alias_text, material_id)
    do update set hit_count = material_aliases.hit_count + 1, last_used_at = now();
  end if;
  return new;
end $$;

drop trigger if exists purchases_bump_usage on public.purchases;
create trigger purchases_bump_usage
  after insert on public.purchases
  for each row execute function public.bump_usage();

-- ---------------------------------------------------------------------------
-- Import batches — idempotency guard: re-uploading the same file is detected
-- by its SHA-256 hash.
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  filename    text not null,
  file_sha256 text not null,
  line_count  int not null default 0,
  grand_total numeric(14,2) not null default 0,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now()
);

alter table public.import_batches enable row level security;

drop policy if exists "import_batches: authenticated read" on public.import_batches;
create policy "import_batches: authenticated read"
  on public.import_batches for select to authenticated using (true);
drop policy if exists "import_batches: staff insert" on public.import_batches;
create policy "import_batches: staff insert"
  on public.import_batches for insert to authenticated
  with check (public.my_role() in ('owner', 'encoder'));

-- ---------------------------------------------------------------------------
-- Predictive search RPC — trigram similarity over material names AND aliases,
-- ranked by score, then usage frequency, then recency. Also returns the last
-- price paid so the entry form can prefill UNIT PRICE.
--   const { data } = await supabase.rpc('search_materials', { q: 'MOLDEX WYE' })
-- ---------------------------------------------------------------------------

create or replace function public.search_materials(
  q text,
  p_category bigint default null,
  p_limit int default 8
)
returns table (
  id              bigint,
  category_id     bigint,
  brand           text,
  type            text,
  model_ver       text,
  size_native     text,
  size_system     text,
  size_metric     text,
  diameter        text,
  degrees         numeric,
  unit            text,
  search_name     text,
  usage_count     int,
  last_unit_price numeric(12,2),
  score           float
)
language sql stable set search_path = public as $$
  with needle as (select public.norm_text(q) as nq)
  select
    m.id, m.category_id, m.brand, m.type, m.model_ver,
    m.size_native, m.size_system, m.size_metric, m.diameter,
    m.degrees, m.unit, m.search_name, m.usage_count,
    lp.unit_price as last_unit_price,
    greatest(
      similarity(m.search_name, n.nq),
      coalesce((select max(similarity(a.alias_text, n.nq))
                from public.material_aliases a
                where a.material_id = m.id), 0)
    )::float as score
  from public.materials m
  cross join needle n
  left join lateral (
    select p2.unit_price
    from public.purchases p2
    where p2.material_id = m.id
    order by p2.purchase_date desc, p2.id desc
    limit 1
  ) lp on true
  where (p_category is null or m.category_id = p_category)
    and (
      m.search_name % n.nq
      or m.search_name ilike '%' || n.nq || '%'
      or exists (
        select 1 from public.material_aliases a
        where a.material_id = m.id
          and (a.alias_text % n.nq or a.alias_text ilike '%' || n.nq || '%')
      )
    )
  order by score desc, m.usage_count desc, m.last_used_at desc nulls last
  limit p_limit
$$;

grant execute on function public.search_materials(text, bigint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Convenience view for ledger/export (explicit security_invoker so RLS applies)
-- ---------------------------------------------------------------------------

create or replace view public.purchases_flat with (security_invoker = true) as
select
  p.id, p.purchase_date, p.si_no,
  s.name  as supplier,
  c.name  as category,
  m.search_name as material,
  p.particulars_raw, p.attributes, p.unit_price, p.quantity, p.amount,
  p.amount_source, p.amount_recomputed, p.receipt_quality,
  p.line_seq, p.notes, p.created_at,
  p.material_id, p.supplier_id, p.category_id,
  p.project_name
from public.purchases p
left join public.suppliers  s on s.id = p.supplier_id
left join public.categories c on c.id = p.category_id
left join public.materials  m on m.id = p.material_id;

-- ---------------------------------------------------------------------------
-- SEED: categories with their attribute templates (drives the entry form —
-- degrees only appears for products that have angles)
-- ---------------------------------------------------------------------------

insert into public.categories (name, unit, sort, attribute_template) values
('PVC Pipes & Fittings', 'pc', 1, '[
  {"key":"brand","label":"Brand","widget":"text","required":true,"predictive":true},
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true,
   "placeholder":"PIPE / ELBOW / WYE / TEE / COUPLING / CLEAN-OUT / P-TRAP / BUSHING / REDUCER"},
  {"key":"degrees","label":"Degrees","widget":"select","options":[22.5,45,90],
   "show_if":{"field":"type","contains_any":["ELBOW","BEND"]}},
  {"key":"size_native","label":"Size (as printed)","widget":"text","required":true,"placeholder":"e.g. 6X10, 4, 2 IN"},
  {"key":"size_system","label":"Number system","widget":"select","options":["english","metric"],"default":"english"},
  {"key":"diameter","label":"Diameter (if separate)","widget":"text","required":false}
]'::jsonb),
('PPR Pipes & Fittings', 'pc', 2, '[
  {"key":"brand","label":"Brand","widget":"text","required":true,"predictive":true},
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true,
   "placeholder":"PIPE / COUPLING / ELBOW / TEE"},
  {"key":"size_native","label":"Size","widget":"text","required":true,"placeholder":"e.g. 1/2, 3/4, 1, 1 1/4 IN"},
  {"key":"size_system","label":"Number system","widget":"select","options":["english","metric"],"default":"english"}
]'::jsonb),
('Structural Steel', 'pc', 3, '[
  {"key":"brand","label":"Brand / Mill","widget":"text","required":false,"predictive":true},
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true,
   "placeholder":"DEFORMED BAR / ANGLE BAR / FLAT BAR"},
  {"key":"size_native","label":"Size","widget":"text","required":true,"placeholder":"e.g. 10MM, 1/4X1 5MM"},
  {"key":"size_system","label":"Number system","widget":"select","options":["metric","english"],"default":"metric"}
]'::jsonb),
('Masonry', 'pc', 4, '[
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true,"placeholder":"CHB / MASONRY CEMENT"},
  {"key":"size_native","label":"Size / Grade","widget":"text","required":true,"placeholder":"e.g. #4"}
]'::jsonb),
('Fasteners', 'pc', 5, '[
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true,"placeholder":"NUT / WASHER / FULL THREADED ROD"},
  {"key":"size_native","label":"Size","widget":"text","required":true,"placeholder":"e.g. 3/8, 1/4 (6MM)"},
  {"key":"size_system","label":"Number system","widget":"select","options":["english","metric"],"default":"english"}
]'::jsonb),
('Fuel & Oil', 'L', 6, '[
  {"key":"type","label":"Product","widget":"text","required":true,"predictive":true,"placeholder":"XCS / XTRA ADVANCE / SHELL ADVANCE"},
  {"key":"model_ver","label":"Variant","widget":"text","required":false}
]'::jsonb),
('Safety Gear', 'pc', 7, '[
  {"key":"type","label":"Item","widget":"text","required":true,"predictive":true,"placeholder":"HARD HAT / LONGSLEEVE W/ REFLECTOR / SAFETY SHOES"},
  {"key":"size_native","label":"Size","widget":"text","required":false}
]'::jsonb),
('Tools & Equipment', 'pc', 8, '[
  {"key":"brand","label":"Brand","widget":"text","required":true,"predictive":true},
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true,"placeholder":"DRILL BIT / FUSION MACHINE / PRINTER"},
  {"key":"model_ver","label":"Model / Version","widget":"text","required":true,"placeholder":"e.g. 3 IN 1, 1/2"},
  {"key":"size_native","label":"Size","widget":"text","required":false}
]'::jsonb),
('Office & Printing', 'pc', 9, '[
  {"key":"type","label":"Item","widget":"text","required":true,"predictive":true,"placeholder":"BOND PAPER / STAPLE WIRE / PRINTING A3"},
  {"key":"size_native","label":"Size / Spec","widget":"text","required":false}
]'::jsonb),
('Misc Hardware', 'pc', 10, '[
  {"key":"brand","label":"Brand","widget":"text","required":false,"predictive":true},
  {"key":"type","label":"Type","widget":"text","required":true,"predictive":true},
  {"key":"size_native","label":"Size","widget":"text","required":false},
  {"key":"size_system","label":"Number system","widget":"select","options":["english","metric","n/a"],"default":"english"}
]'::jsonb)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- SEED: suppliers already present in PURCHASES (1).xlsx (verbatim, editable)
-- ---------------------------------------------------------------------------

insert into public.suppliers (name) values
  ('ANTECRISTO BUILDERS & DESIGN'),
  ('CEBU LUCKY MACHINERY, INC.'),
  ('PETRON MAMBALING, CEBU CITY'),
  ('SUNTRADE'),
  ('OCTAGON'),
  ('METRO'),
  ('WORLDWIDE HOME DEPOT'),
  ('SHELL SRP'),
  ('CEBU ATLANTIC HARDWARE'),
  ('CEBU HOME & BUILDERS CENTRE'),
  ('CITI HARDWARE'),
  ('NEW MILLENIUM HARDWARE, INC.'),
  ('BELMONT HARDWARE DEPOT'),
  ('MAMA MARY HARDWARE'),
  ('ATLAS BOLT FASTENERS CORPORATION')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- NEXT: run migration_003_projects_history.sql (History tab: activity_log,
-- audit triggers, restore_activity). It is idempotent, so it is safe on a
-- fresh install that already has project_name from this file.
-- ---------------------------------------------------------------------------
