-- Logs one row every time a player taps "Share Poster".
--
-- Note on identity: the game has no sign-in, so a row records *that* a share
-- happened and the finish time, not who did it. If you need "who", you will
-- need Supabase Auth (then add `user_id uuid references auth.users`) or a name
-- prompt before sharing (then add `player_name text`).

create table if not exists public.intuit_tetris_share_poster (
  id                 bigint generated always as identity primary key,
  -- Finish time in whole seconds, for sorting and leaderboards.
  completion_seconds integer     not null check (completion_seconds >= 0),
  -- The same time as shown to the player, e.g. '0:58'.
  completion_display text        not null,
  shared_at          timestamptz not null default now()
);

-- Fastest finishes first; also covers "how many shares today".
create index if not exists intuit_tetris_share_poster_completion_seconds_idx
  on public.intuit_tetris_share_poster (completion_seconds);
create index if not exists intuit_tetris_share_poster_shared_at_idx
  on public.intuit_tetris_share_poster (shared_at desc);

-- The browser uses the public anon key, so RLS must be on and deliberate.
alter table public.intuit_tetris_share_poster enable row level security;

-- Anonymous visitors may only append. They cannot read, update or delete,
-- so nobody can scrape or tamper with the log using the public key.
drop policy if exists "anon can insert share events" on public.intuit_tetris_share_poster;
create policy "anon can insert share events"
  on public.intuit_tetris_share_poster
  for insert
  to anon, authenticated
  with check (true);

grant insert on table public.intuit_tetris_share_poster to anon, authenticated;

-- Read the results from the SQL editor or with the service_role key, e.g.
--   select count(*) as shares, min(completion_seconds) as best from public.intuit_tetris_share_poster;
--   select * from public.intuit_tetris_share_poster order by completion_seconds asc limit 50;
