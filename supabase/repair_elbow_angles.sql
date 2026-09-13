-- ============================================================================
-- REPAIR - angled elbows linked to the wrong catalog material.
-- Creates the 6 missing correct-angle materials, re-links the 11 mis-linked
-- ledger lines, re-points the poisoned aliases, dissolves the degree-less
-- "MOLDEX PVC 3X90" material (its two lines are really
-- MOLDEX PVC ELBOW 3 at 90 degrees).
--
-- HOW TO RUN: Supabase SQL Editor -> NEW QUERY (empty tab) -> paste the
-- whole file -> Run. The DO block is one transaction: all or nothing.
-- A parse error anywhere means NOTHING ran; a success message after the
-- DO block means everything did. The verify select at the end must show
-- status "ok" on every row.
-- ============================================================================

do $$
declare
  atl2_45  int;  -- ATLANTA ELBOW 2, 45 degrees
  mel2_45  int;  -- MOLDEX ELBOW 2, 45 degrees
  mel3_90  int;  -- MOLDEX ELBOW 3, 90 degrees
  mpel3_90 int;  -- MOLDEX PVC ELBOW 3, 90 degrees
  mpel4_45 int;  -- MOLDEX PVC ELBOW 4, 45 degrees
  mpel6_45 int;  -- MOLDEX PVC ELBOW 6, 45 degrees
begin
  -- 1. create the six missing materials (clones of the correct-angle
  --    sibling: same category/unit/size, only degrees differ;
  --    search_name is generated, reference_price stays unset)
  insert into materials (category_id, brand, type, model_ver, size_native, size_system, diameter, degrees, unit)
    select category_id, brand, type, model_ver, size_native, size_system, diameter, 45, unit
    from materials where id = 42
    returning id into atl2_45;

  insert into materials (category_id, brand, type, model_ver, size_native, size_system, diameter, degrees, unit)
    select category_id, brand, type, model_ver, size_native, size_system, diameter, 45, unit
    from materials where id = 39
    returning id into mel2_45;

  insert into materials (category_id, brand, type, model_ver, size_native, size_system, diameter, degrees, unit)
    select category_id, brand, type, model_ver, size_native, size_system, diameter, 90, unit
    from materials where id = 24
    returning id into mel3_90;

  insert into materials (category_id, brand, type, model_ver, size_native, size_system, diameter, degrees, unit)
    select category_id, brand, type, model_ver, size_native, size_system, diameter, 90, unit
    from materials where id = 53
    returning id into mpel3_90;

  insert into materials (category_id, brand, type, model_ver, size_native, size_system, diameter, degrees, unit)
    select category_id, brand, type, model_ver, size_native, size_system, diameter, 45, unit
    from materials where id = 21
    returning id into mpel4_45;

  insert into materials (category_id, brand, type, model_ver, size_native, size_system, diameter, degrees, unit)
    select category_id, brand, type, model_ver, size_native, size_system, diameter, 45, unit
    from materials where id = 9
    returning id into mpel6_45;

  -- 2. re-link the mis-linked ledger lines (the receipt text is the truth)
  update purchases set material_id = atl2_45  where id in (72);
  update purchases set material_id = mel2_45  where id in (63, 93);
  update purchases set material_id = mel3_90  where id in (122, 129);
  update purchases set material_id = mpel3_90 where id in (25, 69);
  update purchases set material_id = mpel4_45 where id in (47);
  update purchases set material_id = mpel6_45 where id in (41);

  -- 3. re-point the poisoned aliases (the angle in the alias text is the truth)
  update material_aliases set material_id = atl2_45  where alias_text = 'ATLANTA ELBOW 2X45';
  update material_aliases set material_id = mel2_45  where alias_text = 'MOLDEX ELBOW 2X45';
  update material_aliases set material_id = mel3_90  where alias_text = 'MOLDEX ELBOW 3X90';
  update material_aliases set material_id = mpel3_90 where alias_text in ('MOLDEX PVC ELBOW 3X90', 'MOLDEX PVC 3X90');
  update material_aliases set material_id = mpel4_45 where alias_text = 'MOLDEX PVC ELBOW 4X45';
  update material_aliases set material_id = mpel6_45 where alias_text = 'MOLDEX PVC ELBOW 6X45';

  -- 4. dissolve the degree-less material 22 (its lines and aliases now
  --    live on the proper MOLDEX PVC ELBOW 3 at 90 degrees)
  delete from material_aliases where material_id = 22;
  delete from materials where id = 22;
end $$;

-- 5. verify - every row must say "ok"
with angled as (
  select p.id, p.particulars_raw, p.material_id,
         (regexp_match(upper(p.particulars_raw), 'X\s*(22\.5|45|90)'))[1] as raw_angle
  from purchases p
)
select a.id as line_id, a.particulars_raw, m.id as material_id, m.search_name,
       m.degrees as mat_degrees, a.raw_angle,
       case
         when m.id is null then 'unlinked'
         when a.raw_angle is not null and m.degrees is distinct from a.raw_angle::numeric then '*** MISMATCH ***'
         else 'ok'
       end as status
from angled a
left join materials m on m.id = a.material_id
where a.raw_angle is not null or m.degrees > 0
order by status desc, m.search_name, a.id;
