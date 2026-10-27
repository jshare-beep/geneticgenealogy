-- Genealogy Mapper cloud save schema.
--
-- Lives in the SAME Supabase project as Multifacet's own schema.sql - just a second
-- table alongside `trees`, same ownership/RLS pattern: each row is one saved map, owned
-- by the account that created it (user_id), and RLS makes sure a signed-in user can only
-- ever see, save, or delete their own rows.
--
-- Run this in the Supabase SQL editor in addition to schema.sql (both can coexist in one
-- project - no need for a second project or a second config.js).

create table if not exists genealogy_maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled map',
  data jsonb not null,
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists genealogy_maps_user_id_idx on genealogy_maps (user_id);

alter table genealogy_maps enable row level security;

create policy "select own genealogy maps" on genealogy_maps
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "insert own genealogy maps" on genealogy_maps
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "update own genealogy maps" on genealogy_maps
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own genealogy maps" on genealogy_maps
  for delete
  to authenticated
  using (auth.uid() = user_id);
