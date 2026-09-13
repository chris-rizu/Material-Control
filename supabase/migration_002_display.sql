-- ============================================================================
-- MIGRATION 002 — display fields for the Purchases table.
-- Paste into Supabase SQL Editor and Run (takes effect immediately, no data
-- is changed — this only adds the material's structured fields to the view
-- so the app can display "ELBOW 6 - 90°" correctly).
-- ============================================================================

create or replace view public.purchases_flat with (security_invoker = true) as
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
  p.material_id, p.supplier_id, p.category_id
from public.purchases p
left join public.suppliers  s on s.id = p.supplier_id
left join public.categories c on c.id = p.category_id
left join public.materials  m on m.id = p.material_id;
