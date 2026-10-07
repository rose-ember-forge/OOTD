-- 1. "All year" is its own season value again, used instead of picking the four seasons.
--    Items that have all four seasons become all-year.
-- 2. Sub-classes: sleeve (tops, dresses, outerwear) and length (bottoms, dresses, outerwear,
--    socks). Free text in the database; the app offers a fixed list per type.
-- Safe to run while the previous app version is live: it reads all_year as all four seasons
-- and ignores the new columns.

alter table public.items drop constraint if exists items_seasons_check;

update public.items
set seasons = '{all_year}'
where seasons @> array['spring', 'summer', 'autumn', 'winter'];

alter table public.items add constraint items_seasons_check
  check (seasons <@ array['spring', 'summer', 'autumn', 'winter', 'all_year']);

alter table public.items
  add column sleeve text,
  add column length text;
