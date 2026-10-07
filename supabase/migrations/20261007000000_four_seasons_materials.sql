-- 1. Four seasons instead of three season groups. An item can have any number of them;
--    "all year" is simply all four. Existing values are converted:
--    spring_summer → spring + summer, autumn_winter → autumn + winter, all_year → all four.
-- 2. Materials: a list of tags (cotton, wool, …) that can be filtered on. Pre-filled from the
--    free-text fabric field, split on commas, slashes, "&", "+" and "and".

alter table public.items drop constraint if exists items_seasons_check;

update public.items i
set seasons = coalesce((
  select array_agg(distinct s)
  from unnest(i.seasons) as old(v)
  cross join lateral unnest(case old.v
    when 'spring_summer' then array['spring', 'summer']
    when 'autumn_winter' then array['autumn', 'winter']
    when 'all_year' then array['spring', 'summer', 'autumn', 'winter']
    else array[old.v]
  end) as s
), '{}');

-- The old season values stay allowed, so the previous version of the app (which still saves
-- them) keeps working until the new one is live; the new app converts them when it reads.
alter table public.items add constraint items_seasons_check
  check (seasons <@ array['spring', 'summer', 'autumn', 'winter', 'spring_summer', 'autumn_winter', 'all_year']);

alter table public.items add column materials text[] not null default '{}';

update public.items i
set materials = coalesce((
  select array_agg(distinct m)
  from (
    select lower(trim(part)) as m
    from regexp_split_to_table(i.fabric, '\s*(,|/|&|\+|\yand\y)\s*') as part
  ) parts
  where m <> ''
), '{}')
where i.fabric is not null and trim(i.fabric) <> '';

create index items_materials_idx on public.items using gin (materials);
