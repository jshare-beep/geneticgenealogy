-- Multifacet cloud save schema.
--
-- Many trees per account: each row is one saved tree, owned by the account that
-- created it (user_id). Access is enforced by row-level security - the client
-- reads/writes the `trees` table directly through supabase-js, and RLS makes sure a
-- signed-in user can only ever see, save, or delete their own rows.
--
-- `name` is kept as its own column (denormalized out of `data`) so the "My trees"
-- picker can list a user's trees cheaply, without pulling every tree's full JSON blob.
--
-- Requires email auth (magic link) and/or the Google provider enabled on the project:
-- Authentication -> Providers.

create table if not exists trees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled tree',
  data jsonb not null,
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trees_user_id_idx on trees (user_id);

alter table trees enable row level security;

create policy "select own trees" on trees
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "insert own trees" on trees
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "update own trees" on trees
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own trees" on trees
  for delete
  to authenticated
  using (auth.uid() = user_id);
