-- Keep the original photo next to the background-removed cut-out, so a bad cut-out can be
-- switched back. photo_path/thumb_path stay the cut-out (or the only photo when no background
-- was removed); use_original picks which one the app shows.

alter table public.items
  add column original_photo_path text,
  add column original_thumb_path text,
  add column use_original boolean not null default false;
