-- Wardrobe items, one row per piece. Each row belongs to the signed-in user.

create table public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  photo_path  text,
  thumb_path  text,

  seasons     text[] not null default '{}'
              check (seasons <@ array['spring_summer', 'autumn_winter', 'all_year']),
  occasions   text[] not null default '{}',

  type        text check (type in ('top', 'bottom', 'dress', 'innerwear', 'outerwear', 'shoes', 'socks', 'accessory')),
  subtype     text,
  color       text,
  pattern     text,

  fabric      text,
  fit         text,
  brand       text,
  notes       text,
  tags        text[] not null default '{}'
);

create index items_user_created_idx on public.items (user_id, created_at desc);
create index items_seasons_idx on public.items using gin (seasons);
create index items_occasions_idx on public.items using gin (occasions);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger items_touch before update on public.items
for each row execute function public.touch_updated_at();

alter table public.items enable row level security;

create policy "own items: read"   on public.items for select using (auth.uid() = user_id);
create policy "own items: insert" on public.items for insert with check (auth.uid() = user_id);
create policy "own items: update" on public.items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own items: delete" on public.items for delete using (auth.uid() = user_id);

-- Private photo bucket. Files live under "<user id>/<item id>/...", and each user
-- can only touch their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "own photos: read" on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos: insert" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos: update" on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos: delete" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
