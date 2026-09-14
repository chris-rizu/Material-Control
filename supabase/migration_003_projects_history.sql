-- ============================================================================
-- MIGRATION 003 — Project names + History (activity log with restore)
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- IDEMPOTENT: safe to run again (columns IF NOT EXISTS, functions CREATE OR
-- REPLACE, policies/triggers dropped first).
--
-- What it adds:
--   1. purchases.project_name   — free text per line ("Mcdo", "Talisay").
--   2. purchases_flat           — rebuilt to expose project_name.
--   3. activity_log             — automatic history of every insert / update /
--                                 delete on purchases, suppliers and materials.
--   4. restore_activity()       — puts a deleted row back (keeps its original
--                                 id and links; compensates usage counters).
--
-- NOTES ON THE TRICKY PARTS (do not "simplify"):
--   * purchases_flat is DROP + CREATE inside one DO block — CREATE OR REPLACE
--     VIEW can only append columns, it cannot reorder/retype (42P16).
--   * audit_row() checks current_setting('app.audit_skip') so restore_activity
--     can re-insert rows without logging them as new inserts.
--   * activity_log has NO insert/update/delete policies on purpose: only the
--     SECURITY DEFINER triggers/functions write it; humans only read.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Project name on every purchase line
-- ---------------------------------------------------------------------------

alter table public.purchases
  add column if not exists project_name text not null default '';

-- ---------------------------------------------------------------------------
-- 2. purchases_flat — rebuilt with project_name (transaction: all or nothing)
--    Keeps EVERY column migration 002 added (material_brand … material_degrees
--    drive the "ELBOW 6 - 90°" display) — dropping them would silently revert
--    the Particulars column to raw typed text.
-- ---------------------------------------------------------------------------

do $$
begin
  drop view if exists public.purchases_flat;
  create view public.purchases_flat with (security_invoker = true) as
  select
    p.id, p.purchase_date, p.si_no,
    s.name  as supplier,
    c.name  as category,
    m.search_name as material,
    m.brand as material_brand,
    m.type  as material_type,
    m.model_ver as material_model_ver,
    m.size_native as material_size_native,
    m.degrees as material_degrees,
    p.particulars_raw, p.attributes, p.unit_price, p.quantity, p.amount,
    p.amount_source, p.amount_recomputed, p.receipt_quality,
    p.line_seq, p.notes, p.created_at,
    p.material_id, p.supplier_id, p.category_id,
    p.project_name
  from public.purchases p
  left join public.suppliers  s on s.id = p.supplier_id
  left join public.categories c on c.id = p.category_id
  left join public.materials  m on m.id = p.material_id;

  -- keep access exactly as before (same grant as migration 002)
  grant select on public.purchases_flat to anon, authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- 3. activity_log — what happened, when, by whom, and the full row snapshot
-- ---------------------------------------------------------------------------

create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  acted_at   timestamptz not null default now(),
  actor      text not null default '',          -- auth.email() of whoever did it
  action     text not null check (action in ('insert', 'update', 'delete', 'restore')),
  table_name text not null,                     -- purchases | suppliers | materials
  row_id     bigint,
  summary    text not null default '',          -- human label (item text / name)
  details    jsonb                              -- full row (updates keep old + new)
);

create index if not exists activity_log_recent on public.activity_log (acted_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "activity_log: authenticated read" on public.activity_log;
create policy "activity_log: authenticated read"
  on public.activity_log for select to authenticated using (true);

-- One generic audit trigger for all three tables. SECURITY DEFINER so it can
-- write activity_log regardless of RLS (the table has no insert policy).
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_row jsonb;
  new_row jsonb;
  lbl text;
begin
  -- restore_activity flips this so re-inserting a deleted row is not
  -- double-logged as a fresh insert
  if coalesce(current_setting('app.audit_skip', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  old_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;

  -- every purchase insert bumps materials.usage_count / last_used_at; those
  -- bookkeeping-only updates are not edits a person made — don't log them
  if tg_op = 'UPDATE'
     and (old_row - 'usage_count' - 'last_used_at') = (new_row - 'usage_count' - 'last_used_at') then
    return new;
  end if;

  lbl := case tg_table_name
    when 'purchases' then coalesce(new_row ->> 'particulars_raw', old_row ->> 'particulars_raw', '')
    when 'suppliers' then coalesce(new_row ->> 'name', old_row ->> 'name', '')
    when 'materials' then trim(
          coalesce(new_row ->> 'brand', old_row ->> 'brand', '') || ' ' ||
          coalesce(new_row ->> 'type', old_row ->> 'type', '') || ' ' ||
          coalesce(new_row ->> 'size_native', old_row ->> 'size_native', ''))
    else ''
  end;

  insert into public.activity_log (actor, action, table_name, row_id, summary, details)
  values (
    coalesce(auth.email(), ''),
    lower(tg_op),
    tg_table_name,
    nullif(coalesce(new_row ->> 'id', old_row ->> 'id'), '')::bigint,
    lbl,
    case when tg_op = 'UPDATE'
      then jsonb_build_object('old', old_row, 'new', new_row)
      else coalesce(new_row, old_row)
    end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists purchases_audit on public.purchases;
create trigger purchases_audit
  after insert or update or delete on public.purchases
  for each row execute function public.audit_row();

drop trigger if exists suppliers_audit on public.suppliers;
create trigger suppliers_audit
  after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();

drop trigger if exists materials_audit on public.materials;
create trigger materials_audit
  after insert or update or delete on public.materials
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- 4. restore_activity — put a deleted row back, exactly as it was
--    Keeps the ORIGINAL id (so invoice blocks stay aligned), nulls out any
--    link whose target was itself deleted, and undoes the usage-counter bump
--    the insert trigger fires. Owner/encoder only.
-- ---------------------------------------------------------------------------

create or replace function public.restore_activity(p_log_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  e record;
  r jsonb;
  sup_id bigint;
  cat_id bigint;
  mat_id bigint;
  new_id bigint;
begin
  if public.my_role() not in ('owner', 'encoder') then
    raise exception 'Only the owner or an encoder can restore deleted rows.';
  end if;

  select * into e from public.activity_log where id = p_log_id;
  if not found then
    raise exception 'History entry % not found.', p_log_id;
  end if;
  if e.action <> 'delete' then
    raise exception 'Only deleted rows can be restored.';
  end if;

  r := e.details;
  perform set_config('app.audit_skip', 'on', true);

  if e.table_name = 'purchases' then
    if exists (select 1 from public.purchases where id = (r ->> 'id')::bigint) then
      return 'Line #' || r ->> 'id' || ' already exists — nothing to restore.';
    end if;

    sup_id := null;
    if r ->> 'supplier_id' is not null then
      select id into sup_id from public.suppliers where id = (r ->> 'supplier_id')::bigint;
    end if;
    cat_id := null;
    if r ->> 'category_id' is not null then
      select id into cat_id from public.categories where id = (r ->> 'category_id')::bigint;
    end if;
    mat_id := null;
    if r ->> 'material_id' is not null then
      select id into mat_id from public.materials where id = (r ->> 'material_id')::bigint;
    end if;

    insert into public.purchases
      (id, purchase_date, si_no, supplier_id, category_id, material_id,
       particulars_raw, attributes, unit_price, quantity, amount, amount_source,
       receipt_quality, line_seq, import_batch_id, notes, created_by, created_at, project_name)
    overriding system value
    values
      ((r ->> 'id')::bigint,
       (r ->> 'purchase_date')::date,
       coalesce(r ->> 'si_no', ''),
       sup_id, cat_id, mat_id,
       coalesce(r ->> 'particulars_raw', ''),
       coalesce(r -> 'attributes', '{}'::jsonb),
       (r ->> 'unit_price')::numeric,
       (r ->> 'quantity')::numeric,
       (r ->> 'amount')::numeric,
       coalesce(r ->> 'amount_source', 'computed'),
       coalesce(r ->> 'receipt_quality', 'ok'),
       coalesce((r ->> 'line_seq')::int, 0),
       (r ->> 'import_batch_id')::uuid,
       coalesce(r ->> 'notes', ''),
       (r ->> 'created_by')::uuid,
       coalesce((r ->> 'created_at')::timestamptz, now()),
       coalesce(r ->> 'project_name', ''));
    new_id := (r ->> 'id')::bigint;

    -- bump_usage() fired on the insert; undo its arithmetic so counters stay
    -- exactly as they were before the delete
    if mat_id is not null then
      update public.materials
        set usage_count = greatest(usage_count - 1, 0)
        where id = mat_id;
      update public.material_aliases
        set hit_count = greatest(hit_count - 1, 0)
        where material_id = mat_id
          and alias_text = public.norm_text(coalesce(r ->> 'particulars_raw', ''));
    end if;

    perform setval(pg_get_serial_sequence('public.purchases', 'id'),
      (select max(id) from public.purchases));

  elsif e.table_name = 'suppliers' then
    if exists (select 1 from public.suppliers where id = (r ->> 'id')::bigint) then
      return 'Supplier #' || r ->> 'id' || ' already exists — nothing to restore.';
    end if;
    insert into public.suppliers (id, name, created_at)
    overriding system value
    values ((r ->> 'id')::bigint, coalesce(r ->> 'name', 'Unnamed'),
            coalesce((r ->> 'created_at')::timestamptz, now()))
    on conflict do nothing;
    if not found then
      return 'A supplier named "' || (r ->> 'name') || '" already exists — nothing to restore.';
    end if;
    new_id := (r ->> 'id')::bigint;
    perform setval(pg_get_serial_sequence('public.suppliers', 'id'),
      (select max(id) from public.suppliers));

  elsif e.table_name = 'materials' then
    if exists (select 1 from public.materials where id = (r ->> 'id')::bigint) then
      return 'Particular #' || r ->> 'id' || ' already exists — nothing to restore.';
    end if;
    insert into public.materials
      (id, category_id, brand, type, model_ver, size_native, size_system,
       size_metric, diameter, degrees, unit, reference_price, usage_count,
       last_used_at, created_at)
    overriding system value
    values
      ((r ->> 'id')::bigint,
       (r ->> 'category_id')::bigint,
       coalesce(r ->> 'brand', ''),
       coalesce(r ->> 'type', ''),
       coalesce(r ->> 'model_ver', ''),
       coalesce(r ->> 'size_native', ''),
       coalesce(r ->> 'size_system', 'english'),
       coalesce(r ->> 'size_metric', ''),
       coalesce(r ->> 'diameter', ''),
       (r ->> 'degrees')::numeric,
       coalesce(r ->> 'unit', 'pc'),
       (r ->> 'reference_price')::numeric,
       coalesce((r ->> 'usage_count')::int, 0),
       (r ->> 'last_used_at')::timestamptz,
       coalesce((r ->> 'created_at')::timestamptz, now()))
    on conflict do nothing;
    if not found then
      return 'A twin of this particular already exists — nothing to restore.';
    end if;
    new_id := (r ->> 'id')::bigint;
    perform setval(pg_get_serial_sequence('public.materials', 'id'),
      (select max(id) from public.materials));

  else
    raise exception 'Restore is not supported for %.', e.table_name;
  end if;

  insert into public.activity_log (actor, action, table_name, row_id, summary, details)
  values (coalesce(auth.email(), ''), 'restore', e.table_name, new_id, e.summary, r);

  return 'Restored: ' || e.summary;
end $$;

grant execute on function public.restore_activity(bigint) to authenticated;
